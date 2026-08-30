import {
  deriveBookDailyKey,
  deriveExpenseScope,
  effectiveCommittedExpenses,
  parseExpenseDate,
  projectMonthlyExpenses,
  type EnabledExpenseCategory,
  type ExpenseAttachmentSummary,
  type ExpenseHistoryRow,
  type ExpenseSubmission,
} from '../../../shared/pmcExpense.js'
import type {
  ExpenseMutationContext,
  FinanceReadStore,
} from '../contracts.js'
import {
  FinanceGoogleError,
  type FinanceGoogleReadPorts,
} from './googleClient.js'

const SUBMISSIONS_RANGE = "'EXPENSE_SUBMISSIONS'!A2:T1002"
const ATTACHMENTS_RANGE = "'EXPENSE_ATTACHMENTS'!A2:N5002"
const MAX_SUBMISSIONS = 1_000
const MAX_ATTACHMENTS = 5_000
const HISTORY_PAGE_SIZE = 25
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const DRIVE_VERSION = /^[1-9]\d{0,31}$/
const LITERAL_TEXT_PREFIX = '\u200c'

export type FinanceReadStoreErrorCode =
  | 'EXPENSE_INVALID_MONTH'
  | 'EXPENSE_INVALID_CURSOR'
  | 'EXPENSE_DATA_INTEGRITY_ERROR'
  | 'EXPENSE_PRIVATE_FILE_INVALID'
  | 'EXPENSE_STORAGE_UNAVAILABLE'

export class FinanceReadStoreError extends Error {
  readonly code: FinanceReadStoreErrorCode

  constructor(code: FinanceReadStoreErrorCode) {
    super(`Finance expense read failed: ${code}`)
    this.name = 'FinanceReadStoreError'
    this.code = code
  }
}

interface PrivateExpenseAttachment extends ExpenseAttachmentSummary {
  rootRequestId: string
  privateFileId: string
  deterministicName: string
  sizeBytes: number
  driveVersion: string
  slotClaimId: string
  sha256: string
  uploadedByStaffId: string
  uploadedAt: string
}

interface ExpenseSnapshot {
  submissions: ExpenseSubmission[]
  effective: ExpenseSubmission[]
  attachments: PrivateExpenseAttachment[]
}

export function createFinanceReadStore(input: {
  finance: FinanceGoogleReadPorts
}): FinanceReadStore {
  const finance = input.finance

  return {
    async loadMonthlyExpenses(monthKey) {
      requireMonthKey(monthKey)
      const submissions = await readSubmissions(finance, monthKey)
      try {
        return projectMonthlyExpenses(submissions, monthKey)
      } catch {
        throw integrity()
      }
    },

    async listExpenseHistory(monthKey, cursor, limit) {
      requireMonthKey(monthKey)
      if (limit !== HISTORY_PAGE_SIZE) throw new FinanceReadStoreError('EXPENSE_INVALID_CURSOR')
      const snapshot = await readSnapshot(finance, monthKey)
      const rows = historyRows(snapshot)
      const start = cursor === null ? 0 : cursorStart(cursor, rows)
      const expenses = rows.slice(start, start + HISTORY_PAGE_SIZE)
      const nextIndex = start + expenses.length
      return {
        expenses,
        nextCursor: nextIndex < rows.length ? historyCursor(expenses[expenses.length - 1]!) : null,
      }
    },

    async getEvidence(monthKey, expenseId, attachmentId) {
      requireMonthKey(monthKey)
      if (!safeExpenseIdForMonth(expenseId, monthKey) || !SAFE_ID.test(attachmentId)) return null
      const snapshot = await readSnapshot(finance, monthKey)
      if (!snapshot.effective.some((row) => row.expenseId === expenseId)) return null
      const matches = snapshot.attachments.filter((attachment) => (
        attachment.expenseId === expenseId && attachment.attachmentId === attachmentId
      ))
      if (matches.length === 0) return null
      if (matches.length !== 1) throw integrity()
      const attachment = matches[0]!
      try {
        const downloaded = await finance.downloadExpenseFile({
          monthKey,
          expenseId,
          fileId: attachment.privateFileId,
          expectedAttachment: { ...attachment },
        })
        if (
          !Buffer.isBuffer(downloaded.bytes)
          || downloaded.bytes.length < 1
          || downloaded.bytes.length > 10_000_000
          || downloaded.mimeType !== attachment.mediaType
        ) throw new FinanceReadStoreError('EXPENSE_PRIVATE_FILE_INVALID')
        return { bytes: Buffer.from(downloaded.bytes), mimeType: downloaded.mimeType }
      } catch (error) {
        if (error instanceof FinanceReadStoreError) throw error
        if (error instanceof FinanceGoogleError && error.code === 'EXPENSE_PRIVATE_FILE_INVALID') {
          throw new FinanceReadStoreError('EXPENSE_PRIVATE_FILE_INVALID')
        }
        throw new FinanceReadStoreError('EXPENSE_STORAGE_UNAVAILABLE')
      }
    },

    async getExpenseMutationContext(monthKey, expenseId) {
      requireMonthKey(monthKey)
      if (!safeExpenseIdForMonth(expenseId, monthKey)) return null
      const submissions = await readSubmissions(finance, monthKey)
      const effective = effectiveRows(submissions)
      const matches = effective.filter((row) => row.expenseId === expenseId)
      if (matches.length === 0) return null
      if (matches.length !== 1) throw integrity()
      return mutationContext(matches[0]!)
    },
  }
}

