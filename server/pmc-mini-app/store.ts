import type { MiniAppSheetsPort } from './googleClient.js'

export type MiniAppRequestState =
  | 'DRAFT'
  | 'UPLOADING'
  | 'READY_TO_CONFIRM'
  | 'CONFIRMING'
  | 'CONFIRMED'
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
  createdAt: string
  confirmedAt: string | null
  caseId: string | null
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
  claimConfirmation(requestId: string, payloadHash: string): Promise<{ claimed: true; draft: MiniAppRequestRecord } | { claimed: false; caseId: string | null }>
  completeConfirmation(requestId: string, caseId: string, confirmedAt: string): Promise<MiniAppRequestRecord>
  failConfirmation(requestId: string, safeErrorCode: string, updatedAt: string): Promise<MiniAppRequestRecord>
}

export const MINI_APP_REQUEST_HEADERS = [
  'requestId', 'draftId', 'staffId', 'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash',
  'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'safeErrorCode', 'updatedAt',
] as const

const REQUEST_TAB = 'MINI_APP_REQUESTS'
const REQUEST_RANGE = `'${REQUEST_TAB}'!A2:${columnName(MINI_APP_REQUEST_HEADERS.length)}`
const STAFF_RANGE = "'CONFIG_STAFF'!A2:H"
const DOCTORS_RANGE = "'CONFIG_DOCTORS'!A2:E"
const SERVICES_RANGE = "'CONFIG_SERVICES'!A2:D"
const CHANNELS_RANGE = "'CONFIG_CHANNELS'!A2:C"
const requestMutexes = new Map<string, Promise<void>>()

