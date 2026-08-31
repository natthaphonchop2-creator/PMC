import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppExpenseCommand,
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseRecoveryIngress,
  canonicalMiniAppExpenseResumeIngress,
  type MiniAppExpenseCommand,
  type MiniAppExpenseIngressEnvelope,
  type MiniAppExpenseRecoveryIngressEnvelope,
  type MiniAppExpenseResumeIngressEnvelope,
} from '../../../shared/pmcMiniAppExpenseIngress'
import { processBookingDoPost } from '../src/entrypoints'
import {
  processExpenseIngress,
  processExpenseIngressResponse,
  processExpenseRecoveryIngressResponse,
  processExpenseResumeIngressResponse,
  type ExpenseIngressPorts,
} from '../src/expense/ingress'
import { createTestPorts } from './helpers/fakes'
import {
  EXPENSE_NOW,
  createExpenseTestPorts,
  commitCommand,
  prepareCommand,
  prepareWithManifest,
} from './helpers/expenseFakes'
import { executeExpenseCommand, type ExpenseCommandPorts } from '../src/expense/commands'

const SECRET = 'expense-ingress-secret'
const NOW_SECONDS = Math.floor(Date.parse(EXPENSE_NOW) / 1_000)

describe('Apps Script Mini App expense ingress', () => {
  it('accepts a signed PREPARE, routes MINI_APP_EXPENSE through doPost, and consumes the nonce', () => {
    const ports = createExpenseIngressPorts()
    const command = prepareCommand({ rootRequestId: 'ingress-direct', commandIdempotencyKey: 'ingress-direct:prepare' })
    expect(processExpenseIngress(signedEnvelope(command), ports)).toMatchObject({
      commandType: 'PREPARE_EXPENSE', recordState: 'PREPARED', monthKey: '2026-08',
    })
    expect(ports.repositories.lineDirectory.hasNonce('expense-nonce-123')).toBe(true)

    const routed = createRoutedPorts()
    const routedCommand = prepareCommand({
      rootRequestId: 'ingress-routed', commandIdempotencyKey: 'ingress-routed:prepare',
    })
    expect(processBookingDoPost(event(signedEnvelope(routedCommand, 'expense-route-123')), routed)).toMatchObject({
      ok: true,
      result: { commandType: 'PREPARE_EXPENSE', recordState: 'PREPARED' },
    })
  })

  it('runs signed recovery for the bound worker and returns only safe counts', () => {
    const ports = createExpenseIngressPorts()
    processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId: 'recovery-recent', commandIdempotencyKey: 'recovery-recent:prepare',
    }), 'expense-recovery-prep'), ports)

    const response = processExpenseRecoveryIngressResponse(signedRecoveryEnvelope(), ports)

    expect(response).toEqual({
      ok: true,
      result: { recovered: 0, abandoned: 0, unchanged: 1, failed: 0 },
    })
    if (!response.ok) throw new Error('unexpected recovery failure')
    expect(Object.keys(response.result).sort()).toEqual(['abandoned', 'failed', 'recovered', 'unchanged'])
  })

  it('returns one submitter-owned durable receipt and denies another staff member without history', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-committed', commandIdempotencyKey: 'resume-committed:prepare',
    }))
    const committed = executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-committed', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    if (committed.commandType !== 'COMMIT_EXPENSE') throw new Error('unexpected commit')
    const receipt = Object.fromEntries(
      Object.entries(committed).filter(([key]) => key !== 'commandType'),
    )

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-committed', staffId: 'STAFF_01', nonce: 'resume-owner-123',
    }), ports)).toEqual({
      ok: true,
      result: { status: 'COMMITTED', receipt },
    })
    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-committed', staffId: 'MANAGER_01', nonce: 'resume-other-123',
    }), ports)
    expect(response).toEqual({ ok: false, error: 'EXPENSE_RESUME_FORBIDDEN' })
    expect(JSON.stringify(response)).not.toContain(prepared.prepared.expenseId)
  })

  it('returns PENDING for an owned PREPARED root and SAFE_TO_RETRY for an unused root', () => {
    const ports = createExpenseIngressPorts()
    executeExpenseCommand(prepareCommand({
      rootRequestId: 'resume-pending', commandIdempotencyKey: 'resume-pending:prepare',
    }), ports)

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-pending', staffId: 'STAFF_01', nonce: 'resume-pending-1',
    }), ports)).toEqual({ ok: true, result: { status: 'PENDING' } })
    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-unused', staffId: 'STAFF_01', nonce: 'resume-unused-12',
    }), ports)).toEqual({ ok: true, result: { status: 'SAFE_TO_RETRY' } })
  })

  it('derives reservation-only resume ownership from the verified canonical command', () => {
    const ports = createExpenseIngressPorts()
    const command = prepareCommand({
      rootRequestId: 'resume-reserved', commandIdempotencyKey: 'resume-reserved:prepare',
    })
    const commandJson = canonicalMiniAppExpenseCommand(command)
    ports.expense.reserveRequest({
      commandIdempotencyKey: command.commandIdempotencyKey,
      rootRequestId: command.rootRequestId,
      commandType: command.commandType,
      commandFingerprint: ports.crypto.sha256Hex(commandJson),
      commandJson,
      expenseId: 'EXP-202608-0099',
      monthKey: '2026-08',
      createdAt: EXPENSE_NOW,
    })

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: command.rootRequestId, staffId: 'STAFF_01', nonce: 'resume-reserved-owner',
    }), ports)).toEqual({ ok: true, result: { status: 'PENDING' } })
    const denied = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: command.rootRequestId, staffId: 'MANAGER_01', nonce: 'resume-reserved-other',
    }), ports)
    expect(denied).toEqual({ ok: false, error: 'EXPENSE_RESUME_FORBIDDEN' })
    expect(JSON.stringify(denied)).not.toContain(command.staffId)
  })

  it('fails closed when a valid COMMITTED result is swapped from another root', () => {
    const ports = createExpenseIngressPorts()
    const first = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-swap-a', commandIdempotencyKey: 'resume-swap-a:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-swap-a', expenseId: first.prepared.expenseId,
      attachments: first.attachments,
    }), ports)
    const secondBase = prepareCommand({
      rootRequestId: 'resume-swap-b', commandIdempotencyKey: 'resume-swap-b:prepare',
    })
    const second = prepareWithManifest(ports, {
      ...secondBase,
      payload: { ...secondBase.payload, amountSatang: 99_000 },
    })
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-swap-b', expenseId: second.prepared.expenseId,
      attachments: second.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const firstCommit = requests.find((row) => row.commandIdempotencyKey === 'resume-swap-a:commit')!
    const secondCommit = requests.find((row) => row.commandIdempotencyKey === 'resume-swap-b:commit')!
    firstCommit.resultJson = secondCommit.resultJson

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-swap-a', staffId: 'STAFF_01', nonce: 'resume-swap-owner',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
    expect(JSON.stringify(response)).not.toContain(second.prepared.expenseId)
  })

  it('fails closed when COMMITTED request authority no longer binds the stored submission and audit', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-authority', commandIdempotencyKey: 'resume-corrupt-authority:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-authority', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const commitRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-authority:commit')!
    const command = JSON.parse(String(commitRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
    command.payload.expectedVersion = 2
    commitRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    commitRequest.commandFingerprint = ports.crypto.sha256Hex(String(commitRequest.commandJson))

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-authority', staffId: 'STAFF_01', nonce: 'resume-corrupt-command',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('fails closed when the COMMIT audit timestamp is swapped away from the exact durable receipt', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-audit', commandIdempotencyKey: 'resume-corrupt-audit:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-audit', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const audits = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
    const commitAudit = audits.find((row) => row.action === 'COMMIT')!
    const payload = JSON.parse(String(commitAudit.afterJson)) as Record<string, unknown>
    commitAudit.afterJson = JSON.stringify({ ...payload, committedAt: '2026-08-29T10:00:01+07:00' })

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-audit', staffId: 'STAFF_01', nonce: 'resume-corrupt-audit',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
    expect(JSON.stringify(response)).not.toContain(prepared.prepared.expenseId)
  })

  it('fails closed when COMMIT attachments no longer match the signed PREPARE manifest', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-manifest', commandIdempotencyKey: 'resume-corrupt-manifest:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-manifest', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const commitRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-manifest:commit')!
    const command = JSON.parse(String(commitRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
    command.payload.attachments[0] = {
      ...command.payload.attachments[0]!,
      originalFileName: 'tampered-receipt.jpg',
    }
    commitRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    commitRequest.commandFingerprint = ports.crypto.sha256Hex(String(commitRequest.commandJson))
    const commitAudit = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
      .find((row) => row.action === 'COMMIT')!
    const auditPayload = JSON.parse(String(commitAudit.afterJson)) as Record<string, unknown>
    commitAudit.afterJson = JSON.stringify({
      ...auditPayload,
      commandFingerprint: commitRequest.commandFingerprint,
      attachments: command.payload.attachments,
    })
    commitAudit.eventId = `EAUD:${String(commitRequest.commandFingerprint).slice(0, 48)}:C`

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-manifest', staffId: 'STAFF_01', nonce: 'resume-corrupt-manifest',
    }), ports)).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('fails closed when the stored PREPARE command business intent diverges from its durable submission', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-prepare', commandIdempotencyKey: 'resume-corrupt-prepare:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-prepare', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const prepareRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-prepare:prepare')!
    const command = JSON.parse(String(prepareRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }>
    command.payload.amountSatang += 1
    prepareRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    prepareRequest.commandFingerprint = ports.crypto.sha256Hex(String(prepareRequest.commandJson))
    const prepareAudit = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
      .find((row) => row.action === 'PREPARE')!
    const auditPayload = JSON.parse(String(prepareAudit.afterJson)) as Record<string, unknown>
    prepareAudit.afterJson = JSON.stringify({
      ...auditPayload,
      commandFingerprint: prepareRequest.commandFingerprint,
    })
    prepareAudit.eventId = `EAUD:${String(prepareRequest.commandFingerprint).slice(0, 48)}:P`

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-prepare', staffId: 'STAFF_01', nonce: 'resume-corrupt-prepare',
    }), ports)).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('routes signed recovery through doPost without exposing worker or private topology', () => {
    const routed = createRoutedPorts()
    const response = processBookingDoPost(event(signedRecoveryEnvelope('expense-recovery-route')), routed)

    expect(response).toEqual({
      ok: true,
      result: { recovered: 0, abandoned: 0, unchanged: 0, failed: 0 },
    })
    expect(JSON.stringify(response)).not.toContain('pmc-mini-app-task-invoker')
    expect(JSON.stringify(response)).not.toContain('spreadsheet')
    expect(JSON.stringify(response)).not.toContain('folder')
  })

  it('rejects recovery worker tampering and nonce replay with one fixed safe code', () => {
    const ports = createExpenseIngressPorts()
    const tampered = signedRecoveryEnvelope('expense-recovery-tamper')
    tampered.worker = { ...tampered.worker, subject: 'different-google-subject' }
    expect(processExpenseRecoveryIngressResponse(tampered, ports)).toEqual({
      ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })

    const replayed = signedRecoveryEnvelope('expense-recovery-replay')
    expect(processExpenseRecoveryIngressResponse(replayed, ports)).toEqual({
      ok: true, result: { recovered: 0, abandoned: 0, unchanged: 0, failed: 0 },
    })
    expect(processExpenseRecoveryIngressResponse(replayed, ports)).toEqual({
      ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
  })

  it.each([
    ['expired', NOW_SECONDS - 301],
    ['future', NOW_SECONDS + 301],
  ])('rejects a %s recovery envelope outside the exact five-minute boundary', (_case, timestamp) => {
    const ports = createExpenseIngressPorts()
    expect(processExpenseRecoveryIngressResponse(
      signedRecoveryEnvelope(`expense-recovery-${_case}`, timestamp),
      ports,
    )).toEqual({ ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE' })
    expect(ports.expenseBackend.monthOperationCount).toBe(0)
  })

  it.each([
    ['tampered signature', () => ({ ...signedEnvelope(prepareCommand()), signature: '0'.repeat(64) })],
    ['expired timestamp', () => signedEnvelope(prepareCommand(), 'expense-expired-1', NOW_SECONDS - 301)],
    ['future timestamp', () => signedEnvelope(prepareCommand(), 'expense-future-12', NOW_SECONDS + 301)],
  ])('rejects %s without touching monthly storage', (_name, candidate) => {
    const ports = createExpenseIngressPorts()
    expect(() => processExpenseIngress(candidate(), ports)).toThrow()
    expect(ports.expenseBackend.monthOperationCount).toBe(0)
  })

  it('rejects unknown envelope and command keys before HMAC verification', () => {
    const envelope = signedEnvelope(prepareCommand()) as MiniAppExpenseIngressEnvelope & { debug?: boolean }
    envelope.debug = true
    const ports = createExpenseIngressPorts()

    expect(() => processExpenseIngress(envelope, ports)).toThrow('invalid mini app expense')
    expect(ports.hmacCalls()).toBe(0)
  })

  it('rejects a replayed nonce before executing a second command', () => {
    const ports = createExpenseIngressPorts()
    const envelope = signedEnvelope(prepareCommand())
    processExpenseIngress(envelope, ports)

    expect(() => processExpenseIngress(envelope, ports)).toThrow('mini app expense ingress replay detected')
    expect(ports.expense.listMonth('2026-08')).toHaveLength(1)
  })

  it('fails closed for inactive and non-submitter staff', () => {
    const inactive = createExpenseIngressPorts()
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand({
      rootRequestId: 'inactive-request', commandIdempotencyKey: 'inactive-request:prepare', staffId: 'INACTIVE_01',
    }), 'expense-inactive-1'), inactive)).toEqual({ ok: false, error: 'EXPENSE_STAFF_REQUIRED' })

    const denied = createExpenseIngressPorts({ denySubmit: true })
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand({
      rootRequestId: 'denied-request', commandIdempotencyKey: 'denied-request:prepare',
    }), 'expense-denied-123'), denied)).toEqual({
      ok: false,
      error: 'EXPENSE_SUBMIT_PERMISSION_REQUIRED',
    })
  })

  it('returns only fixed safe codes and never raw repository or signature detail', () => {
    const ports = createExpenseIngressPorts()
    ports.expenseBackend.ensureMonth = () => { throw new Error('external Sheets failure SECRET-ID') }
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand()), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })

    const invalid = signedEnvelope(prepareCommand(), 'expense-invalid-1')
    invalid.signature = '0'.repeat(64)
    expect(processExpenseIngressResponse(invalid, createExpenseIngressPorts())).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
  })
})

