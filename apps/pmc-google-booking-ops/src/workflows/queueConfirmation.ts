import { calendarEventInput } from '../adapters/googleCalendar'
import {
  bookingTeamProfiles,
  sendDoctorBookingMessage,
} from '../adapters/lineMessaging'
import {
  addMinutesInBangkok,
  deriveCallWindow,
} from '../domain/callSchedule'
import type { QueueConfirmationInput } from '../domain/queueConfirmation'
import type { BookingCase } from '../domain/types'
import type { BookingPorts, CalendarPort } from '../ports'
import { createInitialCallTask } from './callQueue'

function requireBooking(caseId: string, ports: BookingPorts): BookingCase {
  const booking = ports.repositories.bookings.getByCaseId(caseId)
  if (!booking) throw new Error(`booking not found: ${caseId}`)
  if (booking.queueType !== 'AUTO') throw new Error('booking is not an automatic queue')
  return booking
}

function requireServiceDuration(booking: BookingCase, ports: BookingPorts): number {
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    throw new Error(`service is not active: ${booking.serviceId}`)
  }
  return service.durationMinutes
}

function upsertConfirmedCalendarEvent(
  booking: BookingCase,
  calendar: CalendarPort,
): string {
  const input = calendarEventInput(booking)
  if (booking.calendarEventId) {
    const result = calendar.updateEvent(booking.calendarEventId, input)
    if (result === 'UPDATED') return booking.calendarEventId
    return calendar.createEvent({
      ...input,
      externalId: `${booking.caseId}:${booking.formResponseId}:confirmed-recovery`,
    })
  }
  return calendar.createEvent(input)
}

function enqueueDoctorConfirmationRetry(
  booking: BookingCase,
  error: unknown,
  ports: BookingPorts,
): void {
  const safeError = error instanceof Error
    ? error.message
        .replace(/https?:\/\/\S+/g, '[url]')
        .replace(/0\d{8,9}/g, '[phone]')
        .slice(0, 300)
    : 'doctor confirmation delivery failed'
  ports.repositories.retries.enqueue({
    id: `RETRY-${booking.caseId}-DOCTOR-CONFIRMATION`,
    caseId: booking.caseId,
    operation: 'DOCTOR_LINE_CONFIRMATION',
    idempotencyKey: `${booking.caseId}:DOCTOR_LINE_CONFIRMATION:${booking.version}`,
    attempts: 0,
    status: 'PENDING',
    safeError,
    payload: { messageVersion: booking.version },
  })
}

export function confirmQueue(
  input: QueueConfirmationInput,
  ports: BookingPorts,
): BookingCase {
  const confirmed = ports.locks.withLock(() => {
    const booking = requireBooking(input.caseId, ports)
    if (booking.appointmentStatus === 'CONFIRMED') return booking
    const start = `${input.appointmentDate}T${input.appointmentTime}:00+07:00`
    const end = addMinutesInBangkok(start, requireServiceDuration(booking, ports))
    const callWindow = deriveCallWindow(start)
    const candidate: BookingCase = {
      ...booking,
      appointmentStart: start,
      appointmentEnd: end,
      appointmentStatus: 'CONFIRMED',
    }
    const calendarEventId = upsertConfirmedCalendarEvent(candidate, ports.calendar)
    return ports.repositories.bookings.update(
      booking.caseId,
      booking.version,
      {
        appointmentStart: start,
        appointmentEnd: end,
        appointmentStatus: 'CONFIRMED',
        appointmentConfirmedAt: input.submittedAt,
        appointmentConfirmedBy: input.actorEmail,
        calendarEventId,
        calendarState: 'OK',
        firstCallWindowStart: callWindow.start,
        firstCallWindowEnd: callWindow.end,
        nextCallAt: `${input.appointmentDate}T09:00:00+07:00`,
        callStatus: 'PENDING',
      },
      {
        actor: input.actorEmail,
        reason: input.action === 'CHANGE'
          ? 'Automatic queue date changed and confirmed'
          : 'Automatic queue confirmed',
        correlationId: `${booking.caseId}:QUEUE_CONFIRM`,
      },
    )
  })

  createInitialCallTask(confirmed, ports)
  if (confirmed.doctorLineNotifiedAt) return confirmed
  try {
    sendDoctorBookingMessage(
      confirmed,
      ports.line,
      ports.config.brandLogoUrl(),
      'BOOKING_CONFIRMED',
      bookingTeamProfiles(confirmed, ports.config),
    )
    return ports.repositories.bookings.update(
      confirmed.caseId,
      confirmed.version,
      { doctorLineNotifiedAt: ports.clock.nowIso(), lineState: 'OK' },
      {
        actor: 'system',
        reason: 'Confirmed automatic queue sent to doctor',
        correlationId: `${confirmed.caseId}:DOCTOR_CONFIRM`,
      },
    )
  } catch (error) {
    enqueueDoctorConfirmationRetry(confirmed, error, ports)
    return ports.repositories.bookings.update(
      confirmed.caseId,
      confirmed.version,
      { lineState: 'RETRY' },
      {
        actor: 'system',
        reason: 'Doctor confirmation delivery queued for retry',
        correlationId: `${confirmed.caseId}:DOCTOR_CONFIRM`,
      },
    )
  }
}
