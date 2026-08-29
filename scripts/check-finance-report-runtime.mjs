#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { APPROVED_FINANCE_PROJECT, assertNoSensitiveFlags, safeProject } from './seed-finance-report-day.mjs'

const executeFile = promisify(execFile)
const FINANCE_SEED_PATH = '/internal/mini-app/finance-daily-seed'
const ALLOCATION_WORKER_PATH = '/internal/mini-app/jera-allocation-worker'
const APPROVED_REGION = 'asia-southeast1'
const STAGES = new Set(['DISABLED', 'ALLOCATION', 'READY'])
const REQUIRED_ALLOCATION_NAMES = [
  'JERA_ALLOCATION_PROJECT_ID', 'JERA_ALLOCATION_LOCATION', 'JERA_ALLOCATION_QUEUE',
  'JERA_ALLOCATION_WORKER_URL', 'JERA_ALLOCATION_WORKER_AUDIENCE',
  'JERA_ALLOCATION_TASK_INVOKER_EMAIL', 'JERA_ALLOCATION_LEASE_BUCKET',
]
const EXPECTED_HEADERS = {
  JERA_PAYMENT_DETAIL_CACHE: ['detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash', 'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated'],
  JERA_PAYMENT_DETAIL_LINES: ['detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang'],
  JERA_ALLOCATION_COVERAGE: [
    'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
    'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
    'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
    'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
  ],
}

export async function runFinanceRuntimeCheck(args, options = {}) {
  const parsed = parseArguments(args)
  const io = options.io ?? { stdout: process.stdout }
  if (parsed.help) {
    io.stdout.write('Usage: check-finance-report-runtime --allow-readonly-production --project <id> --service <name> --region <region> --expected-finance-viewers 3 --expected-stage=DISABLED|ALLOCATION|READY [stage expected bindings]\n')
    return 0
  }
  const report = await inspectFinanceRuntime(parsed, options)
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.stageReady ? 0 : 1
}