async function readSubmissions(
  finance: FinanceGoogleReadPorts,
  monthKey: string,
): Promise<ExpenseSubmission[]> {
  const response = await readMonth(finance, monthKey, [SUBMISSIONS_RANGE])
  return parseSubmissions(requireBoundedRows(response, SUBMISSIONS_RANGE, MAX_SUBMISSIONS))
}

async function readSnapshot(
  finance: FinanceGoogleReadPorts,
  monthKey: string,
): Promise<ExpenseSnapshot> {
  const response = await readMonth(finance, monthKey, [SUBMISSIONS_RANGE, ATTACHMENTS_RANGE])
  const submissions = parseSubmissions(requireBoundedRows(response, SUBMISSIONS_RANGE, MAX_SUBMISSIONS))
  const attachments = parseAttachments(requireBoundedRows(response, ATTACHMENTS_RANGE, MAX_ATTACHMENTS))
  const expenseIds = new Set(submissions.map(({ expenseId }) => expenseId))
  if (attachments.some(({ expenseId }) => !expenseIds.has(expenseId))) throw integrity()
  unique(attachments.map(({ attachmentId }) => attachmentId))
  unique(attachments.map(({ privateFileId }) => privateFileId))
  const effective = effectiveRows(submissions)
  for (const row of effective) {
    const evidence = attachments
      .filter(({ expenseId }) => expenseId === row.expenseId)
      .sort((left, right) => left.ordinal - right.ordinal)
    if (
      evidence.length < 1
      || evidence.length > 5
      || evidence.some((attachment, index) => attachment.ordinal !== index + 1)
    ) throw integrity()
  }
  return { submissions, effective, attachments }
}

async function readMonth(
  finance: FinanceGoogleReadPorts,
  monthKey: string,
  ranges: string[],
): Promise<Record<string, unknown[][]>> {
  try {
    const response = await finance.readMonth(monthKey, ranges)
    const actual = Object.keys(response).sort()
    const expected = [...ranges].sort()
    if (
      actual.length !== expected.length
      || actual.some((range, index) => range !== expected[index])
    ) throw integrity()
    return response
  } catch (error) {
    if (error instanceof FinanceReadStoreError) throw error
    throw new FinanceReadStoreError('EXPENSE_STORAGE_UNAVAILABLE')
  }
}

function requireBoundedRows(
  response: Record<string, unknown[][]>,
  range: string,
  maximum: number,
): unknown[][] {
  const rows = response[range]
  if (!Array.isArray(rows) || rows.length > maximum) throw integrity()
  return rows
}

function parseSubmissions(rows: unknown[][]): ExpenseSubmission[] {
  const parsed = rows.map(parseSubmission)
  unique(parsed.map(({ expenseId }) => expenseId))
  return parsed
}

