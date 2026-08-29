#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { JERA_OPERATOR_PROJECT, loadJeraOperatorSecrets } from './jera-operator-secrets.mjs'

const executeFile = promisify(execFile)
export const APPROVED_FINANCE_COMPARISON_DAY = '2026-08-22'
export const APPROVED_FINANCE_PROJECT = JERA_OPERATOR_PROJECT
export const FINANCE_SOURCE_TYPES = ['PAYMENT', 'REFUND', 'PRODUCT_SALES']
export const FINANCE_REPORT_DELAY_MS = 20_000
export const FINANCE_STATUS_DELAY_MS = 60_000
const DEFAULT_STATUS_READS = 6
const DEFAULT_SERVICE = 'pmc-mini-app'
const DEFAULT_REGION = 'asia-southeast1'
const SENSITIVE_FLAGS = new Set([
  '--username', '--password', '--token', '--access-token', '--sheet-id', '--spreadsheet-id',
  '--line-user-id', '--line-id', '--secret', '--credential', '--credentials',
])

export async function seedFinanceReportDay(args, options = {}) {
  const parsed = parseSeedArguments(args)
  const io = options.io ?? { stdout: process.stdout }
  if (parsed.help) {
    io.stdout.write('Usage: seed-finance-report-day --allow-readonly-production --allow-cache-write --project <id> --date 2026-08-22\n')
    return 0
  }
  let operator
  try {
    operator = await (options.createOperator ?? createFinanceOperator)({
      project: parsed.project, execute: options.execute, environment: options.environment,
    })
  } catch {
    throw new Error('FINANCE_OPERATOR_FAILED')
  }
  const result = await seedApprovedFinanceDay({
    date: parsed.date,
    operator,
    sleep: options.sleep ?? defaultSleep,
    reportDelayMs: options.reportDelayMs ?? FINANCE_REPORT_DELAY_MS,
    statusDelayMs: options.statusDelayMs ?? FINANCE_STATUS_DELAY_MS,
    maxStatusReads: options.maxStatusReads ?? DEFAULT_STATUS_READS,
  })
  io.stdout.write(`${JSON.stringify(result)}\n`)
  return result.allocation.status === 'COMPLETE' ? 0 : 1
}

export async function seedApprovedFinanceDay(input) {
  const date = strictDate(input.date)
  const sleep = input.sleep ?? defaultSleep
  const reportDelayMs = minimumDelay(input.reportDelayMs, FINANCE_REPORT_DELAY_MS)
  const statusDelayMs = minimumDelay(input.statusDelayMs, FINANCE_STATUS_DELAY_MS)
  const maxStatusReads = boundedInteger(input.maxStatusReads, 1, 20, DEFAULT_STATUS_READS)
  if (!input.operator || typeof input.operator.refreshReport !== 'function'
    || typeof input.operator.seedAllocation !== 'function'
    || typeof input.operator.readAllocationStatus !== 'function'
    || typeof input.operator.readSummary !== 'function' || typeof sleep !== 'function') {
    throw new Error('FINANCE_OPERATOR_FAILED')
  }

  const sources = []
  const sourceIdentities = {}
  for (let index = 0; index < FINANCE_SOURCE_TYPES.length; index += 1) {
    const reportType = FINANCE_SOURCE_TYPES[index]
    let evidence
    try { evidence = safeSourceEvidence(reportType, await input.operator.refreshReport(reportType, date)) }
    catch (error) { throw safeOperatorError(error) }
    sources.push(evidence.publicEvidence)
    sourceIdentities[reportType] = evidence.identity
    if (index + 1 < FINANCE_SOURCE_TYPES.length) await sleep(reportDelayMs)
  }

  try { await input.operator.seedAllocation(date) } catch (error) { throw safeOperatorError(error) }
  let allocation = emptyAllocationStatus()
  for (let read = 0; read < maxStatusReads; read += 1) {
    try { allocation = safeAllocationStatus(await input.operator.readAllocationStatus(date), sourceIdentities) }
    catch (error) { throw safeOperatorError(error) }
    if (allocation.status === 'COMPLETE') break
    if (read + 1 < maxStatusReads) await sleep(statusDelayMs)
  }

  let summary
  try { summary = safeSummary(await input.operator.readSummary(date)) }
  catch (error) { throw safeOperatorError(error) }
  return {
    mode: 'FINANCE_DAY_SEED', date, sequential: true, sources, allocation,
    totals: {
      receivedSatang: summary.receivedSatang, refundSatang: summary.refundSatang,
      channels: summary.channels,
      categories: allocation.status === 'COMPLETE'
        ? summary.categories : { serviceSatang: null, productSatang: null, unclassifiedSatang: null },
    },
    warnings: [...new Set([
      ...summary.warnings, ...(allocation.status === 'COMPLETE' ? [] : ['ALLOCATION_INCOMPLETE']),
    ])].sort(),
  }
}