export async function inspectFinanceRuntime(input, options = {}) {
  const execute = options.execute ?? runExternal
  const now = validNow(options.now?.() ?? new Date())
  const service = await safeJson(execute, ['gcloud', 'run', 'services', 'describe', input.service, '--region', input.region, '--project', input.project, '--format=json'])
  const environment = deployedEnvironment(service)
  const queueName = safeResource(environment.JERA_ALLOCATION_QUEUE)
  const bucketName = safeResource(environment.JERA_ALLOCATION_LEASE_BUCKET)
  const commandResults = await Promise.all([
    queueName ? safeJson(execute, ['gcloud', 'tasks', 'queues', 'describe', queueName, '--location', input.region, '--project', input.project, '--format=json']) : null,
    queueName ? safeJson(execute, ['gcloud', 'tasks', 'queues', 'get-iam-policy', queueName, '--location', input.region, '--project', input.project, '--format=json']) : null,
    safeJson(execute, ['gcloud', 'run', 'services', 'get-iam-policy', input.service, '--region', input.region, '--project', input.project, '--format=json']),
    safeJson(execute, ['gcloud', 'scheduler', 'jobs', 'list', '--location', input.region, '--project', input.project, '--format=json']),
    queueName ? safeJson(execute, ['gcloud', 'tasks', 'list', '--queue', queueName, '--location', input.region, '--project', input.project, '--format=json']) : null,
    bucketName ? safeJson(execute, ['gcloud', 'storage', 'buckets', 'describe', `gs://${bucketName}`, '--project', input.project, '--format=json']) : null,
    bucketName ? safeJson(execute, ['gcloud', 'storage', 'buckets', 'get-iam-policy', `gs://${bucketName}`, '--project', input.project, '--format=json']) : null,
  ])
  const [queue, queueIam, runIam, schedulerJobs, tasks, bucket, bucketIam] = commandResults
  let googleState = null
  try {
    googleState = await (options.readGoogleState ?? readGoogleState)({ environment, now })
  } catch { googleState = null }

  const cloudRun = cloudRunReport(service)
  const flags = {
    financeReportsEnabled: environment.PMC_FINANCE_REPORTS_ENABLED === 'true',
    revenueAllocationEnabled: environment.JERA_REVENUE_ALLOCATION_ENABLED === 'true',
    categoryMoneyEnabled: environment.JERA_FINANCE_CATEGORY_MONEY_ENABLED === 'true',
  }
  const allocationConfig = {
    requiredNameCount: REQUIRED_ALLOCATION_NAMES.length,
    presentNameCount: REQUIRED_ALLOCATION_NAMES.filter((name) => Boolean(environment[name]?.trim())).length,
    leaseBucketPresent: Boolean(bucketName && bucket),
    approvedProject: input.project === APPROVED_FINANCE_PROJECT,
    approvedRegion: input.region === APPROVED_REGION,
    projectMatches: environment.JERA_ALLOCATION_PROJECT_ID === input.project,
    locationMatches: environment.JERA_ALLOCATION_LOCATION === input.region,
    queueMatches: input.expectedQueue !== null && environment.JERA_ALLOCATION_QUEUE === input.expectedQueue,
    workerAudienceMatches: input.expectedWorkerAudience !== null
      && normalizedOrigin(environment.JERA_ALLOCATION_WORKER_AUDIENCE) === input.expectedWorkerAudience,
    workerUrlMatches: input.expectedWorkerAudience !== null
      && exactHttpsUrl(environment.JERA_ALLOCATION_WORKER_URL) === `${input.expectedWorkerAudience}${ALLOCATION_WORKER_PATH}`,
    invokerMatches: input.expectedInvoker !== null
      && safeEmail(environment.JERA_ALLOCATION_TASK_INVOKER_EMAIL) === input.expectedInvoker,
  }
  allocationConfig.exactExpectedConfig = allocationConfig.approvedProject && allocationConfig.approvedRegion
    && allocationConfig.projectMatches && allocationConfig.locationMatches && allocationConfig.queueMatches
    && allocationConfig.workerAudienceMatches && allocationConfig.workerUrlMatches && allocationConfig.invokerMatches
  const queueReport = {
    present: queue !== null, running: queue?.state === 'RUNNING',
    maxConcurrentDispatches: safeNonnegative(queue?.rateLimits?.maxConcurrentDispatches),
    maxDispatchesPerSecond: safeRate(queue?.rateLimits?.maxDispatchesPerSecond),
    leaseBucketLocationMatches: typeof bucket?.location === 'string'
      && bucket.location.toLowerCase() === input.region.toLowerCase(),
  }
  const runtimeIdentity = serviceAccountMember(service?.spec?.template?.spec?.serviceAccountName)
  const invokerEmail = safeEmail(environment.JERA_ALLOCATION_TASK_INVOKER_EMAIL)
  const invokerIdentity = invokerEmail ? `serviceAccount:${invokerEmail}` : null
  const bindings = {
    queueEnqueuerPresent: hasBinding(queueIam, 'roles/cloudtasks.enqueuer', runtimeIdentity),
    oidcInvokerPresent: hasBinding(runIam, 'roles/run.invoker', invokerIdentity),
    leaseBucketObjectUserPresent: hasBinding(bucketIam, 'roles/storage.objectUser', runtimeIdentity),
  }
  const scheduler = schedulerReport(schedulerJobs, {
    seedUrl: input.expectedFinanceSeedUrl, oidcAudience: input.expectedOidcAudience,
    invoker: input.expectedInvoker,
  })
  const taskReport = tasksReport(tasks)
  const tabs = tabsReport(googleState?.tabHeaders)
  const financePermissions = permissionReport(googleState?.staffRows, input.expectedFinanceViewers)
  const leases = leaseReport(googleState?.coverageRows, now)
  const infrastructureReady = cloudRun.servicePresent
    && allocationConfig.presentNameCount === allocationConfig.requiredNameCount && allocationConfig.leaseBucketPresent
    && allocationConfig.exactExpectedConfig
    && queueReport.present && queueReport.running && queueReport.maxConcurrentDispatches === 1
    && queueReport.maxDispatchesPerSecond === 0.016 && queueReport.leaseBucketLocationMatches
    && Object.values(bindings).every(Boolean)
    && taskReport.invalidPayloadCount === 0 && tabs.exactHeaderCount === tabs.requiredHeaderCount
    && financePermissions.activeViewerCount === input.expectedFinanceViewers && financePermissions.nameBasedDerivationCount === 0
    && leases.olderThan15MinutesCount === 0
  const expectedFlags = stageFlags(input.expectedStage)
  const flagsMatch = flags.financeReportsEnabled === expectedFlags.financeReportsEnabled
    && flags.revenueAllocationEnabled === expectedFlags.revenueAllocationEnabled
    && flags.categoryMoneyEnabled === expectedFlags.categoryMoneyEnabled
  const stageReady = input.expectedStage === 'DISABLED'
    ? cloudRun.servicePresent && flagsMatch && scheduler.enabledJobCount === 0
    : input.expectedStage === 'ALLOCATION'
      ? flagsMatch && infrastructureReady && cloudRun.latestReadyHasNoTraffic && scheduler.enabledJobCount === 0
      : flagsMatch && infrastructureReady && cloudRun.latestReadyHasNoTraffic && scheduler.readyMatchCount === 1
  return {
    mode: 'READ_ONLY', expectedStage: input.expectedStage, stageReady, ready: stageReady,
    safeCode: stageReady ? null : 'FINANCE_RUNTIME_INCOMPLETE', cloudRun, flags,
    allocationConfig, queue: queueReport, bindings, scheduler, tasks: taskReport, tabs, financePermissions, leases,
  }
}

