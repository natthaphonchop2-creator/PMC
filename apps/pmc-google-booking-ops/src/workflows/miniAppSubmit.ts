import type { MiniAppBookingIngressPayload } from '../../../../shared/pmcMiniAppBooking'
import type { BookingCase, BookingIntake } from '../domain/types'
import type { BookingPorts } from '../ports'
import { submitBookingIntake } from './formSubmit'

export function submitMiniAppBooking(input: MiniAppBookingIngressPayload, ports: BookingPorts): BookingCase {
  const formResponseId = `mini:${input.requestId}`
  const existing = ports.repositories.bookings.findByFormResponseId(formResponseId)
  if (existing) return verifiedDuplicate(existing, input.payloadHash, ports)

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
    if (raced) return verifiedDuplicate(raced, input.payloadHash, ports)
    throw error
  }

  ports.repositories.audit.append({
    eventId: `AUDIT-MINI-INGRESS-${input.requestId}`,
    caseId: booking.caseId,
    actor: actorEmail,
    action: 'MINI_APP_INGRESS_ACCEPTED',
    target: 'BOOKING_MASTER',
    before: null,
    after: { requestId: input.requestId, payloadHash: input.payloadHash },
    reason: 'Verified LINE Mini App booking ingress',
    timestamp: ports.clock.nowIso(),
    correlationId: input.requestId,
  })
  return booking
}

function verifiedDuplicate(booking: BookingCase, payloadHash: string, ports: BookingPorts): BookingCase {
  const audit = ports.repositories.audit.listForCase(booking.caseId).find((event) => event.action === 'MINI_APP_INGRESS_ACCEPTED')
  if (!audit || !isRecord(audit.after) || audit.after.payloadHash !== payloadHash) {
    if (audit) throw new Error('mini app payload hash conflict')
    throw new Error('mini app duplicate is still being finalized')
  }
  return booking
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
