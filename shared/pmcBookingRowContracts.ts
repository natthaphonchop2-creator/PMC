import { MINI_APP_ASYNC_REQUEST_HEADERS_V1 } from './pmcMiniAppAsyncState.js'
import type { BookingProtocolVersion, RecorderSource } from './pmcBookingProtocol.js'

const legacyAeNameIndex = MINI_APP_ASYNC_REQUEST_HEADERS_V1.indexOf('aeName')
export const PMC_MINI_APP_REQUEST_HEADERS_V2 = [
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(0, 2),
  'protocolVersion',
  MINI_APP_ASYNC_REQUEST_HEADERS_V1[2],
  'recorderName', 'adminId', 'adminName',
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(3, legacyAeNameIndex),
  'aeId',
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(legacyAeNameIndex),
] as const

export const PMC_BOOKING_MASTER_COLUMNS_V1 = [
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
] as const

export const PMC_BOOKING_MASTER_COLUMNS_V2 = [
  ...PMC_BOOKING_MASTER_COLUMNS_V1.slice(0, 4),
  'recorderId', 'recorderName', 'recorderSource',
  ...PMC_BOOKING_MASTER_COLUMNS_V1.slice(4),
] as const

export type PmcMiniAppRequestState =
  | 'DRAFT' | 'UPLOADING' | 'READY_TO_CONFIRM' | 'QUEUED' | 'PROCESSING' | 'RETRYING'
  | 'CONFIRMING' | 'CONFIRMED' | 'CONFIRMED_WITH_RETRY' | 'NEEDS_REVIEW'
  | 'FAILED_RETRYABLE' | 'CANCELLED' | 'EXPIRED'

export interface PmcMiniAppTargetRequestRecord {
  requestId: string
  draftId: string
  protocolVersion: BookingProtocolVersion
  staffId: string
  recorderName: string
  adminId: string
  adminName: string
  lineUserIdHash: string
  state: PmcMiniAppRequestState
  retentionState: '' | 'PENDING_APPROVAL'
  version: number
  payloadHash: string | null
  aeId: string | null
  aeName: string
  customerName: string
  facebookName: string
  phoneNormalized: string
  doctorId: string
  serviceId: string
  queueType: 'NORMAL' | 'AUTO'
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  evidenceCount: number
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  taskName: string | null
  queuedAt: string | null
  processingStartedAt: string | null
  processingLeaseUntil: string | null
  lastProgressAt: string | null
  attemptCount: number
  processingOwnerToken: string | null
  evidenceProjectionHash: string | null
  createdAt: string
  confirmedAt: string | null
  caseId: string | null
  confirmationStatus: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT' | null
  safeErrorCode: string | null
  updatedAt: string
}

export interface PmcBookingMasterTargetRecord extends Record<string, unknown> {
  caseId: string
  formResponseId: string
  recorderId: string | null
  recorderName: string
  recorderSource: RecorderSource
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string | null
}

const REQUEST_STATES = new Set<PmcMiniAppRequestState>([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING',
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])
const TERMINAL_P1_STATES = new Set<PmcMiniAppRequestState>([
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
])
const BOOKING_STATUSES = new Set([
  'FORM_SUBMITTED', 'VALIDATION_ERROR', 'TIME_CONFLICT', 'BOOKING_CONFIRMED', 'CALL_ACTIVE',
  'CALL_OVERDUE', 'REBOOKED', 'CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M', 'RECONCILIATION',
])

