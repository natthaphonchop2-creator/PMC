import type { MiniAppSheetsPort } from './googleClient.js'
import { bookingPayloadHash } from './bookingDraft.js'
import { canTransitionAsyncBooking } from './asyncState.js'

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
  staffId: string
  lineUserIdHash: string
  state: MiniAppRequestState
  retentionState: MiniAppRetentionState
  version: number
  payloadHash: string | null
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
  active: true
  profileImageUrl: string | null
}

export interface MiniAppBookingConfigProjection {
  doctors: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string; durationMinutes: number }>
  channels: Array<{ id: string; name: string }>
  aes: Array<{ id: string; name: string }>
}

export type MiniAppDraftPatch = Partial<Pick<MiniAppRequestRecord,
  | 'state'
  | 'retentionState'
  | 'payloadHash'
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

export interface AsyncMiniAppStore {
  getLatestActiveDraftByStaff(staffId: string): Promise<MiniAppRequestRecord | null>
  queueDraft(requestId: string, payloadHash: string, taskName: string, queuedAt: string): Promise<MiniAppRequestRecord>
  claimProcessing(input: {
    requestId: string
    draftId: string
    leaseUntil: string
    nowIso: string
  }): Promise<{ claimed: boolean; draft: MiniAppRequestRecord }>
  markAsyncRetry(requestId: string, safeErrorCode: string, nowIso: string): Promise<MiniAppRequestRecord>
  completeAsyncBooking(input: {
    requestId: string
    caseId: string
    status: NonNullable<MiniAppRequestRecord['confirmationStatus']>
    projectionState: 'CONFIRMED' | 'CONFIRMED_WITH_RETRY'
    nowIso: string
  }): Promise<MiniAppRequestRecord>
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

export const MINI_APP_REQUEST_HEADERS = [
  'requestId', 'draftId', 'staffId', 'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash',
  'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus', 'safeErrorCode', 'updatedAt',
  'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt', 'processingStartedAt',
  'processingLeaseUntil', 'lastProgressAt', 'attemptCount',
] as const

export const MINI_APP_LINK_ATTEMPT_HEADERS = [
  'lineUserIdHash', 'failureCount', 'windowStartedAt', 'lockedUntil', 'lastAttemptAt',
] as const

const REQUEST_TAB = 'MINI_APP_REQUESTS'
const REQUEST_RANGE = `'${REQUEST_TAB}'!A2:${columnName(MINI_APP_REQUEST_HEADERS.length)}`
const STAFF_RANGE = "'CONFIG_STAFF'!A2:H"
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

export function createGoogleMiniAppStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): MiniAppStore & MiniAppEnrollmentStore & AsyncMiniAppStore {
  const { spreadsheetId, sheets } = input
  const mutexKey = `pmc-mini-app:${spreadsheetId}`

  async function readRequestRows(): Promise<Array<{ rowNumber: number; value: MiniAppRequestRecord }>> {
    const response = await sheets.batchGet(spreadsheetId, [REQUEST_RANGE])
    return (response[REQUEST_RANGE] ?? []).map((row, index) => ({ rowNumber: index + 2, value: requestFromRow(row) }))
  }

  async function writeRequest(rowNumber: number, value: MiniAppRequestRecord): Promise<void> {
    const end = columnName(MINI_APP_REQUEST_HEADERS.length)
    await sheets.update(spreadsheetId, `'${REQUEST_TAB}'!A${rowNumber}:${end}${rowNumber}`, [requestToRow(value)])
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
      const row = (await readRequestRows()).find(({ value }) => value.draftId === draftId)
      if (!row) throw new Error('DRAFT_NOT_FOUND')
      if (row.value.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
      const next = normalizeRequestRecord({ ...row.value, ...patch, version: row.value.version + 1 })
      await writeRequest(row.rowNumber, next)
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
      const aes = (response[STAFF_RANGE] ?? [])
        .map(staffCandidateFromRow)
        .filter((staff): staff is MiniAppStaffRecord => Boolean(staff?.canBeAe))
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
      return { doctors, services, channels, aes }
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
        while (nextRow.length < 8) nextRow.push('')
        nextRow[3] = lineUserId
        await sheets.update(spreadsheetId, `'CONFIG_STAFF'!A${target.rowNumber}:H${target.rowNumber}`, [nextRow.slice(0, 8)])
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
        const rows = await readRequestRows()
        const duplicate = rows.find(({ value }) => value.requestId === normalized.requestId || value.draftId === normalized.draftId)
        if (duplicate) {
          if (duplicate.value.requestId === normalized.requestId && duplicate.value.draftId === normalized.draftId) return duplicate.value
          throw new Error('DRAFT_ID_CONFLICT')
        }
        await sheets.append(spreadsheetId, `'${REQUEST_TAB}'!A:${columnName(MINI_APP_REQUEST_HEADERS.length)}`, [requestToRow(normalized)])
        return normalized
      })
    },
    async getDraft(draftId) {
      if (!safeId(draftId)) return null
      return (await readRequestRows()).find(({ value }) => value.draftId === draftId)?.value ?? null
    },
    async getLatestActiveDraftByStaff(staffId) {
      if (!safeId(staffId)) return null
      return (await readRequestRows())
        .map(({ value }) => value)
        .filter((draft) => draft.staffId === staffId && ACTIVE_RESUMABLE_STATES.has(draft.state) && validIso(draft.updatedAt))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null
    },
    updateDraft: mutateDraft,
    async markRetentionPending(draftId, expectedVersion, updatedAt) {
      return mutateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
    },
    async queueDraft(requestId, payloadHash, taskName, queuedAt) {
      if (!safeId(requestId) || !safeHash(payloadHash) || !safeTaskName(taskName) || !validIso(queuedAt)) {
        throw new Error('INVALID_ASYNC_QUEUE')
      }
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        const boundPayloadHash = row.value.payloadHash ?? bookingPayloadHash(row.value)
        if (boundPayloadHash !== payloadHash) {
          throw new Error('PAYLOAD_HASH_CONFLICT')
        }
        if (row.value.taskName && row.value.taskName !== taskName) throw new Error('TASK_NAME_CONFLICT')
        if (row.value.state === 'QUEUED' && row.value.payloadHash === payloadHash && row.value.taskName === taskName) return row.value
        if (ASYNC_QUEUED_OR_LATER_STATES.has(row.value.state)) {
          if (row.value.taskName === taskName) return row.value
          const reconciled = normalizeRequestRecord({
            ...row.value,
            payloadHash,
            taskName,
            queuedAt: row.value.queuedAt ?? queuedAt,
            version: row.value.version + 1,
          })
          await writeRequest(row.rowNumber, reconciled)
          return reconciled
        }
        if (!canTransitionAsyncBooking(row.value.state, 'QUEUED')) throw new Error('DRAFT_NOT_READY')
        const next = normalizeRequestRecord({
          ...row.value,
          state: 'QUEUED',
          payloadHash,
          taskName,
          queuedAt,
          safeErrorCode: null,
          updatedAt: queuedAt,
          version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return next
      })
    },
    async claimProcessing({ requestId, draftId, leaseUntil, nowIso }) {
      if (!safeId(requestId) || !safeId(draftId) || !validIso(nowIso) || !validIso(leaseUntil) || Date.parse(leaseUntil) <= Date.parse(nowIso)) {
        throw new Error('INVALID_PROCESSING_CLAIM')
      }
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.draftId !== draftId) throw new Error('ASYNC_TASK_IDENTITY_CONFLICT')
        if (TERMINAL_REQUEST_STATES.has(row.value.state)) return { claimed: false, draft: row.value }
        if (row.value.state === 'PROCESSING') {
          const liveLease = row.value.processingLeaseUntil && Date.parse(row.value.processingLeaseUntil) > Date.parse(nowIso)
          if (liveLease) return { claimed: false, draft: row.value }
        } else {
          if (!canTransitionAsyncBooking(row.value.state, 'PROCESSING')) throw new Error('DRAFT_NOT_CLAIMABLE')
          if (row.value.state === 'READY_TO_CONFIRM' && (row.value.payloadHash !== null || row.value.taskName !== null)) {
            throw new Error('ASYNC_TASK_IDENTITY_CONFLICT')
          }
          if (row.value.state === 'QUEUED' || row.value.state === 'RETRYING') {
            if (!row.value.payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
            if ((row.value.state === 'QUEUED' && !row.value.taskName) || (row.value.taskName && !safeTaskName(row.value.taskName))) {
              throw new Error('ASYNC_TASK_IDENTITY_CONFLICT')
            }
          }
        }
        const next = normalizeRequestRecord({
          ...row.value,
          state: 'PROCESSING',
          payloadHash: row.value.payloadHash ?? bookingPayloadHash(row.value),
          processingStartedAt: row.value.processingStartedAt ?? nowIso,
          processingLeaseUntil: leaseUntil,
          lastProgressAt: nowIso,
          attemptCount: row.value.attemptCount + 1,
          safeErrorCode: null,
          updatedAt: nowIso,
          version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return { claimed: true, draft: next }
      })
    },
    async markAsyncRetry(requestId, safeErrorCode, nowIso) {
      if (!safeId(requestId) || !safeError(safeErrorCode) || !validIso(nowIso)) throw new Error('INVALID_ASYNC_RETRY')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (TERMINAL_REQUEST_STATES.has(row.value.state) || row.value.state === 'RETRYING') return row.value
        assertLiveProcessingLease(row.value, nowIso)
        const state: MiniAppRequestState = row.value.attemptCount >= ASYNC_MAX_ATTEMPTS ? 'NEEDS_REVIEW' : 'RETRYING'
        if (!canTransitionAsyncBooking(row.value.state, state)) throw new Error('DRAFT_NOT_PROCESSING')
        const next = normalizeRequestRecord({
          ...row.value,
          state,
          safeErrorCode,
          processingLeaseUntil: null,
          lastProgressAt: nowIso,
          updatedAt: nowIso,
          version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return next
      })
    },
    async completeAsyncBooking({ requestId, caseId, status, projectionState, nowIso }) {
      if (!safeId(requestId) || !safeCaseId(caseId) || !CONFIRMATION_STATUSES.has(status) || !validIso(nowIso)) {
        throw new Error('INVALID_ASYNC_COMPLETION')
      }
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (TERMINAL_REQUEST_STATES.has(row.value.state)) {
          if ((row.value.state === 'CONFIRMED' || row.value.state === 'CONFIRMED_WITH_RETRY') && row.value.caseId !== caseId) {
            throw new Error('CASE_ID_CONFLICT')
          }
          return row.value
        }
        assertLiveProcessingLease(row.value, nowIso)
        if (!canTransitionAsyncBooking(row.value.state, projectionState)) throw new Error('DRAFT_NOT_PROCESSING')
        const next = normalizeRequestRecord({
          ...row.value,
          state: projectionState,
          caseId,
          confirmedAt: nowIso,
          confirmationStatus: status,
          processingLeaseUntil: null,
          lastProgressAt: nowIso,
          safeErrorCode: null,
          updatedAt: nowIso,
          version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return next
      })
    },
    async claimConfirmation(requestId, payloadHash) {
      if (!safeId(requestId) || !safeHash(payloadHash)) throw new Error('INVALID_CONFIRMATION_CLAIM')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.payloadHash && row.value.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
        if (row.value.state === 'CONFIRMED') return { claimed: false as const, caseId: row.value.caseId, status: row.value.confirmationStatus }
        if (row.value.state === 'CONFIRMING') return { claimed: false as const, caseId: null, status: null }
        if (row.value.state !== 'READY_TO_CONFIRM' && row.value.state !== 'FAILED_RETRYABLE') throw new Error('DRAFT_NOT_READY')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMING', payloadHash, safeErrorCode: null, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return { claimed: true as const, draft: next }
      })
    },
    async completeConfirmation(requestId, caseId, confirmedAt, status) {
      if (!safeId(requestId) || !safeCaseId(caseId)) throw new Error('INVALID_CONFIRMATION_RESULT')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.state === 'CONFIRMED' && row.value.caseId === caseId) return row.value
        if (row.value.state !== 'CONFIRMING') throw new Error('DRAFT_NOT_CONFIRMING')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMED', caseId, confirmedAt, confirmationStatus: status, updatedAt: confirmedAt,
          safeErrorCode: null, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return next
      })
    },
    async failConfirmation(requestId, safeErrorCode, updatedAt) {
      if (!safeId(requestId) || !safeError(safeErrorCode)) throw new Error('INVALID_CONFIRMATION_FAILURE')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.state !== 'CONFIRMING') throw new Error('DRAFT_NOT_CONFIRMING')
        const next = normalizeRequestRecord({
          ...row.value, state: 'FAILED_RETRYABLE', safeErrorCode, updatedAt, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return next
      })
    },
  }
}

