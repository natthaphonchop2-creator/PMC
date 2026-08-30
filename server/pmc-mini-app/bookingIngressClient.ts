import { createHmac } from 'node:crypto'
import {
  canonicalMiniAppBookingIngress,
  type MiniAppBookingIngressEnvelope,
  type MiniAppBookingIngressResult,
  type UnsignedMiniAppBookingIngressEnvelope,
  type UnsignedMiniAppBookingIngressEnvelopeV1,
  type UnsignedMiniAppBookingIngressEnvelopeV2,
} from '../../shared/pmcMiniAppBooking.js'
import type { MiniAppRequestRecord } from './store.js'

interface IngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type IngressFetch = (
  url: string,
  init: { method: 'POST'; headers: { 'content-type': string }; body: string; signal: AbortSignal },
) => Promise<IngressResponse>

export interface BookingIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export interface BookingIngressPort {
  send(draft: MiniAppRequestRecord): Promise<MiniAppBookingIngressResult>
}

export class BookingIngressClientError extends Error {
  readonly code: 'BOOKING_INGRESS_TIMEOUT' | 'BOOKING_INGRESS_FAILED' | 'BOOKING_INGRESS_INVALID_RESPONSE'

  constructor(code: BookingIngressClientError['code']) {
    super(`Booking ingress failed: ${code}`)
    this.name = 'BookingIngressClientError'
    this.code = code
  }
}

export function buildMiniAppIngress(
  draft: MiniAppRequestRecord,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppBookingIngressEnvelope; headers: { 'content-type': 'application/json' } } {
  if ((draft.state !== 'CONFIRMING' && draft.state !== 'PROCESSING') || !draft.payloadHash) {
    throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  }
  if (!Number.isSafeInteger(context.timestamp) || context.timestamp <= 0 || !safeNonce(context.nonce) || !secret) {
    throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  }
  const unsigned = unsignedIngress(draft, context)
  const signature = createHmac('sha256', secret).update(canonicalMiniAppBookingIngress(unsigned), 'utf8').digest('hex')
  return { body: { ...unsigned, signature }, headers: { 'content-type': 'application/json' } }
}

function unsignedIngress(
  draft: MiniAppRequestRecord,
  context: { timestamp: number; nonce: string },
): UnsignedMiniAppBookingIngressEnvelope {
  const common = {
    requestId: draft.requestId,
    payloadHash: draft.payloadHash!,
    staffId: draft.staffId,
    customerName: draft.customerName,
    facebookName: draft.facebookName,
    phoneNormalized: draft.phoneNormalized,
    doctorId: draft.doctorId,
    serviceId: draft.serviceId,
    queueType: draft.queueType,
    appointmentDate: draft.appointmentDate,
    appointmentTime: draft.appointmentTime,
    depositAmount: draft.depositAmount,
    channelId: draft.channelId,
    paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...draft.chatEvidenceFileIds],
  }
  if (draft.protocolVersion === 1) {
    return {
      kind: 'MINI_APP_BOOKING',
      version: 1,
      timestamp: context.timestamp,
      nonce: context.nonce,
      payload: { ...common, aeName: draft.aeName },
    } satisfies UnsignedMiniAppBookingIngressEnvelopeV1
  }
  if (draft.protocolVersion !== 2) throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  assertProtocol2Attribution(draft)
  return {
    kind: 'MINI_APP_BOOKING',
    version: 2,
    timestamp: context.timestamp,
    nonce: context.nonce,
    payload: {
      protocolVersion: 2,
      ...common,
      recorderName: draft.recorderName,
      adminId: draft.adminId,
      adminName: draft.adminName,
      aeId: draft.aeId,
      aeName: draft.aeId === null ? null : draft.aeName,
    },
  } satisfies UnsignedMiniAppBookingIngressEnvelopeV2
}

function assertProtocol2Attribution(draft: MiniAppRequestRecord): void {
  if (!safeAttributionId(draft.staffId) || !safeSnapshot(draft.recorderName)) {
    throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  }
  if (!safeAttributionId(draft.adminId) || reservedAttributionId(draft.adminId)
    || !safeSnapshot(draft.adminName) || draft.adminName === 'ไม่ระบุ') {
    throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  }
  if (draft.aeId === null) {
    if (draft.aeName !== 'ไม่ระบุ') throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
    return
  }
  if (!safeAttributionId(draft.aeId) || reservedAttributionId(draft.aeId)
    || !safeSnapshot(draft.aeName) || draft.aeName === 'ไม่ระบุ') {
    throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
  }
}

function safeAttributionId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function reservedAttributionId(value: string): boolean {
  return value.trim().toUpperCase() === 'NONE'
}

function safeSnapshot(value: string): boolean {
  return value === value.trim() && value.length > 0 && value.length <= 120
}

export function createBookingIngressClient(options: BookingIngressClientOptions): BookingIngressPort {
  const url = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 60_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? (() => crypto.randomUUID())
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (!url || !secret || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !request) {
    throw new Error('Invalid booking ingress client configuration')
  }

  return {
    async send(draft) {
      const built = buildMiniAppIngress(draft, { timestamp: now(), nonce: nonce() }, secret)
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const response = await request(url, {
          method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: controller.signal,
        })
        if (!response.ok) throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
        let body: unknown
        try { body = await response.json() } catch { throw new BookingIngressClientError('BOOKING_INGRESS_INVALID_RESPONSE') }
        if (!isIngressResult(body)) throw new BookingIngressClientError('BOOKING_INGRESS_INVALID_RESPONSE')
        return body
      } catch (error) {
        if (timedOut) throw new BookingIngressClientError('BOOKING_INGRESS_TIMEOUT')
        if (error instanceof BookingIngressClientError) throw error
        throw new BookingIngressClientError('BOOKING_INGRESS_FAILED')
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function isIngressResult(value: unknown): value is MiniAppBookingIngressResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return hasExactKeys(result, ['caseId', 'status', 'driveState', 'calendarState', 'lineState'])
    && typeof result.caseId === 'string'
    && /^PMC-\d{6}-\d{4,}$/.test(result.caseId)
    && (result.status === 'CONFIRMED' || result.status === 'TENTATIVE' || result.status === 'AWAITING_ADMIN_SLOT')
    && (result.driveState === 'OK' || result.driveState === 'RETRY')
    && (result.calendarState === 'PENDING' || result.calendarState === 'OK'
      || result.calendarState === 'RETRY' || result.calendarState === 'CONFLICT')
    && (result.lineState === 'PENDING' || result.lineState === 'OK' || result.lineState === 'RETRY')
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeNonce(value: string): boolean { return /^[A-Za-z0-9_-]{8,128}$/.test(value) }

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}