export function createGoogleMiniAppStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): MiniAppStore {
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
        .map(staffFromRow)
        .filter((staff): staff is MiniAppStaffRecord => Boolean(staff?.canBeAe))
        .map(({ id, name }) => ({ id, name }))
      const doctors = (response[DOCTORS_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const active = booleanValue(row[4])
        return active && safeId(id) && name ? [{ id, name }] : []
      })
      const services = (response[SERVICES_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const durationMinutes = numberValue(row[2]); const active = booleanValue(row[3])
        return active && safeId(id) && name && Number.isSafeInteger(durationMinutes) && durationMinutes > 0
          ? [{ id, name, durationMinutes }] : []
      })
      const channels = (response[CHANNELS_RANGE] ?? []).flatMap((row) => {
        const id = text(row[0]); const name = text(row[1]); const active = booleanValue(row[2])
        return active && safeId(id) && name ? [{ id, name }] : []
      })
      return { doctors, services, channels, aes }
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
    updateDraft: mutateDraft,
    async markRetentionPending(draftId, expectedVersion, updatedAt) {
      return mutateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
    },
    async claimConfirmation(requestId, payloadHash) {
      if (!safeId(requestId) || !safeHash(payloadHash)) throw new Error('INVALID_CONFIRMATION_CLAIM')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.payloadHash && row.value.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
        if (row.value.state === 'CONFIRMED') return { claimed: false as const, caseId: row.value.caseId }
        if (row.value.state === 'CONFIRMING') return { claimed: false as const, caseId: null }
        if (row.value.state !== 'READY_TO_CONFIRM' && row.value.state !== 'FAILED_RETRYABLE') throw new Error('DRAFT_NOT_READY')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMING', payloadHash, safeErrorCode: null, version: row.value.version + 1,
        })
        await writeRequest(row.rowNumber, next)
        return { claimed: true as const, draft: next }
      })
    },
    async completeConfirmation(requestId, caseId, confirmedAt) {
      if (!safeId(requestId) || !safeCaseId(caseId)) throw new Error('INVALID_CONFIRMATION_RESULT')
      return withMutex(mutexKey, async () => {
        const row = (await readRequestRows()).find(({ value }) => value.requestId === requestId)
        if (!row) throw new Error('DRAFT_NOT_FOUND')
        if (row.value.state === 'CONFIRMED' && row.value.caseId === caseId) return row.value
        if (row.value.state !== 'CONFIRMING') throw new Error('DRAFT_NOT_CONFIRMING')
        const next = normalizeRequestRecord({
          ...row.value, state: 'CONFIRMED', caseId, confirmedAt, updatedAt: confirmedAt,
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
    value.evidenceCount, value.createdAt, value.confirmedAt ?? '', value.caseId ?? '', value.safeErrorCode ?? '', value.updatedAt,
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
    confirmedAt: nullableText(row[23]), caseId: nullableText(row[24]), safeErrorCode: nullableText(row[25]), updatedAt: text(row[26]),
  })
}

function normalizeRequestRecord(value: MiniAppRequestRecord): MiniAppRequestRecord {
  if (!safeId(value.requestId) || !safeId(value.draftId) || !safeId(value.staffId)) throw new Error('INVALID_DRAFT_ID')
  if (!safeHash(value.lineUserIdHash)) throw new Error('INVALID_LINE_USER_HASH')
  if (!REQUEST_STATES.has(value.state)) throw new Error('INVALID_DRAFT_STATE')
  if (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL') throw new Error('INVALID_RETENTION_STATE')
  if (!Number.isSafeInteger(value.version) || value.version < 1) throw new Error('INVALID_DRAFT_VERSION')
  if (value.payloadHash !== null && !safeHash(value.payloadHash)) throw new Error('INVALID_PAYLOAD_HASH')
  if (value.queueType !== 'NORMAL' && value.queueType !== 'AUTO') throw new Error('INVALID_QUEUE_TYPE')
  if (!Number.isFinite(value.depositAmount) || value.depositAmount < 0) throw new Error('INVALID_DEPOSIT_AMOUNT')
  if (!Number.isSafeInteger(value.evidenceCount) || value.evidenceCount < 0 || value.evidenceCount > 20) throw new Error('INVALID_EVIDENCE_COUNT')
  if (value.paymentEvidenceFileIds.length > 10 || value.chatEvidenceFileIds.length > 10) throw new Error('INVALID_EVIDENCE_COUNT')
  for (const field of [value.aeName, value.customerName, value.facebookName, value.phoneNormalized, value.doctorId, value.serviceId, value.channelId, value.createdAt, value.updatedAt]) {
    if (typeof field !== 'string' || field.length > 512) throw new Error('INVALID_DRAFT_FIELD')
  }
  return structuredClone(value)
}

function staffFromRow(row: unknown[]): MiniAppStaffRecord | null {
  const [id, name, email, lineUserId, canCloseBooking, canBeAe, active, profileImageUrl] = row
  if (!safeId(text(id)) || !text(name) || !safeLineUserId(text(lineUserId)) || !booleanValue(active)) return null
  return {
    id: text(id), name: text(name), email: text(email), lineUserId: text(lineUserId),
    canCloseBooking: booleanValue(canCloseBooking), canBeAe: booleanValue(canBeAe), active: true,
    profileImageUrl: nullableText(profileImageUrl),
  }
}

const REQUEST_STATES = new Set<MiniAppRequestState>([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'CONFIRMING', 'CONFIRMED', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullableText(value: unknown): string | null { const result = text(value); return result ? result : null }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function booleanValue(value: unknown): boolean { return value === true || String(value).toLowerCase() === 'true' }
function safeId(value: string): boolean { return /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeLineUserId(value: string): boolean { return /^[A-Za-z0-9_-]{2,128}$/.test(value) }
function safeHash(value: string): boolean { return /^[A-Za-z0-9_-]{4,128}$/.test(value) }
function safeCaseId(value: string): boolean { return /^PMC-\d{6}-\d{4,}$/.test(value) }
function safeError(value: string): boolean { return /^[A-Z0-9_]{1,80}$/.test(value) }

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text)
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !safeId(item))) throw new Error('invalid')
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