export function parsePmcMiniAppTargetRequestRow(row: readonly unknown[]): PmcMiniAppTargetRequestRecord {
  if (row.length === 0 || row.length > PMC_MINI_APP_REQUEST_HEADERS_V2.length) {
    throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  }
  const cell = (header: string): unknown => row[(PMC_MINI_APP_REQUEST_HEADERS_V2 as readonly string[]).indexOf(header)]
  const value: PmcMiniAppTargetRequestRecord = {
    requestId: text(cell('requestId')), draftId: text(cell('draftId')),
    protocolVersion: numberValue(cell('protocolVersion')) as BookingProtocolVersion,
    staffId: text(cell('staffId')), recorderName: text(cell('recorderName')),
    adminId: text(cell('adminId')), adminName: text(cell('adminName')),
    lineUserIdHash: text(cell('lineUserIdHash')), state: text(cell('state')) as PmcMiniAppRequestState,
    retentionState: text(cell('retentionState')) as '' | 'PENDING_APPROVAL',
    version: numberValue(cell('version')), payloadHash: nullableText(cell('payloadHash')),
    aeId: nullableText(cell('aeId')), aeName: text(cell('aeName')),
    customerName: text(cell('customerName')), facebookName: text(cell('facebookName')),
    phoneNormalized: text(cell('phoneNormalized')), doctorId: text(cell('doctorId')),
    serviceId: text(cell('serviceId')), queueType: text(cell('queueType')) as 'NORMAL' | 'AUTO',
    appointmentDate: nullableText(cell('appointmentDate')), appointmentTime: nullableText(cell('appointmentTime')),
    depositAmount: numberValue(cell('depositAmount')), channelId: text(cell('channelId')),
    paymentEvidenceFileIds: stringArray(cell('paymentEvidenceFileIdsJson'), safeId),
    chatEvidenceFileIds: stringArray(cell('chatEvidenceFileIdsJson'), safeId),
    evidenceCount: numberValue(cell('evidenceCount')),
    paymentEvidenceObjectKeys: stringArray(cell('paymentEvidenceObjectKeysJson'), safeObjectKey),
    chatEvidenceObjectKeys: stringArray(cell('chatEvidenceObjectKeysJson'), safeObjectKey),
    taskName: nullableText(cell('taskName')), queuedAt: nullableText(cell('queuedAt')),
    processingStartedAt: nullableText(cell('processingStartedAt')),
    processingLeaseUntil: nullableText(cell('processingLeaseUntil')),
    lastProgressAt: nullableText(cell('lastProgressAt')), attemptCount: numberValue(cell('attemptCount')),
    processingOwnerToken: nullableText(cell('processingOwnerToken')),
    evidenceProjectionHash: nullableText(cell('evidenceProjectionHash')),
    createdAt: text(cell('createdAt')), confirmedAt: nullableText(cell('confirmedAt')),
    caseId: nullableText(cell('caseId')),
    confirmationStatus: nullableText(cell('confirmationStatus')) as PmcMiniAppTargetRequestRecord['confirmationStatus'],
    safeErrorCode: nullableText(cell('safeErrorCode')), updatedAt: text(cell('updatedAt')),
  }
  assertPmcMiniAppTargetRequestRecord(value)
  return cloneRequest(value)
}

