import { addCalendarMonths, addMinutesInBangkok, deriveCallWindow } from '../domain/callSchedule'
import { formatCaseId } from '../domain/caseId'
import { maskThaiPhone, normalizeCustomerName, normalizeThaiPhone } from '../domain/normalize'
import type { BookingCase, BookingIntake } from '../domain/types'
import type { BookingPorts } from '../ports'
import { ensureCaseEvidenceFolder } from '../adapters/googleDrive'
import { ensureDoctorCalendarEvent } from '../adapters/googleCalendar'
import { sendDoctorBookingMessage } from '../adapters/lineMessaging'
import { createInitialCallTask } from './callQueue'

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
  if (intake.channelId) {
    const channel = ports.config.findChannel(intake.channelId)
    if (!channel?.active) throw new Error('selected channel is not active')
  }

  const phoneNormalized = normalizeThaiPhone(intake.phone)
  const customerNameNormalized = normalizeCustomerName(intake.customerName)
  const appointmentStart = `${intake.appointmentDate}T${intake.appointmentTime}:00+07:00`
  const appointmentEnd = addMinutesInBangkok(appointmentStart, service.durationMinutes)
  const callWindow = deriveCallWindow(appointmentStart)
  const sequence = ports.repositories.bookings.allocateMonthlySequence(intake.submittedAt.slice(0, 7))
  const caseId = formatCaseId(intake.submittedAt, sequence)

  const booking: BookingCase = {
    caseId,
    version: 1,
    status: 'FORM_SUBMITTED',
    formResponseId: intake.formResponseId,
    adminId: admin.id,
    adminName: admin.name,
    submitterEmail: intake.submitterEmail,
    adminIdentityStatus: 'SHARED_ACCOUNT',
    customerName: intake.customerName.trim(),
    customerNameNormalized,
    phoneNormalized,
    phoneMasked: maskThaiPhone(phoneNormalized),
    doctorId: doctor.id,
    serviceId: service.id,
    channelId: intake.channelId,
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
  let current: BookingCase
  try {
    const evidence = ensureCaseEvidenceFolder(inserted, intake, ports.drive)
    current = ports.repositories.bookings.update(
      caseId,
      inserted.version,
      {
        driveFolderId: evidence.folderId,
        driveFolderUrl: evidence.folderUrl,
        paymentEvidenceCount: intake.paymentEvidenceFileIds.length,
        chatEvidenceCount: intake.chatEvidenceFileIds.length,
        driveState: 'OK',
      },
      { actor: intake.submitterEmail, reason: 'Drive evidence stored', correlationId: intake.formResponseId },
    )
  } catch (error) {
    const safeError = error instanceof Error ? error.message : 'Drive operation failed'
    ports.repositories.retries.enqueue({
      id: `RETRY-${caseId}-DRIVE`,
      caseId,
      operation: 'DRIVE_EVIDENCE',
      idempotencyKey: `${caseId}:DRIVE_EVIDENCE`,
      attempts: 0,
      status: 'PENDING',
      safeError,
      payload: {
        paymentEvidenceFileIds: intake.paymentEvidenceFileIds,
        chatEvidenceFileIds: intake.chatEvidenceFileIds,
      },
    })
    return ports.repositories.bookings.update(
      caseId,
      inserted.version,
      { driveState: 'RETRY' },
      { actor: 'system', reason: safeError, correlationId: intake.formResponseId },
    )
  }

  if (ports.calendar.hasConflict(current.calendarId ?? '', current.appointmentStart, current.appointmentEnd)) {
    return ports.repositories.bookings.update(
      caseId,
      current.version,
      { status: 'TIME_CONFLICT', calendarState: 'CONFLICT' },
      { actor: 'system', reason: 'Doctor Calendar overlap', correlationId: intake.formResponseId },
    )
  }

  try {
    const calendarEventId = ensureDoctorCalendarEvent(current, ports.calendar)
    current = ports.repositories.bookings.update(
      caseId,
      current.version,
      { calendarEventId, calendarState: 'OK', status: 'BOOKING_CONFIRMED' },
      { actor: 'system', reason: 'Doctor Calendar event created', correlationId: intake.formResponseId },
    )
  } catch (error) {
    const safeError = error instanceof Error ? error.message : 'Calendar operation failed'
    ports.repositories.retries.enqueue({
      id: `RETRY-${caseId}-CALENDAR`,
      caseId,
      operation: 'CALENDAR_EVENT',
      idempotencyKey: `${caseId}:CALENDAR_EVENT`,
      attempts: 0,
      status: 'PENDING',
      safeError,
    })
    return ports.repositories.bookings.update(
      caseId,
      current.version,
      { calendarState: 'RETRY' },
      { actor: 'system', reason: safeError, correlationId: intake.formResponseId },
    )
  }

  try {
    createInitialCallTask(current, ports)
    sendDoctorBookingMessage(current, ports.line)
    return ports.repositories.bookings.update(
      caseId,
      current.version,
      { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
      { actor: 'system', reason: 'Doctor LINE notification sent', correlationId: intake.formResponseId },
    )
  } catch (error) {
    const safeError = error instanceof Error ? error.message : 'LINE notification failed'
    ports.repositories.retries.enqueue({
      id: `RETRY-${caseId}-LINE`,
      caseId,
      operation: 'DOCTOR_LINE',
      idempotencyKey: `${caseId}:BOOKING_CONFIRMED`,
      attempts: 0,
      status: 'PENDING',
      safeError,
    })
    return ports.repositories.bookings.update(
      caseId,
      current.version,
      { lineState: 'RETRY' },
      { actor: 'system', reason: safeError, correlationId: intake.formResponseId },
    )
  }
}
