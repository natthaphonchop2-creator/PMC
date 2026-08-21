import { describe, expect, it } from 'vitest'
import { encodeSheetCell } from '../src/adapters/googleSheets'
import { createBookingRepositories, type SheetRow, type SheetStore } from '../src/repositories'
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

  it('continues after a month coerced to a Sheet date and an existing case ID', () => {
    const tabs = new Map<string, SheetRow[]>([
      ['SYSTEM_SEQUENCES', [{ month: new Date('2026-07-31T17:00:00.000Z'), sequence: 1 }]],
      ['BOOKING_MASTER', [{ caseId: 'PMC-202608-0001' }]],
    ])
    const store: SheetStore = {
      read: (tab) => structuredClone(tabs.get(tab) ?? []),
      replace: (tab, rows) => tabs.set(tab, structuredClone(rows)),
    }
    const repos = createBookingRepositories(
      store,
      { withLock: (operation) => operation() },
      { nowIso: () => '2026-08-21T12:00:00+07:00' },
    )

    expect(repos.bookings.allocateMonthlySequence('2026-08')).toBe(2)
    expect(store.read('SYSTEM_SEQUENCES')).toEqual([{ month: '2026-08', sequence: 2 }])
  })

  it('restores the leading zero when Sheets coerces a Thai phone to a number', () => {
    const fixture = bookingFixture()
    const tabs = new Map<string, SheetRow[]>([
      ['BOOKING_MASTER', [{ ...fixture, phoneNormalized: 812345678 }]],
    ])
    const store: SheetStore = {
      read: (tab) => structuredClone(tabs.get(tab) ?? []),
      replace: (tab, rows) => tabs.set(tab, structuredClone(rows)),
    }
    const repos = createBookingRepositories(
      store,
      { withLock: (operation) => operation() },
      { nowIso: () => '2026-08-21T12:00:00+07:00' },
    )

    expect(repos.bookings.getByCaseId(fixture.caseId)?.phoneNormalized).toBe('0812345678')
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