export function assertPmcMiniAppTargetRequestRecord(value: PmcMiniAppTargetRequestRecord): void {
  if (!safeId(value.requestId) || !safeId(value.draftId) || !safeId(value.staffId)) throw new Error('INVALID_DRAFT_ID')
  if (value.protocolVersion !== 1 && value.protocolVersion !== 2) throw new Error('INVALID_BOOKING_PROTOCOL_VERSION')
  if (!boundedName(value.recorderName) || reserved(value.staffId, value.recorderName)) {
    throw new Error('INVALID_BOOKING_ATTRIBUTION_SNAPSHOT')
  }
  const canOmitPreSaveAdmin = value.protocolVersion === 2
    && ['DRAFT', 'UPLOADING', 'CANCELLED', 'EXPIRED'].includes(value.state)
    && value.payloadHash === null
  const missingAdmin = value.adminId === '' && value.adminName === ''
  if (missingAdmin && !canOmitPreSaveAdmin) throw new Error('BOOKING_ADMIN_REQUIRED')
  if (!missingAdmin && (!safeId(value.adminId) || !boundedName(value.adminName)
    || reserved(value.adminId, value.adminName))) throw new Error('INVALID_BOOKING_ATTRIBUTION_ID')
  if (value.aeId === null) {
    const validNullName = value.protocolVersion === 1
      ? value.aeName === '' || value.aeName === 'ไม่ระบุ'
      : value.aeName === 'ไม่ระบุ'
    if (!validNullName) throw new Error('INVALID_BOOKING_ATTRIBUTION_SNAPSHOT')
  } else if (!safeId(value.aeId) || !boundedName(value.aeName)
    || reserved(value.aeId, value.aeName)) throw new Error('INVALID_BOOKING_ATTRIBUTION_ID')
  if (value.protocolVersion === 1 && !TERMINAL_P1_STATES.has(value.state)) {
    throw new Error('NONTERMINAL_LEGACY_DRAFTS')
  }
  if (!safeHash(value.lineUserIdHash)) throw new Error('INVALID_LINE_USER_HASH')
  if (!REQUEST_STATES.has(value.state)) throw new Error('INVALID_DRAFT_STATE')
  if (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL') throw new Error('INVALID_RETENTION_STATE')
  if (!Number.isSafeInteger(value.version) || value.version < 1) throw new Error('INVALID_DRAFT_VERSION')
  if (value.payloadHash !== null && !safeHash(value.payloadHash)) throw new Error('INVALID_PAYLOAD_HASH')
  if (value.confirmationStatus !== null
    && !['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(value.confirmationStatus)) {
    throw new Error('INVALID_CONFIRMATION_STATUS')
  }
  if (value.queueType !== 'NORMAL' && value.queueType !== 'AUTO') throw new Error('INVALID_QUEUE_TYPE')
  if (!Number.isFinite(value.depositAmount) || value.depositAmount < 0) throw new Error('INVALID_DEPOSIT_AMOUNT')
  if (!Number.isSafeInteger(value.evidenceCount) || value.evidenceCount < 0 || value.evidenceCount > 20) {
    throw new Error('INVALID_EVIDENCE_COUNT')
  }
  for (const list of [
    value.paymentEvidenceFileIds, value.chatEvidenceFileIds,
    value.paymentEvidenceObjectKeys, value.chatEvidenceObjectKeys,
  ]) {
    if (list.length > 10 || new Set(list).size !== list.length) throw new Error('INVALID_EVIDENCE_COUNT')
  }
  if (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0) throw new Error('INVALID_ATTEMPT_COUNT')
  if (value.processingOwnerToken !== null && !/^[A-Za-z0-9_-]{16,128}$/.test(value.processingOwnerToken)) {
    throw new Error('INVALID_PROCESSING_OWNER')
  }
  if (value.evidenceProjectionHash !== null && !/^[A-Za-z0-9_-]{43}$/.test(value.evidenceProjectionHash)) {
    throw new Error('INVALID_EVIDENCE_PROJECTION_HASH')
  }
  if (value.caseId !== null && !safeCaseId(value.caseId)) throw new Error('INVALID_CASE_ID')
  if (value.safeErrorCode !== null && !/^[A-Z0-9_]{1,80}$/.test(value.safeErrorCode)) throw new Error('INVALID_SAFE_ERROR')
  if (value.appointmentDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value.appointmentDate)) throw new Error('INVALID_APPOINTMENT_DATE')
  if (value.appointmentTime !== null && !/^\d{2}:\d{2}$/.test(value.appointmentTime)) throw new Error('INVALID_APPOINTMENT_TIME')
  for (const date of [
    value.createdAt, value.updatedAt, value.confirmedAt, value.queuedAt,
    value.processingStartedAt, value.processingLeaseUntil, value.lastProgressAt,
  ]) {
    if (date !== null && !validIso(date)) throw new Error('INVALID_DRAFT_DATE')
  }
  if (value.taskName !== null && !/^[A-Za-z0-9._:/-]{1,512}$/.test(value.taskName)) throw new Error('INVALID_DRAFT_FIELD')
  for (const field of [value.customerName, value.facebookName, value.phoneNormalized]) {
    if (typeof field !== 'string' || field.length > 512 || hasControl(field)) throw new Error('INVALID_DRAFT_FIELD')
  }
  for (const id of [value.doctorId, value.serviceId, value.channelId]) {
    if (id && !safeConfigId(id)) throw new Error('INVALID_DRAFT_FIELD')
  }
}

export function assertUniquePmcMiniAppTargetRequestRecords(
  records: readonly PmcMiniAppTargetRequestRecord[],
): void {
  requireUnique(records.map((value) => value.requestId), 'DUPLICATE_REQUEST_ID')
  requireUnique(records.map((value) => value.draftId), 'DUPLICATE_DRAFT_ID')
  requireUnique(records.flatMap((value) => value.caseId ? [value.caseId] : []), 'DUPLICATE_CASE_ID')
}

export function parsePmcBookingMasterTargetRow(row: readonly unknown[]): PmcBookingMasterTargetRecord {
  if (row.length === 0 || row.length > PMC_BOOKING_MASTER_COLUMNS_V2.length) {
    throw new Error('BOOKING_MASTER_CORRUPT_ROW')
  }
  const record = Object.fromEntries(
    PMC_BOOKING_MASTER_COLUMNS_V2.map((header, index) => [header, row[index] ?? '']),
  )
  assertPmcBookingMasterTargetRecord(record)
  return normalizeMaster(record)
}

export function assertPmcBookingMasterTargetRecord(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => !(PMC_BOOKING_MASTER_COLUMNS_V2 as readonly string[]).includes(key))) {
    throw new Error('BOOKING_MASTER_CORRUPT_ROW')
  }
  const caseId = text(value.caseId)
  const formResponseId = text(value.formResponseId)
  const recorderId = nullableText(value.recorderId)
  const recorderName = text(value.recorderName)
  const recorderSource = text(value.recorderSource) as RecorderSource
  const adminId = text(value.adminId)
  const adminName = text(value.adminName)
  const aeId = nullableText(value.aeId)
  const aeName = nullableText(value.aeName)
  if (!safeCaseId(caseId) || !safeText(formResponseId, 512)) throw new Error('BOOKING_MASTER_ID_INVALID')
  if (!Number.isSafeInteger(numberValue(value.version)) || numberValue(value.version) < 1) throw new Error('BOOKING_MASTER_VERSION_INVALID')
  if (!BOOKING_STATUSES.has(text(value.status))) throw new Error('BOOKING_MASTER_STATUS_INVALID')
  if (!['VERIFIED_LINE', 'LEGACY_ASSUMED_ADMIN', 'FORM_EMAIL_MATCH', 'FORM_UNRESOLVED'].includes(recorderSource)) {
    throw new Error('BOOKING_MASTER_RECORDER_INVALID')
  }
  if (recorderSource === 'FORM_UNRESOLVED') {
    if (recorderId !== null || recorderName !== 'Google Form') throw new Error('BOOKING_MASTER_RECORDER_INVALID')
  } else if (!recorderId || !safeId(recorderId) || !boundedName(recorderName) || reserved(recorderId, recorderName)) {
    throw new Error('BOOKING_MASTER_RECORDER_INVALID')
  }
  if (!safeId(adminId) || !boundedName(adminName) || reserved(adminId, adminName)) {
    throw new Error('BOOKING_MASTER_ADMIN_INVALID')
  }
  if (recorderSource === 'LEGACY_ASSUMED_ADMIN' && (recorderId !== adminId || recorderName !== adminName)) {
    throw new Error('BOOKING_MASTER_RECORDER_INVALID')
  }
  if (aeId === null) {
    if (aeName !== null && aeName !== 'ไม่ระบุ') throw new Error('BOOKING_MASTER_AE_INVALID')
  } else if (!safeId(aeId) || !aeName || !boundedName(aeName) || reserved(aeId, aeName)) {
    throw new Error('BOOKING_MASTER_AE_INVALID')
  }
  if (!['SHARED_ACCOUNT', 'VERIFIED_EMAIL', 'SELECTED_ADMIN'].includes(text(value.adminIdentityStatus))) {
    throw new Error('BOOKING_MASTER_ADMIN_INVALID')
  }
  if (!['NORMAL', 'AUTO'].includes(text(value.queueType))
    || !['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(text(value.appointmentStatus))) {
    throw new Error('BOOKING_MASTER_APPOINTMENT_INVALID')
  }
  if (!Number.isFinite(numberValue(value.depositAmount)) || numberValue(value.depositAmount) < 0) {
    throw new Error('BOOKING_MASTER_AMOUNT_INVALID')
  }
  for (const count of [value.paymentEvidenceCount, value.chatEvidenceCount]) {
    const number = numberValue(count)
    if (!Number.isSafeInteger(number) || number < 0 || number > 1_000) throw new Error('BOOKING_MASTER_EVIDENCE_INVALID')
  }
  if (!safeText(text(value.customerName), 512) || !/^\d{9,10}$/.test(text(value.phoneNormalized))) {
    throw new Error('BOOKING_MASTER_CUSTOMER_INVALID')
  }
  for (const id of [text(value.doctorId), text(value.serviceId)]) {
    if (!safeConfigId(id)) throw new Error('BOOKING_MASTER_CONFIG_INVALID')
  }
  const channelId = nullableText(value.channelId)
  if (channelId !== null && !safeConfigId(channelId)) throw new Error('BOOKING_MASTER_CONFIG_INVALID')
  for (const date of [value.depositReceivedAt, value.depositExpiresAt, value.createdAt, value.updatedAt]) {
    if (!validIso(text(date))) throw new Error('BOOKING_MASTER_DATE_INVALID')
  }
  const owner = nullableText(value.callOwnerAdminId)
  if (owner !== null && owner !== adminId) throw new Error('BOOKING_MASTER_ADMIN_INVALID')
}

