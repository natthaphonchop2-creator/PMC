import { describe, expect, it } from 'vitest'
import type { BookingCase } from '../src/domain/types'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { bookingFixture, createTestPorts, validBookingIntake } from './helpers/fakes'

function confirmedDoctorCaseFor(date: string, doctorId: string): BookingCase {
  return bookingFixture({
    caseId: 'PMC-202608-0009',
    formResponseId: 'existing-doctor-case',
    doctorId,
    appointmentStatus: 'CONFIRMED',
    appointmentStart: `${date}T13:00:00+07:00`,
    appointmentEnd: `${date}T14:00:00+07:00`,
    calendarId: 'doctor-calendar-1',
    calendarEventId: 'existing-event-0009',
  })
}

describe('automatic queue submission workflow', () => {
  it('creates a paid tentative booking but no doctor message or call task', () => {
    const ports = createTestPorts({
      calendarEvents: [
        { start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' },
      ],
    })
    ports.bookings.insert(confirmedDoctorCaseFor('2026-08-25', 'doctor-1'))

    const result = submitBookingIntake(validBookingIntake({
      queueType: 'AUTO',
      appointmentDate: null,
      appointmentTime: null,
    }), ports)

    expect(result).toMatchObject({
      status: 'BOOKING_CONFIRMED',
      appointmentStatus: 'TENTATIVE',
      appointmentStart: '2026-08-25T14:00:00+07:00',
      appointmentEnd: '2026-08-25T15:00:00+07:00',
      calendarState: 'OK',
    })
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.calendar.createdEvents()[0].colorId).toBe('8')
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[0])).toContain('คิวชั่วคราว')
    expect(ports.line.doctorMessages()).toEqual([])
    expect(ports.calls.list()).toEqual([])
  })

  it('keeps the paid booking and awaits Admin when no candidate exists', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake({
      queueType: 'AUTO',
      appointmentDate: null,
      appointmentTime: null,
    }), ports)

    expect(result).toMatchObject({
      status: 'BOOKING_CONFIRMED',
      appointmentStatus: 'AWAITING_ADMIN_SLOT',
      appointmentStart: null,
      appointmentEnd: null,
      calendarEventId: null,
    })
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[0])).toContain('รอ Admin เลือกวัน')
    expect(ports.line.doctorMessages()).toEqual([])
    expect(ports.calls.list()).toEqual([])
  })
})
