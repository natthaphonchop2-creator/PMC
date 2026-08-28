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
    expect(first.formResponseId).toBe('mini:request-1')
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