export async function createFinanceOperator(input) {
  const project = safeProject(input.project)
  const execute = input.execute ?? runExternal
  let service
  try {
    service = JSON.parse(await execute([
      'gcloud', 'run', 'services', 'describe', DEFAULT_SERVICE, '--region', DEFAULT_REGION,
      '--project', project, '--format=json',
    ]))
  } catch { throw new Error('FINANCE_OPERATOR_FAILED') }
  const deployed = deployedEnvironment(service)
  const secrets = await loadJeraOperatorSecrets({ project })
  const runtime = await loadFinanceRuntime()
  const environment = { ...deployed, ...(input.environment ?? {}) }
  const config = runtime.readJeraConfig(jeraEnvironment({
    ...environment,
    JERA_REPORTING_ENABLED: 'true',
    JERA_API_BASE_URL: secrets.baseUrl,
    JERA_API_USERNAME: secrets.username,
    JERA_API_PASSWORD: secrets.password,
    JERA_REVENUE_ALLOCATION_ENABLED: 'true',
    JERA_FINANCE_CATEGORY_MONEY_ENABLED: 'false',
  }))
  if (!config?.allocation) throw new Error('FINANCE_OPERATOR_FAILED')
  const spreadsheetId = requiredOpaque(environment.PMC_SPREADSHEET_ID)
  const intakeFolderId = requiredOpaque(environment.PMC_DRIVE_INTAKE_FOLDER_ID)
  const google = runtime.createMiniAppGooglePorts({ spreadsheetId, intakeFolderId })
  const tokens = runtime.createJeraTokenClient(config)
  const client = runtime.createJeraReadClient(config, tokens, { mode: 'SCHEDULED' })
  const store = runtime.createGoogleJeraReportStore({ spreadsheetId, sheets: google.sheets })
  const coordinator = runtime.createJeraSyncCoordinator({
    client, store, manualRefreshSeconds: config.manualRefreshSeconds,
    staleAfterMs: config.syncIntervalMinutes * 2 * 60_000,
  })
  const allocationStore = runtime.createGoogleJeraAllocationStore({ spreadsheetId, sheets: google.sheets })
  const allocationQueue = runtime.createGoogleJeraAllocationTaskQueue({
    projectId: config.allocation.projectId, location: config.allocation.location,
    queueName: config.allocation.queueName, workerUrl: config.allocation.workerUrl,
    workerAudience: config.allocation.workerAudience, taskInvokerEmail: config.allocation.taskInvokerEmail,
  })
  const noProviderCoordinator = {
    ...coordinator,
    manualRefresh: async () => ({ accepted: true, retryAfterSeconds: config.manualRefreshSeconds }),
  }
  const seeder = runtime.createJeraFinanceService({
    coordinator: noProviderCoordinator, allocationStore, allocationQueue, categoryMoneyEnabled: false,
  })
  const reader = runtime.createJeraFinanceService({
    coordinator, allocationStore, allocationQueue, categoryMoneyEnabled: true,
  })
  const branchUuid = config.defaultBranchUuid
  const query = (reportType, date) => ({ reportType, filters: { branchUuid, startDate: date, endDate: date } })
  return {
    async refreshReport(reportType, date) {
      if (!FINANCE_SOURCE_TYPES.includes(reportType)) throw new Error('FINANCE_OPERATOR_FAILED')
      const envelope = await coordinator.scheduledRefresh(query(reportType, strictDate(date)))
      const rows = Array.isArray(envelope?.data) ? envelope.data : []
      return safeEnvelopeEvidence(reportType, envelope, {
        paymentSetHash: reportType === 'PAYMENT' ? paymentSetHash(rows) : null,
        metadataSnapshotHash: reportType === 'PRODUCT_SALES'
          ? runtime.buildItemTypeMetadata(rows.map((row) => ({ itemCode: row.itemCode, type: row.type, sourceHash: row.sourceHash }))).snapshotHash
          : null,
      })
    },
    seedAllocation(date) {
      return seeder.refreshDay({ branchUuid, eventDate: strictDate(date), actor: { type: 'SCHEDULER', schedulerId: 'operator-finance-seed' } })
    },
    async readAllocationStatus(date) {
      const dayKey = runtime.jeraAllocationDayKey(branchUuid, strictDate(date))
      const coverage = await allocationStore.getCoverage(dayKey)
      return coverage ? {
        status: coverage.status, paymentCount: coverage.paymentRowCount,
        coveredPaymentCount: coverage.successfulDetailCount,
        paymentSetHash: coverage.paymentSetHash, metadataSnapshotHash: coverage.metadataSnapshotHash,
        paymentLastSuccessAt: coverage.paymentLastSuccessAt,
        productSalesLastSuccessAt: coverage.productSalesLastSuccessAt,
        lastSuccessAt: coverage.lastSuccessAt, safeErrorCode: coverage.safeErrorCode,
        stale: allocationCoverageStale(coverage),
      } : emptyAllocationStatus()
    },
    async readSummary(date) {
      return reader.readDaily({ branchUuid, startDate: strictDate(date), endDate: strictDate(date) })
    },
  }
}

