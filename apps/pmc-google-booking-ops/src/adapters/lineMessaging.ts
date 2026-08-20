import type { BookingCase } from '../domain/types'
import type { BookingPorts, CryptoPort, LineMessage, LinePort } from '../ports'

export interface BookingIngressPayload {
  timestamp: number
  nonce: string
  sourceType: 'user' | 'group'
  sourceId: string
  signature: string
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

function ingressCanonical(payload: Omit<BookingIngressPayload, 'signature'>): string {
  return `${payload.timestamp}.${payload.nonce}.${payload.sourceType}.${payload.sourceId}`
}

export function handleLineDirectoryIngress(payload: BookingIngressPayload, ports: BookingPorts): void {
  const { signature, ...unsigned } = payload
  const expected = ports.crypto.hmacSha256Hex(ingressCanonical(unsigned), ports.secrets.bookingIngressSecret())
  if (!constantTimeEqual(signature, expected)) throw new Error('invalid booking ingress signature')

  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - payload.timestamp) > 300) {
    throw new Error('expired booking ingress timestamp')
  }
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(payload.sourceId)) throw new Error('invalid LINE source ID')
  if (ports.repositories.lineDirectory.hasNonce(payload.nonce)) throw new Error('booking ingress replay detected')
  ports.repositories.lineDirectory.rememberNonce(payload.nonce, ports.clock.nowIso())
  if (!ports.secrets.lineDirectoryCaptureEnabled()) return
  ports.repositories.lineDirectory.remember({
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    capturedAt: ports.clock.nowIso(),
  })
}

function maskedName(value: string): string {
  const first = [...value.trim()][0]
  return first ? `${first}***` : 'ลูกค้า'
}

export function doctorBookingMessage(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
): LineMessage {
  if (!booking.doctorLineGroupId) throw new Error('doctor LINE group is not configured')
  return {
    to: booking.doctorLineGroupId,
    audience: 'doctor',
    eventType,
    caseIds: [booking.caseId],
    text: [
      eventType === 'BOOKING_CONFIRMED' ? 'นัดใหม่' : eventType === 'RESCHEDULED' ? 'เปลี่ยนเวลานัด' : 'ยกเลิกนัด',
      booking.caseId,
      maskedName(booking.customerName),
      booking.serviceId,
      booking.appointmentStart,
    ].join(' · '),
    retryKey: `${booking.caseId}:${eventType}:${booking.version}`,
  }
}

export function sendDoctorBookingMessage(
  booking: BookingCase,
  line: LinePort,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' = 'BOOKING_CONFIRMED',
): void {
  line.push(doctorBookingMessage(booking, eventType))
}

export function createAppsScriptCryptoPort(): CryptoPort {
  const hex = (bytes: number[]) => bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, '0')).join('')
  return {
    hmacSha256Hex: (value, secret) => hex(Utilities.computeHmacSha256Signature(value, secret)),
    sha256Hex: (value) => hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)),
  }
}

export function createGoogleLinePort(accessToken: string): LinePort {
  const properties = PropertiesService.getScriptProperties()
  return {
    push(message) {
      const propertyKey = `LINE_RETRY_${message.retryKey}`
      const retryUuid = properties.getProperty(propertyKey) ?? Utilities.getUuid()
      properties.setProperty(propertyKey, retryUuid)
      const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Line-Retry-Key': retryUuid,
        },
        payload: JSON.stringify({ to: message.to, messages: [{ type: 'text', text: message.text }] }),
        muteHttpExceptions: true,
      })
      const status = response.getResponseCode()
      if (status < 200 || status >= 300) throw new Error(`LINE push failed with status ${status}`)
    },
  }
}
