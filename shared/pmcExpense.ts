export type ExpenseCategory =
  | 'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL'
  | 'SALARY' | 'EMPLOYEE_DF' | 'DOCTOR_DF'

export type EnabledExpenseCategory = Extract<ExpenseCategory,
  'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL'>

export type ExpenseScope = 'CLINIC' | 'DOCTOR_PERSONAL'
export type ExpensePaymentMethod = 'TRANSFER' | 'CASH' | 'CREDIT' | 'OTHER'
export type ExpenseRecordState = 'PREPARED' | 'COMMITTED' | 'VOID'

export interface ExpenseSubmission {
  expenseId: string
  expenseDate: string
  monthKey: string
  category: EnabledExpenseCategory
  scope: ExpenseScope
  amountSatang: number
  counterpartyName: string | null
  description: string
  paymentMethod: ExpensePaymentMethod | null
  recordState: ExpenseRecordState
  bookDailyKey: string | null
  revision: number
  supersedesExpenseId: string | null
  submittedByStaffId: string
  submittedByName: string
  submittedAt: string
  committedAt: string | null
  updatedAt: string
  version: number
  idempotencyKey: string
}

export interface ExpenseAttachmentSummary {
  attachmentId: string
  expenseId: string
  ordinal: number
  mediaType: 'image/jpeg' | 'image/png'
  originalFileName: string
}

export interface ExpenseAuditEvent {
  eventId: string
  expenseId: string
  actorStaffId: string
  action: 'PREPARE' | 'COMMIT' | 'SUPERSEDE' | 'VOID' | 'RECOVER' | 'ABANDON'
  beforeJson: string
  afterJson: string
  createdAt: string
  correlationId: string
}

export interface ExpenseReceipt {
  expenseId: string
  receiptNumber: string
  expenseDate: string
  monthKey: string
  category: EnabledExpenseCategory
  scope: ExpenseScope
  amountSatang: number
  recordState: 'COMMITTED'
  revision: number
  committedAt: string
  unreviewed: true
}

export interface ExpenseMonthlyProjection {
  monthKey: string
  clinicCommittedSatang: number
  doctorPersonalCommittedSatang: number
  clinicByCategorySatang: Record<'BILL_DOCUMENT' | 'BOOK_CLINIC', number>
  effectiveExpenseCount: number
  unreviewed: true
}

export interface ExpenseHistoryRow {
  expenseId: string
  expenseDate: string
  category: EnabledExpenseCategory
  scope: ExpenseScope
  amountSatang: number
  description: string
  recordState: ExpenseRecordState
  revision: number
  submittedByName: string
  submittedAt: string
  committedAt: string | null
  attachments: ExpenseAttachmentSummary[]
}

export interface ExpenseHistoryPage {
  expenses: ExpenseHistoryRow[]
  nextCursor: string | null
}

export function parseExpenseDate(value: string): { expenseDate: string; monthKey: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('EXPENSE_INVALID_DATE')

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('EXPENSE_INVALID_DATE')
  }

  return { expenseDate: value, monthKey: value.slice(0, 7) }
}

export function deriveExpenseScope(category: EnabledExpenseCategory): ExpenseScope {
  return category === 'BOOK_DOCTOR_PERSONAL' ? 'DOCTOR_PERSONAL' : 'CLINIC'
}

export function deriveBookDailyKey(category: EnabledExpenseCategory, expenseDate: string): string | null {
  parseExpenseDate(expenseDate)
  if (category === 'BILL_DOCUMENT') return null
  return `${deriveExpenseScope(category)}:${expenseDate}`
}

export function effectiveCommittedExpenses(rows: ExpenseSubmission[]): ExpenseSubmission[] {
  const superseded = new Set(
    rows.flatMap((row) => row.supersedesExpenseId ? [row.supersedesExpenseId] : []),
  )

  return rows.filter((row) => (
    row.recordState === 'COMMITTED' &&
    !superseded.has(row.expenseId) &&
    isCompleteCommittedExpense(row)
  ))
}

export function projectMonthlyExpenses(rows: ExpenseSubmission[], monthKey: string): ExpenseMonthlyProjection {
  assertValidMonthKey(monthKey)

  const effective = effectiveCommittedExpenses(rows).filter((row) => row.monthKey === monthKey)
  const clinic = sumSatang(effective.filter((row) => row.scope === 'CLINIC'))
  const doctorPersonal = sumSatang(effective.filter((row) => row.scope === 'DOCTOR_PERSONAL'))

  return {
    monthKey,
    clinicCommittedSatang: clinic,
    doctorPersonalCommittedSatang: doctorPersonal,
    clinicByCategorySatang: {
      BILL_DOCUMENT: sumSatang(effective.filter((row) => row.category === 'BILL_DOCUMENT')),
      BOOK_CLINIC: sumSatang(effective.filter((row) => row.category === 'BOOK_CLINIC')),
    },
    effectiveExpenseCount: effective.length,
    unreviewed: true,
  }
}

function assertValidMonthKey(value: string): void {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('EXPENSE_INVALID_MONTH')
  try {
    parseExpenseDate(`${value}-01`)
  } catch {
    throw new Error('EXPENSE_INVALID_MONTH')
  }
}

function isCompleteCommittedExpense(row: ExpenseSubmission): boolean {
  if (!isEnabledExpenseCategory(row.category)) return false
  if (!Number.isSafeInteger(row.amountSatang) || row.amountSatang <= 0) return false
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) return false
  if (typeof row.expenseId !== 'string' || row.expenseId.length === 0 || row.committedAt === null) return false

  try {
    const parsed = parseExpenseDate(row.expenseDate)
    if (parsed.monthKey !== row.monthKey || row.scope !== deriveExpenseScope(row.category)) return false
    return row.bookDailyKey === deriveBookDailyKey(row.category, row.expenseDate)
  } catch {
    return false
  }
}

function isEnabledExpenseCategory(value: unknown): value is EnabledExpenseCategory {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}

function sumSatang(rows: ExpenseSubmission[]): number {
  return rows.reduce((total, row) => {
    const next = total + row.amountSatang
    if (!Number.isSafeInteger(next)) throw new Error('EXPENSE_INVALID_AMOUNT')
    return next
  }, 0)
}
