#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { open, readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const executeFile = promisify(execFile)

export const BOOKING_ATTRIBUTION_CHECKER_VERSION = 'pmc-booking-attribution-v2/1'

export const CHECKER_MINI_APP_REQUEST_HEADERS_V1 = [
  'requestId', 'draftId', 'staffId', 'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash',
  'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus', 'safeErrorCode', 'updatedAt',
  'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt', 'processingStartedAt',
  'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken', 'evidenceProjectionHash',
]

export const CHECKER_MINI_APP_REQUEST_HEADERS_V2 = [
  'requestId', 'draftId', 'protocolVersion', 'staffId', 'recorderName', 'adminId', 'adminName',
  'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash', 'aeId', 'aeName',
  'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus',
  'safeErrorCode', 'updatedAt', 'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson',
  'taskName', 'queuedAt', 'processingStartedAt', 'processingLeaseUntil', 'lastProgressAt', 'attemptCount',
  'processingOwnerToken', 'evidenceProjectionHash',
]

export const CHECKER_BOOKING_MASTER_HEADERS_V1 = [
  'caseId', 'version', 'status', 'formResponseId', 'adminId', 'adminName', 'submitterEmail',
  'adminIdentityStatus', 'aeId', 'aeName', 'queueType', 'appointmentStatus',
  'appointmentProposedAt', 'appointmentConfirmedAt', 'appointmentConfirmedBy', 'customerName',
  'facebookName', 'customerNameNormalized', 'phoneNormalized', 'phoneMasked', 'doctorId', 'serviceId',
  'channelId', 'appointmentStart', 'appointmentEnd', 'depositAmount', 'depositReceivedAt',
  'depositExpiresAt', 'depositStatus', 'driveFolderId', 'driveFolderUrl', 'paymentEvidenceCount',
  'chatEvidenceCount', 'calendarId', 'calendarEventId', 'doctorLineGroupId', 'doctorLineNotifiedAt',
  'callStatus', 'firstCallWindowStart', 'firstCallWindowEnd', 'nextCallAt', 'lastCallAt',
  'callOwnerAdminId', 'jeraPaymentId', 'jeraStatus', 'jeraClosedAt', 'jeraActualRevenue',
  'jeraImportFileId', 'reconciliationStatus', 'commissionEligibility', 'commissionAmount', 'driveState',
  'calendarState', 'lineState', 'jeraImportState', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
]

export const CHECKER_BOOKING_MASTER_HEADERS_V2 = [
  ...CHECKER_BOOKING_MASTER_HEADERS_V1.slice(0, 4),
  'recorderId', 'recorderName', 'recorderSource',
  ...CHECKER_BOOKING_MASTER_HEADERS_V1.slice(4),
]

const REQUIRED_DEPLOYED_ENV_NAMES = [
  'PMC_MINI_APP_ENABLED', 'PMC_MINI_APP_ID', 'PMC_MINI_APP_LIFF_CHANNEL_ID',
  'PMC_SPREADSHEET_ID', 'PMC_DRIVE_INTAKE_FOLDER_ID', 'PMC_BOOKING_INGRESS_URL',
  'PMC_BOOKING_FALLBACK_FORM_URL', 'PMC_BOOKING_INGRESS_SECRET', 'PMC_MINI_APP_SIGNING_SECRET',
  'PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION',
]
const TERMINAL_PROTOCOL1_STATES = new Set([
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
])
const ALLOWED_STAGES = new Set(['BRIDGE', 'MIGRATION', 'CUTOVER'])
const QUEUE_ATTESTATION_PROPERTY = 'PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION'
const EXPECTED_QUEUE_DIGEST_PROPERTY = 'PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST'
const MIGRATION_MANIFEST_PROPERTY = 'PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST'
const ALLOWED_PROPERTY_KEYS = new Set([
  QUEUE_ATTESTATION_PROPERTY,
  EXPECTED_QUEUE_DIGEST_PROPERTY,
  MIGRATION_MANIFEST_PROPERTY,
  'PMC_BOOKING_ATTRIBUTION_APPROVED_FINGERPRINT',
])

