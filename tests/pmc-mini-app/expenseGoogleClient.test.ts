import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  createFinanceGooglePorts,
  type FinanceGoogleFactory,
} from '../../server/pmc-mini-app/finance/googleClient'
import { createFinanceReadStore } from '../../server/pmc-mini-app/finance/readStore'
import type { ExpensePrivateAttachment } from '../../shared/pmcMiniAppExpenseIngress'

const MONTH_KEY = '2026-08'
const EXPENSE_ID = 'EXP-202608-0001'

describe('private finance Google ports', () => {
  it.each([true, undefined])(
    'rejects incompleteSearch=%s before trusting unique expense folders',
    async (incompleteSearch) => {
      const fake = financeGoogleFake()
      fake.setIncompleteSearch(incompleteSearch)
      await expect(createFinanceGooglePorts(config(), fake.factory)
        .ensureExpenseFolder(MONTH_KEY, EXPENSE_ID))
        .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
      expect(fake.driveCreates).not.toHaveBeenCalled()
    },
  )

  it.each([true, undefined])(
    'rejects incompleteSearch=%s before trusting unique upload slots',
    async (incompleteSearch) => {
      const fake = financeGoogleFake()
      const ports = createFinanceGooglePorts(config(), fake.factory)
      const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
      const bytes = await jpeg()
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      fake.setIncompleteSearch(incompleteSearch)
      await expect(ports.uploadExpenseImage(claimedUpload({
        parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
      }))).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
      expect(fake.driveCreates.mock.calls.filter(([request]) => request.media)).toHaveLength(0)
    },
  )

  it.each([true, undefined])(
    'rejects incompleteSearch=%s before trusting reconstructed siblings',
    async (incompleteSearch) => {
      const fake = financeGoogleFake()
      const ports = createFinanceGooglePorts(config(), fake.factory)
      const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
      const bytes = await jpeg()
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const upload = claimedUpload({
        parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
      })
      const attachment = await ports.uploadExpenseImage(upload)
      fake.setIncompleteSearch(incompleteSearch)
      await expect(ports.listVerifiedExpenseImages(MONTH_KEY, EXPENSE_ID, [{
        claim: { ...upload.slotClaim, state: 'REGISTERED', registeredFileId: attachment.privateFileId },
        expectedAttachment: attachmentIdentity(attachment),
        readCurrentClaim: async () => ({
          ...upload.slotClaim, state: 'REGISTERED' as const, registeredFileId: attachment.privateFileId,
        }),
      }]))
        .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
    },
  )

  it('uses ADC scopes and resolves every master/month read from configured private containment and the master index', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)

    await expect(ports.readMaster(["'EXPENSE_REQUESTS'!A2:J"])).resolves.toEqual({
      "'EXPENSE_REQUESTS'!A2:J": [['request-1']],
    })
    await expect(ports.readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"])).resolves.toEqual({
      "'EXPENSE_SUBMISSIONS'!A2:T": [['EXP-202608-0001']],
    })

    expect(fake.scopes).toEqual([[
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ]])
    expect(fake.sheetReads.mock.calls.map(([input]) => input.spreadsheetId)).toEqual([
      'finance-master',
      'finance-master',
      'ledger-2026-08',
    ])
    expect(JSON.stringify(fake.sheetReads.mock.calls)).not.toContain('callerSpreadsheetId')
  })

  it('decodes Apps Script literal-prefixed cells in the monthly index', async () => {
    const fake = financeGoogleFake()
    fake.indexRows[0] = fake.indexRows[0]!.map((value) => (
      typeof value === 'string' ? `\u200c${value}` : value
    ))
    const ports = createFinanceGooglePorts(config(), fake.factory)

    await expect(ports.readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .resolves.toEqual({ "'EXPENSE_SUBMISSIONS'!A2:T": [['EXP-202608-0001']] })
  })

  it('requests unformatted Sheet values and preserves live-like numeric cells for strict expense parsing', async () => {
    const fake = financeGoogleFake()
    fake.setMonthRows('EXPENSE_SUBMISSIONS', [committedSubmissionRow()])
    const store = createFinanceReadStore({ finance: createFinanceGooglePorts(config(), fake.factory) })

    await expect(store.loadMonthlyExpenses(MONTH_KEY)).resolves.toMatchObject({
      clinicCommittedSatang: 12_000,
      effectiveExpenseCount: 1,
    })
    expect(fake.sheetReads.mock.calls).not.toHaveLength(0)
    for (const [request] of fake.sheetReads.mock.calls) {
      expect(request).toMatchObject({
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      })
    }
  })

  it('fails closed for duplicate index rows or any non-private/wrong direct ancestor resource', async () => {
    const duplicateIndex = financeGoogleFake()
    duplicateIndex.indexRows.push([...duplicateIndex.indexRows[0]!])
    await expect(createFinanceGooglePorts(config(), duplicateIndex.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const outsideMaster = financeGoogleFake()
    outsideMaster.item('finance-master').parents = ['outside-folder']
    await expect(createFinanceGooglePorts(config(), outsideMaster.factory)
      .readMaster(["'EXPENSE_REQUESTS'!A2:J"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const publicMonth = financeGoogleFake()
    publicMonth.item('month-2026-08').permissions = [{ id: 'public', type: 'anyone', role: 'reader' }]
    await expect(createFinanceGooglePorts(config(), publicMonth.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const wrongLedgerType = financeGoogleFake()
    wrongLedgerType.item('ledger-2026-08').mimeType = 'application/pdf'
    await expect(createFinanceGooglePorts(config(), wrongLedgerType.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })
  })

  it('creates exactly one deterministic expenseId folder and rejects duplicate or mismatched identities', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)

    const first = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const retry = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)

    expect(retry).toBe(first)
    expect(fake.driveCreates).toHaveBeenCalledTimes(1)
    expect(fake.item(first)).toMatchObject({
      name: EXPENSE_ID,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['month-2026-08'],
      appProperties: {
        pmcExpenseId: EXPENSE_ID,
        pmcExpenseMonthKey: MONTH_KEY,
      },
    })

    const duplicate = financeGoogleFake()
    duplicate.addExpenseFolder('expense-folder-a')
    duplicate.addExpenseFolder('expense-folder-b')
    await expect(createFinanceGooglePorts(config(), duplicate.factory)
      .ensureExpenseFolder(MONTH_KEY, EXPENSE_ID))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })

    const mismatched = financeGoogleFake()
    mismatched.add({
      id: 'expense-folder-mismatch', name: EXPENSE_ID,
      mimeType: 'application/vnd.google-apps.folder', parents: ['month-2026-08'],
      appProperties: {}, permissions: privatePermissions(), trashed: false, version: '1',
    })
    await expect(createFinanceGooglePorts(config(), mismatched.factory)
      .ensureExpenseFolder(MONTH_KEY, EXPENSE_ID))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('uploads create-only deterministic files, returns an exact retry, and rejects poisoned conflicts', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const deterministicName = `001-${sha256}.jpg`
    const input = claimedUpload({ parentId, bytes, sha256, deterministicName })

    const first = await ports.uploadExpenseImage(input)
    await expect(ports.uploadExpenseImage(input)).resolves.toEqual(first)
    expect(fake.driveCreates.mock.calls.filter(([request]) => request.requestBody?.mimeType !== 'application/vnd.google-apps.folder'))
      .toHaveLength(1)
    expect(fake.item(first.privateFileId)).toMatchObject({
      name: deterministicName,
      size: String(bytes.length),
      mimeType: 'image/jpeg',
      parents: [parentId],
      appProperties: {},
    })
    const publicProperties = fake.item(first.privateFileId).properties
    expect(publicProperties).toMatchObject({ v: '1', mon: MONTH_KEY, ord: '1', sha: sha256 })
    expect(Object.entries(publicProperties).every(([key, value]) => (
      Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8') <= 124
    ))).toBe(true)

    fake.item(first.privateFileId).bytes = Buffer.from('poisoned private bytes')
    fake.item(first.privateFileId).size = String(fake.item(first.privateFileId).bytes!.length)
    await expect(ports.uploadExpenseImage(input)).rejects.toMatchObject({
      code: 'EXPENSE_PRIVATE_FILE_INVALID',
      message: 'EXPENSE_PRIVATE_FILE_INVALID',
    })

    await expect(ports.uploadExpenseImage({ ...input, deterministicName: `1-${sha256}.jpg` }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('rejects appProperties-only evidence instead of falling back across Drive apps', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    const file = fake.item(attachment.privateFileId)
    file.properties = {}

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
    })).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('rejects concurrent same-slot uploads when immutable metadata differs', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const input = claimedUpload({ parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg` })
    const release = fake.pauseNextMediaCreate()

    const first = ports.uploadExpenseImage(input)
    await vi.waitFor(() => expect(fake.driveCreates.mock.calls.filter(([request]) => request.media)).toHaveLength(1))
    const conflict = ports.uploadExpenseImage({ ...input, originalFileName: 'different.jpg' })
    const conflictExpectation = expect(conflict).rejects.toMatchObject({
      code: 'EXPENSE_PRIVATE_FILE_INVALID',
    })
    release()

    await expect(first).resolves.toMatchObject({ originalFileName: 'receipt.jpg' })
    await conflictExpectation
  })

  it('never deletes without a terminal REGISTERED claim proving a different winner', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))

    const input = claimedUpload({ parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg` })
    const registeredAuthority = {
      ...input.slotClaim,
      generation: '5',
      state: 'REGISTERED' as const,
      registeredFileId: attachment.privateFileId,
    }
    await ports.deleteExpenseFileIfUnregistered({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
      readCurrentClaim: async () => ({ ...registeredAuthority }),
    })
    expect(fake.driveDeletes).not.toHaveBeenCalled()

    await ports.deleteExpenseFileIfUnregistered({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
      readCurrentClaim: async () => ({ ...input.slotClaim }),
    })
    expect(fake.driveDeletes).not.toHaveBeenCalled()
  })

  it('allows only the atomic slot owner to create across process instances', async () => {
    const fake = financeGoogleFake()
    const ownerProcess = createFinanceGooglePorts(config(), fake.factory)
    const replayProcess = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ownerProcess.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const deterministicName = `001-${sha256}.jpg`
    const claimIntent = {
      rootRequestId: 'expense-request-1',
      expenseId: EXPENSE_ID,
      ordinal: 1,
      sha256,
      mimeType: 'image/jpeg' as const,
      deterministicName,
    }
    const baseClaim = slotClaim(claimIntent)
    const upload = {
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      parentId,
      deterministicName,
      bytes,
      mimeType: 'image/jpeg' as const,
      ordinal: 1,
      sha256,
      rootRequestId: 'expense-request-1',
      uploadedByStaffId: 'ADMIN_01',
      uploadedAt: '2026-08-29T10:01:00.000Z',
      originalFileName: 'receipt.jpg',
      attachmentId: 'ATT-atomic-slot-1',
    }

    await expect(replayProcess.uploadExpenseImage({
      ...upload,
      slotClaim: { ...baseClaim, state: 'REGISTERED', registeredFileId: 'winner-not-created' },
    })).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
    expect(fake.driveCreates.mock.calls.filter(([request]) => request.media)).toHaveLength(0)

    const attachment = await ownerProcess.uploadExpenseImage({
      ...upload,
      slotClaim: baseClaim,
    })
    await expect(replayProcess.uploadExpenseImage({
      ...upload,
      slotClaim: { ...baseClaim, state: 'REGISTERED', registeredFileId: attachment.privateFileId },
    })).resolves.toEqual(attachment)
    expect(attachment).toMatchObject({
      attachmentId: 'ATT-atomic-slot-1',
      expenseId: EXPENSE_ID,
      ordinal: 1,
      mediaType: 'image/jpeg',
      originalFileName: 'receipt.jpg',
      deterministicName,
      sizeBytes: bytes.length,
      driveVersion: '1',
      slotClaimId: baseClaim.claimId,
      sha256,
      uploadedByStaffId: 'ADMIN_01',
      uploadedAt: '2026-08-29T10:01:00.000Z',
    })
    expect(fake.driveCreates.mock.calls.filter(([request]) => request.media)).toHaveLength(1)
  })

  it('recovers each exact descriptor across two-process delayed create and deletes only the fenced loser', async () => {
    const fake = financeGoogleFake()
    const delayedProcess = createFinanceGooglePorts(config(), fake.factory)
    const winnerProcess = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await delayedProcess.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const deterministicName = `001-${sha256}.jpg`
    const intent = {
      rootRequestId: 'expense-request-1', expenseId: EXPENSE_ID, ordinal: 1,
      sha256, mimeType: 'image/jpeg' as const, deterministicName,
    }
    const delayedClaim = slotClaim(intent)
    const winnerClaim = {
      ...delayedClaim,
      generation: '5',
      updatedAt: '2026-08-29T10:02:00.000Z',
      leaseOwnerId: 'lease-owner-winner',
      leaseGeneration: '4',
    }
    const upload = {
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, parentId, deterministicName, bytes,
      mimeType: 'image/jpeg' as const, ordinal: 1, sha256,
      rootRequestId: intent.rootRequestId, uploadedByStaffId: 'ADMIN_01',
      uploadedAt: '2026-08-29T10:01:00.000Z', originalFileName: 'receipt.jpg',
      attachmentId: 'ATT-delayed-slot-1',
    }
    const release = fake.pauseNextMediaCreate()
    const delayed = delayedProcess.uploadExpenseImage({ ...upload, slotClaim: delayedClaim })
    await vi.waitFor(() => expect(fake.driveCreates.mock.calls.filter(([request]) => request.media)).toHaveLength(1))
    const winner = await winnerProcess.uploadExpenseImage({ ...upload, slotClaim: winnerClaim })
    release()
    const loser = await delayed
    expect(loser.privateFileId).not.toBe(winner.privateFileId)

    const registeredWinner = {
      ...winnerClaim,
      generation: '6',
      state: 'REGISTERED' as const,
      registeredFileId: winner.privateFileId,
    }
    let changingReads = 0
    await delayedProcess.deleteExpenseFileIfUnregistered({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: loser.privateFileId,
      expectedAttachment: loser,
      readCurrentClaim: async () => {
        changingReads += 1
        return changingReads === 1
          ? { ...registeredWinner }
          : {
              ...registeredWinner,
              generation: '7',
              registeredFileId: loser.privateFileId,
            }
      },
    })
    expect(changingReads).toBe(2)
    expect(fake.fileIds(parentId)).toEqual([loser.privateFileId, winner.privateFileId].sort())
    expect(fake.driveDeletes).not.toHaveBeenCalled()

    await expect(winnerProcess.uploadExpenseImage({
      ...upload,
      slotClaim: registeredWinner,
      readCurrentClaim: async () => { throw new Error('transient claim read failure') },
    })).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
    expect(fake.fileIds(parentId)).toEqual([loser.privateFileId, winner.privateFileId].sort())

    fake.failNextDelete()
    await expect(winnerProcess.uploadExpenseImage({
      ...upload,
      slotClaim: registeredWinner,
      readCurrentClaim: async () => ({ ...registeredWinner }),
    })).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
    expect(fake.fileIds(parentId)).toEqual([loser.privateFileId, winner.privateFileId].sort())

    let claimReads = 0
    const recovered = await winnerProcess.listVerifiedExpenseImages(MONTH_KEY, EXPENSE_ID, [{
      claim: registeredWinner,
      expectedAttachment: attachmentIdentity(winner),
      readCurrentClaim: async () => {
        claimReads += 1
        return { ...registeredWinner }
      },
    }])

    expect(recovered).toEqual([winner])
    expect(claimReads).toBe(2)
    expect(fake.fileIds(parentId)).toEqual([winner.privateFileId])
    expect(fake.driveDeletes).toHaveBeenCalledWith(expect.objectContaining({
      fileId: loser.privateFileId,
    }))
  })

  it('pins file identity around download and validates bytes, MIME, metadata, and direct parent', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    const fileId = attachment.privateFileId

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId, expectedAttachment: attachment,
    }))
      .resolves.toBeUndefined()
    await expect(ports.downloadExpenseFile({
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId, expectedAttachment: attachment,
    }))
      .resolves.toEqual({ bytes, mimeType: 'image/jpeg' })

    fake.afterMediaRead = () => { fake.item(fileId).version = '2' }
    await expect(ports.downloadExpenseFile({
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId, expectedAttachment: attachment,
    }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })

    fake.afterMediaRead = undefined
    fake.item(fileId).parents = ['month-2026-08']
    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId, expectedAttachment: attachment,
    }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('accepts Drive display-description drift when the exact description hash remains bound', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    fake.item(attachment.privateFileId).description = 'Screenshot'

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
    })).resolves.toBeUndefined()
  })

  it('accepts the exact owner attachment regardless of object key insertion order', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    const ownerOrderedAttachment: ExpensePrivateAttachment = {
      attachmentId: attachment.attachmentId,
      expenseId: attachment.expenseId,
      rootRequestId: attachment.rootRequestId,
      ordinal: attachment.ordinal,
      mediaType: attachment.mediaType,
      originalFileName: attachment.originalFileName,
      deterministicName: attachment.deterministicName,
      slotClaimId: attachment.slotClaimId,
      sha256: attachment.sha256,
      uploadedByStaffId: attachment.uploadedByStaffId,
      uploadedAt: attachment.uploadedAt,
      privateFileId: attachment.privateFileId,
      sizeBytes: attachment.sizeBytes,
      driveVersion: attachment.driveVersion,
    }

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: ownerOrderedAttachment.privateFileId,
      expectedAttachment: ownerOrderedAttachment,
    })).resolves.toBeUndefined()
  })

  it('accepts stable Drive properties regardless of provider key order', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    fake.afterMediaRead = () => {
      const file = fake.item(attachment.privateFileId)
      file.properties = Object.fromEntries(Object.entries(file.properties).reverse())
    }

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
    })).resolves.toBeUndefined()
  })

  it('waits for a temporarily unavailable Drive checksum before verifying evidence', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const attachment = await ports.uploadExpenseImage(claimedUpload({
      parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
    }))
    fake.delayChecksumReads(attachment.privateFileId, 1)

    await expect(ports.verifyExpenseFile({
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      fileId: attachment.privateFileId,
      expectedAttachment: attachment,
    })).resolves.toBeUndefined()
  })

  it.each(['version', 'bytes', 'metadata'] as const)(
    'rejects a post-commit %s replacement against the pinned ledger attachment descriptor',
    async (mutation) => {
      const fake = financeGoogleFake()
      const ports = createFinanceGooglePorts(config(), fake.factory)
      const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
      const bytes = await jpeg()
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const attachment = await ports.uploadExpenseImage(claimedUpload({
        parentId, bytes, sha256, deterministicName: `001-${sha256}.jpg`,
      }))
      fake.setMonthRows('EXPENSE_SUBMISSIONS', [committedSubmissionRow()])
      fake.setMonthRows('EXPENSE_ATTACHMENTS', [committedAttachmentRow(attachment)])

      const file = fake.item(attachment.privateFileId)
      if (mutation === 'version') {
        file.version = '2'
      } else if (mutation === 'bytes') {
        const replacement = await jpeg(3, 2)
        const replacementHash = createHash('sha256').update(replacement).digest('hex')
        file.bytes = replacement
        file.size = String(replacement.length)
        file.name = `001-${replacementHash}.jpg`
        file.properties.sha = replacementHash
      } else {
        const description = JSON.stringify({
          originalFileName: 'replacement.jpg',
          uploadedAt: attachment.uploadedAt,
        })
        file.description = description
        file.properties.msh = createHash('sha256')
          .update(description, 'utf8')
          .digest('hex')
      }

      await expect(createFinanceReadStore({ finance: ports }).getEvidence(
        MONTH_KEY,
        EXPENSE_ID,
        attachment.attachmentId,
      )).rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
    },
  )
})

