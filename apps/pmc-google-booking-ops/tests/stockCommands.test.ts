import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MiniAppStockCommand, StockAuditEvent, StockLedgerEntry, StockProduct } from '../../../shared/pmcStock'
import { createStockRepository } from '../src/repositories'
import { executeStockCommand, type StockCommandPorts } from '../src/stock/commands'
import { createMemorySheetStore } from './helpers/fakes'

const NOW = '2026-08-28T09:00:00+07:00'

function productFixture(productId: string, patch: Partial<StockProduct> = {}): StockProduct {
  return {
    productId,
    name: `สินค้า ${productId}`,
    normalizedName: `สินค้า ${productId}`,
    category: 'CLINIC_SUPPLY',
    unit: 'ชิ้น',
    minimumQuantityMilli: 1_000,
    active: true,
    createdAt: NOW,
    createdByStaffId: 'ADMIN_03',
    updatedAt: NOW,
    updatedByStaffId: 'ADMIN_03',
    version: 1,
    ...patch,
  }
}

function openingEntry(productId: string, quantityMilli: number, lineNumber: number): StockLedgerEntry {
  return {
    transactionId: `TX-SEED-${lineNumber}`,
    documentId: `OPEN-SEED-${lineNumber}`,
    requestId: `seed-${lineNumber}`,
    lineNumber: 1,
    productId,
    transactionType: 'OPENING',
    quantityDeltaMilli: quantityMilli,
    balanceBeforeMilli: 0,
    balanceAfterMilli: quantityMilli,
    actorStaffId: 'ADMIN_03',
    actorDisplayName: 'ผู้จัดการสต็อก',
    reason: '',
    idempotencyKey: `seed-${lineNumber}:1`,
    createdAt: NOW,
  }
}

function stockPortsWithBalances(seed: Record<string, number>) {
  const store = createMemorySheetStore()
  const stock = createStockRepository(store)
  const products = Object.entries(seed).map(([productId]) => productFixture(productId))
  for (const product of products) stock.insertProduct(product)
  stock.appendLedgerBatch(
    Object.entries(seed).map(([productId, quantityMilli], index) => openingEntry(productId, quantityMilli, index + 1)),
  )

  let lockCalls = 0
  const sequences = new Map<string, number>()
  const ports: StockCommandPorts & { lockCalls(): number; auditRows(): StockAuditEvent[] } = {
    clock: { nowIso: () => NOW },
    locks: {
      withLock<T>(operation: () => T): T {
        lockCalls += 1
        return operation()
      },
    },
    staff: {
      findById(staffId) {
        if (staffId === 'ADMIN_01') {
          return { id: 'ADMIN_01', name: 'พนักงาน', active: true, canManageStock: false }
        }
        if (staffId === 'ADMIN_03') {
          return { id: 'ADMIN_03', name: 'ผู้จัดการสต็อก', active: true, canManageStock: true }
        }
        if (staffId === 'INACTIVE_01') {
          return { id: 'INACTIVE_01', name: 'พนักงานเก่า', active: false, canManageStock: true }
        }
        return null
      },
    },
    stock,
    commandFingerprint(command) {
      return createHash('sha256').update(JSON.stringify(command)).digest('hex')
    },
    allocateId(prefix) {
      const next = (sequences.get(prefix) ?? 0) + 1
      sequences.set(prefix, next)
      return `${prefix}-${String(next).padStart(6, '0')}`
    },
    lockCalls: () => lockCalls,
    auditRows: () => store.read('STOCK_AUDIT') as unknown as StockAuditEvent[],
  }
  return ports
}

function issueCommand(requestId: string, productId: string, quantityMilli: number): MiniAppStockCommand {
  return {
    requestId,
    staffId: 'ADMIN_01',
    commandType: 'ISSUE',
    payload: { lines: [{ productId, quantityMilli }] },
  }
}

