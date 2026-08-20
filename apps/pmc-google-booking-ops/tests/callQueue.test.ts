import { describe, expect, it } from 'vitest'
import { parseCallResultFormEvent } from '../src/adapters/googleForms'
import {
  recordCallResult,
  runDailyCallReminders,
  runDailyDoctorSchedules,
  runDepositExpiryReminders,
} from '../src/workflows/callQueue'
import { createTestPorts } from './helpers/fakes'

describe('call queue', () => {
  it('maps the short call-result Form', () => {
    expect(
      parseCallResultFormEvent({
        submittedAt: '2026-08-20T12:00:00+07:00',
        submitterEmail: 'admin@example.com',
        namedValues: {
          'Case ID': ['PMC-202608-0001'],
          ผลการโทร: ['NOT_READY'],
          วันโทรครั้งถัดไป: ['2026-09-10'],
          หมายเหตุ: ['ลูกค้าขอเวลา'],
        },
      }),
    ).toEqual({
      caseId: 'PMC-202608-0001',
      result: 'NOT_READY',
      nextCallAt: '2026-09-10T09:00:00+07:00',
      note: 'ลูกค้าขอเวลา',
      actor: 'admin@example.com',
    })
  })

  it('starts reminders on appointment day and routes to the Admin group plus owner', () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({
      caseId: 'PMC-202608-0001',
      windowStart: '2026-08-20T00:00:00+07:00',
      windowEnd: '2026-08-27T23:59:59+07:00',
      nextCallAt: '2026-08-20T09:00:00+07:00',
    })
    runDailyCallReminders(ports)
    expect(ports.line.adminMessages().map((message) => message.to)).toEqual(['admin-group', 'admin-user-1'])
  })

  it('does not duplicate reminders on the same day', () => {
    const ports = createTestPorts({ now: '2026-08-21T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({ nextCallAt: '2026-08-20T09:00:00+07:00', lastReminderDate: null })
    runDailyCallReminders(ports)
    runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(2)
  })

  it('marks an unfinished first call overdue after Day 7', () => {
    const ports = createTestPorts({ now: '2026-08-28T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({ windowEnd: '2026-08-27T23:59:59+07:00' })
    runDailyCallReminders(ports)
    expect(ports.calls.getOpenByCase('PMC-202608-0001')?.status).toBe('OVERDUE')
  })

  it('suggests but allows overriding the next call date', () => {
    const ports = createTestPorts({ now: '2026-08-20T12:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture()
    const result = recordCallResult(
      {
        caseId: 'PMC-202608-0001',
        result: 'NOT_READY',
        nextCallAt: '2026-09-10T09:00:00+07:00',
        note: '',
        actor: 'admin@example.com',
      },
      ports,
    )
    expect(result.nextCallAt).toBe('2026-09-10T09:00:00+07:00')
  })

  it('sends each doctor only that doctor’s daily schedule', () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    ports.bookings.insert(
      ports.bookingFixture({
        caseId: 'PMC-202608-0001',
        doctorId: 'doctor-1',
        doctorLineGroupId: 'doctor-group-1',
        status: 'BOOKING_CONFIRMED',
      }),
    )
    ports.bookings.insert(
      ports.bookingFixture({
        caseId: 'PMC-202608-0002',
        formResponseId: 'response-2',
        doctorId: 'doctor-2',
        calendarId: 'doctor-calendar-2',
        doctorLineGroupId: 'doctor-group-2',
        status: 'BOOKING_CONFIRMED',
      }),
    )
    runDailyDoctorSchedules(ports)
    expect(ports.line.doctorMessages()).toHaveLength(2)
    expect(ports.line.doctorMessages()[0].caseIds).toEqual(['PMC-202608-0001'])
    expect(ports.line.doctorMessages()[1].caseIds).toEqual(['PMC-202608-0002'])
  })

  it('expires the deposit and cancels open calls when six months end', () => {
    const ports = createTestPorts({ now: '2027-02-21T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture()
    runDepositExpiryReminders(ports)
    expect(ports.bookings.getByCaseId('PMC-202608-0001')?.status).toBe('EXPIRED_6M')
    expect(ports.calls.getOpenByCase('PMC-202608-0001')).toBeNull()
  })
})
