import { createHash } from 'node:crypto'
import type { BookingDraftInputV1 } from '../../src/apps/pmc-mini-app/contracts.js'
import type { MiniAppRequestRecord, MiniAppRequestState } from './store.js'
import type { MiniAppAttributionOption } from './contracts.js'
import {
  canonicalMiniAppAsyncIdentity,
  canonicalMiniAppEvidenceProjection,
  type MiniAppEvidenceProjectionBinding,
} from '../../shared/pmcMiniAppAsyncState.js'
import { canonicalMiniAppP2BookingIdentity } from '../../shared/pmcMiniAppDraftState.js'

export interface BookingDraftContext {
  draftId: string
  staffId: string
  lineUserIdHash: string
  doctorIds: readonly string[]
  serviceIds: readonly string[]
  channelIds: readonly string[]
  eligibleAeNames: readonly string[]
  paymentEvidenceFileIds: readonly string[]
  chatEvidenceFileIds: readonly string[]
  paymentEvidenceObjectKeys?: readonly string[]
  chatEvidenceObjectKeys?: readonly string[]
  asyncEvidence?: boolean
  now: string
}

export interface BookingDraftContextV2 {
  draftId: string
  staffId: string
  recorderName: string
  lineUserIdHash: string
  doctors: readonly MiniAppAttributionOption[]
  services: readonly MiniAppAttributionOption[]
  channels: readonly MiniAppAttributionOption[]
  admins: readonly MiniAppAttributionOption[]
  aes: readonly MiniAppAttributionOption[]
  paymentEvidenceFileIds: readonly string[]
  chatEvidenceFileIds: readonly string[]
  paymentEvidenceObjectKeys?: readonly string[]
  chatEvidenceObjectKeys?: readonly string[]
  asyncEvidence?: boolean
  now: string
}

export type BookingDraftAction = {
  type: 'SET_STATE'
  state: MiniAppRequestState
  updatedAt: string
}

const BOOKING_INPUT_KEYS = new Set([
  'requestId', 'aeName', 'customerName', 'facebookName', 'phone', 'doctorId', 'serviceId',
  'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
])

const BOOKING_INPUT_KEYS_V2 = new Set([
  'requestId', 'adminId', 'aeId', 'customerName', 'facebookName', 'phone', 'doctorId', 'serviceId',
  'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
])