function parseSubmission(row: unknown[]): ExpenseSubmission {
  try {
    if (!Array.isArray(row) || row.length !== 20) throw integrity()
    const expenseId = id(row[0])
    const expenseDate = date(row[1])
    const monthKey = month(row[2])
    const category = enabledCategory(row[3])
    const scope = deriveExpenseScope(category)
    if (row[4] !== scope) throw integrity()
    const amountSatang = integer(row[5], 1)
    const counterpartyName = nullableText(row[6], 160)
    const description = text(row[7], 500)
    const paymentMethod = nullablePaymentMethod(row[8])
    const recordState = row[9]
    if (recordState !== 'PREPARED' && recordState !== 'COMMITTED' && recordState !== 'VOID') throw integrity()
    const bookDailyKey = nullableIdLike(row[10])
    const revision = integer(row[11], 1)
    const supersedesExpenseId = nullableSafeId(row[12])
    const submittedByStaffId = id(row[13])
    const submittedByName = nonEmptyText(row[14], 300)
    const submittedAt = timestamp(row[15])
    const committedAt = nullableTimestamp(row[16])
    const updatedAt = timestamp(row[17])
    const version = integer(row[18], 1)
    const idempotencyKey = id(row[19])
    if (
      parseExpenseDate(expenseDate).monthKey !== monthKey
      || !safeExpenseIdForMonth(expenseId, monthKey)
      || bookDailyKey !== deriveBookDailyKey(category, expenseDate)
      || (recordState === 'PREPARED' && committedAt !== null)
      || (recordState === 'COMMITTED' && committedAt === null)
      || (category === 'BILL_DOCUMENT' && (!counterpartyName?.trim() || paymentMethod === null || revision !== 1))
      || (category !== 'BILL_DOCUMENT' && (counterpartyName !== null || paymentMethod !== null))
    ) throw integrity()
    return {
      expenseId, expenseDate, monthKey, category, scope, amountSatang,
      counterpartyName, description, paymentMethod, recordState, bookDailyKey, revision,
      supersedesExpenseId, submittedByStaffId, submittedByName, submittedAt, committedAt,
      updatedAt, version, idempotencyKey,
    }
  } catch (error) {
    if (error instanceof FinanceReadStoreError) throw error
    throw integrity()
  }
}

function parseAttachments(rows: unknown[][]): PrivateExpenseAttachment[] {
  return rows.map((row) => {
    try {
      if (!Array.isArray(row) || row.length !== 14) throw integrity()
      const attachmentId = id(row[0])
      const expenseId = id(row[1])
      const rootRequestId = id(row[2])
      const ordinal = integer(row[3], 1, 5)
      const mediaType = row[4]
      if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') throw integrity()
      const originalFileName = nonEmptyText(row[5], 180)
      const privateFileId = id(row[6])
      const deterministicName = nonEmptyText(row[7], 160)
      const sizeBytes = integer(row[8], 1, 10_000_000)
      const driveVersion = stringMatching(row[9], DRIVE_VERSION)
      const slotClaimId = stringMatching(row[10], /^SLOT-[a-f0-9]{64}$/)
      const sha256 = stringMatching(row[11], SHA256)
      const uploadedByStaffId = id(row[12])
      const uploadedAt = timestamp(row[13])
      const expectedName = `${String(ordinal).padStart(3, '0')}-${sha256}.${mediaType === 'image/jpeg' ? 'jpg' : 'png'}`
      if (deterministicName !== expectedName) throw integrity()
      return {
        attachmentId, expenseId, rootRequestId, ordinal, mediaType, originalFileName,
        privateFileId, deterministicName, sizeBytes, driveVersion, slotClaimId, sha256,
        uploadedByStaffId, uploadedAt,
      }
    } catch (error) {
      if (error instanceof FinanceReadStoreError) throw error
      throw integrity()
    }
  })
}

function effectiveRows(submissions: ExpenseSubmission[]): ExpenseSubmission[] {
  try {
    return effectiveCommittedExpenses(submissions)
  } catch {
    throw integrity()
  }
}