export function inspectBookingAttributionCutover(observations, options) {
  const stage = ALLOWED_STAGES.has(options?.expectedStage) ? options.expectedStage : 'INVALID'
  const environment = isRecord(observations?.deployedEnvironment) ? observations.deployedEnvironment : {}
  const minimum = environment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION === undefined
    ? 1
    : environment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION === '1'
      ? 1
      : environment.PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION === '2' ? 2 : 0
  const supportedV2 = observations?.serverSupportedProtocol === undefined
    ? true
    : observations.serverSupportedProtocol === 2
  const prepareDisabled = observations?.prepareEnabled !== true
  const serviceReady = observations?.service?.exists === true
  const revisionReady = serviceReady
    && safeOpaque(observations?.service?.latestReadyRevision)
    && observations.service.latestReadyRevision === observations.expectedRevision
  const requiredEnvironmentNamesPresent = REQUIRED_DEPLOYED_ENV_NAMES.every((name) => presentEnvironmentBinding(environment[name]))
  const targetRevisionCompatible = revisionReady && supportedV2 && prepareDisabled

  const legacyHeaders = sameArray(observations?.requestHeaders, CHECKER_MINI_APP_REQUEST_HEADERS_V1)
    && sameArray(observations?.masterHeaders, CHECKER_BOOKING_MASTER_HEADERS_V1)
  const targetHeaders = sameArray(observations?.requestHeaders, CHECKER_MINI_APP_REQUEST_HEADERS_V2)
    && sameArray(observations?.masterHeaders, CHECKER_BOOKING_MASTER_HEADERS_V2)
  const schemaStatus = legacyHeaders ? 'LEGACY' : targetHeaders ? 'TARGET' : 'UNKNOWN'
  const exactHeaders = schemaStatus !== 'UNKNOWN'
  const zeroNonterminalProtocol1Drafts = exactHeaders
    && countNonterminalProtocol1(observations.requestHeaders, observations.requestRows) === 0

  const queueStatus = observations?.queue?.state === 'PAUSED'
    ? 'PAUSED'
    : observations?.queue?.state === 'RUNNING' ? 'RUNNING' : 'UNKNOWN'
  const queuePaused = queueStatus === 'PAUSED'
  const zeroActiveTasks = Array.isArray(observations?.queue?.tasks) && observations.queue.tasks.length === 0

  const deploymentPresent = observations?.appsScript?.deploymentPresent === true
  const versionCompatible = deploymentPresent
    && Number.isSafeInteger(observations?.appsScript?.deploymentVersion)
    && Number.isSafeInteger(observations?.appsScript?.minimumDualReaderVersion)
    && observations.appsScript.deploymentVersion >= observations.appsScript.minimumDualReaderVersion
  const dualReaderReady = versionCompatible && observations?.appsScript?.readerMode === 'DUAL'

  const scriptProperties = safePropertySnapshot(observations?.scriptProperties)
  const manifestStatus = migrationManifestStatus(scriptProperties[MIGRATION_MANIFEST_PROPERTY])
  const queueResourceDigest = queueDigest(observations?.queueResource)
  const installedAttestation = installedQueueAttestation(
    scriptProperties[QUEUE_ATTESTATION_PROPERTY],
    queueResourceDigest,
    observations?.now instanceof Date ? observations.now : new Date(),
  )
  const expectedQueueDigestInstalled = isSha256(queueResourceDigest)
    && scriptProperties[EXPECTED_QUEUE_DIGEST_PROPERTY] === queueResourceDigest
  const attestationInstalled = installedAttestation !== null
    && installedAttestation.state === 'PAUSED'
    && installedAttestation.activeTaskCount === 0

  const protocolStageReady = stage === 'CUTOVER' ? minimum === 2 : minimum === 1
  const sheetStageReady = stage === 'CUTOVER' ? targetHeaders : legacyHeaders
  const queueStageReady = stage === 'BRIDGE' || queuePaused && zeroActiveTasks
  const draftStageReady = stage === 'BRIDGE' || zeroNonterminalProtocol1Drafts
  const manifestStageReady = stage === 'CUTOVER' ? manifestStatus === 'COMPLETE' : manifestStatus === 'ABSENT'
  const baseReady = stage !== 'INVALID' && serviceReady && requiredEnvironmentNamesPresent
    && revisionReady && targetRevisionCompatible && supportedV2 && prepareDisabled
    && protocolStageReady && sheetStageReady && queueStageReady && draftStageReady
    && deploymentPresent && versionCompatible && dualReaderReady && manifestStageReady
  const attestationEligible = stage === 'MIGRATION' && baseReady
  const propertiesReady = stage !== 'MIGRATION' || attestationInstalled && expectedQueueDigestInstalled
  const ready = baseReady && propertiesReady
  const safeStatus = readinessStatus({
    stage,
    serviceReady,
    requiredEnvironmentNamesPresent,
    revisionReady,
    targetRevisionCompatible,
    supportedV2,
    prepareDisabled,
    protocolStageReady,
    exactHeaders,
    sheetStageReady,
    zeroNonterminalProtocol1Drafts,
    queueStageReady,
    deploymentPresent,
    versionCompatible,
    dualReaderReady,
    manifestStatus,
    manifestStageReady,
    propertiesReady,
  })
  const report = {
    mode: 'READ_ONLY',
    stage,
    ready,
    safeStatus,
    cloudRun: {
      serviceReady,
      requiredEnvironmentNamesPresent,
      bridgeRevisionReady: revisionReady,
      targetRevisionCompatible,
    },
    protocol: {
      supportedV2,
      minimumIs1: minimum === 1,
      minimumIs2: minimum === 2,
      prepareDisabled,
    },
    sheets: { schemaStatus, exactHeaders, zeroNonterminalProtocol1Drafts },
    queue: { status: queueStatus, paused: queuePaused, zeroActiveTasks },
    appsScript: { deploymentPresent, versionCompatible, dualReaderReady },
    migration: {
      manifestStatus,
      attestationInstalled,
      expectedQueueDigestInstalled,
      attestationEligible,
    },
  }
  return {
    report,
    attestation: attestationEligible
      ? createBookingQueueAttestation(observations.queueResource, {
        now: observations?.now instanceof Date ? observations.now : new Date(),
      })
      : null,
  }
}

