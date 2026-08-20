import { addCalendarMonths, deriveCallWindow } from '../domain/callSchedule'
import { formatCaseId } from '../domain/caseId'
import { maskThaiPhone, normalizeCustomerName, normalizeThaiPhone } from '../domain/normalize'
import type { BookingCase, BookingIntake } from '../domain/types'
import type { BookingPorts } from '../ports'

function bangkokIsoAfterMinutes(startIso: string, minutes: number): string {
  const date = new Date(startIso)
  if (Number.isNaN(date.getTime())) throw new Error('invalid appointment timestamp')
  const bangkok = new Date(date.getTime() + (minutes + 7 * 60) * 60_000)
  return `${bangkok.toISOString().slice(0, 19)}+07:00`
}

function validateEvidence(intake: BookingIntake): void {
  if (!intake.paymentEvidenceFileIds.length) throw new Error('payment evidence is required')
  if (!intake.chatEvidenceFileIds.length) throw new Error('chat evidence is required')
}

export function submitBookingIntake(intake: BookingIntake, ports: BookingPorts): BookingCase {
  validateEvidence(intake)
  if (!Number.isFinite(intake.depositAmount) || intake.depositAmount <= 0) throw new Error('deposit amount must be positive')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(intake.appointmentDate) || !/^\d{2}:\d{2}$/.test(intake.appointmentTime)) {
    throw new Error('invalid appointment date or time')
  }

  if (ports.repositories.bookings.findByFormResponseId(intake.formResponseId)) {
    throw new Error('form response already processed')
  }

  const admin = ports.config.findAdminByName(intake.adminName)
  if (!admin?.active) throw new Error('selected Admin is not active')
  const doctor = ports.config.findDoctor(intake.doctorId)
  if (!doctor?.active) throw new Error('selected doctor is not active')
  const service = ports.config.findService(intake.serviceId)
  if (!service?.active || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    throw new Error('selected service has no valid duration')
  }

  const phoneNormalized = normalizeThaiPhone(intake.phone)
  const customerNameNormalized = normalizeCustomerName(intake.customerName)
  const appointmentStart = `${intake.appointmentDate}T${intake.appointmentTime}:00+07:00`
  const appointmentEnd = bangkokIsoAfterMinutes(appointmentStart, service.durationMinutes)
  const callWindow = deriveCallWindow(appointmentStart)
  const sequence = ports.repositories.bookings.allocateMonthlySequence(intake.submittedAt.slice(0, 7))
  const caseId = formatCaseId(intake.submittedAt, sequence)
  const identityMatches = admin.email.toLowerCase() === intake.submitterEmail.toLowerCase()

  const booking: BookingCase = {
    caseId,
    version: 1,
    status: identityMatches ? 'FORM_SUBMITTED' : 'ADMIN_MISMATCH',
    formResponseId: intake.formResponseId,
    adminId: admin.id,
    adminName: admin.name,
    submitterEmail: intake.submitterEmail,
    adminIdentityStatus: identityMatches ? 'MATCHED' : 'MISMATCH',
    customerName: intake.customerName.trim(),
    customerNameNormalized,
    phoneNormalized,
    phoneMasked: maskThaiPhone(phoneNormalized),
    doctorId: doctor.id,
    serviceId: service.id,
    appointmentStart,
    appointmentEnd,
    depositAmount: intake.depositAmount,
    depositReceivedAt: intake.submittedAt,
    depositExpiresAt: addCalendarMonths(intake.submittedAt, 6),
    depositStatus: 'VALID',
    driveFolderId: null,
    driveFolderUrl: null,
    paymentEvidenceCount: intake.paymentEvidenceFileIds.length,
    chatEvidenceCount: intake.chatEvidenceFileIds.length,
    calendarId: doctor.calendarId,
    calendarEventId: null,
    doctorLineGroupId: doctor.lineGroupId,
    doctorLineNotifiedAt: null,
    callStatus: 'PENDING',
    firstCallWindowStart: callWindow.start,
    firstCallWindowEnd: callWindow.end,
    nextCallAt: `${intake.appointmentDate}T09:00:00+07:00`,
    lastCallAt: null,
    callOwnerAdminId: admin.id,
    jeraPaymentId: null,
    jeraStatus: null,
    jeraClosedAt: null,
    jeraActualRevenue: null,
    jeraImportFileId: null,
    reconciliationStatus: 'NONE',
    commissionEligibility: 'NOT_ELIGIBLE',
    commissionAmount: null,
    driveState: 'PENDING',
    calendarState: 'PENDING',
    lineState: 'PENDING',
    jeraImportState: 'NOT_IMPORTED',
    createdAt: intake.submittedAt,
    createdBy: intake.submitterEmail,
    updatedAt: intake.submittedAt,
    updatedBy: intake.submitterEmail,
  }

  const inserted = ports.repositories.bookings.insert(booking)
  ports.repositories.bookings.rememberFormResponse(intake.formResponseId, caseId)
  ports.repositories.audit.append({
    eventId: `AUDIT-${intake.formResponseId}-1`,
    caseId,
    actor: intake.submitterEmail,
    action: 'BOOKING_CREATED',
    target: 'BOOKING_MASTER',
    before: null,
    after: { status: booking.status },
    reason: 'Google Form submission',
    timestamp: ports.clock.nowIso(),
    correlationId: intake.formResponseId,
  })
  return inserted
}
