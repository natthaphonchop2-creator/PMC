import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const BOOKING_PERFORMANCE_FAILURES = Object.freeze([
  'INSUFFICIENT_SUCCESS_RUNS',
  'ASYNC_PREPARE_P95',
  'SYNC_PREPARE_MEDIAN_REDUCTION',
  'ASYNC_CONFIRM_P95',
  'UNAVAILABLE_ROUTE_PROBE',
  'MAX_FIXTURE_FAILURE',
  'CONCURRENCY_DUPLICATE',
])

export const BOOKING_PERFORMANCE_FIXTURE_SPECS = Object.freeze([
  Object.freeze({ label: 'payment-chat-2x500kb', paymentFiles: 1, chatFiles: 1, fileBytes: 500_000, totalDecodedBytes: 1_000_000, expected: 'SUCCESS' }),
  Object.freeze({ label: 'five-files-2mb', paymentFiles: 3, chatFiles: 2, fileBytes: 2_000_000, totalDecodedBytes: 10_000_000, expected: 'SUCCESS' }),
  Object.freeze({ label: 'twenty-files-max25mb', paymentFiles: 10, chatFiles: 10, fileBytes: 1_250_000, totalDecodedBytes: 25_000_000, expected: 'SUCCESS' }),
  Object.freeze({ label: 'chunk-overflow', rawMultipartBytes: 26_000_001, expected: 'EVIDENCE_BATCH_TOO_LARGE' }),
  Object.freeze({ label: 'invalid-mime', mimeType: 'application/octet-stream', expected: 'UNSUPPORTED_EVIDENCE' }),
  Object.freeze({ label: 'partial-failure', failAfterPersistedFiles: 2, expected: 'RETRY_WITHOUT_DUPLICATE' }),
  Object.freeze({ label: 'response-loss', loseResponseAfterApply: true, expected: 'IDEMPOTENT_RECOVERY' }),
])

export const BOOKING_PERFORMANCE_FIXTURES = Object.freeze(
  BOOKING_PERFORMANCE_FIXTURE_SPECS.map(({ label }) => label),
)

const PATHS = Object.freeze([
  ['asyncPreparePostParse', 'prepare', 200],
  ['syncPrepare', 'prepare', 200],
  ['legacySyncPrepare', 'prepare', 200],
  ['asyncConfirm', 'confirm', 202],
])
const HELP = `PMC Booking performance measurement

Offline commands:
  node scripts/measure-pmc-booking-performance.mjs --help
  node scripts/measure-pmc-booking-performance.mjs --evaluate <aggregate.json>

Owner-gated live command (never implied by --help/--evaluate):
  PMC_BOOKING_PERFORMANCE_OWNER_GATE=APPROVED PMC_BOOKING_PERFORMANCE_REVISION=<revision> \\
    node scripts/measure-pmc-booking-performance.mjs \\
    --live --owner-approved --runner <reviewed-runner.mjs> --output <new-aggregate.json>

Live design: one discarded warm-up plus 30 retained runs for each path,
the seven bounded fixtures, then five concurrent clients. Output is aggregate-only.
`

export function evaluateBookingPerformanceBudget(value) {
  const aggregate = parseAggregate(value)
  const failures = []
  if (PATHS.some(([key]) => aggregate.paths[key].count < 30)) failures.push('INSUFFICIENT_SUCCESS_RUNS')
  if (aggregate.paths.asyncPreparePostParse.p95Ms > 3_000) failures.push('ASYNC_PREPARE_P95')
  if (aggregate.paths.syncPrepare.p50Ms > aggregate.paths.legacySyncPrepare.p50Ms * 0.70) {
    failures.push('SYNC_PREPARE_MEDIAN_REDUCTION')
  }
  if (aggregate.paths.asyncConfirm.p95Ms > 6_000) failures.push('ASYNC_CONFIRM_P95')
  if (aggregate.checks.unavailableRouteProbeCount !== 0) failures.push('UNAVAILABLE_ROUTE_PROBE')
  if (aggregate.checks.maximumFixtureFailures !== 0) failures.push('MAX_FIXTURE_FAILURE')
  if (aggregate.checks.concurrencyDuplicateCount !== 0) failures.push('CONCURRENCY_DUPLICATE')
  return { pass: failures.length === 0, failures }
}

