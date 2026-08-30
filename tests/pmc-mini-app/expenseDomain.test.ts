import { describe, expect, it } from 'vitest'
import {
  deriveBookDailyKey,
  deriveExpenseScope,
  effectiveCommittedExpenses,
  parseExpenseDate,
  projectMonthlyExpenses,
  validateExpenseLedger,
  type ExpenseSubmission,
} from '../../shared/pmcExpense'

const row = (patch: Partial<ExpenseSubmission>): ExpenseSubmission => {
  const category = patch.category ?? 'BOOK_CLINIC'
  const recordState = patch.recordState ?? 'COMMITTED'
  return {
    expenseId: 'EXP-202608-0001', expenseDate: '2026-08-29', monthKey: '2026-08',
    category, scope: deriveExpenseScope(category), amountSatang: 10_000,
    counterpartyName: category === 'BILL_DOCUMENT' ? 'ร้านทดสอบ' : null,
    description: '', paymentMethod: category === 'BILL_DOCUMENT' ? 'CASH' : null,
    recordState, bookDailyKey: deriveBookDailyKey(category, '2026-08-29'), revision: 1,
    supersedesExpenseId: null, submittedByStaffId: 'ADMIN_01', submittedByName: 'มัส',
    submittedAt: '2026-08-29T10:00:00+07:00',
    committedAt: recordState === 'PREPARED' ? null : '2026-08-29T10:01:00+07:00',
    updatedAt: recordState === 'VOID' ? '2026-08-29T10:02:00+07:00' : '2026-08-29T10:01:00+07:00',
    version: recordState === 'PREPARED' ? 1 : recordState === 'VOID' ? 3 : 2,
    idempotencyKey: 'expense-request-1',
    ...patch,
  }
}

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
    const first = row({ expenseId: 'EXP-202608-0001', amountSatang: 10_000 })
    const replacement = row({
      expenseId: 'EXP-202608-0002', amountSatang: 12_000, revision: 2,
      supersedesExpenseId: 'EXP-202608-0001',
      submittedAt: '2026-08-29T10:02:00+07:00', committedAt: '2026-08-29T10:03:00+07:00',
      updatedAt: '2026-08-29T10:03:00+07:00',
    })
    const prepared = row({
      expenseId: 'EXP-202608-0003', category: 'BILL_DOCUMENT', bookDailyKey: null,
      recordState: 'PREPARED', amountSatang: 99_000,
    })
    expect(effectiveCommittedExpenses([first, replacement, prepared]).map(({ expenseId }) => expenseId))
      .toEqual(['EXP-202608-0002'])
    expect(projectMonthlyExpenses([first, replacement, prepared], '2026-08')).toMatchObject({
      clinicCommittedSatang: 12_000,
      doctorPersonalCommittedSatang: 0,
      unreviewed: true,
    })
  })

  it('does not resurrect a superseded revision when the latest replacement is voided', () => {
    const first = row({ expenseId: 'EXP-202608-0001', amountSatang: 10_000 })
    const voidedReplacement = row({
      expenseId: 'EXP-202608-0002', amountSatang: 12_000, revision: 2,
      supersedesExpenseId: 'EXP-202608-0001', recordState: 'VOID',
      submittedAt: '2026-08-29T10:02:00+07:00', committedAt: '2026-08-29T10:03:00+07:00',
      updatedAt: '2026-08-29T10:04:00+07:00',
    })
    expect(effectiveCommittedExpenses([first, voidedReplacement])).toEqual([])
  })

  it('keeps doctor-personal spend out of clinic totals', () => {
    const clinic = row({ expenseId: 'EXP-202608-0001', category: 'BILL_DOCUMENT', bookDailyKey: null, amountSatang: 10_000 })
    const personal = row({
      expenseId: 'EXP-202608-0002', category: 'BOOK_DOCTOR_PERSONAL', scope: 'DOCTOR_PERSONAL',
      bookDailyKey: 'DOCTOR_PERSONAL:2026-08-29', amountSatang: 8_000,
    })

    expect(projectMonthlyExpenses([clinic, personal], '2026-08')).toEqual({
      monthKey: '2026-08',
      clinicCommittedSatang: 10_000,
      doctorPersonalCommittedSatang: 8_000,
      clinicByCategorySatang: { BILL_DOCUMENT: 10_000, BOOK_CLINIC: 0 },
      effectiveExpenseCount: 2,
      unreviewed: true,
    })
  })

  it.each([
    ['duplicate expense IDs', [row({ expenseId: 'EXP-202608-DUP-1' }), row({ expenseId: 'EXP-202608-DUP-1', idempotencyKey: 'expense-request-2' })]],
    ['PREPARED tombstone', [
      row({ expenseId: 'EXP-202608-CHAIN-1' }),
      row({
        expenseId: 'EXP-202608-CHAIN-2', recordState: 'PREPARED', version: 1, committedAt: null,
        revision: 2, supersedesExpenseId: 'EXP-202608-CHAIN-1', idempotencyKey: 'expense-request-2',
      }),
    ]],
    ['cross-scope tombstone', [
      row({ expenseId: 'EXP-202608-CHAIN-1' }),
      row({
        expenseId: 'EXP-202608-CHAIN-2', category: 'BOOK_DOCTOR_PERSONAL', scope: 'DOCTOR_PERSONAL',
        bookDailyKey: 'DOCTOR_PERSONAL:2026-08-29', revision: 2,
        supersedesExpenseId: 'EXP-202608-CHAIN-1', idempotencyKey: 'expense-request-2',
      }),
    ]],
    ['duplicate book revision', [
      row({ expenseId: 'EXP-202608-CHAIN-1' }),
      row({ expenseId: 'EXP-202608-CHAIN-2', idempotencyKey: 'expense-request-2' }),
    ]],
    ['invalid committed version', [row({ version: 3 })]],
    ['VOID without a prior commit', [row({ recordState: 'VOID', version: 2, committedAt: null })]],
  ])('fails closed for %s', (_case, rows) => {
    expect(() => validateExpenseLedger(rows)).toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
    expect(() => projectMonthlyExpenses(rows, '2026-08')).toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
  })

  it.each([
    ['COMMITTED updatedAt before committedAt', row({
      updatedAt: '2026-08-29T10:00:30+07:00',
      committedAt: '2026-08-29T10:01:00+07:00',
    })],
    ['unsupported BILL_DOCUMENT payment method', row({
      category: 'BILL_DOCUMENT', bookDailyKey: null, counterpartyName: 'ร้านทดสอบ',
      paymentMethod: 'WIRE' as never,
    })],
    ['expense ID month different from monthKey', row({ expenseId: 'EXP-202607-0001' })],
  ])('rejects %s before any shared projection', (_case, invalid) => {
    expect(() => validateExpenseLedger([invalid])).toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
    expect(() => projectMonthlyExpenses([invalid], '2026-08')).toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
  })

  it('accepts a continuous same-book revision chain and retains a valid VOID tombstone without resurrection', () => {
    const first = row({ expenseId: 'EXP-202608-CHAIN-1' })
    const voidedReplacement = row({
      expenseId: 'EXP-202608-CHAIN-2', revision: 2, supersedesExpenseId: 'EXP-202608-CHAIN-1',
      recordState: 'VOID', version: 3, idempotencyKey: 'expense-request-2',
      submittedAt: '2026-08-29T10:02:00+07:00', committedAt: '2026-08-29T10:03:00+07:00',
      updatedAt: '2026-08-29T10:04:00+07:00',
    })

    expect(validateExpenseLedger([first, voidedReplacement])).toMatchObject({
      effective: [],
      retainedVoid: [{ expenseId: 'EXP-202608-CHAIN-2' }],
    })
    expect(effectiveCommittedExpenses([first, voidedReplacement])).toEqual([])
  })

  it('rejects a committed successor after VOID so a terminal book cannot resurrect', () => {
    const first = row({ expenseId: 'EXP-202608-CHAIN-1' })
    const voided = row({
      expenseId: 'EXP-202608-CHAIN-2', revision: 2,
      supersedesExpenseId: first.expenseId, recordState: 'VOID', version: 3,
      idempotencyKey: 'expense-request-2', submittedAt: '2026-08-29T10:02:00+07:00',
      committedAt: '2026-08-29T10:03:00+07:00', updatedAt: '2026-08-29T10:04:00+07:00',
    })
    const resurrected = row({
      expenseId: 'EXP-202608-CHAIN-3', revision: 3,
      supersedesExpenseId: voided.expenseId, idempotencyKey: 'expense-request-3',
      submittedAt: '2026-08-29T10:05:00+07:00', committedAt: '2026-08-29T10:06:00+07:00',
      updatedAt: '2026-08-29T10:06:00+07:00',
    })

    expect(() => validateExpenseLedger([first, voided, resurrected]))
      .toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
    expect(() => projectMonthlyExpenses([first, voided, resurrected], '2026-08'))
      .toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
  })

  it('rejects a successor whose durable chronology starts before its predecessor commit', () => {
    const first = row({
      expenseId: 'EXP-202608-CHAIN-1',
      submittedAt: '2026-08-29T10:00:00+07:00', committedAt: '2026-08-29T10:01:00+07:00',
      updatedAt: '2026-08-29T10:01:00+07:00',
    })
    const reversed = row({
      expenseId: 'EXP-202608-CHAIN-2', revision: 2,
      supersedesExpenseId: first.expenseId, idempotencyKey: 'expense-request-2',
      submittedAt: '2026-08-29T09:58:00+07:00', committedAt: '2026-08-29T09:59:00+07:00',
      updatedAt: '2026-08-29T09:59:00+07:00',
    })

    expect(() => validateExpenseLedger([first, reversed])).toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
    expect(() => projectMonthlyExpenses([first, reversed], '2026-08'))
      .toThrow('EXPENSE_DATA_INTEGRITY_ERROR')
  })

  it('rejects aggregate totals outside safe integer satang', () => {
    const first = row({ expenseId: 'EXP-202608-0001', amountSatang: Number.MAX_SAFE_INTEGER })
    const second = row({ expenseId: 'EXP-202608-0002', category: 'BILL_DOCUMENT', bookDailyKey: null, amountSatang: 1 })

    expect(() => projectMonthlyExpenses([first, second], '2026-08')).toThrow('EXPENSE_INVALID_AMOUNT')
  })
})