type TestExpenseIngressPorts = ExpenseIngressPorts & ExpenseCommandPorts & {
  expenseBackend: ReturnType<typeof createExpenseTestPorts>['backend']
  hmacCalls(): number
}

function createExpenseIngressPorts(options: { denySubmit?: boolean } = {}): TestExpenseIngressPorts {
  const commandPorts = createExpenseTestPorts()
  const nonces = new Set<string>()
  let calls = 0
  return {
    ...commandPorts,
    expenseBackend: commandPorts.backend,
    config: {
      findStaffById(staffId) {
        const staff = commandPorts.staff.findById(staffId)
        return staff ? { ...staff, canSubmitExpense: options.denySubmit ? false : staff.canSubmitExpense } : null
      },
    },
    repositories: {
      lineDirectory: {
        hasNonce: (nonce) => nonces.has(nonce),
        rememberNonce: (nonce) => { nonces.add(nonce) },
      },
    },
    expenseSecrets: { expenseIngressSecret: () => SECRET },
    expenseCommandFingerprint: commandPorts.commandFingerprint,
    crypto: {
      sha256Hex: commandPorts.crypto.sha256Hex,
      hmacSha256Hex(value, secret) {
        calls += 1
        return createHmac('sha256', secret).update(value).digest('hex')
      },
    },
    hmacCalls: () => calls,
  }
}