export function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('A strict Bangkok calendar date is required')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('A strict Bangkok calendar date is required')
  return value
}

export function assertNoSensitiveFlags(args) {
  if (args.some((value) => SENSITIVE_FLAGS.has(String(value).toLowerCase()))) throw new Error('Sensitive command-line arguments are forbidden')
}

export function safeProject(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value)) throw new Error('A valid project is required')
  return value
}

function parseSeedArguments(args) {
  assertNoSensitiveFlags(args)
  const parsed = { help: false, allowReadonlyProduction: false, allowCacheWrite: false, project: null, date: null }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--allow-readonly-production') parsed.allowReadonlyProduction = true
    else if (value === '--allow-cache-write') parsed.allowCacheWrite = true
    else if (value === '--project' && parsed.project === null && args[index + 1]) parsed.project = args[++index]
    else if (value === '--date' && parsed.date === null && args[index + 1]) parsed.date = args[++index]
    else throw new Error('Unknown finance operator argument')
  }
  if (parsed.help) return parsed
  if (!parsed.allowReadonlyProduction) throw new Error('Explicit read-only production approval is required')
  if (!parsed.allowCacheWrite) throw new Error('Explicit cache-write approval is required')
  parsed.project = safeProject(parsed.project)
  if (parsed.project !== APPROVED_FINANCE_PROJECT) throw new Error('Approved finance project is required')
  parsed.date = strictDate(parsed.date)
  if (parsed.date !== APPROVED_FINANCE_COMPARISON_DAY) throw new Error('The one-day seed is restricted to the approved comparison date')
  return parsed
}

function safeSourceEvidence(reportType, value) {
  const lastSuccessAt = safeInstant(value?.lastSuccessAt)
  const warningCode = safeCode(value?.warningCode)
  const count = boundedInteger(value?.count, 0, Number.MAX_SAFE_INTEGER, 0)
  return { publicEvidence: {
    reportType,
    count,
    totalSatang: safeMoney(value?.totalSatang),
    lastSuccessAt,
    warningCode,
  }, identity: {
    count, lastSuccessAt, warningCode, stale: value?.stale,
    paymentSetHash: exactHash(value?.paymentSetHash),
    metadataSnapshotHash: exactHash(value?.metadataSnapshotHash),
  } }
}

function safeEnvelopeEvidence(reportType, envelope, identities) {
  const rows = Array.isArray(envelope?.data) ? envelope.data : []
  const field = reportType === 'PAYMENT' ? 'paidAmountSatang' : reportType === 'REFUND' ? 'refundAmountSatang' : null
  return {
    reportType,
    count: rows.length, totalSatang: field ? sumMoney(rows, field) : 0,
    lastSuccessAt: envelope?.lastSuccessAt, warningCode: envelope?.warningCode, stale: envelope?.stale,
    paymentSetHash: identities.paymentSetHash, metadataSnapshotHash: identities.metadataSnapshotHash,
  }
}

