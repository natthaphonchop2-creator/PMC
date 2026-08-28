import type { MiniAppBookingIngressPayload } from '../../../../shared/pmcMiniAppBooking'
import type { AuditEvent, BookingCase, BookingIntake } from '../domain/types'
import type { BookingPorts } from '../ports'
import { NO_AE_OPTION } from '../config'
import { submitBookingIntake } from './formSubmit'

export function submitMiniAppBooking(input: MiniAppBookingIngressPayload, ports: BookingPorts): BookingCase {
  const identity = miniAppFormIdentity(input, ports)
  const existing = findExistingMiniAppBooking(input, identity, ports)
  if (existing) return finalizeIngressAudit(existing, input, ports)
  const formResponseId = identity.current

  const staff = ports.config.findStaffById(input.staffId)
  if (!staff?.active || !staff.canCloseBooking) throw new Error('mini app staff is not active or eligible')
  const actorEmail = staff.email.trim().toLowerCase() || 'mini-app@internal.invalid'
  const intake: BookingIntake = {
    formResponseId,
    submittedAt: ports.clock.nowIso(),
    submitterEmail: actorEmail,
    closerName: staff.name,
    aeName: input.aeName,
    customerName: input.customerName,
    facebookName: input.facebookName,
    phone: input.phoneNormalized,
    doctorId: input.doctorId,
    serviceId: input.serviceId,
    queueType: input.queueType,
    appointmentDate: input.appointmentDate,
    appointmentTime: input.appointmentTime,
    depositAmount: input.depositAmount,
    channelId: input.channelId,
    paymentEvidenceFileIds: [...input.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...input.chatEvidenceFileIds],
  }

  let booking: BookingCase
  try {
    booking = submitBookingIntake(intake, ports, {
      collisionPrefix: identity.prefix,
      conflictingFormResponseIds: [identity.legacy],
      convergeExact: true,
    })
  } catch (error) {
    const raced = ports.repositories.bookings.findByFormResponseId(formResponseId)
    if (raced) return finalizeIngressAudit(raced, input, ports)
    throw error
  }

  return finalizeIngressAudit(booking, input, ports)
}

function finalizeIngressAudit(
  booking: BookingCase,
  input: MiniAppBookingIngressPayload,
  ports: BookingPorts,
): BookingCase {
  return ports.locks.withLock(() => {
    const persisted = ports.repositories.bookings.getByCaseId(booking.caseId)
    if (!persisted || persisted.caseId !== booking.caseId || !matchesRecoverableInput(persisted, input, ports)) {
      throw new Error('mini app duplicate booking conflict')
    }
    if (!ports.repositories.bookings.hasFormResponseMapping(persisted.formResponseId, persisted.caseId)
      || !validCreationAudit(persisted, ports)) throw new Error('mini app duplicate booking is not durable')
    if (!durableDownstream(persisted, input, ports)) throw new Error('mini app duplicate booking is not durable')

    const eventId = `AUDIT-MINI-INGRESS-${input.requestId}`
    const globalAudits = ports.repositories.audit.listByEventId(eventId)
    if (globalAudits.length > 1 || (globalAudits[0] && !matchesIngressAudit(globalAudits[0], persisted, input))) {
      throw new Error('mini app payload hash conflict')
    }
    const audits = ports.repositories.audit.listForCase(persisted.caseId)
      .filter((event) => event.action === 'MINI_APP_INGRESS_ACCEPTED')
    if (audits.length > 1) throw new Error('mini app payload hash conflict')
    const audit = audits[0]
    if (audit) {
      if (!matchesIngressAudit(audit, persisted, input)) {
        throw new Error('mini app payload hash conflict')
      }
      return persisted
    }

    ports.repositories.audit.append({
      eventId,
      caseId: persisted.caseId,
      actor: persisted.submitterEmail,
      action: 'MINI_APP_INGRESS_ACCEPTED',
      target: 'BOOKING_MASTER',
      before: null,
      after: { requestId: input.requestId, payloadHash: input.payloadHash },
      reason: 'Verified LINE Mini App booking ingress',
      timestamp: ports.clock.nowIso(),
      correlationId: input.requestId,
    })
    return persisted
  })
}

