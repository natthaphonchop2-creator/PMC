import type { MiniAppSheetsPort } from './googleClient.js'
import { MINI_APP_ASYNC_REQUEST_HEADERS_V1 } from '../../shared/pmcMiniAppAsyncState.js'
import type { BookingProtocolVersion } from '../../shared/pmcBookingProtocol.js'
import type { MiniAppAttributionOption } from './contracts.js'

export type MiniAppRequestState =
  | 'DRAFT'
  | 'UPLOADING'
  | 'READY_TO_CONFIRM'
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'CONFIRMED_WITH_RETRY'
  | 'NEEDS_REVIEW'
  | 'FAILED_RETRYABLE'
  | 'CANCELLED'
  | 'EXPIRED'

export type MiniAppRetentionState = '' | 'PENDING_APPROVAL'

export interface MiniAppRequestRecord {
  requestId: string
  draftId: string
  protocolVersion: BookingProtocolVersion
  staffId: string
  recorderName: string
  adminId: string
  adminName: string
  lineUserIdHash: string
  state: MiniAppRequestState
  retentionState: MiniAppRetentionState
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

export interface MiniAppStaffRecord {
  id: string
  name: string
  email: string
  lineUserId: string
  canCloseBooking: boolean
  canBeAe: boolean
  canManageStock: boolean
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
  active: true
  profileImageUrl: string | null
}

export interface MiniAppBookingConfigProjection {
  doctors: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string; durationMinutes: number }>
  channels: Array<{ id: string; name: string }>
  admins: MiniAppAttributionOption[]
  aes: MiniAppAttributionOption[]
}

export type MiniAppDraftPatch = Partial<Pick<MiniAppRequestRecord,
  | 'state'
  | 'retentionState'
  | 'payloadHash'
  | 'protocolVersion'
  | 'recorderName'
  | 'adminId'
  | 'adminName'
  | 'aeId'
  | 'aeName'
  | 'customerName'
  | 'facebookName'
  | 'phoneNormalized'
  | 'doctorId'
  | 'serviceId'
  | 'queueType'
  | 'appointmentDate'
  | 'appointmentTime'
  | 'depositAmount'
  | 'channelId'
  | 'paymentEvidenceFileIds'
  | 'chatEvidenceFileIds'
  | 'evidenceCount'
  | 'paymentEvidenceObjectKeys'
  | 'chatEvidenceObjectKeys'
  | 'taskName'
  | 'queuedAt'
  | 'processingStartedAt'
  | 'processingLeaseUntil'
  | 'lastProgressAt'
  | 'attemptCount'
  | 'confirmedAt'
  | 'caseId'
  | 'safeErrorCode'
  | 'updatedAt'
>>

export interface MiniAppStore {
  getActiveStaffByLineUserId(lineUserId: string): Promise<MiniAppStaffRecord | null>
  getActiveBookingConfig(): Promise<MiniAppBookingConfigProjection>
  createDraft(draft: MiniAppRequestRecord): Promise<MiniAppRequestRecord>
  getDraft(draftId: string): Promise<MiniAppRequestRecord | null>
  updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch): Promise<MiniAppRequestRecord>
  markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string): Promise<MiniAppRequestRecord>
  claimConfirmation(requestId: string, payloadHash: string): Promise<{ claimed: true; draft: MiniAppRequestRecord } | { claimed: false; caseId: string | null; status: MiniAppRequestRecord['confirmationStatus'] }>
  completeConfirmation(requestId: string, caseId: string, confirmedAt: string, status: NonNullable<MiniAppRequestRecord['confirmationStatus']>): Promise<MiniAppRequestRecord>
  failConfirmation(requestId: string, safeErrorCode: string, updatedAt: string): Promise<MiniAppRequestRecord>
}

export interface MiniAppResumeStore {
  getLatestActiveDraftByStaff(staffId: string): Promise<MiniAppRequestRecord | null>
}

