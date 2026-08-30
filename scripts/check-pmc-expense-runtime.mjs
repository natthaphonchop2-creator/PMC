#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const REQUIRED_CONFIG_BOOLEANS = [
  'expenseCaptureEnabled',
  'financeReadsEnabled',
  'canSubmitExpense',
  'canViewFinance',
  'canManageExpense',
]

const REQUIRED_BINDINGS = [
  'PMC_FINANCE_MASTER_SPREADSHEET_ID',
  'PMC_FINANCE_FOLDER_ID',
  'PMC_FINANCE_STAGING_BUCKET',
  'PMC_EXPENSE_INGRESS_URL',
  'PMC_EXPENSE_INGRESS_SECRET',
  'PMC_EXPENSE_RECOVERY_AUDIENCE',
  'PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL',
]

const REQUIRED_SOURCE_CHECKS = [
  'health', 'clientConfig', 'permissions', 'financeRead', 'staging', 'recovery', 'topology',
]

const EXPECTED_MASTER_HEADERS = {
  EXPENSE_MONTHLY_INDEX: ['monthKey', 'ledgerSpreadsheetId', 'monthFolderId', 'createdAt', 'updatedAt'],
  EXPENSE_REQUESTS: ['commandIdempotencyKey', 'rootRequestId', 'commandType', 'commandFingerprint', 'expenseId', 'monthKey', 'recordState', 'resultJson', 'createdAt', 'updatedAt'],
  EXPENSE_AUDIT: ['eventId', 'expenseId', 'actorStaffId', 'action', 'beforeJson', 'afterJson', 'createdAt', 'correlationId'],
}

const EXPECTED_MONTH_HEADERS = {
  EXPENSE_SUBMISSIONS: ['expenseId', 'expenseDate', 'monthKey', 'category', 'scope', 'amountSatang', 'counterpartyName', 'description', 'paymentMethod', 'recordState', 'bookDailyKey', 'revision', 'supersedesExpenseId', 'submittedByStaffId', 'submittedByName', 'submittedAt', 'committedAt', 'updatedAt', 'version', 'idempotencyKey'],
  EXPENSE_ATTACHMENTS: ['attachmentId', 'expenseId', 'rootRequestId', 'ordinal', 'mediaType', 'originalFileName', 'privateFileId', 'deterministicName', 'sizeBytes', 'driveVersion', 'slotClaimId', 'sha256', 'uploadedByStaffId', 'uploadedAt'],
  MONTHLY_SUMMARY: ['monthKey', 'scope', 'category', 'committedSatang', 'effectiveCount', 'calculatedAt', 'sourceHash'],
}

const EXPECTED_STAFF_HEADERS = ['id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active', 'profileImageUrl', 'canManageStock', 'canSubmitExpense', 'canViewFinance', 'canManageExpense']
const FORBIDDEN_CLIENT_KEY = /(?:spreadsheet|folder|bucket|privateFile|driveVersion|slotClaim|sha256|secret|ingressUrl|lineUserId)/i
const SNAPSHOT_KEYS = ['provenance', 'healthStatus', 'clientConfig', 'flags', 'bindingNames', 'submitOnly', 'financeRead', 'staging', 'recovery', 'topology']
const PROVENANCE_KEYS = ['schemaVersion', 'profile', 'target', 'environment', 'collectedAt', 'sourceChecks']
const SUBMIT_ONLY_KEYS = ['history', 'evidence']
const PERMISSION_RESULT_KEYS = ['status', 'error']
const FINANCE_READ_KEYS = ['selectedMonth', 'requestedMonths']
const STAGING_KEYS = ['deleteAfterDays']
const RECOVERY_KEYS = ['targetPath', 'audienceConfigured', 'identityConfigured']
const TOPOLOGY_KEYS = ['master', 'month', 'staff']