export async function measureBookingPerformance(runner, options) {
  requireRunner(runner)
  if (!plainRecord(options) || !safeLabel(options.revision) || typeof options.now !== 'function') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_OPTIONS')
  }
  const measuredAt = options.now()
  if (!(measuredAt instanceof Date) || !Number.isFinite(measuredAt.getTime())) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_OPTIONS')
  }

  const paths = {}
  let maximumFixtureFailures = 0
  let unavailableRouteProbeCount = 0
  for (const [path, route, expectedStatus] of PATHS) {
    const samples = []
    for (let iteration = 0; iteration < 31; iteration += 1) {
      const result = await runner.runPath(path, iteration, iteration === 0)
      const safe = parseRunResult(result)
      unavailableRouteProbeCount += safe.unavailableRouteProbeCount
      maximumFixtureFailures += safe.fixtureFailures
      if (iteration > 0 && safe.status === expectedStatus) samples.push(safe.elapsedMs)
    }
    paths[path] = metric(route, expectedStatus, samples)
  }

  for (const fixture of BOOKING_PERFORMANCE_FIXTURE_SPECS) {
    const result = parseFixtureResult(await runner.runFixture(fixture))
    if (!result.passed) maximumFixtureFailures += 1
    maximumFixtureFailures += result.fixtureFailures
    unavailableRouteProbeCount += result.unavailableRouteProbeCount
  }

  const concurrent = await Promise.all(Array.from({ length: 5 }, (_unused, client) => runner.runConcurrent(client)))
  let concurrencyDuplicateCount = 0
  for (const result of concurrent) {
    const safe = parseConcurrentResult(result)
    if (safe.status !== 202) maximumFixtureFailures += 1
    concurrencyDuplicateCount += safe.duplicateCount
    unavailableRouteProbeCount += safe.unavailableRouteProbeCount
  }

  return parseAggregate({
    schemaVersion: 1,
    revision: options.revision,
    measuredAtUtc: measuredAt.toISOString(),
    measuredAtBangkok: bangkokTimestamp(measuredAt),
    fixtureLabel: 'booking-performance-v1',
    paths,
    checks: {
      unavailableRouteProbeCount,
      maximumFixtureFailures,
      concurrencyClients: 5,
      concurrencyDuplicateCount,
    },
  })
}

