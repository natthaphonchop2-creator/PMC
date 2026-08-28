import { describe, expect, it } from 'vitest'
import { encodeSheetCell } from '../src/adapters/googleSheets'
import { createBookingRepositories, type SheetRow, type SheetStore } from '../src/repositories'
import { createMemoryRepositories, bookingFixture } from './helpers/fakes'
import type { BookingRepository, InitialBookingReservation } from '../src/ports'

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
      append: (tab, rows) => tabs.set(tab, [...(tabs.get(tab) ?? []), ...structuredClone(rows)]),
      update: (tab, rowIndex, row) => {
        const rows = [...(tabs.get(tab) ?? [])]
        rows[rowIndex] = structuredClone(row)
        tabs.set(tab, rows)
      },
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
      append: (tab, rows) => tabs.set(tab, [...(tabs.get(tab) ?? []), ...structuredClone(rows)]),
      update: (tab, rowIndex, row) => {
        const rows = [...(tabs.get(tab) ?? [])]
        rows[rowIndex] = structuredClone(row)
        tabs.set(tab, rows)
      },
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

  it('reserves sequence, booking, exact form mapping, and creation audit inside one lock', () => {
    const fixture = reservationFixture()
    const result = fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1'))

    expect(result).toMatchObject({ created: true, booking: { caseId: 'PMC-202608-0001' } })
    expect(fixture.lockCalls()).toBe(1)
    expect(fixture.store.read('SYSTEM_SEQUENCES')).toEqual([{ month: '2026-08', sequence: 1 }])
    expect(fixture.store.read('BOOKING_MASTER')).toHaveLength(1)
    expect(fixture.store.read('FORM_RESPONSE_MAP')).toEqual([{
      formResponseId: 'mini:v2:cmVxdWVzdC0x:payload-hash-1', caseId: 'PMC-202608-0001',
    }])
    expect(fixture.store.read('AUDIT_LOG')).toEqual([expect.objectContaining({
      eventId: 'AUDIT-mini:v2:cmVxdWVzdC0x:payload-hash-1-1', caseId: 'PMC-202608-0001',
      action: 'BOOKING_CREATED',
    })])
  })

  it('makes interleaved same-hash reservations converge to one Case and one creation audit', () => {
    const fixture = reservationFixture()
    let second: ReturnType<BookingRepository['reserveInitialBooking']> | null = null
    fixture.interleave(() => { second = fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1')) })

    const first = fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1'))

    expect(first.booking.caseId).toBe(second!.booking.caseId)
    expect(first.created).toBe(false)
    expect(second!.created).toBe(true)
    expect(fixture.store.read('BOOKING_MASTER')).toHaveLength(1)
    expect(fixture.store.read('FORM_RESPONSE_MAP')).toHaveLength(1)
    expect(fixture.store.read('AUDIT_LOG')).toHaveLength(1)
  })

  it('recognizes the exact creation audit after structured cells round-trip through Sheets strings', () => {
    const fixture = reservationFixture()
    fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1'))
    const storedAudit = fixture.store.read('AUDIT_LOG')[0]!
    fixture.store.replace('AUDIT_LOG', [{ ...storedAudit, before: '', after: JSON.stringify(storedAudit.after) }])

    expect(fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1')))
      .toMatchObject({ created: false, booking: { caseId: 'PMC-202608-0001' } })
  })

  it('fails closed when interleaved reservations share a request prefix but bind different hashes', () => {
    const fixture = reservationFixture()
    fixture.interleave(() => { fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-2')) })

    expect(() => fixture.repos.bookings.reserveInitialBooking(reservationInput('payload-hash-1')))
      .toThrow('form response collision')
    expect(fixture.store.read('BOOKING_MASTER')).toHaveLength(1)
    expect(fixture.store.read('FORM_RESPONSE_MAP')).toHaveLength(1)
    expect(fixture.store.read('AUDIT_LOG')).toHaveLength(1)
  })
})

function reservationFixture() {
  const tabs = new Map<string, SheetRow[]>()
  const store: SheetStore = {
    read: (tab) => structuredClone(tabs.get(tab) ?? []),
    replace: (tab, rows) => tabs.set(tab, structuredClone(rows)),
    append: (tab, rows) => tabs.set(tab, [...(tabs.get(tab) ?? []), ...structuredClone(rows)]),
    update: (tab, rowIndex, row) => {
      const rows = [...(tabs.get(tab) ?? [])]
      rows[rowIndex] = structuredClone(row)
      tabs.set(tab, rows)
    },
  }
  let lockCount = 0
  let interleaved: (() => void) | null = null
  const repos = createBookingRepositories(store, {
    withLock(operation) {
      lockCount += 1
      const pending = interleaved
      interleaved = null
      pending?.()
      return operation()
    },
  }, { nowIso: () => '2026-08-20T09:00:00+07:00' })
  return {
    repos, store,
    lockCalls: () => lockCount,
    interleave(operation: () => void) { interleaved = operation },
  }
}

function reservationInput(payloadHash: string): InitialBookingReservation {
  const formResponseId = `mini:v2:cmVxdWVzdC0x:${payloadHash}`
  return {
    month: '2026-08', formResponseId,
    collisionPrefix: 'mini:v2:cmVxdWVzdC0x:', conflictingFormResponseIds: ['mini:request-1'],
    createBooking(sequence) {
      return bookingFixture({ caseId: `PMC-202608-${String(sequence).padStart(4, '0')}`, formResponseId })
    },
    createAudit(booking) {
      return {
        eventId: `AUDIT-${formResponseId}-1`, caseId: booking.caseId, actor: 'admin@example.com',
        action: 'BOOKING_CREATED', target: 'BOOKING_MASTER', before: null,
        after: { status: booking.status, adminId: booking.adminId, aeId: booking.aeId },
        reason: 'Google Form submission', timestamp: '2026-08-20T09:00:00+07:00', correlationId: formResponseId,
      }
    },
  }
}
