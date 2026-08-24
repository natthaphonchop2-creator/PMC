import { describe, expect, it } from 'vitest'
import type { QueueConfirmationInput } from '../src/domain/queueConfirmation'
import type { BookingCase } from '../src/domain/types'
import { confirmQueue } from '../src/workflows/queueConfirmation'
import { bookingFixture, createTestPorts } from './helpers/fakes'

function tentativeBookingFixture(): BookingCase {
  return bookingFixture({
    status: 'BOOKING_CONFIRMED',
    queueType: 'AUTO',
    appointmentStatus: 'TENTATIVE',
    appointmentStart: '2026-08-25T14:00:00+07:00',
    appointmentEnd: '2026-08-25T15:00:00+07:00',
    appointmentConfirmedAt: null,
    appointmentConfirmedBy: null,
    calendarId: 'doctor-calendar-1',
    calendarEventId: 'tentative-event-1',
    doctorLineGroupId: 'doctor-group-1',
    doctorLineNotifiedAt: null,
    firstCallWindowStart: null,
    firstCallWindowEnd: null,
    nextCallAt: null,
  })
}

function validQueueConfirmation(): QueueConfirmationInput {
  return {
    caseId: 'PMC-202608-0001',
    action: 'CONFIRM',
    appointmentDate: '2026-08-25',
    appointmentTime: '14:00',
    actorEmail: 'staff.personal@gmail.com',
    submittedAt: '2026-08-24T12:00:00+07:00',
  }
}

describe('queue confirmation workflow', () => {
  it('updates the same event and starts doctor and call workflows once', () => {
    const ports = createTestPorts()
    ports.bookings.insert(tentativeBookingFixture())

    const first = confirmQueue(validQueueConfirmation(), ports)
    const second = confirmQueue(validQueueConfirmation(), ports)

    expect(first.appointmentStatus).toBe('CONFIRMED')
    expect(second.calendarEventId).toBe(first.calendarEventId)
    expect(ports.calendar.createdEvents()).toHaveLength(0)
    expect(ports.calendar.updatedEvents()).toHaveLength(1)
    expect(ports.calendar.updatedEvents()[0].input.colorId).toBe('5')
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.calls.list()).toHaveLength(1)
    expect(first.appointmentConfirmedBy).toBe('staff.personal@gmail.com')
    expect(first.firstCallWindowStart).toBe('2026-08-25T00:00:00+07:00')
  })

  it('recreates one deterministic confirmed event when the tentative event was deleted', () => {
    const ports = createTestPorts({ calendarUpdateResult: 'NOT_FOUND' })
    ports.bookings.insert(tentativeBookingFixture())

    const confirmed = confirmQueue(validQueueConfirmation(), ports)

    expect(confirmed.appointmentStatus).toBe('CONFIRMED')
    expect(ports.calendar.updatedEvents()).toHaveLength(1)
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.calendar.createdEvents()[0].externalId).toBe(
      'PMC-202608-0001:response-1:confirmed-recovery',
    )
  })

  it('accepts a replacement date from any collected Admin email', () => {
    const ports = createTestPorts()
    ports.bookings.insert(tentativeBookingFixture())
    const result = confirmQueue({
      ...validQueueConfirmation(),
      action: 'CHANGE',
      appointmentDate: '2026-08-26',
      appointmentTime: '15:30',
      actorEmail: 'another.admin@gmail.com',
    }, ports)
    expect(result).toMatchObject({
      appointmentStart: '2026-08-26T15:30:00+07:00',
      appointmentEnd: '2026-08-26T16:30:00+07:00',
      appointmentConfirmedBy: 'another.admin@gmail.com',
    })
  })
})
