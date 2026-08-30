import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ExpenseReceipt } from '../../shared/pmcExpense'
import type { ExpensePrepareResult } from '../../shared/pmcMiniAppExpenseIngress'
import { ExpenseIngressClientError } from '../../server/pmc-mini-app/finance/ingressClient'
import type { ExpenseStagingReceipt } from '../../server/pmc-mini-app/finance/stagingStore'
import {
  createExpenseSubmissionService,
  expenseAttachmentManifestHash,
  type ExpenseSubmissionInput,
} from '../../server/pmc-mini-app/finance/submissionService'

describe('expense submission orchestration', () => {
  it('runs PREPARE, deterministic private persistence, COMMIT, then best-effort staging cleanup in exact order', async () => {
    const events: string[] = []
    const fixture = serviceFixture(events)

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(events).toEqual([
      'prepare',
      'ensure-folder',
      'staging-get-1', 'upload-1', 'verify-1',
      'staging-get-2', 'upload-2', 'verify-2',
      'commit',
      'staging-delete-1', 'staging-delete-2',
    ])

    expect(fixture.ingress.prepare).toHaveBeenCalledWith(expect.objectContaining({
      rootRequestId: 'expense-request-1',
      commandIdempotencyKey: 'expense-request-1:prepare',
      staffId: 'ADMIN_01',
      commandType: 'PREPARE_EXPENSE',
      payload: expect.objectContaining({
        bookDailyKey: 'CLINIC:2026-08-29',
        expectedAttachmentCount: 2,
        expectedRevision: 0,
        expectedManifestHash: expenseAttachmentManifestHash(fixture.stagingReceipts),
      }),
    }))
    expect(fixture.finance.uploadExpenseImage.mock.calls.map(([input]) => input.deterministicName)).toEqual([
      `001-${fixture.stagingReceipts[0]!.sha256}.jpg`,
      `002-${fixture.stagingReceipts[1]!.sha256}.png`,
    ])
    expect(fixture.ingress.commit).toHaveBeenCalledWith(expect.objectContaining({
      rootRequestId: 'expense-request-1',
      commandIdempotencyKey: 'expense-request-1:commit',
      commandType: 'COMMIT_EXPENSE',
      payload: expect.objectContaining({
        expenseId: 'EXP-202608-0001',
        expectedVersion: 1,
        expectedRevision: 0,
        attachments: [
          expect.objectContaining({
            expenseId: 'EXP-202608-0001', ordinal: 1, mediaType: 'image/jpeg',
            originalFileName: 'receipt one.jpg', privateFileId: 'private-file-1',
            sha256: fixture.stagingReceipts[0]!.sha256, uploadedByStaffId: 'ADMIN_01',
            uploadedAt: fixture.stagingReceipts[0]!.createdAt,
          }),
          expect.objectContaining({
            expenseId: 'EXP-202608-0001', ordinal: 2, mediaType: 'image/png',
            originalFileName: 'receipt-two.png', privateFileId: 'private-file-2',
            sha256: fixture.stagingReceipts[1]!.sha256, uploadedByStaffId: 'ADMIN_01',
            uploadedAt: fixture.stagingReceipts[1]!.createdAt,
          }),
        ],
      }),
    }))
  })

  it('hashes the canonical ordered attachment projection expected by COMMIT authority', () => {
    const receipts = stagedReceipts()
    const canonical = JSON.stringify([
      { ordinal: 1, mediaType: 'image/jpeg', originalFileName: 'receipt one.jpg', sha256: receipts[0]!.sha256 },
      { ordinal: 2, mediaType: 'image/png', originalFileName: 'receipt-two.png', sha256: receipts[1]!.sha256 },
    ])

    expect(expenseAttachmentManifestHash(receipts)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    )
  })

  it('replays a lost PREPARE response without creating a folder or consuming staging before retry', async () => {
    const fixture = serviceFixture()
    fixture.ingress.prepare
      .mockRejectedValueOnce(new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(fixture.prepared)

    await expect(fixture.service.submit(fixture.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(fixture.finance.ensureExpenseFolder).not.toHaveBeenCalled()
    expect(fixture.staging.get).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(fixture.ingress.prepare).toHaveBeenCalledTimes(2)
    expect(fixture.finance.ensureExpenseFolder).toHaveBeenCalledTimes(1)
  })

  it('retries a lost COMMIT response without creating a second receipt, folder, or file identity', async () => {
    const fixture = serviceFixture()
    fixture.ingress.commit
      .mockRejectedValueOnce(new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(fixture.receipt)

    await expect(fixture.service.submit(fixture.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(fixture.ingress.prepare).toHaveBeenCalledTimes(2)
    expect(fixture.ingress.commit).toHaveBeenCalledTimes(2)
    expect(fixture.finance.ensureExpenseFolder).toHaveBeenCalledTimes(2)
    expect(fixture.finance.uploadExpenseImage).toHaveBeenCalledTimes(4)
    expect(new Set(fixture.finance.uploadExpenseImage.mock.calls.map(([arg]) => arg.deterministicName)).size).toBe(2)
    expect(new Set(fixture.ingress.commit.mock.calls.map(([command]) => JSON.stringify(command.payload.attachments))).size).toBe(1)
    expect(fixture.staging.deleteVerified).toHaveBeenCalledTimes(2)
  })

  it('leaves PREPARED out of success and preserves reusable staging after an earlier upload failure', async () => {
    const fixture = serviceFixture()
    fixture.finance.uploadExpenseImage
      .mockRejectedValueOnce(Object.assign(new Error('private provider detail'), {
        code: 'EXPENSE_STORAGE_UNAVAILABLE',
      }))

    await expect(fixture.service.submit(fixture.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      message: 'Expense submission failed: EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(fixture.ingress.commit).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(fixture.staging.get).toHaveBeenCalledTimes(3)
  })

  it('does not change a durable success when verified staging cleanup fails', async () => {
    const fixture = serviceFixture()
    fixture.staging.deleteVerified.mockRejectedValue(new Error('private cleanup detail'))

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(fixture.staging.deleteVerified).toHaveBeenCalledTimes(2)
  })

  it('fails safely when staged bytes or the returned receipt do not match the prepared intent', async () => {
    const poisoned = serviceFixture()
    poisoned.staging.get.mockResolvedValueOnce({
      ...poisoned.stagingReceipts[0]!,
      bytes: Buffer.from('different private bytes'),
    })
    await expect(poisoned.service.submit(poisoned.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      message: expect.not.stringContaining('different private bytes'),
    })
    expect(poisoned.ingress.commit).not.toHaveBeenCalled()
    expect(poisoned.staging.deleteVerified).not.toHaveBeenCalled()

    const mismatch = serviceFixture()
    mismatch.ingress.commit.mockResolvedValue({ ...mismatch.receipt, amountSatang: 99_999 })
    await expect(mismatch.service.submit(mismatch.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(mismatch.staging.deleteVerified).not.toHaveBeenCalled()
  })
})

function serviceFixture(events: string[] = []) {
  const stagingReceipts = stagedReceipts()
  const prepared: ExpensePrepareResult = {
    commandType: 'PREPARE_EXPENSE',
    expenseId: 'EXP-202608-0001',
    monthKey: '2026-08',
    recordState: 'PREPARED',
    version: 1,
    expectedRevision: 0,
  }
  const receipt: ExpenseReceipt = {
    expenseId: 'EXP-202608-0001',
    receiptNumber: 'EXP-202608-0001',
    expenseDate: '2026-08-29',
    monthKey: '2026-08',
    category: 'BOOK_CLINIC',
    scope: 'CLINIC',
    amountSatang: 12_000,
    recordState: 'COMMITTED',
    revision: 1,
    committedAt: '2026-08-29T10:02:00.000Z',
    unreviewed: true,
  }
  const bytesByKey = new Map(stagingReceipts.map((item, index) => [item.objectKey, imageBytes(index + 1)]))
  const ingress = {
    prepare: vi.fn(async () => { events.push('prepare'); return prepared }),
    commit: vi.fn(async () => { events.push('commit'); return receipt }),
  }
  const finance = {
    readMaster: vi.fn(),
    readMonth: vi.fn(),
    ensureExpenseFolder: vi.fn(async () => { events.push('ensure-folder'); return 'expense-folder-1' }),
    uploadExpenseImage: vi.fn(async (input: { ordinal: number }) => {
      events.push(`upload-${input.ordinal}`)
      return `private-file-${input.ordinal}`
    }),
    verifyExpenseFile: vi.fn(async (input: { fileId: string }) => {
      events.push(`verify-${input.fileId.endsWith('-1') ? 1 : 2}`)
    }),
    downloadExpenseFile: vi.fn(),
  }
  const staging = {
    put: vi.fn(),
    get: vi.fn(async (objectKey: string) => {
      const selected = stagingReceipts.find((item) => item.objectKey === objectKey)!
      events.push(`staging-get-${selected.ordinal}`)
      return { ...selected, bytes: Buffer.from(bytesByKey.get(objectKey)!) }
    }),
    deleteVerified: vi.fn(async (objectKey: string) => {
      const selected = stagingReceipts.find((item) => item.objectKey === objectKey)!
      events.push(`staging-delete-${selected.ordinal}`)
    }),
  }
  const input: ExpenseSubmissionInput = {
    rootRequestId: 'expense-request-1',
    staffId: 'ADMIN_01',
    expenseDate: '2026-08-29',
    category: 'BOOK_CLINIC',
    amountSatang: 12_000,
    counterpartyName: null,
    description: 'สมุดประจำวันที่ 29',
    paymentMethod: null,
    expectedRevision: 0,
    stagingReceipts,
  }
  return {
    service: createExpenseSubmissionService({ ingress, finance, staging }),
    input,
    stagingReceipts,
    prepared,
    receipt,
    ingress,
    finance,
    staging,
  }
}

function stagedReceipts(): ExpenseStagingReceipt[] {
  return [
    stagingReceipt(1, 'image/jpeg', 'receipt one.jpg'),
    stagingReceipt(2, 'image/png', 'receipt-two.png'),
  ]
}

function stagingReceipt(
  ordinal: number,
  mimeType: 'image/jpeg' | 'image/png',
  originalFileName: string,
): ExpenseStagingReceipt {
  const bytes = imageBytes(ordinal)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  return {
    objectKey: `expenses/expense-request-1/${ordinal}-${sha256}.${extension}`,
    sizeBytes: bytes.length,
    mimeType,
    sha256,
    ordinal,
    originalFileName,
    createdAt: `2026-08-29T10:0${ordinal}:00.000Z`,
  }
}

function imageBytes(ordinal: number): Buffer {
  return Buffer.from(`verified-staging-image-${ordinal}`)
}