export async function runBookingPerformanceCli(argv, dependencies = {}) {
  const write = dependencies.write ?? ((line) => process.stdout.write(`${line}\n`))
  const read = dependencies.readFile ?? ((path) => readFile(path, 'utf8'))
  const save = dependencies.writeFile ?? ((path, value) => writeFile(path, value, { encoding: 'utf8', flag: 'wx' }))
  const importRunner = dependencies.importRunner ?? ((specifier) => import(pathToFileURL(specifier).href))
  const environment = dependencies.environment ?? process.env

  if (argv.length === 1 && argv[0] === '--help') {
    write(HELP.trimEnd())
    return 0
  }
  if (argv.length === 2 && argv[0] === '--evaluate') {
    try {
      const aggregate = JSON.parse(await read(argv[1]))
      const result = evaluateBookingPerformanceBudget(aggregate)
      write(JSON.stringify(result))
      return result.pass ? 0 : 1
    } catch {
      write(JSON.stringify({ pass: false, error: 'INVALID_BOOKING_PERFORMANCE_AGGREGATE' }))
      return 2
    }
  }
  if (argv.includes('--live')) {
    const gate = argv.includes('--owner-approved') && environment.PMC_BOOKING_PERFORMANCE_OWNER_GATE === 'APPROVED'
    const runnerPath = optionValue(argv, '--runner')
    const outputPath = optionValue(argv, '--output')
    const revision = environment.PMC_BOOKING_PERFORMANCE_REVISION
    if (!gate || !runnerPath || !outputPath || !safeLabel(revision) || unknownLiveArgument(argv)) {
      write(JSON.stringify({ pass: false, error: 'LIVE_OWNER_GATE_REQUIRED' }))
      return 2
    }
    try {
      const module = await importRunner(runnerPath)
      if (!module || typeof module.createBookingPerformanceRunner !== 'function') throw new Error('invalid runner')
      const runner = await module.createBookingPerformanceRunner({ environment })
      const aggregate = await measureBookingPerformance(runner, {
        revision,
        now: () => new Date(),
      })
      const result = evaluateBookingPerformanceBudget(aggregate)
      await save(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`)
      write(JSON.stringify(result))
      return result.pass ? 0 : 1
    } catch {
      write(JSON.stringify({ pass: false, error: 'LIVE_MEASUREMENT_FAILED' }))
      return 2
    }
  }

  write(JSON.stringify({ pass: false, error: 'INVALID_ARGUMENTS' }))
  return 2
}

function parseAggregate(value) {
  if (!plainRecord(value) || exactKeys(value) !== 'checks,fixtureLabel,measuredAtBangkok,measuredAtUtc,paths,revision,schemaVersion') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  if (value.schemaVersion !== 1 || !safeLabel(value.revision) || value.fixtureLabel !== 'booking-performance-v1') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  if (!utcTimestamp(value.measuredAtUtc) || !bangkokTimestampValue(value.measuredAtBangkok)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  if (!plainRecord(value.paths) || exactKeys(value.paths) !== 'asyncConfirm,asyncPreparePostParse,legacySyncPrepare,syncPrepare') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  const paths = {}
  for (const [path, route, status] of PATHS) paths[path] = parseMetric(value.paths[path], route, status)
  const checks = parseChecks(value.checks)
  return {
    schemaVersion: 1,
    revision: value.revision,
    measuredAtUtc: value.measuredAtUtc,
    measuredAtBangkok: value.measuredAtBangkok,
    fixtureLabel: value.fixtureLabel,
    paths,
    checks,
  }
}

function parseMetric(value, route, status) {
  if (!plainRecord(value) || exactKeys(value) !== 'count,maxMs,p50Ms,p95Ms,route,status'
    || value.route !== route || value.status !== status || !safeInteger(value.count, 0, 1_000)
    || !safeDuration(value.p50Ms) || !safeDuration(value.p95Ms) || !safeDuration(value.maxMs)
    || value.p50Ms > value.p95Ms || value.p95Ms > value.maxMs) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  return { route, status, count: value.count, p50Ms: value.p50Ms, p95Ms: value.p95Ms, maxMs: value.maxMs }
}

function parseChecks(value) {
  if (!plainRecord(value)
    || exactKeys(value) !== 'concurrencyClients,concurrencyDuplicateCount,maximumFixtureFailures,unavailableRouteProbeCount'
    || !safeInteger(value.unavailableRouteProbeCount, 0, 1_000)
    || !safeInteger(value.maximumFixtureFailures, 0, 1_000)
    || value.concurrencyClients !== 5
    || !safeInteger(value.concurrencyDuplicateCount, 0, 1_000)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  }
  return {
    unavailableRouteProbeCount: value.unavailableRouteProbeCount,
    maximumFixtureFailures: value.maximumFixtureFailures,
    concurrencyClients: 5,
    concurrencyDuplicateCount: value.concurrencyDuplicateCount,
  }
}

function requireRunner(runner) {
  if (!runner || typeof runner.runPath !== 'function' || typeof runner.runFixture !== 'function'
    || typeof runner.runConcurrent !== 'function') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RUNNER')
  }
}

function parseRunResult(value) {
  if (!plainRecord(value) || !allowedKeys(value, ['status', 'elapsedMs', 'unavailableRouteProbeCount', 'fixtureFailures'])
    || !safeStatus(value.status) || !safeDuration(value.elapsedMs)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  return {
    status: value.status,
    elapsedMs: value.elapsedMs,
    unavailableRouteProbeCount: optionalCount(value.unavailableRouteProbeCount),
    fixtureFailures: optionalCount(value.fixtureFailures),
  }
}

function parseFixtureResult(value) {
  if (!plainRecord(value) || !allowedKeys(value, ['passed', 'unavailableRouteProbeCount', 'fixtureFailures'])
    || typeof value.passed !== 'boolean') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  return {
    passed: value.passed,
    unavailableRouteProbeCount: optionalCount(value.unavailableRouteProbeCount),
    fixtureFailures: optionalCount(value.fixtureFailures),
  }
}

function parseConcurrentResult(value) {
  if (!plainRecord(value) || !allowedKeys(value, ['status', 'duplicateCount', 'unavailableRouteProbeCount'])
    || !safeStatus(value.status) || !safeInteger(value.duplicateCount, 0, 1_000)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  return {
    status: value.status,
    duplicateCount: value.duplicateCount,
    unavailableRouteProbeCount: optionalCount(value.unavailableRouteProbeCount),
  }
}

function optionalCount(value) {
  if (value === undefined) return 0
  if (!safeInteger(value, 0, 1_000)) throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  return value
}

function metric(route, status, samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    route,
    status,
    count: sorted.length,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  }
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}

function bangkokTimestamp(date) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1_000)
  return `${shifted.toISOString().slice(0, 19)}+07:00`
}

function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  return new Date(value).toISOString() === value
}

function bangkokTimestampValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/.test(value)) return false
  return Number.isFinite(Date.parse(value))
}

function safeLabel(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value)
}

function safeDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000
}

function safeStatus(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599
}

function safeInteger(value, minimum, maximum) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value) {
  return Object.keys(value).sort().join(',')
}

function allowedKeys(value, allowed) {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function optionValue(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--') ? argv[index + 1] : null
}

function unknownLiveArgument(argv) {
  const allowedFlags = new Set(['--live', '--owner-approved', '--runner', '--output'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!allowedFlags.has(argument)) continue
    if (argument === '--runner' || argument === '--output') index += 1
  }
  const consumed = new Set(['--live', '--owner-approved'])
  const runner = optionValue(argv, '--runner')
  const output = optionValue(argv, '--output')
  if (runner) consumed.add(runner)
  if (output) consumed.add(output)
  consumed.add('--runner')
  consumed.add('--output')
  return argv.some((argument) => !consumed.has(argument))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runBookingPerformanceCli(process.argv.slice(2))
}
