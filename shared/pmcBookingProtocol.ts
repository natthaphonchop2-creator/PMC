export const PMC_BOOKING_PROTOCOL_VERSION = 2 as const

export type BookingProtocolVersion = 1 | 2
export type RecorderSource =
  | 'VERIFIED_LINE'
  | 'LEGACY_ASSUMED_ADMIN'
  | 'FORM_EMAIL_MATCH'
  | 'FORM_UNRESOLVED'

export type MiniAppIngressQueueType = 'NORMAL' | 'AUTO'
export type MiniAppIngressStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'

export interface BookingAttributionSelectionV2 {
  adminId: string
  aeId: string | null
}

export type BookingAttributionSelectionParseResult =
  | { ok: true; value: BookingAttributionSelectionV2 }
  | { ok: false; code: 'UNKNOWN_BOOKING_FIELD' | 'INVALID_BOOKING_ATTRIBUTION_SELECTION' }

export interface BookingMutationEnvelopeV2<T> {
  protocolVersion: 2
  version: number
  input: T
}

export interface BookingCreateEnvelopeV2 {
  protocolVersion: 2
}

export interface BookingVersionEnvelopeV2 {
  protocolVersion: 2
  version: number
}

export interface MiniAppBookingIngressPayloadV1 {
  requestId: string
  payloadHash: string
  staffId: string
  aeName: string
  customerName: string
  facebookName: string
  phoneNormalized: string
  doctorId: string
  serviceId: string
  queueType: MiniAppIngressQueueType
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
}

export type MiniAppBookingIngressPayloadV2 = Omit<
  MiniAppBookingIngressPayloadV1,
  'aeName'
> & {
  protocolVersion: 2
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string | null
}

export type MiniAppBookingIngressPayload =
  | MiniAppBookingIngressPayloadV1
  | MiniAppBookingIngressPayloadV2

export interface UnsignedMiniAppBookingIngressEnvelopeV1 {
  kind: 'MINI_APP_BOOKING'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppBookingIngressPayloadV1
}

export interface UnsignedMiniAppBookingIngressEnvelopeV2 {
  kind: 'MINI_APP_BOOKING'
  version: 2
  timestamp: number
  nonce: string
  payload: MiniAppBookingIngressPayloadV2
}

export type UnsignedMiniAppBookingIngressEnvelope =
  | UnsignedMiniAppBookingIngressEnvelopeV1
  | UnsignedMiniAppBookingIngressEnvelopeV2

export type MiniAppBookingIngressEnvelopeV1 = UnsignedMiniAppBookingIngressEnvelopeV1 & { signature: string }
export type MiniAppBookingIngressEnvelopeV2 = UnsignedMiniAppBookingIngressEnvelopeV2 & { signature: string }
export type MiniAppBookingIngressEnvelope = MiniAppBookingIngressEnvelopeV1 | MiniAppBookingIngressEnvelopeV2

export interface MiniAppBookingIngressResult {
  caseId: string
  status: MiniAppIngressStatus
  driveState: 'OK' | 'RETRY'
  calendarState: 'PENDING' | 'OK' | 'RETRY' | 'CONFLICT'
  lineState: 'PENDING' | 'OK' | 'RETRY'
}

export function parseBookingAttributionSelection(input: unknown): BookingAttributionSelectionParseResult {
  if (!isRecord(input)) return { ok: false, code: 'INVALID_BOOKING_ATTRIBUTION_SELECTION' }
  if (!hasExactKeys(input, ['adminId', 'aeId'])) return { ok: false, code: 'UNKNOWN_BOOKING_FIELD' }
  if (!safeAttributionId(input.adminId) || (input.aeId !== null && !safeAttributionId(input.aeId))) {
    return { ok: false, code: 'INVALID_BOOKING_ATTRIBUTION_SELECTION' }
  }
  return { ok: true, value: { adminId: input.adminId, aeId: input.aeId } }
}

function safeAttributionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

export function canonicalMiniAppBookingIngress(envelope: UnsignedMiniAppBookingIngressEnvelope): string {
  if (!isRecord(envelope) || !hasExactKeys(envelope, ['kind', 'version', 'timestamp', 'nonce', 'payload'])) {
    throw new Error('invalid mini app booking ingress envelope')
  }
  if (envelope.kind !== 'MINI_APP_BOOKING') throw new Error('invalid mini app booking ingress envelope')

  if (envelope.version === 1) {
    assertExactKeys(envelope.payload, MINI_APP_BOOKING_INGRESS_PAYLOAD_V1_KEYS)
    return JSON.stringify({ kind: envelope.kind, version: envelope.version, timestamp: envelope.timestamp, nonce: envelope.nonce, payload: canonicalPayloadV1(envelope.payload as MiniAppBookingIngressPayloadV1) })
  }
  if (envelope.version === PMC_BOOKING_PROTOCOL_VERSION) {
    assertExactKeys(envelope.payload, MINI_APP_BOOKING_INGRESS_PAYLOAD_V2_KEYS)
    const payload = envelope.payload as MiniAppBookingIngressPayloadV2
    if (payload.protocolVersion !== PMC_BOOKING_PROTOCOL_VERSION) throw new Error('invalid mini app booking protocol version')
    return JSON.stringify({ kind: envelope.kind, version: envelope.version, timestamp: envelope.timestamp, nonce: envelope.nonce, payload: canonicalPayloadV2(payload) })
  }
  throw new Error('unsupported mini app booking protocol version')
}

const MINI_APP_BOOKING_INGRESS_PAYLOAD_V1_KEYS = ['requestId', 'payloadHash', 'staffId', 'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIds', 'chatEvidenceFileIds'] as const
const MINI_APP_BOOKING_INGRESS_PAYLOAD_V2_KEYS = ['protocolVersion', 'requestId', 'payloadHash', 'staffId', 'recorderName', 'adminId', 'adminName', 'aeId', 'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIds', 'chatEvidenceFileIds'] as const

function canonicalPayloadV1(payload: MiniAppBookingIngressPayloadV1) {
  return { requestId: payload.requestId, payloadHash: payload.payloadHash, staffId: payload.staffId, aeName: payload.aeName, customerName: payload.customerName, facebookName: payload.facebookName, phoneNormalized: payload.phoneNormalized, doctorId: payload.doctorId, serviceId: payload.serviceId, queueType: payload.queueType, appointmentDate: payload.appointmentDate, appointmentTime: payload.appointmentTime, depositAmount: payload.depositAmount, channelId: payload.channelId, paymentEvidenceFileIds: payload.paymentEvidenceFileIds, chatEvidenceFileIds: payload.chatEvidenceFileIds }
}

function canonicalPayloadV2(payload: MiniAppBookingIngressPayloadV2) {
  return { protocolVersion: payload.protocolVersion, requestId: payload.requestId, payloadHash: payload.payloadHash, staffId: payload.staffId, recorderName: payload.recorderName, adminId: payload.adminId, adminName: payload.adminName, aeId: payload.aeId, aeName: payload.aeName, customerName: payload.customerName, facebookName: payload.facebookName, phoneNormalized: payload.phoneNormalized, doctorId: payload.doctorId, serviceId: payload.serviceId, queueType: payload.queueType, appointmentDate: payload.appointmentDate, appointmentTime: payload.appointmentTime, depositAmount: payload.depositAmount, channelId: payload.channelId, paymentEvidenceFileIds: payload.paymentEvidenceFileIds, chatEvidenceFileIds: payload.chatEvidenceFileIds }
}

function assertExactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw new Error('invalid mini app booking ingress payload')
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
