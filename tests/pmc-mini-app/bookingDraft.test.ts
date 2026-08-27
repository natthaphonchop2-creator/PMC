import { describe, expect, it } from 'vitest'
import {
  bookingPayloadHash,
  parseBookingDraft,
  transitionDraft,
  type BookingDraftContext,
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

  it('requires one to ten files for each evidence kind', () => {
    expect(() => parseBookingDraft(validInput(), context({ paymentEvidenceFileIds: [] }))).toThrow('PAYMENT_EVIDENCE_REQUIRED')
    expect(() => parseBookingDraft(validInput(), context({ chatEvidenceFileIds: [] }))).toThrow('CHAT_EVIDENCE_REQUIRED')
    expect(() => parseBookingDraft(validInput(), context({ chatEvidenceFileIds: Array.from({ length: 11 }, (_, index) => `chat-${index}`) }))).toThrow('CHAT_EVIDENCE_LIMIT')
  })

  it('hashes normalized fields and ordered evidence while excluding transient timestamps', () => {
    const first = parseBookingDraft(validInput(), context())
    const later = { ...first, updatedAt: '2026-08-27T12:00:00.000Z' }
    const reordered = { ...first, paymentEvidenceFileIds: ['payment-2', 'payment-1'], evidenceCount: 3 }

    expect(bookingPayloadHash(later)).toBe(bookingPayloadHash(first))
    expect(bookingPayloadHash(reordered)).not.toBe(bookingPayloadHash(first))
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

function context(patch: Partial<BookingDraftContext> = {}): BookingDraftContext {
  return {
    draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    doctorIds: ['doctor-1'], serviceIds: ['service-1'], channelIds: ['channel-1'], eligibleAeNames: ['ไม่ระบุ', 'มัส'],
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], now: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}
