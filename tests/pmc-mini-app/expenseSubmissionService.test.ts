import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ExpenseReceipt } from '../../shared/pmcExpense'
import type {
  ExpensePrepareResult,
  ExpensePrivateAttachment,
} from '../../shared/pmcMiniAppExpenseIngress'
import { ExpenseIngressClientError } from '../../server/pmc-mini-app/finance/ingressClient'
import type {
  ExpenseDriveSlotClaim,
  ExpenseStagingReceipt,
  ExpenseSubmissionLease,
  ExpenseSubmissionLeaseIntent,
} from '../../server/pmc-mini-app/finance/stagingStore'
import { ExpenseStagingError } from '../../server/pmc-mini-app/finance/stagingStore'
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
      'lease-acquire',
      'lease-renew', 'claim-1', 'lease-assert',
      'lease-renew', 'claim-2', 'lease-assert',
      'lease-renew', 'lease-assert',
      'ensure-folder',
      'lease-renew', 'lease-assert',
      'staging-get-1', 'claim-1', 'upload-1', 'register-1', 'verify-1', 'lease-assert',
      'lease-renew', 'lease-assert',
      'staging-get-2', 'claim-2', 'upload-2', 'register-2', 'verify-2', 'lease-assert',
      'lease-renew', 'lease-assert',
      'commit', 'lease-assert', 'lease-commit',
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

  it('recovers a byte-identical COMMIT after cleanup and process restart without staging or new files', async () => {
    const state = serviceState()
    const firstProcess = serviceFixture([], state)
    await expect(firstProcess.service.submit(firstProcess.input)).resolves.toEqual(firstProcess.receipt)
    expect(state.deletedObjectKeys.size).toBe(2)
    expect(firstProcess.finance.uploadExpenseImage).toHaveBeenCalledTimes(2)

    const restarted = serviceFixture([], state)
    await expect(restarted.service.submit(restarted.input)).resolves.toEqual(restarted.receipt)

    expect(restarted.staging.get).not.toHaveBeenCalled()
    expect(restarted.finance.uploadExpenseImage).not.toHaveBeenCalled()
    expect(restarted.finance.listVerifiedExpenseImages).toHaveBeenCalledOnce()
    expect(restarted.finance.ensureExpenseFolder).not.toHaveBeenCalled()
    expect(JSON.stringify(restarted.ingress.commit.mock.calls[0]?.[0].payload.attachments))
      .toBe(JSON.stringify(firstProcess.ingress.commit.mock.calls[0]?.[0].payload.attachments))
    expect(state.driveAttachments).toHaveLength(2)
  })

  it('takes over an expired partial manifest, blocks the stale owner, and completes missing slots once', async () => {
    const state = serviceState()
    state.failUploadOrdinalOnce = 2
    const firstProcess = serviceFixture([], state, 'lease-owner-process-a')

    await expect(firstProcess.service.submit(firstProcess.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(state.driveAttachments).toHaveLength(1)
    expect(state.lease).toMatchObject({ ownerId: 'lease-owner-process-a', state: 'ACTIVE' })

    const secondProcess = serviceFixture([], state, 'lease-owner-process-b')
    await expect(secondProcess.service.submit(secondProcess.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(secondProcess.finance.ensureExpenseFolder).not.toHaveBeenCalled()
    expect(secondProcess.finance.uploadExpenseImage).not.toHaveBeenCalled()

    state.now = Date.parse(state.lease!.expiresAt) + 1
    await secondProcess.staging.acquireSubmissionLease({
      ...leaseIntent(state.lease!),
      ownerId: 'lease-owner-process-b',
    })
    await expect(firstProcess.service.submit(firstProcess.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(firstProcess.ingress.commit).not.toHaveBeenCalled()

    await expect(secondProcess.service.submit(secondProcess.input)).resolves.toEqual(secondProcess.receipt)
    expect(state.lease).toMatchObject({ ownerId: 'lease-owner-process-b', state: 'COMMITTED' })
    expect(state.driveAttachments).toHaveLength(2)
    expect(new Set(state.driveAttachments.map(({ privateFileId }) => privateFileId)).size).toBe(2)

    const replayProcess = serviceFixture([], state, 'lease-owner-process-c')
    await expect(replayProcess.service.submit(replayProcess.input)).resolves.toEqual(replayProcess.receipt)
    expect(replayProcess.finance.uploadExpenseImage).not.toHaveBeenCalled()
    expect(JSON.stringify(replayProcess.ingress.commit.mock.calls[0]?.[0].payload.attachments))
      .toBe(JSON.stringify(secondProcess.ingress.commit.mock.calls[0]?.[0].payload.attachments))
  })

  it('registers only the takeover winner and safely deletes a stale late Drive create', async () => {
    const state = serviceState()
    let markStarted!: () => void
    let releaseLateCreate!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const wait = new Promise<void>((resolve) => { releaseLateCreate = resolve })
    state.delayedUpload = {
      ownerId: 'lease-owner-process-a', ordinal: 1, markStarted, wait,
    }
    const firstProcess = serviceFixture([], state, 'lease-owner-process-a')
    const first = firstProcess.service.submit(firstProcess.input)
    const firstExpectation = expect(first).rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })
    await started

    state.now += 300_001
    const secondProcess = serviceFixture([], state, 'lease-owner-process-b')
    await expect(secondProcess.service.submit(secondProcess.input)).resolves.toEqual(secondProcess.receipt)
    releaseLateCreate()
    await firstExpectation

    expect(state.claims.get('EXP-202608-0001:1')).toMatchObject({
      state: 'REGISTERED', leaseOwnerId: 'lease-owner-process-b', registeredFileId: 'private-file-1',
    })
    expect(state.driveAttachments.map(({ privateFileId }) => privateFileId).sort()).toEqual([
      'private-file-1', 'private-file-2',
    ])
    expect(firstProcess.finance.deleteExpenseFileIfUnregistered).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'late-private-file-1', readCurrentClaim: expect.any(Function),
    }))
    expect(secondProcess.ingress.commit).toHaveBeenCalledTimes(1)
  })

  it('recovers a REGISTERED same-file claim when register persistence succeeds but its response is lost', async () => {
    const state = serviceState()
    const fixture = serviceFixture([], state)
    const register = vi.mocked(fixture.staging.registerDriveSlotFile)
    const persistRegister = register.getMockImplementation()!
    register.mockImplementationOnce(async (input) => {
      await persistRegister(input)
      throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_STALE')
    })

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(fixture.finance.deleteExpenseFileIfUnregistered).not.toHaveBeenCalled()
    expect(state.claims.get('EXP-202608-0001:1')).toMatchObject({
      state: 'REGISTERED', registeredFileId: 'private-file-1',
    })
    expect(state.driveAttachments).toHaveLength(2)
    expect(fixture.ingress.commit).toHaveBeenCalledOnce()
  })

  it('never deletes after register persistence when the current claim re-read fails, and replay converges', async () => {
    const state = serviceState()
    const fixture = serviceFixture([], state)
    const register = vi.mocked(fixture.staging.registerDriveSlotFile)
    const persistRegister = register.getMockImplementation()!
    register.mockImplementationOnce(async (input) => {
      await persistRegister(input)
      throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_STALE')
    })
    vi.mocked(fixture.staging.readDriveSlotClaim)
      .mockRejectedValueOnce(new ExpenseStagingError('EXPENSE_DRIVE_SLOT_STALE'))

    await expect(fixture.service.submit(fixture.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(fixture.finance.deleteExpenseFileIfUnregistered).not.toHaveBeenCalled()
    expect(state.driveAttachments.map(({ privateFileId }) => privateFileId)).toContain('private-file-1')

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(state.driveAttachments).toHaveLength(2)
    expect(new Set(state.driveAttachments.map(({ privateFileId }) => privateFileId)).size).toBe(2)
  })

  it('never deletes from a CLAIMED null snapshot when the winner registers that same file before cleanup', async () => {
    const state = serviceState()
    const fixture = serviceFixture([], state)
    vi.mocked(fixture.staging.registerDriveSlotFile)
      .mockRejectedValueOnce(new ExpenseStagingError('EXPENSE_DRIVE_SLOT_STALE'))
    const readClaim = vi.mocked(fixture.staging.readDriveSlotClaim)
    const readCurrent = readClaim.getMockImplementation()!
    readClaim.mockImplementationOnce(async (intent) => {
      const claimed = await readCurrent(intent)
      const key = `${intent.expenseId}:${intent.ordinal}`
      const current = state.claims.get(key)!
      state.claims.set(key, {
        ...current,
        generation: String(Number(current.generation) + 1),
        state: 'REGISTERED',
        registeredFileId: state.driveAttachments[0]!.privateFileId,
      })
      return claimed
    })

    await expect(fixture.service.submit(fixture.input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    expect(fixture.finance.deleteExpenseFileIfUnregistered).not.toHaveBeenCalled()
    expect(state.claims.get('EXP-202608-0001:1')).toMatchObject({
      state: 'REGISTERED', registeredFileId: 'private-file-1',
    })
    expect(state.driveAttachments.map(({ privateFileId }) => privateFileId)).toContain('private-file-1')

    await expect(fixture.service.submit(fixture.input)).resolves.toEqual(fixture.receipt)
    expect(state.driveAttachments).toHaveLength(2)
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

function serviceFixture(
  events: string[] = [],
  state = serviceState(),
  ownerId = 'lease-owner-process-a',
) {
  const stagingReceipts = stagedReceipts()
  const prepared: ExpensePrepareResult = {
    commandType: 'PREPARE_EXPENSE',
    expenseId: 'EXP-202608-0001',
    monthKey: '2026-08',
    recordState: 'PREPARED',
    version: 1,
    expectedRevision: 0,
    expectedAttachmentCount: 2,
    expectedManifestHash: expenseAttachmentManifestHash(stagingReceipts),
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
    uploadExpenseImage: vi.fn(async (input: {
      ordinal: number
      expenseId: string
      rootRequestId: string
      mimeType: 'image/jpeg' | 'image/png'
      originalFileName: string
      deterministicName: string
      bytes: Buffer
      sha256: string
      uploadedByStaffId: string
      uploadedAt: string
      attachmentId: string
      slotClaim: ExpenseDriveSlotClaim
      allowClaimReplayCreate?: boolean
    }) => {
      events.push(`upload-${input.ordinal}`)
      if (state.failUploadOrdinalOnce === input.ordinal) {
        state.failUploadOrdinalOnce = null
        throw new Error('controlled partial upload failure')
      }
      if (
        state.delayedUpload
        && state.delayedUpload.ownerId === input.slotClaim.leaseOwnerId
        && state.delayedUpload.ordinal === input.ordinal
      ) {
        const delayed = state.delayedUpload
        state.delayedUpload = null
        delayed.markStarted()
        await delayed.wait
        const late = attachmentFromUpload(input, `late-private-file-${input.ordinal}`)
        state.driveAttachments.push(late)
        return { ...late }
      }
      const existing = state.driveAttachments.find(({ ordinal }) => ordinal === input.ordinal)
      if (existing) return { ...existing }
      if (input.slotClaim.state === 'REGISTERED') {
        const registered = state.driveAttachments.find(({ privateFileId }) => (
          privateFileId === input.slotClaim.registeredFileId
        ))
        if (!registered) throw new Error('registered Drive file is missing')
        return { ...registered }
      }
      const attachment = attachmentFromUpload(input, `private-file-${input.ordinal}`)
      state.driveAttachments.push(attachment)
      return { ...attachment }
    }),
    verifyExpenseFile: vi.fn(async (input: { fileId: string; expectedAttachment?: ExpensePrivateAttachment }) => {
      events.push(`verify-${input.fileId.endsWith('-1') ? 1 : 2}`)
      const existing = state.driveAttachments.find(({ privateFileId }) => privateFileId === input.fileId)
      if (!existing || JSON.stringify(existing) !== JSON.stringify(input.expectedAttachment)) {
        throw new Error('private file mismatch')
      }
    }),
    listVerifiedExpenseImages: vi.fn(async () => {
      if (state.driveAttachments.length < 1) throw new Error('private files incomplete')
      return state.driveAttachments.map((attachment) => ({ ...attachment }))
    }),
    deleteExpenseFileIfUnregistered: vi.fn(async (input: {
      fileId: string
      expectedAttachment: ExpensePrivateAttachment
      readCurrentClaim: () => Promise<ExpenseDriveSlotClaim>
    }) => {
      const initial = await input.readCurrentClaim()
      if (
        initial.state !== 'REGISTERED'
        || initial.registeredFileId === null
        || input.fileId === initial.registeredFileId
      ) return
      const current = await input.readCurrentClaim()
      if (
        current.state !== 'REGISTERED'
        || current.registeredFileId !== initial.registeredFileId
      ) return
      state.driveAttachments = state.driveAttachments.filter(({ privateFileId }) => privateFileId !== input.fileId)
      events.push(`drive-delete-${input.fileId}`)
    }),
    downloadExpenseFile: vi.fn(),
  }
  const staging = {
    put: vi.fn(),
    get: vi.fn(async (objectKey: string) => {
      const selected = stagingReceipts.find((item) => item.objectKey === objectKey)!
      if (state.deletedObjectKeys.has(objectKey)) throw new Error('staging object deleted')
      events.push(`staging-get-${selected.ordinal}`)
      return { ...selected, bytes: Buffer.from(bytesByKey.get(objectKey)!) }
    }),
    deleteVerified: vi.fn(async (objectKey: string) => {
      const selected = stagingReceipts.find((item) => item.objectKey === objectKey)!
      state.deletedObjectKeys.add(objectKey)
      events.push(`staging-delete-${selected.ordinal}`)
    }),
    claimDriveSlot: vi.fn(async (claimInput: {
      rootRequestId: string
      expenseId: string
      ordinal: number
      sha256: string
      mimeType: 'image/jpeg' | 'image/png'
      deterministicName: string
      lease: ExpenseSubmissionLease
    }) => {
      events.push(`claim-${claimInput.ordinal}`)
      assertFakeLease(state, claimInput.lease)
      const key = `${claimInput.expenseId}:${claimInput.ordinal}`
      const existing = state.claims.get(key)
      const { lease, ...intent } = claimInput
      if (existing?.state === 'REGISTERED') return { ...existing }
      if (existing && existing.leaseGeneration === lease.generation && existing.leaseOwnerId === lease.ownerId) {
        return { ...existing }
      }
      const claimId = `SLOT-${createHash('sha256').update(JSON.stringify(intent), 'utf8').digest('hex')}`
      const claim = {
        objectKey: `expense-drive-slots/${claimInput.expenseId}/${String(claimInput.ordinal).padStart(3, '0')}.json`,
        claimId,
        generation: String(Number(existing?.generation ?? 3) + 1),
        createdAt: existing?.createdAt ?? '2026-08-29T10:00:00.000Z',
        updatedAt: new Date(state.now).toISOString(),
        state: 'CLAIMED' as const,
        leaseId: lease.leaseId,
        leaseOwnerId: lease.ownerId,
        leaseGeneration: lease.generation,
        registeredFileId: null,
        ...intent,
      }
      state.claims.set(key, claim)
      return { ...claim }
    }),
    registerDriveSlotFile: vi.fn(async (input: {
      claim: ExpenseDriveSlotClaim
      lease: ExpenseSubmissionLease
      fileId: string
    }) => {
      events.push(`register-${input.claim.ordinal}`)
      assertFakeLease(state, input.lease)
      const key = `${input.claim.expenseId}:${input.claim.ordinal}`
      const current = state.claims.get(key)
      if (current?.state === 'REGISTERED') {
        if (current.registeredFileId !== input.fileId) {
          throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
        }
        return { ...current }
      }
      if (!current || current.generation !== input.claim.generation
        || current.leaseGeneration !== input.lease.generation
        || current.leaseOwnerId !== input.lease.ownerId) {
        throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_STALE')
      }
      const registered: ExpenseDriveSlotClaim = {
        ...current,
        generation: String(Number(current.generation) + 1),
        updatedAt: new Date(state.now).toISOString(),
        state: 'REGISTERED',
        registeredFileId: input.fileId,
      }
      state.claims.set(key, registered)
      return { ...registered }
    }),
    readDriveSlotClaim: vi.fn(async (intent: {
      expenseId: string
      ordinal: number
    }) => {
      const claim = state.claims.get(`${intent.expenseId}:${intent.ordinal}`)
      if (!claim) throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
      return { ...claim }
    }),
    acquireSubmissionLease: vi.fn(async (
      request: ExpenseSubmissionLeaseIntent & { ownerId: string },
    ) => {
      events.push('lease-acquire')
      return acquireFakeLease(state, request)
    }),
    renewSubmissionLease: vi.fn(async (lease: ExpenseSubmissionLease) => {
      events.push('lease-renew')
      assertFakeLease(state, lease)
      state.lease = {
        ...lease,
        generation: String(Number(lease.generation) + 1),
        updatedAt: new Date(state.now).toISOString(),
        expiresAt: new Date(state.now + 300_000).toISOString(),
      }
      return { ...state.lease }
    }),
    assertSubmissionLease: vi.fn(async (lease: ExpenseSubmissionLease) => {
      events.push('lease-assert')
      assertFakeLease(state, lease)
    }),
    commitSubmissionLease: vi.fn(async (lease: ExpenseSubmissionLease) => {
      events.push('lease-commit')
      assertFakeLease(state, lease)
      state.lease = {
        ...lease,
        state: 'COMMITTED',
        generation: String(Number(lease.generation) + 1),
        updatedAt: new Date(state.now).toISOString(),
      }
      return { ...state.lease }
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
    service: createExpenseSubmissionService({ ingress, finance, staging }, { ownerId }),
    input,
    stagingReceipts,
    prepared,
    receipt,
    ingress,
    finance,
    staging,
  }
}

function attachmentFromUpload(input: {
  attachmentId: string
  expenseId: string
  rootRequestId: string
  ordinal: number
  mimeType: 'image/jpeg' | 'image/png'
  originalFileName: string
  deterministicName: string
  bytes: Buffer
  sha256: string
  uploadedByStaffId: string
  uploadedAt: string
  slotClaim: ExpenseDriveSlotClaim
}, privateFileId: string): ExpensePrivateAttachment {
  return {
    attachmentId: input.attachmentId,
    expenseId: input.expenseId,
    rootRequestId: input.rootRequestId,
    ordinal: input.ordinal,
    mediaType: input.mimeType,
    originalFileName: input.originalFileName,
    privateFileId,
    deterministicName: input.deterministicName,
    sizeBytes: input.bytes.length,
    driveVersion: String(6 + input.ordinal),
    slotClaimId: input.slotClaim.claimId,
    sha256: input.sha256,
    uploadedByStaffId: input.uploadedByStaffId,
    uploadedAt: input.uploadedAt,
  }
}

function serviceState(): {
  claims: Map<string, ExpenseDriveSlotClaim>
  driveAttachments: ExpensePrivateAttachment[]
  deletedObjectKeys: Set<string>
  now: number
  lease: ExpenseSubmissionLease | null
  failUploadOrdinalOnce: number | null
  delayedUpload: null | {
    ownerId: string
    ordinal: number
    markStarted: () => void
    wait: Promise<void>
  }
} {
  return {
    claims: new Map(),
    driveAttachments: [],
    deletedObjectKeys: new Set(),
    now: Date.parse('2026-08-29T10:00:00.000Z'),
    lease: null,
    failUploadOrdinalOnce: null,
    delayedUpload: null,
  }
}

function acquireFakeLease(
  state: ReturnType<typeof serviceState>,
  request: ExpenseSubmissionLeaseIntent & { ownerId: string },
): ExpenseSubmissionLease {
  const intent = {
    rootRequestId: request.rootRequestId,
    expenseId: request.expenseId,
    expectedManifestHash: request.expectedManifestHash,
    staffId: request.staffId,
    slots: request.slots.map((slot) => ({ ...slot })),
  }
  const leaseId = `LEASE-${createHash('sha256').update(JSON.stringify(intent), 'utf8').digest('hex')}`
  if (!state.lease) {
    const capturedAt = new Date(state.now).toISOString()
    state.lease = {
      objectKey: `expense-submission-leases/${request.expenseId}.json`,
      leaseId,
      ...intent,
      ownerId: request.ownerId,
      state: 'ACTIVE',
      generation: '4',
      createdAt: capturedAt,
      updatedAt: capturedAt,
      expiresAt: new Date(state.now + 300_000).toISOString(),
    }
    return { ...state.lease }
  }
  if (state.lease.leaseId !== leaseId) {
    throw new ExpenseStagingError('EXPENSE_SUBMISSION_LEASE_CONFLICT')
  }
  if (state.lease.state === 'COMMITTED') return { ...state.lease }
  if (Date.parse(state.lease.expiresAt) > state.now && state.lease.ownerId !== request.ownerId) {
    throw new ExpenseStagingError('EXPENSE_SUBMISSION_LEASE_UNAVAILABLE')
  }
  if (Date.parse(state.lease.expiresAt) <= state.now) {
    state.lease = {
      ...state.lease,
      ownerId: request.ownerId,
      generation: String(Number(state.lease.generation) + 1),
      updatedAt: new Date(state.now).toISOString(),
      expiresAt: new Date(state.now + 300_000).toISOString(),
    }
  }
  return { ...state.lease }
}

function assertFakeLease(
  state: ReturnType<typeof serviceState>,
  expected: ExpenseSubmissionLease,
): void {
  if (
    !state.lease
    || state.lease.generation !== expected.generation
    || state.lease.ownerId !== expected.ownerId
    || state.lease.state !== 'ACTIVE'
    || Date.parse(state.lease.expiresAt) <= state.now
  ) throw new ExpenseStagingError('EXPENSE_SUBMISSION_LEASE_STALE')
}

function leaseIntent(lease: ExpenseSubmissionLease): ExpenseSubmissionLeaseIntent {
  return {
    rootRequestId: lease.rootRequestId,
    expenseId: lease.expenseId,
    expectedManifestHash: lease.expectedManifestHash,
    staffId: lease.staffId,
    slots: lease.slots.map((slot) => ({ ...slot })),
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