export function assertUniquePmcBookingMasterTargetRecords(
  records: readonly PmcBookingMasterTargetRecord[],
): void {
  requireUnique(records.map((value) => value.caseId), 'DUPLICATE_CASE_ID')
  requireUnique(records.map((value) => value.formResponseId), 'DUPLICATE_FORM_IDENTITY')
}

export function assertPmcBookingTargetCorrelation(
  requests: readonly PmcMiniAppTargetRequestRecord[],
  masters: readonly PmcBookingMasterTargetRecord[],
): void {
  for (const request of requests) {
    if (!request.caseId) continue
    const matches = masters.filter((master) => master.caseId === request.caseId)
    if (matches.length !== 1
      || matches[0].recorderSource !== 'VERIFIED_LINE'
      || !matches[0].formResponseId.startsWith('mini:')
      || !matchesMiniFormIdentity(matches[0].formResponseId, request)
      || !sameAttribution(request, matches[0])) {
      throw new Error('BOOKING_TARGET_CORRELATION_INVALID')
    }
  }
  for (const master of masters) {
    if (master.recorderSource !== 'VERIFIED_LINE') continue
    if (!master.formResponseId.startsWith('mini:')) throw new Error('BOOKING_TARGET_CORRELATION_INVALID')
    const byCase = requests.filter((request) => request.caseId === master.caseId)
    const byForm = requests.filter((request) => matchesMiniFormIdentity(master.formResponseId, request))
    if (byCase.length !== 1 || byForm.length !== 1 || byCase[0] !== byForm[0]
      || !sameAttribution(byCase[0], master)) {
      throw new Error('BOOKING_TARGET_CORRELATION_INVALID')
    }
  }
}