function createRoutedPorts() {
  const booking = createTestPorts({ now: EXPENSE_NOW })
  const expense = createExpenseIngressPorts()
  return {
    ...booking,
    config: {
      ...booking.config,
      findStaffById(staffId: string) {
        const staff = expense.config.findStaffById(staffId)
        return staff ? {
          ...staff,
          email: `${staff.id.toLowerCase()}@example.test`,
          lineUserId: `U-${staff.id}`,
          canCloseBooking: false,
          canBeAe: false,
          canManageStock: false,
          canViewFinance: staff.canManageExpense,
        } : null
      },
    },
    repositories: {
      ...booking.repositories,
      lineDirectory: {
        ...booking.repositories.lineDirectory,
        hasNonce: expense.repositories.lineDirectory.hasNonce,
        rememberNonce: expense.repositories.lineDirectory.rememberNonce,
      },
    },
    expense: expense.expense,
    expenseSecrets: expense.expenseSecrets,
    expenseCommandFingerprint: expense.expenseCommandFingerprint,
    allocateExpenseId: expense.allocateExpenseId,
    crypto: {
      ...booking.crypto,
      hmacSha256Hex: expense.crypto.hmacSha256Hex,
      sha256Hex: expense.crypto.sha256Hex,
    },
  }
}

function signedEnvelope(
  command: MiniAppExpenseCommand,
  nonce = 'expense-nonce-123',
  timestamp = NOW_SECONDS,
): MiniAppExpenseIngressEnvelope {
  const unsigned = { kind: 'MINI_APP_EXPENSE' as const, version: 1 as const, timestamp, nonce, command }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseIngress(unsigned))
      .digest('hex'),
  }
}

function signedRecoveryEnvelope(
  nonce = 'expense-recovery-123',
  timestamp = NOW_SECONDS,
): MiniAppExpenseRecoveryIngressEnvelope {
  const unsigned = {
    kind: 'MINI_APP_EXPENSE_RECOVERY' as const,
    version: 1 as const,
    timestamp,
    nonce,
    correlationId: 'expense-recovery-correlation-1',
    worker: {
      email: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
      subject: 'google-subject-1',
    },
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseRecoveryIngress(unsigned))
      .digest('hex'),
  }
}

function signedResumeEnvelope(input: {
  rootRequestId: string
  staffId: string
  nonce: string
}): MiniAppExpenseResumeIngressEnvelope {
  const unsigned = {
    kind: 'MINI_APP_EXPENSE_RESUME' as const,
    version: 1 as const,
    timestamp: NOW_SECONDS,
    nonce: input.nonce,
    rootRequestId: input.rootRequestId,
    staffId: input.staffId,
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseResumeIngress(unsigned))
      .digest('hex'),
  }
}

function event(envelope: unknown) {
  return {
    postData: {
      contents: JSON.stringify(envelope),
      length: JSON.stringify(envelope).length,
      name: 'postData',
      type: 'application/json',
    },
  }
}
