import { describe, expect, it } from 'vitest'
import { asyncBookingEvent } from '../../server/pmc-mini-app/asyncTelemetry'

describe('PMC async booking telemetry', () => {
  it('emits only the allowlisted booking lifecycle fields', () => {
    expect(asyncBookingEvent('booking_worker_completed', {
      requestId: 'request-1',
      draftId: 'draft-1',
      caseId: 'PMC-202608-0001',
      attempt: 2,
      state: 'CONFIRMED',
      elapsedMs: 1_204,
      fileCount: 4,
      totalBytes: 123_456,
    })).toEqual({
      event: 'booking_worker_completed',
      requestId: 'request-1',
      draftId: 'draft-1',
      caseId: 'PMC-202608-0001',
      attempt: 2,
      state: 'CONFIRMED',
      elapsedMs: 1_204,
      fileCount: 4,
      totalBytes: 123_456,
    })
  })

  it.each([
    ['unknown field', { requestId: 'request-1', draftId: 'draft-1', customerName: 'private' }],
    ['Thai phone number', { requestId: '0812345678', draftId: 'draft-1' }],
    ['customer-like identifier', { requestId: 'request-Alice', draftId: 'draft-1' }],
    ['URL', { requestId: 'https://private.example/evidence', draftId: 'draft-1' }],
    ['bearer token', { requestId: 'request-1', draftId: 'Bearer secret-token' }],
    ['evidence content', { requestId: 'request-1', draftId: 'data:image/png;base64,AA==' }],
    ['unsafe error detail', { requestId: 'request-1', draftId: 'draft-1', safeErrorCode: 'timeout https://private.example' }],
    ['unsafe timing', { requestId: 'request-1', draftId: 'draft-1', elapsedMs: -1 }],
  ])('rejects %s without retaining the provided value', (_label, fields) => {
    expect(() => asyncBookingEvent('booking_worker_retrying', fields as never)).toThrow('ASYNC_TELEMETRY_INVALID_FIELDS')
  })
})
