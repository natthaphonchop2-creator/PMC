import { describe, expect, it } from 'vitest'
import { executeExpenseCommand, runExpenseRecovery } from '../src/expense/commands'
import {
  EXPENSE_NOW,
  bookPrepareCommand,
  commitCommand,
  createExpenseTestPorts,
  prepareCommand,
  prepareWithManifest,
} from './helpers/expenseFakes'

describe('Apps Script expense recovery journal', () => {
  it('finishes a failure after COMMIT audit exactly once from durable attachment descriptors', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'partial-commit', commandIdempotencyKey: 'partial-commit:prepare',
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'partial-commit', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow('simulated attachment append failure')

    expect(ports.expense.auditForExpense(prepared.prepared.expenseId)).toContainEqual(
      expect.objectContaining({ action: 'COMMIT' }),
    )
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)).toMatchObject({
      recordState: 'PREPARED', version: 1,
    })

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 1, abandoned: 0, errors: [] })
    expect(runExpenseRecovery(ports)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
    expect(ports.expense.listAttachments('2026-08', prepared.prepared.expenseId)).toHaveLength(1)
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED', version: 2,
    })
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId).filter(({ action }) => action === 'RECOVER'))
      .toHaveLength(1)
  })

  it('abandons stale PREPARED without a COMMIT audit after 48 hours and keeps its evidence journal', () => {
    const ports = createExpenseTestPorts({ now: '2026-08-27T09:00:00+07:00' })
    const prepared = executeExpenseCommand(prepareCommand({
      rootRequestId: 'stale-prepare', commandIdempotencyKey: 'stale-prepare:prepare',
    }), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected result')
    ports.setNow('2026-08-29T09:00:01+07:00')

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 0, abandoned: 1, errors: [] })
    expect(ports.expense.getSubmission('2026-08', prepared.expenseId)).toMatchObject({
      recordState: 'VOID', version: 2,
    })
    expect(ports.expense.auditForExpense(prepared.expenseId).map(({ action }) => action))
      .toEqual(['PREPARE', 'ABANDON'])
  })

  it('keeps a recent PREPARED unresolved and returns counts only', () => {
    const ports = createExpenseTestPorts({ now: EXPENSE_NOW })
    executeExpenseCommand(bookPrepareCommand({
      rootRequestId: 'recent-book', expectedRevision: 0, amountSatang: 10_000,
    }), ports)
    ports.setNow('2026-08-30T09:00:00+07:00')

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 0, abandoned: 0, errors: [] })
  })

  it('does not finalize a durable COMMIT when private files no longer verify', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'private-invalid', commandIdempotencyKey: 'private-invalid:prepare',
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'private-invalid', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow()
    ports.backend.privateFilesValid = false

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_PRIVATE_FILE_INVALID'],
    })
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)?.recordState).toBe('PREPARED')
  })

  it('abandons a 48-hour-old PREPARED when its durable COMMIT files cannot be reverified', () => {
    const ports = createExpenseTestPorts({ now: '2026-08-27T09:00:00+07:00' })
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'stale-private-invalid', commandIdempotencyKey: 'stale-private-invalid:prepare',
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'stale-private-invalid', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow()
    ports.backend.privateFilesValid = false
    ports.setNow('2026-08-29T09:00:01+07:00')

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 1,
      errors: [],
    })
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)?.recordState).toBe('VOID')
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId).map(({ action }) => action))
      .toEqual(['PREPARE', 'COMMIT', 'ABANDON'])
  })

  it('fails closed when the durable COMMIT audit actor does not match the attachment submitter', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'audit-actor-mismatch', commandIdempotencyKey: 'audit-actor-mismatch:prepare',
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'audit-actor-mismatch', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow()
    const auditRows = ports.backend.master.get('EXPENSE_AUDIT')!
    const commitIndex = auditRows.findIndex((row) => row.action === 'COMMIT')
    auditRows[commitIndex] = { ...auditRows[commitIndex], actorStaffId: 'MANAGER_01' }

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_STORAGE_UNAVAILABLE'],
    })
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)?.recordState).toBe('PREPARED')
  })
})