const ALLOWED: Record<MiniAppRequestState, MiniAppRequestState[]> = {
  DRAFT: ['UPLOADING', 'READY_TO_CONFIRM', 'CANCELLED', 'EXPIRED'],
  UPLOADING: ['DRAFT', 'READY_TO_CONFIRM', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED'],
  READY_TO_CONFIRM: ['CONFIRMING', 'DRAFT', 'CANCELLED', 'EXPIRED'],
  QUEUED: [],
  PROCESSING: [],
  RETRYING: [],
  CONFIRMING: ['CONFIRMED', 'FAILED_RETRYABLE'],
  FAILED_RETRYABLE: ['CONFIRMING', 'DRAFT', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: [],
  CONFIRMED_WITH_RETRY: [],
  NEEDS_REVIEW: [],
  CANCELLED: [],
  EXPIRED: [],
}

export function parseBookingDraft(input: unknown, context: BookingDraftContext): MiniAppRequestRecord {
  if (!isPlainRecord(input)) throw new Error('INVALID_BOOKING_INPUT')
  for (const key of Object.keys(input)) if (!BOOKING_INPUT_KEYS.has(key)) throw new Error('UNKNOWN_BOOKING_FIELD')

  const value = input as unknown as BookingDraftInputV1
  const requestId = requiredId(value.requestId, 'INVALID_REQUEST_ID')
  const draftId = requiredId(context.draftId, 'INVALID_DRAFT_ID')
  const staffId = requiredId(context.staffId, 'INVALID_STAFF_ID')
  const lineUserIdHash = requiredHash(context.lineUserIdHash)
  const aeName = requiredText(value.aeName, 120, 'AE_REQUIRED')
  if (!context.eligibleAeNames.includes(aeName)) throw new Error('AE_NOT_ALLOWED')
  const customerName = requiredText(value.customerName, 160, 'CUSTOMER_NAME_REQUIRED')
  const facebookName = requiredText(value.facebookName, 160, 'FACEBOOK_NAME_REQUIRED')
  const phoneNormalized = normalizeThaiPhone(value.phone)
  const doctorId = allowedId(value.doctorId, context.doctorIds, 'DOCTOR_NOT_ALLOWED')
  const serviceId = allowedId(value.serviceId, context.serviceIds, 'SERVICE_NOT_ALLOWED')
  const channelId = allowedId(value.channelId, context.channelIds, 'CHANNEL_NOT_ALLOWED')
  const queueType = value.queueType
  if (queueType !== 'NORMAL' && queueType !== 'AUTO') throw new Error('QUEUE_TYPE_REQUIRED')
  const { appointmentDate, appointmentTime } = appointmentFields(queueType, value.appointmentDate, value.appointmentTime)
  if (typeof value.depositAmount !== 'number' || !Number.isFinite(value.depositAmount) || value.depositAmount <= 0 || value.depositAmount > 10_000_000) {
    throw new Error('DEPOSIT_AMOUNT_REQUIRED')
  }
  const paymentEvidenceFileIds = evidenceIds(context.paymentEvidenceFileIds, 'PAYMENT', !context.asyncEvidence)
  const chatEvidenceFileIds = evidenceIds(context.chatEvidenceFileIds, 'CHAT', !context.asyncEvidence)
  const paymentEvidenceObjectKeys = stagingObjectKeys(
    context.paymentEvidenceObjectKeys ?? [], context.draftId, 'PAYMENT', Boolean(context.asyncEvidence),
  )
  const chatEvidenceObjectKeys = stagingObjectKeys(
    context.chatEvidenceObjectKeys ?? [], context.draftId, 'CHAT', Boolean(context.asyncEvidence),
  )
  const now = isoTimestamp(context.now)

  return {
    requestId,
    draftId,
    protocolVersion: 1,
    staffId,
    recorderName: '',
    adminId: staffId,
    adminName: '',
    lineUserIdHash,
    state: 'READY_TO_CONFIRM',
    retentionState: '',
    version: 1,
    payloadHash: null,
    aeId: null,
    aeName,
    customerName,
    facebookName,
    phoneNormalized,
    doctorId,
    serviceId,
    queueType,
    appointmentDate,
    appointmentTime,
    depositAmount: value.depositAmount,
    channelId,
    paymentEvidenceFileIds,
    chatEvidenceFileIds,
    evidenceCount: context.asyncEvidence
      ? paymentEvidenceObjectKeys.length + chatEvidenceObjectKeys.length
      : paymentEvidenceFileIds.length + chatEvidenceFileIds.length,
    paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys,
    taskName: null,
    queuedAt: null,
    processingStartedAt: null,
    processingLeaseUntil: null,
    lastProgressAt: null,
    attemptCount: 0,
    processingOwnerToken: null,
    evidenceProjectionHash: null,
    createdAt: now,
    confirmedAt: null,
    caseId: null,
    confirmationStatus: null,
    safeErrorCode: null,
    updatedAt: now,
  }
}

export function parseBookingDraftV2(input: unknown, context: BookingDraftContextV2): MiniAppRequestRecord {
  if (!isPlainRecord(input)) throw new Error('INVALID_BOOKING_INPUT')
  for (const key of Object.keys(input)) if (!BOOKING_INPUT_KEYS_V2.has(key)) throw new Error('UNKNOWN_BOOKING_FIELD')

  const admin = attributionById(input.adminId, context.admins, 'ADMIN_NOT_ALLOWED')
  const ae = input.aeId === null ? null : attributionById(input.aeId, context.aes, 'AE_NOT_ALLOWED')
  const recorderName = requiredText(context.recorderName, 120, 'RECORDER_NAME_REQUIRED')
  const legacyInput = { ...input }
  delete legacyInput.adminId
  delete legacyInput.aeId
  const base = parseBookingDraft({ ...legacyInput, aeName: ae?.name ?? 'ไม่ระบุ' }, {
    draftId: context.draftId,
    staffId: context.staffId,
    lineUserIdHash: context.lineUserIdHash,
    doctorIds: context.doctors.map(({ id }) => id),
    serviceIds: context.services.map(({ id }) => id),
    channelIds: context.channels.map(({ id }) => id),
    eligibleAeNames: ['ไม่ระบุ', ...context.aes.map(({ name }) => name)],
    paymentEvidenceFileIds: context.paymentEvidenceFileIds,
    chatEvidenceFileIds: context.chatEvidenceFileIds,
    paymentEvidenceObjectKeys: context.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: context.chatEvidenceObjectKeys,
    asyncEvidence: context.asyncEvidence,
    now: context.now,
  })

  return {
    ...base,
    protocolVersion: 2,
    recorderName,
    adminId: admin.id,
    adminName: admin.name,
    aeId: ae?.id ?? null,
    aeName: ae?.name ?? 'ไม่ระบุ',
  }
}

export function bookingPayloadHash(draft: MiniAppRequestRecord): string {
  const canonical = draft.protocolVersion !== 2
    ? canonicalMiniAppAsyncIdentity(draft)
    : canonicalMiniAppP2BookingIdentity({ ...draft, protocolVersion: 2 })
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}

export function evidenceProjectionHash(binding: MiniAppEvidenceProjectionBinding): string {
  return createHash('sha256').update(canonicalMiniAppEvidenceProjection(binding), 'utf8').digest('base64url')
}

export function transitionDraft(draft: MiniAppRequestRecord, action: BookingDraftAction): MiniAppRequestRecord {
  if (action.type !== 'SET_STATE' || !ALLOWED[draft.state].includes(action.state)) throw new Error('INVALID_DRAFT_TRANSITION')
  const updatedAt = isoTimestamp(action.updatedAt)
  return {
    ...structuredClone(draft),
    state: action.state,
    retentionState: action.state === 'CANCELLED' || action.state === 'EXPIRED' ? 'PENDING_APPROVAL' : draft.retentionState,
    safeErrorCode: action.state === 'CONFIRMING' ? null : draft.safeErrorCode,
    version: draft.version + 1,
    updatedAt,
  }
}

function appointmentFields(
  queueType: 'NORMAL' | 'AUTO',
  dateValue: string | null,
  timeValue: string | null,
): { appointmentDate: string | null; appointmentTime: string | null } {
  const date = nullableTrimmed(dateValue)
  const time = nullableTrimmed(timeValue)
  if (queueType === 'AUTO') {
    if (date) throw new Error('AUTO_QUEUE_DATE_FORBIDDEN')
    if (time) throw new Error('AUTO_QUEUE_TIME_FORBIDDEN')
    return { appointmentDate: null, appointmentTime: null }
  }
  if (!date) throw new Error('APPOINTMENT_DATE_REQUIRED')
  if (!validDate(date)) throw new Error('APPOINTMENT_DATE_INVALID')
  if (!time) throw new Error('APPOINTMENT_TIME_REQUIRED')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('APPOINTMENT_TIME_INVALID')
  return { appointmentDate: date, appointmentTime: time }
}

function normalizeThaiPhone(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_THAI_PHONE')
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('66') && digits.length >= 11) digits = `0${digits.slice(2)}`
  if (!/^0\d{8,9}$/.test(digits)) throw new Error('INVALID_THAI_PHONE')
  return digits
}

function attributionById(
  value: unknown,
  options: readonly MiniAppAttributionOption[],
  errorCode: 'ADMIN_NOT_ALLOWED' | 'AE_NOT_ALLOWED',
): MiniAppAttributionOption {
  if (typeof value !== 'string') throw new Error(errorCode)
  const match = options.find(({ id }) => id === value)
  if (!match) throw new Error(errorCode)
  return match
}

function evidenceIds(values: readonly string[], kind: 'PAYMENT' | 'CHAT', required = true): string[] {
  if (!Array.isArray(values) || required && values.length === 0) throw new Error(`${kind}_EVIDENCE_REQUIRED`)
  if (values.length > 10) throw new Error(`${kind}_EVIDENCE_LIMIT`)
  const result = values.map((value) => requiredId(value, `${kind}_EVIDENCE_INVALID`))
  if (new Set(result).size !== result.length) throw new Error(`${kind}_EVIDENCE_DUPLICATE`)
  return result
}

function stagingObjectKeys(
  values: readonly string[],
  draftId: string,
  kind: 'PAYMENT' | 'CHAT',
  required: boolean,
): string[] {
  if (!Array.isArray(values) || required && values.length === 0) throw new Error(`${kind}_EVIDENCE_REQUIRED`)
  if (values.length > 10) throw new Error(`${kind}_EVIDENCE_LIMIT`)
  const result = values.map((value) => {
    if (typeof value !== 'string') throw new Error(`${kind}_EVIDENCE_INVALID`)
    const match = /^drafts\/([A-Za-z0-9_-]{1,124})\/(PAYMENT|CHAT)\/[a-f0-9]{64}\.(?:jpg|png)$/.exec(value)
    if (!match || match[1] !== draftId || match[2] !== kind) throw new Error(`${kind}_EVIDENCE_INVALID`)
    return value
  })
  if (new Set(result).size !== result.length) throw new Error(`${kind}_EVIDENCE_DUPLICATE`)
  return result
}

function requiredText(value: unknown, maxLength: number, code: string): string {
  if (typeof value !== 'string') throw new Error(code)
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > maxLength) throw new Error(code)
  return normalized
}

function allowedId(value: unknown, allowed: readonly string[], code: string): string {
  if (typeof value !== 'string' || !safeConfigId(value) || !allowed.includes(value)) throw new Error(code)
  return value
}

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

function requiredId(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,124}$/.test(value)) throw new Error(code)
  return value
}

function requiredHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(value)) throw new Error('INVALID_LINE_USER_HASH')
  return value
}

function nullableTrimmed(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  return value.trim() || null
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

function isoTimestamp(value: string): string {
  const timestamp = new Date(value)
  if (!value || Number.isNaN(timestamp.getTime())) throw new Error('INVALID_DRAFT_TIMESTAMP')
  return timestamp.toISOString()
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
