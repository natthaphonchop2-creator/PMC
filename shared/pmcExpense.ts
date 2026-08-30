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

export interface ValidatedExpenseLedger {
  effective: ExpenseSubmission[]
  retainedVoid: ExpenseSubmission[]
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
  return validateExpenseLedger(rows).effective
}

export function projectMonthlyExpenses(rows: ExpenseSubmission[], monthKey: string): ExpenseMonthlyProjection {
  assertValidMonthKey(monthKey)

  const effective = validateExpenseLedger(rows).effective.filter((row) => row.monthKey === monthKey)
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

export function validateExpenseLedger(rows: readonly ExpenseSubmission[]): ValidatedExpenseLedger {
  try {
    if (!Array.isArray(rows)) throw new Error('invalid')
    const byId = new Map<string, ExpenseSubmission>()
    const bookRevisionKeys = new Set<string>()

    for (const row of rows) {
      validateExpenseRow(row)
      if (byId.has(row.expenseId)) throw new Error('duplicate expense')
      byId.set(row.expenseId, row)
      if (row.bookDailyKey !== null && row.recordState !== 'PREPARED') {
        const revisionKey = `${row.bookDailyKey}\u0000${row.revision}`
        if (bookRevisionKeys.has(revisionKey)) throw new Error('duplicate book revision')
        bookRevisionKeys.add(revisionKey)
      }
    }

    for (const row of rows) {
      if (row.bookDailyKey === null) {
        if (row.supersedesExpenseId !== null || row.revision !== 1) throw new Error('invalid bill chain')
        continue
      }
      if (row.recordState === 'PREPARED') {
        if (row.supersedesExpenseId !== null) throw new Error('prepared tombstone')
        continue
      }
      if (row.revision === 1) {
        if (row.supersedesExpenseId !== null) throw new Error('invalid first revision')
        continue
      }
      if (row.supersedesExpenseId === null) throw new Error('missing predecessor')
      const predecessor = byId.get(row.supersedesExpenseId)
      if (
        !predecessor
        || predecessor.expenseId === row.expenseId
        || predecessor.recordState === 'PREPARED'
        || predecessor.bookDailyKey !== row.bookDailyKey
        || predecessor.expenseDate !== row.expenseDate
        || predecessor.monthKey !== row.monthKey
        || predecessor.category !== row.category
        || predecessor.scope !== row.scope
        || predecessor.revision !== row.revision - 1
      ) throw new Error('invalid predecessor')
    }

    const superseded = new Set(
      rows.flatMap((row) => row.recordState === 'PREPARED' || row.supersedesExpenseId === null
        ? []
        : [row.supersedesExpenseId]),
    )
    const effective = rows.filter((row) => (
      row.recordState === 'COMMITTED' && !superseded.has(row.expenseId)
    ))
    const effectiveBookKeys = new Set<string>()
    for (const row of effective) {
      if (row.bookDailyKey === null) continue
      if (effectiveBookKeys.has(row.bookDailyKey)) throw new Error('multiple effective books')
      effectiveBookKeys.add(row.bookDailyKey)
    }

    return {
      effective: effective.map((row) => ({ ...row })),
      retainedVoid: rows.filter((row) => row.recordState === 'VOID').map((row) => ({ ...row })),
    }
  } catch {
    throw new Error('EXPENSE_DATA_INTEGRITY_ERROR')
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

function validateExpenseRow(row: ExpenseSubmission): void {
  if (!row || typeof row !== 'object' || !isEnabledExpenseCategory(row.category)) throw new Error('invalid row')
  if (typeof row.expenseId !== 'string' || row.expenseId.length < 1 || row.expenseId.length > 124) throw new Error('invalid id')
  if (!Number.isSafeInteger(row.amountSatang) || row.amountSatang <= 0) throw new Error('invalid amount')
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('invalid revision')
  if (typeof row.idempotencyKey !== 'string' || row.idempotencyKey.length < 1 || row.idempotencyKey.length > 124) {
    throw new Error('invalid root')
  }
  const parsed = parseExpenseDate(row.expenseDate)
  if (
    parsed.monthKey !== row.monthKey
    || row.scope !== deriveExpenseScope(row.category)
    || row.bookDailyKey !== deriveBookDailyKey(row.category, row.expenseDate)
  ) throw new Error('invalid derived fields')
  if (!validTimestamp(row.submittedAt) || !validTimestamp(row.updatedAt)) throw new Error('invalid timestamp')
  if (Date.parse(row.updatedAt) < Date.parse(row.submittedAt)) throw new Error('invalid timestamp order')
  if (row.category === 'BILL_DOCUMENT') {
    if (!row.counterpartyName?.trim() || row.paymentMethod === null) throw new Error('invalid bill fields')
  } else if (row.counterpartyName !== null || row.paymentMethod !== null) {
    throw new Error('invalid book fields')
  }
  if (row.recordState === 'PREPARED') {
    if (row.version !== 1 || row.committedAt !== null) throw new Error('invalid prepared state')
    return
  }
  if (row.recordState === 'COMMITTED') {
    if (row.version !== 2 || !validTimestamp(row.committedAt)) throw new Error('invalid committed state')
    if (Date.parse(row.committedAt) < Date.parse(row.submittedAt)) throw new Error('invalid commit order')
    return
  }
  if (row.recordState === 'VOID') {
    if (row.version !== 3 || !validTimestamp(row.committedAt)) throw new Error('invalid void state')
    if (Date.parse(row.updatedAt) < Date.parse(row.committedAt)) throw new Error('invalid void order')
    return
  }
  throw new Error('invalid state')
}

function validTimestamp(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
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
