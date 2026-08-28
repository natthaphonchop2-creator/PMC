import { describe, expect, it } from 'vitest'
import type { MiniAppBookingIngressPayload } from '../../../shared/pmcMiniAppBooking'
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