function matchesMiniFormIdentity(formResponseId: string, request: PmcMiniAppTargetRequestRecord): boolean {
  if (formResponseId === `mini:${request.requestId}`) return true
  const current = /^mini:v2:([A-Za-z0-9_-]+):([A-Za-z0-9_-]{4,128})$/.exec(formResponseId)
  return Boolean(current
    && current[1] === base64UrlAscii(request.requestId)
    && request.payloadHash !== null
    && current[2] === request.payloadHash)
}

function sameAttribution(
  request: PmcMiniAppTargetRequestRecord,
  master: PmcBookingMasterTargetRecord,
): boolean {
  if (master.recorderId !== request.staffId
    || master.recorderName !== request.recorderName
    || master.adminId !== request.adminId
    || master.adminName !== request.adminName
    || master.aeId !== request.aeId) return false
  if (request.aeId !== null) return master.aeName === request.aeName
  const requestNullName = request.protocolVersion === 1
    ? request.aeName === '' || request.aeName === 'ไม่ระบุ'
    : request.aeName === 'ไม่ระบุ'
  const masterNullName = master.aeName === null || master.aeName === 'ไม่ระบุ'
  return requestNullName && masterNullName
}

function base64UrlAscii(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let output = ''
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index)
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : 0
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | (second >> 4)]
    if (index + 1 < value.length) output += alphabet[((second & 15) << 2) | (third >> 6)]
    if (index + 2 < value.length) output += alphabet[third & 63]
  }
  return output
}

