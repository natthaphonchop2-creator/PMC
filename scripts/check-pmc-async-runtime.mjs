#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const executeFile = promisify(execFile)
const REQUIRED_APIS = ['cloudtasks.googleapis.com', 'storage.googleapis.com', 'iamcredentials.googleapis.com']
const REQUIRED_ENV_NAMES = [
  'PMC_GCP_PROJECT_ID', 'PMC_ASYNC_LOCATION', 'PMC_ASYNC_BUCKET', 'PMC_ASYNC_QUEUE',
  'PMC_ASYNC_WORKER_URL', 'PMC_ASYNC_WORKER_AUDIENCE', 'PMC_ASYNC_TASK_INVOKER_EMAIL', 'PMC_ASYNC_OWNER_STAFF_IDS',
]

export async function inspectPmcAsyncRuntime(inputs, execute = runGoogleCommand, environment = process.env) {
  const [apis, bucket, queue, storageIam, queueIam, serviceIam] = await Promise.all([
    safeJson(execute, ['gcloud', 'services', 'list', '--enabled', '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'storage', 'buckets', 'describe', `gs://${inputs.bucket}`, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'queues', 'describe', inputs.queue, '--location', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'storage', 'buckets', 'get-iam-policy', `gs://${inputs.bucket}`, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'queues', 'get-iam-policy', inputs.queue, '--location', inputs.region, '--project', inputs.project, '--format=json']),
    safeJson(execute, ['gcloud', 'run', 'services', 'get-iam-policy', inputs.service, '--region', inputs.region, '--project', inputs.project, '--format=json']),
  ])
  const enabledApis = new Set(Array.isArray(apis) ? apis.map((value) => value?.config?.name).filter((value) => typeof value === 'string') : [])
  const roles = [...new Set([storageIam, queueIam, serviceIam].flatMap(roleNames))].sort()
  const retrySettings = queue ? {
    maxAttempts: positiveInteger(queue.retryConfig?.maxAttempts),
    minBackoffSeconds: durationSeconds(queue.retryConfig?.minBackoff),
    maxBackoffSeconds: durationSeconds(queue.retryConfig?.maxBackoff),
    maxRetryDurationSeconds: durationSeconds(queue.retryConfig?.maxRetryDuration),
    maxConcurrentDispatches: positiveInteger(queue.rateLimits?.maxConcurrentDispatches),
    maxDispatchesPerSecond: positiveInteger(queue.rateLimits?.maxDispatchesPerSecond),
  } : safeRetrySettings()
  const bucketReport = {
    exists: bucket !== null,
    locationMatches: bucket !== null && bucket.location === inputs.region,
    uniformBucketLevelAccess: bucket?.iamConfiguration?.uniformBucketLevelAccess?.enabled === true,
    publicAccessPrevention: bucket?.iamConfiguration?.publicAccessPrevention === 'enforced',
  }
  const queueReport = {
    exists: queue !== null,
    locationMatches: queue !== null,
    retrySettings,
  }
  const environmentReport = {
    asyncEnabled: environment.PMC_MINI_APP_ASYNC_ENABLED === 'true',
    requiredNameCount: REQUIRED_ENV_NAMES.length,
    presentNameCount: REQUIRED_ENV_NAMES.filter((name) => Boolean(environment[name]?.trim())).length,
  }
  const iam = { bindingCount: roles.length, roles }
  const apisReport = REQUIRED_APIS.map((name) => ({ name, enabled: enabledApis.has(name) }))
  const ready = apisReport.every(({ enabled }) => enabled)
    && Object.values(bucketReport).every(Boolean)
    && queueReport.exists && queueReport.locationMatches
    && retrySettings.maxAttempts === 8 && retrySettings.minBackoffSeconds === 10 && retrySettings.maxBackoffSeconds === 300
    && retrySettings.maxRetryDurationSeconds === 86_400 && retrySettings.maxConcurrentDispatches === 1 && retrySettings.maxDispatchesPerSecond === 2
    && iam.roles.includes('roles/storage.objectUser') && iam.roles.includes('roles/cloudtasks.enqueuer') && iam.roles.includes('roles/run.invoker')
    && environmentReport.presentNameCount === environmentReport.requiredNameCount
  return { mode: 'READ_ONLY', ready, apis: apisReport, bucket: bucketReport, queue: queueReport, iam, environment: environmentReport }
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

function parseArguments(args) {
  const parsed = { project: null, region: null, service: null, bucket: null, queue: null, strict: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--strict') parsed.strict = true
    else if (['--project', '--region', '--service', '--bucket', '--queue'].includes(value) && args[index + 1]) parsed[value.slice(2)] = args[++index]
    else throw new Error('Invalid async runtime-check argument')
  }
  if (!parsed.help && [parsed.project, parsed.region, parsed.service, parsed.bucket, parsed.queue].some((value) => !safeInput(value))) {
    throw new Error('Async runtime-check requires all resource arguments')
  }
  return parsed
}

async function runGoogleCommand(args) {
  const { stdout } = await executeFile(args[0], args.slice(1), { maxBuffer: 1_000_000 })
  return stdout
}

async function safeJson(execute, command) {
  try {
    const output = await execute(command)
    return JSON.parse(output)
  } catch { return null }
}

function roleNames(policy) {
  return Array.isArray(policy?.bindings) ? policy.bindings.map((binding) => binding?.role).filter((role) => /^roles\/[A-Za-z.]+$/.test(role)) : []
}

function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0 }
function durationSeconds(value) { return typeof value === 'string' && /^(?:0|[1-9]\d*)s$/.test(value) ? Number(value.slice(0, -1)) : 0 }
function safeRetrySettings() { return { maxAttempts: 0, minBackoffSeconds: 0, maxBackoffSeconds: 0, maxRetryDurationSeconds: 0, maxConcurrentDispatches: 0, maxDispatchesPerSecond: 0 } }
function safeInput(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\r\n]/.test(value) }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPmcAsyncRuntimeCheck(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch(() => { process.stderr.write('Async runtime check failed\n'); process.exitCode = 2 })
}