function matchesRecoverableInput(
  booking: BookingCase,
  input: MiniAppBookingIngressPayload,
  ports: BookingPorts,
): boolean {
  const staff = ports.config.findStaffById(input.staffId)
  if (!staff?.active || !staff.canCloseBooking) return false
  const ae = input.aeName === NO_AE_OPTION ? null : ports.config.findEligibleAeByName(input.aeName)
  if (input.aeName !== NO_AE_OPTION && (!ae?.active || !ae.canBeAe)) return false
  const actorEmail = staff.email.trim().toLowerCase() || 'mini-app@internal.invalid'
  const appointmentStart = input.queueType === 'NORMAL' && input.appointmentDate && input.appointmentTime
    ? `${input.appointmentDate}T${input.appointmentTime}:00+07:00`
    : null
  const appointmentMatches = input.queueType === 'AUTO'
    ? input.appointmentDate === null && input.appointmentTime === null
    : appointmentStart !== null && booking.appointmentStart === appointmentStart
  const identity = miniAppFormIdentity(input, ports)
  return (booking.formResponseId === identity.current || booking.formResponseId === identity.legacy)
    && booking.adminId === input.staffId
    && booking.adminName === staff.name
    && booking.submitterEmail === actorEmail
    && booking.aeId === (ae?.id ?? null)
    && booking.aeName === (ae?.name ?? NO_AE_OPTION)
    && booking.customerName === input.customerName.trim()
    && booking.facebookName === input.facebookName.trim()
    && booking.phoneNormalized === input.phoneNormalized
    && booking.doctorId === input.doctorId
    && booking.serviceId === input.serviceId
    && booking.channelId === input.channelId
    && booking.queueType === input.queueType
    && appointmentMatches
    && booking.depositAmount === input.depositAmount
    && booking.paymentEvidenceCount === input.paymentEvidenceFileIds.length
    && booking.chatEvidenceCount === input.chatEvidenceFileIds.length
}

function miniAppFormIdentity(input: MiniAppBookingIngressPayload, ports: BookingPorts) {
  const encodedRequestId = ports.crypto.base64UrlUtf8(input.requestId)
  return {
    current: `mini:v2:${encodedRequestId}:${input.payloadHash}`,
    prefix: `mini:v2:${encodedRequestId}:`,
    legacy: `mini:${input.requestId}`,
  }
}

function findExistingMiniAppBooking(
  input: MiniAppBookingIngressPayload,
  identity: ReturnType<typeof miniAppFormIdentity>,
  ports: BookingPorts,
): BookingCase | null {
  const candidates = ports.repositories.bookings.list().filter((booking) =>
    booking.formResponseId === identity.legacy || booking.formResponseId.startsWith(identity.prefix),
  )
  if (candidates.length > 1) throw new Error('mini app payload hash conflict')
  const existing = candidates[0]
  if (!existing) return null
  if (existing.formResponseId.startsWith(identity.prefix) && existing.formResponseId !== identity.current) {
    throw new Error('mini app payload hash conflict')
  }
  return existing
}

function validCreationAudit(booking: BookingCase, ports: BookingPorts): boolean {
  const audits = ports.repositories.audit.listByEventId(`AUDIT-${booking.formResponseId}-1`)
  const audit = audits[0]
  return Boolean(audits.length === 1 && audit
    && audit.caseId === booking.caseId
    && audit.actor === booking.submitterEmail
    && audit.action === 'BOOKING_CREATED'
    && audit.target === 'BOOKING_MASTER'
    && audit.before === null
    && audit.reason === 'Google Form submission'
    && Number.isFinite(Date.parse(audit.timestamp))
    && audit.correlationId === booking.formResponseId)
    && isRecord(audit?.after)
    && Object.keys(audit.after).length === 3
    && audit.after.status === 'FORM_SUBMITTED'
    && audit.after.adminId === booking.adminId
    && audit.after.aeId === booking.aeId
}

