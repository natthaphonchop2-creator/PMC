import type { BookingCase } from '../domain/types'
import type { BookingPorts, CryptoPort, LineMessage, LinePort } from '../ports'

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

const MISTY_ROSE = '#FEE5E0'

function appointmentDisplay(value: string): string {
  const [date, time = ''] = value.split('T')
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year} ${time.slice(0, 5)}`.trim()
}

function moneyDisplay(value: number): string {
  return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function flexRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#8A5A52', flex: 3, wrap: true },
      { type: 'text', text: value, size: 'sm', color: '#3D2C29', flex: 7, wrap: true },
    ],
  }
}

function bookingFlex(title: string, caseId: string, rows: Array<[string, string]>): Record<string, unknown> {
  return {
    type: 'flex',
    altText: `${title} · ${caseId}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        backgroundColor: MISTY_ROSE,
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#7A3E38', wrap: true },
          { type: 'text', text: caseId, size: 'sm', color: '#8A5A52', wrap: true },
          { type: 'separator', color: '#E7B8AF', margin: 'md' },
          ...rows.map(([label, value]) => flexRow(label, value)),
        ],
      },
    },
  }
}

export function doctorBookingMessage(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
): LineMessage {
  if (!booking.doctorLineGroupId) throw new Error('doctor LINE group is not configured')
  const title = eventType === 'BOOKING_CONFIRMED' ? 'นัดใหม่' : eventType === 'RESCHEDULED' ? 'เปลี่ยนเวลานัด' : 'ยกเลิกนัด'
  return {
    to: booking.doctorLineGroupId,
    audience: 'doctor',
    eventType,
    caseIds: [booking.caseId],
    text: [title, booking.caseId, booking.customerName, booking.phoneNormalized, booking.serviceId, booking.appointmentStart].join(' · '),
    apiMessage: bookingFlex(title, booking.caseId, [
      ['ลูกค้า', booking.customerName],
      ['เบอร์โทร', booking.phoneNormalized],
      ['โปรแกรม', booking.serviceId],
      ['วัน–เวลา', appointmentDisplay(booking.appointmentStart)],
      ['Admin', booking.adminName],
    ]),
    retryKey: `${booking.caseId}:${eventType}:${booking.version}`,
  }
}

export function adminBookingMessage(booking: BookingCase, adminLineGroupId: string): LineMessage {
  return {
    to: adminLineGroupId,
    audience: 'admin',
    eventType: 'BOOKING_CONFIRMED',
    caseIds: [booking.caseId],
    text: ['จองเคสใหม่', booking.caseId, booking.customerName, booking.phoneNormalized, booking.doctorId, booking.serviceId].join(' · '),
    apiMessage: bookingFlex('จองเคสใหม่', booking.caseId, [
      ['Admin', booking.adminName],
      ['ลูกค้า', booking.customerName],
      ['เบอร์โทร', booking.phoneNormalized],
      ['หมอ', booking.doctorId],
      ['โปรแกรม', booking.serviceId],
      ['วัน–เวลา', appointmentDisplay(booking.appointmentStart)],
      ['ยอดจอง', `${moneyDisplay(booking.depositAmount)} บาท`],
      ['ช่องทาง', booking.channelId || 'ไม่ระบุ'],
      ['หลักฐาน', `สลิป ${booking.paymentEvidenceCount} · แชท ${booking.chatEvidenceCount}`],
    ]),
    retryKey: `${booking.caseId}:ADMIN_BOOKING_CONFIRMED:${booking.version}`,
  }
}

export function sendDoctorBookingMessage(
  booking: BookingCase,
  line: LinePort,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' = 'BOOKING_CONFIRMED',
): void {
  line.push(doctorBookingMessage(booking, eventType))
}

export function sendBookingConfirmationMessages(booking: BookingCase, line: LinePort, adminLineGroupId: string): void {
  line.push(adminBookingMessage(booking, adminLineGroupId))
  line.push(doctorBookingMessage(booking, 'BOOKING_CONFIRMED'))
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
        payload: JSON.stringify({
          to: message.to,
          messages: [message.apiMessage ?? { type: 'text', text: message.text }],
        }),
        muteHttpExceptions: true,
      })
      const status = response.getResponseCode()
      if (status < 200 || status >= 300) throw new Error(`LINE push failed with status ${status}`)
    },
  }
}