describe('stock commands', () => {
  it('rejects the complete multi-line issue when one product is insufficient', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000, 'STK-000002': 1_000 })

    expect(() => executeStockCommand({
      requestId: 'request-issue-1',
      commandType: 'ISSUE',
      staffId: 'ADMIN_01',
      payload: {
        lines: [
          { productId: 'STK-000001', quantityMilli: 2_000 },
          { productId: 'STK-000002', quantityMilli: 2_000 },
        ],
      },
    }, ports)).toThrow('STOCK_INSUFFICIENT_BALANCE')
    expect(ports.stock.listLedger()).toHaveLength(2)
  })

  it('allows an active non-manager to issue stock', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(executeStockCommand(issueCommand('request-issue-staff', 'STK-000001', 1_000), ports)).toMatchObject({
      requestId: 'request-issue-staff',
      commandType: 'ISSUE',
      lines: [{ productId: 'STK-000001', quantityDeltaMilli: -1_000, balanceAfterMilli: 4_000 }],
    })
  })

  it('uses deterministic request-and-line idempotency keys in one issue document', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000, 'STK-000002': 5_000 })
    executeStockCommand({
      requestId: 'request-line-keys', staffId: 'ADMIN_01', commandType: 'ISSUE',
      payload: { lines: [
        { productId: 'STK-000001', quantityMilli: 1_000 },
        { productId: 'STK-000002', quantityMilli: 2_000 },
      ] },
    }, ports)

    expect(ports.stock.listLedger().filter((row) => row.requestId === 'request-line-keys').map((row) => row.idempotencyKey))
      .toEqual(['request-line-keys:1', 'request-line-keys:2'])
  })

  it('requires a manager for receive', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand({
      requestId: 'request-receive-staff',
      staffId: 'ADMIN_01',
      commandType: 'RECEIVE',
      payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    }, ports)).toThrow('STOCK_MANAGER_REQUIRED')
    expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
  })

  it('returns the original result for a repeated request ID', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    const command = issueCommand('request-issue-2', 'STK-000001', 1_000)

    expect(executeStockCommand(command, ports)).toEqual(executeStockCommand(command, ports))
    expect(ports.stock.listLedger().filter((row) => row.requestId === 'request-issue-2')).toHaveLength(1)
  })

  it('serializes two competing issue requests through the lock', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(executeStockCommand(issueCommand('issue-a', 'STK-000001', 4_000), ports))
      .toMatchObject({ requestId: 'issue-a' })
    expect(() => executeStockCommand(issueCommand('issue-b', 'STK-000001', 4_000), ports))
      .toThrow('STOCK_INSUFFICIENT_BALANCE')
    expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(1_000)
    expect(ports.lockCalls()).toBe(2)
  })

  it.each(['UNKNOWN_01', 'INACTIVE_01'])(
    'rejects issue by missing or inactive staff %s',
    (staffId) => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
      const command = { ...issueCommand(`issue-${staffId}`, 'STK-000001', 1_000), staffId }

      expect(() => executeStockCommand(command, ports)).toThrow('STOCK_STAFF_REQUIRED')
      expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
    },
  )

  it.each<MiniAppStockCommand>([
    {
      requestId: 'manager-create', staffId: 'ADMIN_01', commandType: 'CREATE_PRODUCT',
      payload: { name: 'สินค้าใหม่', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', openingQuantityMilli: 0, minimumQuantityMilli: 0 },
    },
    {
      requestId: 'manager-receive', staffId: 'ADMIN_01', commandType: 'RECEIVE',
      payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    },
    {
      requestId: 'manager-adjust', staffId: 'ADMIN_01', commandType: 'ADJUST',
      payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason: 'ตรวจนับ' },
    },
    {
      requestId: 'manager-update', staffId: 'ADMIN_01', commandType: 'UPDATE_PRODUCT',
      payload: {
        productId: 'STK-000001', expectedVersion: 1, name: 'สินค้าแก้ไข', category: 'CLINIC_SUPPLY',
        unit: 'ชิ้น', minimumQuantityMilli: 1_000,
      },
    },
    {
      requestId: 'manager-deactivate', staffId: 'ADMIN_01', commandType: 'DEACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 1 },
    },
    {
      requestId: 'manager-reactivate', staffId: 'ADMIN_01', commandType: 'REACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 1 },
    },
  ])('requires a manager for $commandType', (command) => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand(command, ports)).toThrow('STOCK_MANAGER_REQUIRED')
    expect(ports.stock.getProduct('STK-000001')?.version).toBe(1)
    expect(ports.stock.listLedger()).toHaveLength(1)
  })

  it.each([
    ['empty lines', [], 'STOCK_INVALID_LINES'],
    ['zero quantity', [{ productId: 'STK-000001', quantityMilli: 0 }], 'STOCK_INVALID_QUANTITY'],
    ['fractional milli quantity', [{ productId: 'STK-000001', quantityMilli: 1.5 }], 'STOCK_INVALID_QUANTITY'],
    ['duplicate products', [
      { productId: 'STK-000001', quantityMilli: 1_000 },
      { productId: 'STK-000001', quantityMilli: 1_000 },
    ], 'STOCK_DUPLICATE_PRODUCT'],
    ['missing product', [{ productId: 'STK-999999', quantityMilli: 1_000 }], 'STOCK_PRODUCT_NOT_FOUND'],
  ] as const)('rejects issue with %s before appending any line', (_case, lines, error) => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand({
      requestId: `invalid-issue-${error}`,
      staffId: 'ADMIN_01',
      commandType: 'ISSUE',
      payload: { lines: [...lines] },
    }, ports)).toThrow(error)
    expect(ports.stock.listLedger()).toHaveLength(1)
  })

  it('rejects an inactive issue product before appending any line', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000, 'STK-000002': 5_000 })
    ports.stock.updateProduct('STK-000002', 1, { active: false })

    expect(() => executeStockCommand({
      requestId: 'invalid-inactive-issue',
      staffId: 'ADMIN_01',
      commandType: 'ISSUE',
      payload: { lines: [
        { productId: 'STK-000001', quantityMilli: 1_000 },
        { productId: 'STK-000002', quantityMilli: 1_000 },
      ] },
    }, ports)).toThrow('STOCK_PRODUCT_INACTIVE')
    expect(ports.stock.listLedger()).toHaveLength(2)
  })

  it('creates a product with an opening row and receives a validated batch', () => {
    const ports = stockPortsWithBalances({})
    const created = executeStockCommand({
      requestId: 'create-product-1',
      staffId: 'ADMIN_03',
      commandType: 'CREATE_PRODUCT',
      payload: {
        name: '  ถุงมือ  ', category: 'CLINIC_SUPPLY', unit: ' กล่อง ',
        openingQuantityMilli: 10_000, minimumQuantityMilli: 2_000,
      },
    }, ports)
    const productId = created.lines[0]?.productId

    expect(productId).toBe('STK-000001')
    expect(ports.stock.getProduct(productId!)).toMatchObject({
      name: 'ถุงมือ', normalizedName: 'ถุงมือ', unit: 'กล่อง', minimumQuantityMilli: 2_000, version: 1,
    })
    expect(created.lines).toEqual([
      { productId: 'STK-000001', quantityDeltaMilli: 10_000, balanceAfterMilli: 10_000 },
    ])

    expect(executeStockCommand({
      requestId: 'receive-product-1',
      staffId: 'ADMIN_03',
      commandType: 'RECEIVE',
      payload: { lines: [{ productId: productId!, quantityMilli: 5_000 }] },
    }, ports).lines).toEqual([
      { productId: 'STK-000001', quantityDeltaMilli: 5_000, balanceAfterMilli: 15_000 },
    ])
    expect(ports.stock.listLedger().map((row) => row.transactionType)).toEqual(['OPENING', 'RECEIVE'])
  })

  it('rejects the complete receive batch when a later line is invalid', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand({
      requestId: 'receive-invalid-second-line',
      staffId: 'ADMIN_03',
      commandType: 'RECEIVE',
      payload: { lines: [
        { productId: 'STK-000001', quantityMilli: 2_000 },
        { productId: 'STK-999999', quantityMilli: 2_000 },
      ] },
    }, ports)).toThrow('STOCK_PRODUCT_NOT_FOUND')
    expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
    expect(ports.stock.listLedger()).toHaveLength(1)
  })

  it('replays product creation with zero opening quantity without a zero ledger row', () => {
    const ports = stockPortsWithBalances({})
    const command = {
      requestId: 'create-zero-opening', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT' as const,
      payload: {
        name: 'สำลี', category: 'CLINIC_SUPPLY' as const, unit: 'ห่อ',
        openingQuantityMilli: 0, minimumQuantityMilli: 1_000,
      },
    }

    const first = executeStockCommand(command, ports)
    expect(executeStockCommand(command, ports)).toEqual(first)
    expect(first).toMatchObject({ documentId: 'STK-000001', lines: [] })
    expect(ports.stock.listProducts()).toHaveLength(1)
    expect(ports.stock.listLedger()).toHaveLength(0)
    expect(ports.auditRows().filter((row) => row.requestId === 'create-zero-opening' && row.status === 'ACCEPTED')).toHaveLength(1)
  })

  it('rejects a duplicate active normalized product name', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 1_000 })
    ports.stock.updateProduct('STK-000001', 1, { name: 'ถุงมือ ยาง', normalizedName: 'ถุงมือ ยาง' })

    expect(() => executeStockCommand({
      requestId: 'create-duplicate-name',
      staffId: 'ADMIN_03',
      commandType: 'CREATE_PRODUCT',
      payload: {
        name: '  ถุงมือ   ยาง ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
        openingQuantityMilli: 0, minimumQuantityMilli: 0,
      },
    }, ports)).toThrow('STOCK_PRODUCT_NAME_EXISTS')
  })

  it('records signed positive and negative counted adjustments', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(executeStockCommand({
      requestId: 'adjust-up', staffId: 'ADMIN_03', commandType: 'ADJUST',
      payload: { productId: 'STK-000001', countedQuantityMilli: 7_000, reason: ' ตรวจนับรอบเช้า ' },
    }, ports).lines).toEqual([
      { productId: 'STK-000001', quantityDeltaMilli: 2_000, balanceAfterMilli: 7_000 },
    ])
    expect(executeStockCommand({
      requestId: 'adjust-down', staffId: 'ADMIN_03', commandType: 'ADJUST',
      payload: { productId: 'STK-000001', countedQuantityMilli: 4_000, reason: 'ตรวจนับรอบเย็น' },
    }, ports).lines).toEqual([
      { productId: 'STK-000001', quantityDeltaMilli: -3_000, balanceAfterMilli: 4_000 },
    ])
    expect(ports.stock.listLedger().slice(1).map((row) => [row.quantityDeltaMilli, row.reason])).toEqual([
      [2_000, 'ตรวจนับรอบเช้า'],
      [-3_000, 'ตรวจนับรอบเย็น'],
    ])
  })

  it.each(['', '   ', 'x'.repeat(301)])('rejects adjustment reason %j', (reason) => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand({
      requestId: `adjust-reason-${reason.length}`, staffId: 'ADMIN_03', commandType: 'ADJUST',
      payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason },
    }, ports)).toThrow('STOCK_ADJUST_REASON_REQUIRED')
    expect(ports.stock.listLedger()).toHaveLength(1)
  })

  it('audits a zero-delta adjustment without writing a ledger row and replays it exactly', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    const command = {
      requestId: 'adjust-zero', staffId: 'ADMIN_03', commandType: 'ADJUST' as const,
      payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason: 'ตรงกับยอดระบบ' },
    }

    const first = executeStockCommand(command, ports)
    const second = executeStockCommand(command, ports)
    expect(second).toEqual(first)
    expect(first.lines).toEqual([])
    expect(ports.stock.listLedger()).toHaveLength(1)
    expect(ports.auditRows().filter((row) => row.requestId === 'adjust-zero' && row.status === 'ACCEPTED')).toHaveLength(1)
  })

  it('updates, deactivates, and reactivates a product with optimistic versions', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 0 })
    expect(executeStockCommand({
      requestId: 'update-product', staffId: 'ADMIN_03', commandType: 'UPDATE_PRODUCT',
      payload: {
        productId: 'STK-000001', expectedVersion: 1, name: 'สินค้าใหม่', category: 'RETAIL_PRODUCT',
        unit: 'ชิ้น', minimumQuantityMilli: 500,
      },
    }, ports).lines).toEqual([])
    expect(ports.stock.getProduct('STK-000001')).toMatchObject({
      name: 'สินค้าใหม่', normalizedName: 'สินค้าใหม่', category: 'RETAIL_PRODUCT',
      minimumQuantityMilli: 500, version: 2,
    })

    executeStockCommand({
      requestId: 'deactivate-product', staffId: 'ADMIN_03', commandType: 'DEACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 2 },
    }, ports)
    expect(ports.stock.getProduct('STK-000001')).toMatchObject({ active: false, version: 3 })

    executeStockCommand({
      requestId: 'reactivate-product', staffId: 'ADMIN_03', commandType: 'REACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 3 },
    }, ports)
    expect(ports.stock.getProduct('STK-000001')).toMatchObject({ active: true, version: 4 })
    expect(ports.auditRows().filter((row) => row.status === 'ACCEPTED')).toHaveLength(3)
  })

  it('does not allow changing a unit after ledger activity', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })

    expect(() => executeStockCommand({
      requestId: 'update-unit', staffId: 'ADMIN_03', commandType: 'UPDATE_PRODUCT',
      payload: {
        productId: 'STK-000001', expectedVersion: 1, name: 'สินค้า STK-000001',
        category: 'CLINIC_SUPPLY', unit: 'กล่อง', minimumQuantityMilli: 1_000,
      },
    }, ports)).toThrow('STOCK_UNIT_LOCKED')
  })

  it('returns the original audit-only result without repeating its product mutation', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 0 })
    const command = {
      requestId: 'audit-only-update', staffId: 'ADMIN_03', commandType: 'UPDATE_PRODUCT' as const,
      payload: {
        productId: 'STK-000001', expectedVersion: 1, name: 'เปลี่ยนชื่อ', category: 'CLINIC_SUPPLY' as const,
        unit: 'ชิ้น', minimumQuantityMilli: 0,
      },
    }

    const first = executeStockCommand(command, ports)
    expect(executeStockCommand(command, ports)).toEqual(first)
    expect(first.lines).toEqual([])
    expect(ports.stock.getProduct('STK-000001')?.version).toBe(2)
    expect(ports.auditRows().filter((row) => row.requestId === 'audit-only-update' && row.status === 'ACCEPTED')).toHaveLength(1)
  })

  it.each([
    ['ledger-backed', issueCommand('conflict-ledger', 'STK-000001', 1_000), issueCommand('conflict-ledger', 'STK-000001', 2_000)],
    [
      'audit-only',
      {
        requestId: 'conflict-audit', staffId: 'ADMIN_03', commandType: 'ADJUST',
        payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason: 'ยอดแรก' },
      },
      {
        requestId: 'conflict-audit', staffId: 'ADMIN_03', commandType: 'ADJUST',
        payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason: 'ยอดแก้ไข' },
      },
    ],
  ] as const)('rejects a conflicting %s retry under one request ID', (_case, first, changed) => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    executeStockCommand(first, ports)

    expect(() => executeStockCommand(changed, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
  })

  it('rejects a changed command type under an accepted request ID', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    executeStockCommand(issueCommand('conflict-command-type', 'STK-000001', 1_000), ports)

    expect(() => executeStockCommand({
      requestId: 'conflict-command-type', staffId: 'ADMIN_01', commandType: 'RECEIVE',
      payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    }, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
  })

  it('rejects an accepted ledger-backed journal whose original document is missing', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    const command = issueCommand('missing-ledger-document', 'STK-000001', 1_000)
    ports.stock.appendAudit({
      eventId: 'AUDIT-MISSING-LEDGER',
      requestId: command.requestId,
      actorStaffId: command.staffId,
      action: command.commandType,
      status: 'ACCEPTED',
      safeErrorCode: '',
      targetProductIdsJson: '["STK-000001"]',
      correlationId: `ISS-MISSING|${ports.commandFingerprint(command)}`,
      createdAt: NOW,
    })

    expect(() => executeStockCommand(command, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
  })

  it('appends exactly one accepted audit for every successful command', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    executeStockCommand(issueCommand('audit-success', 'STK-000001', 1_000), ports)

    expect(ports.auditRows().filter((row) => row.requestId === 'audit-success')).toEqual([
      expect.objectContaining({
        action: 'ISSUE', status: 'ACCEPTED', correlationId: expect.stringMatching(/^ISS-\d+\|[a-f0-9]{64}$/),
      }),
    ])
  })
})
