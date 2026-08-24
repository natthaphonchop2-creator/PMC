import { describe, expect, it } from 'vitest'
import { isCalendarAtCapacity } from '../src/adapters/googleCalendar'

const timed = (id: string) => ({
  id,
  start: { dateTime: '2026-08-23T14:00:00+07:00' },
  end: { dateTime: '2026-08-23T15:00:00+07:00' },
})

describe('doctor Calendar capacity', () => {
  it('allows a second overlapping case in the same hour', () => {
    expect(isCalendarAtCapacity([timed('existing-1')], null)).toBe(false)
  })

  it('blocks a third overlapping case in the same hour', () => {
    expect(isCalendarAtCapacity([timed('existing-1'), timed('existing-2')], null)).toBe(true)
  })

  it('ignores the event being rescheduled and all-day entries', () => {
    expect(isCalendarAtCapacity([
      timed('current-event'),
      timed('existing-1'),
      { id: 'all-day', start: {}, end: {} },
    ], 'current-event')).toBe(false)
  })
})
