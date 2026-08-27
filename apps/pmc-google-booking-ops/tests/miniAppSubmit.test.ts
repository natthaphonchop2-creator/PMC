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
