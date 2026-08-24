import type { BookingPorts } from '../ports'

export interface IntegrityFinding {
  code: string
  caseIds: string[]
}

export interface IntegrityReport {
  codes: string[]
  findings: IntegrityFinding[]
}

export function runIntegrityReport(ports: BookingPorts): IntegrityReport {
  const bookings = ports.repositories.bookings.list()
  const calls = ports.repositories.calls.list()
  const findings: IntegrityFinding[] = []

  const missingDrive = bookings
    .filter((booking) => ['BOOKING_CONFIRMED', 'REBOOKED'].includes(booking.status) && !booking.driveFolderId)
    .map((booking) => booking.caseId)
  if (missingDrive.length) findings.push({ code: 'MISSING_DRIVE_FOLDER', caseIds: missingDrive })

  const missingCalendar = bookings
    .filter((booking) =>
      ['CONFIRMED', 'TENTATIVE'].includes(booking.appointmentStatus) &&
      !booking.calendarEventId,
    )
    .map((booking) => booking.caseId)
  if (missingCalendar.length) findings.push({ code: 'MISSING_CALENDAR_EVENT', caseIds: missingCalendar })

  const closedWithCall = bookings
    .filter((booking) => ['CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M'].includes(booking.status))
    .filter((booking) => calls.some((call) => call.caseId === booking.caseId && !['DONE', 'CANCELLED'].includes(call.status)))
    .map((booking) => booking.caseId)
  if (closedWithCall.length) findings.push({ code: 'CLOSED_WITH_ACTIVE_CALL', caseIds: closedWithCall })

  const byPaymentId = new Map<string, string[]>()
  for (const booking of bookings) {
    if (!booking.jeraPaymentId) continue
    byPaymentId.set(booking.jeraPaymentId, [...(byPaymentId.get(booking.jeraPaymentId) ?? []), booking.caseId])
  }
  const duplicateJera = [...byPaymentId.values()].filter((caseIds) => caseIds.length > 1).flat()
  if (duplicateJera.length) findings.push({ code: 'DUPLICATE_JERA_PAYMENT_ID', caseIds: duplicateJera })

  return { codes: findings.map((finding) => finding.code), findings }
}

export function createDailyBackup(ports: BookingPorts): void {
  const today = ports.clock.nowIso().slice(0, 10)
  if (!ports.backups.hasBackup(today)) ports.backups.createBackup(today)
}
