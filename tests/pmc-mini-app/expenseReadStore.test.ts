import { describe, expect, it, vi } from 'vitest'
import type { FinanceGoogleReadPorts } from '../../server/pmc-mini-app/finance/googleClient'
import {
  createFinanceReadStore,
  FinanceReadStoreError,
} from '../../server/pmc-mini-app/finance/readStore'

const MONTH_KEY = '2026-08'
const SUBMISSIONS_RANGE = "'EXPENSE_SUBMISSIONS'!A2:T1002"
const ATTACHMENTS_RANGE = "'EXPENSE_ATTACHMENTS'!A2:N5002"

describe('finance expense read store', () => {
  it('derives one-month totals only from effective committed rows and keeps doctor personal separate', async () => {
    const rows = [
      submissionRow({
        expenseId: 'EXP-202608-OLD', category: 'BOOK_CLINIC', amountSatang: 10_000,
        counterpartyName: null, paymentMethod: null, bookDailyKey: 'CLINIC:2026-08-29',
      }),
      submissionRow({
        expenseId: 'EXP-202608-NEW', category: 'BOOK_CLINIC', amountSatang: 12_000, revision: 2,
        counterpartyName: null, paymentMethod: null, bookDailyKey: 'CLINIC:2026-08-29',
        supersedesExpenseId: 'EXP-202608-OLD', submittedAt: '2026-08-30T03:00:00.000Z',
      }),
      submissionRow({
        expenseId: 'EXP-202608-PERSONAL', category: 'BOOK_DOCTOR_PERSONAL', scope: 'DOCTOR_PERSONAL',
        amountSatang: 5_000, counterpartyName: null, paymentMethod: null,
        bookDailyKey: 'DOCTOR_PERSONAL:2026-08-29',
      }),
      submissionRow({ expenseId: 'EXP-202608-PREPARED', recordState: 'PREPARED', committedAt: '' }),
      submissionRow({ expenseId: 'EXP-202608-VOID', recordState: 'VOID' }),
    ]
    const finance = financePort({ submissions: rows })

    await expect(createFinanceReadStore({ finance }).loadMonthlyExpenses(MONTH_KEY)).resolves.toEqual({
      monthKey: MONTH_KEY,
      clinicCommittedSatang: 12_000,
      doctorPersonalCommittedSatang: 5_000,
      clinicByCategorySatang: { BILL_DOCUMENT: 0, BOOK_CLINIC: 12_000 },
      effectiveExpenseCount: 2,
      unreviewed: true,
    })
    expect(finance.readMonth).toHaveBeenCalledTimes(1)
    expect(finance.readMonth).toHaveBeenCalledWith(MONTH_KEY, [SUBMISSIONS_RANGE])
    expect(finance.readMaster).not.toHaveBeenCalled()
  })

  it('returns newest-first safe history in fixed pages of 25 with submittedAt|expenseId cursors', async () => {
    const submissions = Array.from({ length: 27 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, '0')
      return submissionRow({
        expenseId: `EXP-202608-${ordinal}`,
        expenseDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
        bookDailyKey: null,
        submittedAt: `2026-08-${String(index + 1).padStart(2, '0')}T03:00:00.000Z`,
        committedAt: `2026-08-${String(index + 1).padStart(2, '0')}T03:01:00.000Z`,
        updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T03:01:00.000Z`,
      })
    })
    const attachments = submissions.map((row, index) => attachmentRow({
      attachmentId: `ATT-${String(index + 1).padStart(2, '0')}`,
      expenseId: String(row[0]),
      privateFileId: `private-file-${index + 1}`,
      sha256: String(index + 1).padStart(64, 'a').slice(-64),
    }))
    const finance = financePort({ submissions, attachments })
    const store = createFinanceReadStore({ finance })

    const first = await store.listExpenseHistory(MONTH_KEY, null, 25)
    expect(first.expenses).toHaveLength(25)
    expect(first.expenses[0]?.expenseId).toBe('EXP-202608-27')
    expect(first.nextCursor).toBe('2026-08-03T03:00:00.000Z|EXP-202608-03')
    expect(first.expenses[0]).toEqual({
      expenseId: 'EXP-202608-27', expenseDate: '2026-08-27', category: 'BILL_DOCUMENT',
      scope: 'CLINIC', amountSatang: 10_000, description: 'ค่าใช้จ่าย', recordState: 'COMMITTED',
      revision: 1, submittedByName: 'มัส', submittedAt: '2026-08-27T03:00:00.000Z',
      committedAt: '2026-08-27T03:01:00.000Z',
      attachments: [{
        attachmentId: 'ATT-27', expenseId: 'EXP-202608-27', ordinal: 1,
        mediaType: 'image/jpeg', originalFileName: 'receipt.jpg',
      }],
    })

    const second = await store.listExpenseHistory(MONTH_KEY, first.nextCursor, 25)
    expect(second.expenses.map(({ expenseId }) => expenseId)).toEqual(['EXP-202608-02', 'EXP-202608-01'])
    expect(second.nextCursor).toBeNull()
    expect(finance.readMonth).toHaveBeenNthCalledWith(1, MONTH_KEY, [SUBMISSIONS_RANGE, ATTACHMENTS_RANGE])
    expect(finance.readMonth).toHaveBeenNthCalledWith(2, MONTH_KEY, [SUBMISSIONS_RANGE, ATTACHMENTS_RANGE])

    const serialized = JSON.stringify(first)
    for (const privateValue of [
      'STAFF_PRIVATE', 'root-private', 'private-file-', 'slot-private', 'workbook-private',
      'folder-private', 'audit-private', 'idempotency-private',
    ]) expect(serialized).not.toContain(privateValue)
  })

  it('rejects unknown cursors and sentinel overflow rows without widening the selected month read', async () => {
    const normal = createFinanceReadStore({ finance: financePort({
      submissions: [submissionRow()], attachments: [attachmentRow()],
    }) })
    await expect(normal.listExpenseHistory(MONTH_KEY, '2026-08-01T00:00:00.000Z|EXP-202608-MISSING', 25))
      .rejects.toEqual(expect.objectContaining({ code: 'EXPENSE_INVALID_CURSOR' }))

    const overflow = financePort({ submissions: Array.from({ length: 1_001 }, (_, index) => (
      submissionRow({ expenseId: `EXP-202608-${String(index).padStart(4, '0')}` })
    )) })
    await expect(createFinanceReadStore({ finance: overflow }).loadMonthlyExpenses(MONTH_KEY))
      .rejects.toEqual(expect.objectContaining({ code: 'EXPENSE_DATA_INTEGRITY_ERROR' }))
    expect(overflow.readMonth).toHaveBeenCalledWith(MONTH_KEY, [SUBMISSIONS_RANGE])
  })

  it('accepts an abandoned PREPARED recovery row as VOID without committedAt and keeps it ineffective', async () => {
    const abandoned = financePort({ submissions: [submissionRow({
      expenseId: 'EXP-202608-ABANDONED', recordState: 'VOID', committedAt: '', version: 2,
    })] })
    const store = createFinanceReadStore({ finance: abandoned })

    await expect(store.loadMonthlyExpenses(MONTH_KEY)).resolves.toEqual({
      monthKey: MONTH_KEY,
      clinicCommittedSatang: 0,
      doctorPersonalCommittedSatang: 0,
      clinicByCategorySatang: { BILL_DOCUMENT: 0, BOOK_CLINIC: 0 },
      effectiveExpenseCount: 0,
      unreviewed: true,
    })
    await expect(store.listExpenseHistory(MONTH_KEY, null, 25)).resolves.toEqual({
      expenses: [], nextCursor: null,
    })

    const incompleteCommit = financePort({ submissions: [submissionRow({
      expenseId: 'EXP-202608-INCOMPLETE', recordState: 'COMMITTED', committedAt: '',
    })] })
    await expect(createFinanceReadStore({ finance: incompleteCommit }).loadMonthlyExpenses(MONTH_KEY))
      .rejects.toEqual(expect.objectContaining({ code: 'EXPENSE_DATA_INTEGRITY_ERROR' }))
  })

  it('keeps locale-formatted numeric strings invalid instead of coercing financial cells', async () => {
    const finance = financePort({ submissions: [submissionRow({ amountSatang: '12,000' })] })

    await expect(createFinanceReadStore({ finance }).loadMonthlyExpenses(MONTH_KEY))
      .rejects.toEqual(expect.objectContaining({ code: 'EXPENSE_DATA_INTEGRITY_ERROR' }))
  })

  it('re-proves effective attachment membership before each private byte download', async () => {
    const finance = financePort({
      submissions: [
        submissionRow({
          expenseId: 'EXP-202608-OLD', category: 'BOOK_CLINIC', counterpartyName: null,
          paymentMethod: null, bookDailyKey: 'CLINIC:2026-08-29',
        }),
        submissionRow({
          expenseId: 'EXP-202608-NEW', category: 'BOOK_CLINIC', counterpartyName: null,
          paymentMethod: null, bookDailyKey: 'CLINIC:2026-08-29',
          supersedesExpenseId: 'EXP-202608-OLD', revision: 2,
        }),
      ],
      attachments: [
        attachmentRow({ attachmentId: 'ATT-OLD', expenseId: 'EXP-202608-OLD', privateFileId: 'file-old' }),
        attachmentRow({ attachmentId: 'ATT-NEW', expenseId: 'EXP-202608-NEW', privateFileId: 'file-new' }),
      ],
    })
    const store = createFinanceReadStore({ finance })

    await expect(store.getEvidence(MONTH_KEY, 'EXP-202608-OLD', 'ATT-OLD')).resolves.toBeNull()
    await expect(store.getEvidence(MONTH_KEY, 'EXP-202608-NEW', 'ATT-NEW')).resolves.toEqual({
      bytes: Buffer.from('private-image'), mimeType: 'image/jpeg',
    })
    expect(finance.readMonth).toHaveBeenCalledTimes(2)
    expect(finance.downloadExpenseFile).toHaveBeenCalledOnce()
    expect(finance.downloadExpenseFile).toHaveBeenCalledWith({
      monthKey: MONTH_KEY, expenseId: 'EXP-202608-NEW', fileId: 'file-new',
      expectedAttachment: {
        attachmentId: 'ATT-NEW', expenseId: 'EXP-202608-NEW', rootRequestId: 'root-private',
        ordinal: 1, mediaType: 'image/jpeg', originalFileName: 'receipt.jpg',
        privateFileId: 'file-new', deterministicName: `001-${'a'.repeat(64)}.jpg`,
        sizeBytes: 13, driveVersion: '1', slotClaimId: `SLOT-${'b'.repeat(64)}`,
        sha256: 'a'.repeat(64), uploadedByStaffId: 'STAFF_PRIVATE',
        uploadedAt: '2026-08-29T03:00:00.000Z',
      },
    })
  })

  it('returns a server-only current mutation context and rejects invalid month/limit inputs', async () => {
    const store = createFinanceReadStore({ finance: financePort({
      submissions: [submissionRow({
        expenseId: 'EXP-202608-CURRENT', category: 'BOOK_CLINIC', counterpartyName: null,
        paymentMethod: null, bookDailyKey: 'CLINIC:2026-08-29',
      })],
    }) })

    await expect(store.getExpenseMutationContext(MONTH_KEY, 'EXP-202608-CURRENT')).resolves.toEqual({
      expenseId: 'EXP-202608-CURRENT', expenseDate: '2026-08-29', monthKey: MONTH_KEY,
      category: 'BOOK_CLINIC', scope: 'CLINIC', bookDailyKey: 'CLINIC:2026-08-29',
      recordState: 'COMMITTED', revision: 1, version: 2,
    })
    await expect(store.loadMonthlyExpenses('2026-13')).rejects.toBeInstanceOf(FinanceReadStoreError)
    await expect(store.listExpenseHistory(MONTH_KEY, null, 24 as 25)).rejects.toEqual(
      expect.objectContaining({ code: 'EXPENSE_INVALID_CURSOR' }),
    )
  })
})

function financePort(input: {
  submissions?: unknown[][]
  attachments?: unknown[][]
} = {}): FinanceGoogleReadPorts & {
  readMaster: ReturnType<typeof vi.fn>
  readMonth: ReturnType<typeof vi.fn>
  downloadExpenseFile: ReturnType<typeof vi.fn>
} {
  return {
    readMaster: vi.fn(async () => ({})),
    readMonth: vi.fn(async (_monthKey: string, ranges: string[]) => Object.fromEntries(ranges.map((range) => [
      range,
      range.includes('EXPENSE_ATTACHMENTS') ? input.attachments ?? [] : input.submissions ?? [],
    ]))),
    downloadExpenseFile: vi.fn(async () => ({ bytes: Buffer.from('private-image'), mimeType: 'image/jpeg' as const })),
  }
}

function submissionRow(patch: Partial<Record<SubmissionField, unknown>> = {}): unknown[] {
  const value: Record<SubmissionField, unknown> = {
    expenseId: 'EXP-202608-BASE', expenseDate: '2026-08-29', monthKey: MONTH_KEY,
    category: 'BILL_DOCUMENT', scope: 'CLINIC', amountSatang: 10_000,
    counterpartyName: 'ร้านทดสอบ', description: 'ค่าใช้จ่าย', paymentMethod: 'TRANSFER',
    recordState: 'COMMITTED', bookDailyKey: null, revision: 1, supersedesExpenseId: null,
    submittedByStaffId: 'STAFF_PRIVATE', submittedByName: 'มัส',
    submittedAt: '2026-08-29T03:00:00.000Z', committedAt: '2026-08-29T03:01:00.000Z',
    updatedAt: '2026-08-29T03:01:00.000Z', version: 2, idempotencyKey: 'idempotency-private',
    ...patch,
  }
  return SUBMISSION_FIELDS.map((field) => value[field] ?? '')
}

function attachmentRow(patch: Partial<Record<AttachmentField, unknown>> = {}): unknown[] {
  const value: Record<AttachmentField, unknown> = {
    attachmentId: 'ATT-BASE', expenseId: 'EXP-202608-BASE', rootRequestId: 'root-private',
    ordinal: 1, mediaType: 'image/jpeg', originalFileName: 'receipt.jpg',
    privateFileId: 'private-file-base', deterministicName: `001-${'a'.repeat(64)}.jpg`,
    sizeBytes: 13, driveVersion: '1', slotClaimId: `SLOT-${'b'.repeat(64)}`,
    sha256: 'a'.repeat(64), uploadedByStaffId: 'STAFF_PRIVATE', uploadedAt: '2026-08-29T03:00:00.000Z',
    ...patch,
  }
  if (patch.sha256 !== undefined && patch.deterministicName === undefined) {
    value.deterministicName = `001-${String(value.sha256)}.jpg`
  }
  return ATTACHMENT_FIELDS.map((field) => value[field])
}

const SUBMISSION_FIELDS = [
  'expenseId', 'expenseDate', 'monthKey', 'category', 'scope', 'amountSatang', 'counterpartyName',
  'description', 'paymentMethod', 'recordState', 'bookDailyKey', 'revision', 'supersedesExpenseId',
  'submittedByStaffId', 'submittedByName', 'submittedAt', 'committedAt', 'updatedAt', 'version',
  'idempotencyKey',
] as const
type SubmissionField = typeof SUBMISSION_FIELDS[number]

const ATTACHMENT_FIELDS = [
  'attachmentId', 'expenseId', 'rootRequestId', 'ordinal', 'mediaType', 'originalFileName',
  'privateFileId', 'deterministicName', 'sizeBytes', 'driveVersion', 'slotClaimId', 'sha256',
  'uploadedByStaffId', 'uploadedAt',
] as const
type AttachmentField = typeof ATTACHMENT_FIELDS[number]
