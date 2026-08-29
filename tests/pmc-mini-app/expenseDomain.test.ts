import { describe, expect, it } from 'vitest'
import {
  deriveBookDailyKey,
  deriveExpenseScope,
  effectiveCommittedExpenses,
  parseExpenseDate,
  projectMonthlyExpenses,
  type ExpenseSubmission,
} from '../../shared/pmcExpense'

const row = (patch: Partial<ExpenseSubmission>): ExpenseSubmission => ({
  expenseId: 'EXP-202608-1', expenseDate: '2026-08-29', monthKey: '2026-08',
  category: 'BOOK_CLINIC', scope: 'CLINIC', amountSatang: 10_000,
  counterpartyName: null, description: '', paymentMethod: null,
  recordState: 'COMMITTED', bookDailyKey: 'CLINIC:2026-08-29', revision: 1,
  supersedesExpenseId: null, submittedByStaffId: 'ADMIN_01', submittedByName: 'มัส',
  submittedAt: '2026-08-29T10:00:00+07:00', committedAt: '2026-08-29T10:01:00+07:00',
  updatedAt: '2026-08-29T10:01:00+07:00', version: 2, idempotencyKey: 'expense-request-1',
  ...patch,
})

describe('PMC expense domain', () => {
  it('derives scope and month on the Bangkok calendar', () => {
    expect(parseExpenseDate('2026-08-29')).toEqual({ expenseDate: '2026-08-29', monthKey: '2026-08' })
    expect(deriveExpenseScope('BOOK_DOCTOR_PERSONAL')).toBe('DOCTOR_PERSONAL')
    expect(deriveExpenseScope('BILL_DOCUMENT')).toBe('CLINIC')
    expect(deriveBookDailyKey('BOOK_CLINIC', '2026-08-29')).toBe('CLINIC:2026-08-29')
  })

  it('rejects invalid calendar dates and invalid calendar months', () => {
    expect(() => parseExpenseDate('2026-02-29')).toThrow('EXPENSE_INVALID_DATE')
    expect(() => projectMonthlyExpenses([], '2026-13')).toThrow('EXPENSE_INVALID_MONTH')
    expect(() => projectMonthlyExpenses([], '2026-00')).toThrow('EXPENSE_INVALID_MONTH')
  })

  it('counts only the latest effective committed book revision', () => {
    const first = row({ expenseId: 'EXP-1', amountSatang: 10_000 })
    const replacement = row({ expenseId: 'EXP-2', amountSatang: 12_000, revision: 2, supersedesExpenseId: 'EXP-1' })
    const prepared = row({ expenseId: 'EXP-3', category: 'BILL_DOCUMENT', bookDailyKey: null, recordState: 'PREPARED', amountSatang: 99_000 })
    expect(effectiveCommittedExpenses([first, replacement, prepared]).map(({ expenseId }) => expenseId)).toEqual(['EXP-2'])
    expect(projectMonthlyExpenses([first, replacement, prepared], '2026-08')).toMatchObject({
      clinicCommittedSatang: 12_000,
      doctorPersonalCommittedSatang: 0,
      unreviewed: true,
    })
  })

  it('does not resurrect a superseded revision when the latest replacement is voided', () => {
    const first = row({ expenseId: 'EXP-1', amountSatang: 10_000 })
    const voidedReplacement = row({
      expenseId: 'EXP-2', amountSatang: 12_000, revision: 2,
      supersedesExpenseId: 'EXP-1', recordState: 'VOID',
    })
    expect(effectiveCommittedExpenses([first, voidedReplacement])).toEqual([])
  })

  it('keeps doctor-personal spend out of clinic totals and excludes incomplete rows', () => {
    const clinic = row({ expenseId: 'EXP-1', category: 'BILL_DOCUMENT', bookDailyKey: null, amountSatang: 10_000 })
    const personal = row({
      expenseId: 'EXP-2', category: 'BOOK_DOCTOR_PERSONAL', scope: 'DOCTOR_PERSONAL',
      bookDailyKey: 'DOCTOR_PERSONAL:2026-08-29', amountSatang: 8_000,
    })
    const invalidAmount = row({ expenseId: 'EXP-3', amountSatang: 0 })
    const invalidMonth = row({ expenseId: 'EXP-4', expenseDate: '2026-08-30', monthKey: '2026-13' })

    expect(projectMonthlyExpenses([clinic, personal, invalidAmount, invalidMonth], '2026-08')).toEqual({
      monthKey: '2026-08',
      clinicCommittedSatang: 10_000,
      doctorPersonalCommittedSatang: 8_000,
      clinicByCategorySatang: { BILL_DOCUMENT: 10_000, BOOK_CLINIC: 0 },
      effectiveExpenseCount: 2,
      unreviewed: true,
    })
  })

  it('rejects aggregate totals outside safe integer satang', () => {
    const first = row({ expenseId: 'EXP-1', amountSatang: Number.MAX_SAFE_INTEGER })
    const second = row({ expenseId: 'EXP-2', category: 'BILL_DOCUMENT', bookDailyKey: null, amountSatang: 1 })

    expect(() => projectMonthlyExpenses([first, second], '2026-08')).toThrow('EXPENSE_INVALID_AMOUNT')
  })
})
