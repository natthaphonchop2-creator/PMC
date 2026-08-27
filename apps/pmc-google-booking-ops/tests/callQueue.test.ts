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

  it('starts a Flex reminder one day before the scheduled call and routes only to the Admin group', () => {
    const ports = createTestPorts({ now: '2026-08-19T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({
      caseId: 'PMC-202608-0001',
      windowStart: '2026-08-20T00:00:00+07:00',
      windowEnd: '2026-08-26T23:59:59+07:00',
      nextCallAt: '2026-08-20T09:00:00+07:00',
    })
    runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(1)
    const [message] = ports.line.adminMessages()
    expect(message.to).toBe('admin-group')
    const carousel = message.apiMessage?.contents as { contents: Array<Record<string, unknown>> }
    const bubble = carousel.contents[0] as {
      header: Record<string, unknown>
      body: Record<string, unknown>
      footer: { contents: Array<Record<string, unknown>> }
    }
    expect(JSON.stringify(bubble.header)).toContain('แจ้งเตือนโทรติดตาม')
    const bodyJson = JSON.stringify(bubble.body)
    expect(bodyJson).toContain('☎')
    expect(bodyJson.match(/พรุ่งนี้ต้องโทร/g)).toHaveLength(1)
    expect(bodyJson).toContain('เวลาโทร')
    expect(bodyJson).toContain('เบอร์โทร')
    expect(bodyJson).toContain('โปรแกรม')
    expect(bodyJson).toContain('Admin')
    expect(bodyJson).not.toContain('Facebook:')
    expect(bodyJson).not.toContain('นัดหมาย')
    expect(bubble.footer.contents[0]).toMatchObject({ type: 'box', layout: 'horizontal' })
    const buttonRow = bubble.footer.contents[0] as { contents: Array<Record<string, unknown>> }
    expect(buttonRow.contents).toMatchObject([
      { type: 'button', style: 'secondary' },
      { type: 'button', style: 'secondary' },
    ])
    expect(JSON.stringify(bubble.footer)).toContain('PMC Call Queue')
    expect(JSON.stringify(message.apiMessage)).toContain('tel:0812345678')
    expect(JSON.stringify(message.apiMessage)).toContain(
      'https://docs.google.com/forms/d/e/test/viewform?case=PMC-202608-0001',
    )
    expect(JSON.stringify(message.apiMessage)).toContain(
      'https://docs.google.com/spreadsheets/d/test/edit#gid=CALL_QUEUE',
    )
  })

  it('routes reminders only to the Admin group even when the owner has a direct LINE mapping', () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({ nextCallAt: '2026-08-20T09:00:00+07:00' })

    runDailyCallReminders(ports)

    expect(ports.line.adminMessages().map((message) => message.to)).toEqual(['admin-group'])
  })

  it('does not duplicate reminders on the same day', () => {
    const ports = createTestPorts({ now: '2026-08-21T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({ nextCallAt: '2026-08-20T09:00:00+07:00', lastReminderDate: null })
    runDailyCallReminders(ports)
    runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(1)
  })

  it('marks an unfinished call overdue on Day 8', () => {
    const ports = createTestPorts({ now: '2026-08-27T09:00:00+07:00' })
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture({ windowEnd: '2026-08-26T23:59:59+07:00' })
    runDailyCallReminders(ports)
    expect(ports.calls.getOpenByCase('PMC-202608-0001')?.status).toBe('OVERDUE')
    expect(JSON.stringify(ports.line.adminMessages()[0].apiMessage)).toContain('เกินกำหนด 1 วัน')
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
    expect(result.windowEnd).toBe('2026-09-16T23:59:59+07:00')
  })

  it('rejects a call result from an email that is not an active Admin', () => {
    const ports = createTestPorts()
    ports.bookings.insert(ports.bookingFixture())
    ports.calls.insertFixture()

    expect(() => recordCallResult({
      caseId: 'PMC-202608-0001',
      result: 'NOT_READY',
      nextCallAt: null,
      note: '',
      actor: 'outside@example.com',
    }, ports)).toThrow('call result actor is not an active Admin')
    expect(ports.calls.getOpenByCase('PMC-202608-0001')?.status).toBe('PENDING')
  })

  it('batches at most ten customers in one Carousel and links to the remaining queue', () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    for (let index = 1; index <= 12; index += 1) {
      const suffix = String(index).padStart(4, '0')
      const caseId = `PMC-202608-${suffix}`
      ports.bookings.insert(ports.bookingFixture({
        caseId,
        formResponseId: `response-${index}`,
        customerName: `ลูกค้า ${index}`,
        phoneNormalized: `081234${String(5600 + index)}`,
      }))
      ports.calls.insertFixture({
        taskId: `CALL-${caseId}-1`,
        caseId,
        nextCallAt: '2026-08-20T09:00:00+07:00',
      })
    }

    runDailyCallReminders(ports)

    expect(ports.line.adminMessages()).toHaveLength(1)
    const [message] = ports.line.adminMessages()
    expect(message.caseIds).toHaveLength(12)
    expect(message.apiMessage?.contents).toMatchObject({ type: 'carousel' })
    const bubbles = (message.apiMessage?.contents as { contents: unknown[] }).contents
    expect(bubbles).toHaveLength(11)
    expect(JSON.stringify(message.apiMessage)).toContain('ดูเพิ่มเติมอีก 2 ราย')
    expect(JSON.stringify(message.apiMessage)).toContain(
      'https://docs.google.com/spreadsheets/d/test/edit#gid=CALL_QUEUE',
    )
    expect(JSON.stringify(message.apiMessage).length).toBeLessThan(50_000)
    expect(ports.calls.list().every((task) => task.lastReminderDate === '2026-08-20')).toBe(true)
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