function requestToRow(value: MiniAppRequestRecord): unknown[] {
  return [
    value.requestId, value.draftId, value.staffId, value.lineUserIdHash, value.state, value.retentionState, value.version,
    value.payloadHash ?? '', value.aeName, value.customerName, value.facebookName, value.phoneNormalized, value.doctorId,
    value.serviceId, value.queueType, value.appointmentDate ?? '', value.appointmentTime ?? '', value.depositAmount,
    value.channelId, JSON.stringify(value.paymentEvidenceFileIds), JSON.stringify(value.chatEvidenceFileIds),
    value.evidenceCount, value.createdAt, value.confirmedAt ?? '', value.caseId ?? '', value.confirmationStatus ?? '', value.safeErrorCode ?? '', value.updatedAt,
    JSON.stringify(value.paymentEvidenceObjectKeys), JSON.stringify(value.chatEvidenceObjectKeys), value.taskName ?? '',
    value.queuedAt ?? '', value.processingStartedAt ?? '', value.processingLeaseUntil ?? '', value.lastProgressAt ?? '', value.attemptCount,
  ]
}

function requestFromRow(row: unknown[]): MiniAppRequestRecord {
  if (row.length === 0) throw new Error('MINI_APP_STORE_CORRUPT_ROW')
  return normalizeRequestRecord({
    requestId: text(row[0]), draftId: text(row[1]), staffId: text(row[2]), lineUserIdHash: text(row[3]),
    state: text(row[4]) as MiniAppRequestState, retentionState: text(row[5]) as MiniAppRetentionState,
    version: numberValue(row[6]), payloadHash: nullableText(row[7]), aeName: text(row[8]), customerName: text(row[9]),
    facebookName: text(row[10]), phoneNormalized: text(row[11]), doctorId: text(row[12]), serviceId: text(row[13]),
    queueType: text(row[14]) as 'NORMAL' | 'AUTO', appointmentDate: nullableText(row[15]), appointmentTime: nullableText(row[16]),
    depositAmount: numberValue(row[17]), channelId: text(row[18]), paymentEvidenceFileIds: stringArray(row[19]),
    chatEvidenceFileIds: stringArray(row[20]), evidenceCount: numberValue(row[21]), createdAt: text(row[22]),
    confirmedAt: nullableText(row[23]), caseId: nullableText(row[24]),
    confirmationStatus: nullableText(row[25]) as MiniAppRequestRecord['confirmationStatus'],
    safeErrorCode: nullableText(row[26]), updatedAt: text(row[27]),
    paymentEvidenceObjectKeys: stringArray(row[28], safeObjectKey), chatEvidenceObjectKeys: stringArray(row[29], safeObjectKey),
    taskName: nullableText(row[30]), queuedAt: nullableText(row[31]), processingStartedAt: nullableText(row[32]),
    processingLeaseUntil: nullableText(row[33]), lastProgressAt: nullableText(row[34]), attemptCount: row[35] === undefined ? 0 : numberValue(row[35]),
  })
}