function durableDownstream(
  booking: BookingCase,
  input: MiniAppBookingIngressPayload,
  ports: BookingPorts,
): boolean {
  const pending = ports.repositories.retries.listPending()
  const exactRetry = (id: string, operation: string, idempotencyKey: string, evidenceBound = false) => pending.some((retry) => {
    if (retry.id !== id || retry.caseId !== booking.caseId || retry.operation !== operation
      || retry.idempotencyKey !== idempotencyKey || retry.status !== 'PENDING') return false
    if (!evidenceBound) return true
    const payload = retryPayload(retry.payload)
    return sameStrings(payload.paymentEvidenceFileIds, input.paymentEvidenceFileIds)
      && sameStrings(payload.chatEvidenceFileIds, input.chatEvidenceFileIds)
  })
  const driveDurable = booking.driveState === 'OK' && Boolean(booking.driveFolderId && booking.driveFolderUrl)
    || booking.driveState === 'RETRY' && exactRetry(
      `RETRY-${booking.caseId}-DRIVE`, 'DRIVE_EVIDENCE', `${booking.caseId}:DRIVE_EVIDENCE`, true,
    )
  if (!driveDurable) return false

  let calendarDurable: boolean
  if (booking.queueType === 'NORMAL') {
    calendarDurable = booking.calendarState === 'OK' && Boolean(booking.calendarEventId)
      || booking.calendarState === 'RETRY' && exactRetry(
        `RETRY-${booking.caseId}-CALENDAR`, 'CALENDAR_EVENT', `${booking.caseId}:CALENDAR_EVENT`, true,
      )
  } else if (booking.appointmentStatus === 'AWAITING_ADMIN_SLOT') {
    calendarDurable = booking.calendarState === 'OK'
  } else {
    calendarDurable = booking.calendarState === 'OK' && Boolean(booking.calendarEventId)
      || booking.calendarState === 'RETRY' && exactRetry(
        `RETRY-${booking.caseId}-TENTATIVE-CALENDAR`,
        'TENTATIVE_CALENDAR_EVENT',
        `${booking.caseId}:TENTATIVE_CALENDAR_EVENT`,
      )
  }
  if (!calendarDurable) return false

  const lineDurable = booking.lineState === 'OK'
    || booking.lineState === 'RETRY' && pending.some((retry) => exactLineRetry(retry, booking, input))
  return lineDurable
    && booking.paymentEvidenceCount === input.paymentEvidenceFileIds.length
    && booking.chatEvidenceCount === input.chatEvidenceFileIds.length
}

