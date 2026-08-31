import { describe, expect, it } from 'vitest'
import { executeExpenseCommand, runExpenseRecovery } from '../src/expense/commands'
import {
  EXPENSE_NOW,
  bookPrepareCommand,
  commitCommand,
  createExpenseTestPorts,
  prepareCommand,
  prepareWithManifest,
  voidCommand,
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
      recordState: 'PREPARED', version: 1,
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

  it('retains one safe error per failed candidate so the recovery route reports an exact failed count', () => {
    const ports = createExpenseTestPorts()
    ports.backend.failAttachmentAppendCount = 2
    for (const rootRequestId of ['private-invalid-a', 'private-invalid-b']) {
      const prepared = prepareWithManifest(ports, prepareCommand({
        rootRequestId, commandIdempotencyKey: `${rootRequestId}:prepare`,
      }))
      expect(() => executeExpenseCommand(commitCommand({
        rootRequestId,
        expenseId: prepared.prepared.expenseId,
        attachments: prepared.attachments,
      }), ports)).toThrow()
    }
    ports.backend.privateFilesValid = false

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 2,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_PRIVATE_FILE_INVALID', 'EXPENSE_PRIVATE_FILE_INVALID'],
    })
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
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)?.recordState).toBe('PREPARED')
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

  it('filters terminal rows before selecting the oldest 100 unresolved candidates', () => {
    const ports = createExpenseTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    const unresolved = executeExpenseCommand(prepareCommand({
      rootRequestId: 'old-unresolved', commandIdempotencyKey: 'old-unresolved:prepare',
    }), ports)
    if (unresolved.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected result')
    for (let index = 0; index < 101; index += 1) {
      const expenseId = `EXP-202608-RESOLVED-${String(index).padStart(3, '0')}`
      const rootRequestId = `resolved-${String(index).padStart(3, '0')}`
      const createdAt = new Date(Date.parse('2026-08-21T09:00:00+07:00') + index * 1_000).toISOString()
      ports.backend.appendMaster('EXPENSE_AUDIT', [{
        eventId: `EAUD:RESOLVED:${index}:P`,
        expenseId,
        actorStaffId: 'STAFF_01',
        action: 'PREPARE',
        beforeJson: '{}',
        afterJson: JSON.stringify({ rootRequestId, monthKey: '2026-08' }),
        createdAt,
        correlationId: `${rootRequestId}:prepare`,
      }, {
        eventId: `EAUD:RESOLVED:${index}:V`,
        expenseId,
        actorStaffId: 'MANAGER_01',
        action: 'VOID',
        beforeJson: '{}',
        afterJson: '{}',
        createdAt,
        correlationId: `${rootRequestId}:void`,
      }])
    }
    ports.backend.masterReadCount.clear()
    ports.setNow('2026-08-22T09:00:01+07:00')

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 1,
      errors: [],
    })
    expect(ports.backend.masterReadCount.get('EXPENSE_AUDIT')).toBe(1)
    expect(ports.backend.masterReadCount.get('EXPENSE_REQUESTS')).toBe(1)
    expect(ports.expense.getSubmission('2026-08', unresolved.expenseId)?.recordState).toBe('PREPARED')
  })

  it('treats a VOID submission and audit as terminal after 48 hours', () => {
    const ports = createExpenseTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-terminal', commandIdempotencyKey: 'void-terminal:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-terminal', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    executeExpenseCommand(voidCommand({
      rootRequestId: 'void-terminal-command', expenseId: prepared.prepared.expenseId, expectedVersion: 2,
    }), ports)
    ports.setNow('2026-08-23T09:00:00+07:00')

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 0,
      recovered: 0,
      abandoned: 0,
      errors: [],
    })
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId).map(({ action }) => action))
      .toEqual(['PREPARE', 'COMMIT', 'VOID'])
  })

  it('reuses the first durable VOID audit after request-completion failure', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-crash', commandIdempotencyKey: 'void-crash:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-crash', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const command = voidCommand({
      rootRequestId: 'void-crash-command', expenseId: prepared.prepared.expenseId, expectedVersion: 2,
    })
    ports.backend.failRequestCompletionCount = 1
    expect(() => executeExpenseCommand(command, ports)).toThrow('simulated request completion failure')
    const firstAudit = ports.expense.auditForExpense(prepared.prepared.expenseId)
      .find(({ action }) => action === 'VOID')!
    ports.setNow('2026-08-29T11:00:00+07:00')

    expect(executeExpenseCommand(command, ports)).toEqual({
      commandType: 'VOID_EXPENSE',
      expenseId: prepared.prepared.expenseId,
      recordState: 'VOID',
      version: 3,
      updatedAt: EXPENSE_NOW,
    })
    const voidAudits = ports.expense.auditForExpense(prepared.prepared.expenseId)
      .filter(({ action }) => action === 'VOID')
    expect(voidAudits).toEqual([firstAudit])
  })

  it('recovers a durable VOID audit whose submission update failed and converges once', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-audit-first', commandIdempotencyKey: 'void-audit-first:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-audit-first', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    ports.backend.failSubmissionUpdateCount = 1
    expect(() => executeExpenseCommand(voidCommand({
      rootRequestId: 'void-audit-first-command', expenseId: prepared.prepared.expenseId, expectedVersion: 2,
    }), ports)).toThrow('simulated submission update failure')
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED', version: 2,
    })

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 1, abandoned: 0, errors: [] })
    expect(runExpenseRecovery(ports)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
    expect(ports.expense.getSubmission('2026-08', prepared.prepared.expenseId)).toMatchObject({
      recordState: 'VOID', version: 3,
    })
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId).filter(({ action }) => action === 'VOID')).toHaveLength(1)
  })

  it('blocks a replacement while a durable VOID audit is waiting for row recovery', () => {
    const ports = createExpenseTestPorts()
    const original = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'void-pending-original', expectedRevision: 0, amountSatang: 10_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-pending-original', expenseId: original.prepared.expenseId,
      expectedRevision: 0, attachments: original.attachments,
    }), ports)
    ports.backend.failSubmissionUpdateCount = 1
    expect(() => executeExpenseCommand(voidCommand({
      rootRequestId: 'void-pending-action', expenseId: original.prepared.expenseId,
      expectedVersion: 2, expectedRevision: 1,
    }), ports)).toThrow('simulated submission update failure')

    const replacement = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'void-pending-replacement', expectedRevision: 1, amountSatang: 12_000,
    }))
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'void-pending-replacement', expenseId: replacement.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01',
      attachments: replacement.attachments.map((item) => ({ ...item, uploadedByStaffId: 'MANAGER_01' })),
    }), ports)).toThrow('EXPENSE_REVISION_CONFLICT')

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 2, recovered: 1, abandoned: 0, errors: [] })
    expect(ports.expense.getSubmission('2026-08', original.prepared.expenseId)).toMatchObject({
      recordState: 'VOID', version: 3,
    })
    expect(ports.expense.getSubmission('2026-08', replacement.prepared.expenseId)).toMatchObject({
      recordState: 'PREPARED', version: 1,
    })
    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toBeNull()
  })

  it('never mutates a predecessor when recovering a legacy partial VOID after a replacement committed', () => {
    const ports = createExpenseTestPorts()
    const original = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'legacy-void-original', expectedRevision: 0, amountSatang: 10_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'legacy-void-original', expenseId: original.prepared.expenseId,
      expectedRevision: 0, attachments: original.attachments,
    }), ports)
    ports.backend.failSubmissionUpdateCount = 1
    expect(() => executeExpenseCommand(voidCommand({
      rootRequestId: 'legacy-void-action', expenseId: original.prepared.expenseId,
      expectedVersion: 2, expectedRevision: 1,
    }), ports)).toThrow('simulated submission update failure')
    const auditRows = ports.backend.master.get('EXPENSE_AUDIT')!
    const pendingVoid = auditRows.find((row) => row.action === 'VOID')!
    ports.backend.master.set('EXPENSE_AUDIT', auditRows.filter((row) => row !== pendingVoid))

    const replacement = prepareWithManifest(ports, bookPrepareCommand({
      rootRequestId: 'legacy-void-replacement', expectedRevision: 1, amountSatang: 12_000,
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'legacy-void-replacement', expenseId: replacement.prepared.expenseId,
      expectedRevision: 1, staffId: 'MANAGER_01',
      attachments: replacement.attachments.map((item) => ({ ...item, uploadedByStaffId: 'MANAGER_01' })),
    }), ports)
    ports.backend.master.set('EXPENSE_AUDIT', [
      ...ports.backend.master.get('EXPENSE_AUDIT')!,
      pendingVoid,
    ])

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_REVISION_CONFLICT'],
    })
    expect(runExpenseRecovery(ports)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
    expect(ports.expense.getSubmission('2026-08', original.prepared.expenseId)).toMatchObject({
      recordState: 'COMMITTED', version: 2, revision: 1,
    })
    expect(ports.expense.effectiveByBookDailyKey('2026-08', 'CLINIC:2026-08-29')).toMatchObject({
      expenseId: replacement.prepared.expenseId, recordState: 'COMMITTED', revision: 2,
    })
  })

  it('reconstructs a missing VOID audit and request result from a durable state-first row', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-state-first', commandIdempotencyKey: 'void-state-first:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-state-first', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const command = voidCommand({
      rootRequestId: 'void-state-first-command', expenseId: prepared.prepared.expenseId, expectedVersion: 2,
    })
    executeExpenseCommand(command, ports)
    const audits = ports.backend.master.get('EXPENSE_AUDIT')!
    ports.backend.master.set('EXPENSE_AUDIT', audits.filter((row) => row.action !== 'VOID'))
    const requests = ports.backend.master.get('EXPENSE_REQUESTS')!
    ports.backend.master.set('EXPENSE_REQUESTS', requests.map((row) => row.commandIdempotencyKey === command.commandIdempotencyKey
      ? { ...row, recordState: 'RESERVED', resultJson: '' }
      : row))

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 1, abandoned: 0, errors: [] })
    expect(runExpenseRecovery(ports)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
    expect(ports.expense.auditForExpense(prepared.prepared.expenseId).filter(({ action }) => action === 'VOID')).toHaveLength(1)
  })

  it('recovers VOID after summary failure without changing the terminal result twice', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'void-summary', commandIdempotencyKey: 'void-summary:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'void-summary', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    ports.backend.failMonthlySummaryReplaceCount = 1
    expect(() => executeExpenseCommand(voidCommand({
      rootRequestId: 'void-summary-command', expenseId: prepared.prepared.expenseId, expectedVersion: 2,
    }), ports)).toThrow('simulated summary replace failure')

    expect(runExpenseRecovery(ports)).toEqual({ inspected: 1, recovered: 1, abandoned: 0, errors: [] })
    expect(runExpenseRecovery(ports)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
  })

  it('retries ABANDON after audit append and request completion faults without changing PREPARED', () => {
    const noCommit = createExpenseTestPorts({ now: '2026-08-27T09:00:00+07:00' })
    const stale = executeExpenseCommand(prepareCommand({
      rootRequestId: 'abandon-audit-fault', commandIdempotencyKey: 'abandon-audit-fault:prepare',
    }), noCommit)
    if (stale.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected result')
    noCommit.setNow('2026-08-29T09:00:01+07:00')
    noCommit.backend.failAuditAppendCount = 1
    expect(runExpenseRecovery(noCommit)).toEqual({
      inspected: 1, recovered: 0, abandoned: 0, errors: ['EXPENSE_STORAGE_UNAVAILABLE'],
    })
    expect(runExpenseRecovery(noCommit)).toEqual({ inspected: 1, recovered: 0, abandoned: 1, errors: [] })
    expect(noCommit.expense.getSubmission('2026-08', stale.expenseId)).toMatchObject({ recordState: 'PREPARED', version: 1 })

    const withCommit = createExpenseTestPorts({ now: '2026-08-27T09:00:00+07:00' })
    const partial = prepareWithManifest(withCommit, prepareCommand({
      rootRequestId: 'abandon-request-fault', commandIdempotencyKey: 'abandon-request-fault:prepare',
    }))
    withCommit.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'abandon-request-fault', expenseId: partial.prepared.expenseId,
      attachments: partial.attachments,
    }), withCommit)).toThrow()
    withCommit.backend.privateFilesValid = false
    withCommit.backend.failRequestCompletionCount = 1
    withCommit.setNow('2026-08-29T09:00:01+07:00')
    expect(runExpenseRecovery(withCommit)).toEqual({
      inspected: 1, recovered: 0, abandoned: 0, errors: ['EXPENSE_STORAGE_UNAVAILABLE'],
    })
    expect(runExpenseRecovery(withCommit)).toEqual({ inspected: 1, recovered: 0, abandoned: 1, errors: [] })
    expect(runExpenseRecovery(withCommit)).toEqual({ inspected: 0, recovered: 0, abandoned: 0, errors: [] })
  })

  it('reuses the first durable RECOVER audit after request-completion failure', () => {
    const ports = createExpenseTestPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'recover-crash', commandIdempotencyKey: 'recover-crash:prepare',
    }))
    ports.backend.failAttachmentAppendCount = 1
    expect(() => executeExpenseCommand(commitCommand({
      rootRequestId: 'recover-crash', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)).toThrow()
    ports.backend.failRequestCompletionCount = 1

    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_STORAGE_UNAVAILABLE'],
    })
    const firstAudit = ports.expense.auditForExpense(prepared.prepared.expenseId)
      .find(({ action }) => action === 'RECOVER')!
    ports.setNow('2026-08-29T11:00:00+07:00')
    expect(runExpenseRecovery(ports)).toEqual({
      inspected: 1,
      recovered: 1,
      abandoned: 0,
      errors: [],
    })
    const recoverAudits = ports.expense.auditForExpense(prepared.prepared.expenseId)
      .filter(({ action }) => action === 'RECOVER')
    expect(recoverAudits).toEqual([firstAudit])
  })
})
