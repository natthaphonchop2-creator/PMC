import type { BookingCase } from '../domain/types'
import type { BookingEvidenceImages, EvidenceImageRef } from '../ports'

const TEXT = '#282624'
const SECONDARY = '#77716D'
const GOLD = '#B78220'
const SEPARATOR = '#E6E3DF'
const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const

type FlexComponent = Record<string, unknown>

export function formatThaiAppointment(value: string): { date: string; time: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) throw new Error('invalid appointment date or time')
  const [, rawYear, rawMonth, rawDay, hour, minute] = match
  const month = Number(rawMonth)
  const monthName = THAI_MONTHS[month - 1]
  if (!monthName) throw new Error('invalid appointment month')
  return {
    date: `${Number(rawDay)} ${monthName} ${Number(rawYear) + 543}`,
    time: `เวลา ${hour}:${minute} น.`,
  }
}

function moneyDisplay(value: number): string {
  return `${value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} บาท`
}

function separator(): FlexComponent {
  return { type: 'separator', color: SEPARATOR, margin: 'xl' }
}

function sectionTitle(text: string): FlexComponent {
  return {
    type: 'text',
    text,
    size: 'md',
    weight: 'bold',
    color: TEXT,
    margin: 'xl',
  }
}

function keyValueRow(label: string, value: string, emphasized = false): FlexComponent {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: emphasized ? 'lg' : 'md',
    contents: [
      { type: 'text', text: label, color: emphasized ? TEXT : SECONDARY, size: emphasized ? 'md' : 'sm', flex: 5 },
      {
        type: 'text',
        text: value,
        color: TEXT,
        size: emphasized ? 'xl' : 'sm',
        weight: 'bold',
        align: 'end',
        wrap: true,
        flex: 7,
      },
    ],
  }
}

function header(title: string, booking: BookingCase, brandLogoUrl: string): FlexComponent {
  if (!brandLogoUrl.startsWith('https://')) throw new Error('brand logo URL must use HTTPS')
  const appointment = formatThaiAppointment(booking.appointmentStart)
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: '#FFFFFF',
    paddingAll: '20px',
    contents: [
      {
        type: 'image',
        url: brandLogoUrl,
        size: 'sm',
        aspectRatio: '1:1',
        aspectMode: 'fit',
        align: 'center',
      },
      {
        type: 'text',
        text: 'PROMED CLINIC',
        size: 'xs',
        color: SECONDARY,
        align: 'center',
        margin: 'md',
      },
      {
        type: 'text',
        text: title,
        size: 'xl',
        weight: 'bold',
        color: GOLD,
        align: 'center',
        margin: 'sm',
      },
      {
        type: 'text',
        text: appointment.date,
        size: 'md',
        weight: 'bold',
        color: TEXT,
        align: 'center',
        margin: 'md',
      },
      {
        type: 'text',
        text: appointment.time,
        size: 'sm',
        color: SECONDARY,
        align: 'center',
        margin: 'xs',
      },
    ],
  }
}

function evidenceTile(
  image: EvidenceImageRef,
  label: string,
  aspectMode: 'fit' | 'cover',
): FlexComponent {
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    contents: [
      {
        type: 'image',
        url: image.previewUrl,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode,
        backgroundColor: '#F6F5F3',
        action: { type: 'uri', label: 'เปิดรูปขนาดเต็ม', uri: image.fullUrl },
      },
      { type: 'text', text: label, size: 'xxs', color: SECONDARY, align: 'center', margin: 'xs' },
    ],
  }
}

function evidenceStrip(evidence: BookingEvidenceImages): FlexComponent {
  const slots: FlexComponent[] = []
  if (evidence.payment) slots.push(evidenceTile(evidence.payment, 'สลิป', 'fit'))
  for (const [index, image] of evidence.chats.slice(0, 3).entries()) {
    slots.push(evidenceTile(image, `แชท ${index + 1}`, 'cover'))
  }
  while (slots.length < 4) slots.push({ type: 'filler', flex: 1 })
  return { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', contents: slots }
}

function bubble(
  title: string,
  booking: BookingCase,
  brandLogoUrl: string,
  bodyContents: FlexComponent[],
): FlexComponent {
  const appointment = formatThaiAppointment(booking.appointmentStart)
  return {
    type: 'flex',
    altText: `${title} · ${appointment.date} ${appointment.time}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: header(title, booking, brandLogoUrl),
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '20px',
        paddingTop: '0px',
        contents: bodyContents,
      },
    },
  }
}

function customerSection(booking: BookingCase): FlexComponent[] {
  return [
    separator(),
    sectionTitle('ข้อมูลลูกค้า'),
    { type: 'text', text: booking.customerName, size: 'md', weight: 'bold', color: TEXT, margin: 'md', wrap: true },
    { type: 'text', text: booking.phoneNormalized, size: 'sm', color: SECONDARY, margin: 'xs' },
  ]
}

function teamSection(booking: BookingCase): FlexComponent[] {
  return [
    separator(),
    sectionTitle('ทีมผู้ดูแล'),
    keyValueRow('ปิดการจอง', booking.adminName),
    keyValueRow('AE เปิดแชท', booking.aeName ?? 'ไม่ระบุ (เคสเดิม)'),
  ]
}

export function buildAdminMinimalReceipt(
  booking: BookingCase,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
): FlexComponent {
  const hasEvidence = Boolean(evidence.payment || evidence.chats.length)
  return bubble('จองเคสใหม่', booking, brandLogoUrl, [
    ...customerSection(booking),
    separator(),
    sectionTitle('รายละเอียดการจอง'),
    keyValueRow('แพทย์', booking.doctorId),
    keyValueRow('โปรแกรม', booking.serviceId),
    keyValueRow('ช่องทาง', booking.channelId || 'ไม่ระบุ'),
    keyValueRow('ยอดจอง', moneyDisplay(booking.depositAmount), true),
    ...teamSection(booking),
    separator(),
    sectionTitle('หลักฐาน'),
    ...(hasEvidence
      ? [
          evidenceStrip(evidence),
          {
            type: 'text',
            text: 'แตะรูปเพื่อเปิดภาพขนาดเต็ม',
            size: 'xxs',
            color: SECONDARY,
            align: 'center',
            margin: 'sm',
          },
        ]
      : [
          {
            type: 'text',
            text: 'รูปหลักฐานยังไม่พร้อมแสดง',
            size: 'sm',
            color: SECONDARY,
            margin: 'md',
          },
        ]),
  ])
}

export function buildDoctorMinimalReceipt(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
  brandLogoUrl: string,
): FlexComponent {
  const title = eventType === 'BOOKING_CONFIRMED'
    ? 'จองเคสใหม่'
    : eventType === 'RESCHEDULED'
      ? 'เปลี่ยนเวลานัด'
      : 'ยกเลิกนัด'
  return bubble(title, booking, brandLogoUrl, [
    ...customerSection(booking),
    separator(),
    sectionTitle('รายละเอียดการจอง'),
    keyValueRow('แพทย์', booking.doctorId),
    keyValueRow('โปรแกรม', booking.serviceId),
    ...teamSection(booking),
  ])
}
