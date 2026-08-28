import { describe, expect, it } from 'vitest'
import { asyncBookingEvent } from '../../server/pmc-mini-app/asyncTelemetry'

const requestId = 'request-550e8400-e29b-41d4-a716-446655440000'
const draftId = 'draft-550e8400-e29b-41d4-a716-446655440000'

describe('PMC async booking telemetry', () => {
  it('emits the strict safe lifecycle projection without evidence byte values', () => {
    expect(asyncBookingEvent('booking_worker_completed', {
      requestId, draftId, caseId: 'PMC-202608-0001', attempt: 2, state: 'CONFIRMED', elapsedMs: 1_204, fileCount: 4,
    })).toEqual({
      event: 'booking_worker_completed',
      requestId, draftId, caseId: 'PMC-202608-0001', attempt: 2, state: 'CONFIRMED', elapsedMs: 1_204, fileCount: 4,
    })
  })

  it.each([
    ['unknown field', { requestId, draftId, customerName: 'private' }],
    ['evidence byte total', { requestId, draftId, totalBytes: 123 }],
    ['request non-v4 UUID', { requestId: 'request-550e8400-e29b-31d4-a716-446655440000', draftId }],
    ['request word', { requestId: 'request-decade', draftId }],
    ['draft word', { requestId, draftId: 'draft-cafe' }],
    ['Thai phone', { requestId: 'request-0812345678', draftId }],
    ['URL', { requestId, draftId, state: 'https://private.example' }],
    ['bearer token', { requestId, draftId, safeErrorCode: 'Bearer secret-token' }],
    ['evidence content', { requestId, draftId, state: 'data:image/png;base64,AA==' }],
    ['customer-like error code', { requestId, draftId, safeErrorCode: 'CUSTOMER_ALICE' }],
    ['phone-shaped Case serial', { requestId, draftId, caseId: 'PMC-202608-0812345678' }],
    ['out-of-range Case serial', { requestId, draftId, caseId: 'PMC-202608-0000' }],
    ['non-async state', { requestId, draftId, state: 'CUSTOMER_WAITING' }],
    ['unsafe timing', { requestId, draftId, elapsedMs: -1 }],
  ])('rejects %s', (_label, fields) => {
    expect(() => asyncBookingEvent('booking_worker_retrying', fields as never)).toThrow('ASYNC_TELEMETRY_INVALID_FIELDS')
  })
})