function historyRows(snapshot: ExpenseSnapshot): ExpenseHistoryRow[] {
  return snapshot.effective.map((submission) => ({
    expenseId: submission.expenseId,
    expenseDate: submission.expenseDate,
    category: submission.category,
    scope: submission.scope,
    amountSatang: submission.amountSatang,
    description: submission.description,
    recordState: 'COMMITTED' as const,
    revision: submission.revision,
    submittedByName: submission.submittedByName,
    submittedAt: submission.submittedAt,
    committedAt: submission.committedAt,
    attachments: snapshot.attachments
      .filter(({ expenseId }) => expenseId === submission.expenseId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(({ attachmentId, expenseId, ordinal, mediaType, originalFileName }) => ({
        attachmentId, expenseId, ordinal, mediaType, originalFileName,
      })),
  })).sort((left, right) => (
    Date.parse(right.submittedAt) - Date.parse(left.submittedAt)
    || right.expenseId.localeCompare(left.expenseId)
  ))
}

function cursorStart(cursor: string, rows: ExpenseHistoryRow[]): number {
  if (typeof cursor !== 'string' || cursor.length < 3 || cursor.length > 256) {
    throw new FinanceReadStoreError('EXPENSE_INVALID_CURSOR')
  }
  const separator = cursor.lastIndexOf('|')
  if (separator < 1 || cursor.indexOf('|') !== separator) {
    throw new FinanceReadStoreError('EXPENSE_INVALID_CURSOR')
  }
  const submittedAt = cursor.slice(0, separator)
  const expenseId = cursor.slice(separator + 1)
  if (!validTimestamp(submittedAt) || !SAFE_ID.test(expenseId)) {
    throw new FinanceReadStoreError('EXPENSE_INVALID_CURSOR')
  }
  const index = rows.findIndex((row) => row.submittedAt === submittedAt && row.expenseId === expenseId)
  if (index < 0) throw new FinanceReadStoreError('EXPENSE_INVALID_CURSOR')
  return index + 1
}

function historyCursor(row: ExpenseHistoryRow): string {
  return `${row.submittedAt}|${row.expenseId}`
}

function mutationContext(row: ExpenseSubmission): ExpenseMutationContext {
  return {
    expenseId: row.expenseId,
    expenseDate: row.expenseDate,
    monthKey: row.monthKey,
    category: row.category,
    scope: row.scope,
    bookDailyKey: row.bookDailyKey,
    recordState: 'COMMITTED',
    revision: row.revision,
    version: row.version,
  }
}

function requireMonthKey(value: string): void {
  try {
    if (typeof value !== 'string' || parseExpenseDate(`${value}-01`).monthKey !== value) throw new Error('invalid')
  } catch {
    throw new FinanceReadStoreError('EXPENSE_INVALID_MONTH')
  }
}

function safeExpenseIdForMonth(value: string, monthKey: string): boolean {
  return SAFE_ID.test(value)
    && new RegExp(`^EXP-${monthKey.replace('-', '')}-[A-Za-z0-9._:-]{1,107}$`).test(value)
}

function month(value: unknown): string {
  const result = nonEmptyText(value, 7)
  requireMonthKey(result)
  return result
}

function date(value: unknown): string {
  const result = nonEmptyText(value, 10)
  parseExpenseDate(result)
  return result
}

function enabledCategory(value: unknown): EnabledExpenseCategory {
  if (value !== 'BILL_DOCUMENT' && value !== 'BOOK_CLINIC' && value !== 'BOOK_DOCTOR_PERSONAL') throw integrity()
  return value
}

function nullablePaymentMethod(value: unknown): ExpenseSubmission['paymentMethod'] {
  const normalized = nullableText(value, 32)
  if (normalized === null || normalized === 'TRANSFER' || normalized === 'CASH'
    || normalized === 'CREDIT' || normalized === 'OTHER') return normalized
  throw integrity()
}

function id(value: unknown): string {
  return stringMatching(value, SAFE_ID)
}

function nullableSafeId(value: unknown): string | null {
  const normalized = nullableText(value, 124)
  if (normalized === null || SAFE_ID.test(normalized)) return normalized
  throw integrity()
}

function nullableIdLike(value: unknown): string | null {
  const normalized = nullableText(value, 160)
  if (normalized === null || /^(?:CLINIC|DOCTOR_PERSONAL):\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  throw integrity()
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw integrity()
  return value
}

function text(value: unknown, maximum: number): string {
  const decoded = decodedText(value)
  if (decoded.length > maximum || forbiddenText(decoded)) throw integrity()
  return decoded
}

function nonEmptyText(value: unknown, maximum: number): string {
  const result = text(value, maximum)
  if (!result) throw integrity()
  return result
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined || value === '') return null
  return text(value, maximum)
}

function decodedText(value: unknown): string {
  if (typeof value !== 'string') throw integrity()
  return value.startsWith(LITERAL_TEXT_PREFIX) ? value.slice(1) : value
}

function forbiddenText(value: string): boolean {
  return [...value].some((character) => [0, 10, 13, 127].includes(character.charCodeAt(0)))
}

function timestamp(value: unknown): string {
  const result = nonEmptyText(value, 64)
  if (!validTimestamp(result)) throw integrity()
  return result
}

function nullableTimestamp(value: unknown): string | null {
  const result = nullableText(value, 64)
  if (result !== null && !validTimestamp(result)) throw integrity()
  return result
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.length <= 64 && !value.includes('|')
}

function stringMatching(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw integrity()
  return value
}

function unique(values: string[]): void {
  if (new Set(values).size !== values.length) throw integrity()
}

function integrity(): FinanceReadStoreError {
  return new FinanceReadStoreError('EXPENSE_DATA_INTEGRITY_ERROR')
}
