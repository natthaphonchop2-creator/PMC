import { describe, expect, it } from 'vitest'
import { calendarEventInput } from '../src/adapters/googleCalendar'
import { bookingFixture, createTestPorts } from './helpers/fakes'

describe('provisional Calendar presentation', () => {
  it('renders a gray tentative event with private appointment metadata', () => {
    expect(calendarEventInput(bookingFixture({
      appointmentStatus: 'TENTATIVE',
      calendarId: 'doctor-calendar-1',
      appointmentStart: '2026-08-25T14:00:00+07:00',
      appointmentEnd: '2026-08-25T15:00:00+07:00',
    }))).toMatchObject({
      colorId: '8',
      summary: 'รอยืนยัน | doctor-1 | service-1 | ลูกค้าทดสอบ',
      privateProperties: {
        caseId: 'PMC-202608-0001',
        doctorId: 'doctor-1',
        appointmentStatus: 'TENTATIVE',
      },
    })
  })

  it('renders confirmed events in color 5 without a tentative prefix', () => {
    const input = calendarEventInput(bookingFixture({
      appointmentStatus: 'CONFIRMED',
      calendarId: 'doctor-calendar-1',
    }))
    expect(input.colorId).toBe('5')
    expect(input.summary).not.toContain('รอยืนยัน |')
    expect(input.privateProperties.appointmentStatus).toBe('CONFIRMED')
  })

  it('exposes busy intervals and a recoverable missing update result', () => {
    const ports = createTestPorts({
      calendarEvents: [
        { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
      ],
      calendarUpdateResult: 'NOT_FOUND',
    })
    expect(ports.calendar.listEvents(
      'doctor-calendar-1',
      '2026-08-25T00:00:00+07:00',
      '2026-08-26T00:00:00+07:00',
    )).toEqual([
      { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
    ])
    expect(ports.calendar.updateEvent('missing-event', inputFixture())).toBe('NOT_FOUND')
  })
})

function inputFixture() {
  return calendarEventInput(bookingFixture({ calendarId: 'doctor-calendar-1' }))
}
