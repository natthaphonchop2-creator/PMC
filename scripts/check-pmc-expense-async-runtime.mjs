#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const EXPENSE_ASYNC_BINDING_NAMES = [
  'PMC_EXPENSE_ASYNC_ENABLED',
  'PMC_EXPENSE_ASYNC_JOB_BUCKET',
  'PMC_EXPENSE_ASYNC_QUEUE',
  'PMC_EXPENSE_ASYNC_WORKER_URL',
  'PMC_EXPENSE_ASYNC_WORKER_AUDIENCE',
  'PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL',
  'PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS',
]

const SOURCE_CHECKS = ['service', 'worker', 'queue', 'bucket', 'bindings']
const TOP_LEVEL_KEYS = ['provenance', 'service', 'queue', 'bucket', 'flag', 'bindingNames']
const PROVENANCE_KEYS = ['schemaVersion', 'profile', 'target', 'environment', 'collectedAt', 'sourceChecks']
const SERVICE_KEYS = ['healthStatus', 'workerUnauthorizedStatus']
const QUEUE_KEYS = [
  'name', 'state', 'taskCount', 'maxAttempts', 'minBackoffSeconds', 'maxBackoffSeconds',
  'maxRetryDurationSeconds', 'maxConcurrentDispatches', 'maxDispatchesPerSecond',
]
const BUCKET_KEYS = [
  'name', 'location', 'uniformBucketLevelAccess', 'publicAccessPrevention', 'lifecycleDeleteDays',
]

export function inspectPmcExpenseAsyncRuntime(snapshot, options = {}) {
  const source = isRecord(snapshot) ? snapshot : {}
  const snapshotSchema = inspectSnapshotSchema(source)
  if (!snapshotSchema.safe) return { mode: 'READ_ONLY', ready: false, snapshotSchema }

  const now = validDate(options.now?.() ?? new Date())
  const collectedAt = Date.parse(source.provenance.collectedAt)
  const ageSeconds = Number.isFinite(collectedAt) ? Math.floor((now.getTime() - collectedAt) / 1_000) : -1
  const maxAgeSeconds = validMaxAge(options.maxAgeSeconds)
  const sourceCheckCount = SOURCE_CHECKS.filter((name) => source.provenance.sourceChecks[name] === true).length
  const targetMatches = validLabel(options.expectedTarget) && source.provenance.target === options.expectedTarget
  const environmentMatches = validLabel(options.expectedEnvironment)
    && source.provenance.environment === options.expectedEnvironment
  const provenance = {
    ready: false,
    ageSeconds,
    maxAgeSeconds,
    sourceCheckCount,
    requiredSourceCheckCount: SOURCE_CHECKS.length,
    targetMatches: Boolean(targetMatches),
    environmentMatches: Boolean(environmentMatches),
  }
  provenance.ready = source.provenance.schemaVersion === 1
    && source.provenance.profile === 'DISABLED_PREFLIGHT'
    && provenance.targetMatches
    && provenance.environmentMatches
    && ageSeconds >= 0
    && ageSeconds <= maxAgeSeconds
    && sourceCheckCount === SOURCE_CHECKS.length

  const service = {
    healthStatus: safeStatus(source.service.healthStatus),
    workerUnauthorizedStatus: safeStatus(source.service.workerUnauthorizedStatus),
    ready: false,
  }
  service.ready = service.healthStatus === 200 && service.workerUnauthorizedStatus === 401

  const queue = {
    state: source.queue.state === 'RUNNING' ? 'RUNNING' : 'NOT_RUNNING',
    taskCount: safeNonnegativeInteger(source.queue.taskCount),
    drained: source.queue.taskCount === 0,
    retryReady: source.queue.maxAttempts === 8
      && source.queue.minBackoffSeconds === 10
      && source.queue.maxBackoffSeconds === 300
      && source.queue.maxRetryDurationSeconds === 86_400
      && source.queue.maxConcurrentDispatches === 1
      && source.queue.maxDispatchesPerSecond === 2,
  }

  const bucket = {
    locationMatches: source.bucket.location === 'ASIA-SOUTHEAST1',
    uniformBucketLevelAccess: source.bucket.uniformBucketLevelAccess === true,
    publicAccessPrevention: source.bucket.publicAccessPrevention === true,
    lifecycleDeleteDays: safeNonnegativeInteger(source.bucket.lifecycleDeleteDays),
    ready: false,
  }
  bucket.ready = bucket.locationMatches && bucket.uniformBucketLevelAccess
    && bucket.publicAccessPrevention && bucket.lifecycleDeleteDays === 7

  const bindingSet = new Set(source.bindingNames)
  const presentCount = EXPENSE_ASYNC_BINDING_NAMES.filter((name) => bindingSet.has(name)).length
  const bindings = {
    presentCount,
    requiredCount: EXPENSE_ASYNC_BINDING_NAMES.length,
    coherent: source.bindingNames.length === EXPENSE_ASYNC_BINDING_NAMES.length
      && bindingSet.size === EXPENSE_ASYNC_BINDING_NAMES.length
      && presentCount === EXPENSE_ASYNC_BINDING_NAMES.length,
  }
  const flagValue = source.flag.PMC_EXPENSE_ASYNC_ENABLED
  const flag = { disabled: flagValue === 'false', explicit: flagValue === 'true' || flagValue === 'false' }
  const ready = provenance.ready && service.ready
    && queue.state === 'RUNNING' && queue.drained && queue.retryReady
    && bucket.ready && bindings.coherent && flag.disabled && flag.explicit

  return { mode: 'READ_ONLY', ready, snapshotSchema, provenance, service, queue, bucket, bindings, flag }
}

