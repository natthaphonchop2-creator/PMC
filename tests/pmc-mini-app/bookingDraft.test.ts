import { describe, expect, it } from 'vitest'
import {
  bookingPayloadHash,
  parseBookingDraft,
  parseBookingDraftV2,
  transitionDraft,
  type BookingDraftContext,
  type BookingDraftContextV2,
} from '../../server/pmc-mini-app/bookingDraft'

describe('PMC Mini App booking draft validation', () => {
  it('requires date and time for NORMAL but forbids them for AUTO', () => {
    expect(() => parseBookingDraft(validInput({ queueType: 'NORMAL', appointmentDate: null }), context())).toThrow('APPOINTMENT_DATE_REQUIRED')
    expect(() => parseBookingDraft(validInput({ queueType: 'NORMAL', appointmentTime: null }), context())).toThrow('APPOINTMENT_TIME_REQUIRED')
    expect(() => parseBookingDraft(validInput({ queueType: 'AUTO', appointmentDate: '2026-09-01', appointmentTime: null }), context())).toThrow('AUTO_QUEUE_DATE_FORBIDDEN')
    expect(() => parseBookingDraft(validInput({ queueType: 'AUTO', appointmentDate: null, appointmentTime: '13:00' }), context())).toThrow('AUTO_QUEUE_TIME_FORBIDDEN')
  })

  it('normalizes a Thai phone and derives locked staff/evidence fields from server context', () => {
    const draft = parseBookingDraft(validInput({ phone: '+66 81-234-5678' }), context())

    expect(draft).toMatchObject({
      staffId: 'staff-1',
      lineUserIdHash: 'line-user-hash',
      phoneNormalized: '0812345678',
      state: 'READY_TO_CONFIRM',
      version: 1,
      paymentEvidenceFileIds: ['payment-1'],
      chatEvidenceFileIds: ['chat-1'],
      evidenceCount: 2,
    })
  })

  it('accepts server-allowlisted Thai configuration IDs without weakening request IDs', () => {
    const draft = parseBookingDraft(validInput({
      doctorId: 'หมอ Benz', serviceId: 'เติมไขมัน', channelId: 'เพจหลัก',
    }), context({
      doctorIds: ['หมอ Benz'], serviceIds: ['เติมไขมัน'], channelIds: ['เพจหลัก'],
    }))

    expect(draft).toMatchObject({ doctorId: 'หมอ Benz', serviceId: 'เติมไขมัน', channelId: 'เพจหลัก' })
  })

  it.each([
    ['invalid Thai phone', validInput({ phone: '123' }), 'INVALID_THAI_PHONE'],
    ['zero deposit', validInput({ depositAmount: 0 }), 'DEPOSIT_AMOUNT_REQUIRED'],
    ['unknown doctor', validInput({ doctorId: 'doctor-unknown' }), 'DOCTOR_NOT_ALLOWED'],
    ['unknown service', validInput({ serviceId: 'service-unknown' }), 'SERVICE_NOT_ALLOWED'],
    ['unknown channel', validInput({ channelId: 'channel-unknown' }), 'CHANNEL_NOT_ALLOWED'],
    ['ineligible AE', validInput({ aeName: 'คนนอก' }), 'AE_NOT_ALLOWED'],
  ])('rejects %s', (_name, input, code) => {
    expect(() => parseBookingDraft(input, context())).toThrow(code)
  })

  it('rejects a client attempt to override the authenticated Admin', () => {
    expect(() => parseBookingDraft({ ...validInput(), adminName: 'ผู้ปลอมแปลง' }, context())).toThrow('UNKNOWN_BOOKING_FIELD')
  })

  it('keeps recorder immutable and resolves Admin and AE snapshots by exact ID', () => {
    const draft = parseBookingDraftV2(validInputV2({ adminId: 'ADMIN_02', aeId: 'ADMIN_03' }), contextV2())

    expect(draft).toMatchObject({
      protocolVersion: 2,
      staffId: 'ADMIN_01',
      recorderName: 'มัส',
      adminId: 'ADMIN_02',
      adminName: 'แวว',
      aeId: 'ADMIN_03',
      aeName: 'หมวย',
    })
  })

  it('keeps duplicate display names distinct by ID and supports a null AE', () => {
    const draft = parseBookingDraftV2(validInputV2({ adminId: 'ADMIN_04', aeId: null }), contextV2())

    expect(draft).toMatchObject({ adminId: 'ADMIN_04', adminName: 'แวว', aeId: null, aeName: 'ไม่ระบุ' })
  })

  it.each([
    ['unknown Admin', { adminId: 'ADMIN_UNKNOWN', aeId: null }, 'ADMIN_NOT_ALLOWED'],
    ['inactive Admin', { adminId: 'ADMIN_INACTIVE', aeId: null }, 'ADMIN_NOT_ALLOWED'],
    ['unknown AE', { adminId: 'ADMIN_02', aeId: 'ADMIN_UNKNOWN' }, 'AE_NOT_ALLOWED'],
  ])('rejects %s', (_name, attribution, code) => {
    expect(() => parseBookingDraftV2(validInputV2(attribution), contextV2())).toThrow(code)
  })

  it('rejects browser-supplied attribution names in protocol 2', () => {
    expect(() => parseBookingDraftV2({ ...validInputV2(), adminName: 'ปลอม' }, contextV2())).toThrow('UNKNOWN_BOOKING_FIELD')
    expect(() => parseBookingDraftV2({ ...validInputV2(), recorderName: 'ปลอม' }, contextV2())).toThrow('UNKNOWN_BOOKING_FIELD')
  })

  it('requires one to ten files for each evidence kind', () => {
    expect(() => parseBookingDraft(validInput(), context({ paymentEvidenceFileIds: [] }))).toThrow('PAYMENT_EVIDENCE_REQUIRED')
    expect(() => parseBookingDraft(validInput(), context({ chatEvidenceFileIds: [] }))).toThrow('CHAT_EVIDENCE_REQUIRED')
    expect(() => parseBookingDraft(validInput(), context({ chatEvidenceFileIds: Array.from({ length: 11 }, (_, index) => `chat-${index}`) }))).toThrow('CHAT_EVIDENCE_LIMIT')
  })

  it('requires ordered staging object keys in async mode while keeping Drive IDs optional', () => {
    const paymentKeys = [stagingKey('PAYMENT', 'a'), stagingKey('PAYMENT', 'b')]
    const chatKeys = [stagingKey('CHAT', 'c')]
    const draft = parseBookingDraft(validInput(), context({
      asyncEvidence: true,
      paymentEvidenceFileIds: [],
      chatEvidenceFileIds: [],
      paymentEvidenceObjectKeys: paymentKeys,
      chatEvidenceObjectKeys: chatKeys,
    }))

    expect(draft.paymentEvidenceObjectKeys).toEqual(paymentKeys)
    expect(draft.chatEvidenceObjectKeys).toEqual(chatKeys)
    expect(draft.evidenceCount).toBe(3)
    expect(() => parseBookingDraft(validInput(), context({
      asyncEvidence: true,
      paymentEvidenceObjectKeys: [],
      chatEvidenceObjectKeys: chatKeys,
    }))).toThrow('PAYMENT_EVIDENCE_REQUIRED')
  })

  it('still requires Drive file IDs in synchronous mode even when staging keys exist', () => {
    expect(() => parseBookingDraft(validInput(), context({
      paymentEvidenceFileIds: [],
      paymentEvidenceObjectKeys: [stagingKey('PAYMENT', 'a')],
      chatEvidenceObjectKeys: [stagingKey('CHAT', 'b')],
    }))).toThrow('PAYMENT_EVIDENCE_REQUIRED')
  })

  it('hashes normalized fields and ordered evidence while excluding transient timestamps', () => {
    const first = parseBookingDraft(validInput(), context())
    const later = { ...first, updatedAt: '2026-08-27T12:00:00.000Z' }
    const reordered = { ...first, paymentEvidenceFileIds: ['payment-2', 'payment-1'], evidenceCount: 3 }

    expect(bookingPayloadHash(later)).toBe(bookingPayloadHash(first))
    expect(bookingPayloadHash(reordered)).not.toBe(bookingPayloadHash(first))
  })

  it('binds every protocol-2 attribution snapshot into the payload hash', () => {
    const draft = parseBookingDraftV2(validInputV2({ adminId: 'ADMIN_02', aeId: 'ADMIN_03' }), contextV2())

    expect(bookingPayloadHash({ ...draft, adminId: 'ADMIN_04' })).not.toBe(bookingPayloadHash(draft))
    expect(bookingPayloadHash({ ...draft, adminName: 'ปลอม' })).not.toBe(bookingPayloadHash(draft))
    expect(bookingPayloadHash({ ...draft, aeId: null, aeName: 'ไม่ระบุ' })).not.toBe(bookingPayloadHash(draft))
    expect(bookingPayloadHash({ ...draft, recorderName: 'คนอื่น' })).not.toBe(bookingPayloadHash(draft))
  })

  it('binds ordered staging object keys before any Drive file IDs exist', () => {
    const paymentKeys = [stagingKey('PAYMENT', 'a'), stagingKey('PAYMENT', 'b')]
    const chatKeys = [stagingKey('CHAT', 'c'), stagingKey('CHAT', 'd')]
    const draft = parseBookingDraft(validInput(), context({
      asyncEvidence: true,
      paymentEvidenceFileIds: [],
      chatEvidenceFileIds: [],
      paymentEvidenceObjectKeys: paymentKeys,
      chatEvidenceObjectKeys: chatKeys,
    }))
    const reordered = {
      ...draft,
      paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys].reverse(),
    }

    expect(draft.paymentEvidenceFileIds).toEqual([])
    expect(draft.chatEvidenceFileIds).toEqual([])
    expect(bookingPayloadHash(reordered)).not.toBe(bookingPayloadHash(draft))
  })

  it('keeps the async payload hash stable when deterministic Drive IDs replace staged evidence', () => {
    const draft = parseBookingDraft(validInput(), context({
      asyncEvidence: true,
      paymentEvidenceFileIds: [],
      chatEvidenceFileIds: [],
      paymentEvidenceObjectKeys: [stagingKey('PAYMENT', 'a')],
      chatEvidenceObjectKeys: [stagingKey('CHAT', 'b')],
    }))
    const projected = {
      ...draft,
      paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'],
    }

    expect(bookingPayloadHash(projected)).toBe(bookingPayloadHash(draft))
  })

  it('allows only explicit state transitions and marks terminal evidence for retention review', () => {
    const draft = parseBookingDraft(validInput(), context())
    const confirming = transitionDraft(draft, { type: 'SET_STATE', state: 'CONFIRMING', updatedAt: '2026-08-27T10:01:00.000Z' })
    expect(confirming.state).toBe('CONFIRMING')
    expect(() => transitionDraft(confirming, { type: 'SET_STATE', state: 'DRAFT', updatedAt: '2026-08-27T10:02:00.000Z' })).toThrow('INVALID_DRAFT_TRANSITION')

    const cancelled = transitionDraft(draft, { type: 'SET_STATE', state: 'CANCELLED', updatedAt: '2026-08-27T10:03:00.000Z' })
    expect(cancelled.retentionState).toBe('PENDING_APPROVAL')
  })
})

