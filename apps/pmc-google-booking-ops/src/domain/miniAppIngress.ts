import {
  canonicalMiniAppBookingIngress,
  type MiniAppBookingIngressPayload,
  type UnsignedMiniAppBookingIngressEnvelope,
} from '../../../../shared/pmcMiniAppBooking'
import { NO_AE_OPTION } from '../config'
import type { AppsScriptDoPostEvent } from '../adapters/lineMessaging'
import type { BookingPorts } from '../ports'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const
const PAYLOAD_KEYS = [
  'requestId', 'payloadHash', 'staffId', 'aeName', 'customerName', 'facebookName', 'phoneNormalized',
  'doctorId', 'serviceId', 'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
  'paymentEvidenceFileIds', 'chatEvidenceFileIds',
] as const

export function parseAndVerifyMiniAppIngress(
  event: AppsScriptDoPostEvent,
  ports: BookingPorts,
): MiniAppBookingIngressPayload {
  if (!event.postData || event.postData.length <= 0 || event.postData.length > 262_144 || event.postData.type !== 'application/json') {
    throw new Error('invalid mini app ingress event')
  }
  let parsed: unknown
  try { parsed = JSON.parse(event.postData.contents) } catch { throw new Error('invalid mini app ingress JSON') }
  return verifyMiniAppIngressPayload(parsed, ports)
}

export function verifyMiniAppIngressPayload(input: unknown, ports: BookingPorts): MiniAppBookingIngressPayload {
  if (!isRecord(input) || !hasExactKeys(input, ENVELOPE_KEYS)) throw new Error('invalid mini app ingress envelope')
  if (input.kind !== 'MINI_APP_BOOKING' || input.version !== 1 || !Number.isSafeInteger(input.timestamp)) {
    throw new Error('invalid mini app ingress envelope')
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)) throw new Error('invalid mini app ingress nonce')
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) throw new Error('invalid mini app ingress signature')
  if (!isRecord(input.payload) || !hasExactKeys(input.payload, PAYLOAD_KEYS)) throw new Error('invalid mini app ingress payload')

  const unsigned: UnsignedMiniAppBookingIngressEnvelope = {
    kind: 'MINI_APP_BOOKING', version: 1, timestamp: input.timestamp as number, nonce: input.nonce,
    payload: input.payload as unknown as MiniAppBookingIngressPayload,
  }
  const expected = ports.crypto.hmacSha256Hex(canonicalMiniAppBookingIngress(unsigned), ports.secrets.bookingIngressSecret())
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app ingress signature')

  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) throw new Error('expired mini app ingress timestamp')
  if (ports.repositories.lineDirectory.hasNonce(unsigned.nonce)) throw new Error('mini app ingress replay detected')

  validatePayload(unsigned.payload, ports)
  return clonePayload(unsigned.payload)
}

function validatePayload(payload: MiniAppBookingIngressPayload, ports: BookingPorts): void {
  if (!/^[A-Za-z0-9._:-]{1,124}$/.test(payload.requestId)) throw new Error('invalid mini app request ID')
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(payload.payloadHash)) throw new Error('invalid mini app payload hash')
  const staff = ports.config.findStaffById(payload.staffId)
  if (!staff?.active || !staff.canCloseBooking) throw new Error('mini app staff is not active or eligible')
  if (payload.aeName !== NO_AE_OPTION && !ports.config.findEligibleAeByName(payload.aeName)) throw new Error('mini app AE is not active or eligible')
  if (!requiredText(payload.customerName, 160) || !requiredText(payload.facebookName, 160)) throw new Error('invalid mini app customer')
  if (!/^0\d{8,9}$/.test(payload.phoneNormalized)) throw new Error('invalid mini app phone')
  if (!ports.config.findDoctor(payload.doctorId)?.active) throw new Error('mini app doctor is not active')
  const service = ports.config.findService(payload.serviceId)
  if (!service?.active || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) throw new Error('mini app service is not active')
  if (!ports.config.findChannel(payload.channelId)?.active) throw new Error('mini app channel is not active')
  if (!Number.isFinite(payload.depositAmount) || payload.depositAmount <= 0 || payload.depositAmount > 10_000_000) throw new Error('invalid mini app deposit')
  if (payload.queueType === 'NORMAL') {
    if (!validDate(payload.appointmentDate) || !validTime(payload.appointmentTime)) throw new Error('invalid mini app appointment')
  } else if (payload.queueType === 'AUTO') {
    if (payload.appointmentDate !== null || payload.appointmentTime !== null) throw new Error('invalid mini app automatic queue')
  } else {
    throw new Error('invalid mini app queue type')
  }
  validateEvidenceIds(payload.paymentEvidenceFileIds, 'payment')
  validateEvidenceIds(payload.chatEvidenceFileIds, 'chat')
}

function validateEvidenceIds(values: unknown, kind: string): asserts values is string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) throw new Error(`invalid mini app ${kind} evidence`)
  if (values.some((value) => typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,124}$/.test(value))) {
    throw new Error(`invalid mini app ${kind} evidence`)
  }
  if (new Set(values).size !== values.length) throw new Error(`duplicate mini app ${kind} evidence`)
}

function validDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

function validTime(value: unknown): boolean { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) }
function requiredText(value: unknown, max: number): boolean { return typeof value === 'string' && value.trim().length > 0 && value.length <= max }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}
function clonePayload(payload: MiniAppBookingIngressPayload): MiniAppBookingIngressPayload {
  return JSON.parse(JSON.stringify(payload)) as MiniAppBookingIngressPayload
}
