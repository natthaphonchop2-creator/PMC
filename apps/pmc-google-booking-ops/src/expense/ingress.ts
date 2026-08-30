import type { MiniAppExpenseCommand } from '../../../../shared/pmcMiniAppExpenseIngress'
import {
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseRecoveryIngress,
  isMiniAppExpenseSafeErrorCode,
  type ExpenseRecoveryCounts,
  type MiniAppExpenseIngressEnvelope,
  type MiniAppExpenseIngressResponse,
  type MiniAppExpenseRecoveryIngressEnvelope,
  type MiniAppExpenseRecoveryIngressResponse,
  type UnsignedMiniAppExpenseIngressEnvelope,
  type UnsignedMiniAppExpenseRecoveryIngressEnvelope,
} from '../../../../shared/pmcMiniAppExpenseIngress'
import type { ExpenseRepository } from '../ports'
import { executeExpenseCommand, runExpenseRecovery } from './commands'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command', 'signature'] as const
const RECOVERY_ENVELOPE_KEYS = [
  'kind',
  'version',
  'timestamp',
  'nonce',
  'correlationId',
  'worker',
  'signature',
] as const

export interface ExpenseIngressPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  config: {
    findStaffById(staffId: string): {
      id: string
      name: string
      active: boolean
      canSubmitExpense: boolean
      canManageExpense: boolean
    } | null
  }
  repositories: {
    lineDirectory: {
      hasNonce(nonce: string): boolean
      rememberNonce(nonce: string, capturedAt: string): void
    }
  }
  expense: ExpenseRepository
  expenseSecrets: { expenseIngressSecret(): string }
  crypto: {
    hmacSha256Hex(value: string, secret: string): string
    sha256Hex(value: string): string
  }
  expenseCommandFingerprint(command: MiniAppExpenseCommand): string
  allocateExpenseId(monthKey: string): string
}

export function processExpenseIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
) {
  const envelope = verifyEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return executeExpenseCommand(envelope.command, {
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
  })
}

export function processExpenseIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseIngressResponse {
  try {
    return { ok: true, result: processExpenseIngress(input, ports) }
  } catch (error) {
    return { ok: false, error: safeExpenseIngressError(error) }
  }
}

export function processExpenseRecoveryIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
): ExpenseRecoveryCounts {
  const envelope = verifyRecoveryEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense recovery ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    const result = runExpenseRecovery({
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
    const failed = result.errors.length
    const unchanged = result.inspected - result.recovered - result.abandoned - failed
    if (
      unchanged < 0
      || result.recovered + result.abandoned + unchanged + failed > 100
    ) throw new Error('invalid expense recovery result')
    return {
      recovered: result.recovered,
      abandoned: result.abandoned,
      unchanged,
      failed,
    }
  })
}

export function processExpenseRecoveryIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseRecoveryIngressResponse {
  try {
    return { ok: true, result: processExpenseRecoveryIngress(input, ports) }
  } catch {
    return { ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE' }
  }
}

function safeExpenseIngressError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return isMiniAppExpenseSafeErrorCode(message) ? message : 'EXPENSE_STORAGE_UNAVAILABLE'
}

function verifyEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseIngressEnvelope {
  if (!hasExactKeys(input, ENVELOPE_KEYS)) {
    throw new Error('invalid mini app expense ingress envelope')
  }
  if (
    input.kind !== 'MINI_APP_EXPENSE'
    || input.version !== 1
    || !Number.isSafeInteger(input.timestamp)
    || typeof input.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)
    || typeof input.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.signature)
  ) throw new Error('invalid mini app expense ingress envelope')

  const unsigned: UnsignedMiniAppExpenseIngressEnvelope = {
    kind: 'MINI_APP_EXPENSE',
    version: 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce,
    command: input.command as MiniAppExpenseCommand,
  }
  const canonical = canonicalMiniAppExpenseIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.expenseSecrets.expenseIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app expense ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function verifyRecoveryEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseRecoveryIngressEnvelope {
  if (!hasExactKeys(input, RECOVERY_ENVELOPE_KEYS)) {
    throw new Error('invalid mini app expense recovery ingress envelope')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app expense recovery ingress signature')
  }
  const unsigned: UnsignedMiniAppExpenseRecoveryIngressEnvelope = {
    kind: input.kind as 'MINI_APP_EXPENSE_RECOVERY',
    version: input.version as 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce as string,
    correlationId: input.correlationId as string,
    worker: input.worker as UnsignedMiniAppExpenseRecoveryIngressEnvelope['worker'],
  }
  const canonical = canonicalMiniAppExpenseRecoveryIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.expenseSecrets.expenseIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app expense recovery ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense recovery ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
