import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeExpenseCommand, runExpenseRecovery } from '../src/expense/commands'
import { createGoogleExpenseRepository } from '../src/expense/repository'
import {
  EXPENSE_NOW,
  attachmentFixture,
  bookPrepareCommand,
  commitCommand,
  createExpenseTestPorts,
  manifestHash,
  prepareCommand,
  prepareWithManifest,
  summaryRows,
} from './helpers/expenseFakes'
import { installGoogleExpenseFakes } from './helpers/googleExpenseFakes'

afterEach(() => vi.unstubAllGlobals())

describe('Apps Script expense repository and command journal', () => {
  it('rejects a global phase-key fingerprint conflict before touching another monthly ledger', () => {
    const ports = createExpenseTestPorts()
    const original = prepareCommand({ rootRequestId: 'global-request-1', commandIdempotencyKey: 'global-request-1:prepare' })
    executeExpenseCommand(original, ports)
    const monthOperations = ports.backend.monthOperationCount

    expect(() => executeExpenseCommand(prepareCommand({
      rootRequestId: 'global-request-1',
      commandIdempotencyKey: 'global-request-1:prepare',
      payload: { ...original.payload, expenseDate: '2026-09-01' },
    }), ports)).toThrow('EXPENSE_IDEMPOTENCY_CONFLICT')
    expect(ports.backend.monthOperationCount).toBe(monthOperations)
  })

  it('keeps PREPARE and COMMIT phase reservations distinct and replays the original receipt', () => {
    const ports = createExpenseTestPorts()
    const preparedInput = prepareCommand({ rootRequestId: 'bill-retry-1', commandIdempotencyKey: 'bill-retry-1:prepare' })
    const { prepared, attachments } = prepareWithManifest(ports, preparedInput)
    const commit = commitCommand({ rootRequestId: 'bill-retry-1', expenseId: prepared.expenseId, attachments })

    const first = executeExpenseCommand(commit, ports)
    const retry = executeExpenseCommand(commit, ports)

    expect(retry).toEqual(first)
    expect(ports.expense.listMonth('2026-08')).toHaveLength(1)
    expect(ports.expense.listAttachments('2026-08', prepared.expenseId)).toHaveLength(1)
    expect(ports.backend.master.get('EXPENSE_REQUESTS')).toHaveLength(2)
  })

  it('returns a completed phase result even if the submitter becomes inactive after the lost response', () => {
    const ports = createExpenseTestPorts()
    const preparedInput = prepareCommand({
      rootRequestId: 'lost-response', commandIdempotencyKey: 'lost-response:prepare',
    })
    const { prepared, attachments } = prepareWithManifest(ports, preparedInput)
    const commit = commitCommand({
      rootRequestId: 'lost-response', expenseId: prepared.expenseId, attachments,
    })
    const first = executeExpenseCommand(commit, ports)
    ports.staff.findById = () => ({
      id: 'STAFF_01',
      name: 'Staff',
      active: false,
      canSubmitExpense: false,
      canManageExpense: false,
    })

    expect(executeExpenseCommand(commit, ports)).toEqual(first)
  })

  it('serializes two first-book commits and keeps one effective total', () => {
    const ports = createExpenseTestPorts()
    const firstPrepared = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'book-a', expectedRevision: 0, amountSatang: 10_000,
    }))
    const secondPrepared = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'book-b', expectedRevision: 0, amountSatang: 20_000,
    }))

    const first = executeExpenseCommand(commitCommand({
      rootRequestId: 'book-a', expenseId: firstPrepared.prepared.expenseId,
      expectedRevision: 0, attachments: firstPrepared.attachments,
    }), ports)
    expect(first).toMatchObject({ commandType: 'COMMIT_EXPENSE', revision: 1 })
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'book-b', expenseId: secondPrepared.prepared.expenseId,
      expectedRevision: 0, attachments: secondPrepared.attachments,
    }), ports)).toThrow('EXPENSE_REVISION_CONFLICT')

    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')?.amountSatang)
      .toBe(10_000)
    expect(ports.expense.auditForExpense(secondPrepared.prepared.expenseId))
      .not.toContainEqual(expect.objectContaining({ action: 'COMMIT' }))
  })

  it('treats a durable partial COMMIT as the book revision claim before recovery', () => {
    const ports = createExpenseTestPorts()
    const firstPrepared = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'claim-a', expectedRevision: 0, amountSatang: 10_000,
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'claim-a', expenseId: firstPrepared.prepared.expenseId,
      expectedRevision: 0, attachments: firstPrepared.attachments,
    }), ports)).toThrow('simulated attachment append failure')

    const secondPrepared = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'claim-b', expectedRevision: 0, amountSatang: 20_000,
    }))
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'claim-b', expenseId: secondPrepared.prepared.expenseId,
      expectedRevision: 0, attachments: secondPrepared.attachments,
    }), ports)).toThrow('EXPENSE_REVISION_CONFLICT')

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 2,
      recovered: 1,
      abandoned: 0,
      errors: [],
    })
    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toMatchObject({
      expenseId: firstPrepared.prepared.expenseId,
      amountSatang: 10_000,
      revision: 1,
    })
  })

  it('serializes concurrent replacements and never resurrects a superseded predecessor after void', () => {
    const ports = createExpenseTestPorts()
    const original = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'book-original', expectedRevision: 0, amountSatang: 10_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'book-original', expenseId: original.prepared.expenseId,
      expectedRevision: 0, attachments: original.attachments,
    }), ports)
    const replaceA = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'book-replace-a', expectedRevision: 1, amountSatang: 12_000,
    }))
    const replaceB = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'book-replace-b', expectedRevision: 1, amountSatang: 14_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'book-replace-a', expenseId: replaceA.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01',
      attachments: replaceA.attachments.map((item) => ({ ...item, uploadedByStaffId: 'MANAGER_01' })),
    }), ports)
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'book-replace-b', expenseId: replaceB.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01',
      attachments: replaceB.attachments.map((item) => ({ ...item, uploadedByStaffId: 'MANAGER_01' })),
    }), ports)).toThrow('EXPENSE_REVISION_CONFLICT')

    const replacement = ports.expense.getSubmission('2026-08', replaceA.prepared.expenseId)!
    executeExpenseCommand({
      rootRequestId: 'book-void-a',
      commandIdempotencyKey: 'book-void-a:void',
      staffId: 'MANAGER_01',
      commandType: 'VOID_EXPENSE',
      payload: {
        expenseId: replacement.expenseId, expectedVersion: replacement.version,
        expectedRevision: replacement.revision, reason: 'ยอดผิดจากสมุดจริง',
      },
    }, ports)

    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toBeNull()
    expect(ports.expense.getSubmission('2026-08', original.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED',
    })
  })

  it('rejects a stale VOID after another manager has committed a replacement revision', () => {
    const ports = createExpenseTestPorts()
    const original = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'stale-void-original', expectedRevision: 0, amountSatang: 10_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'stale-void-original', expenseId: original.prepared.expenseId,
      expectedRevision: 0, attachments: original.attachments,
    }), ports)
    const replacement = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'stale-void-replacement', expectedRevision: 1, amountSatang: 12_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'stale-void-replacement', expenseId: replacement.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01',
      attachments: replacement.attachments.map((item) => ({ ...item, uploadedByStaffId: 'MANAGER_01' })),
    }), ports)

    expect(() => executeExpenseCommand({
      rootRequestId: 'stale-void-original-action',
      commandIdempotencyKey: 'stale-void-original-action:void',
      staffId: 'MANAGER_01',
      commandType: 'VOID_EXPENSE',
      payload: {
        expenseId: original.prepared.expenseId,
        expectedVersion: 2,
        expectedRevision: 1,
        reason: 'คำสั่งยกเลิกจากหน้าจอที่ล้าสมัย',
      },
    }, ports)).toThrow('EXPENSE_REVISION_CONFLICT')

    expect(ports.expense.getSubmission('2026-08', original.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED', version: 2, revision: 1,
    })
    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toMatchObject({
      expenseId: replacement.prepared.expenseId, recordState: 'COMMITTED', revision: 2,
    })
    expect(ports.expense.auditForExpense(original.prepared.expenseId))
      .not.toContainEqual(expect.objectContaining({ action: 'VOID' }))
    expect(ports.expense.listRecoveryCandidates()).toEqual([])
  })

  it('never counts PREPARED, VOID, or superseded rows in the monthly summary', () => {
    const ports = createExpenseTestPorts()
    const original = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'summary-original', expectedRevision: 0, amountSatang: 8_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'summary-original', expenseId: original.prepared.expenseId,
      expectedRevision: 0, attachments: original.attachments,
    }), ports)
    const replacement = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'summary-replacement', expectedRevision: 1, amountSatang: 12_000,
    }))
    const replacementAttachments = replacement.attachments.map((item) => ({
      ...item,
      uploadedByStaffId: 'MANAGER_01',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'summary-replacement', expenseId: replacement.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01', attachments: replacementAttachments,
    }), ports)
    executeExpenseCommand(prepareCommand({
      rootRequestId: 'summary-prepared', commandIdempotencyKey: 'summary-prepared:prepare',
      payload: { ...prepareCommand().payload, expectedManifestHash: manifestHash(replacementAttachments) },
    }), ports)

    expect(ports.expense.listMonth('2026-08').filter(({ recordState }) => recordState === 'COMMITTED'))
      .toHaveLength(2)
    expect(summaryRows(ports.backend, '2026-08')).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'CLINIC', category: 'BOOK_CLINIC', committedSatang: 12_000 }),
    ]))
  })

  it.each([
    ['COMMITTED updatedAt before committedAt', { updatedAt: '2026-08-29T09:59:59+07:00' }],
    ['unsupported BILL_DOCUMENT payment method', { paymentMethod: 'WIRE' }],
    ['expense ID month different from monthKey', { expenseId: 'EXP-202607-CORRUPT' }],
  ])('fails the Apps Script projection for %s', (_case, corruption) => {
    const ports = createExpenseTestPorts()
    const first = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'projection-first', commandIdempotencyKey: 'projection-first:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'projection-first', expenseId: first.prepared.expenseId,
      attachments: first.attachments,
    }), ports)
    const rows = ports.backend.months.get('2026-08')!.get('EXPENSE_SUBMISSIONS')!
    rows[0] = { ...rows[0], ...corruption }
    const second = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'projection-second', commandIdempotencyKey: 'projection-second:prepare',
    }))

    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'projection-second', expenseId: second.prepared.expenseId,
      attachments: second.attachments,
    }), ports)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
  })

  it('rejects immutable submission patches and conflicting attachment IDs', () => {
    const ports = createExpenseTestPorts()
    const { prepared, attachments } = prepareWithManifest(ports, prepareCommand())

    expect(() => ports.expense.updateSubmission('2026-08', prepared.expenseId, 1, {
      expenseDate: '2026-08-30',
    })).toThrow('EXPENSE_IMMUTABLE_FIELD')
    ports.expense.appendAttachments('2026-08', attachments)
    ports.expense.appendAttachments('2026-08', attachments)
    expect(() => ports.expense.appendAttachments('2026-08', [{
      ...attachments[0]!,
      sha256: 'b'.repeat(64),
    }])).toThrow('EXPENSE_IDEMPOTENCY_CONFLICT')
    expect(ports.expense.listAttachments('2026-08', prepared.expenseId)).toHaveLength(1)
  })

  it('fails closed before COMMIT when stored immutable revision data is corrupted', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'corrupt-revision', expectedRevision: 0, amountSatang: 10_000,
    }))
    const rows = ports.backend.months.get('2026-08')!.get('EXPENSE_SUBMISSIONS')!
    rows[0] = { ...rows[0], revision: 99 }

    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'corrupt-revision',
      expenseId: prepared.prepared.expenseId,
      expectedRevision: 0,
      attachments: prepared.attachments,
    }), ports)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId))
      .not.toContainEqual(expect.objectContaining({ action: 'COMMIT' }))
  })

  it.each([
    ['amount', { amountSatang: 10_001 }],
    ['date', { expenseDate: '2026-08-30' }],
    ['month', { expenseDate: '2026-09-01', monthKey: '2026-09' }],
    ['category and book identity', {
      category: 'BOOK_CLINIC', counterpartyName: null, paymentMethod: null,
      bookDailyKey: 'CLINIC:2026-08-29',
    }],
    ['scope', { scope: 'DOCTOR_PERSONAL' }],
    ['payment method', { paymentMethod: 'CASH' }],
    ['counterparty', { counterpartyName: 'ร้านอื่น' }],
    ['description', { description: 'เปลี่ยนหลัง PREPARE' }],
    ['book key', { bookDailyKey: 'CLINIC:2026-08-29' }],
    ['revision', { revision: 2 }],
    ['actor', { submittedByStaffId: 'MANAGER_01' }],
    ['root request', { idempotencyKey: 'different-root' }],
  ])('rejects direct-sheet %s drift from the signed PREPARE intent', (_case, patch) => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'immutable-intent', commandIdempotencyKey: 'immutable-intent:prepare',
    }))
    const rows = ports.backend.months.get('2026-08')!.get('EXPENSE_SUBMISSIONS')!
    rows[0] = { ...rows[0], ...patch }

    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'immutable-intent', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId))
      .not.toContainEqual(expect.objectContaining({ action: 'COMMIT' }))
    expect(summaryRows(ports.backend, '2026-08')).toEqual([])
  })

  it('allows an active expense manager to VOID without submit permission', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'manager-void-only', commandIdempotencyKey: 'manager-void-only:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'manager-void-only', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const originalFind = ports.staff.findById
    ports.staff.findById = (staffId) => {
      const staff = originalFind(staffId)
      return staffId === 'MANAGER_01' && staff ? { ...staff, canSubmitExpense: false } : staff
    }

    expect(executeExpenseCommand({
      rootRequestId: 'manager-void-command',
      commandIdempotencyKey: 'manager-void-command:void',
      staffId: 'MANAGER_01',
      commandType: 'VOID_EXPENSE',
      payload: {
        expenseId: prepared.prepared.expenseId,
        expectedVersion: 2,
        expectedRevision: 1,
        reason: 'ยกเลิกรายการตามสิทธิ์ผู้ดูแล',
      },
    }, ports)).toMatchObject({ recordState: 'VOID', version: 3 })
  })

  it('binds VOID to the selected committed book revision before writing audit or state', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-revision-cas', commandIdempotencyKey: 'void-revision-cas:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-revision-cas', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)

    expect(() => executeExpenseCommand({
      rootRequestId: 'void-revision-stale',
      commandIdempotencyKey: 'void-revision-stale:void',
      staffId: 'MANAGER_01',
      commandType: 'VOID_EXPENSE',
      payload: {
        expenseId: prepared.prepared.expenseId,
        expectedVersion: 2,
        expectedRevision: 2,
        reason: 'ยกเลิกจาก revision ที่ล้าสมัย',
      },
    }, ports)).toThrow('EXPENSE_REVISION_CONFLICT')
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED', revision: 1, version: 2,
    })
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId))
      .not.toContainEqual(expect.objectContaining({ action: 'VOID' }))
    expect(ports.expense.listRecoveryCandidates()).toEqual([])
    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 0, recovered: 0, abandoned: 0, errors: [],
    })
  })

  it('rejects unknown or private fields in every stored command-result replay union', () => {
    const preparePorts = createExpenseTestPorts()
    const prepare = prepareCommand({
      rootRequestId: 'replay-prepare-shape',
      commandIdempotencyKey: 'replay-prepare-shape:prepare',
    })
    const prepareResult = executeExpenseCommand(prepare, preparePorts)
    corruptStoredResult(preparePorts, prepare.commandIdempotencyKey, {
      ...prepareResult,
      ledgerSpreadsheetId: 'private-ledger-id',
    })
    expect(() => executeExpenseCommand(prepare, preparePorts)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
    corruptStoredResult(preparePorts, prepare.commandIdempotencyKey, {
      ...prepareResult,
      version: 2,
    })
    expect(() => executeExpenseCommand(prepare, preparePorts)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')

    const commitPorts = createExpenseTestPorts()
    const committedPrepared = prepareWithManifest(commitPorts, prepareCommand({
      rootRequestId: 'replay-commit-shape',
      commandIdempotencyKey: 'replay-commit-shape:prepare',
    }))
    const commit = commitCommand({
      rootRequestId: 'replay-commit-shape',
      expenseId: committedPrepared.prepared.expenseId,
      attachments: committedPrepared.attachments,
    })
    const commitResult = executeExpenseCommand(commit, commitPorts)
    corruptStoredResult(commitPorts, commit.commandIdempotencyKey, {
      ...commitResult,
      privateFileId: 'private-file-id',
    })
    expect(() => executeExpenseCommand(commit, commitPorts)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')

    const voidPorts = createExpenseTestPorts()
    const voidPrepared = prepareWithManifest(voidPorts, prepareCommand({
      rootRequestId: 'replay-void-shape',
      commandIdempotencyKey: 'replay-void-shape:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'replay-void-shape', expenseId: voidPrepared.prepared.expenseId,
      attachments: voidPrepared.attachments,
    }), voidPorts)
    const voidCommand = {
      rootRequestId: 'replay-void-command',
      commandIdempotencyKey: 'replay-void-command:void',
      staffId: 'MANAGER_01',
      commandType: 'VOID_EXPENSE' as const,
      payload: {
        expenseId: voidPrepared.prepared.expenseId,
        expectedVersion: 2,
        expectedRevision: 1,
        reason: 'ยกเลิกรายการทดสอบ',
      },
    }
    const voidResult = executeExpenseCommand(voidCommand, voidPorts)
    corruptStoredResult(voidPorts, voidCommand.commandIdempotencyKey, {
      ...voidResult,
      monthFolderId: 'private-folder-id',
    })
    expect(() => executeExpenseCommand(voidCommand, voidPorts)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
    corruptStoredResult(voidPorts, voidCommand.commandIdempotencyKey, {
      ...voidResult,
      expenseId: 'finance-master',
    })
    expect(() => executeExpenseCommand(voidCommand, voidPorts)).toThrow('EXPENSE_STORAGE_UNAVAILABLE')
  })
})

describe('Google expense repository containment and literal text', () => {
  it('persists a date-like month key as literal text and reuses one index row', () => {
    const environment = installGoogleExpenseFakes({ initializedLedger: true })
    const repository = createGoogleExpenseRepository({
      masterSpreadsheetId: 'finance-master',
      financeFolderId: 'finance-root',
    })

    expect(repository.ensureMonth('2026-08', EXPENSE_NOW)).toEqual({
      ledgerSpreadsheetId: 'ledger-2026-08',
      monthFolderId: 'month-folder',
    })
    expect(repository.ensureMonth('2026-08', EXPENSE_NOW)).toEqual({
      ledgerSpreadsheetId: 'ledger-2026-08',
      monthFolderId: 'month-folder',
    })
    const rows = environment.master.getSheetByName('EXPENSE_MONTHLY_INDEX')!.data
    expect(rows).toHaveLength(2)
    expect(rows[1]?.[0]).toBe('\u200c2026-08')
  })

  it.each(['bytes', 'version', 'duplicate', 'incomplete-true', 'incomplete-missing'] as const)(
    'rejects a %s mutation before COMMIT audit or effective totals',
    (mutation) => {
      const environment = installGoogleExpenseFakes({ indexed: true, initializedLedger: true })
      const repository = createGoogleExpenseRepository({
        masterSpreadsheetId: 'finance-master',
        financeFolderId: 'finance-root',
      })
      const base = createExpenseTestPorts()
      const ports = { ...base, expense: repository }
      const rootRequestId = `authoritative-${mutation}`
      const expenseId = 'EXP-202608-0001'
      const bytes = [...Buffer.from('authoritative-drive-bytes')]
      const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
      const attachment = attachmentFixture(expenseId, {
        attachmentId: `ATT-authoritative-${mutation}`,
        rootRequestId,
        privateFileId: `FILE-authoritative-${mutation}`,
        deterministicName: `001-${sha256}.jpg`,
        sizeBytes: bytes.length,
        driveVersion: '7',
        slotClaimId: `SLOT-${'c'.repeat(64)}`,
        sha256,
      })
      const prepare = prepareCommand({
        rootRequestId,
        commandIdempotencyKey: `${rootRequestId}:prepare`,
        payload: {
          ...prepareCommand().payload,
          expectedManifestHash: manifestHash([attachment]),
        },
      })
      const prepared = executeExpenseCommand(prepare, ports)
      expect(prepared).toMatchObject({ commandType: 'PREPARE_EXPENSE', expenseId })
      environment.addExpenseAttachment(attachment, bytes)
      expect(() => repository.verifyPrivateAttachments('2026-08', expenseId, [attachment]))
        .not.toThrow()

      if (mutation === 'bytes') {
        environment.mutateExpenseFile(attachment.privateFileId, {
          bytes: bytes.map((value, index) => index === 0 ? value ^ 0xff : value),
        })
      } else if (mutation === 'version') {
        environment.mutateExpenseFile(attachment.privateFileId, { version: '8' })
      } else if (mutation === 'duplicate') {
        environment.duplicateExpenseAttachment(attachment, bytes)
      } else {
        environment.setIncompleteSearch(mutation === 'incomplete-true' ? true : undefined)
      }

      expect(() => executeExpenseCommand(commitCommand({
        rootRequestId,
        expenseId,
        attachments: [attachment],
      }), ports)).toThrow('EXPENSE_PRIVATE_FILE_INVALID')
      expect(repository.auditForExpense(expenseId))
        .not.toContainEqual(expect.objectContaining({ action: 'COMMIT' }))
      expect(repository.listMonth('2026-08')).toContainEqual(
        expect.objectContaining({ expenseId, recordState: 'PREPARED' }),
      )
    },
  )

  it.each([
    ['shared', { ledgerSharing: 'ANYONE' as const }],
    ['outside', { ledgerParent: 'OUTSIDE' as const }],
  ])('rejects an adopted %s monthly workbook before topology mutation', (_name, options) => {
    const environment = installGoogleExpenseFakes(options)
    const repository = createGoogleExpenseRepository({
      masterSpreadsheetId: 'finance-master',
      financeFolderId: 'finance-root',
    })

    expect(() => repository.ensureMonth('2026-08', EXPENSE_NOW))
      .toThrow('EXPENSE_STORAGE_UNAVAILABLE')
    expect(environment.ledger.topologyMutationCount()).toBe(0)
  })

  it('persists formula-like free text as literal cells and restores the canonical text', () => {
    const environment = installGoogleExpenseFakes({ indexed: true, initializedLedger: true })
    const repository = createGoogleExpenseRepository({
      masterSpreadsheetId: 'finance-master',
      financeFolderId: 'finance-root',
    })
    const submission = {
      expenseId: 'EXP-202608-FORMULA-1',
      expenseDate: '2026-08-29',
      monthKey: '2026-08',
      category: 'BILL_DOCUMENT' as const,
      scope: 'CLINIC' as const,
      amountSatang: 12_000,
      counterpartyName: '  =HYPERLINK("https://invalid.test")',
      description: ' +SUM(A1:A2)',
      paymentMethod: 'TRANSFER' as const,
      recordState: 'PREPARED' as const,
      bookDailyKey: null,
      revision: 1,
      supersedesExpenseId: null,
      submittedByStaffId: 'STAFF_01',
      submittedByName: ' @IMPORTXML("https://invalid.test")',
      submittedAt: EXPENSE_NOW,
      committedAt: null,
      updatedAt: EXPENSE_NOW,
      version: 1,
      idempotencyKey: 'formula-roundtrip',
    }
    repository.insertPrepared(submission)
    repository.appendAttachments('2026-08', [{
      attachmentId: 'ATT-FORMULA-1',
      expenseId: submission.expenseId,
      rootRequestId: 'formula-roundtrip',
      ordinal: 1,
      mediaType: 'image/jpeg',
      originalFileName: ' -receipt.jpg',
      privateFileId: 'FILE-FORMULA-1',
      deterministicName: `001-${'a'.repeat(64)}.jpg`,
      sizeBytes: 1,
      driveVersion: '1',
      slotClaimId: `SLOT-${'b'.repeat(64)}`,
      sha256: 'a'.repeat(64),
      uploadedByStaffId: 'STAFF_01',
      uploadedAt: EXPENSE_NOW,
    }])

    expect(repository.getSubmission('2026-08', submission.expenseId)).toEqual(submission)
    expect(repository.listAttachments('2026-08', submission.expenseId)[0]?.originalFileName)
      .toBe(' -receipt.jpg')
    expect(environment.ledger.formulaWriteCount()).toBe(0)
  })
})

function corruptStoredResult(
  ports: ReturnType<typeof createExpenseTestPorts>,
  commandIdempotencyKey: string,
  result: Record<string, unknown>,
): void {
  const rows = ports.backend.master.get('EXPENSE_REQUESTS')!
  const index = rows.findIndex((row) => row.commandIdempotencyKey === commandIdempotencyKey)
  rows[index] = {
    ...rows[index],
    resultJson: JSON.stringify({ ok: true, result }),
  }
}