export function inspectPmcExpenseRuntime(snapshot, options = {}) {
  const source = isRecord(snapshot) ? snapshot : {}
  const snapshotSchema = snapshotSchemaReport(source)
  if (!snapshotSchema.safe) {
    return { mode: 'READ_ONLY', ready: false, snapshotSchema }
  }
  const provenanceSource = isRecord(source.provenance) ? source.provenance : {}
  const sourceChecks = isRecord(provenanceSource.sourceChecks) ? provenanceSource.sourceChecks : {}
  const sourceCheckCount = REQUIRED_SOURCE_CHECKS.filter((name) => sourceChecks[name] === true).length
  const collectedAtMs = typeof provenanceSource.collectedAt === 'string'
    ? Date.parse(provenanceSource.collectedAt)
    : Number.NaN
  const nowMs = validNow(options.now?.() ?? new Date()).getTime()
  const maxAgeSeconds = safeMaxAge(options.maxAgeSeconds)
  const ageSeconds = Number.isFinite(collectedAtMs)
    ? Math.floor((nowMs - collectedAtMs) / 1_000)
    : -1
  const targetMatches = safeLabel(options.expectedTarget) !== null
    && provenanceSource.target === options.expectedTarget
  const environmentMatches = safeLabel(options.expectedEnvironment) !== null
    && provenanceSource.environment === options.expectedEnvironment
  const provenance = {
    schemaVersion: provenanceSource.schemaVersion === 1 ? 1 : 0,
    profile: provenanceSource.profile === 'DISABLED_PREFLIGHT' ? 'DISABLED_PREFLIGHT' : 'INVALID',
    targetMatches,
    environmentMatches,
    ageSeconds,
    maxAgeSeconds,
    sourceCheckCount,
    requiredSourceCheckCount: REQUIRED_SOURCE_CHECKS.length,
    ready: false,
  }
  provenance.ready = provenance.schemaVersion === 1
    && provenance.profile === 'DISABLED_PREFLIGHT'
    && targetMatches
    && environmentMatches
    && ageSeconds >= 0
    && ageSeconds <= maxAgeSeconds
    && Object.keys(sourceChecks).length === REQUIRED_SOURCE_CHECKS.length
    && sourceCheckCount === REQUIRED_SOURCE_CHECKS.length
  const healthStatus = safeStatus(source.healthStatus)
  const health = { status: healthStatus, ok: healthStatus === 200 }

  const clientSource = isRecord(source.clientConfig) ? source.clientConfig : {}
  const booleanCount = REQUIRED_CONFIG_BOOLEANS.filter((name) => typeof clientSource[name] === 'boolean').length
  const forbiddenKeyCount = countForbiddenKeys(clientSource)
  const clientProfileMatch = clientSource.expenseCaptureEnabled === false
    && clientSource.financeReadsEnabled === true
    && clientSource.canSubmitExpense === true
    && clientSource.canViewFinance === true
    && clientSource.canManageExpense === true
  const clientConfig = {
    requiredBooleanCount: REQUIRED_CONFIG_BOOLEANS.length,
    booleanCount,
    forbiddenKeyCount,
    profileMatch: clientProfileMatch,
    safe: booleanCount === REQUIRED_CONFIG_BOOLEANS.length
      && forbiddenKeyCount === 0
      && clientProfileMatch,
  }

  const flagSource = isRecord(source.flags) ? source.flags : {}
  const captureEnabled = explicitBoolean(flagSource.PMC_EXPENSE_CAPTURE_ENABLED)
  const financeReadsEnabled = explicitBoolean(flagSource.PMC_FINANCE_READS_ENABLED)
  const explicit = captureEnabled !== null && financeReadsEnabled !== null

  const bindingNames = Array.isArray(source.bindingNames)
    ? source.bindingNames.filter((name) => typeof name === 'string')
    : []
  const uniqueBindingNames = new Set(bindingNames)
  const presentCount = REQUIRED_BINDINGS.filter((name) => uniqueBindingNames.has(name)).length
  const bindings = {
    requiredCount: REQUIRED_BINDINGS.length,
    presentCount,
    coherent: presentCount === REQUIRED_BINDINGS.length
      && bindingNames.length === REQUIRED_BINDINGS.length
      && uniqueBindingNames.size === REQUIRED_BINDINGS.length,
  }
  const flags = {
    captureEnabled: captureEnabled === true,
    financeReadsEnabled: financeReadsEnabled === true,
    explicit,
    profileMatch: captureEnabled === false && financeReadsEnabled === true,
    coherent: false,
  }
  flags.coherent = explicit && flags.profileMatch && bindings.coherent

  const submitSource = isRecord(source.submitOnly) ? source.submitOnly : {}
  const submitOnly = {
    historyDenied: permissionDenied(submitSource.history),
    evidenceDenied: permissionDenied(submitSource.evidence),
  }

  const financeSource = isRecord(source.financeRead) ? source.financeRead : {}
  const selectedMonth = safeMonth(financeSource.selectedMonth)
  const requestedMonths = Array.isArray(financeSource.requestedMonths)
    ? financeSource.requestedMonths.filter((value) => typeof value === 'string')
    : []
  const financeRead = {
    requestCount: requestedMonths.length,
    oneSelectedMonthOnly: selectedMonth !== null
      && requestedMonths.length === 1
      && requestedMonths[0] === selectedMonth,
  }

  const stagingSource = isRecord(source.staging) ? source.staging : {}
  const deleteAfterDays = safeNonnegative(stagingSource.deleteAfterDays)
  const staging = { deleteAfterDays, lifecycleReady: deleteAfterDays === 1 }

  const recoverySource = isRecord(source.recovery) ? source.recovery : {}
  const recovery = {
    exactTarget: recoverySource.targetPath === '/internal/mini-app/recover-expenses',
    audienceConfigured: recoverySource.audienceConfigured === true,
    identityConfigured: recoverySource.identityConfigured === true,
    ready: false,
  }
  recovery.ready = recovery.exactTarget && recovery.audienceConfigured && recovery.identityConfigured

  const topologySource = isRecord(source.topology) ? source.topology : {}
  const exactMasterHeaderCount = exactHeaderCount(topologySource.master, EXPECTED_MASTER_HEADERS)
  const exactMonthHeaderCount = exactHeaderCount(topologySource.month, EXPECTED_MONTH_HEADERS)
  const staffHeaderExact = same(topologySource.staff, EXPECTED_STAFF_HEADERS)
  const topology = {
    exactMasterHeaderCount,
    exactMonthHeaderCount,
    staffHeaderExact,
    ready: exactMasterHeaderCount === Object.keys(EXPECTED_MASTER_HEADERS).length
      && exactMonthHeaderCount === Object.keys(EXPECTED_MONTH_HEADERS).length
      && staffHeaderExact,
  }

  const ready = snapshotSchema.safe && provenance.ready && health.ok && clientConfig.safe && flags.coherent && bindings.coherent
    && submitOnly.historyDenied && submitOnly.evidenceDenied
    && financeRead.oneSelectedMonthOnly && staging.lifecycleReady && recovery.ready && topology.ready

  return {
    mode: 'READ_ONLY',
    ready,
    snapshotSchema,
    provenance,
    health,
    clientConfig,
    flags,
    bindings,
    submitOnly,
    financeRead,
    staging,
    recovery,
    topology,
  }
}

