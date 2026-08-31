import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppBookingIngress,
  parseBookingAttributionSelection,
  type UnsignedMiniAppBookingIngressEnvelopeV2,
} from '../../shared/pmcBookingProtocol'

describe('PMC booking protocol 2 attribution contract', () => {
  it.each([
    ['recorder ID', { staffId: 'ADMIN_04' }],
    ['recorder name', { recorderName: 'มัสใหม่' }],
    ['Admin ID', { adminId: 'ADMIN_04' }],
    ['Admin name', { adminName: 'แววใหม่' }],
    ['AE ID', { aeId: 'ADMIN_04' }],
    ['AE name', { aeName: 'หมวยใหม่' }],
    ['null AE pair', { aeId: null, aeName: null }],
  ] satisfies Array<[string, Partial<UnsignedMiniAppBookingIngressEnvelopeV2['payload']>]>)(
    'binds protocol-2 %s into the signed canonical body', (_label, patch) => {
      const base = protocol2Envelope({
        staffId: 'ADMIN_01', recorderName: 'มัส',
        adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
      })

      expect(canonicalMiniAppBookingIngress(base))
        .not.toBe(canonicalMiniAppBookingIngress(protocol2Envelope({ ...base.payload, ...patch })))
    },
  )

  it.each([
    ['payload version 1 inside envelope version 2', {
      ...protocol2Envelope({}),
      payload: { ...protocol2Envelope({}).payload, protocolVersion: 1 },
    }],
    ['protocol-2 payload inside envelope version 1', {
      ...protocol2Envelope({}),
      version: 1,
    }],
  ])('rejects %s', (_label, envelope) => {
    expect(() => canonicalMiniAppBookingIngress(
      envelope as unknown as UnsignedMiniAppBookingIngressEnvelopeV2,
    )).toThrow()
  })

  it('rejects names in the browser attribution selection', () => {
    expect(parseBookingAttributionSelection({ adminId: 'ADMIN_02', aeId: null, adminName: 'spoof' }))
      .toEqual({ ok: false, code: 'UNKNOWN_BOOKING_FIELD' })
  })

  it.each([
    ['blank Admin ID', { adminId: '', aeId: null }],
    ['whitespace Admin ID', { adminId: '   ', aeId: null }],
    ['unsafe Admin ID', { adminId: 'ADMIN/02', aeId: null }],
    ['oversized Admin ID', { adminId: 'A'.repeat(125), aeId: null }],
    ['blank AE ID', { adminId: 'ADMIN_02', aeId: '' }],
    ['whitespace AE ID', { adminId: 'ADMIN_02', aeId: '   ' }],
    ['unsafe AE ID', { adminId: 'ADMIN_02', aeId: 'AE/01' }],
    ['oversized AE ID', { adminId: 'ADMIN_02', aeId: 'A'.repeat(125) }],
  ])('rejects %s instead of publishing a non-canonical selection', (_label, selection) => {
    expect(parseBookingAttributionSelection(selection)).toEqual({
      ok: false,
      code: 'INVALID_BOOKING_ATTRIBUTION_SELECTION',
    })
  })

  it('accepts required canonical Admin ID with an explicit null AE', () => {
    expect(parseBookingAttributionSelection({ adminId: 'ADMIN_02', aeId: null })).toEqual({
      ok: true,
      value: { adminId: 'ADMIN_02', aeId: null },
    })
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
