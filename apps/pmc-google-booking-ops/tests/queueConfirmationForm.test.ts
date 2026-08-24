import { describe, expect, it } from 'vitest'
import { parseQueueConfirmationFormEvent } from '../src/domain/queueConfirmation'

describe('queue confirmation Form parser', () => {
  it('parses any Admin confirmation email and a prefilled proposal', () => {
    expect(parseQueueConfirmationFormEvent({
      submittedAt: '2026-08-24T12:00:00+07:00',
      submitterEmail: 'Staff.Personal@gmail.com',
      namedValues: {
        'Case ID': ['PMC-202608-0001'],
        การดำเนินการ: ['ยืนยันคิวนี้'],
        วันที่ยืนยัน: ['2026-08-25'],
        เวลายืนยัน: ['14:00'],
      },
    })).toEqual({
      caseId: 'PMC-202608-0001',
      action: 'CONFIRM',
      appointmentDate: '2026-08-25',
      appointmentTime: '14:00',
      actorEmail: 'staff.personal@gmail.com',
      submittedAt: '2026-08-24T12:00:00+07:00',
    })
  })

  it('maps a replacement appointment to CHANGE', () => {
    expect(parseQueueConfirmationFormEvent({
      submittedAt: '2026-08-24T12:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        'Case ID': ['PMC-202608-0001'],
        การดำเนินการ: ['เปลี่ยนวัน'],
        วันที่ยืนยัน: ['2026-08-26'],
        เวลายืนยัน: ['15:30'],
      },
    }).action).toBe('CHANGE')
  })

  it('rejects invalid identity or appointment values', () => {
    const base = {
      submittedAt: '2026-08-24T12:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        'Case ID': ['bad-case'],
        การดำเนินการ: ['ยืนยันคิวนี้'],
        วันที่ยืนยัน: ['2026-08-25'],
        เวลายืนยัน: ['14:00'],
      },
    }
    expect(() => parseQueueConfirmationFormEvent(base)).toThrow('invalid confirmation Case ID')
    expect(() => parseQueueConfirmationFormEvent({
      ...base,
      namedValues: { ...base.namedValues, 'Case ID': ['PMC-202608-0001'], เวลายืนยัน: ['25:00'] },
    })).toThrow('invalid confirmation appointment')
  })
})
