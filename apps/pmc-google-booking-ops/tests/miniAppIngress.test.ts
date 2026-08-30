import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppBookingIngress,
  type MiniAppBookingIngressEnvelope,
  type MiniAppBookingIngressEnvelopeV2,
} from '../../../shared/pmcMiniAppBooking'
import { parseAndVerifyMiniAppIngress } from '../src/domain/miniAppIngress'
import { processBookingDoPost } from '../src/entrypoints'
import { createTestPorts } from './helpers/fakes'

describe('Apps Script Mini App booking ingress', () => {
  it('accepts an exact signed envelope for active configured staff and choices', () => {
    const ports = createTestPorts()

    expect(parseAndVerifyMiniAppIngress(event(envelope()), ports)).toMatchObject({
      requestId: 'request-1', staffId: 'admin-1', doctorId: 'doctor-1', serviceId: 'service-1', channelId: 'เพจหลัก',
    })
    expect(ports.repositories.lineDirectory.hasNonce('nonce-123456')).toBe(true)
  })

  it('accepts signed protocol-2 recorder, Admin, and AE pairs while Admin is not a closer', () => {
    const ports = createTestPorts()

    expect(parseAndVerifyMiniAppIngress(event(signedEnvelopeV2()), ports)).toMatchObject({
      protocolVersion: 2,
      staffId: 'admin-1',
      recorderName: 'Admin A',
      adminId: 'staff-ae',
      adminName: 'เอม',
      aeId: 'admin-1',
      aeName: 'Admin A',
    })
  })

  it.each([
    ['recorder name', { recorderName: 'ปลอม' }],
    ['Admin name', { adminName: 'ปลอม' }],
    ['AE name', { aeName: 'ปลอม' }],
    ['non-canonical Admin ID', { adminId: ' staff-ae' }],
  ])('rejects a signed protocol-2 %s snapshot that does not match current Staff', (_label, patch) => {
    expect(() => parseAndVerifyMiniAppIngress(
      event(signedEnvelopeV2({ payload: patch })),
      createTestPorts(),
    )).toThrow()
  })

  it('rejects a protocol-2 recorder who can be selected but cannot close bookings', () => {
    expect(() => parseAndVerifyMiniAppIngress(event(signedEnvelopeV2({
      payload: {
        staffId: 'staff-ae',
        recorderName: 'เอม',
        adminId: 'admin-1',
        adminName: 'Admin A',
      },
    })), createTestPorts())).toThrow('mini app staff is not active or eligible')
  })

  it.each([
    ['reserved Admin ID', { adminId: 'NONE', adminName: 'Reserved by ID' }],
    ['reserved Admin name', { adminId: 'reserved-name', adminName: 'ไม่ระบุ' }],
    ['reserved AE ID', { aeId: 'NONE', aeName: 'Reserved by ID' }],
    ['reserved AE name', { aeId: 'reserved-name', aeName: 'ไม่ระบุ' }],
  ])('rejects protocol-2 %s even when the Staff row is active and AE-eligible', (_label, patch) => {
    const ports = createTestPorts()
    const base = ports.config.listStaff()
    ports.config.listStaff = () => [
      ...base,
      { ...base[1], id: 'NONE', name: 'Reserved by ID' },
      { ...base[1], id: 'reserved-name', name: 'ไม่ระบุ' },
    ]

    expect(() => parseAndVerifyMiniAppIngress(
      event(signedEnvelopeV2({ payload: patch })),
      ports,
    )).toThrow()
  })

  it('returns the exact safe booking projection for an initial submission and verified duplicate', () => {
    const miniPorts = createTestPorts()
    const first = processBookingDoPost(event(envelope()), miniPorts)
    const duplicate = processBookingDoPost(event(signedEnvelope({ nonce: 'nonce-654321' })), miniPorts)

    expect(first).toEqual({
      caseId: 'PMC-202608-0001', status: 'CONFIRMED',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK',
    })
    expect(duplicate).toEqual(first)
    expect(Object.keys(first)).toEqual(['caseId', 'status', 'driveState', 'calendarState', 'lineState'])
    expect(JSON.stringify(first)).not.toMatch(/ลูกค้าทดสอบ|Facebook Test|0812345678|payment-file-1|chat-file-1/i)
    expect(miniPorts.bookings.list()).toHaveLength(1)
  })

  it('routes legacy LINE directory payloads without changing the legacy contract', () => {
    const legacyPorts = createTestPorts({ lineDirectoryCaptureEnabled: true })
    const legacyPayload = legacyPorts.signedBookingIngressFixture('group', 'group-source-1')
    expect(processBookingDoPost(event(legacyPayload), legacyPorts)).toEqual({ ok: true })
    expect(legacyPorts.lineDirectory.list()).toEqual([{
      sourceType: 'group', sourceId: 'group-source-1', capturedAt: legacyPorts.clock.nowIso(),
    }])
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
      paymentEvidenceFileIds: ['payment-file-1'], chatEvidenceFileIds: ['chat-file-1'],
    },
    ...overrides,
  }
  const unsigned = { ...base, payload: { ...base.payload, ...(overrides.payload ?? {}) } }
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret').update(canonicalMiniAppBookingIngress(unsigned)).digest('hex'),
  }
}

function signedEnvelopeV2(
  overrides: {
    timestamp?: number
    nonce?: string
    payload?: Partial<MiniAppBookingIngressEnvelopeV2['payload']>
  } = {},
): MiniAppBookingIngressEnvelopeV2 {
  const unsigned: Omit<MiniAppBookingIngressEnvelopeV2, 'signature'> = {
    kind: 'MINI_APP_BOOKING',
    version: 2,
    timestamp: overrides.timestamp ?? Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1000),
    nonce: overrides.nonce ?? 'nonce-v2-123456',
    payload: {
      protocolVersion: 2,
      requestId: 'request-v2-1',
      payloadHash: 'payload-hash-v2-1',
      staffId: 'admin-1',
      recorderName: 'Admin A',
      adminId: 'staff-ae',
      adminName: 'เอม',
      aeId: 'admin-1',
      aeName: 'Admin A',
      customerName: 'ลูกค้าทดสอบ',
      facebookName: 'Facebook Test',
      phoneNormalized: '0812345678',
      doctorId: 'doctor-1',
      serviceId: 'service-1',
      queueType: 'NORMAL',
      appointmentDate: '2026-09-01',
      appointmentTime: '13:00',
      depositAmount: 900,
      channelId: 'เพจหลัก',
      paymentEvidenceFileIds: ['payment-file-1'],
      chatEvidenceFileIds: ['chat-file-1'],
      ...(overrides.payload ?? {}),
    },
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret')
      .update(canonicalMiniAppBookingIngress(unsigned))
      .digest('hex'),
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
