import type { MiniAppStockCommand, StockCommandResult } from '../../../../shared/pmcStock'
import {
  canonicalMiniAppStockIngress,
  type MiniAppStockIngressEnvelope,
  type UnsignedMiniAppStockIngressEnvelope,
} from '../../../../shared/pmcMiniAppStockIngress'
import type { SheetStore } from '../repositories'
import type { StockRepository } from '../ports'
import { executeStockCommand } from './commands'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command', 'signature'] as const
export const PMC_STOCK_MANAGER_IDS = [
  'shared-account-test',
  'ADMIN_07',
  'ADMIN_03',
] as const

export interface StockIngressPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  config: {
    findStaffById(staffId: string): {
      id: string
      name: string
      active: boolean
      canManageStock: boolean
    } | null
  }
  repositories: {
    lineDirectory: {
      hasNonce(nonce: string): boolean
      rememberNonce(nonce: string, capturedAt: string): void
    }
  }
  secrets: { bookingIngressSecret(): string }
  crypto: {
    hmacSha256Hex(value: string, secret: string): string
    sha256Hex(value: string): string
  }
  stock: StockRepository
  commandFingerprint(command: MiniAppStockCommand): string
  allocateId(prefix: 'STK' | 'ISS' | 'RCV' | 'ADJ' | 'TX' | 'AUDIT'): string
}

export function processStockIngress(
  input: unknown,
  ports: StockIngressPorts,
): StockCommandResult {
  const envelope = verifyEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app stock ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return executeStockCommand(envelope.command, {
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      stock: ports.stock,
      commandFingerprint: ports.commandFingerprint,
      allocateId: ports.allocateId,
    })
  })
}

export function configureStockManagers(store: SheetStore): {
  managerCount: 3
  changedRows: number
} {
  const rows = store.read('CONFIG_STAFF')
  for (const managerId of PMC_STOCK_MANAGER_IDS) {
    const matches = rows.filter((row) => row.id === managerId)
    if (matches.length !== 1 || !isActive(matches[0].active)) {
      throw new Error('invalid PMC Stock manager configuration')
    }
  }

  const managerIds = new Set<string>(PMC_STOCK_MANAGER_IDS)
  const updated = rows.map((row) => ({
    ...row,
    canManageStock: managerIds.has(String(row.id)),
  }))
  const changedRows = updated.filter(
    (row, index) => row.canManageStock !== rows[index].canManageStock,
  ).length
  if (changedRows > 0) store.replace('CONFIG_STAFF', updated)
  return { managerCount: 3, changedRows }
}

function verifyEnvelope(input: unknown, ports: StockIngressPorts): MiniAppStockIngressEnvelope {
  if (!hasExactKeys(input, ENVELOPE_KEYS)) {
    throw new Error('invalid mini app stock ingress envelope')
  }
  if (
    input.kind !== 'MINI_APP_STOCK' ||
    input.version !== 1 ||
    !Number.isSafeInteger(input.timestamp) ||
    typeof input.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce) ||
    typeof input.signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.signature)
  ) {
    throw new Error('invalid mini app stock ingress envelope')
  }

  const unsigned: UnsignedMiniAppStockIngressEnvelope = {
    kind: 'MINI_APP_STOCK',
    version: 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce,
    command: input.command as MiniAppStockCommand,
  }
  const canonical = canonicalMiniAppStockIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.secrets.bookingIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app stock ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app stock ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function isActive(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
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
