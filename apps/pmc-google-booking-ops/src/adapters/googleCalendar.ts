import type { BookingCase } from '../domain/types'
import type { CalendarEventInput, CalendarPort } from '../ports'

export function calendarEventInput(booking: BookingCase): CalendarEventInput {
  if (!booking.calendarId) throw new Error('doctor calendar is not configured')
  return {
    calendarId: booking.calendarId,
    externalId: `${booking.caseId}:${booking.formResponseId}`,
    colorId: '5',
    summary: `${booking.customerName} · ${booking.phoneNormalized}`,
    description: `บริการ ${booking.serviceId}\nอ้างอิง ${booking.caseId}`,
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

export function createGoogleCalendarPort(): CalendarPort {
  return {
    hasConflict(calendarId, start, end, excludeEventId = null) {
      const items = service().Events.list(calendarId, {
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        showDeleted: false,
      }).items
      return (items ?? []).some((event) => event.id !== excludeEventId && Boolean(event.start?.dateTime && event.end?.dateTime))
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
