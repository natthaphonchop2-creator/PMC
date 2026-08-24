import { calendarEventInput } from '../adapters/googleCalendar'
import { bookingTeamProfiles, sendDoctorBookingMessage } from '../adapters/lineMessaging'
import { addMinutesInBangkok, deriveCallWindow } from '../domain/callSchedule'
import type { BookingCase } from '../domain/types'
import type { BookingPorts } from '../ports'

export interface RescheduleInput {
  appointmentStart: string
  reason: string
  actor?: string
}

export function refreshBookingCalendarPresentation(
  caseId: string,
  ports: BookingPorts,
): BookingCase {
  const booking = ports.repositories.bookings.getByCaseId(caseId)
  if (!booking) throw new Error('booking not found')
  if (!booking.calendarEventId || !booking.calendarId) {
    throw new Error('booking has no Calendar event')
  }
  ports.calendar.updateEvent(
    booking.calendarEventId,
    calendarEventInput(booking),
  )
  return booking
}

export function rescheduleBooking(caseId: string, input: RescheduleInput, ports: BookingPorts): BookingCase {
  const booking = ports.repositories.bookings.getByCaseId(caseId)
  if (!booking) throw new Error('booking not found')
  if (!booking.calendarEventId || !booking.calendarId) throw new Error('booking has no Calendar event')
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active) throw new Error('selected service is not active')

  const appointmentEnd = addMinutesInBangkok(input.appointmentStart, service.durationMinutes)
  const candidate: BookingCase = { ...booking, appointmentStart: input.appointmentStart, appointmentEnd }
  ports.calendar.updateEvent(booking.calendarEventId, calendarEventInput(candidate))
  const callWindow = deriveCallWindow(input.appointmentStart)
  const appointmentDate = input.appointmentStart.slice(0, 10)
  let updated = ports.repositories.bookings.update(
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
  try {
    sendDoctorBookingMessage(
      updated,
      ports.line,
      ports.config.brandLogoUrl(),
      'RESCHEDULED',
      bookingTeamProfiles(updated, ports.config),
    )
    updated = ports.repositories.bookings.update(
      caseId,
      updated.version,
      { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
      {
        actor: 'system',
        reason: 'Doctor LINE reschedule notification sent',
        correlationId: `${caseId}:RESCHEDULE_LINE:${updated.version + 1}`,
      },
    )
  } catch (error) {
    ports.repositories.retries.enqueue({
      id: `RETRY-${caseId}-RESCHEDULE-LINE`,
      caseId,
      operation: 'DOCTOR_LINE_RESCHEDULE',
      idempotencyKey: `${caseId}:RESCHEDULED:${updated.version}`,
      attempts: 0,
      status: 'PENDING',
      safeError: error instanceof Error ? error.message : 'LINE reschedule notification failed',
    })
  }
  return updated
}
