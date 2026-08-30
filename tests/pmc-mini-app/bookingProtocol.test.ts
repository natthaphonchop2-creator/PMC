import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppBookingIngress,
  parseBookingAttributionSelection,
  type UnsignedMiniAppBookingIngressEnvelopeV2,
} from '../../shared/pmcBookingProtocol'

describe('PMC booking protocol 2 attribution contract', () => {
  it('binds every protocol-2 attribution identity into the signed canonical body', () => {
    const base = protocol2Envelope({
      staffId: 'ADMIN_01', recorderName: 'มัส',
      adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
    })

    expect(canonicalMiniAppBookingIngress(base))
      .not.toBe(canonicalMiniAppBookingIngress(protocol2Envelope({ ...base.payload, adminId: 'ADMIN_04' })))
  })

  it('rejects names in the browser attribution selection', () => {
    expect(parseBookingAttributionSelection({ adminId: 'ADMIN_02', aeId: null, adminName: 'spoof' }))
      .toEqual({ ok: false, code: 'UNKNOWN_BOOKING_FIELD' })
  })
})

function protocol2Envelope(patch: Partial<UnsignedMiniAppBookingIngressEnvelopeV2['payload']>): UnsignedMiniAppBookingIngressEnvelopeV2 {
  return {
    kind: 'MINI_APP_BOOKING', version: 2, timestamp: 1_800_000_000, nonce: 'nonce-123456',
    payload: {
      protocolVersion: 2, requestId: 'request-1', payloadHash: 'payload-hash-1', staffId: 'ADMIN_01', recorderName: 'มัส',
      adminId: 'ADMIN_02', adminName: 'แวว', aeId: null, aeName: null, customerName: 'ลูกค้าทดสอบ',
      facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1',
      queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900,
      channelId: 'เพจหลัก', paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], ...patch,
    },
  }
}