export function createBookingQueueAttestation(queueResource, options = {}) {
  const queueResourceDigest = queueDigest(queueResource)
  if (!isSha256(queueResourceDigest)) throw new Error('QUEUE_RESOURCE_INVALID')
  const now = options.now instanceof Date ? options.now : new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('QUEUE_ATTESTATION_INVALID')
  const attestationId = options.attestationId ?? `attestation-${randomUUID()}`
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(attestationId)) throw new Error('QUEUE_ATTESTATION_INVALID')
  const unsigned = {
    version: 1,
    environment: 'production',
    queueResourceDigest,
    state: 'PAUSED',
    activeTaskCount: 0,
    verifiedAt: now.toISOString(),
    checkerVersion: BOOKING_ATTRIBUTION_CHECKER_VERSION,
    attestationId,
  }
  return { ...unsigned, digest: sha256(canonicalQueueAttestation(unsigned)) }
}

export async function writePrivateBookingQueueAttestation(filePath, attestation) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new Error('ATTESTATION_PATH_INVALID')
  let handle
  try {
    handle = await open(filePath, 'wx', 0o600)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') throw new Error('ATTESTATION_FILE_EXISTS')
    throw new Error('ATTESTATION_FILE_WRITE_FAILED')
  }
  try {
    await handle.writeFile(JSON.stringify(attestation), { encoding: 'utf8' })
    await handle.chmod(0o600)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const metadata = await stat(filePath)
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('ATTESTATION_FILE_NOT_PRIVATE')
}

