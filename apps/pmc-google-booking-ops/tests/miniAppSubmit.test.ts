import { describe, expect, it } from 'vitest'
import type { MiniAppBookingIngressPayload } from '../../../shared/pmcMiniAppBooking'
import type { BookingCase } from '../src/domain/types'
import { submitMiniAppBooking } from '../src/workflows/miniAppSubmit'
import { createTestPorts } from './helpers/fakes'

describe('Mini App canonical booking submission', () => {
  it('creates one canonical booking and returns it on a duplicate request', () => {
    const ports = createTestPorts()
    const first = submitMiniAppBooking(validMiniAppInput(), ports)
    const second = submitMiniAppBooking(validMiniAppInput(), ports)

    expect(second.caseId).toBe(first.caseId)
    expect(ports.bookings.list()).toHaveLength(1)
    expect(first.formResponseId).toBe('mini:v2:cmVxdWVzdC0x:payload-hash-1')
  })

  it('rejects a reused request ID with a conflicting payload hash', () => {
    const ports = createTestPorts()
    submitMiniAppBooking(validMiniAppInput({ payloadHash: 'payload-hash-1' }), ports)

    expect(() => submitMiniAppBooking(validMiniAppInput({ payloadHash: 'payload-hash-2' }), ports)).toThrow('mini app payload hash conflict')
    expect(ports.bookings.list()).toHaveLength(1)
  })

  it('converges two same-hash calls interleaved after lookup to one reserved Case', () => {
    const ports = createTestPorts()
    const reserve = ports.repositories.bookings.reserveInitialBooking.bind(ports.repositories.bookings)
    let interleave = true
    let nestedCaseId: string | null = null
    ports.repositories.bookings.reserveInitialBooking = (input) => {
      if (interleave) {
        interleave = false
        nestedCaseId = submitMiniAppBooking(validMiniAppInput(), ports).caseId
      }
      return reserve(input)
    }

    const outer = submitMiniAppBooking(validMiniAppInput(), ports)

    expect(outer.caseId).toBe(nestedCaseId)
    expect(ports.bookings.list()).toHaveLength(1)
    expect(ports.repositories.audit.listForCase(outer.caseId)
      .filter(({ action }) => action === 'BOOKING_CREATED')).toHaveLength(1)
  })

  it('fails a different-hash call interleaved after lookup before a second Case can be reserved', () => {
    const ports = createTestPorts()
    const reserve = ports.repositories.bookings.reserveInitialBooking.bind(ports.repositories.bookings)
    let interleave = true
    ports.repositories.bookings.reserveInitialBooking = (input) => {
      if (interleave) {
        interleave = false
        submitMiniAppBooking(validMiniAppInput({ payloadHash: 'payload-hash-2' }), ports)
      }
      return reserve(input)
    }

    expect(() => submitMiniAppBooking(validMiniAppInput({ payloadHash: 'payload-hash-1' }), ports))
      .toThrow('form response collision')
    expect(ports.bookings.list()).toHaveLength(1)
    expect(ports.bookings.list()[0]?.formResponseId).toContain('payload-hash-2')
  })

  it('derives Admin identity from active Staff and supports an automatic queue', () => {
    const ports = createTestPorts()
    const result = submitMiniAppBooking(validMiniAppInput({
      queueType: 'AUTO', appointmentDate: null, appointmentTime: null, aeName: 'ไม่ระบุ',
    }), ports)

    expect(result).toMatchObject({
      adminId: 'admin-1', adminName: 'Admin A', submitterEmail: 'admin@example.com',
      aeId: null, aeName: 'ไม่ระบุ', queueType: 'AUTO', appointmentStatus: 'AWAITING_ADMIN_SLOT',
    })
  })

  it('passes every ordered evidence file into the existing Drive workflow', () => {
    const ports = createTestPorts({ extraDriveFileIds: ['payment-file-2'] })
    const result = submitMiniAppBooking(validMiniAppInput({
      paymentEvidenceFileIds: ['payment-file-1', 'payment-file-2'],
      chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'],
    }), ports)

    expect(result).toMatchObject({ paymentEvidenceCount: 2, chatEvidenceCount: 2, driveState: 'OK' })
    expect(ports.drive.movedFileCount()).toBe(4)
  })

  it('still rejects an inactive or unknown configured choice in the canonical workflow', () => {
    expect(() => submitMiniAppBooking(validMiniAppInput({ doctorId: 'doctor-unknown' }), createTestPorts())).toThrow('selected doctor is not active')
  })

  it('self-heals the missing ingress audit after booking persistence and returns the same Case ID', () => {
    const ports = createTestPorts()
    failMiniIngressAuditOnce(ports)

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')
    const persisted = ports.bookings.list()[0]!
    expect(ports.repositories.audit.listForCase(persisted.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')).toHaveLength(0)

    const recovered = submitMiniAppBooking(validMiniAppInput(), ports)

    expect(recovered.caseId).toBe(persisted.caseId)
    expect(ports.bookings.list()).toHaveLength(1)
    expect(ports.repositories.audit.listForCase(persisted.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')).toHaveLength(1)
  })

  it.each([
    ['staff', { staffId: 'admin-other' }],
    ['AE', { aeName: 'เอม' }],
    ['customer', { customerName: 'ลูกค้าอื่น' }],
    ['Facebook', { facebookName: 'Other Page' }],
    ['phone', { phoneNormalized: '0899999999' }],
    ['doctor', { doctorId: 'doctor-2' }],
    ['service', { serviceId: 'service-2' }],
    ['channel', { channelId: 'เพจสำรอง' }],
    ['queue/date/time', { queueType: 'AUTO' as const, appointmentDate: null, appointmentTime: null }],
    ['deposit', { depositAmount: 1001 }],
    ['payment count', { paymentEvidenceFileIds: ['payment-file-1', 'payment-file-2'] }],
    ['chat count', { chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'] }],
  ])('rejects missing-audit self-heal when signed %s fields do not match the persisted booking', (_label, patch) => {
    const ports = createTestPorts({ extraDriveFileIds: ['payment-file-2'] })
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')

    expect(() => submitMiniAppBooking(validMiniAppInput(patch), ports)).toThrow('mini app duplicate booking conflict')
    const booking = ports.bookings.list()[0]!
    expect(ports.repositories.audit.listForCase(booking.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')).toHaveLength(0)
  })

  it('rejects a matching audit when the mapped booking fields or formResponseId were changed', () => {
    const ports = createTestPorts()
    const booking = submitMiniAppBooking(validMiniAppInput(), ports)
    ports.repositories.bookings.update(
      booking.caseId,
      booking.version,
      { formResponseId: 'mini:other-request', customerName: 'ลูกค้าอื่น' },
      { actor: 'test', reason: 'inject mismatch', correlationId: 'test-mismatch' },
    )

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app duplicate booking conflict')
  })

  it('rejects an ingress audit whose deterministic audit fields were changed despite a matching hash', () => {
    const ports = createTestPorts()
    const append = ports.repositories.audit.append.bind(ports.repositories.audit)
    ports.repositories.audit.append = (event) => append(event.action === 'MINI_APP_INGRESS_ACCEPTED'
      ? { ...event, target: 'OTHER_TAB' }
      : event)
    submitMiniAppBooking(validMiniAppInput(), ports)

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app payload hash conflict')
  })

  it.each([
    ['actor', { actor: 'other@example.com' }],
    ['after payload', { after: { status: 'FORM_SUBMITTED', adminId: 'other-admin', aeId: 'admin-1' } }],
    ['reason', { reason: 'Other creation reason' }],
  ])('rejects self-heal when the deterministic BOOKING_CREATED %s is corrupted', (_label, patch) => {
    const ports = createTestPorts()
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')
    const listByEventId = ports.repositories.audit.listByEventId.bind(ports.repositories.audit)
    ports.repositories.audit.listByEventId = (eventId) => listByEventId(eventId)
      .map((event) => event.action === 'BOOKING_CREATED' ? { ...event, ...patch } : event)

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports))
      .toThrow('mini app duplicate booking is not durable')
  })

  it('serializes repeated self-heal attempts into one deterministic ingress audit', () => {
    const ports = createTestPorts()
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')

    const first = submitMiniAppBooking(validMiniAppInput(), ports)
    const second = submitMiniAppBooking(validMiniAppInput(), ports)
    const ingressAudits = ports.repositories.audit.listForCase(first.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')

    expect(second.caseId).toBe(first.caseId)
    expect(ingressAudits).toHaveLength(1)
    expect(ingressAudits[0]).toMatchObject({
      eventId: 'AUDIT-MINI-INGRESS-request-1',
      after: { requestId: 'request-1', payloadHash: 'payload-hash-1' },
    })
  })

  it('preserves compatibility for an exact durable legacy mini request record', () => {
    const ports = createTestPorts()
    const legacy = ports.repositories.bookings.insert(ports.bookingFixture({
      formResponseId: 'mini:request-1', adminIdentityStatus: 'SELECTED_ADMIN', aeId: 'admin-1', aeName: 'Admin A',
      channelId: 'เพจหลัก', appointmentStart: '2026-08-20T13:00:00+07:00', depositAmount: 1000,
      driveFolderId: 'drive-folder-1', driveFolderUrl: 'https://drive.test/folder-1', calendarEventId: 'calendar-event-1',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK', paymentEvidenceCount: 1, chatEvidenceCount: 1,
    }))
    ports.repositories.bookings.rememberFormResponse(legacy.formResponseId, legacy.caseId)
    appendCreationAudit(ports, legacy.caseId, legacy.formResponseId)
    ports.repositories.audit.append(ingressAudit(legacy.caseId))

    const recovered = submitMiniAppBooking(validMiniAppInput(), ports)

    expect(recovered.caseId).toBe(legacy.caseId)
    expect(ports.bookings.list()).toHaveLength(1)
  })

  it('does not seal a partial inserted booking as accepted when downstream durability is missing', () => {
    const ports = createTestPorts()
    const formResponseId = 'mini:v2:cmVxdWVzdC0x:payload-hash-1'
    const partial = ports.repositories.bookings.insert(ports.bookingFixture({
      formResponseId, adminIdentityStatus: 'SELECTED_ADMIN', aeId: 'admin-1', aeName: 'Admin A',
      channelId: 'เพจหลัก', appointmentStart: '2026-08-20T13:00:00+07:00', depositAmount: 1000,
      driveState: 'PENDING', calendarState: 'PENDING', lineState: 'PENDING',
      paymentEvidenceCount: 1, chatEvidenceCount: 1,
    }))
    ports.repositories.bookings.rememberFormResponse(formResponseId, partial.caseId)
    appendCreationAudit(ports, partial.caseId, formResponseId)

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app duplicate booking is not durable')
    expect(ports.repositories.audit.listForCase(partial.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')).toHaveLength(0)
  })

  it('rejects a projection retry whose deterministic identity matches but evidence payload is corrupted', () => {
    const ports = createTestPorts()
    const formResponseId = 'mini:v2:cmVxdWVzdC0x:payload-hash-1'
    const booking = ports.repositories.bookings.insert(ports.bookingFixture({
      formResponseId, adminIdentityStatus: 'SELECTED_ADMIN', aeId: 'admin-1', aeName: 'Admin A',
      channelId: 'เพจหลัก', appointmentStart: '2026-08-20T13:00:00+07:00', depositAmount: 1000,
      driveState: 'RETRY', calendarState: 'OK', calendarEventId: 'calendar-event-1', lineState: 'OK',
      paymentEvidenceCount: 1, chatEvidenceCount: 1,
    }))
    ports.repositories.bookings.rememberFormResponse(formResponseId, booking.caseId)
    appendCreationAudit(ports, booking.caseId, formResponseId)
    ports.repositories.retries.enqueue({
      id: `RETRY-${booking.caseId}-DRIVE`, caseId: booking.caseId, operation: 'DRIVE_EVIDENCE',
      idempotencyKey: `${booking.caseId}:DRIVE_EVIDENCE`, attempts: 0, status: 'PENDING', safeError: 'retry',
      payload: { paymentEvidenceFileIds: ['wrong-payment'], chatEvidenceFileIds: ['chat-file-1'] },
    })

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app duplicate booking is not durable')
  })

  it.each([
    ['Admin booking batch', 'ADMIN_BOOKING_LINE_BATCH'],
    ['Doctor booking', 'DOCTOR_LINE'],
    ['Admin evidence', 'ADMIN_EVIDENCE_LINE'],
    ['automatic Admin batch', 'ADMIN_AUTOMATIC_LINE_BATCH'],
  ] as const)('accepts an exact durable %s retry identity', (_label, operation) => {
    const input = operation === 'ADMIN_AUTOMATIC_LINE_BATCH'
      ? validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
      : validMiniAppInput()
    const { ports, booking } = recoverableLineRetry(input, operation)

    expect(submitMiniAppBooking(input, ports).caseId).toBe(booking.caseId)
  })

  it('self-heals from the exact current normal-booking LINE retry producer contract', () => {
    const ports = createTestPorts({ lineFailsAtPush: 1 })
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')
    const persisted = ports.bookings.list()[0]!

    expect(persisted.lineState).toBe('RETRY')
    expect(submitMiniAppBooking(validMiniAppInput(), ports).caseId).toBe(persisted.caseId)
  })

  it('self-heals from the exact current automatic-queue LINE retry producer contract', () => {
    const ports = createTestPorts({ lineFailsAtPush: 1 })
    const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(input, ports)).toThrow('injected audit write failure')
    const persisted = ports.bookings.list()[0]!

    expect(persisted.lineState).toBe('RETRY')
    expect(submitMiniAppBooking(input, ports).caseId).toBe(persisted.caseId)
  })

  it('accepts the exact evidence-only retry produced for an automatic queue', () => {
    const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
    const { ports, booking } = recoverableLineRetry(input, 'ADMIN_EVIDENCE_LINE')

    expect(submitMiniAppBooking(input, ports).caseId).toBe(booking.caseId)
  })

  it.each(['ADMIN_BOOKING_LINE_BATCH', 'DOCTOR_LINE'] as const)(
    'rejects the normal-only %s retry as durability for an automatic queue',
    (operation) => {
      const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
      const { ports } = recoverableLineRetry(input, operation)

      expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    },
  )

  it('rejects the automatic-only retry as durability for a normal queue', () => {
    const input = validMiniAppInput()
    const { ports } = recoverableLineRetry(input, 'ADMIN_AUTOMATIC_LINE_BATCH')

    expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
  })

  it.each(['ADMIN_BOOKING_LINE_BATCH', 'DOCTOR_LINE', 'ADMIN_EVIDENCE_LINE'] as const)(
    'rejects %s outside the normal producer booking state',
    (operation) => {
      const input = validMiniAppInput()
      const { ports } = recoverableLineRetry(input, operation, {}, { status: 'FORM_SUBMITTED' })

      expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    },
  )

  it.each(['ADMIN_BOOKING_LINE_BATCH', 'DOCTOR_LINE', 'ADMIN_EVIDENCE_LINE'] as const)(
    'rejects %s for a normal queue without a confirmed appointment',
    (operation) => {
      const input = validMiniAppInput()
      const { ports } = recoverableLineRetry(input, operation, {}, { appointmentStatus: 'TENTATIVE' })

      expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    },
  )

  it.each(['ADMIN_AUTOMATIC_LINE_BATCH', 'ADMIN_EVIDENCE_LINE'] as const)(
    'rejects %s outside the automatic producer booking state',
    (operation) => {
      const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
      const { ports } = recoverableLineRetry(input, operation, {}, { status: 'FORM_SUBMITTED' })

      expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    },
  )

  it.each(['ADMIN_AUTOMATIC_LINE_BATCH', 'ADMIN_EVIDENCE_LINE'] as const)(
    'rejects %s for an impossible automatic awaiting-slot projection',
    (operation) => {
      const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
      const { ports } = recoverableLineRetry(input, operation, {}, {
        appointmentStatus: 'AWAITING_ADMIN_SLOT',
        appointmentStart: '2026-08-20T13:00:00+07:00',
        appointmentEnd: '2026-08-20T14:00:00+07:00',
      })

      expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    },
  )

  it.each([
    ['wrong evidence', { payload: {
      paymentEvidenceFileIds: ['wrong-payment'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 6,
    } }],
    ['wrong message version', { idempotencyKey: 'PMC-202608-0001:ADMIN_EVIDENCE_READY:5', payload: {
      paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 5,
    } }],
  ])('rejects the evidence-only LINE retry with %s', (_label, patch) => {
    const input = validMiniAppInput()
    const { ports } = recoverableLineRetry(input, 'ADMIN_EVIDENCE_LINE', patch)

    expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
  })

  it.each([
    ['wrong retry ID', { id: 'RETRY-PMC-202608-0001-OTHER' }],
    ['wrong operation', { operation: 'DOCTOR_LINE' }],
    ['wrong idempotency version', { idempotencyKey: 'PMC-202608-0001:ADMIN_BOOKING_LINE_BATCH:5:1' }],
    ['wrong payload version', { payload: { paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 5, batchIndex: 0 } }],
    ['wrong payload batch', { payload: { paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 6, batchIndex: 1 } }],
    ['non-produced self-consistent batch', {
      id: 'RETRY-PMC-202608-0001-ADMIN-LINE-BATCH-2',
      idempotencyKey: 'PMC-202608-0001:ADMIN_BOOKING_LINE_BATCH:6:2',
      payload: { paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 6, batchIndex: 1 },
    }],
    ['wrong ordered payment evidence', { payload: { paymentEvidenceFileIds: ['wrong-payment'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 6, batchIndex: 0 } }],
    ['extra payload field', { payload: { paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'], messageVersion: 6, batchIndex: 0, extra: 'unsafe' } }],
    ['legacy BOOKING_LINE', {
      id: 'RETRY-PMC-202608-0001-BOOKING-LINE', operation: 'BOOKING_LINE',
      idempotencyKey: 'PMC-202608-0001:BOOKING_LINE:6', payload: { messageVersion: 6 },
    }],
  ])('rejects LINE durability with %s', (_label, patch) => {
    const input = validMiniAppInput()
    const { ports, booking } = recoverableLineRetry(input, 'ADMIN_BOOKING_LINE_BATCH', patch)

    expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
    expect(ports.repositories.audit.listForCase(booking.caseId)
      .filter(({ action }) => action === 'MINI_APP_INGRESS_ACCEPTED')).toHaveLength(0)
  })

  it.each([
    ['wrong automatic status', { payload: {
      paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'],
      messageVersion: 6, batchIndex: 0, appointmentStatus: 'CONFIRMED',
    } }],
    ['wrong automatic idempotency batch', { idempotencyKey: 'PMC-202608-0001:ADMIN_AUTOMATIC_LINE_BATCH:6:2' }],
  ])('rejects automatic LINE durability with %s', (_label, patch) => {
    const input = validMiniAppInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
    const { ports } = recoverableLineRetry(input, 'ADMIN_AUTOMATIC_LINE_BATCH', patch)

    expect(() => submitMiniAppBooking(input, ports)).toThrow('mini app duplicate booking is not durable')
  })

  it('fails closed on a globally corrupted deterministic ingress audit identity without appending a duplicate ID', () => {
    const ports = createTestPorts()
    failMiniIngressAuditOnce(ports)
    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('injected audit write failure')
    const booking = ports.bookings.list()[0]!
    ports.repositories.audit.append({
      ...ingressAudit('PMC-202608-9999'),
      action: 'OTHER_ACTION',
      target: 'OTHER_TAB',
    })

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app payload hash conflict')
    const matchingIds = [
      ...ports.repositories.audit.listForCase(booking.caseId),
      ...ports.repositories.audit.listForCase('PMC-202608-9999'),
    ].filter(({ eventId }) => eventId === 'AUDIT-MINI-INGRESS-request-1')
    expect(matchingIds).toHaveLength(1)
  })

  it('rejects a second global audit row even when the first deterministic audit is valid', () => {
    const ports = createTestPorts()
    const booking = submitMiniAppBooking(validMiniAppInput(), ports)
    ports.repositories.audit.append({
      ...ingressAudit('PMC-202608-9999'), action: 'OTHER_ACTION', target: 'OTHER_TAB',
    })

    expect(() => submitMiniAppBooking(validMiniAppInput(), ports)).toThrow('mini app payload hash conflict')
    expect(ports.bookings.list()).toHaveLength(1)
    expect(ports.repositories.audit.listForCase(booking.caseId)
      .filter(({ eventId }) => eventId === 'AUDIT-MINI-INGRESS-request-1')).toHaveLength(1)
  })
})

function validMiniAppInput(patch: Partial<MiniAppBookingIngressPayload> = {}): MiniAppBookingIngressPayload {
  return {
    requestId: 'request-1', payloadHash: 'payload-hash-1', staffId: 'admin-1', aeName: 'Admin A',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'PMC Beauty', phoneNormalized: '0812345678', doctorId: 'doctor-1',
    serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-08-20', appointmentTime: '13:00',
    depositAmount: 1000, channelId: 'เพจหลัก', paymentEvidenceFileIds: ['payment-file-1'],
    chatEvidenceFileIds: ['chat-file-1'], ...patch,
  }
}

function failMiniIngressAuditOnce(ports: ReturnType<typeof createTestPorts>): void {
  const append = ports.repositories.audit.append.bind(ports.repositories.audit)
  let pendingFailure = true
  ports.repositories.audit.append = (event) => {
    if (pendingFailure && event.action === 'MINI_APP_INGRESS_ACCEPTED') {
      pendingFailure = false
      throw new Error('injected audit write failure')
    }
    append(event)
  }
}

function recoverableLineRetry(
  input: MiniAppBookingIngressPayload,
  operation: 'ADMIN_BOOKING_LINE_BATCH' | 'DOCTOR_LINE' | 'ADMIN_EVIDENCE_LINE' | 'ADMIN_AUTOMATIC_LINE_BATCH',
  patch: Record<string, unknown> = {},
  bookingPatch: Partial<BookingCase> = {},
) {
  const ports = createTestPorts()
  const formResponseId = `mini:v2:cmVxdWVzdC0x:${input.payloadHash}`
  const automatic = input.queueType === 'AUTO'
  const booking = ports.repositories.bookings.insert(ports.bookingFixture({
    formResponseId, version: 7, status: 'BOOKING_CONFIRMED',
    adminIdentityStatus: 'SELECTED_ADMIN', aeId: 'admin-1', aeName: 'Admin A',
    channelId: 'เพจหลัก', queueType: input.queueType,
    appointmentStatus: automatic ? 'AWAITING_ADMIN_SLOT' : 'CONFIRMED',
    appointmentStart: automatic ? null : '2026-08-20T13:00:00+07:00',
    appointmentEnd: automatic ? null : '2026-08-20T14:00:00+07:00', depositAmount: 1000,
    driveFolderId: 'drive-folder-1', driveFolderUrl: 'https://drive.test/folder-1',
    driveState: 'OK', calendarState: 'OK', calendarEventId: automatic ? null : 'calendar-event-1',
    lineState: 'RETRY', paymentEvidenceCount: 1, chatEvidenceCount: 1,
    ...bookingPatch,
  }))
  ports.repositories.bookings.rememberFormResponse(formResponseId, booking.caseId)
  appendCreationAudit(ports, booking.caseId, formResponseId)
  const batchIndex = 0
  const messageVersion = booking.version - 1
  const common = {
    caseId: booking.caseId, attempts: 0, status: 'PENDING', safeError: 'retry',
  }
  const retry = operation === 'ADMIN_BOOKING_LINE_BATCH' ? {
    ...common, id: `RETRY-${booking.caseId}-ADMIN-LINE-BATCH-1`, operation,
    idempotencyKey: `${booking.caseId}:ADMIN_BOOKING_LINE_BATCH:${messageVersion}:1`,
    payload: { paymentEvidenceFileIds: input.paymentEvidenceFileIds, chatEvidenceFileIds: input.chatEvidenceFileIds,
      messageVersion, batchIndex },
  } : operation === 'DOCTOR_LINE' ? {
    ...common, id: `RETRY-${booking.caseId}-DOCTOR-LINE`, operation,
    idempotencyKey: `${booking.caseId}:DOCTOR_LINE:${messageVersion}`,
    payload: { messageVersion },
  } : operation === 'ADMIN_EVIDENCE_LINE' ? {
    ...common, id: `RETRY-${booking.caseId}-ADMIN-EVIDENCE`, operation,
    idempotencyKey: `${booking.caseId}:ADMIN_EVIDENCE_READY:${messageVersion}`,
    payload: { paymentEvidenceFileIds: input.paymentEvidenceFileIds, chatEvidenceFileIds: input.chatEvidenceFileIds,
      messageVersion },
  } : {
    ...common, id: `RETRY-${booking.caseId}-ADMIN-AUTO-BATCH-1`, operation,
    idempotencyKey: `${booking.caseId}:ADMIN_AUTOMATIC_LINE_BATCH:${messageVersion}:1`,
    payload: { paymentEvidenceFileIds: input.paymentEvidenceFileIds, chatEvidenceFileIds: input.chatEvidenceFileIds,
      messageVersion, batchIndex, appointmentStatus: booking.appointmentStatus },
  }
  ports.repositories.retries.enqueue({ ...retry, ...patch })
  return { ports, booking }
}

function appendCreationAudit(
  ports: ReturnType<typeof createTestPorts>,
  caseId: string,
  formResponseId: string,
): void {
  ports.repositories.audit.append({
    eventId: `AUDIT-${formResponseId}-1`, caseId, actor: 'admin@example.com', action: 'BOOKING_CREATED',
    target: 'BOOKING_MASTER', before: null, after: { status: 'FORM_SUBMITTED', adminId: 'admin-1', aeId: 'admin-1' },
    reason: 'Google Form submission', timestamp: ports.clock.nowIso(), correlationId: formResponseId,
  })
}

function ingressAudit(caseId: string) {
  return {
    eventId: 'AUDIT-MINI-INGRESS-request-1', caseId, actor: 'admin@example.com',
    action: 'MINI_APP_INGRESS_ACCEPTED', target: 'BOOKING_MASTER', before: null,
    after: { requestId: 'request-1', payloadHash: 'payload-hash-1' },
    reason: 'Verified LINE Mini App booking ingress', timestamp: '2026-08-20T09:00:00+07:00', correlationId: 'request-1',
  }
}