export async function runExpenseRuntimeCheck(args, io = { stdout: process.stdout }) {
  const parsed = parseArguments(args)
  if (parsed.help) {
    io.stdout.write('Usage: check-pmc-expense-runtime --snapshot-file <local-readonly-snapshot.json> --expected-target <name> --expected-environment <name> [--strict]\n')
    return 0
  }
  const contents = await readFile(parsed.snapshotFile, 'utf8')
  if (Buffer.byteLength(contents, 'utf8') > 1_000_000) throw new Error('Expense runtime snapshot is too large')
  const report = inspectPmcExpenseRuntime(JSON.parse(contents), {
    expectedTarget: parsed.expectedTarget,
    expectedEnvironment: parsed.expectedEnvironment,
    maxAgeSeconds: 900,
  })
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return parsed.strict && !report.ready ? 1 : 0
}

function parseArguments(args) {
  const parsed = { snapshotFile: null, expectedTarget: null, expectedEnvironment: null, strict: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--strict') parsed.strict = true
    else if (value === '--snapshot-file' && parsed.snapshotFile === null && args[index + 1]) {
      parsed.snapshotFile = args[++index]
    } else if (value === '--expected-target' && parsed.expectedTarget === null && args[index + 1]) {
      parsed.expectedTarget = args[++index]
    } else if (value === '--expected-environment' && parsed.expectedEnvironment === null && args[index + 1]) {
      parsed.expectedEnvironment = args[++index]
    } else throw new Error('Unknown expense runtime-check argument')
  }
  if (!parsed.help && (typeof parsed.snapshotFile !== 'string' || parsed.snapshotFile.length < 1)) {
    throw new Error('A local read-only expense runtime snapshot is required')
  }
  if (!parsed.help && (!safeLabel(parsed.expectedTarget) || !safeLabel(parsed.expectedEnvironment))) {
    throw new Error('Expected target and environment are required')
  }
  return parsed
}

function permissionDenied(value) {
  return isRecord(value)
    && value.status === 403
    && value.error === 'EXPENSE_FINANCE_PERMISSION_REQUIRED'
}

function exactHeaderCount(value, expected) {
  const source = isRecord(value) ? value : {}
  return Object.entries(expected).filter(([name, headers]) => same(source[name], headers)).length
}

function countForbiddenKeys(value) {
  if (!isRecord(value)) return 0
  let count = 0
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CLIENT_KEY.test(key)) count += 1
    if (isRecord(child)) count += countForbiddenKeys(child)
    else if (Array.isArray(child)) count += child.reduce((total, item) => total + countForbiddenKeys(item), 0)
  }
  return count
}

