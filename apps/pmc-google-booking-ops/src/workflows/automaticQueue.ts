import { calendarEventInput } from '../adapters/googleCalendar'
import {
  adminAwaitingSlotMessageBatches,
  adminTentativeMessageBatches,
  bookingTeamProfiles,
} from '../adapters/lineMessaging'
import {
  proposeAutomaticAppointment,
  type CalendarInterval,
} from '../domain/automaticQueue'
import type { BookingCase, BookingIntake } from '../domain/types'
import type { BookingEvidenceImages, BookingPorts, ServiceConfig } from '../ports'

function requireCalendarId(booking: BookingCase): string {
  if (!booking.calendarId) throw new Error('doctor calendar is not configured')
  return booking.calendarId
}

function requireServiceConfig(
  booking: BookingCase,
  ports: BookingPorts,
): ServiceConfig {
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    throw new Error(`service is not active: ${booking.serviceId}`)
  }
  return service
}

function bookingInterval(booking: BookingCase): CalendarInterval {
  if (!booking.appointmentStart || !booking.appointmentEnd) {
    throw new Error(`confirmed booking has no appointment: ${booking.caseId}`)
  }
  return { start: booking.appointmentStart, end: booking.appointmentEnd }
}

function evidenceFor(
  booking: BookingCase,
  intake: BookingIntake,
  ports: BookingPorts,
): { evidence: BookingEvidenceImages; safeError: string | null } {
  try {
    return {
      evidence: ports.media.images(
        booking.caseId,
        intake.paymentEvidenceFileIds,
        intake.chatEvidenceFileIds,
      ),
      safeError: null,
    }
  } catch (error) {
    return {
      evidence: {
        payments: [],
        chats: [],
        totalPaymentCount: intake.paymentEvidenceFileIds.length,
        totalChatCount: intake.chatEvidenceFileIds.length,
      },
      safeError: error instanceof Error ? error.message : 'Evidence media signing failed',
    }
  }
}

function enqueueAutomaticAdminRetry(
  booking: BookingCase,
  intake: BookingIntake,
  batchIndex: number,
  safeError: string,
  ports: BookingPorts,
): void {
  ports.repositories.retries.enqueue({
    id: `RETRY-${booking.caseId}-ADMIN-AUTO-BATCH-${batchIndex + 1}`,
    caseId: booking.caseId,
    operation: 'ADMIN_AUTOMATIC_LINE_BATCH',
    idempotencyKey: `${booking.caseId}:ADMIN_AUTOMATIC_LINE_BATCH:${booking.version}:${batchIndex + 1}`,
    attempts: 0,
    status: 'PENDING',
    safeError,
    payload: {
      paymentEvidenceFileIds: intake.paymentEvidenceFileIds,
      chatEvidenceFileIds: intake.chatEvidenceFileIds,
      messageVersion: booking.version,
      batchIndex,
      appointmentStatus: booking.appointmentStatus,
    },
  })
}

