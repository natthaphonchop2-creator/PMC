import type { BookingCase } from '../domain/types'
import type { CalendarEventInput, CalendarPort } from '../ports'
import { requireAppointment } from '../domain/appointment'

function firstCustomerName(customerName: string): string {
  return customerName.trim().split(/\s+/)[0] || customerName.trim()
}

function depositStatusLabel(status: BookingCase['depositStatus']): string {
  if (status === 'REFUNDED') return 'คืนเงินแล้ว'
  if (status === 'EXPIRED') return 'หมดอายุ'
  return 'โอนแล้ว'
}

function recorderDisplayName(booking: BookingCase): string {
  const recorderName = String(booking.recorderName ?? '').trim()
  if (recorderName) return recorderName
  const legacyAdminName = String(booking.adminName ?? '').trim()
  return legacyAdminName || 'ไม่ทราบ (เคสเดิม)'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function facebookSearchLink(facebookName: string): string {
  const searchUrl = `https://www.facebook.com/search/people/?q=${encodeURIComponent(facebookName)}`
  return `<a href="${searchUrl}">${escapeHtml(facebookName)}</a>`
}

export function calendarEventInput(booking: BookingCase): CalendarEventInput {
  if (!booking.calendarId) throw new Error('doctor calendar is not configured')
  const appointment = requireAppointment(booking)
  const tentative = booking.appointmentStatus === 'TENTATIVE'
  const summary = `${booking.doctorId} | ${booking.serviceId} | ${firstCustomerName(booking.customerName)}`
  return {
    calendarId: booking.calendarId,
    externalId: `${booking.caseId}:${booking.formResponseId}`,
    colorId: tentative ? '8' : '5',
    summary: tentative ? `รอยืนยัน | ${summary}` : summary,
    description: [
      `ลูกค้า: ${booking.customerName}`,
      `Facebook: ${facebookSearchLink(booking.facebookName)}`,
      `โทร: ${booking.phoneNormalized}`,
      `ช่องทาง: ${booking.channelId || 'ไม่ระบุ'}`,
      `มัดจำ: ${booking.depositAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาท · ${depositStatusLabel(booking.depositStatus)}`,
      `ผู้บันทึก: ${recorderDisplayName(booking)}`,
      `Admin: ${booking.adminName}`,
      `AE: ${booking.aeName || 'ไม่ระบุ'}`,
      ...(tentative ? ['สถานะนัด: รอยืนยัน'] : []),
    ].join('\n'),
    start: appointment.start,
    end: appointment.end,
    privateProperties: {
      caseId: booking.caseId,
      doctorId: booking.doctorId,
      appointmentStatus: booking.appointmentStatus,
    },
  }
}

export function ensureDoctorCalendarEvent(booking: BookingCase, calendar: CalendarPort): string {
  if (booking.calendarEventId) return booking.calendarEventId
  return calendar.createEvent(calendarEventInput(booking))
}

interface AdvancedCalendarEvent {
  id?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
}

interface AdvancedCalendarList {
  items?: AdvancedCalendarEvent[]
  nextPageToken?: string
}

interface AdvancedCalendarService {
  Events: {
    insert(resource: Record<string, unknown>, calendarId: string): AdvancedCalendarEvent
    update(resource: Record<string, unknown>, calendarId: string, eventId: string): AdvancedCalendarEvent
    list(calendarId: string, options: Record<string, unknown>): AdvancedCalendarList
  }
}

function service(): AdvancedCalendarService {
  return Calendar as unknown as AdvancedCalendarService
}

function resource(input: CalendarEventInput): Record<string, unknown> {
  return {
    id: input.externalId.toLowerCase().replace(/[^a-v0-9]/g, ''),
    colorId: input.colorId,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start, timeZone: 'Asia/Bangkok' },
    end: { dateTime: input.end, timeZone: 'Asia/Bangkok' },
    extendedProperties: { private: input.privateProperties },
  }
}

export function isCalendarAtCapacity(
  events: AdvancedCalendarEvent[],
  excludeEventId: string | null,
  capacity = 2,
): boolean {
  return events.filter((event) =>
    event.id !== excludeEventId && Boolean(event.start?.dateTime && event.end?.dateTime),
  ).length >= capacity
}

export function createGoogleCalendarPort(): CalendarPort {
  return {
    hasConflict(calendarId, start, end, excludeEventId = null) {
      const items = service().Events.list(calendarId, {
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        showDeleted: false,
      }).items
      return isCalendarAtCapacity(items ?? [], excludeEventId)
    },
    listEvents(calendarId, start, end) {
      const events: AdvancedCalendarEvent[] = []
      let pageToken: string | undefined
      do {
        const page = service().Events.list(calendarId, {
          timeMin: start,
          timeMax: end,
          singleEvents: true,
          showDeleted: false,
          ...(pageToken ? { pageToken } : {}),
        })
        events.push(...(page.items ?? []))
        pageToken = page.nextPageToken
      } while (pageToken)
      return events.flatMap((event) =>
        event.start?.dateTime && event.end?.dateTime
          ? [{ start: event.start.dateTime, end: event.end.dateTime }]
          : [],
      )
    },
    createEvent(input) {
      const created = service().Events.insert(resource(input), input.calendarId)
      if (!created.id) throw new Error('Calendar event ID missing')
      return created.id
    },
    updateEvent(eventId, input) {
      try {
        const updated = service().Events.update(resource(input), input.calendarId, eventId)
        if (!updated.id) throw new Error('Calendar update did not return an event ID')
        return 'UPDATED'
      } catch (error) {
        const details = error && typeof error === 'object'
          ? (error as { details?: { code?: unknown }; code?: unknown })
          : null
        const code = Number(details?.details?.code ?? details?.code)
        if (code === 404) return 'NOT_FOUND'
        throw error
      }
    },
  }
}
