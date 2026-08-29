import { describe, expect, it } from 'vitest'
import { executeExpenseCommand } from '../src/expense/commands'
import {
  bookPrepareCommand,
  commitCommand,
  createExpenseTestPorts,
  manifestHash,
  prepareCommand,
  prepareWithManifest,
  summaryRows,
} from './helpers/expenseFakes'

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
      payload: { expenseId: replacement.expenseId, expectedVersion: replacement.version, reason: 'ยอดผิดจากสมุดจริง' },
    }, ports)

    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toBeNull()
    expect(ports.expense.getSubmission('2026-08', original.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED',
    })
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
})