export async function runPmcBookingAttributionV2Check(args, options = {}) {
  const parsed = parseArguments(args)
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr }
  if (parsed.help) {
    io.stdout.write('Usage: check-pmc-booking-attribution-v2 --allow-readonly-production --expected-stage BRIDGE|MIGRATION|CUTOVER --project <id> --region <region> --service <name> --queue <name> --expected-revision <name> --apps-script-id <id> --apps-script-deployment-id <id> --minimum-apps-script-version <number> --script-properties-file <absolute-private-file> [--write-attestation <absolute-new-file>] [--strict]\n')
    return 0
  }
  const collect = options.collect ?? collectLiveObservations
  const observations = await collect(parsed, options)
  const result = inspectBookingAttributionCutover(observations, { expectedStage: parsed.expectedStage })
  if (parsed.writeAttestation !== null) {
    if (!result.report.migration.attestationEligible || result.attestation === null) throw new Error('ATTESTATION_NOT_ELIGIBLE')
    await writePrivateBookingQueueAttestation(parsed.writeAttestation, result.attestation)
  }
  io.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`)
  return parsed.strict && !result.report.ready ? 1 : 0
}

async function collectLiveObservations(parsed, options = {}) {
  const execute = options.execute ?? runExternal
  const [service, queue, tasks, deployments, scriptProperties] = await Promise.all([
    safeJson(execute, ['gcloud', 'run', 'services', 'describe', parsed.service, '--region', parsed.region, '--project', parsed.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'queues', 'describe', parsed.queue, '--location', parsed.region, '--project', parsed.project, '--format=json']),
    safeJson(execute, ['gcloud', 'tasks', 'list', '--queue', parsed.queue, '--location', parsed.region, '--project', parsed.project, '--format=json']),
    safeText(execute, ['npx', 'clasp', 'deployments', parsed.appsScriptId]),
    readPrivatePropertySnapshot(parsed.scriptPropertiesFile),
  ])
  const deployedEnvironment = deployedEnvironmentFrom(service)
  const googleState = await (options.readGoogleState ?? readGoogleState)(deployedEnvironment)
  const deploymentVersion = appsScriptDeploymentVersion(deployments, parsed.appsScriptDeploymentId)
  return {
    now: new Date(),
    queueResource: { project: parsed.project, region: parsed.region, queue: parsed.queue },
    expectedRevision: parsed.expectedRevision,
    service: {
      exists: service !== null,
      latestReadyRevision: typeof service?.status?.latestReadyRevisionName === 'string'
        ? service.status.latestReadyRevisionName : null,
    },
    deployedEnvironment,
    requestHeaders: googleState.requestHeaders,
    masterHeaders: googleState.masterHeaders,
    requestRows: googleState.requestRows,
    queue: { state: queue?.state, tasks: Array.isArray(tasks) ? tasks : null },
    appsScript: {
      deploymentPresent: deploymentVersion !== null,
      deploymentVersion,
      minimumDualReaderVersion: parsed.minimumAppsScriptVersion,
      readerMode: deploymentVersion !== null && deploymentVersion >= parsed.minimumAppsScriptVersion ? 'DUAL' : 'UNKNOWN',
    },
    scriptProperties,
  }
}

async function readGoogleState(environment) {
  const spreadsheetId = opaqueEnvironmentValue(environment.PMC_SPREADSHEET_ID)
  const intakeFolderId = opaqueEnvironmentValue(environment.PMC_DRIVE_INTAKE_FOLDER_ID)
  const { createMiniAppGooglePorts } = await import('../dist-server/server/pmc-mini-app/googleClient.js')
  const sheets = createMiniAppGooglePorts({ spreadsheetId, intakeFolderId }).sheets
  const values = await sheets.batchGet(spreadsheetId, ["'MINI_APP_REQUESTS'!1:10001", "'BOOKING_MASTER'!1:1"])
  const request = values["'MINI_APP_REQUESTS'!1:10001"] ?? []
  const master = values["'BOOKING_MASTER'!1:1"] ?? []
  return {
    requestHeaders: (request[0] ?? []).map(String),
    requestRows: request.slice(1),
    masterHeaders: (master[0] ?? []).map(String),
  }
}

function parseArguments(args) {
  if (args.some((value) => /(?:token|secret|password|credential)/i.test(value))) {
    throw new Error('SENSITIVE_ARGUMENT_FORBIDDEN')
  }
  const parsed = {
    help: false,
    allowReadonlyProduction: false,
    expectedStage: null,
    project: null,
    region: null,
    service: null,
    queue: null,
    expectedRevision: null,
    appsScriptId: null,
    appsScriptDeploymentId: null,
    minimumAppsScriptVersion: null,
    scriptPropertiesFile: null,
    writeAttestation: null,
    strict: false,
  }
  const valueFlags = new Map([
    ['--expected-stage', 'expectedStage'], ['--project', 'project'], ['--region', 'region'],
    ['--service', 'service'], ['--queue', 'queue'], ['--expected-revision', 'expectedRevision'],
    ['--apps-script-id', 'appsScriptId'], ['--apps-script-deployment-id', 'appsScriptDeploymentId'],
    ['--minimum-apps-script-version', 'minimumAppsScriptVersion'],
    ['--script-properties-file', 'scriptPropertiesFile'], ['--write-attestation', 'writeAttestation'],
  ])
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--allow-readonly-production') parsed.allowReadonlyProduction = true
    else if (argument === '--strict') parsed.strict = true
    else if (valueFlags.has(argument) && args[index + 1] !== undefined) parsed[valueFlags.get(argument)] = args[++index]
    else throw new Error('INVALID_CUTOVER_CHECK_ARGUMENT')
  }
  if (parsed.help) return parsed
  if (!parsed.allowReadonlyProduction) throw new Error('READONLY_PRODUCTION_APPROVAL_REQUIRED')
  if (!ALLOWED_STAGES.has(parsed.expectedStage)) throw new Error('INVALID_CUTOVER_STAGE')
  for (const key of ['project', 'region', 'service', 'queue', 'expectedRevision', 'appsScriptId', 'appsScriptDeploymentId']) {
    if (!safeOpaque(parsed[key])) throw new Error('INVALID_CUTOVER_CHECK_ARGUMENT')
  }
  parsed.minimumAppsScriptVersion = Number(parsed.minimumAppsScriptVersion)
  if (!Number.isSafeInteger(parsed.minimumAppsScriptVersion) || parsed.minimumAppsScriptVersion < 1) {
    throw new Error('INVALID_CUTOVER_CHECK_ARGUMENT')
  }
  if (!privateAbsolutePath(parsed.scriptPropertiesFile)
    || parsed.writeAttestation !== null && !isAbsolute(parsed.writeAttestation)) {
    throw new Error('INVALID_CUTOVER_CHECK_ARGUMENT')
  }
  return parsed
}

function readinessStatus(value) {
  if (value.stage === 'INVALID') return 'INVALID_STAGE'
  if (value.manifestStatus === 'PREPARED' || value.manifestStatus === 'RESTORE_REQUIRED' || value.manifestStatus === 'INVALID') return 'RESTORE_REQUIRED'
  if (!value.protocolStageReady) return 'PROTOCOL_STAGE_MISMATCH'
  if (!value.exactHeaders || !value.sheetStageReady) return 'SHEET_SCHEMA_MISMATCH'
  if (!value.zeroNonterminalProtocol1Drafts && value.stage !== 'BRIDGE') return 'NONTERMINAL_PROTOCOL1_DRAFTS'
  if (!value.queueStageReady) return 'QUEUE_NOT_DRAINED'
  if (!value.serviceReady || !value.requiredEnvironmentNamesPresent || !value.revisionReady
    || !value.targetRevisionCompatible || !value.supportedV2 || !value.prepareDisabled) return 'DEPLOYMENT_INCOMPATIBLE'
  if (!value.deploymentPresent || !value.versionCompatible || !value.dualReaderReady) return 'APPS_SCRIPT_INCOMPATIBLE'
  if (!value.manifestStageReady) return 'MIGRATION_STATE_MISMATCH'
  if (!value.propertiesReady) return 'PROPERTY_INSTALL_REQUIRED'
  return 'READY'
}

function countNonterminalProtocol1(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return Number.POSITIVE_INFINITY
  const stateIndex = headers.indexOf('state')
  const protocolIndex = headers.indexOf('protocolVersion')
  if (stateIndex < 0) return Number.POSITIVE_INFINITY
  let count = 0
  for (const row of rows) {
    if (!Array.isArray(row) || row.every((cell) => String(cell ?? '').trim() === '')) continue
    const protocol = protocolIndex < 0 ? 1 : Number(row[protocolIndex])
    if (protocol === 1 && !TERMINAL_PROTOCOL1_STATES.has(String(row[stateIndex] ?? ''))) count += 1
  }
  return count
}

function installedQueueAttestation(raw, expectedQueueDigest, now) {
  if (typeof raw !== 'string' || raw.trim() === '' || !isSha256(expectedQueueDigest)) return null
  let candidate
  try { candidate = JSON.parse(raw) } catch { return null }
  if (!isRecord(candidate) || !sameKeySet(candidate, [
    'version', 'environment', 'queueResourceDigest', 'state', 'activeTaskCount',
    'verifiedAt', 'checkerVersion', 'attestationId', 'digest',
  ])) return null
  if (candidate.version !== 1 || candidate.environment !== 'production'
    || candidate.queueResourceDigest !== expectedQueueDigest
    || candidate.checkerVersion !== BOOKING_ATTRIBUTION_CHECKER_VERSION
    || candidate.state !== 'PAUSED' || candidate.activeTaskCount !== 0
    || !exactIso(candidate.verifiedAt) || !/^[A-Za-z0-9._:-]{8,128}$/.test(candidate.attestationId)
    || !isSha256(candidate.digest)) return null
  const verifiedAt = Date.parse(candidate.verifiedAt)
  if (!Number.isFinite(now.getTime()) || verifiedAt > now.getTime() + 60_000 || now.getTime() - verifiedAt > 10 * 60 * 1_000) return null
  const unsigned = {
    version: candidate.version,
    environment: candidate.environment,
    queueResourceDigest: candidate.queueResourceDigest,
    state: candidate.state,
    activeTaskCount: candidate.activeTaskCount,
    verifiedAt: candidate.verifiedAt,
    checkerVersion: candidate.checkerVersion,
    attestationId: candidate.attestationId,
  }
  return sha256(canonicalQueueAttestation(unsigned)) === candidate.digest ? candidate : null
}

function migrationManifestStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return 'ABSENT'
  if (typeof raw !== 'string') return 'INVALID'
  let candidate
  try { candidate = JSON.parse(raw) } catch { return 'INVALID' }
  if (!isRecord(candidate) || !sameKeySet(candidate, [
    'version', 'migration', 'state', 'sourceFingerprint', 'backupFileId', 'backupMimeType',
    'backupParentId', 'backupSourceFingerprint', 'expected', 'requestRowCount', 'masterRowCount',
    'queueAttestationDigest', 'preparedAt', 'updatedAt', 'completedAt', 'safeFailureCode', 'digest',
  ]) || !isRecord(candidate.expected) || !sameKeySet(candidate.expected, [
    'requestHeaderHash', 'masterHeaderHash', 'requestValueHash', 'masterValueHash',
    'requestNonTargetValueHash', 'masterNonTargetValueHash', 'requestPreservationHash', 'masterPreservationHash',
  ])) return 'INVALID'
  if (candidate.version !== 1 || candidate.migration !== 'PMC_BOOKING_ATTRIBUTION_V2'
    || !['PREPARED', 'COMPLETE', 'RESTORE_REQUIRED'].includes(candidate.state)
    || !isSha256(candidate.digest)) return 'INVALID'
  const expectedHashes = [
    candidate.expected.requestHeaderHash,
    candidate.expected.masterHeaderHash,
    candidate.expected.requestValueHash,
    candidate.expected.masterValueHash,
    candidate.expected.requestNonTargetValueHash,
    candidate.expected.masterNonTargetValueHash,
    candidate.expected.requestPreservationHash,
    candidate.expected.masterPreservationHash,
  ]
  if (!isSha256(candidate.sourceFingerprint)
    || !/^[A-Za-z0-9_-]{8,256}$/.test(candidate.backupFileId)
    || candidate.backupMimeType !== 'application/vnd.google-apps.spreadsheet'
    || !/^[A-Za-z0-9_-]{8,256}$/.test(candidate.backupParentId)
    || candidate.backupSourceFingerprint !== candidate.sourceFingerprint
    || !expectedHashes.every(isSha256)
    || !Number.isSafeInteger(candidate.requestRowCount) || candidate.requestRowCount < 0
    || !Number.isSafeInteger(candidate.masterRowCount) || candidate.masterRowCount < 0
    || !isSha256(candidate.queueAttestationDigest)
    || !exactIso(candidate.preparedAt) || !exactIso(candidate.updatedAt)
    || candidate.completedAt !== null && !exactIso(candidate.completedAt)
    || candidate.safeFailureCode !== null && !/^[A-Z0-9_]{1,80}$/.test(candidate.safeFailureCode)) return 'INVALID'
  if (candidate.state === 'PREPARED' && (candidate.completedAt !== null || candidate.safeFailureCode !== null)) return 'INVALID'
  if (candidate.state === 'COMPLETE' && (candidate.completedAt === null || candidate.safeFailureCode !== null)) return 'INVALID'
  if (candidate.state === 'RESTORE_REQUIRED' && (candidate.completedAt !== null || candidate.safeFailureCode === null)) return 'INVALID'
  if (Date.parse(candidate.updatedAt) < Date.parse(candidate.preparedAt)
    || candidate.completedAt !== null && Date.parse(candidate.completedAt) < Date.parse(candidate.preparedAt)) return 'INVALID'
  const payload = { ...candidate }
  delete payload.digest
  if (sha256(canonicalManifest(payload)) !== candidate.digest) return 'INVALID'
  return candidate.state
}

function canonicalQueueAttestation(value) {
  return JSON.stringify({
    version: value.version,
    environment: value.environment,
    queueResourceDigest: value.queueResourceDigest,
    state: value.state,
    activeTaskCount: value.activeTaskCount,
    verifiedAt: value.verifiedAt,
    checkerVersion: value.checkerVersion,
    attestationId: value.attestationId,
  })
}

function canonicalManifest(value) {
  return JSON.stringify({
    version: value.version,
    migration: value.migration,
    state: value.state,
    sourceFingerprint: value.sourceFingerprint,
    backupFileId: value.backupFileId,
    backupMimeType: value.backupMimeType,
    backupParentId: value.backupParentId,
    backupSourceFingerprint: value.backupSourceFingerprint,
    expected: {
      requestHeaderHash: value.expected.requestHeaderHash,
      masterHeaderHash: value.expected.masterHeaderHash,
      requestValueHash: value.expected.requestValueHash,
      masterValueHash: value.expected.masterValueHash,
      requestNonTargetValueHash: value.expected.requestNonTargetValueHash,
      masterNonTargetValueHash: value.expected.masterNonTargetValueHash,
      requestPreservationHash: value.expected.requestPreservationHash,
      masterPreservationHash: value.expected.masterPreservationHash,
    },
    requestRowCount: value.requestRowCount,
    masterRowCount: value.masterRowCount,
    queueAttestationDigest: value.queueAttestationDigest,
    preparedAt: value.preparedAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
    safeFailureCode: value.safeFailureCode,
  })
}

function queueDigest(value) {
  if (!isRecord(value) || !safeOpaque(value.project) || !safeOpaque(value.region) || !safeOpaque(value.queue)) return null
  return sha256(JSON.stringify({ project: value.project, region: value.region, queue: value.queue }))
}

function deployedEnvironmentFrom(service) {
  const containers = service?.spec?.template?.spec?.containers
  const entries = Array.isArray(containers) ? containers.flatMap((container) => Array.isArray(container?.env) ? container.env : []) : []
  return Object.fromEntries(entries
    .filter((entry) => typeof entry?.name === 'string')
    .map((entry) => [entry.name, typeof entry.value === 'string' ? entry.value : entry.valueFrom ? '__BOUND__' : '']))
}

function appsScriptDeploymentVersion(output, deploymentId) {
  if (typeof output !== 'string' || !safeOpaque(deploymentId)) return null
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(deploymentId)) continue
    const match = /@(\d+)\b/.exec(line)
    if (match && Number.isSafeInteger(Number(match[1]))) return Number(match[1])
  }
  return null
}

async function readPrivatePropertySnapshot(filePath) {
  const metadata = await stat(filePath)
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error('SCRIPT_PROPERTIES_FILE_NOT_PRIVATE')
  let parsed
  try { parsed = JSON.parse(await readFile(filePath, 'utf8')) } catch { throw new Error('SCRIPT_PROPERTIES_FILE_INVALID') }
  return safePropertySnapshot(parsed)
}

function safePropertySnapshot(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_PROPERTY_KEYS.has(key))) return {}
  const result = {}
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') result[key] = item
  return result
}

async function safeJson(execute, command) {
  try { return JSON.parse(await execute(command)) } catch { return null }
}

async function safeText(execute, command) {
  try { return await execute(command) } catch { return null }
}

async function runExternal(args) {
  const { stdout } = await executeFile(args[0], args.slice(1), { maxBuffer: 4_000_000 })
  return stdout
}

function opaqueEnvironmentValue(value) {
  if (!safeOpaque(value) || value === '__BOUND__') throw new Error('GOOGLE_STATE_UNAVAILABLE')
  return value
}

function presentEnvironmentBinding(value) {
  return typeof value === 'string' && value.length > 0
}

function privateAbsolutePath(value) {
  return typeof value === 'string' && isAbsolute(value)
}

function safeOpaque(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value)
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

function sameKeySet(value, expected) {
  return sameArray(Object.keys(value).sort(), [...expected].sort())
}

function exactIso(value) {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPmcBookingAttributionV2Check(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch(() => {
      process.stderr.write('PMC Booking attribution-v2 check failed\n')
      process.exitCode = 2
    })
}