export function prepareAutomaticQueue(
  booking: BookingCase,
  intake: BookingIntake,
  ports: BookingPorts,
): BookingCase {
  const doctorCases = ports.repositories.bookings.list().filter((candidate) =>
    candidate.caseId !== booking.caseId &&
    candidate.doctorId === booking.doctorId &&
    candidate.appointmentStatus === 'CONFIRMED' &&
    Boolean(candidate.appointmentStart && candidate.appointmentEnd) &&
    String(candidate.appointmentStart) >= booking.createdAt &&
    String(candidate.appointmentStart) <= booking.depositExpiresAt,
  )
  const busy = ports.calendar.listEvents(
    requireCalendarId(booking),
    booking.createdAt,
    booking.depositExpiresAt,
  )
  const proposal = proposeAutomaticAppointment({
    durationMinutes: requireServiceConfig(booking, ports).durationMinutes,
    submittedAt: booking.createdAt,
    expiresAt: booking.depositExpiresAt,
    doctorCases: doctorCases.map(bookingInterval),
    busy,
  })

  let current = ports.repositories.bookings.update(
    booking.caseId,
    booking.version,
    proposal
      ? {
          status: 'BOOKING_CONFIRMED',
          appointmentStatus: 'TENTATIVE',
          appointmentStart: proposal.start,
          appointmentEnd: proposal.end,
          appointmentProposedAt: ports.clock.nowIso(),
          appointmentConfirmedAt: null,
          appointmentConfirmedBy: null,
          calendarState: 'PENDING',
          firstCallWindowStart: null,
          firstCallWindowEnd: null,
          nextCallAt: null,
        }
      : {
          status: 'BOOKING_CONFIRMED',
          appointmentStatus: 'AWAITING_ADMIN_SLOT',
          appointmentStart: null,
          appointmentEnd: null,
          appointmentProposedAt: null,
          appointmentConfirmedAt: null,
          appointmentConfirmedBy: null,
          calendarState: 'OK',
          firstCallWindowStart: null,
          firstCallWindowEnd: null,
          nextCallAt: null,
        },
    {
      actor: 'system',
      reason: proposal ? 'Automatic provisional slot proposed' : 'Automatic slot not found',
      correlationId: `${booking.caseId}:AUTO_SLOT`,
    },
  )

  if (proposal) {
    try {
      const calendarEventId = ports.calendar.createEvent(calendarEventInput(current))
      current = ports.repositories.bookings.update(
        current.caseId,
        current.version,
        { calendarEventId, calendarState: 'OK' },
        {
          actor: 'system',
          reason: 'Tentative Calendar event created',
          correlationId: `${booking.caseId}:TENTATIVE_CALENDAR`,
        },
      )
    } catch (error) {
      const safeError = error instanceof Error ? error.message : 'Tentative Calendar failed'
      ports.repositories.retries.enqueue({
        id: `RETRY-${booking.caseId}-TENTATIVE-CALENDAR`,
        caseId: booking.caseId,
        operation: 'TENTATIVE_CALENDAR_EVENT',
        idempotencyKey: `${booking.caseId}:TENTATIVE_CALENDAR_EVENT`,
        attempts: 0,
        status: 'PENDING',
        safeError,
        payload: {},
      })
      current = ports.repositories.bookings.update(
        current.caseId,
        current.version,
        { calendarState: 'RETRY' },
        { actor: 'system', reason: safeError, correlationId: `${booking.caseId}:TENTATIVE_CALENDAR` },
      )
    }
  }

  const { evidence, safeError: mediaSafeError } = evidenceFor(current, intake, ports)
  const profiles = bookingTeamProfiles(current, ports.config)
  const changeUrl = ports.forms.queueConfirmationUrl({
    caseId: current.caseId,
    action: 'CHANGE',
    ...(proposal
      ? {
          appointmentDate: proposal.start.slice(0, 10),
          appointmentTime: proposal.start.slice(11, 16),
        }
      : {}),
  })
  const messages = proposal
    ? adminTentativeMessageBatches(
        current,
        ports.config.adminLineGroupId(),
        evidence,
        ports.forms.queueConfirmationUrl({
          caseId: current.caseId,
          action: 'CONFIRM',
          appointmentDate: proposal.start.slice(0, 10),
          appointmentTime: proposal.start.slice(11, 16),
        }),
        changeUrl,
        ports.config.brandLogoUrl(),
        current.version,
        profiles,
      )
    : adminAwaitingSlotMessageBatches(
        current,
        ports.config.adminLineGroupId(),
        evidence,
        changeUrl,
        ports.config.brandLogoUrl(),
        current.version,
        profiles,
      )

  let lineFailed = false
  let lastSafeError = mediaSafeError
  for (const [batchIndex, message] of messages.entries()) {
    try {
      ports.line.push(message)
    } catch (error) {
      lineFailed = true
      const safeError = error instanceof Error ? error.message : 'Automatic Admin LINE failed'
      lastSafeError = safeError
      enqueueAutomaticAdminRetry(current, intake, batchIndex, safeError, ports)
    }
  }
  if (mediaSafeError) {
    ports.repositories.retries.enqueue({
      id: `RETRY-${current.caseId}-ADMIN-EVIDENCE`,
      caseId: current.caseId,
      operation: 'ADMIN_EVIDENCE_LINE',
      idempotencyKey: `${current.caseId}:ADMIN_EVIDENCE_READY:${current.version}`,
      attempts: 0,
      status: 'PENDING',
      safeError: mediaSafeError,
      payload: {
        paymentEvidenceFileIds: intake.paymentEvidenceFileIds,
        chatEvidenceFileIds: intake.chatEvidenceFileIds,
        messageVersion: current.version,
      },
    })
  }
  return ports.repositories.bookings.update(
    current.caseId,
    current.version,
    { lineState: lineFailed || mediaSafeError ? 'RETRY' : 'OK' },
    {
      actor: 'system',
      reason: lastSafeError ?? 'Automatic queue sent to Admin',
      correlationId: `${current.caseId}:AUTO_ADMIN_LINE`,
    },
  )
}