function parseArguments(args) {
  assertNoSensitiveFlags(args)
  const parsed = {
    help: false, allowReadonlyProduction: false, project: null, service: null, region: null,
    expectedFinanceViewers: null, expectedStage: null, expectedQueue: null,
    expectedWorkerAudience: null, expectedInvoker: null,
    expectedFinanceSeedUrl: null, expectedOidcAudience: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--allow-readonly-production') parsed.allowReadonlyProduction = true
    else if (value === '--project' && parsed.project === null && args[index + 1]) parsed.project = args[++index]
    else if (value === '--service' && parsed.service === null && args[index + 1]) parsed.service = args[++index]
    else if (value === '--region' && parsed.region === null && args[index + 1]) parsed.region = args[++index]
    else if (value === '--expected-finance-viewers' && parsed.expectedFinanceViewers === null && args[index + 1]) parsed.expectedFinanceViewers = Number(args[++index])
    else if (value.startsWith('--expected-stage=') && parsed.expectedStage === null) parsed.expectedStage = value.slice('--expected-stage='.length)
    else if (value === '--expected-queue' && parsed.expectedQueue === null && args[index + 1]) parsed.expectedQueue = args[++index]
    else if (value === '--expected-worker-audience' && parsed.expectedWorkerAudience === null && args[index + 1]) parsed.expectedWorkerAudience = args[++index]
    else if (value === '--expected-invoker' && parsed.expectedInvoker === null && args[index + 1]) parsed.expectedInvoker = args[++index]
    else if (value === '--expected-finance-seed-url' && parsed.expectedFinanceSeedUrl === null && args[index + 1]) parsed.expectedFinanceSeedUrl = args[++index]
    else if (value === '--expected-oidc-audience' && parsed.expectedOidcAudience === null && args[index + 1]) parsed.expectedOidcAudience = args[++index]
    else throw new Error('Unknown finance operator argument')
  }
  if (parsed.help) return parsed
  if (!parsed.allowReadonlyProduction) throw new Error('Explicit read-only production approval is required')
  parsed.project = safeProject(parsed.project)
  if (!safeToken(parsed.service) || !safeToken(parsed.region)) throw new Error('Project, service, and region are required')
  if (parsed.expectedFinanceViewers !== 3) throw new Error('Expected finance viewers must be exactly 3')
  if (!STAGES.has(parsed.expectedStage)) throw new Error('Expected stage must be DISABLED, ALLOCATION, or READY')
  if (parsed.expectedStage !== 'DISABLED') {
    if (!safeResource(parsed.expectedQueue) || !normalizedOrigin(parsed.expectedWorkerAudience) || !safeEmail(parsed.expectedInvoker)) {
      throw new Error('Allocation stage expected bindings are required')
    }
    parsed.expectedWorkerAudience = normalizedOrigin(parsed.expectedWorkerAudience)
  }
  if (parsed.expectedStage === 'READY') {
    if (!exactHttpsUrl(parsed.expectedFinanceSeedUrl) || safePath(parsed.expectedFinanceSeedUrl) !== FINANCE_SEED_PATH
      || !normalizedOrigin(parsed.expectedOidcAudience)) throw new Error('Ready stage expected Scheduler bindings are required')
    parsed.expectedFinanceSeedUrl = exactHttpsUrl(parsed.expectedFinanceSeedUrl)
    parsed.expectedOidcAudience = normalizedOrigin(parsed.expectedOidcAudience)
  }
  return parsed
}

