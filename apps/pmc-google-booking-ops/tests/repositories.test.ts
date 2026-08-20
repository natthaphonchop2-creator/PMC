import { describe, expect, it } from 'vitest'
import { encodeSheetCell } from '../src/adapters/googleSheets'
import { createMemoryRepositories, bookingFixture } from './helpers/fakes'

describe('booking repositories', () => {
  it('serializes structured audit values before writing to Sheets', () => {
    expect(encodeSheetCell({ status: 'FORM_SUBMITTED' })).toBe('{"status":"FORM_SUBMITTED"}')
    expect(encodeSheetCell(['PMC-202608-0001'])).toBe('["PMC-202608-0001"]')
  })

  it('allocates case sequences atomically per month', () => {
    const repos = createMemoryRepositories()
    expect(repos.bookings.allocateMonthlySequence('2026-08')).toBe(1)
    expect(repos.bookings.allocateMonthlySequence('2026-08')).toBe(2)
    expect(repos.bookings.allocateMonthlySequence('2026-09')).toBe(1)
  })

  it('prevents duplicate Form response processing', () => {
    const repos = createMemoryRepositories()
    repos.bookings.rememberFormResponse('response-1', 'PMC-202608-0001')
    expect(() => repos.bookings.rememberFormResponse('response-1', 'PMC-202608-0002')).toThrow(
      'form response already processed',
    )
  })

  it('rejects stale updates and appends a before-after audit event', () => {
    const repos = createMemoryRepositories()
    const booking = repos.bookings.insert(bookingFixture())
    repos.bookings.update(
      booking.caseId,
      1,
      { status: 'TIME_CONFLICT' },
      { actor: 'admin@example.com', reason: 'calendar overlap', correlationId: 'run-1' },
    )

    expect(() =>
      repos.bookings.update(
        booking.caseId,
        1,
        { status: 'BOOKING_CONFIRMED' },
        { actor: 'admin@example.com', reason: 'stale update', correlationId: 'run-2' },
      ),
    ).toThrow('version conflict')
    expect(repos.audit.listForCase(booking.caseId)).toHaveLength(1)
  })
})