function normalizeMaster(value: Record<string, unknown>): PmcBookingMasterTargetRecord {
  return {
    ...value,
    caseId: text(value.caseId),
    formResponseId: text(value.formResponseId),
    recorderId: nullableText(value.recorderId),
    recorderName: text(value.recorderName),
    recorderSource: text(value.recorderSource) as RecorderSource,
    adminId: text(value.adminId),
    adminName: text(value.adminName),
    aeId: nullableText(value.aeId),
    aeName: nullableText(value.aeName),
  }
}

function cloneRequest(value: PmcMiniAppTargetRequestRecord): PmcMiniAppTargetRequestRecord {
  return {
    ...value,
    paymentEvidenceFileIds: [...value.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...value.chatEvidenceFileIds],
    paymentEvidenceObjectKeys: [...value.paymentEvidenceObjectKeys],
    chatEvidenceObjectKeys: [...value.chatEvidenceObjectKeys],
  }
}

function requireUnique(values: readonly string[], error: string): void {
  if (values.some((value) => !value) || new Set(values).size !== values.length) throw new Error(error)
}

function stringArray(value: unknown, validItem: (item: string) => boolean): string[] {
  let parsed: unknown = value
  if (!Array.isArray(parsed)) {
    try { parsed = JSON.parse(text(value) || '[]') } catch { throw new Error('MINI_APP_STORE_CORRUPT_ROW') }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !validItem(item))) {
    throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  }
  return [...parsed]
}

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullableText(value: unknown): string | null { const result = text(value); return result ? result : null }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function safeId(value: string): boolean { return /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeHash(value: string): boolean { return /^[A-Za-z0-9_-]{4,128}$/.test(value) }
function safeCaseId(value: string): boolean { return /^PMC-\d{6}-\d{4,}$/.test(value) }
function safeObjectKey(value: string): boolean { return /^[A-Za-z0-9._/-]{1,512}$/.test(value) }
function safeConfigId(value: string): boolean {
  return value.length > 0 && value.length <= 124 && value.trim() === value && !hasControl(value)
}
function boundedName(value: string): boolean {
  return value.length > 0 && value.length <= 120 && value.trim() === value && !hasControl(value)
}
function safeText(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && !hasControl(value)
}
function reserved(id: string, name: string): boolean {
  return id.trim().toUpperCase() === 'NONE' || name.trim() === 'ไม่ระบุ'
}
function hasControl(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0)
    if (point !== undefined && (point < 32 || point === 127)) return true
  }
  return false
}
function validIso(value: string): boolean { return Boolean(value) && Number.isFinite(Date.parse(value)) }
