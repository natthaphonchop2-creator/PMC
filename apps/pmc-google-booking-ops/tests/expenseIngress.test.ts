import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppExpenseIngress,
  type MiniAppExpenseCommand,
  type MiniAppExpenseIngressEnvelope,
} from '../../../shared/pmcMiniAppExpenseIngress'
import { processBookingDoPost } from '../src/entrypoints'
import {
  processExpenseIngress,
  processExpenseIngressResponse,
  type ExpenseIngressPorts,
} from '../src/expense/ingress'
import { createTestPorts } from './helpers/fakes'
import {
  EXPENSE_NOW,
  createExpenseTestPorts,
  prepareCommand,
} from './helpers/expenseFakes'

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

interface TestExpenseIngressPorts extends ExpenseIngressPorts {
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

function event(envelope: MiniAppExpenseIngressEnvelope) {
  return {
    postData: {
      contents: JSON.stringify(envelope),
      length: JSON.stringify(envelope).length,
      name: 'postData',
      type: 'application/json',
    },
  }
}