function config() {
  return { masterSpreadsheetId: 'finance-master', folderId: 'finance-root' }
}

interface FakePermission {
  id: string
  type: 'user' | 'group' | 'domain' | 'anyone'
  role: string
  deleted?: boolean
}

interface FakeItem {
  id: string
  name: string
  mimeType: string
  parents: string[]
  trashed: boolean
  appProperties: Record<string, string>
  properties: Record<string, string>
  permissions: FakePermission[]
  version: string
  sha256Checksum?: string
  description?: string
  size?: string
  bytes?: Buffer
}

function privatePermissions(): FakePermission[] {
  return [{ id: 'owner-user', type: 'user', role: 'owner', deleted: false }]
}

function financeGoogleFake() {
  const items = new Map<string, FakeItem>()
  const scopes: string[][] = []
  const indexRows: unknown[][] = [[
    MONTH_KEY,
    'ledger-2026-08',
    'month-2026-08',
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]]
  let sequence = 0
  let deleteFailureCount = 0
  let afterMediaRead: (() => void) | undefined
  let incompleteSearch: boolean | undefined = false
  const delayedChecksumReads = new Map<string, number>()
  const monthRows = new Map<string, unknown[][]>([
    ['EXPENSE_SUBMISSIONS', [['EXP-202608-0001']]],
    ['EXPENSE_ATTACHMENTS', []],
    ['MONTHLY_SUMMARY', []],
  ])

  const add = (item: FakeItem) => { items.set(item.id, item); return item }
  add({
    id: 'finance-root', name: 'PMC Finance', mimeType: 'application/vnd.google-apps.folder',
    parents: ['owner-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
    properties: {},
  })
  add({
    id: 'finance-master', name: 'PMC Finance Master', mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: ['finance-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
    properties: {},
  })
  add({
    id: 'month-2026-08', name: 'PMC Expenses 2026-08', mimeType: 'application/vnd.google-apps.folder',
    parents: ['finance-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
    properties: {},
  })
  add({
    id: 'ledger-2026-08', name: 'PMC Expenses 2026-08', mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: ['month-2026-08'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
    properties: {},
  })

  const sheetReads = vi.fn(async (input: {
    spreadsheetId: string
    ranges: string[]
    valueRenderOption?: string
    dateTimeRenderOption?: string
  }) => ({
    data: {
      valueRanges: input.ranges.map((range) => ({
        range,
        values: input.spreadsheetId === 'finance-master' && range.includes('EXPENSE_MONTHLY_INDEX')
          ? indexRows
          : input.spreadsheetId === 'finance-master'
            ? [['request-1']]
            : monthRows.get(/'([A-Z_]+)'!/.exec(range)?.[1] ?? '') ?? [],
      })),
    },
  }))

  const metadataForRead = (selected: FakeItem) => {
    const metadata = driveMetadata(selected)
    const remaining = delayedChecksumReads.get(selected.id) ?? 0
    if (remaining <= 0) return metadata
    delayedChecksumReads.set(selected.id, remaining - 1)
    return { ...metadata, sha256Checksum: undefined }
  }

  const driveGets = vi.fn(async (input: { fileId: string; alt?: string }) => {
    const selected = items.get(input.fileId)
    if (!selected) throw Object.assign(new Error('private provider not found'), { code: 404 })
    if (input.alt === 'media') {
      if (!selected.bytes) throw new Error('private missing media')
      const bytes = Buffer.from(selected.bytes)
      afterMediaRead?.()
      afterMediaRead = undefined
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    }
    return { data: metadataForRead(selected) }
  })

  const driveLists = vi.fn(async (input: { q?: string }) => {
    const parent = /'([^']+)'\s+in\s+parents/.exec(input.q ?? '')?.[1]
    return {
      data: {
        incompleteSearch,
        files: [...items.values()]
          .filter((candidate) => !parent || candidate.parents.includes(parent))
          .map(driveMetadata),
      },
    }
  })

  let nextMediaCreateGate: Promise<void> | null = null
  const driveCreates = vi.fn(async (input: {
    requestBody?: Partial<FakeItem>
    media?: { body: Buffer; mimeType: string }
  }) => {
    if (input.media && nextMediaCreateGate) {
      const gate = nextMediaCreateGate
      nextMediaCreateGate = null
      await gate
    }
    sequence += 1
    const id = `created-${sequence}`
    const request = input.requestBody ?? {}
    const bytes = input.media ? Buffer.from(input.media.body) : undefined
    const item: FakeItem = {
      id,
      name: String(request.name ?? ''),
      mimeType: String(request.mimeType ?? input.media?.mimeType ?? ''),
      parents: [...(request.parents ?? [])],
      trashed: false,
      appProperties: { ...(request.appProperties ?? {}) },
      properties: { ...(request.properties ?? {}) },
      ...(request.description === undefined ? {} : { description: String(request.description) }),
      permissions: privatePermissions(),
      version: '1',
      ...(bytes ? {
        bytes,
        size: String(bytes.length),
        sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
      } : {}),
    }
    add(item)
    return { data: driveMetadata(item) }
  })
  const driveDeletes = vi.fn(async (input: { fileId: string }) => {
    if (deleteFailureCount > 0) {
      deleteFailureCount -= 1
      throw new Error('transient private delete failure')
    }
    if (!items.delete(input.fileId)) throw Object.assign(new Error('private provider not found'), { code: 404 })
    return { data: {} }
  })

  const factory: FinanceGoogleFactory = {
    createAuth(nextScopes) { scopes.push(nextScopes); return { kind: 'adc' } },
    createSheets() {
      return { spreadsheets: { values: { batchGet: sheetReads } } }
    },
    createDrive() {
      return { files: { get: driveGets, list: driveLists, create: driveCreates, delete: driveDeletes } }
    },
  }

  return {
    factory,
    scopes,
    indexRows,
    sheetReads,
    driveGets,
    driveLists,
    driveCreates,
    driveDeletes,
    pauseNextMediaCreate() {
      let release!: () => void
      nextMediaCreateGate = new Promise<void>((resolve) => { release = resolve })
      return release
    },
    failNextDelete() { deleteFailureCount += 1 },
    add,
    addExpenseFolder(id: string) {
      add({
        id, name: EXPENSE_ID, mimeType: 'application/vnd.google-apps.folder',
        parents: ['month-2026-08'], trashed: false,
        appProperties: { pmcExpenseId: EXPENSE_ID, pmcExpenseMonthKey: MONTH_KEY },
        properties: {},
        permissions: privatePermissions(), version: '1',
      })
    },
    item(id: string) {
      const selected = items.get(id)
      if (!selected) throw new Error('test fixture missing item')
      return selected
    },
    fileIds(parentId: string) {
      return [...items.values()]
        .filter((item) => item.parents.includes(parentId) && item.mimeType !== 'application/vnd.google-apps.folder')
        .map(({ id }) => id)
        .sort()
    },
    get afterMediaRead() { return afterMediaRead },
    set afterMediaRead(callback: (() => void) | undefined) { afterMediaRead = callback },
    setIncompleteSearch(value: boolean | undefined) { incompleteSearch = value },
    delayChecksumReads(fileId: string, reads: number) { delayedChecksumReads.set(fileId, reads) },
    setMonthRows(tab: 'EXPENSE_SUBMISSIONS' | 'EXPENSE_ATTACHMENTS' | 'MONTHLY_SUMMARY', rows: unknown[][]) {
      monthRows.set(tab, rows)
    },
  }
}

function jpeg(width = 2, height = 2): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

function committedSubmissionRow(): unknown[] {
  return [
    EXPENSE_ID, '2026-08-29', MONTH_KEY, 'BILL_DOCUMENT', 'CLINIC', 12_000,
    'ร้านทดสอบ', 'ค่าใช้จ่าย', 'TRANSFER', 'COMMITTED', '', 1, '',
    'ADMIN_01', 'มัส', '2026-08-29T10:00:00.000Z', '2026-08-29T10:02:00.000Z',
    '2026-08-29T10:02:00.000Z', 2, 'expense-request-1',
  ]
}

function committedAttachmentRow(attachment: ExpensePrivateAttachment): unknown[] {
  return [
    attachment.attachmentId,
    attachment.expenseId,
    attachment.rootRequestId,
    attachment.ordinal,
    attachment.mediaType,
    attachment.originalFileName,
    attachment.privateFileId,
    attachment.deterministicName,
    attachment.sizeBytes,
    attachment.driveVersion,
    attachment.slotClaimId,
    attachment.sha256,
    attachment.uploadedByStaffId,
    attachment.uploadedAt,
  ]
}

function attachmentIdentity(attachment: ExpensePrivateAttachment) {
  return {
    attachmentId: attachment.attachmentId,
    expenseId: attachment.expenseId,
    rootRequestId: attachment.rootRequestId,
    ordinal: attachment.ordinal,
    mediaType: attachment.mediaType,
    originalFileName: attachment.originalFileName,
    deterministicName: attachment.deterministicName,
    slotClaimId: attachment.slotClaimId,
    sha256: attachment.sha256,
    uploadedByStaffId: attachment.uploadedByStaffId,
    uploadedAt: attachment.uploadedAt,
  }
}

function claimedUpload(input: {
  parentId: string
  bytes: Buffer
  sha256: string
  deterministicName: string
}) {
  const intent = {
    rootRequestId: 'expense-request-1',
    expenseId: EXPENSE_ID,
    ordinal: 1,
    sha256: input.sha256,
    mimeType: 'image/jpeg' as const,
    deterministicName: input.deterministicName,
  }
  return {
    monthKey: MONTH_KEY,
    expenseId: EXPENSE_ID,
    parentId: input.parentId,
    deterministicName: input.deterministicName,
    bytes: input.bytes,
    mimeType: 'image/jpeg' as const,
    ordinal: 1,
    sha256: input.sha256,
    rootRequestId: intent.rootRequestId,
    uploadedByStaffId: 'ADMIN_01',
    uploadedAt: '2026-08-29T10:01:00.000Z',
    originalFileName: 'receipt.jpg',
    attachmentId: 'ATT-atomic-slot-1',
    slotClaim: slotClaim(intent),
  }
}

function slotClaim(
  intent: {
    rootRequestId: string
    expenseId: string
    ordinal: number
    sha256: string
    mimeType: 'image/jpeg' | 'image/png'
    deterministicName: string
  },
) {
  const claimId = `SLOT-${createHash('sha256').update(JSON.stringify(intent), 'utf8').digest('hex')}`
  return {
    objectKey: `expense-drive-slots/${intent.expenseId}/${String(intent.ordinal).padStart(3, '0')}.json`,
    claimId,
    generation: '4',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    state: 'CLAIMED' as const,
    leaseId: `LEASE-${'c'.repeat(64)}`,
    leaseOwnerId: 'lease-owner-test',
    leaseGeneration: '3',
    registeredFileId: null,
    ...intent,
  }
}

function driveMetadata(item: FakeItem): Omit<FakeItem, 'bytes'> {
  return structuredClone({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parents: item.parents,
    trashed: item.trashed,
    appProperties: item.appProperties,
    properties: item.properties,
    permissions: item.permissions,
    version: item.version,
    ...(item.sha256Checksum === undefined ? {} : { sha256Checksum: item.sha256Checksum }),
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.size === undefined ? {} : { size: item.size }),
  })
}
