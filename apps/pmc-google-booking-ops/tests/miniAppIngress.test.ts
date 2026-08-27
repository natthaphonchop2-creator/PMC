import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppBookingIngress,
  type MiniAppBookingIngressEnvelope,
} from '../../../shared/pmcMiniAppBooking'
import { parseAndVerifyMiniAppIngress } from '../src/domain/miniAppIngress'
import { createTestPorts } from './helpers/fakes'

describe('Apps Script Mini App booking ingress', () => {
  it('accepts an exact signed envelope for active configured staff and choices', () => {
    const ports = createTestPorts()

    expect(parseAndVerifyMiniAppIngress(event(envelope()), ports)).toMatchObject({
      requestId: 'request-1', staffId: 'admin-1', doctorId: 'doctor-1', serviceId: 'service-1', channelId: 'เพจหลัก',
    })
  })

  it.each([
    ['altered payload', () => ({ ...envelope(), payload: { ...envelope().payload, customerName: 'แก้หลังเซ็น' } })],
    ['expired timestamp', () => signedEnvelope({ timestamp: Math.floor(Date.parse('2026-08-19T09:00:00+07:00') / 1000) })],
    ['unknown kind', () => ({ ...envelope(), kind: 'UNKNOWN_KIND' })],
    ['unknown staff', () => signedEnvelope({ payload: { ...envelope().payload, staffId: 'staff-unknown' } })],
    ['unknown doctor', () => signedEnvelope({ payload: { ...envelope().payload, doctorId: 'doctor-unknown' } })],
    ['too many evidence IDs', () => signedEnvelope({ payload: { ...envelope().payload, chatEvidenceFileIds: Array.from({ length: 11 }, (_, index) => `chat-${index}`) } })],
  ])('rejects %s', (_name, build) => {
    expect(() => parseAndVerifyMiniAppIngress(event(build()), createTestPorts())).toThrow()
  })

  it('rejects a nonce already consumed by an earlier ingress', () => {
    const ports = createTestPorts()
    ports.repositories.lineDirectory.rememberNonce('nonce-123456', ports.clock.nowIso())

    expect(() => parseAndVerifyMiniAppIngress(event(envelope()), ports)).toThrow('mini app ingress replay detected')
  })
})

function envelope(): MiniAppBookingIngressEnvelope {
  return signedEnvelope()
}

function signedEnvelope(overrides: Partial<Omit<MiniAppBookingIngressEnvelope, 'signature'>> = {}): MiniAppBookingIngressEnvelope {
  const base: Omit<MiniAppBookingIngressEnvelope, 'signature'> = {
    kind: 'MINI_APP_BOOKING',
    version: 1,
    timestamp: Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1000),
    nonce: 'nonce-123456',
    payload: {
      requestId: 'request-1', payloadHash: 'payload-hash-1', staffId: 'admin-1', aeName: 'เอม',
      customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
      doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
      appointmentTime: '13:00', depositAmount: 900, channelId: 'เพจหลัก',
      paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    },
    ...overrides,
  }
  const unsigned = { ...base, payload: { ...base.payload, ...(overrides.payload ?? {}) } }
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret').update(canonicalMiniAppBookingIngress(unsigned)).digest('hex'),
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