export interface MiniAppEnrollmentStore {
  listUnlinkedBookingStaff(): Promise<Array<{ id: string; name: string }>>
  linkLineUserToStaff(staffId: string, lineUserId: string): Promise<MiniAppStaffRecord>
  consumeEnrollmentAttempt(
    lineUserIdHash: string,
    pinAccepted: boolean,
    nowIso: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
}

const legacyAeNameIndex = MINI_APP_ASYNC_REQUEST_HEADERS_V1.indexOf('aeName')
export const ATTRIBUTION_V2_REQUEST_HEADERS = [
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(0, 2),
  'protocolVersion',
  MINI_APP_ASYNC_REQUEST_HEADERS_V1[2],
  'recorderName', 'adminId', 'adminName',
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(3, legacyAeNameIndex),
  'aeId',
  ...MINI_APP_ASYNC_REQUEST_HEADERS_V1.slice(legacyAeNameIndex),
] as const

export const MINI_APP_REQUEST_HEADERS = ATTRIBUTION_V2_REQUEST_HEADERS

export const MINI_APP_LINK_ATTEMPT_HEADERS = [
  'lineUserIdHash', 'failureCount', 'windowStartedAt', 'lockedUntil', 'lastAttemptAt',
] as const

const REQUEST_TAB = 'MINI_APP_REQUESTS'
const REQUEST_HEADER_RANGE = `'${REQUEST_TAB}'!1:1`
const REQUEST_RANGE = `'${REQUEST_TAB}'!A2:${columnName(MINI_APP_REQUEST_HEADERS.length)}`
const STAFF_RANGE = "'CONFIG_STAFF'!A2:L"
const LINK_ATTEMPT_TAB = 'MINI_APP_LINK_ATTEMPTS'
const LINK_ATTEMPT_RANGE = `'${LINK_ATTEMPT_TAB}'!A2:${columnName(MINI_APP_LINK_ATTEMPT_HEADERS.length)}`
const DOCTORS_RANGE = "'CONFIG_DOCTORS'!A2:E"
const SERVICES_RANGE = "'CONFIG_SERVICES'!A2:D"
const CHANNELS_RANGE = "'CONFIG_CHANNELS'!A2:C"
const requestMutexes = new Map<string, Promise<void>>()
const ENROLLMENT_MAX_FAILURES = 5
const ENROLLMENT_WINDOW_MS = 15 * 60 * 1_000

interface EnrollmentAttemptRecord {
  lineUserIdHash: string
  failureCount: number
  windowStartedAt: string
  lockedUntil: string
  lastAttemptAt: string
}

type RequestSchema = 'V1' | 'V2'

export function createGoogleMiniAppStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): MiniAppStore & MiniAppEnrollmentStore & MiniAppResumeStore {
  const { spreadsheetId, sheets } = input
  const mutexKey = `pmc-mini-app:${spreadsheetId}`

  async function readRequestTable(): Promise<{
    schema: RequestSchema
    rows: Array<{ rowNumber: number; value: MiniAppRequestRecord }>
  }> {
    const response = await sheets.batchGet(spreadsheetId, [REQUEST_HEADER_RANGE, REQUEST_RANGE])
    const schema = requestSchema((response[REQUEST_HEADER_RANGE]?.[0] ?? []).map(String))
    return {
      schema,
      rows: (response[REQUEST_RANGE] ?? []).map((row, index) => ({
        rowNumber: index + 2,
        value: requestFromRow(row, schema),
      })),
    }
  }

  async function writeRequest(rowNumber: number, value: MiniAppRequestRecord, schema: RequestSchema): Promise<void> {
    const headers = requestHeaders(schema)
    const end = columnName(headers.length)
    await sheets.update(spreadsheetId, `'${REQUEST_TAB}'!A${rowNumber}:${end}${rowNumber}`, [requestToRow(value, schema)])
  }

  async function readStaffRows(): Promise<Array<{ rowNumber: number; row: unknown[] }>> {
    const response = await sheets.batchGet(spreadsheetId, [STAFF_RANGE])
    return (response[STAFF_RANGE] ?? []).map((row, index) => ({ rowNumber: index + 2, row }))
  }

  async function readLinkAttemptRows(): Promise<Array<{ rowNumber: number; value: EnrollmentAttemptRecord }>> {
    const response = await sheets.batchGet(spreadsheetId, [LINK_ATTEMPT_RANGE])
    return (response[LINK_ATTEMPT_RANGE] ?? []).flatMap((row, index) => {
      const value = enrollmentAttemptFromRow(row)
      return value ? [{ rowNumber: index + 2, value }] : []
    })
  }

  async function writeLinkAttempt(rowNumber: number | null, value: EnrollmentAttemptRecord): Promise<void> {
    const row = enrollmentAttemptToRow(value)
    if (rowNumber === null) {
      await sheets.append(spreadsheetId, `'${LINK_ATTEMPT_TAB}'!A:${columnName(MINI_APP_LINK_ATTEMPT_HEADERS.length)}`, [row])
      return
    }
    await sheets.update(
      spreadsheetId,
      `'${LINK_ATTEMPT_TAB}'!A${rowNumber}:${columnName(MINI_APP_LINK_ATTEMPT_HEADERS.length)}${rowNumber}`,
      [row],
    )
  }

  async function mutateDraft(
    draftId: string,
    expectedVersion: number,
    patch: MiniAppDraftPatch,
  ): Promise<MiniAppRequestRecord> {
    return withMutex(mutexKey, async () => {
      const table = await readRequestTable()
      const row = table.rows.find(({ value }) => value.draftId === draftId)
      if (!row) throw new Error('DRAFT_NOT_FOUND')
      if (row.value.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
      if (isDraftIdentityBound(row.value)
        && Object.keys(patch).some((key) => BOUND_DRAFT_MUTATION_KEYS.has(key))
        && !isExactFailedConfirmationCancellation(row.value, patch)) {
        throw new Error('BOUND_DRAFT_MUTATION_FORBIDDEN')
      }
      const next = normalizeRequestRecord({ ...row.value, ...patch, version: row.value.version + 1 })
      await writeRequest(row.rowNumber, next, table.schema)
      return next
    })
  }

  return {
    async getActiveStaffByLineUserId(lineUserId) {
      if (!safeLineUserId(lineUserId)) return null
      const response = await sheets.batchGet(spreadsheetId, [STAFF_RANGE])
      for (const row of response[STAFF_RANGE] ?? []) {
        const staff = staffFromRow(row)
        if (staff?.lineUserId === lineUserId && staff.active) return staff
      }
      return null
    },
    async getActiveBookingConfig() {
      const ranges = [STAFF_RANGE, DOCTORS_RANGE, SERVICES_RANGE, CHANNELS_RANGE]
      const response = await sheets.batchGet(spreadsheetId, ranges)
      const attributionChoices = (response[STAFF_RANGE] ?? [])
        .map(staffCandidateFromRow)
        .filter((staff): staff is MiniAppStaffRecord => Boolean(staff?.canBeAe && !isReservedAttributionOption(staff)))
        .map(({ id, name }) => ({ id, name }))
      const doctors = (response[DOCTORS_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const active = booleanValue(row[4])
        return active && safeConfigId(id) && name ? [{ id, name }] : []
      })
      const services = (response[SERVICES_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const durationMinutes = numberValue(row[2]); const active = booleanValue(row[3])
        return active && safeConfigId(id) && name && Number.isSafeInteger(durationMinutes) && durationMinutes > 0
          ? [{ id, name, durationMinutes }] : []
      })
      const channels = (response[CHANNELS_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const active = booleanValue(row[2])
        return active && safeConfigId(id) && name ? [{ id, name }] : []
      })
      return { doctors, services, channels, admins: [...attributionChoices], aes: [...attributionChoices] }
    },
    async listUnlinkedBookingStaff() {
      return (await readStaffRows())
        .map(({ row }) => staffCandidateFromRow(row))
        .filter((staff): staff is MiniAppStaffRecord => Boolean(staff?.canCloseBooking && !staff.lineUserId))
        .map(({ id, name }) => ({ id, name }))
    },
    async linkLineUserToStaff(staffId, lineUserId) {
      if (!safeId(staffId) || !safeLineUserId(lineUserId)) throw new Error('INVALID_ENROLLMENT_IDENTITY')
      return withMutex(mutexKey, async () => {
        const rows = await readStaffRows()
        const candidates = rows.flatMap(({ rowNumber, row }) => {
          const staff = staffCandidateFromRow(row)
          return staff ? [{ rowNumber, row, staff }] : []
        })
        const existingIdentity = candidates.find(({ staff }) => staff.lineUserId === lineUserId)
        if (existingIdentity) {
          if (existingIdentity.staff.id === staffId) return existingIdentity.staff
          throw new Error('LINE_USER_ALREADY_LINKED')
        }
        const target = candidates.find(({ staff }) => staff.id === staffId && staff.canCloseBooking)
        if (!target) throw new Error('ENROLLMENT_STAFF_NOT_AVAILABLE')
        if (target.staff.lineUserId) throw new Error('STAFF_ALREADY_LINKED')
        const nextRow = [...target.row]
        while (nextRow.length < 12) nextRow.push('')
        nextRow[3] = lineUserId
        await sheets.update(spreadsheetId, `'CONFIG_STAFF'!A${target.rowNumber}:L${target.rowNumber}`, [nextRow.slice(0, 12)])
        const linked = staffFromRow(nextRow)
        if (!linked) throw new Error('ENROLLMENT_STAFF_UPDATE_FAILED')
        return linked
      })
    },
    async consumeEnrollmentAttempt(lineUserIdHash, pinAccepted, nowIso) {
      if (!safeHash(lineUserIdHash)) throw new Error('INVALID_ENROLLMENT_HASH')
      const nowMs = Date.parse(nowIso)
      if (!Number.isFinite(nowMs)) throw new Error('INVALID_ENROLLMENT_TIME')
      return withMutex(mutexKey, async () => {
        const rows = await readLinkAttemptRows()
        const existing = rows.find(({ value }) => value.lineUserIdHash === lineUserIdHash)
        const lockedUntilMs = existing?.value.lockedUntil ? Date.parse(existing.value.lockedUntil) : 0
        if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
          return { allowed: false, retryAfterSeconds: Math.ceil((lockedUntilMs - nowMs) / 1_000) }
        }
        if (pinAccepted) {
          if (existing) await writeLinkAttempt(existing.rowNumber, {
            lineUserIdHash, failureCount: 0, windowStartedAt: nowIso, lockedUntil: '', lastAttemptAt: nowIso,
          })
          return { allowed: true, retryAfterSeconds: 0 }
        }
        const windowStartedMs = existing?.value.windowStartedAt ? Date.parse(existing.value.windowStartedAt) : 0
        const sameWindow = Number.isFinite(windowStartedMs) && nowMs - windowStartedMs >= 0 && nowMs - windowStartedMs < ENROLLMENT_WINDOW_MS
        const failureCount = (sameWindow ? existing?.value.failureCount ?? 0 : 0) + 1
        const lockedUntil = failureCount >= ENROLLMENT_MAX_FAILURES
          ? new Date(nowMs + ENROLLMENT_WINDOW_MS).toISOString()
          : ''
        await writeLinkAttempt(existing?.rowNumber ?? null, {
          lineUserIdHash,
          failureCount,
          windowStartedAt: sameWindow ? existing!.value.windowStartedAt : nowIso,
          lockedUntil,
          lastAttemptAt: nowIso,
        })
        return {
          allowed: false,
          retryAfterSeconds: lockedUntil ? Math.ceil((Date.parse(lockedUntil) - nowMs) / 1_000) : 0,
        }
      })
    },
    async createDraft(draft) {
      const normalized = normalizeRequestRecord(draft)
      return withMutex(mutexKey, async () => {
        const table = await readRequestTable()
        const duplicate = table.rows.find(({ value }) => value.requestId === normalized.requestId || value.draftId === normalized.draftId)
        if (duplicate) {
          if (duplicate.value.requestId === normalized.requestId && duplicate.value.draftId === normalized.draftId) return duplicate.value
          throw new Error('DRAFT_ID_CONFLICT')
        }
        const headers = requestHeaders(table.schema)
        await sheets.append(spreadsheetId, `'${REQUEST_TAB}'!A:${columnName(headers.length)}`, [requestToRow(normalized, table.schema)])
        return normalized
      })
    },
    async getDraft(draftId) {
      if (!safeId(draftId)) return null
      return (await readRequestTable()).rows.find(({ value }) => value.draftId === draftId)?.value ?? null
    },
    async getLatestActiveDraftByStaff(staffId) {
      if (!safeId(staffId)) return null
      return (await readRequestTable()).rows
        .map(({ value }) => value)
        .filter((draft) => draft.staffId === staffId && ACTIVE_RESUMABLE_STATES.has(draft.state) && validIso(draft.updatedAt))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null
    },
    updateDraft: mutateDraft,
    async markRetentionPending(draftId, expectedVersion, updatedAt) {
      return mutateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
    },
    async claimConfirmation(requestId, payloadHash) {
      if (!safeId(requestId) || !safeHash(payloadHash)) throw new Error('INVALID_CONFIRMATION_CLAIM')
      return withMutex(mutexKey, async () => {
        const table = await readRequestTable()
        const row = table.rows.find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.payloadHash && row.value.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
        if (row.value.state === 'CONFIRMED') return { claimed: false as const, caseId: row.value.caseId, status: row.value.confirmationStatus }
        if (row.value.state === 'CONFIRMING') return { claimed: false as const, caseId: null, status: null }
        if (row.value.state !== 'READY_TO_CONFIRM' && row.value.state !== 'FAILED_RETRYABLE') throw new Error('DRAFT_NOT_READY')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMING', payloadHash, safeErrorCode: null, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next, table.schema)
        return { claimed: true as const, draft: next }
      })
    },
    async completeConfirmation(requestId, caseId, confirmedAt, status) {
      if (!safeId(requestId) || !safeCaseId(caseId)) throw new Error('INVALID_CONFIRMATION_RESULT')
      return withMutex(mutexKey, async () => {
        const table = await readRequestTable()
        const row = table.rows.find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.state === 'CONFIRMED' && row.value.caseId === caseId) return row.value
        if (row.value.state !== 'CONFIRMING') throw new Error('DRAFT_NOT_CONFIRMING')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMED', caseId, confirmedAt, confirmationStatus: status, updatedAt: confirmedAt,
          safeErrorCode: null, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next, table.schema)
        return next
      })
    },
    async failConfirmation(requestId, safeErrorCode, updatedAt) {
      if (!safeId(requestId) || !safeError(safeErrorCode)) throw new Error('INVALID_CONFIRMATION_FAILURE')
      return withMutex(mutexKey, async () => {
        const table = await readRequestTable()
        const row = table.rows.find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.state !== 'CONFIRMING') throw new Error('DRAFT_NOT_CONFIRMING')
        const next = normalizeRequestRecord({
          ...row.value, state: 'FAILED_RETRYABLE', safeErrorCode, updatedAt, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next, table.schema)
        return next
      })
    },
  }
}

