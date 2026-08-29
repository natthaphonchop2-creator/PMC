#!/usr/bin/env node
import { execFile } from 'node:child_process'
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
  const reportDelayMs = boundedDelay(input.reportDelayMs, FINANCE_REPORT_DELAY_MS)
  const statusDelayMs = boundedDelay(input.statusDelayMs, FINANCE_STATUS_DELAY_MS)
  const maxStatusReads = boundedInteger(input.maxStatusReads, 1, 20, DEFAULT_STATUS_READS)
  if (!input.operator || typeof input.operator.refreshReport !== 'function'
    || typeof input.operator.seedAllocation !== 'function'
    || typeof input.operator.readAllocationStatus !== 'function'
    || typeof input.operator.readSummary !== 'function' || typeof sleep !== 'function') {
    throw new Error('FINANCE_OPERATOR_FAILED')
  }

  const sources = []
  for (let index = 0; index < FINANCE_SOURCE_TYPES.length; index += 1) {
    const reportType = FINANCE_SOURCE_TYPES[index]
    let evidence
    try { evidence = safeSourceEvidence(reportType, await input.operator.refreshReport(reportType, date)) }
    catch (error) { throw safeOperatorError(error) }
    sources.push(evidence)
    if (index + 1 < FINANCE_SOURCE_TYPES.length) await sleep(reportDelayMs)
  }

  try { await input.operator.seedAllocation(date) } catch (error) { throw safeOperatorError(error) }
  let allocation = emptyAllocationStatus()
  for (let read = 0; read < maxStatusReads; read += 1) {
    try { allocation = safeAllocationStatus(await input.operator.readAllocationStatus(date)) }
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
      channels: summary.channels, categories: summary.categories,
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
      return safeEnvelopeEvidence(reportType, envelope)
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
        metadataHashPrefix: coverage.metadataSnapshotHash.slice(0, 12), lastSuccessAt: coverage.lastSuccessAt,
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
  return {
    reportType,
    count: boundedInteger(value?.count, 0, Number.MAX_SAFE_INTEGER, 0),
    totalSatang: safeMoney(value?.totalSatang),
    lastSuccessAt: safeInstant(value?.lastSuccessAt),
    warningCode: safeCode(value?.warningCode),
  }
}

function safeEnvelopeEvidence(reportType, envelope) {
  const rows = Array.isArray(envelope?.data) ? envelope.data : []
  const field = reportType === 'PAYMENT' ? 'paidAmountSatang' : reportType === 'REFUND' ? 'refundAmountSatang' : null
  return safeSourceEvidence(reportType, {
    count: rows.length, totalSatang: field ? sumMoney(rows, field) : 0,
    lastSuccessAt: envelope?.lastSuccessAt, warningCode: envelope?.warningCode,
  })
}

function safeAllocationStatus(value) {
  return {
    status: value?.status === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
    paymentCount: boundedInteger(value?.paymentCount, 0, Number.MAX_SAFE_INTEGER, 0),
    coveredPaymentCount: boundedInteger(value?.coveredPaymentCount, 0, Number.MAX_SAFE_INTEGER, 0),
    metadataHashPrefix: typeof value?.metadataHashPrefix === 'string' && /^[a-f0-9]{12}$/.test(value.metadataHashPrefix) ? value.metadataHashPrefix : null,
    lastSuccessAt: safeInstant(value?.lastSuccessAt),
  }
}

function emptyAllocationStatus() { return { status: 'INCOMPLETE', paymentCount: 0, coveredPaymentCount: 0, metadataHashPrefix: null, lastSuccessAt: null } }
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
function boundedDelay(value, fallback) { return Number.isSafeInteger(value) && value >= 0 && value <= 600_000 ? value : fallback }
function boundedInteger(value, min, max, fallback) { return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback }
function safeMoney(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function nullableMoney(value) { return value === null || value === undefined ? null : safeMoney(value) }
function safeInstant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null }
function safeCode(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null }
function safeOperatorError(error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code
    : error instanceof Error && /^FINANCE_[A-Z0-9_]{1,70}$/.test(error.message) ? error.message : null
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
function defaultSleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
async function runExternal(command) { const { stdout } = await executeFile(command[0], command.slice(1), { maxBuffer: 2_000_000 }); return stdout }

async function loadFinanceRuntime() {
  const [config, tokenClient, client, store, coordinator, googleClient, allocationStore, allocationQueue, financeService] = await Promise.all([
    import('../dist-server/server/jera/config.js'), import('../dist-server/server/jera/tokenClient.js'),
    import('../dist-server/server/jera/client.js'), import('../dist-server/server/jera/store.js'),
    import('../dist-server/server/jera/syncCoordinator.js'), import('../dist-server/server/pmc-mini-app/googleClient.js'),
    import('../dist-server/server/jera/allocationStore.js'), import('../dist-server/server/jera/allocationTaskQueue.js'),
    import('../dist-server/server/jera/financeService.js'),
  ])
  return {
    readJeraConfig: config.readJeraConfig, createJeraTokenClient: tokenClient.createJeraTokenClient,
    createJeraReadClient: client.createJeraReadClient, createGoogleJeraReportStore: store.createGoogleJeraReportStore,
    createJeraSyncCoordinator: coordinator.createJeraSyncCoordinator, createMiniAppGooglePorts: googleClient.createMiniAppGooglePorts,
    createGoogleJeraAllocationStore: allocationStore.createGoogleJeraAllocationStore,
    jeraAllocationDayKey: allocationStore.jeraAllocationDayKey,
    createGoogleJeraAllocationTaskQueue: allocationQueue.createGoogleJeraAllocationTaskQueue,
    createJeraFinanceService: financeService.createJeraFinanceService,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedFinanceReportDay(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    const message = error instanceof Error && /^(Explicit|Unknown|Sensitive|A strict|The one-day)/.test(error.message)
      ? error.message : 'Finance day seed failed'
    process.stderr.write(`${message}\n`); process.exitCode = 2
  })
}
