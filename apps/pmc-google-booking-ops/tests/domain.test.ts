import { describe, expect, it } from 'vitest'
import { formatCaseId } from '../src/domain/caseId'
import { addCalendarMonths, deriveCallWindow } from '../src/domain/callSchedule'
import { maskThaiPhone, normalizeCustomerName, normalizeThaiPhone } from '../src/domain/normalize'
import { transitionBooking } from '../src/domain/stateMachine'

describe('booking domain', () => {
  it('normalizes and masks a Thai mobile number', () => {
    expect(normalizeThaiPhone('+66 81-234-5678')).toBe('0812345678')
    expect(maskThaiPhone('0812345678')).toBe('081-xxx-5678')
  })

  it('normalizes a customer name without losing Thai characters', () => {
    expect(normalizeCustomerName(' สม หญิง  ใจดี ')).toBe('สมหญิงใจดี')
  })

  it('formats an atomic monthly case sequence', () => {
    expect(formatCaseId('2026-08-20T09:00:00+07:00', 12)).toBe('PMC-202608-0012')
  })

  it('adds six calendar months instead of 180 days', () => {
    expect(addCalendarMonths('2026-08-31T10:00:00+07:00', 6)).toBe('2027-02-28T10:00:00+07:00')
  })

  it('opens the first-call window on appointment day and ends after day 7', () => {
    expect(deriveCallWindow('2026-08-20T13:00:00+07:00')).toEqual({
      start: '2026-08-20T00:00:00+07:00',
      end: '2026-08-27T23:59:59+07:00',
    })
  })

  it('rejects Google-only closure without qualifying JERA evidence', () => {
    expect(() => transitionBooking('BOOKING_CONFIRMED', 'CLOSED_JERA', { jeraStatus: null })).toThrow(
      'CLOSED_JERA requires JERA status ชำระแล้ว',
    )
  })
})