export async function runPmcExpenseAsyncRuntimeCheck(
  args,
  io = { stdout: process.stdout, stderr: process.stderr },
) {
  const parsed = parseArguments(args)
  if (parsed.help) {
    io.stdout.write('Usage: check-pmc-expense-async-runtime --snapshot-file <local-readonly-snapshot.json> --expected-target <name> --expected-environment <name> [--strict]\n')
    return 0
  }
  const contents = await readFile(parsed.snapshotFile, 'utf8')
  if (Buffer.byteLength(contents, 'utf8') > 1_000_000) throw new Error('Async expense snapshot is too large')
  const report = inspectPmcExpenseAsyncRuntime(JSON.parse(contents), {
    expectedTarget: parsed.expectedTarget,
    expectedEnvironment: parsed.expectedEnvironment,
    maxAgeSeconds: 900,
  })
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return parsed.strict && !report.ready ? 1 : 0
}

function inspectSnapshotSchema(source) {
  let safe = true
  let unknownKeyCount = 0
  const exact = (value, keys) => {
    if (!isRecord(value)) { safe = false; return }
    const actual = Object.keys(value)
    unknownKeyCount += actual.filter((key) => !keys.includes(key)).length
    if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) safe = false
  }
  exact(source, TOP_LEVEL_KEYS)
  exact(source.provenance, PROVENANCE_KEYS)
  exact(source.provenance?.sourceChecks, SOURCE_CHECKS)
  exact(source.service, SERVICE_KEYS)
  exact(source.queue, QUEUE_KEYS)
  exact(source.bucket, BUCKET_KEYS)
  exact(source.flag, ['PMC_EXPENSE_ASYNC_ENABLED'])

  if (source.provenance?.schemaVersion !== 1
    || typeof source.provenance?.profile !== 'string'
    || !validLabel(source.provenance?.target)
    || !validLabel(source.provenance?.environment)
    || typeof source.provenance?.collectedAt !== 'string'
    || !Number.isFinite(Date.parse(source.provenance?.collectedAt))
    || SOURCE_CHECKS.some((name) => typeof source.provenance?.sourceChecks?.[name] !== 'boolean')
    || !Number.isSafeInteger(source.service?.healthStatus)
    || !Number.isSafeInteger(source.service?.workerUnauthorizedStatus)
    || !validLabel(source.queue?.name)
    || typeof source.queue?.state !== 'string'
    || !QUEUE_KEYS.slice(2).every((key) => Number.isSafeInteger(source.queue?.[key]) && source.queue[key] >= 0)
    || !validLabel(source.bucket?.name)
    || source.bucket?.location !== 'ASIA-SOUTHEAST1'
    || typeof source.bucket?.uniformBucketLevelAccess !== 'boolean'
    || typeof source.bucket?.publicAccessPrevention !== 'boolean'
    || !Number.isSafeInteger(source.bucket?.lifecycleDeleteDays)
    || source.bucket.lifecycleDeleteDays < 0
    || typeof source.flag?.PMC_EXPENSE_ASYNC_ENABLED !== 'string'
    || !stringArray(source.bindingNames)) safe = false

  if (stringArray(source.bindingNames)) {
    const names = new Set(source.bindingNames)
    if (source.bindingNames.length !== EXPENSE_ASYNC_BINDING_NAMES.length
      || names.size !== EXPENSE_ASYNC_BINDING_NAMES.length
      || EXPENSE_ASYNC_BINDING_NAMES.some((name) => !names.has(name))) safe = false
  }
  return { safe: safe && unknownKeyCount === 0, unknownKeyCount }
}

function parseArguments(args) {
  const parsed = { snapshotFile: null, expectedTarget: null, expectedEnvironment: null, strict: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--strict') parsed.strict = true
    else if (value === '--snapshot-file' && !parsed.snapshotFile && args[index + 1]) parsed.snapshotFile = args[++index]
    else if (value === '--expected-target' && !parsed.expectedTarget && args[index + 1]) parsed.expectedTarget = args[++index]
    else if (value === '--expected-environment' && !parsed.expectedEnvironment && args[index + 1]) parsed.expectedEnvironment = args[++index]
    else throw new Error('Unknown async expense runtime-check argument')
  }
  if (!parsed.help && (!parsed.snapshotFile || !validLabel(parsed.expectedTarget) || !validLabel(parsed.expectedEnvironment))) {
    throw new Error('Async expense runtime check requires a local snapshot, target, and environment')
  }
  return parsed
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function stringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function validLabel(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) }
function validMaxAge(value) { return Number.isSafeInteger(value) && value >= 60 && value <= 900 ? value : 900 }
function validDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : new Date(0) }
function safeStatus(value) { return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : 0 }
function safeNonnegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0 }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPmcExpenseAsyncRuntimeCheck(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch(() => {
    process.stderr.write('Async expense runtime check failed\n')
    process.exitCode = 2
  })
}
