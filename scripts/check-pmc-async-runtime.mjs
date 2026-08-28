#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const executeFile = promisify(execFile)
const REQUIRED_APIS = ['cloudtasks.googleapis.com', 'storage.googleapis.com', 'iamcredentials.googleapis.com']
const REQUIRED_DEPLOYED_NAMES = [
  'PMC_MINI_APP_ASYNC_ENABLED', 'PMC_GCP_PROJECT_ID', 'PMC_ASYNC_LOCATION', 'PMC_ASYNC_BUCKET', 'PMC_ASYNC_QUEUE',
  'PMC_ASYNC_WORKER_URL', 'PMC_ASYNC_WORKER_AUDIENCE', 'PMC_ASYNC_TASK_INVOKER_EMAIL', 'PMC_ASYNC_OWNER_STAFF_IDS',
  'PMC_BOOKING_INGRESS_SECRET',
]
const FORBIDDEN_PROJECT_ROLES = new Set([
  'roles/owner', 'roles/editor', 'roles/storage.admin', 'roles/cloudtasks.admin',
  'roles/secretmanager.admin', 'roles/secretmanager.secretAccessor',
])

export async function inspectPmcAsyncRuntime(inputs, execute = runGoogleCommand, _localEnvironment = process.env) {
  const [apis, bucket, queue, service, bucketIam, queueIam, serviceIam, projectIam] = await Promise.all([
    safeJson(execute, ['gcloud', 'services', 'list', '--enabled', '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'storage', 'buckets', 'describe', `gs://${inputs.bucket}`, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'queues', 'describe', inputs.queue, '--location', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'run', 'services', 'describe', inputs.service, '--region', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'storage', 'buckets', 'get-iam-policy', `gs://${inputs.bucket}`, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'queues', 'get-iam-policy', inputs.queue, '--location', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'run', 'services', 'get-iam-policy', inputs.service, '--region', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'projects', 'get-iam-policy', inputs.project, '--format=json']),
  ])
  const deployed = deployedReport(service)
  const runtimeIdentity = deployed.runtimeIdentity
  const taskInvokerIdentity = deployed.taskInvokerIdentity
  const exactBindingsReady = Boolean(runtimeIdentity && taskInvokerIdentity)
    && hasMemberRole(bucketIam, 'roles/storage.objectUser', runtimeIdentity)
    && hasMemberRole(queueIam, 'roles/cloudtasks.enqueuer', runtimeIdentity)
    && hasMemberRole(serviceIam, 'roles/run.invoker', taskInvokerIdentity)
  const forbiddenBroadBindings = Boolean(runtimeIdentity || taskInvokerIdentity)
    && [runtimeIdentity, taskInvokerIdentity].filter(Boolean).some((identity) => hasForbiddenProjectRole(projectIam, identity))
  const roles = [...new Set([bucketIam, queueIam, serviceIam, projectIam].flatMap(roleNames))].sort()
  const apisReport = REQUIRED_APIS.map((name) => ({ name, enabled: enabledApiNames(apis).has(name) }))
  const retrySettings = queue ? retryReport(queue) : emptyRetryReport()
  const bucketReport = {
    exists: bucket !== null,
    locationMatches: bucket !== null && bucket.location === inputs.region,
    uniformBucketLevelAccess: bucket?.iamConfiguration?.uniformBucketLevelAccess?.enabled === true,
    publicAccessPrevention: bucket?.iamConfiguration?.publicAccessPrevention === 'enforced',
  }
  const queueReport = { exists: queue !== null, locationMatches: queue !== null, retrySettings }
  const iam = { requiredBindingCount: 3, exactBindingsReady, forbiddenBroadBindings, roles }
  const safeDeployed = {
    serviceExists: deployed.serviceExists,
    asyncDisabled: deployed.asyncDisabled,
    requiredNameCount: REQUIRED_DEPLOYED_NAMES.length,
    presentNameCount: deployed.presentNameCount,
  }
  const ready = apisReport.every(({ enabled }) => enabled)
    && Object.values(bucketReport).every(Boolean)
    && queueReport.exists && queueReport.locationMatches && matchesRetrySettings(retrySettings)
    && iam.exactBindingsReady && !iam.forbiddenBroadBindings
    && safeDeployed.serviceExists && safeDeployed.asyncDisabled
    && safeDeployed.presentNameCount === safeDeployed.requiredNameCount
  return { mode: 'READ_ONLY', ready, apis: apisReport, bucket: bucketReport, queue: queueReport, iam, deployed: safeDeployed }
}

export async function runPmcAsyncRuntimeCheck(args, io = { stdout: process.stdout, stderr: process.stderr }, execute = runGoogleCommand, environment = process.env) {
  const parsed = parseArguments(args)
  if (parsed.help) {
    io.stdout.write('Usage: check-pmc-async-runtime --project <id> --region <region> --service <name> --bucket <name> --queue <name> [--strict]\n')
    return 0
  }
  const report = await inspectPmcAsyncRuntime(parsed, execute, environment)
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return parsed.strict && !report.ready ? 1 : 0
}

function deployedReport(service) {
  const spec = service?.spec?.template?.spec
  const env = Array.isArray(spec?.containers) ? spec.containers.flatMap((container) => Array.isArray(container?.env) ? container.env : []) : []
  const configured = new Map(env.filter((entry) => typeof entry?.name === 'string').map((entry) => [entry.name, entry]))
  const flag = configured.get('PMC_MINI_APP_ASYNC_ENABLED')
  const runtimeIdentity = typeof spec?.serviceAccountName === 'string' ? `serviceAccount:${spec.serviceAccountName}` : null
  const invoker = configured.get('PMC_ASYNC_TASK_INVOKER_EMAIL')?.value
  const taskInvokerIdentity = typeof invoker === 'string' && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(invoker)
    ? `serviceAccount:${invoker}` : null
  return {
    serviceExists: service !== null,
    asyncDisabled: flag?.value === 'false',
    presentNameCount: REQUIRED_DEPLOYED_NAMES.filter((name) => configured.has(name)).length,
    runtimeIdentity,
    taskInvokerIdentity,
  }
}

function enabledApiNames(apis) {
  return new Set(Array.isArray(apis) ? apis.map((entry) => entry?.config?.name).filter((name) => typeof name === 'string') : [])
}
function retryReport(queue) {
  return {
    maxAttempts: positiveInteger(queue.retryConfig?.maxAttempts), minBackoffSeconds: durationSeconds(queue.retryConfig?.minBackoff),
    maxBackoffSeconds: durationSeconds(queue.retryConfig?.maxBackoff), maxRetryDurationSeconds: durationSeconds(queue.retryConfig?.maxRetryDuration),
    maxConcurrentDispatches: positiveInteger(queue.rateLimits?.maxConcurrentDispatches), maxDispatchesPerSecond: positiveInteger(queue.rateLimits?.maxDispatchesPerSecond),
  }
}
function emptyRetryReport() { return { maxAttempts: 0, minBackoffSeconds: 0, maxBackoffSeconds: 0, maxRetryDurationSeconds: 0, maxConcurrentDispatches: 0, maxDispatchesPerSecond: 0 } }
function matchesRetrySettings(value) {
  return value.maxAttempts === 8 && value.minBackoffSeconds === 10 && value.maxBackoffSeconds === 300
    && value.maxRetryDurationSeconds === 86_400 && value.maxConcurrentDispatches === 1 && value.maxDispatchesPerSecond === 2
}
function hasMemberRole(policy, role, member) {
  return Array.isArray(policy?.bindings) && policy.bindings.some((binding) => binding?.role === role && Array.isArray(binding.members) && binding.members.includes(member))
}
function hasForbiddenProjectRole(policy, member) {
  return Array.isArray(policy?.bindings) && policy.bindings.some((binding) => FORBIDDEN_PROJECT_ROLES.has(binding?.role) && Array.isArray(binding.members) && binding.members.includes(member))
}
function roleNames(policy) { return Array.isArray(policy?.bindings) ? policy.bindings.map((binding) => binding?.role).filter((role) => /^roles\/[A-Za-z.]+$/.test(role)) : [] }
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0 }
function durationSeconds(value) { return typeof value === 'string' && /^(?:0|[1-9]\d*)s$/.test(value) ? Number(value.slice(0, -1)) : 0 }
function safeInput(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\r\n]/.test(value) }
async function safeJson(execute, command) { try { return JSON.parse(await execute(command)) } catch { return null } }
async function runGoogleCommand(args) { const { stdout } = await executeFile(args[0], args.slice(1), { maxBuffer: 1_000_000 }); return stdout }
function parseArguments(args) {
  const parsed = { project: null, region: null, service: null, bucket: null, queue: null, strict: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--strict') parsed.strict = true
    else if (['--project', '--region', '--service', '--bucket', '--queue'].includes(value) && args[index + 1]) parsed[value.slice(2)] = args[++index]
    else throw new Error('Invalid async runtime-check argument')
  }
  if (!parsed.help && [parsed.project, parsed.region, parsed.service, parsed.bucket, parsed.queue].some((value) => !safeInput(value))) throw new Error('Async runtime-check requires all resource arguments')
  return parsed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPmcAsyncRuntimeCheck(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch(() => { process.stderr.write('Async runtime check failed\n'); process.exitCode = 2 })
}
