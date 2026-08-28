import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  MiniAppStockCommand,
  StockLedgerEntry,
  StockProduct,
} from '../../../shared/pmcStock'
import {
  canonicalMiniAppStockCommand,
  canonicalMiniAppStockIngress,
  type MiniAppStockIngressEnvelope,
} from '../../../shared/pmcMiniAppStockIngress'
import { processBookingDoPost } from '../src/entrypoints'
import { createStockRepository, type SheetRow, type SheetStore } from '../src/repositories'
import { configureStockManagersWorkflow } from '../src/runtime'
import { SHEET_SCHEMAS, STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'
import {
  configureStockManagers,
  processStockIngress,
  processStockIngressResponse,
  type StockIngressPorts,
} from '../src/stock/ingress'
import { createMemorySheetStore, createTestPorts } from './helpers/fakes'

const NOW_SECONDS = 1_800_000_000
const NOW_ISO = new Date(NOW_SECONDS * 1_000).toISOString()
const SECRET = 'ingress-secret'
const MANAGER_IDS = ['shared-account-test', 'ADMIN_07', 'ADMIN_03'] as const
type StockLineCommand = {
  requestId: string
  staffId: string
  commandType: 'RECEIVE' | 'ISSUE'
  payload: { lines: Array<{ productId: string; quantityMilli: number }> }
}
type IssueCommand = Omit<StockLineCommand, 'commandType'> & { commandType: 'ISSUE' }
type ReceiveCommand = Omit<StockLineCommand, 'commandType'> & { commandType: 'RECEIVE' }

describe('Apps Script Mini App Stock ingress', () => {
  it('accepts a signed issue, routes it through doPost, and consumes its nonce', () => {
    const ports = createStockIngressPorts()
    const envelope = signedEnvelope(issueCommand())

    expect(processStockIngress(envelope, ports)).toMatchObject({
      requestId: 'issue-stock-1',
      commandType: 'ISSUE',
      lines: [{ productId: 'STK-000001', quantityDeltaMilli: -1_000, balanceAfterMilli: 4_000 }],
    })
    expect(ports.repositories.lineDirectory.hasNonce('nonce-stock-123')).toBe(true)

    const routed = createRoutedPorts()
    const routedEnvelope = signedEnvelope(
      issueCommand({ staffId: 'admin-1' }),
      { nonce: 'nonce-routed-123' },
    )
    expect(processBookingDoPost(event(routedEnvelope), routed)).toMatchObject({
      ok: true,
      result: { requestId: 'issue-stock-1', commandType: 'ISSUE' },
    })
  })

  it.each([
    ['insufficient balance', issueCommand({
      requestId: 'issue-insufficient', payload: { lines: [{ productId: 'STK-000001', quantityMilli: 6_000 }] },
    }), 'STOCK_INSUFFICIENT_BALANCE'],
    ['manager required', receiveCommand({ requestId: 'receive-staff', staffId: 'ADMIN_01' }), 'STOCK_MANAGER_REQUIRED'],
    ['stale product', updateCommand({ requestId: 'update-stale', payload: {
      productId: 'STK-000001', expectedVersion: 0, name: 'ถุงมือ', category: 'CLINIC_SUPPLY',
      unit: 'กล่อง', minimumQuantityMilli: 1_000,
    } }), 'STOCK_STALE_PRODUCT'],
  ])('returns one strict safe envelope for %s', (_name, command, error) => {
    expect(processStockIngressResponse(signedEnvelope(command, {
      nonce: `nonce-${command.requestId}`,
    }), createStockIngressPorts())).toEqual({ ok: false, error })
  })

  it('returns recovery-required and idempotency-conflict without internal details', () => {
    const recoveryPorts = createStockIngressPorts()
    recoveryPorts.stock.appendAudit({
      eventId: 'AUDIT:pending:P', requestId: 'pending-request', actorStaffId: 'ADMIN_01', action: 'ISSUE',
      status: 'PREPARED', safeErrorCode: '', targetProductIdsJson: '["STK-000001"]',
      correlationId: `ISS-pending|${'a'.repeat(64)}`, createdAt: NOW_ISO,
    })
    expect(processStockIngressResponse(signedEnvelope(issueCommand({ requestId: 'issue-blocked' }), {
      nonce: 'nonce-recovery-blocked',
    }), recoveryPorts)).toEqual({ ok: false, error: 'STOCK_RECOVERY_REQUIRED' })

    const retryPorts = createStockIngressPorts()
    const original = issueCommand({ requestId: 'issue-conflict' })
    expect(processStockIngressResponse(signedEnvelope(original, { nonce: 'nonce-conflict-first' }), retryPorts))
      .toMatchObject({ ok: true })
    expect(processStockIngressResponse(signedEnvelope(issueCommand({
      requestId: 'issue-conflict', payload: { lines: [{ productId: 'STK-000001', quantityMilli: 2_000 }] },
    }), { nonce: 'nonce-conflict-second' }), retryPorts)).toEqual({
      ok: false, error: 'STOCK_IDEMPOTENCY_CONFLICT',
    })
  })

  it('redacts unrecognized internal failures to Stock storage unavailable', () => {
    const invalid = signedEnvelope(issueCommand(), { nonce: 'nonce-private-failure' })
    invalid.signature = '0'.repeat(64)

    expect(processStockIngressResponse(invalid, createStockIngressPorts())).toEqual({
      ok: false,
      error: 'STOCK_STORAGE_UNAVAILABLE',
    })
  })

  it.each([
    ['altered quantity', () => tamper(signedEnvelope(issueCommand()), (envelope) => {
      const command = envelope.command as IssueCommand
      command.payload.lines[0].quantityMilli = 9_999
    })],
    ['expired timestamp', () => signedEnvelope(issueCommand(), {
      timestamp: NOW_SECONDS - 301,
      nonce: 'nonce-expired-1',
    })],
  ])('rejects %s without changing the ledger', (_name, build) => {
    const ports = createStockIngressPorts()

    expect(() => processStockIngress(build(), ports)).toThrow()
    expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
  })

  it('rejects unknown envelope, command, payload, and line keys before HMAC verification', () => {
    const cases: unknown[] = [
      { ...signedEnvelope(issueCommand()), debug: true },
      tamper(signedEnvelope(issueCommand()), (envelope) => {
        Object.assign(envelope.command, { debug: true })
      }),
      tamper(signedEnvelope(issueCommand()), (envelope) => {
        Object.assign(envelope.command.payload, { debug: true })
      }),
      tamper(signedEnvelope(issueCommand()), (envelope) => {
        const command = envelope.command as IssueCommand
        Object.assign(command.payload.lines[0], { debug: true })
      }),
    ]

    for (const candidate of cases) {
      const ports = createStockIngressPorts()
      expect(() => processStockIngress(candidate, ports)).toThrow('invalid mini app stock')
      expect(ports.hmacCalls()).toBe(0)
    }
  })

  it('rejects a replayed nonce before executing the command twice', () => {
    const ports = createStockIngressPorts()
    const envelope = signedEnvelope(issueCommand())
    processStockIngress(envelope, ports)

    expect(() => processStockIngress(envelope, ports)).toThrow('mini app stock ingress replay detected')
    expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(4_000)
  })

  it('rejects inactive staff and reserves receive for the exact configured managers', () => {
    const inactivePorts = createStockIngressPorts()
    expect(() => processStockIngress(signedEnvelope(issueCommand({
      requestId: 'issue-inactive', staffId: 'INACTIVE_01',
    }), { nonce: 'nonce-inactive-1' }), inactivePorts)).toThrow('STOCK_STAFF_REQUIRED')

    const staffPorts = createStockIngressPorts()
    expect(() => processStockIngress(signedEnvelope(receiveCommand({
      requestId: 'receive-staff', staffId: 'ADMIN_01',
    }), { nonce: 'nonce-receive-staff' }), staffPorts)).toThrow('STOCK_MANAGER_REQUIRED')

    for (const [index, staffId] of MANAGER_IDS.entries()) {
      const ports = createStockIngressPorts()
      expect(processStockIngress(signedEnvelope(receiveCommand({
        requestId: `receive-manager-${index + 1}`, staffId,
      }), { nonce: `nonce-manager-${index + 1}` }), ports)).toMatchObject({
        commandType: 'RECEIVE',
        lines: [{ productId: 'STK-000001', quantityDeltaMilli: 1_000, balanceAfterMilli: 6_000 }],
      })
    }
  })

  it('returns the prior document for a repeated request ID with a fresh signed nonce', () => {
    const ports = createStockIngressPorts()
    const command = issueCommand({ requestId: 'issue-idempotent' })
    const first = processStockIngress(signedEnvelope(command, { nonce: 'nonce-first-123' }), ports)
    const retry = processStockIngress(signedEnvelope(command, { nonce: 'nonce-retry-123' }), ports)

    expect(retry).toEqual(first)
    expect(ports.stock.listLedger().filter((row) => row.requestId === command.requestId)).toHaveLength(1)
    expect(ports.stock.findAuditJournalByRequestId(command.requestId)).toMatchObject({
      prepared: { status: 'PREPARED' },
      accepted: { status: 'ACCEPTED' },
    })
  })

  it('uses the same stable canonical command JSON for the Task 4 fingerprint', () => {
    const ports = createStockIngressPorts()
    const command = issueCommand()
    const expected = createHash('sha256')
      .update('{"requestId":"issue-stock-1","staffId":"ADMIN_01","commandType":"ISSUE","payload":{"lines":[{"productId":"STK-000001","quantityMilli":1000}]}}')
      .digest('hex')

    expect(canonicalMiniAppStockCommand(command)).toBe(
      '{"requestId":"issue-stock-1","staffId":"ADMIN_01","commandType":"ISSUE","payload":{"lines":[{"productId":"STK-000001","quantityMilli":1000}]}}',
    )
    expect(ports.commandFingerprint(command)).toBe(expected)
  })
})

describe('PMC Stock manager configuration', () => {
  it('keeps all three Stock repository tabs in the Apps Script Sheet protocol', () => {
    expect(SHEET_SCHEMAS.STOCK_PRODUCTS).toEqual([
      'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
      'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
    ])
    expect(SHEET_SCHEMAS.STOCK_LEDGER).toEqual([
      'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
      'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
      'reason', 'idempotencyKey', 'createdAt',
    ])
    expect(SHEET_SCHEMAS.STOCK_AUDIT).toEqual([
      'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
      'targetProductIdsJson', 'correlationId', 'createdAt',
    ])
  })

  it('sets only the three exact active manager IDs and preserves every other column', () => {
    const rows = staffRows()
    const store = new TrackingStore(rows)

    expect(configureStockManagers(store)).toEqual({ managerCount: 3, changedRows: 4 })
    expect(store.rows()).toEqual(rows.map((row) => ({
      ...row,
      canManageStock: MANAGER_IDS.includes(String(row.id) as typeof MANAGER_IDS[number]),
    })))
    expect(store.replaceCalls).toBe(1)

    expect(configureStockManagers(store)).toEqual({ managerCount: 3, changedRows: 0 })
    expect(store.replaceCalls).toBe(1)
  })

  it('writes only the canManageStock column after validating the live Sheet rows', () => {
    const sheet = new TrackingGoogleSheet(staffRows())
    vi.stubGlobal('PropertiesService', {
      getScriptProperties: () => ({ getProperty: () => 'spreadsheet-1' }),
    })
    vi.stubGlobal('SpreadsheetApp', {
      openById: () => ({ getSheetByName: (name: string) => name === 'CONFIG_STAFF' ? sheet : null }),
    })
    try {
      expect(configureStockManagersWorkflow()).toEqual({ managerCount: 3, changedRows: 4 })
      expect(sheet.writeRanges).toEqual([{
        row: 2,
        column: STAFF_CONFIG_COLUMNS.indexOf('canManageStock') + 1,
        rowCount: 4,
        columnCount: 1,
      }])
      expect(sheet.rows()).toEqual(staffRows().map((row) => ({
        ...row,
        canManageStock: MANAGER_IDS.includes(String(row.id) as typeof MANAGER_IDS[number]),
      })))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    ['missing manager', staffRows().filter((row) => row.id !== 'ADMIN_07')],
    ['inactive manager', staffRows().map((row) => row.id === 'ADMIN_03' ? { ...row, active: false } : row)],
    ['duplicate manager', [...staffRows(), { ...staffRows()[0], name: 'บัญชีซ้ำ' }]],
  ])('validates %s before any write', (_name, rows) => {
    const store = new TrackingStore(rows)

    expect(() => configureStockManagers(store)).toThrow('invalid PMC Stock manager configuration')
    expect(store.replaceCalls).toBe(0)
    expect(store.rows()).toEqual(rows)
  })
})

interface TestStockIngressPorts extends StockIngressPorts {
  hmacCalls(): number
}

function createStockIngressPorts(): TestStockIngressPorts {
  const store = createMemorySheetStore()
  const stock = createStockRepository(store)
  stock.insertProduct(productFixture())
  stock.appendLedgerBatch([openingFixture()])
  const staff = new Map([
    ['ADMIN_01', { id: 'ADMIN_01', name: 'พนักงาน', active: true, canManageStock: false }],
    ['INACTIVE_01', { id: 'INACTIVE_01', name: 'พนักงานเก่า', active: false, canManageStock: true }],
    ...MANAGER_IDS.map((id) => [id, { id, name: id, active: true, canManageStock: true }] as const),
  ])
  const nonces = new Set<string>()
  const sequences = new Map<string, number>()
  let hmacCalls = 0
  return {
    clock: { nowIso: () => NOW_ISO },
    locks: { withLock: (operation) => operation() },
    config: { findStaffById: (staffId) => staff.get(staffId) ?? null },
    repositories: {
      lineDirectory: {
        hasNonce: (nonce) => nonces.has(nonce),
        rememberNonce: (nonce) => { nonces.add(nonce) },
      },
    },
    secrets: { bookingIngressSecret: () => SECRET },
    crypto: {
      hmacSha256Hex(value, secret) {
        hmacCalls += 1
        return createHmac('sha256', secret).update(value).digest('hex')
      },
      sha256Hex: (value) => createHash('sha256').update(value).digest('hex'),
    },
    stock,
    commandFingerprint: (command) => createHash('sha256')
      .update(canonicalMiniAppStockCommand(command))
      .digest('hex'),
    allocateId(prefix) {
      const next = (sequences.get(prefix) ?? 0) + 1
      sequences.set(prefix, next)
      return `${prefix}-${String(next).padStart(6, '0')}`
    },
    hmacCalls: () => hmacCalls,
  }
}

function createRoutedPorts() {
  const booking = createTestPorts({ now: NOW_ISO })
  const stockPorts = createStockIngressPorts()
  return Object.assign(booking, {
    stock: stockPorts.stock,
    commandFingerprint: stockPorts.commandFingerprint,
    allocateId: stockPorts.allocateId,
  })
}

function issueCommand(patch: Partial<IssueCommand> = {}): IssueCommand {
  return {
    requestId: 'issue-stock-1',
    staffId: 'ADMIN_01',
    commandType: 'ISSUE',
    payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    ...patch,
  }
}

function receiveCommand(patch: Partial<ReceiveCommand> = {}): ReceiveCommand {
  return {
    requestId: 'receive-stock-1',
    staffId: 'ADMIN_03',
    commandType: 'RECEIVE',
    payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    ...patch,
  }
}

function updateCommand(
  patch: Partial<Extract<MiniAppStockCommand, { commandType: 'UPDATE_PRODUCT' }>> = {},
): Extract<MiniAppStockCommand, { commandType: 'UPDATE_PRODUCT' }> {
  return {
    requestId: 'update-stock-1',
    staffId: 'ADMIN_03',
    commandType: 'UPDATE_PRODUCT',
    payload: {
      productId: 'STK-000001', expectedVersion: 1, name: 'ถุงมือ', category: 'CLINIC_SUPPLY',
      unit: 'กล่อง', minimumQuantityMilli: 1_000,
    },
    ...patch,
  }
}

function signedEnvelope(
  command: MiniAppStockCommand,
  context: { timestamp?: number; nonce?: string } = {},
): MiniAppStockIngressEnvelope {
  const unsigned = {
    kind: 'MINI_APP_STOCK' as const,
    version: 1 as const,
    timestamp: context.timestamp ?? NOW_SECONDS,
    nonce: context.nonce ?? 'nonce-stock-123',
    command: JSON.parse(JSON.stringify(command)) as MiniAppStockCommand,
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppStockIngress(unsigned))
      .digest('hex'),
  }
}

function tamper(
  envelope: MiniAppStockIngressEnvelope,
  mutate: (envelope: MiniAppStockIngressEnvelope) => void,
): MiniAppStockIngressEnvelope {
  const clone = JSON.parse(JSON.stringify(envelope)) as MiniAppStockIngressEnvelope
  mutate(clone)
  return clone
}

function productFixture(): StockProduct {
  return {
    productId: 'STK-000001',
    name: 'ถุงมือ',
    normalizedName: 'ถุงมือ',
    category: 'CLINIC_SUPPLY',
    unit: 'กล่อง',
    minimumQuantityMilli: 1_000,
    active: true,
    createdAt: NOW_ISO,
    createdByStaffId: 'ADMIN_03',
    updatedAt: NOW_ISO,
    updatedByStaffId: 'ADMIN_03',
    version: 1,
  }
}

function openingFixture(): StockLedgerEntry {
  return {
    transactionId: 'OPEN-1',
    documentId: 'OPEN-1',
    requestId: 'opening-1',
    lineNumber: 1,
    productId: 'STK-000001',
    transactionType: 'OPENING',
    quantityDeltaMilli: 5_000,
    balanceBeforeMilli: 0,
    balanceAfterMilli: 5_000,
    actorStaffId: 'ADMIN_03',
    actorDisplayName: 'ADMIN_03',
    reason: '',
    idempotencyKey: 'opening-1:1',
    createdAt: NOW_ISO,
  }
}

function staffRows(): SheetRow[] {
  return [
    { id: 'shared-account-test', name: 'เจ้าของ', email: 'owner@example.com', lineUserId: 'line-owner', canCloseBooking: true, canBeAe: false, active: true, profileImageUrl: 'owner.png', canManageStock: false },
    { id: 'ADMIN_07', name: 'อาย', email: 'ai@example.com', lineUserId: 'line-ai', canCloseBooking: true, canBeAe: true, active: true, profileImageUrl: 'ai.png', canManageStock: false },
    { id: 'ADMIN_03', name: 'หมวย', email: 'muay@example.com', lineUserId: 'line-muay', canCloseBooking: true, canBeAe: true, active: true, profileImageUrl: 'muay.png', canManageStock: false },
    { id: 'ADMIN_01', name: 'พนักงาน', email: 'staff@example.com', lineUserId: 'line-staff', canCloseBooking: true, canBeAe: true, active: true, profileImageUrl: 'staff.png', canManageStock: true },
  ]
}

class TrackingStore implements SheetStore {
  private current: SheetRow[]
  replaceCalls = 0

  constructor(rows: SheetRow[]) {
    this.current = structuredClone(rows)
  }

  read(tab: string): SheetRow[] {
    if (tab !== 'CONFIG_STAFF') throw new Error(`unexpected tab ${tab}`)
    return structuredClone(this.current)
  }

  replace(tab: string, rows: SheetRow[]): void {
    if (tab !== 'CONFIG_STAFF') throw new Error(`unexpected tab ${tab}`)
    this.replaceCalls += 1
    this.current = structuredClone(rows)
  }

  rows(): SheetRow[] {
    return structuredClone(this.current)
  }
}

class TrackingGoogleSheet {
  private readonly values: unknown[][]
  readonly writeRanges: Array<{
    row: number
    column: number
    rowCount: number
    columnCount: number
  }> = []

  constructor(rows: SheetRow[]) {
    this.values = [
      [...STAFF_CONFIG_COLUMNS],
      ...rows.map((row) => STAFF_CONFIG_COLUMNS.map((header) => row[header])),
    ]
  }

  getLastColumn(): number { return STAFF_CONFIG_COLUMNS.length }
  getLastRow(): number { return this.values.length }

  getRange(row: number, column: number, rowCount = 1, columnCount = 1) {
    const read = () => Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        this.values[row - 1 + rowIndex]?.[column - 1 + columnIndex] ?? '',
      ),
    )
    return {
      getValues: read,
      getDisplayValues: () => read().map((values) => values.map(String)),
      clearContent: () => {
        this.writeRanges.push({ row, column, rowCount, columnCount })
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            this.values[row - 1 + rowIndex]![column - 1 + columnIndex] = ''
          }
        }
      },
      setValues: (next: unknown[][]) => {
        this.writeRanges.push({ row, column, rowCount, columnCount })
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            this.values[row - 1 + rowIndex]![column - 1 + columnIndex] = next[rowIndex]![columnIndex]
          }
        }
      },
    }
  }

  rows(): SheetRow[] {
    return this.values.slice(1).map((values) => Object.fromEntries(
      STAFF_CONFIG_COLUMNS.map((header, index) => [header, values[index]]),
    ))
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return {
    postData: {
      contents,
      length: contents.length,
      name: 'postData',
      type: 'application/json',
    },
  }
}
