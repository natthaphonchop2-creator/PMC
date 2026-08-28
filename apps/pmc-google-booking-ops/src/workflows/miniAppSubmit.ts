import type { MiniAppBookingIngressPayload } from '../../../../shared/pmcMiniAppBooking'
import type { AuditEvent, BookingCase, BookingIntake } from '../domain/types'
import type { BookingPorts } from '../ports'
import { NO_AE_OPTION } from '../config'
import { submitBookingIntake } from './formSubmit'

export function submitMiniAppBooking(input: MiniAppBookingIngressPayload, ports: BookingPorts): BookingCase {
  const formResponseId = `mini:${input.requestId}`
  const existing = ports.repositories.bookings.findByFormResponseId(formResponseId)
  if (existing) return finalizeIngressAudit(existing, input, ports)

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
    booking = submitBookingIntake(intake, ports)
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
  const formResponseId = `mini:${input.requestId}`
  return ports.locks.withLock(() => {
    const persisted = ports.repositories.bookings.findByFormResponseId(formResponseId)
    if (!persisted || persisted.caseId !== booking.caseId || !matchesRecoverableInput(persisted, input, ports)) {
      throw new Error('mini app duplicate booking conflict')
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
      eventId: `AUDIT-MINI-INGRESS-${input.requestId}`,
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
  return booking.formResponseId === `mini:${input.requestId}`
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