function exactLineRetry(
  retry: Record<string, unknown>,
  booking: BookingCase,
  input: MiniAppBookingIngressPayload,
): boolean {
  if (retry.caseId !== booking.caseId || retry.status !== 'PENDING') return false
  const payload = retryPayload(retry.payload)
  const messageVersion = booking.version - 1
  if (!Number.isSafeInteger(messageVersion) || messageVersion < 1 || payload.messageVersion !== messageVersion) return false

  if (retry.operation === 'ADMIN_BOOKING_LINE_BATCH') {
    if (!normalLineProducerState(booking)
      || !hasExactKeys(payload, ['paymentEvidenceFileIds', 'chatEvidenceFileIds', 'messageVersion', 'batchIndex'])
      || !validBatchIndex(payload.batchIndex)
      || retry.id !== `RETRY-${booking.caseId}-ADMIN-LINE-BATCH-${Number(payload.batchIndex) + 1}`
      || retry.idempotencyKey !== `${booking.caseId}:ADMIN_BOOKING_LINE_BATCH:${messageVersion}:${Number(payload.batchIndex) + 1}`) return false
    return exactEvidencePayload(payload, input)
  }
  if (retry.operation === 'DOCTOR_LINE') {
    return normalLineProducerState(booking)
      && hasExactKeys(payload, ['messageVersion'])
      && retry.id === `RETRY-${booking.caseId}-DOCTOR-LINE`
      && retry.idempotencyKey === `${booking.caseId}:DOCTOR_LINE:${messageVersion}`
  }
  if (retry.operation === 'ADMIN_EVIDENCE_LINE') {
    return evidenceLineProducerState(booking)
      && hasExactKeys(payload, ['paymentEvidenceFileIds', 'chatEvidenceFileIds', 'messageVersion'])
      && retry.id === `RETRY-${booking.caseId}-ADMIN-EVIDENCE`
      && retry.idempotencyKey === `${booking.caseId}:ADMIN_EVIDENCE_READY:${messageVersion}`
      && exactEvidencePayload(payload, input)
  }
  if (retry.operation === 'ADMIN_AUTOMATIC_LINE_BATCH') {
    if (!automaticLineProducerState(booking)
      || payload.appointmentStatus !== booking.appointmentStatus
      || !hasExactKeys(payload, [
        'paymentEvidenceFileIds', 'chatEvidenceFileIds', 'messageVersion', 'batchIndex', 'appointmentStatus',
      ])
      || !validBatchIndex(payload.batchIndex)
      || retry.id !== `RETRY-${booking.caseId}-ADMIN-AUTO-BATCH-${Number(payload.batchIndex) + 1}`
      || retry.idempotencyKey !== `${booking.caseId}:ADMIN_AUTOMATIC_LINE_BATCH:${messageVersion}:${Number(payload.batchIndex) + 1}`) return false
    return exactEvidencePayload(payload, input)
  }
  return false
}

function normalLineProducerState(booking: BookingCase): boolean {
  return booking.queueType === 'NORMAL'
    && booking.status === 'BOOKING_CONFIRMED'
    && booking.appointmentStatus === 'CONFIRMED'
    && Boolean(booking.appointmentStart && booking.appointmentEnd)
}

function automaticLineProducerState(booking: BookingCase): boolean {
  if (booking.queueType !== 'AUTO' || booking.status !== 'BOOKING_CONFIRMED') return false
  if (booking.appointmentStatus === 'TENTATIVE') {
    return Boolean(booking.appointmentStart && booking.appointmentEnd)
  }
  return booking.appointmentStatus === 'AWAITING_ADMIN_SLOT'
    && booking.appointmentStart === null
    && booking.appointmentEnd === null
}

function evidenceLineProducerState(booking: BookingCase): boolean {
  return normalLineProducerState(booking) || automaticLineProducerState(booking)
}

function exactEvidencePayload(payload: Record<string, unknown>, input: MiniAppBookingIngressPayload): boolean {
  return sameStrings(payload.paymentEvidenceFileIds, input.paymentEvidenceFileIds)
    && sameStrings(payload.chatEvidenceFileIds, input.chatEvidenceFileIds)
}

function validBatchIndex(value: unknown): boolean {
  // Both current booking and automatic-queue producers emit one summary batch.
  return value === 0
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function retryPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
  }
  return isRecord(value) ? value : {}
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((item, index) => item === expected[index])
}

function matchesIngressAudit(
  audit: AuditEvent,
  booking: BookingCase,
  input: MiniAppBookingIngressPayload,
): boolean {
  return audit.eventId === `AUDIT-MINI-INGRESS-${input.requestId}`
    && audit.caseId === booking.caseId
    && audit.actor === booking.submitterEmail
    && audit.action === 'MINI_APP_INGRESS_ACCEPTED'
    && audit.target === 'BOOKING_MASTER'
    && audit.before === null
    && audit.reason === 'Verified LINE Mini App booking ingress'
    && audit.correlationId === input.requestId
    && isRecord(audit.after)
    && Object.keys(audit.after).length === 2
    && audit.after.requestId === input.requestId
    && audit.after.payloadHash === input.payloadHash
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