function validInput(patch: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1', aeName: 'ไม่ระบุ', customerName: ' ลูกค้า ทดสอบ ', facebookName: ' Facebook Test ',
    phone: '081-234-5678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    ...patch,
  }
}

function validInputV2(patch: Record<string, unknown> = {}) {
  const { aeName: _aeName, ...base } = validInput()
  return { ...base, adminId: 'ADMIN_02', aeId: null, ...patch }
}

function context(patch: Partial<BookingDraftContext> = {}): BookingDraftContext {
  return {
    draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    doctorIds: ['doctor-1'], serviceIds: ['service-1'], channelIds: ['channel-1'], eligibleAeNames: ['ไม่ระบุ', 'มัส'],
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], asyncEvidence: false,
    now: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

function contextV2(patch: Partial<BookingDraftContextV2> = {}): BookingDraftContextV2 {
  return {
    draftId: 'draft-1', staffId: 'ADMIN_01', recorderName: 'มัส', lineUserIdHash: 'line-user-hash',
    doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
    services: [{ id: 'service-1', name: 'เติมไขมัน' }],
    channels: [{ id: 'channel-1', name: 'เพจTAB' }],
    admins: [
      { id: 'ADMIN_02', name: 'แวว' },
      { id: 'ADMIN_03', name: 'หมวย' },
      { id: 'ADMIN_04', name: 'แวว' },
    ],
    aes: [
      { id: 'ADMIN_02', name: 'แวว' },
      { id: 'ADMIN_03', name: 'หมวย' },
      { id: 'ADMIN_04', name: 'แวว' },
    ],
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], asyncEvidence: false,
    now: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

function stagingKey(kind: 'PAYMENT' | 'CHAT', marker: string): string {
  return `drafts/draft-1/${kind}/${marker.repeat(64)}.png`
}