function normalizeRequestRecord(value: MiniAppRequestRecord): MiniAppRequestRecord {
  if (!safeId(value.requestId) || !safeId(value.draftId) || !safeId(value.staffId)) throw new Error('INVALID_DRAFT_ID')
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
  for (const field of [value.taskName, value.queuedAt, value.processingStartedAt, value.processingLeaseUntil, value.lastProgressAt]) {
    if (field !== null && (typeof field !== 'string' || field.length > 512)) throw new Error('INVALID_DRAFT_FIELD')
  }
  for (const field of [value.aeName, value.customerName, value.facebookName, value.phoneNormalized, value.doctorId, value.serviceId, value.channelId, value.createdAt, value.updatedAt]) {
    if (typeof field !== 'string' || field.length > 512) throw new Error('INVALID_DRAFT_FIELD')
  }
  return structuredClone(value)
}

function staffFromRow(row: unknown[]): MiniAppStaffRecord | null {
  const staff = staffCandidateFromRow(row)
  return staff && safeLineUserId(staff.lineUserId) ? staff : null
}

function staffCandidateFromRow(row: unknown[]): MiniAppStaffRecord | null {
  const [id, name, email, lineUserId, canCloseBooking, canBeAe, active, profileImageUrl] = row
  const normalizedLineUserId = text(lineUserId)
  if (!safeId(text(id)) || !text(name) || (normalizedLineUserId && !safeLineUserId(normalizedLineUserId)) || !booleanValue(active)) return null
  return {
    id: text(id), name: text(name), email: text(email), lineUserId: normalizedLineUserId,
    canCloseBooking: booleanValue(canCloseBooking), canBeAe: booleanValue(canBeAe), active: true,
    profileImageUrl: nullableText(profileImageUrl),
  }
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
const ASYNC_QUEUED_OR_LATER_STATES = new Set<MiniAppRequestState>([
  'PROCESSING', 'RETRYING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW',
])
const TERMINAL_REQUEST_STATES = new Set<MiniAppRequestState>([
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
])
const CONFIRMATION_STATUSES = new Set<NonNullable<MiniAppRequestRecord['confirmationStatus']>>([
  'CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT',
])
const ASYNC_MAX_ATTEMPTS = 8

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullableText(value: unknown): string | null { const result = text(value); return result ? result : null }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function booleanValue(value: unknown): boolean { return value === true || String(value).toLowerCase() === 'true' }
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
function safeTaskName(value: string): boolean { return /^[A-Za-z0-9._:/-]{1,512}$/.test(value) }

function assertLiveProcessingLease(draft: MiniAppRequestRecord, nowIso: string): void {
  if (draft.state !== 'PROCESSING') throw new Error('DRAFT_NOT_PROCESSING')
  if (!draft.processingLeaseUntil || Date.parse(draft.processingLeaseUntil) <= Date.parse(nowIso)) {
    throw new Error('PROCESSING_LEASE_EXPIRED')
  }
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