function safeAllocationStatus(value, sourceIdentities) {
  const paymentCount = boundedInteger(value?.paymentCount, 0, Number.MAX_SAFE_INTEGER, 0)
  const coveredPaymentCount = boundedInteger(value?.coveredPaymentCount, 0, Number.MAX_SAFE_INTEGER, 0)
  const paymentSetHash = exactHash(value?.paymentSetHash)
  const metadataSnapshotHash = exactHash(value?.metadataSnapshotHash)
  const paymentLastSuccessAt = safeInstant(value?.paymentLastSuccessAt)
  const productSalesLastSuccessAt = safeInstant(value?.productSalesLastSuccessAt)
  const lastSuccessAt = safeInstant(value?.lastSuccessAt)
  const paymentIdentity = sourceIdentities.PAYMENT ?? {}
  const productIdentity = sourceIdentities.PRODUCT_SALES ?? {}
  const sourceTimesClose = timestampsWithin(paymentLastSuccessAt, productSalesLastSuccessAt, 15 * 60_000)
  const allocationAfterSources = timestampsOrderedAfter(lastSuccessAt, paymentLastSuccessAt, productSalesLastSuccessAt)
  const complete = value?.status === 'COMPLETE'
    && paymentCount === paymentIdentity.count && coveredPaymentCount === paymentIdentity.count
    && paymentSetHash !== null && paymentSetHash === paymentIdentity.paymentSetHash
    && metadataSnapshotHash !== null && metadataSnapshotHash === productIdentity.metadataSnapshotHash
    && paymentLastSuccessAt !== null && paymentLastSuccessAt === paymentIdentity.lastSuccessAt
    && productSalesLastSuccessAt !== null && productSalesLastSuccessAt === productIdentity.lastSuccessAt
    && lastSuccessAt !== null && sourceTimesClose && allocationAfterSources
    && paymentIdentity.stale === false && productIdentity.stale === false
    && paymentIdentity.warningCode === null && productIdentity.warningCode === null
    && value?.safeErrorCode === null && value?.stale === false
  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE', paymentCount, coveredPaymentCount,
    metadataHashPrefix: metadataSnapshotHash?.slice(0, 12) ?? null, lastSuccessAt,
  }
}

function emptyAllocationStatus() {
  return {
    status: 'INCOMPLETE', paymentCount: 0, coveredPaymentCount: 0,
    paymentSetHash: null, metadataSnapshotHash: null,
    paymentLastSuccessAt: null, productSalesLastSuccessAt: null,
    metadataHashPrefix: null, lastSuccessAt: null, safeErrorCode: null, stale: true,
  }
}
function safeSummary(value) {
  const categories = value?.categories?.state === 'CHECKING' ? value.categories : value?.categories
  return {
    receivedSatang: safeMoney(value?.receivedSatang), refundSatang: safeMoney(value?.refundSatang),
    channels: {
      transferSatang: safeMoney(value?.channels?.transferSatang), cashSatang: safeMoney(value?.channels?.cashSatang),
      creditSatang: safeMoney(value?.channels?.creditSatang), otherSatang: safeMoney(value?.channels?.otherSatang),
    },
    categories: {
      serviceSatang: nullableMoney(categories?.serviceSatang), productSatang: nullableMoney(categories?.productSatang),
      unclassifiedSatang: nullableMoney(categories?.unclassifiedSatang),
    },
    warnings: Array.isArray(value?.warnings) ? [...new Set(value.warnings.map(safeCode).filter(Boolean))].slice(0, 20).sort() : [],
  }
}

