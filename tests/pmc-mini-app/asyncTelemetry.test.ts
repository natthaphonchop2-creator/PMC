import { describe, expect, it } from 'vitest'
import { asyncBookingEvent } from '../../server/pmc-mini-app/asyncTelemetry'

describe('PMC async booking telemetry', () => {
  it('emits the strict aggregate lifecycle projection without identifiers or evidence byte values', () => {
    expect(asyncBookingEvent('booking_worker_completed', {
      route: 'worker', action: 'complete', status: 200,
      attempt: 2, state: 'CONFIRMED', elapsedMs: 1_204, fileCount: 4,
    })).toEqual({
      event: 'booking_worker_completed',
      route: 'worker', action: 'complete', status: 200,
      attempt: 2, state: 'CONFIRMED', elapsedMs: 1_204, fileCount: 4,
    })
  })

  it.each([
    ['unknown field', { route: 'worker', action: 'retry', status: 503, customerName: 'private' }],
    ['evidence byte total', { route: 'worker', action: 'retry', status: 503, totalBytes: 123 }],
    ['request ID', { route: 'worker', action: 'retry', status: 503, requestId: 'request-private' }],
    ['draft ID', { route: 'worker', action: 'retry', status: 503, draftId: 'draft-private' }],
    ['Case ID', { route: 'worker', action: 'retry', status: 503, caseId: 'PMC-202608-0001' }],
    ['URL', { route: 'https://private.example', action: 'retry', status: 503 }],
    ['bearer token', { route: 'worker', action: 'Bearer secret-token', status: 503 }],
    ['nested field', { route: 'worker', action: 'retry', status: 503, detail: { phone: '0812345678' } }],
    ['non-async state', { route: 'worker', action: 'retry', status: 503, state: 'CUSTOMER_WAITING' }],
    ['unsafe timing', { route: 'worker', action: 'retry', status: 503, elapsedMs: -1 }],
    ['NaN timing', { route: 'worker', action: 'retry', status: 503, elapsedMs: Number.NaN }],
    ['event/action mismatch', { route: 'worker', action: 'complete', status: 200 }],
  ])('rejects %s', (_label, fields) => {
    expect(() => asyncBookingEvent('booking_worker_retrying', fields as never)).toThrow('ASYNC_TELEMETRY_INVALID_FIELDS')
  })
})