function requestSchema(headers: readonly string[]): RequestSchema {
  if (sameHeader(headers, MINI_APP_ASYNC_REQUEST_HEADERS_V1)) return 'V1'
  if (sameHeader(headers, ATTRIBUTION_V2_REQUEST_HEADERS)) return 'V2'
  throw new Error('incompatible header: MINI_APP_REQUESTS')
}

function requestHeaders(schema: RequestSchema): readonly string[] {
  return schema === 'V1' ? MINI_APP_ASYNC_REQUEST_HEADERS_V1 : ATTRIBUTION_V2_REQUEST_HEADERS
}

function sameHeader(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requestToRow(value: MiniAppRequestRecord, schema: RequestSchema): unknown[] {
  if (schema === 'V1' && value.protocolVersion !== 1 || schema === 'V2' && value.protocolVersion !== 2) {
    throw new Error('BOOKING_PROTOCOL_SCHEMA_MISMATCH')
  }
  return requestHeaders(schema).map((header) => requestCell(value, header))
}

function requestCell(value: MiniAppRequestRecord, header: string): unknown {
  const cells: Record<string, unknown> = {
    requestId: value.requestId,
    draftId: value.draftId,
    protocolVersion: value.protocolVersion,
    staffId: value.staffId,
    recorderName: value.recorderName,
    adminId: value.adminId,
    adminName: value.adminName,
    lineUserIdHash: value.lineUserIdHash,
    state: value.state,
    retentionState: value.retentionState,
    version: value.version,
    payloadHash: value.payloadHash ?? '',
    aeId: value.aeId ?? '',
    aeName: value.aeName,
    customerName: value.customerName,
    facebookName: value.facebookName,
    phoneNormalized: value.phoneNormalized,
    doctorId: value.doctorId,
    serviceId: value.serviceId,
    queueType: value.queueType,
    appointmentDate: value.appointmentDate ?? '',
    appointmentTime: value.appointmentTime ?? '',
    depositAmount: value.depositAmount,
    channelId: value.channelId,
    paymentEvidenceFileIdsJson: JSON.stringify(value.paymentEvidenceFileIds),
    chatEvidenceFileIdsJson: JSON.stringify(value.chatEvidenceFileIds),
    evidenceCount: value.evidenceCount,
    createdAt: value.createdAt,
    confirmedAt: value.confirmedAt ?? '',
    caseId: value.caseId ?? '',
    confirmationStatus: value.confirmationStatus ?? '',
    safeErrorCode: value.safeErrorCode ?? '',
    updatedAt: value.updatedAt,
    paymentEvidenceObjectKeysJson: JSON.stringify(value.paymentEvidenceObjectKeys),
    chatEvidenceObjectKeysJson: JSON.stringify(value.chatEvidenceObjectKeys),
    taskName: value.taskName ?? '',
    queuedAt: value.queuedAt ?? '',
    processingStartedAt: value.processingStartedAt ?? '',
    processingLeaseUntil: value.processingLeaseUntil ?? '',
    lastProgressAt: value.lastProgressAt ?? '',
    attemptCount: value.attemptCount,
    processingOwnerToken: value.processingOwnerToken ?? '',
    evidenceProjectionHash: value.evidenceProjectionHash ?? '',
  }
  if (!(header in cells)) throw new Error('incompatible header: MINI_APP_REQUESTS')
  return cells[header]
}

function requestFromRow(row: unknown[], schema: RequestSchema): MiniAppRequestRecord {
  if (row.length === 0) throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  const headers = requestHeaders(schema)
  const cell = (header: string): unknown => row[headers.indexOf(header)]
  const staffId = text(cell('staffId'))
  return normalizeRequestRecord({
    requestId: text(cell('requestId')), draftId: text(cell('draftId')),
    protocolVersion: schema === 'V1' ? 1 : numberValue(cell('protocolVersion')) as BookingProtocolVersion,
    staffId,
    recorderName: schema === 'V1' ? '' : text(cell('recorderName')),
    adminId: schema === 'V1' ? staffId : text(cell('adminId')),
    adminName: schema === 'V1' ? '' : text(cell('adminName')),
    lineUserIdHash: text(cell('lineUserIdHash')),
    state: text(cell('state')) as MiniAppRequestState, retentionState: text(cell('retentionState')) as MiniAppRetentionState,
    version: numberValue(cell('version')), payloadHash: nullableText(cell('payloadHash')),
    aeId: schema === 'V1' ? null : nullableText(cell('aeId')), aeName: text(cell('aeName')),
    customerName: text(cell('customerName')), facebookName: text(cell('facebookName')),
    phoneNormalized: text(cell('phoneNormalized')), doctorId: text(cell('doctorId')), serviceId: text(cell('serviceId')),
    queueType: text(cell('queueType')) as 'NORMAL' | 'AUTO', appointmentDate: nullableText(cell('appointmentDate')),
    appointmentTime: nullableText(cell('appointmentTime')), depositAmount: numberValue(cell('depositAmount')),
    channelId: text(cell('channelId')), paymentEvidenceFileIds: stringArray(cell('paymentEvidenceFileIdsJson')),
    chatEvidenceFileIds: stringArray(cell('chatEvidenceFileIdsJson')), evidenceCount: numberValue(cell('evidenceCount')),
    createdAt: text(cell('createdAt')), confirmedAt: nullableText(cell('confirmedAt')), caseId: nullableText(cell('caseId')),
    confirmationStatus: nullableText(cell('confirmationStatus')) as MiniAppRequestRecord['confirmationStatus'],
    safeErrorCode: nullableText(cell('safeErrorCode')), updatedAt: text(cell('updatedAt')),
    paymentEvidenceObjectKeys: stringArray(cell('paymentEvidenceObjectKeysJson'), safeObjectKey),
    chatEvidenceObjectKeys: stringArray(cell('chatEvidenceObjectKeysJson'), safeObjectKey),
    taskName: nullableText(cell('taskName')), queuedAt: nullableText(cell('queuedAt')),
    processingStartedAt: nullableText(cell('processingStartedAt')), processingLeaseUntil: nullableText(cell('processingLeaseUntil')),
    lastProgressAt: nullableText(cell('lastProgressAt')),
    attemptCount: cell('attemptCount') === undefined ? 0 : numberValue(cell('attemptCount')),
    processingOwnerToken: nullableText(cell('processingOwnerToken')),
    evidenceProjectionHash: nullableText(cell('evidenceProjectionHash')),
  })
}

function normalizeRequestRecord(value: MiniAppRequestRecord): MiniAppRequestRecord {
  if (!safeId(value.requestId) || !safeId(value.draftId) || !safeId(value.staffId)) throw new Error('INVALID_DRAFT_ID')
  if (value.protocolVersion !== 1 && value.protocolVersion !== 2) throw new Error('INVALID_BOOKING_PROTOCOL_VERSION')
  if (value.protocolVersion === 2) {
    const canOmitPreSaveAdmin = ['DRAFT', 'UPLOADING', 'CANCELLED', 'EXPIRED'].includes(value.state)
      && value.payloadHash === null
    const missingAdmin = value.adminId === '' && value.adminName === ''
    if (!value.recorderName || value.recorderName.length > 120) throw new Error('INVALID_BOOKING_ATTRIBUTION_SNAPSHOT')
    if (missingAdmin && !canOmitPreSaveAdmin) throw new Error('BOOKING_ADMIN_REQUIRED')
    if (!missingAdmin && (!safeId(value.adminId) || isReservedAttributionId(value.adminId)
      || !value.adminName || value.adminName.length > 120)) throw new Error('INVALID_BOOKING_ATTRIBUTION_ID')
    if (value.aeId === null) {
      if (value.aeName !== 'ไม่ระบุ') throw new Error('INVALID_BOOKING_ATTRIBUTION_SNAPSHOT')
    } else if (!safeId(value.aeId) || isReservedAttributionId(value.aeId)
      || !value.aeName || value.aeName === 'ไม่ระบุ' || value.aeName.length > 120) {
      throw new Error('INVALID_BOOKING_ATTRIBUTION_ID')
    }
  }
  if (!safeHash(value.lineUserIdHash)) throw new Error('INVALID_LINE_USER_HASH')
  if (!REQUEST_STATES.has(value.state)) throw new Error('INVALID_DRAFT_STATE')
  if (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL') throw new Error('INVALID_RETENTION_STATE')
  if (!Number.isSafeInteger(value.version) || value.version < 1) throw new Error('INVALID_DRAFT_VERSION')
  if (value.payloadHash !== null && !safeHash(value.payloadHash)) throw new Error('INVALID_PAYLOAD_HASH')
  if (value.confirmationStatus !== null && !['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(value.confirmationStatus)) {
    throw new Error('INVALID_CONFIRMATION_STATUS')
  }
  if (value.queueType !== 'NORMAL' && value.queueType !== 'AUTO') throw new Error('INVALID_QUEUE_TYPE')
  if (!Number.isFinite(value.depositAmount) || value.depositAmount < 0) throw new Error('INVALID_DEPOSIT_AMOUNT')
  if (!Number.isSafeInteger(value.evidenceCount) || value.evidenceCount < 0 || value.evidenceCount > 20) throw new Error('INVALID_EVIDENCE_COUNT')
  if (value.paymentEvidenceFileIds.length > 10 || value.chatEvidenceFileIds.length > 10 || value.paymentEvidenceObjectKeys.length > 10 || value.chatEvidenceObjectKeys.length > 10) {
    throw new Error('INVALID_EVIDENCE_COUNT')
  }
  if (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0) throw new Error('INVALID_ATTEMPT_COUNT')
  if (value.processingOwnerToken !== null && value.processingOwnerToken !== undefined
    && !/^[A-Za-z0-9_-]{16,128}$/.test(value.processingOwnerToken)) throw new Error('INVALID_PROCESSING_OWNER')
  if (value.evidenceProjectionHash !== null && value.evidenceProjectionHash !== undefined
    && !/^[A-Za-z0-9_-]{43}$/.test(value.evidenceProjectionHash)) throw new Error('INVALID_EVIDENCE_PROJECTION_HASH')
  for (const field of [value.taskName, value.queuedAt, value.processingStartedAt, value.processingLeaseUntil, value.lastProgressAt]) {
    if (field !== null && (typeof field !== 'string' || field.length > 512)) throw new Error('INVALID_DRAFT_FIELD')
  }
  for (const field of [value.recorderName, value.adminId, value.adminName, value.aeName, value.customerName, value.facebookName, value.phoneNormalized, value.doctorId, value.serviceId, value.channelId, value.createdAt, value.updatedAt]) {
    if (typeof field !== 'string' || field.length > 512) throw new Error('INVALID_DRAFT_FIELD')
  }
  return structuredClone({
    ...value,
    processingOwnerToken: value.processingOwnerToken ?? null,
    evidenceProjectionHash: value.evidenceProjectionHash ?? null,
  })
}

function staffFromRow(row: unknown[]): MiniAppStaffRecord | null {
  const staff = staffCandidateFromRow(row)
  return staff && safeLineUserId(staff.lineUserId) ? staff : null
}

function staffCandidateFromRow(row: unknown[]): MiniAppStaffRecord | null {
  const [
    id, name, email, lineUserId, canCloseBooking, canBeAe, active, profileImageUrl, canManageStock,
    canSubmitExpense, canViewFinance, canManageExpense,
  ] = row
  const normalizedLineUserId = text(lineUserId)
  if (!safeId(text(id)) || !text(name) || (normalizedLineUserId && !safeLineUserId(normalizedLineUserId)) || !booleanValue(active)) return null
  return {
    id: text(id), name: text(name), email: text(email), lineUserId: normalizedLineUserId,
    canCloseBooking: booleanValue(canCloseBooking), canBeAe: booleanValue(canBeAe), canManageStock: booleanValue(canManageStock), active: true,
    canSubmitExpense: financePermissionValue(canSubmitExpense),
    canViewFinance: financePermissionValue(canViewFinance),
    canManageExpense: financePermissionValue(canManageExpense),
    profileImageUrl: nullableText(profileImageUrl),
  }
}

function isReservedAttributionOption(staff: Pick<MiniAppStaffRecord, 'id' | 'name'>): boolean {
  return isReservedAttributionId(staff.id) || staff.name.trim() === 'ไม่ระบุ'
}

function isReservedAttributionId(value: string): boolean {
  return value.trim().toUpperCase() === 'NONE'
}

function enrollmentAttemptFromRow(row: unknown[]): EnrollmentAttemptRecord | null {
  const lineUserIdHash = text(row[0])
  const failureCount = numberValue(row[1])
  const windowStartedAt = text(row[2])
  const lockedUntil = text(row[3])
  const lastAttemptAt = text(row[4])
  if (!safeHash(lineUserIdHash) || !Number.isSafeInteger(failureCount) || failureCount < 0 || failureCount > ENROLLMENT_MAX_FAILURES) return null
  if (!validIso(windowStartedAt) || (lockedUntil && !validIso(lockedUntil)) || !validIso(lastAttemptAt)) return null
  return { lineUserIdHash, failureCount, windowStartedAt, lockedUntil, lastAttemptAt }
}

function enrollmentAttemptToRow(value: EnrollmentAttemptRecord): unknown[] {
  return [value.lineUserIdHash, value.failureCount, value.windowStartedAt, value.lockedUntil, value.lastAttemptAt]
}

const REQUEST_STATES = new Set<MiniAppRequestState>([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING', 'CONFIRMED',
  'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])

const ACTIVE_RESUMABLE_STATES = new Set<MiniAppRequestState>([
  'DRAFT', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'NEEDS_REVIEW',
])
const IDENTITY_BOUND_STATES = new Set<MiniAppRequestState>([
  'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW',
  'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])
const BOUND_DRAFT_MUTATION_KEYS = new Set<string>([
  'state', 'retentionState', 'payloadHash', 'protocolVersion', 'recorderName', 'adminId', 'adminName', 'aeId', 'aeName',
  'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId',
  'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIds',
  'chatEvidenceFileIds', 'evidenceCount', 'paymentEvidenceObjectKeys', 'chatEvidenceObjectKeys', 'taskName', 'queuedAt',
  'processingStartedAt', 'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken',
  'evidenceProjectionHash',
  'confirmedAt', 'caseId', 'safeErrorCode',
])

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullableText(value: unknown): string | null { const result = text(value); return result ? result : null }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function booleanValue(value: unknown): boolean { return value === true || String(value).toLowerCase() === 'true' }
function financePermissionValue(value: unknown): boolean { return value === true }
function safeId(value: string): boolean { return /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeConfigId(value: string): boolean {
  return value.length > 0 && value.length <= 124 && value.trim() === value && hasNoControlCharacters(value)
}
function hasNoControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return false
  }
  return true
}
function safeLineUserId(value: string): boolean { return /^[A-Za-z0-9_-]{2,128}$/.test(value) }
function safeHash(value: string): boolean { return /^[A-Za-z0-9_-]{4,128}$/.test(value) }
function safeCaseId(value: string): boolean { return /^PMC-\d{6}-\d{4,}$/.test(value) }
function safeError(value: string): boolean { return /^[A-Z0-9_]{1,80}$/.test(value) }
function validIso(value: string): boolean { return Boolean(value) && Number.isFinite(Date.parse(value)) }

function isDraftIdentityBound(draft: MiniAppRequestRecord): boolean {
  return draft.payloadHash !== null || IDENTITY_BOUND_STATES.has(draft.state)
}

function isExactFailedConfirmationCancellation(draft: MiniAppRequestRecord, patch: MiniAppDraftPatch): boolean {
  const keys = Object.keys(patch)
  return draft.state === 'FAILED_RETRYABLE'
    && patch.state === 'CANCELLED'
    && patch.retentionState === 'PENDING_APPROVAL'
    && typeof patch.updatedAt === 'string'
    && validIso(patch.updatedAt)
    && keys.length === 3
    && keys.every((key) => key === 'state' || key === 'retentionState' || key === 'updatedAt')
}

function safeObjectKey(value: string): boolean { return /^[A-Za-z0-9._/-]{1,512}$/.test(value) }

function stringArray(value: unknown, validItem: (item: string) => boolean = safeId): string[] {
  if (Array.isArray(value)) return value.map(text)
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !validItem(item))) throw new Error('invalid')
    return parsed
  } catch {
    throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  }
}

function columnName(count: number): string {
  let value = count
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

async function withMutex<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = requestMutexes.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  requestMutexes.set(key, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (requestMutexes.get(key) === tail) requestMutexes.delete(key)
  }
}
