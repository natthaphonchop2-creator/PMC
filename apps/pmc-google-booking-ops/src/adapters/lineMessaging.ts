import type { BookingCase } from '../domain/types'
import type {
  BookingEvidenceImages,
  BookingPorts,
  ConfigPort,
  CryptoPort,
  LineMessage,
  LinePort,
} from '../ports'
import {
  buildAdminMinimalReceipt,
  buildAdminTentativeReceipt,
  buildAdminAwaitingSlotReceipt,
  buildAdminTimeConflictReceipt,
  buildDoctorMinimalReceipt,
  type TeamProfileImages,
} from './minimalReceiptFlex'
import { buildEvidenceFlexMessages } from './evidenceCarouselFlex'

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
  return parseBookingIngressPayload(JSON.parse(event.postData.contents))
}

export function parseBookingIngressPayload(input: unknown): BookingIngressPayload {
  const parsed = input as Partial<BookingIngressPayload>
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
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

function safeProfileUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  if (!normalized.startsWith('https://')) return null
  if (/^https:\/\/(?:drive|docs)\.google\.com(?:\/|$)/i.test(normalized)) return null
  return normalized
}

export function bookingTeamProfiles(
  booking: BookingCase,
  config: ConfigPort,
): TeamProfileImages {
  return {
    closer: booking.adminId
      ? safeProfileUrl(config.findStaffById(booking.adminId)?.profileImageUrl)
      : null,
    ae: booking.aeId
      ? safeProfileUrl(config.findStaffById(booking.aeId)?.profileImageUrl)
      : null,
  }
}

export function doctorBookingMessage(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage {
  if (!booking.doctorLineGroupId) throw new Error('doctor LINE group is not configured')
  const apiMessage = buildDoctorMinimalReceipt(booking, eventType, brandLogoUrl, profiles)
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
  profiles?: TeamProfileImages,
): LineMessage {
  const apiMessage = buildAdminMinimalReceipt(booking, evidence, brandLogoUrl, profiles)
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

function lineObjectBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  objects: Record<string, unknown>[],
  retryPrefix: string,
  messageVersion: number,
  eventType: LineMessage['eventType'] = 'BOOKING_CONFIRMED',
): LineMessage[] {
  return Array.from(
    { length: Math.ceil(objects.length / 5) },
    (_, batchIndex) => ({
      to: adminLineGroupId,
      audience: 'admin',
      eventType,
      caseIds: [booking.caseId],
      text: `จองเคสใหม่ · ${booking.customerName}`,
      apiMessages: objects.slice(batchIndex * 5, batchIndex * 5 + 5),
      retryKey: `${booking.caseId}:${retryPrefix}:${messageVersion}:BATCH:${batchIndex + 1}`,
    }),
  )
}

export function adminTentativeMessageBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  confirmUrl: string,
  changeUrl: string,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage[] {
  return lineObjectBatches(
    booking,
    adminLineGroupId,
    [
      buildAdminTentativeReceipt(
        booking,
        evidence,
        confirmUrl,
        changeUrl,
        brandLogoUrl,
        profiles,
      ),
    ],
    'ADMIN_TENTATIVE_BOOKING',
    messageVersion,
    'TENTATIVE_BOOKING',
  )
}

export function adminAwaitingSlotMessageBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  changeUrl: string,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage[] {
  return lineObjectBatches(
    booking,
    adminLineGroupId,
    [
      buildAdminAwaitingSlotReceipt(
        booking,
        evidence,
        changeUrl,
        brandLogoUrl,
        profiles,
      ),
    ],
    'ADMIN_AWAITING_SLOT',
    messageVersion,
    'AWAITING_SLOT',
  )
}

export function adminBookingMessageBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage[] {
  const summary = buildAdminMinimalReceipt(booking, evidence, brandLogoUrl, profiles)
  return lineObjectBatches(
    booking,
    adminLineGroupId,
    [summary],
    'ADMIN_BOOKING_CONFIRMED',
    messageVersion,
  )
}

export function adminEvidenceMessageBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  messageVersion = booking.version,
): LineMessage[] {
  return lineObjectBatches(
    booking,
    adminLineGroupId,
    buildEvidenceFlexMessages(evidence, booking.driveFolderUrl),
    'ADMIN_EVIDENCE_READY',
    messageVersion,
  )
}

export function adminTimeConflictMessage(
  booking: BookingCase,
  adminLineGroupId: string,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage {
  const apiMessage = buildAdminTimeConflictReceipt(booking, brandLogoUrl, profiles)
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
  profiles?: TeamProfileImages,
): void {
  line.push(doctorBookingMessage(booking, eventType, brandLogoUrl, booking.version, profiles))
}

export function sendBookingConfirmationMessages(
  booking: BookingCase,
  line: LinePort,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): void {
  for (const message of adminBookingMessageBatches(
    booking,
    adminLineGroupId,
    evidence,
    brandLogoUrl,
    messageVersion,
    profiles,
  )) line.push(message)
  line.push(doctorBookingMessage(
    booking,
    'BOOKING_CONFIRMED',
    brandLogoUrl,
    messageVersion,
    profiles,
  ))
}

export function createAppsScriptCryptoPort(): CryptoPort {
  const hex = (bytes: number[]) => bytes.map((byte) => (byte & 0xff).toString(16).padStart(2, '0')).join('')
  return {
    hmacSha256Hex: (value, secret) => hex(Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8)),
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
      const messages = message.apiMessages ?? [
        message.apiMessage ?? { type: 'text', text: message.text },
      ]
      if (messages.length < 1 || messages.length > 5) {
        throw new Error('LINE push requires 1-5 messages')
      }
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
          messages,
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