function snapshotSchemaReport(source) {
  let unknownKeyCount = 0
  let safe = true
  const check = (value, keys) => {
    if (!isRecord(value)) { safe = false; return }
    const actual = Object.keys(value)
    unknownKeyCount += actual.filter((key) => !keys.includes(key)).length
    if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) safe = false
  }

  check(source, SNAPSHOT_KEYS)
  check(source.provenance, PROVENANCE_KEYS)
  check(source.provenance?.sourceChecks, REQUIRED_SOURCE_CHECKS)
  check(source.clientConfig, REQUIRED_CONFIG_BOOLEANS)
  check(source.flags, ['PMC_EXPENSE_CAPTURE_ENABLED', 'PMC_FINANCE_READS_ENABLED'])
  check(source.submitOnly, SUBMIT_ONLY_KEYS)
  check(source.submitOnly?.history, PERMISSION_RESULT_KEYS)
  check(source.submitOnly?.evidence, PERMISSION_RESULT_KEYS)
  check(source.financeRead, FINANCE_READ_KEYS)
  check(source.staging, STAGING_KEYS)
  check(source.recovery, RECOVERY_KEYS)
  check(source.topology, TOPOLOGY_KEYS)
  check(source.topology?.master, Object.keys(EXPECTED_MASTER_HEADERS))
  check(source.topology?.month, Object.keys(EXPECTED_MONTH_HEADERS))

  if (!stringArray(source.bindingNames)
    || !stringArray(source.financeRead?.requestedMonths)
    || !stringArray(source.topology?.staff)) safe = false
  if (stringArray(source.bindingNames)) {
    const bindings = new Set(source.bindingNames)
    if (source.bindingNames.length !== REQUIRED_BINDINGS.length
      || bindings.size !== REQUIRED_BINDINGS.length
      || REQUIRED_BINDINGS.some((name) => !bindings.has(name))) safe = false
  }
  if (stringArray(source.financeRead?.requestedMonths)) {
    if (source.financeRead.requestedMonths.length !== 1
      || safeMonth(source.financeRead.requestedMonths[0]) === null
      || source.financeRead.requestedMonths[0] !== source.financeRead.selectedMonth) safe = false
  }
  for (const name of Object.keys(EXPECTED_MASTER_HEADERS)) {
    if (!stringArray(source.topology?.master?.[name])) safe = false
  }
  for (const name of Object.keys(EXPECTED_MONTH_HEADERS)) {
    if (!stringArray(source.topology?.month?.[name])) safe = false
  }

  if (source.provenance?.schemaVersion !== 1
    || typeof source.provenance?.profile !== 'string'
    || typeof source.provenance?.target !== 'string'
    || typeof source.provenance?.environment !== 'string'
    || typeof source.provenance?.collectedAt !== 'string'
    || REQUIRED_SOURCE_CHECKS.some((name) => typeof source.provenance?.sourceChecks?.[name] !== 'boolean')
    || typeof source.healthStatus !== 'number'
    || REQUIRED_CONFIG_BOOLEANS.some((name) => typeof source.clientConfig?.[name] !== 'boolean')
    || typeof source.flags?.PMC_EXPENSE_CAPTURE_ENABLED !== 'string'
    || typeof source.flags?.PMC_FINANCE_READS_ENABLED !== 'string'
    || typeof source.submitOnly?.history?.status !== 'number'
    || typeof source.submitOnly?.history?.error !== 'string'
    || typeof source.submitOnly?.evidence?.status !== 'number'
    || typeof source.submitOnly?.evidence?.error !== 'string'
    || typeof source.financeRead?.selectedMonth !== 'string'
    || typeof source.staging?.deleteAfterDays !== 'number'
    || typeof source.recovery?.targetPath !== 'string'
    || typeof source.recovery?.audienceConfigured !== 'boolean'
    || typeof source.recovery?.identityConfigured !== 'boolean') safe = false
  return { unknownKeyCount, safe: safe && unknownKeyCount === 0 }
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function stringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function explicitBoolean(value) { return value === 'true' ? true : value === 'false' ? false : null }
function safeStatus(value) { return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : 0 }
function safeNonnegative(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function safeMonth(value) { return typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : null }
function safeLabel(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null }
function safeMaxAge(value) { return Number.isSafeInteger(value) && value >= 60 && value <= 900 ? value : 900 }
function validNow(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed : new Date(0) }
function same(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]) }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExpenseRuntimeCheck(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch(() => {
    process.stderr.write('Expense runtime check failed\n')
    process.exitCode = 2
  })
}
