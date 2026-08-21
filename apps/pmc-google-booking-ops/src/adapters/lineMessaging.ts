import type { BookingCase } from '../domain/types'
import type {
  BookingEvidenceImages,
  BookingPorts,
  CryptoPort,
  LineMessage,
  LinePort,
} from '../ports'
import {
  buildAdminMinimalReceipt,
  buildAdminTimeConflictReceipt,
  buildDoctorMinimalReceipt,
} from './minimalReceiptFlex'

export interface BookingIngressPayload {
  timestamp: number
  nonce: string
  sourceType: 'user' | 'group'
  sourceId: string
  signature: string
}

export interface AppsScriptDoPostEvent {
  postData: { contents: string; length: number; name: string; type: string }
}

export function parseBookingIngressEvent(event: AppsScriptDoPostEvent): BookingIngressPayload {
  const parsed = JSON.parse(event.postData.contents) as Partial<BookingIngressPayload>
  if (
    typeof parsed.timestamp !== 'number' ||
    typeof parsed.nonce !== 'string' ||
    !['user', 'group'].includes(String(parsed.sourceType)) ||
    typeof parsed.sourceId !== 'string' ||
    typeof parsed.signature !== 'string'
  ) {
    throw new Error('invalid booking ingress payload')
  }
  return parsed as BookingIngressPayload
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

export function doctorBookingMessage(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
  brandLogoUrl: string,
  messageVersion = booking.version,
): LineMessage {
  if (!booking.doctorLineGroupId) throw new Error('doctor LINE group is not configured')
  const apiMessage = buildDoctorMinimalReceipt(booking, eventType, brandLogoUrl)
  return {
    to: booking.doctorLineGroupId,
    audience: 'doctor',
    eventType,
    caseIds: [booking.caseId],
    text: String(apiMessage.altText),
    apiMessage,
    retryKey: `${booking.caseId}:${eventType}:${messageVersion}`,
  }
}

export function adminBookingMessage(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  messageVersion = booking.version,
): LineMessage {
  const apiMessage = buildAdminMinimalReceipt(booking, evidence, brandLogoUrl)
  return {
    to: adminLineGroupId,
    audience: 'admin',
    eventType: 'BOOKING_CONFIRMED',
    caseIds: [booking.caseId],
    text: String(apiMessage.altText),
    apiMessage,
    retryKey: `${booking.caseId}:ADMIN_BOOKING_CONFIRMED:${messageVersion}`,
  }
}

export function adminTimeConflictMessage(
  booking: BookingCase,
  adminLineGroupId: string,
  brandLogoUrl: string,
  messageVersion = booking.version,
): LineMessage {
  const apiMessage = buildAdminTimeConflictReceipt(booking, brandLogoUrl)
  return {
    to: adminLineGroupId,
    audience: 'admin',
    eventType: 'TIME_CONFLICT',
    caseIds: [booking.caseId],
    text: String(apiMessage.altText),
    apiMessage,
    retryKey: `${booking.caseId}:ADMIN_TIME_CONFLICT:${messageVersion}`,
  }
}

export function sendDoctorBookingMessage(
  booking: BookingCase,
  line: LinePort,
  brandLogoUrl: string,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' = 'BOOKING_CONFIRMED',
): void {
  line.push(doctorBookingMessage(booking, eventType, brandLogoUrl))
}

export function sendBookingConfirmationMessages(
  booking: BookingCase,
  line: LinePort,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  messageVersion = booking.version,
): void {
  line.push(adminBookingMessage(booking, adminLineGroupId, evidence, brandLogoUrl, messageVersion))
  line.push(doctorBookingMessage(booking, 'BOOKING_CONFIRMED', brandLogoUrl, messageVersion))
}

export function createAppsScriptCryptoPort(): CryptoPort {
  const hex = (bytes: number[]) => bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, '0')).join('')
  return {
    hmacSha256Hex: (value, secret) => hex(Utilities.computeHmacSha256Signature(value, secret)),
    sha256Hex: (value) => hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)),
    base64UrlUtf8: (value) =>
      Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/, ''),
  }
}

export function isLinePushAcceptedStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 409
}

export function formatLinePushError(status: number, responseBody: unknown): string {
  const detail = String(responseBody ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
  return `LINE push failed with status ${status}${detail ? `: ${detail}` : ''}`
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
        payload: JSON.stringify({
          to: message.to,
          messages: [message.apiMessage ?? { type: 'text', text: message.text }],
        }),
        muteHttpExceptions: true,
      })
      const status = response.getResponseCode()
      if (!isLinePushAcceptedStatus(status)) {
        throw new Error(formatLinePushError(status, response.getContentText()))
      }
    },
  }
}
