import { describe, expect, it } from 'vitest'
import { requireAppointment } from '../src/domain/appointment'
import { bookingFixture } from './helpers/fakes'

describe('appointment guard', () => {
  it('returns confirmed timestamps and rejects an awaiting-slot booking', () => {
    expect(requireAppointment(bookingFixture())).toEqual({
      start: '2026-08-20T13:00:00+07:00',
      end: '2026-08-20T14:00:00+07:00',
    })
    expect(() => requireAppointment(bookingFixture({
      appointmentStatus: 'AWAITING_ADMIN_SLOT',
      appointmentStart: null,
      appointmentEnd: null,
    }))).toThrow('booking has no appointment')
  })
})
