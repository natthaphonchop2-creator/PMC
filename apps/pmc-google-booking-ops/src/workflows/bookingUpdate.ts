import { calendarEventInput } from '../adapters/googleCalendar'
import { addMinutesInBangkok, deriveCallWindow } from '../domain/callSchedule'
import type { BookingCase } from '../domain/types'
import type { BookingPorts } from '../ports'

export interface RescheduleInput {
  appointmentStart: string
  reason: string
  actor?: string
}

export function rescheduleBooking(caseId: string, input: RescheduleInput, ports: BookingPorts): BookingCase {
  const booking = ports.repositories.bookings.getByCaseId(caseId)
  if (!booking) throw new Error('booking not found')
  if (!booking.calendarEventId || !booking.calendarId) throw new Error('booking has no Calendar event')
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active) throw new Error('selected service is not active')

  const appointmentEnd = addMinutesInBangkok(input.appointmentStart, service.durationMinutes)
  if (
    ports.calendar.hasConflict(
      booking.calendarId,
      input.appointmentStart,
      appointmentEnd,
      booking.calendarEventId,
    )
  ) {
    return ports.repositories.bookings.update(
      caseId,
      booking.version,
      { status: 'TIME_CONFLICT', calendarState: 'CONFLICT' },
      {
        actor: input.actor ?? booking.submitterEmail,
        reason: input.reason,
        correlationId: `${caseId}:RESCHEDULE_CONFLICT:${booking.version + 1}`,
      },
    )
  }

  const candidate: BookingCase = { ...booking, appointmentStart: input.appointmentStart, appointmentEnd }
  ports.calendar.updateEvent(booking.calendarEventId, calendarEventInput(candidate))
  const callWindow = deriveCallWindow(input.appointmentStart)
  const appointmentDate = input.appointmentStart.slice(0, 10)
  return ports.repositories.bookings.update(
    caseId,
    booking.version,
    {
      appointmentStart: input.appointmentStart,
      appointmentEnd,
      status: 'REBOOKED',
      calendarState: 'OK',
      firstCallWindowStart: callWindow.start,
      firstCallWindowEnd: callWindow.end,
      nextCallAt: `${appointmentDate}T09:00:00+07:00`,
      callStatus: 'PENDING',
    },
    {
      actor: input.actor ?? booking.submitterEmail,
      reason: input.reason,
      correlationId: `${caseId}:RESCHEDULE:${booking.version + 1}`,
    },
  )
}