function deployedEnvironment(service) {
  const containers = service?.spec?.template?.spec?.containers
  const entries = Array.isArray(containers) ? containers.flatMap((container) => Array.isArray(container?.env) ? container.env : []) : []
  return Object.fromEntries(entries.flatMap((entry) => typeof entry?.name === 'string' && typeof entry?.value === 'string' ? [[entry.name, entry.value]] : []))
}
function jeraEnvironment(environment) { return Object.fromEntries(Object.entries(environment).filter(([name]) => name.startsWith('JERA_'))) }
function requiredOpaque(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error('FINANCE_OPERATOR_FAILED'); return value }
function minimumDelay(value, minimum) { return Number.isSafeInteger(value) && value >= minimum && value <= 600_000 ? value : minimum }
function boundedInteger(value, min, max, fallback) { return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback }
function safeMoney(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function nullableMoney(value) { return value === null || value === undefined ? null : safeMoney(value) }
function safeInstant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null }
function safeCode(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null }
function safeOperatorError(error) {
  const rawCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code
    : error instanceof Error && /^FINANCE_[A-Z0-9_]{1,70}$/.test(error.message) ? error.message : null
  const code = {
    JERA_RATE_LIMITED: 'FINANCE_RATE_LIMITED',
    JERA_AUTH_FAILED: 'FINANCE_AUTH_FAILED',
    JERA_SCHEMA_INVALID: 'FINANCE_SCHEMA_INVALID',
  }[rawCode] ?? rawCode
  if (!['FINANCE_RATE_LIMITED', 'FINANCE_AUTH_FAILED', 'FINANCE_SCHEMA_INVALID', 'FINANCE_ALLOCATION_INCOMPLETE'].includes(code)) {
    return new Error('FINANCE_OPERATOR_FAILED')
  }
  const safe = new Error(code)
  safe.code = code
  if (code === 'FINANCE_RATE_LIMITED' && Number.isSafeInteger(error?.retryAfterSeconds)
    && error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 3_600) safe.retryAfterSeconds = error.retryAfterSeconds
  return safe
}
function sumMoney(rows, field) { return rows.reduce((total, row) => total + safeMoney(row?.[field]), 0) }
function exactHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null }
function paymentSetHash(rows) {
  const pairs = [...rows].sort((left, right) => String(left?.sourceUuid).localeCompare(String(right?.sourceUuid)))
    .map((row) => [row?.sourceUuid, row?.sourceHash])
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
}
function timestampsWithin(left, right, limitMs) {
  return left !== null && right !== null && Math.abs(Date.parse(left) - Date.parse(right)) <= limitMs
}
function timestampsOrderedAfter(allocation, payment, product) {
  if (allocation === null || payment === null || product === null) return false
  return Date.parse(allocation) >= Math.max(Date.parse(payment), Date.parse(product))
}
function allocationCoverageStale(coverage, nowMs = Date.now()) {
  const lastSuccessMs = Date.parse(coverage?.lastSuccessAt)
  return !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs > 24 * 60 * 60_000
}
function defaultSleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
async function runExternal(command) { const { stdout } = await executeFile(command[0], command.slice(1), { maxBuffer: 2_000_000 }); return stdout }

async function loadFinanceRuntime() {
  const [config, tokenClient, client, store, coordinator, googleClient, allocationStore, allocationQueue, financeService, allocation] = await Promise.all([
    import('../dist-server/server/jera/config.js'), import('../dist-server/server/jera/tokenClient.js'),
    import('../dist-server/server/jera/client.js'), import('../dist-server/server/jera/store.js'),
    import('../dist-server/server/jera/syncCoordinator.js'), import('../dist-server/server/pmc-mini-app/googleClient.js'),
    import('../dist-server/server/jera/allocationStore.js'), import('../dist-server/server/jera/allocationTaskQueue.js'),
    import('../dist-server/server/jera/financeService.js'),
    import('../dist-server/server/jera/allocation.js'),
  ])
  return {
    readJeraConfig: config.readJeraConfig, createJeraTokenClient: tokenClient.createJeraTokenClient,
    createJeraReadClient: client.createJeraReadClient, createGoogleJeraReportStore: store.createGoogleJeraReportStore,
    createJeraSyncCoordinator: coordinator.createJeraSyncCoordinator, createMiniAppGooglePorts: googleClient.createMiniAppGooglePorts,
    createGoogleJeraAllocationStore: allocationStore.createGoogleJeraAllocationStore,
    jeraAllocationDayKey: allocationStore.jeraAllocationDayKey,
    createGoogleJeraAllocationTaskQueue: allocationQueue.createGoogleJeraAllocationTaskQueue,
    createJeraFinanceService: financeService.createJeraFinanceService,
    buildItemTypeMetadata: allocation.buildItemTypeMetadata,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedFinanceReportDay(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    const message = error instanceof Error && /^(Explicit|Unknown|Sensitive|A strict|The one-day)/.test(error.message)
      ? error.message : 'Finance day seed failed'
    process.stderr.write(`${message}\n`); process.exitCode = 2
  })
}
