import type { BookingCase } from '../domain/types'
import type { BookingEvidenceImages } from '../ports'

const TEXT = '#282624'
const SECONDARY = '#77716D'
const GOLD = '#B78220'
const WARNING = '#D97706'
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

export interface TeamProfileImages {
  closer: string | null
  ae: string | null
}

const EMPTY_TEAM_PROFILES: TeamProfileImages = { closer: null, ae: null }

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

function header(
  title: string,
  booking: BookingCase,
  brandLogoUrl: string,
  titleColor = GOLD,
): FlexComponent {
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
        color: titleColor,
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

function bubble(
  title: string,
  booking: BookingCase,
  brandLogoUrl: string,
  bodyContents: FlexComponent[],
  titleColor = GOLD,
): FlexComponent {
  const appointment = formatThaiAppointment(booking.appointmentStart)
  return {
    type: 'flex',
    altText: `${title} · ${appointment.date} ${appointment.time}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: header(title, booking, brandLogoUrl, titleColor),
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

function profileAvatar(profileImageUrl: string | null): FlexComponent {
  const contents: FlexComponent[] = profileImageUrl?.startsWith('https://')
    ? [
        {
          type: 'image',
          url: profileImageUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
        },
      ]
    : [{ type: 'text', text: ' ', size: 'xxs', color: '#F4F1EC' }]
  return {
    type: 'box',
    layout: 'vertical',
    width: '32px',
    height: '32px',
    flex: 0,
    cornerRadius: '16px',
    backgroundColor: '#F4F1EC',
    contents,
  }
}

function teamMemberRow(label: string, name: string, profileImageUrl: string | null): FlexComponent {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    alignItems: 'center',
    contents: [
      { type: 'text', text: label, color: SECONDARY, size: 'sm', flex: 5 },
      {
        type: 'box',
        layout: 'horizontal',
        flex: 7,
        spacing: 'sm',
        alignItems: 'center',
        justifyContent: 'flex-start',
        contents: [
          profileAvatar(profileImageUrl),
          {
            type: 'text',
            text: name,
            color: TEXT,
            size: 'sm',
            weight: 'bold',
            align: 'start',
            wrap: true,
            flex: 1,
          },
        ],
      },
    ],
  }
}

function teamSection(
  booking: BookingCase,
  profiles: TeamProfileImages = EMPTY_TEAM_PROFILES,
): FlexComponent[] {
  return [
    separator(),
    sectionTitle('ทีมผู้ดูแล'),
    teamMemberRow('Admin', booking.adminName, profiles.closer),
    teamMemberRow('AE', booking.aeName ?? 'ไม่ระบุ (เคสเดิม)', profiles.ae),
  ]
}

export function buildAdminMinimalReceipt(
  booking: BookingCase,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  profiles: TeamProfileImages = EMPTY_TEAM_PROFILES,
): FlexComponent {
  const hasEvidence = Boolean(evidence.totalPaymentCount || evidence.totalChatCount)
  const evidenceReady = Boolean(evidence.payments.length || evidence.chats.length)
  return bubble('จองเคสใหม่', booking, brandLogoUrl, [
    ...customerSection(booking),
    separator(),
    sectionTitle('รายละเอียดการจอง'),
    keyValueRow('แพทย์', booking.doctorId),
    keyValueRow('โปรแกรม', booking.serviceId),
    keyValueRow('ช่องทาง', booking.channelId || 'ไม่ระบุ'),
    keyValueRow('ยอดจอง', moneyDisplay(booking.depositAmount), true),
    ...teamSection(booking, profiles),
    separator(),
    sectionTitle('หลักฐาน'),
    ...(hasEvidence
      ? [
          keyValueRow('สลิป', `${evidence.totalPaymentCount} รูป`),
          keyValueRow('แชท', `${evidence.totalChatCount} รูป`),
          {
            type: 'text',
            text: evidenceReady
              ? 'รูปทั้งหมดแสดงในข้อความถัดไป'
              : 'รูปหลักฐานกำลังเตรียมแสดง',
            size: 'xxs',
            color: SECONDARY,
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
  profiles: TeamProfileImages = EMPTY_TEAM_PROFILES,
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
    ...teamSection(booking, profiles),
  ])
}

export function buildAdminTimeConflictReceipt(
  booking: BookingCase,
  brandLogoUrl: string,
  profiles: TeamProfileImages = EMPTY_TEAM_PROFILES,
): FlexComponent {
  return bubble('นัดซ้อน — ยังไม่ยืนยัน', booking, brandLogoUrl, [
    separator(),
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#FFF7E6',
      cornerRadius: 'md',
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: 'ตรวจพบเวลานัดซ้อน',
          color: WARNING,
          weight: 'bold',
          size: 'md',
          wrap: true,
        },
        {
          type: 'text',
          text: 'ยังไม่สร้าง Calendar',
          color: TEXT,
          size: 'sm',
          margin: 'sm',
          wrap: true,
        },
        {
          type: 'text',
          text: 'ยังไม่แจ้งกลุ่มหมอ กรุณาตรวจสอบและเลือกเวลาใหม่',
          color: SECONDARY,
          size: 'sm',
          margin: 'xs',
          wrap: true,
        },
      ],
    },
    ...customerSection(booking),
    separator(),
    sectionTitle('รายละเอียดการจอง'),
    keyValueRow('แพทย์', booking.doctorId),
    keyValueRow('โปรแกรม', booking.serviceId),
    ...teamSection(booking, profiles),
  ], WARNING)
}
