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
  freezeFixture(fixtureSpec('payment-chat-2x500kb', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'NONE' }, 200, 'SUCCESS')),
  freezeFixture(fixtureSpec('five-files-2mb', [fileProfile('PAYMENT', 3, 2_000_000, 'image/png', 'PNG'), fileProfile('CHAT', 2, 2_000_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'NONE' }, 200, 'SUCCESS')),
  freezeFixture(fixtureSpec('twenty-files-max25mb', [fileProfile('PAYMENT', 10, 1_250_000, 'image/png', 'PNG'), fileProfile('CHAT', 10, 1_250_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'NONE' }, 200, 'SUCCESS')),
  freezeFixture(fixtureSpec('chunk-overflow', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], { mode: 'CHUNKED', contentLength: 'OMITTED', rawMultipartBytes: 26_000_001 }, { type: 'NONE' }, 413, 'EVIDENCE_BATCH_TOO_LARGE')),
  freezeFixture(fixtureSpec('invalid-mime', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'JPEG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'NONE' }, 415, 'UNSUPPORTED_EVIDENCE')),
  freezeFixture(fixtureSpec('partial-failure', [fileProfile('PAYMENT', 2, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 2, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'REMOTE_FAILURE_AFTER_PERSISTED_FILES', afterPersistedFiles: 2 }, 503, 'BOOKING_PREPARE_RETRY')),
  freezeFixture(fixtureSpec('response-loss', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'RESPONSE_LOSS_AFTER_APPLY' }, 200, 'IDEMPOTENT_RECOVERY')),
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
    const result = parseFixtureResult(await runner.runFixture(fixture), fixture)
    if (!result.passed) maximumFixtureFailures += 1
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

function parseFixtureResult(value, expectedFixture) {
  if (!plainRecord(value)
    || exactKeys(value) !== 'duplicateCount,fixture,outcome,status,unavailableRouteProbeCount'
    || !safeStatus(value.status)
    || typeof value.outcome !== 'string'
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(value.outcome)
    || !safeInteger(value.duplicateCount, 0, 1_000)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  const fixture = parseFixtureDescriptor(value.fixture)
  return {
    passed: JSON.stringify(fixture) === JSON.stringify(expectedFixture)
      && value.status === expectedFixture.expected.status
      && value.outcome === expectedFixture.expected.outcome
      && value.duplicateCount === 0,
    unavailableRouteProbeCount: optionalCount(value.unavailableRouteProbeCount),
  }
}

function parseFixtureDescriptor(value) {
  if (!plainRecord(value) || exactKeys(value) !== 'expected,fault,files,label,transfer'
    || !safeLabel(value.label) || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 2) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  const files = value.files.map(parseFixtureFileProfile)
  if (new Set(files.map(({ kind }) => kind)).size !== files.length
    || files.reduce((total, file) => total + file.count, 0) > 20) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  const transfer = parseFixtureTransfer(value.transfer)
  const fault = parseFixtureFault(value.fault)
  const expected = parseFixtureExpected(value.expected)
  return { label: value.label, files, transfer, fault, expected }
}

function parseFixtureFileProfile(value) {
  if (!plainRecord(value)
    || exactKeys(value) !== 'advertisedMime,count,decodedBytesEach,kind,magicProfile'
    || (value.kind !== 'PAYMENT' && value.kind !== 'CHAT')
    || !safeInteger(value.count, 1, 10)
    || !safeInteger(value.decodedBytesEach, 1, 10_000_000)
    || (value.advertisedMime !== 'image/png' && value.advertisedMime !== 'image/jpeg')
    || (value.magicProfile !== 'PNG' && value.magicProfile !== 'JPEG')) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  return {
    kind: value.kind,
    count: value.count,
    decodedBytesEach: value.decodedBytesEach,
    advertisedMime: value.advertisedMime,
    magicProfile: value.magicProfile,
  }
}

function parseFixtureTransfer(value) {
  if (!plainRecord(value) || exactKeys(value) !== 'contentLength,mode,rawMultipartBytes') {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  const fixed = value.mode === 'CONTENT_LENGTH' && value.contentLength === 'PRESENT_EXACT'
    && value.rawMultipartBytes === null
  const chunked = value.mode === 'CHUNKED' && value.contentLength === 'OMITTED'
    && safeInteger(value.rawMultipartBytes, 1, 100_000_000)
  if (!fixed && !chunked) throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  return { mode: value.mode, contentLength: value.contentLength, rawMultipartBytes: value.rawMultipartBytes }
}

function parseFixtureFault(value) {
  if (!plainRecord(value)) throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  if (exactKeys(value) === 'type' && (value.type === 'NONE' || value.type === 'RESPONSE_LOSS_AFTER_APPLY')) {
    return { type: value.type }
  }
  if (exactKeys(value) === 'afterPersistedFiles,type'
    && value.type === 'REMOTE_FAILURE_AFTER_PERSISTED_FILES'
    && safeInteger(value.afterPersistedFiles, 1, 19)) {
    return { type: value.type, afterPersistedFiles: value.afterPersistedFiles }
  }
  throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
}

function parseFixtureExpected(value) {
  if (!plainRecord(value) || exactKeys(value) !== 'outcome,status'
    || !safeStatus(value.status) || typeof value.outcome !== 'string'
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(value.outcome)) {
    throw new Error('INVALID_BOOKING_PERFORMANCE_RESULT')
  }
  return { status: value.status, outcome: value.outcome }
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

function fileProfile(kind, count, decodedBytesEach, advertisedMime, magicProfile) {
  return { kind, count, decodedBytesEach, advertisedMime, magicProfile }
}

function fixedTransfer() {
  return { mode: 'CONTENT_LENGTH', contentLength: 'PRESENT_EXACT', rawMultipartBytes: null }
}

function fixtureSpec(label, files, transfer, fault, status, outcome) {
  return { label, files, transfer, fault, expected: { status, outcome } }
}

function freezeFixture(value) {
  for (const file of value.files) Object.freeze(file)
  Object.freeze(value.files)
  Object.freeze(value.transfer)
  Object.freeze(value.fault)
  Object.freeze(value.expected)
  return Object.freeze(value)
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