async function readGoogleState({ environment }) {
  const spreadsheetId = requiredOpaque(environment.PMC_SPREADSHEET_ID)
  const intakeFolderId = requiredOpaque(environment.PMC_DRIVE_INTAKE_FOLDER_ID)
  const [{ createMiniAppGooglePorts }, setup] = await Promise.all([
    import('../dist-server/server/pmc-mini-app/googleClient.js'), import('../dist-server/server/pmc-mini-app/setup.js'),
  ])
  const sheets = createMiniAppGooglePorts({ spreadsheetId, intakeFolderId }).sheets
  const headerTabs = Object.keys(EXPECTED_HEADERS)
  const ranges = [...headerTabs.map((tab) => `'${tab}'!1:1`), "'CONFIG_STAFF'!A2:L", "'JERA_ALLOCATION_COVERAGE'!A2:R"]
  const values = await sheets.batchGet(spreadsheetId, ranges)
  const tabHeaders = Object.fromEntries(headerTabs.map((tab) => [`${tab}`, (values[`'${tab}'!1:1`]?.[0] ?? []).map(String)]))
  const staffRows = (values["'CONFIG_STAFF'!A2:L"] ?? []).map((row) => ({
    id: text(row[0]), name: text(row[1]), lineUserId: text(row[3]), active: bool(row[6]), canViewFinance: bool(row[10]),
  }))
  const coverageRows = (values["'JERA_ALLOCATION_COVERAGE'!A2:R"] ?? []).map((row) => ({
    lastAttemptAt: text(row[13]), leaseOwner: text(row[16]), leaseExpiresAt: text(row[17]),
  }))
  void setup
  return { tabHeaders, staffRows, coverageRows }
}

function cloudRunReport(service) {
  const traffic = Array.isArray(service?.status?.traffic) ? service.status.traffic : []
  const latestReadyRevisionName = typeof service?.status?.latestReadyRevisionName === 'string'
    ? service.status.latestReadyRevisionName : null
  const latestReadyTrafficPercent = latestReadyRevisionName === null ? 0 : traffic
    .filter((item) => item?.revisionName === latestReadyRevisionName)
    .reduce((total, item) => total + safeNonnegative(item?.percent), 0)
  return {
    servicePresent: service !== null,
    latestReadyRevisionPresent: latestReadyRevisionName !== null,
    latestReadyHasNoTraffic: latestReadyRevisionName !== null && latestReadyTrafficPercent === 0,
    latestReadyTrafficPercent,
    trafficPercentTotal: traffic.reduce((total, item) => total + safeNonnegative(item?.percent), 0),
    trafficTargetCount: traffic.length,
  }
}
function schedulerReport(value, expected) {
  const allJobs = Array.isArray(value) ? value : []
  const jobs = allJobs.filter((job) => safePath(job?.httpTarget?.uri) === FINANCE_SEED_PATH)
  const enabled = jobs.filter((job) => job?.state === 'ENABLED')
  const matching = enabled.filter((job) => exactHttpsUrl(job?.httpTarget?.uri) === expected.seedUrl)
  const post = matching.filter((job) => job?.httpTarget?.httpMethod === 'POST')
  const audience = post.filter((job) => normalizedOrigin(job?.httpTarget?.oidcToken?.audience) === expected.oidcAudience)
  const invoker = audience.filter((job) => safeEmail(job?.httpTarget?.oidcToken?.serviceAccountEmail) === expected.invoker)
  const ready = invoker.filter((job) => job?.schedule === '15 2 * * *' && job?.timeZone === 'Asia/Bangkok')
  return {
    matchingJobCount: jobs.length, enabledJobCount: enabled.length,
    exactTarget: matching.length === 1, postMethod: post.length === 1,
    oidcAudienceMatches: audience.length === 1, oidcInvokerMatches: invoker.length === 1,
    oidcBindingPresent: invoker.length === 1, readyMatchCount: ready.length,
  }
}
function tasksReport(value) {
  const tasks = Array.isArray(value) ? value : []
  let validMetadataHashCount = 0; let validAttemptCount = 0; let invalidPayloadCount = 0
  for (const task of tasks) {
    const body = taskBody(task?.httpRequest?.body)
    const metadataValid = typeof body?.metadataSnapshotHash === 'string' && /^[a-f0-9]{64}$/.test(body.metadataSnapshotHash)
    const attemptValid = Number.isSafeInteger(body?.attempt) && body.attempt >= 0 && body.attempt <= 1_000_000
    if (metadataValid) validMetadataHashCount += 1
    if (attemptValid) validAttemptCount += 1
    if (!metadataValid || !attemptValid) invalidPayloadCount += 1
  }
  return { pendingCount: tasks.length, validMetadataHashCount, validAttemptCount, invalidPayloadCount }
}
function tabsReport(value) {
  const headers = value && typeof value === 'object' ? value : {}
  const exactHeaderCount = Object.entries(EXPECTED_HEADERS).filter(([tab, expected]) => same(headers[tab], expected)).length
  return { exactHeaderCount, requiredHeaderCount: Object.keys(EXPECTED_HEADERS).length }
}
function permissionReport(value, expectedCount) {
  const rows = Array.isArray(value) ? value : []
  const viewers = rows.filter((row) => row?.active === true && row?.canViewFinance === true)
  const safeViewers = viewers.flatMap((row) => safeStaffId(row?.id) && safeName(row?.name) ? [{ staffId: row.id, name: row.name }] : [])
  return {
    expectedCount, activeViewerCount: viewers.length,
    nameBasedDerivationCount: viewers.length - safeViewers.length,
    viewers: safeViewers,
  }
}
function leaseReport(value, now) {
  const rows = Array.isArray(value) ? value : []
  const active = rows.flatMap((row) => {
    const expires = Date.parse(row?.leaseExpiresAt); const attempted = Date.parse(row?.lastAttemptAt)
    return safeToken(row?.leaseOwner) && Number.isFinite(expires) && expires > now.getTime() && Number.isFinite(attempted)
      ? [{ ageSeconds: Math.max(0, Math.floor((now.getTime() - attempted) / 1_000)) }] : []
  })
  return {
    activeCount: active.length,
    olderThan15MinutesCount: active.filter(({ ageSeconds }) => ageSeconds > 900).length,
    oldestActiveAgeSeconds: active.length ? Math.max(...active.map(({ ageSeconds }) => ageSeconds)) : 0,
  }
}

