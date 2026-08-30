import { createHash } from 'node:crypto'
import type {
  ExpenseAuditEvent,
  ExpenseMonthlyProjection,
  ExpenseSubmission,
} from '../../../../shared/pmcExpense'
import {
  canonicalMiniAppExpenseCommand,
  type ExpensePrivateAttachment,
  type MiniAppExpenseCommand,
} from '../../../../shared/pmcMiniAppExpenseIngress'
import {
  createExpenseRepository,
  type ExpenseRepositoryBackend,
  type ExpenseRepositoryMasterTab,
  type ExpenseRepositoryMonthTab,
  type ExpenseStorageRow,
} from '../../src/expense/repository'
import {
  canonicalExpenseAttachmentManifest,
  executeExpenseCommand,
  type ExpenseCommandPorts,
} from '../../src/expense/commands'

export const EXPENSE_NOW = '2026-08-29T10:00:00+07:00'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class MemoryExpenseBackend implements ExpenseRepositoryBackend {
  readonly master = new Map<ExpenseRepositoryMasterTab, ExpenseStorageRow[]>()
  readonly months = new Map<string, Map<ExpenseRepositoryMonthTab, ExpenseStorageRow[]>>()
  readonly monthlySummaries = new Map<string, ExpenseStorageRow[]>()
  readonly verifiedAttachmentIds: string[] = []
  readonly masterReadCount = new Map<ExpenseRepositoryMasterTab, number>()
  monthOperationCount = 0
  failAttachmentAppendCount = 0
  failSubmissionUpdateCount = 0
  failRequestCompletionCount = 0
  privateFilesValid = true

  constructor() {
    this.master.set('EXPENSE_MONTHLY_INDEX', [])
    this.master.set('EXPENSE_REQUESTS', [])
    this.master.set('EXPENSE_AUDIT', [])
  }

  ensureMonth(monthKey: string, createdAt: string) {
    this.monthOperationCount += 1
    if (!this.months.has(monthKey)) {
      this.months.set(monthKey, new Map([
        ['EXPENSE_SUBMISSIONS', []],
        ['EXPENSE_ATTACHMENTS', []],
        ['MONTHLY_SUMMARY', []],
      ]))
    }
    const index = this.master.get('EXPENSE_MONTHLY_INDEX')!
    if (!index.some((row) => row.monthKey === monthKey)) {
      index.push({
        monthKey,
        ledgerSpreadsheetId: `ledger-${monthKey}`,
        monthFolderId: `folder-${monthKey}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    return { ledgerSpreadsheetId: `ledger-${monthKey}`, monthFolderId: `folder-${monthKey}` }
  }

  readMaster(tab: ExpenseRepositoryMasterTab): ExpenseStorageRow[] {
    this.masterReadCount.set(tab, (this.masterReadCount.get(tab) ?? 0) + 1)
    return clone(this.master.get(tab) ?? [])
  }

  appendMaster(tab: ExpenseRepositoryMasterTab, rows: ExpenseStorageRow[]): void {
    this.master.set(tab, [...clone(this.master.get(tab) ?? []), ...clone(rows)])
  }

  updateMaster(tab: ExpenseRepositoryMasterTab, rowIndex: number, row: ExpenseStorageRow): void {
    if (tab === 'EXPENSE_REQUESTS' && this.failRequestCompletionCount > 0) {
      this.failRequestCompletionCount -= 1
      throw new Error('simulated request completion failure')
    }
    const rows = clone(this.master.get(tab) ?? [])
    rows[rowIndex] = clone(row)
    this.master.set(tab, rows)
  }

  readMonth(monthKey: string, tab: ExpenseRepositoryMonthTab): ExpenseStorageRow[] {
    this.monthOperationCount += 1
    return clone(this.months.get(monthKey)?.get(tab) ?? [])
  }

  appendMonth(monthKey: string, tab: ExpenseRepositoryMonthTab, rows: ExpenseStorageRow[]): void {
    this.monthOperationCount += 1
    if (tab === 'EXPENSE_ATTACHMENTS' && this.failAttachmentAppendCount > 0) {
      this.failAttachmentAppendCount -= 1
      throw new Error('simulated attachment append failure')
    }
    const month = this.requireMonth(monthKey)
    month.set(tab, [...clone(month.get(tab) ?? []), ...clone(rows)])
  }

  updateMonth(
    monthKey: string,
    tab: ExpenseRepositoryMonthTab,
    rowIndex: number,
    row: ExpenseStorageRow,
  ): void {
    this.monthOperationCount += 1
    if (tab === 'EXPENSE_SUBMISSIONS' && this.failSubmissionUpdateCount > 0) {
      this.failSubmissionUpdateCount -= 1
      throw new Error('simulated submission update failure')
    }
    const month = this.requireMonth(monthKey)
    const rows = clone(month.get(tab) ?? [])
    rows[rowIndex] = clone(row)
    month.set(tab, rows)
  }

  replaceMonth(monthKey: string, tab: ExpenseRepositoryMonthTab, rows: ExpenseStorageRow[]): void {
    this.monthOperationCount += 1
    this.requireMonth(monthKey).set(tab, clone(rows))
    if (tab === 'MONTHLY_SUMMARY') this.monthlySummaries.set(monthKey, clone(rows))
  }

  verifyPrivateAttachments(
    _monthKey: string,
    _expenseId: string,
    attachments: ExpensePrivateAttachment[],
  ): void {
    if (!this.privateFilesValid) throw new Error('EXPENSE_PRIVATE_FILE_INVALID')
    this.verifiedAttachmentIds.push(...attachments.map(({ attachmentId }) => attachmentId))
  }

  sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private requireMonth(monthKey: string): Map<ExpenseRepositoryMonthTab, ExpenseStorageRow[]> {
    const month = this.months.get(monthKey)
    if (!month) throw new Error('month not initialized')
    return month
  }
}

export interface ExpenseTestPorts extends ExpenseCommandPorts {
  backend: MemoryExpenseBackend
  setNow(value: string): void
  lockEntries(): number
}

export function createExpenseTestPorts(options: {
  backend?: MemoryExpenseBackend
  now?: string
  staffCanManage?: boolean
} = {}): ExpenseTestPorts {
  const backend = options.backend ?? new MemoryExpenseBackend()
  let now = options.now ?? EXPENSE_NOW
  let entries = 0
  let expenseSequence = 0
  const repository = createExpenseRepository(backend)
  return {
    backend,
    expense: repository,
    clock: { nowIso: () => now },
    locks: {
      withLock<T>(operation: () => T): T {
        entries += 1
        return operation()
      },
    },
    staff: {
      findById(staffId) {
        if (staffId === 'INACTIVE_01') {
          return {
            id: staffId,
            name: 'Inactive',
            active: false,
            canSubmitExpense: true,
            canManageExpense: true,
          }
        }
        if (staffId !== 'STAFF_01' && staffId !== 'MANAGER_01') return null
        return {
          id: staffId,
          name: staffId === 'MANAGER_01' ? 'Manager' : 'Staff',
          active: true,
          canSubmitExpense: true,
          canManageExpense: staffId === 'MANAGER_01' || options.staffCanManage === true,
        }
      },
    },
    crypto: {
      sha256Hex: (value) => createHash('sha256').update(value).digest('hex'),
    },
    commandFingerprint: (command) => createHash('sha256')
      .update(canonicalMiniAppExpenseCommand(command))
      .digest('hex'),
    allocateExpenseId(monthKey) {
      expenseSequence += 1
      return `EXP-${monthKey.replace('-', '')}-${String(expenseSequence).padStart(4, '0')}`
    },
    setNow(value) { now = value },
    lockEntries: () => entries,
  }
}

export function prepareCommand(patch: Partial<Extract<
  MiniAppExpenseCommand,
  { commandType: 'PREPARE_EXPENSE' }
>> = {}): Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }> {
  const rootRequestId = patch.rootRequestId ?? 'expense-request-1'
  return {
    rootRequestId,
    commandIdempotencyKey: `${rootRequestId}:prepare`,
    staffId: 'STAFF_01',
    commandType: 'PREPARE_EXPENSE',
    payload: {
      expenseDate: '2026-08-29',
      category: 'BILL_DOCUMENT',
      bookDailyKey: null,
      amountSatang: 12_000,
      counterpartyName: 'ร้านทดสอบ',
      description: 'อุปกรณ์คลินิก',
      paymentMethod: 'TRANSFER',
      expectedAttachmentCount: 1,
      expectedManifestHash: '0'.repeat(64),
      expectedRevision: 0,
      ...(patch.payload ?? {}),
    },
    ...patch,
  }
}

export function bookPrepareCommand(input: {
  rootRequestId: string
  expectedRevision: number
  amountSatang: number
  staffId?: string
}): Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }> {
  return prepareCommand({
    rootRequestId: input.rootRequestId,
    commandIdempotencyKey: `${input.rootRequestId}:prepare`,
    staffId: input.staffId ?? (input.expectedRevision > 0 ? 'MANAGER_01' : 'STAFF_01'),
    payload: {
      expenseDate: '2026-08-29',
      category: 'BOOK_CLINIC',
      bookDailyKey: 'CLINIC:2026-08-29',
      amountSatang: input.amountSatang,
      counterpartyName: null,
      description: 'สมุดรายจ่ายประจำวัน',
      paymentMethod: null,
      expectedAttachmentCount: 1,
      expectedManifestHash: '0'.repeat(64),
      expectedRevision: input.expectedRevision,
    },
  })
}

export function attachmentFixture(
  expenseId: string,
  patch: Partial<ExpensePrivateAttachment> = {},
): ExpensePrivateAttachment {
  return {
    attachmentId: `ATT-${expenseId}-1`,
    expenseId,
    rootRequestId: 'expense-request-1',
    ordinal: 1,
    mediaType: 'image/jpeg',
    originalFileName: 'receipt.jpg',
    privateFileId: `FILE-${expenseId}-1`,
    deterministicName: `001-${'a'.repeat(64)}.jpg`,
    sizeBytes: 1,
    driveVersion: '1',
    slotClaimId: `SLOT-${'b'.repeat(64)}`,
    sha256: 'a'.repeat(64),
    uploadedByStaffId: 'STAFF_01',
    uploadedAt: EXPENSE_NOW,
    ...patch,
  }
}

export function manifestHash(attachments: ExpensePrivateAttachment[]): string {
  return createHash('sha256')
    .update(canonicalExpenseAttachmentManifest(attachments))
    .digest('hex')
}

export function commitCommand(input: {
  rootRequestId: string
  expenseId: string
  expectedVersion?: number
  expectedRevision?: number
  staffId?: string
  attachments?: ExpensePrivateAttachment[]
}): Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }> {
  const attachments = input.attachments ?? [attachmentFixture(input.expenseId, {
    rootRequestId: input.rootRequestId,
    uploadedByStaffId: input.staffId ?? 'STAFF_01',
  })]
  return {
    rootRequestId: input.rootRequestId,
    commandIdempotencyKey: `${input.rootRequestId}:commit`,
    staffId: input.staffId ?? 'STAFF_01',
    commandType: 'COMMIT_EXPENSE',
    payload: {
      expenseId: input.expenseId,
      expectedVersion: input.expectedVersion ?? 1,
      expectedRevision: input.expectedRevision ?? 0,
      expectedManifestHash: manifestHash(attachments),
      attachments,
    },
  }
}

export function voidCommand(input: {
  rootRequestId: string
  expenseId: string
  expectedVersion?: number
  reason?: string
}): Extract<MiniAppExpenseCommand, { commandType: 'VOID_EXPENSE' }> {
  return {
    rootRequestId: input.rootRequestId,
    commandIdempotencyKey: `${input.rootRequestId}:void`,
    staffId: 'MANAGER_01',
    commandType: 'VOID_EXPENSE',
    payload: {
      expenseId: input.expenseId,
      expectedVersion: input.expectedVersion ?? 1,
      reason: input.reason ?? 'ยกเลิกรายการทดสอบ',
    },
  }
}

export function prepareWithManifest(
  ports: ExpenseCommandPorts,
  command: Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }>,
) {
  const provisionalExpenseId = `EXP-${command.payload.expenseDate.slice(0, 7).replace('-', '')}-0001`
  const attachments = [attachmentFixture(provisionalExpenseId, {
    rootRequestId: command.rootRequestId,
    uploadedByStaffId: command.staffId,
  })]
  const preparedCommand = {
    ...command,
    payload: { ...command.payload, expectedManifestHash: manifestHash(attachments) },
  }
  const prepared = executeExpenseCommand(preparedCommand, ports)
  if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected command result')
  return {
    prepared,
    preparedCommand,
    attachments: [attachmentFixture(prepared.expenseId, {
      rootRequestId: command.rootRequestId,
      uploadedByStaffId: command.staffId,
    })],
  }
}

export function seedPreparedSubmission(
  backend: MemoryExpenseBackend,
  submission: ExpenseSubmission,
  audit: ExpenseAuditEvent,
): void {
  backend.ensureMonth(submission.monthKey, submission.submittedAt)
  backend.appendMonth(submission.monthKey, 'EXPENSE_SUBMISSIONS', [submission as unknown as ExpenseStorageRow])
  backend.appendMaster('EXPENSE_AUDIT', [audit as unknown as ExpenseStorageRow])
}

export function summaryRows(
  backend: MemoryExpenseBackend,
  monthKey: string,
): ExpenseStorageRow[] {
  return clone(backend.monthlySummaries.get(monthKey) ?? [])
}

export function projectionFixture(patch: Partial<ExpenseMonthlyProjection> = {}): ExpenseMonthlyProjection {
  return {
    monthKey: '2026-08',
    clinicCommittedSatang: 12_000,
    doctorPersonalCommittedSatang: 0,
    clinicByCategorySatang: { BILL_DOCUMENT: 12_000, BOOK_CLINIC: 0 },
    effectiveExpenseCount: 1,
    unreviewed: true,
    ...patch,
  }
}
