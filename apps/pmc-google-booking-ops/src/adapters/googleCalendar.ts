import type { BookingCase } from '../domain/types'
import type { CalendarEventInput, CalendarPort } from '../ports'

function firstCustomerName(customerName: string): string {
  return customerName.trim().split(/\s+/)[0] || customerName.trim()
}

function depositStatusLabel(status: BookingCase['depositStatus']): string {
  if (status === 'REFUNDED') return 'คืนเงินแล้ว'
  if (status === 'EXPIRED') return 'หมดอายุ'
  return 'โอนแล้ว'
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
  return {
    calendarId: booking.calendarId,
    externalId: `${booking.caseId}:${booking.formResponseId}`,
    colorId: '5',
    summary: `${booking.doctorId} | ${booking.serviceId} | ${firstCustomerName(booking.customerName)}`,
    description: [
      `ลูกค้า: ${booking.customerName}`,
      `Facebook: ${facebookSearchLink(booking.facebookName)}`,
      `โทร: ${booking.phoneNormalized}`,
      `ช่องทาง: ${booking.channelId || 'ไม่ระบุ'}`,
      `มัดจำ: ${booking.depositAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาท · ${depositStatusLabel(booking.depositStatus)}`,
      `Admin: ${booking.adminName}`,
      `AE: ${booking.aeName || 'ไม่ระบุ'}`,
    ].join('\n'),
    start: booking.appointmentStart,
    end: booking.appointmentEnd,
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

interface AdvancedCalendarService {
  Events: {
    insert(resource: Record<string, unknown>, calendarId: string): AdvancedCalendarEvent
    update(resource: Record<string, unknown>, calendarId: string, eventId: string): AdvancedCalendarEvent
    list(calendarId: string, options: Record<string, unknown>): { items?: AdvancedCalendarEvent[] }
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
    extendedProperties: { private: { caseId: input.externalId } },
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
    createEvent(input) {
      const created = service().Events.insert(resource(input), input.calendarId)
      if (!created.id) throw new Error('Calendar event ID missing')
      return created.id
    },
    updateEvent(eventId, input) {
      const updated = service().Events.update(resource(input), input.calendarId, eventId)
      if (!updated.id) throw new Error('Calendar update did not return an event ID')
    },
  }
}
