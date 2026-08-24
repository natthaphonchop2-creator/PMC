import type { AppointmentStatus, BookingCase, QueueType } from './types'

export function migrateAppointmentRows(
  rows: Record<string, unknown>[],
): BookingCase[] {
  return rows.map((row) => ({
    ...row,
    queueType: (row.queueType || 'NORMAL') as QueueType,
    appointmentStatus: (row.appointmentStatus ||
      (row.calendarEventId ? 'CONFIRMED' : 'AWAITING_ADMIN_SLOT')) as AppointmentStatus,
    appointmentProposedAt: row.appointmentProposedAt || null,
    appointmentConfirmedAt: row.appointmentConfirmedAt || null,
    appointmentConfirmedBy: row.appointmentConfirmedBy || null,
  })) as unknown as BookingCase[]
}
