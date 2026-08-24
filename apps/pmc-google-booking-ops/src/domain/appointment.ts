import type { BookingCase } from './types'

export function requireAppointment(booking: BookingCase): {
  start: string
  end: string
} {
  if (!booking.appointmentStart || !booking.appointmentEnd) {
    throw new Error(`booking has no appointment: ${booking.caseId}`)
  }
  return { start: booking.appointmentStart, end: booking.appointmentEnd }
}