function deployedEnvironment(service) {
  const containers = service?.spec?.template?.spec?.containers
  const entries = Array.isArray(containers) ? containers.flatMap((container) => Array.isArray(container?.env) ? container.env : []) : []
  return Object.fromEntries(entries.flatMap((entry) => typeof entry?.name === 'string' && typeof entry?.value === 'string' ? [[entry.name, entry.value]] : []))
}
function hasBinding(policy, role, member) { return Boolean(member) && Array.isArray(policy?.bindings) && policy.bindings.some((binding) => binding?.role === role && Array.isArray(binding.members) && binding.members.includes(member)) }
function serviceAccountMember(value) { const email = safeEmail(value); return email ? `serviceAccount:${email}` : null }
function safeEmail(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,62}@[a-z0-9-]{3,63}\.iam\.gserviceaccount\.com$/i.test(value) ? value : null }
function safeResource(value) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(value) ? value : null }
function safeToken(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value) }
function safeStaffId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) }
function safeName(value) { return typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\r\n]/.test(value) }
function safePath(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.pathname : null } catch { return null } }
function exactHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      ? url.toString().replace(/\/$/, '') : null
  } catch { return null }
}
function normalizedOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === '/' || url.pathname === '') ? url.origin : null
  } catch { return null }
}
function stageFlags(stage) {
  if (stage === 'DISABLED') return { financeReportsEnabled: false, revenueAllocationEnabled: false, categoryMoneyEnabled: false }
  if (stage === 'ALLOCATION') return { financeReportsEnabled: false, revenueAllocationEnabled: true, categoryMoneyEnabled: false }
  return { financeReportsEnabled: true, revenueAllocationEnabled: true, categoryMoneyEnabled: true }
}
function taskBody(value) { try { const textValue = Buffer.from(value ?? '', 'base64').toString('utf8'); return JSON.parse(textValue) } catch { return null } }
function safeNonnegative(value) { return Number.isFinite(value) && value >= 0 ? Number(value) : 0 }
function safeRate(value) { return Number.isFinite(value) && value >= 0 && value <= 1000 ? Number(value) : 0 }
function same(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]) }
function requiredOpaque(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error('invalid'); return value }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function bool(value) { return value === true || typeof value === 'string' && value.trim().toUpperCase() === 'TRUE' }
function validNow(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : new Date(0) }
async function safeJson(execute, command) { try { return JSON.parse(await execute(command)) } catch { return null } }
async function runExternal(command) { const { stdout } = await executeFile(command[0], command.slice(1), { maxBuffer: 2_000_000 }); return stdout }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFinanceRuntimeCheck(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    const message = error instanceof Error && /^(Explicit|Unknown|Sensitive|Expected|Project|Allocation|Ready)/.test(error.message)
      ? error.message : 'Finance runtime check failed'
    process.stderr.write(`${message}\n`); process.exitCode = 2
  })
}
