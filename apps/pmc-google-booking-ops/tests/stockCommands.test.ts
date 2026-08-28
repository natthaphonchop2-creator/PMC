import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MiniAppStockCommand, StockAuditEvent, StockLedgerEntry, StockProduct } from '../../../shared/pmcStock'
import type { StockRepository } from '../src/ports'
import { createStockRepository } from '../src/repositories'
import { executeStockCommand, type StockCommandPorts } from '../src/stock/commands'
import { createMemorySheetStore } from './helpers/fakes'

const NOW = '2026-08-28T09:00:00+07:00'
type FaultBoundary = 'PREPARED' | 'PRODUCT' | 'LEDGER' | 'ACCEPTED'

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

function stockPortsWithBalances(seed: Record<string, number>, failAfter?: FaultBoundary) {
  const store = createMemorySheetStore()
  const baseStock = createStockRepository(store)
  const products = Object.entries(seed).map(([productId]) => productFixture(productId))
  for (const product of products) baseStock.insertProduct(product)
  baseStock.appendLedgerBatch(
    Object.entries(seed).map(([productId, quantityMilli], index) => openingEntry(productId, quantityMilli, index + 1)),
  )

  let faultInjected = false
  function failOnce(boundary: FaultBoundary): void {
    if (failAfter === boundary && !faultInjected) {
      faultInjected = true
      throw new Error(`FAULT_AFTER_${boundary}`)
    }
  }
  const stock: StockRepository = {
    listProducts: () => baseStock.listProducts(),
    getProduct: (productId) => baseStock.getProduct(productId),
    insertProduct(product) {
      const result = baseStock.insertProduct(product)
      failOnce('PRODUCT')
      return result
    },
    updateProduct(productId, expectedVersion, patch) {
      const result = baseStock.updateProduct(productId, expectedVersion, patch)
      failOnce('PRODUCT')
      return result
    },
    listLedger: () => baseStock.listLedger(),
    appendLedgerBatch(entries) {
      baseStock.appendLedgerBatch(entries)
      if (entries.length > 0) failOnce('LEDGER')
    },
    balanceByProduct: () => baseStock.balanceByProduct(),
    findDocumentByRequestId: (requestId) => baseStock.findDocumentByRequestId(requestId),
    findAuditJournalByRequestId: (requestId) => baseStock.findAuditJournalByRequestId(requestId),
    listUnresolvedPrepared: () => baseStock.listUnresolvedPrepared(),
    findAcceptedAuditByRequestId: (requestId) => baseStock.findAcceptedAuditByRequestId(requestId),
    appendAudit(event) {
      baseStock.appendAudit(event)
      if (event.status === 'PREPARED') failOnce('PREPARED')
      if (event.status === 'ACCEPTED') failOnce('ACCEPTED')
    },
  }

  let lockCalls = 0
  let now = NOW
  const staffRows = new Map([
    ['ADMIN_01', { id: 'ADMIN_01', name: 'พนักงาน', active: true, canManageStock: false }],
    ['ADMIN_03', { id: 'ADMIN_03', name: 'ผู้จัดการสต็อก', active: true, canManageStock: true }],
    ['INACTIVE_01', { id: 'INACTIVE_01', name: 'พนักงานเก่า', active: false, canManageStock: true }],
  ])
  const sequences = new Map<string, number>()
  const ports: StockCommandPorts & {
    lockCalls(): number
    auditRows(): StockAuditEvent[]
    baseStock: StockRepository
    setNow(value: string): void
    replaceAuditRows(rows: StockAuditEvent[]): void
    setStaff(staffId: string, patch: Partial<{ active: boolean; canManageStock: boolean }>): void
  } = {
    clock: { nowIso: () => now },
    locks: {
      withLock<T>(operation: () => T): T {
        lockCalls += 1
        return operation()
      },
    },
    staff: {
      findById(staffId) {
        return staffRows.get(staffId) ?? null
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
    baseStock,
    setNow(value) {
      now = value
    },
    replaceAuditRows(rows) {
      store.replace('STOCK_AUDIT', rows as unknown as Array<Record<string, unknown>>)
    },
    setStaff(staffId, patch) {
      const before = staffRows.get(staffId)
      if (!before) throw new Error('test staff not found')
      staffRows.set(staffId, { ...before, ...patch })
    },
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
    expect(ports.auditRows()).toHaveLength(0)
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
    const journalBase = {
      requestId: command.requestId,
      actorStaffId: command.staffId,
      action: command.commandType,
      safeErrorCode: '',
      targetProductIdsJson: '["STK-000001"]',
      correlationId: `ISS-MISSING|${ports.commandFingerprint(command)}`,
      createdAt: NOW,
    }
    ports.stock.appendAudit({ eventId: 'AUDIT-MISSING-PREPARED', status: 'PREPARED', ...journalBase })
    ports.stock.appendAudit({ eventId: 'AUDIT-MISSING-ACCEPTED', status: 'ACCEPTED', ...journalBase })

    expect(() => executeStockCommand(command, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
  })

  it('appends exactly one accepted audit for every successful command', () => {
    const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
    executeStockCommand(issueCommand('audit-success', 'STK-000001', 1_000), ports)

    expect(ports.auditRows().filter((row) => (
      row.requestId === 'audit-success' && row.status === 'ACCEPTED'
    ))).toEqual([
      expect.objectContaining({
        action: 'ISSUE', status: 'ACCEPTED', correlationId: expect.stringMatching(/^ISS-\d+\|[a-f0-9]{64}$/),
      }),
    ])
  })

  describe('prepared journal crash recovery', () => {
    it.each(['PREPARED', 'LEDGER', 'ACCEPTED'] as const)(
      'recovers ISSUE after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, boundary)
        const command = issueCommand('recover-issue', 'STK-000001', 2_000)

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        const recovered = executeStockCommand(command, ports)

        expect(recovered.lines).toEqual([
          { productId: 'STK-000001', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
        ])
        expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(3_000)
        const documentRows = ports.stock.listLedger().filter((row) => row.requestId === command.requestId)
        expect(documentRows).toHaveLength(1)
        expect(documentRows[0]?.transactionId).toBe(`${recovered.documentId}:TX:1`)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'LEDGER', 'ACCEPTED'] as const)(
      'recovers RECEIVE after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-receive', staffId: 'ADMIN_03', commandType: 'RECEIVE',
          payload: { lines: [{ productId: 'STK-000001', quantityMilli: 2_000 }] },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        executeStockCommand(command, ports)

        expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(7_000)
        expect(ports.stock.listLedger().filter((row) => row.requestId === command.requestId)).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'PRODUCT', 'LEDGER', 'ACCEPTED'] as const)(
      'recovers CREATE_PRODUCT with opening stock after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({}, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-create-opening', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT',
          payload: {
            name: 'ผ้าก๊อซ', category: 'CLINIC_SUPPLY', unit: 'ห่อ',
            openingQuantityMilli: 4_000, minimumQuantityMilli: 1_000,
          },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        const recovered = executeStockCommand(command, ports)

        expect(recovered).toMatchObject({ documentId: 'STK-000001' })
        expect(ports.stock.listProducts()).toHaveLength(1)
        expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(4_000)
        expect(ports.stock.listLedger().filter((row) => row.requestId === command.requestId)).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'PRODUCT', 'ACCEPTED'] as const)(
      'recovers zero-opening CREATE_PRODUCT after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({}, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-create-zero', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT',
          payload: {
            name: 'สำลีแผ่น', category: 'CLINIC_SUPPLY', unit: 'ห่อ',
            openingQuantityMilli: 0, minimumQuantityMilli: 500,
          },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        expect(executeStockCommand(command, ports).lines).toEqual([])

        expect(ports.stock.listProducts()).toHaveLength(1)
        expect(ports.stock.listLedger()).toHaveLength(0)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'LEDGER', 'ACCEPTED'] as const)(
      'recovers nonzero ADJUST after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-adjust-nonzero', staffId: 'ADMIN_03', commandType: 'ADJUST',
          payload: { productId: 'STK-000001', countedQuantityMilli: 3_000, reason: 'ตรวจนับ' },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        executeStockCommand(command, ports)

        expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(3_000)
        expect(ports.stock.listLedger().filter((row) => row.requestId === command.requestId)).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'ACCEPTED'] as const)(
      'recovers zero-delta ADJUST after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-adjust-zero', staffId: 'ADMIN_03', commandType: 'ADJUST',
          payload: { productId: 'STK-000001', countedQuantityMilli: 5_000, reason: 'ยอดตรง' },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        expect(executeStockCommand(command, ports).lines).toEqual([])

        expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
        expect(ports.stock.listLedger().filter((row) => row.requestId === command.requestId)).toHaveLength(0)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each(['PREPARED', 'PRODUCT', 'ACCEPTED'] as const)(
      'recovers UPDATE_PRODUCT after a crash following the %s write',
      (boundary) => {
        const ports = stockPortsWithBalances({ 'STK-000001': 0 }, boundary)
        const command: MiniAppStockCommand = {
          requestId: 'recover-update', staffId: 'ADMIN_03', commandType: 'UPDATE_PRODUCT',
          payload: {
            productId: 'STK-000001', expectedVersion: 1, name: 'ชื่อหลังแก้', category: 'RETAIL_PRODUCT',
            unit: 'ชิ้น', minimumQuantityMilli: 2_000,
          },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        executeStockCommand(command, ports)

        expect(ports.stock.getProduct('STK-000001')).toMatchObject({
          name: 'ชื่อหลังแก้', category: 'RETAIL_PRODUCT', minimumQuantityMilli: 2_000, version: 2,
        })
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      },
    )

    it.each([
      ['DEACTIVATE_PRODUCT', true, false],
      ['REACTIVATE_PRODUCT', false, true],
    ] as const)('recovers %s exactly once across every product write boundary', (commandType, initialActive, wantedActive) => {
      for (const boundary of ['PREPARED', 'PRODUCT', 'ACCEPTED'] as const) {
        const ports = stockPortsWithBalances({ 'STK-000001': 0 }, boundary)
        if (!initialActive) ports.baseStock.updateProduct('STK-000001', 1, { active: false })
        const expectedVersion = initialActive ? 1 : 2
        const command: MiniAppStockCommand = {
          requestId: `recover-${commandType}-${boundary}`,
          staffId: 'ADMIN_03',
          commandType,
          payload: { productId: 'STK-000001', expectedVersion },
        }

        expect(() => executeStockCommand(command, ports)).toThrow(`FAULT_AFTER_${boundary}`)
        executeStockCommand(command, ports)

        expect(ports.stock.getProduct('STK-000001')).toMatchObject({
          active: wantedActive,
          version: expectedVersion + 1,
        })
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'PREPARED')).toHaveLength(1)
        expect(ports.auditRows().filter((row) => row.requestId === command.requestId && row.status === 'ACCEPTED')).toHaveLength(1)
      }
    })

    it('returns the PREPARED timestamp after the retry clock advances', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, 'PREPARED')
      const command = issueCommand('recover-original-time', 'STK-000001', 1_000)
      expect(() => executeStockCommand(command, ports)).toThrow('FAULT_AFTER_PREPARED')
      ports.setNow('2026-08-28T10:00:00+07:00')

      expect(executeStockCommand(command, ports).createdAt).toBe(NOW)
    })

    it('reconciles an exact PREPARED manager command after the actor is deactivated', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, 'PREPARED')
      const command: MiniAppStockCommand = {
        requestId: 'recover-deactivated-manager', staffId: 'ADMIN_03', commandType: 'RECEIVE',
        payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
      }
      expect(() => executeStockCommand(command, ports)).toThrow('FAULT_AFTER_PREPARED')
      ports.setStaff('ADMIN_03', { active: false, canManageStock: false })

      expect(executeStockCommand(command, ports).lines).toEqual([
        { productId: 'STK-000001', quantityDeltaMilli: 1_000, balanceAfterMilli: 6_000 },
      ])
    })

    it('blocks an unrelated command until the unresolved PREPARED request reconciles', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 }, 'PREPARED')
      const interrupted = issueCommand('recover-first', 'STK-000001', 1_000)
      const unrelatedIssue = issueCommand('unrelated-issue', 'STK-000001', 1_000)
      const blockedCommands: MiniAppStockCommand[] = [
        unrelatedIssue,
        {
          requestId: 'unrelated-receive', staffId: 'ADMIN_03', commandType: 'RECEIVE',
          payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
        },
        {
          requestId: 'unrelated-manager', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT',
          payload: {
            name: 'คำสั่งที่ต้องถูกบล็อก', category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
            openingQuantityMilli: 0, minimumQuantityMilli: 0,
          },
        },
      ]
      expect(() => executeStockCommand(interrupted, ports)).toThrow('FAULT_AFTER_PREPARED')

      for (const command of blockedCommands) {
        expect(() => executeStockCommand(command, ports)).toThrow('STOCK_RECOVERY_REQUIRED')
      }
      expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
      expect(ports.stock.listProducts()).toHaveLength(1)
      expect(ports.stock.listLedger()).toHaveLength(1)
      expect(ports.auditRows()).toHaveLength(1)

      executeStockCommand(interrupted, ports)
      executeStockCommand(unrelatedIssue, ports)
      expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(3_000)
    })

    it('fails closed when a pending journal is malformed', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
      ports.replaceAuditRows([{
        eventId: 'AUDIT-MALFORMED', requestId: 'malformed-pending', actorStaffId: 'ADMIN_01',
        action: 'ISSUE', status: 'PREPARED', safeErrorCode: '', targetProductIdsJson: '["STK-000001"]',
        correlationId: 'missing-fingerprint', createdAt: NOW,
      }])

      expect(() => executeStockCommand(
        issueCommand('unrelated-after-malformed', 'STK-000001', 1_000),
        ports,
      )).toThrow('stock audit journal invalid')
      expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
    })

    it.each([
      ['unknown', 'UNKNOWN'],
      ['blank', ''],
      ['non-string', 42],
    ])('blocks issue and manager writes when persisted audit status is %s', (_case, status) => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
      ports.replaceAuditRows([{
        eventId: 'AUDIT-CORRUPT-STATUS', requestId: 'corrupt-status', actorStaffId: 'ADMIN_01',
        action: 'ISSUE', status: status as unknown as StockAuditEvent['status'], safeErrorCode: '',
        targetProductIdsJson: '["STK-000001"]',
        correlationId: `ISS-CORRUPT|${'a'.repeat(64)}`, createdAt: NOW,
      }])
      const productsBefore = ports.stock.listProducts()
      const ledgerBefore = ports.stock.listLedger()
      const auditBefore = ports.auditRows()
      const commands: MiniAppStockCommand[] = [
        issueCommand('blocked-corrupt-issue', 'STK-000001', 1_000),
        {
          requestId: 'blocked-corrupt-manager', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT',
          payload: {
            name: 'ต้องไม่ถูกสร้าง', category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
            openingQuantityMilli: 0, minimumQuantityMilli: 0,
          },
        },
      ]

      for (const command of commands) {
        expect(() => executeStockCommand(command, ports)).toThrow('stock audit journal invalid')
      }
      expect(ports.stock.listProducts()).toEqual(productsBefore)
      expect(ports.stock.listLedger()).toEqual(ledgerBefore)
      expect(ports.auditRows()).toEqual(auditBefore)
    })

    it('fails closed when multiple requests are pending recovery', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
      const pending = (requestId: string, documentId: string, fingerprint: string): StockAuditEvent => ({
        eventId: `AUDIT-${requestId}`, requestId, actorStaffId: 'ADMIN_01', action: 'ISSUE',
        status: 'PREPARED', safeErrorCode: '', targetProductIdsJson: '["STK-000001"]',
        correlationId: `${documentId}|${fingerprint}`, createdAt: NOW,
      })
      ports.replaceAuditRows([
        pending('pending-one', 'ISS-PENDING-1', 'a'.repeat(64)),
        pending('pending-two', 'ISS-PENDING-2', 'b'.repeat(64)),
      ])

      expect(() => executeStockCommand(
        issueCommand('unrelated-after-multiple', 'STK-000001', 1_000),
        ports,
      )).toThrow('stock multiple unresolved prepared audits')
      expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(5_000)
    })

    it.each<[string, MiniAppStockCommand]>([
      [
        'payload fingerprint',
        issueCommand('prepared-conflict', 'STK-000001', 2_000),
      ],
      [
        'actor',
        { ...issueCommand('prepared-conflict', 'STK-000001', 1_000), staffId: 'ADMIN_03' },
      ],
      [
        'target IDs',
        issueCommand('prepared-conflict', 'STK-000002', 1_000),
      ],
      [
        'action',
        {
          requestId: 'prepared-conflict', staffId: 'ADMIN_01', commandType: 'RECEIVE',
          payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
        },
      ],
    ])('rejects PREPARED retry with changed %s', (_case, changed) => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000, 'STK-000002': 5_000 }, 'PREPARED')
      expect(() => executeStockCommand(
        issueCommand('prepared-conflict', 'STK-000001', 1_000),
        ports,
      )).toThrow('FAULT_AFTER_PREPARED')

      expect(() => executeStockCommand(changed, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
    })

    it('rejects an orphan ledger document before writing PREPARED', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
      ports.baseStock.appendLedgerBatch([{
        transactionId: 'ISS-ORPHAN:TX:1', documentId: 'ISS-ORPHAN', requestId: 'orphan-ledger', lineNumber: 1,
        productId: 'STK-000001', transactionType: 'ISSUE', quantityDeltaMilli: -1_000,
        balanceBeforeMilli: 5_000, balanceAfterMilli: 4_000, actorStaffId: 'ADMIN_01',
        actorDisplayName: 'พนักงาน', reason: '', idempotencyKey: 'orphan-ledger:1', createdAt: NOW,
      }])

      expect(() => executeStockCommand(
        issueCommand('orphan-ledger', 'STK-000001', 1_000),
        ports,
      )).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
      expect(ports.auditRows().filter((row) => row.requestId === 'orphan-ledger')).toHaveLength(0)
    })

    it('rejects an allocated product ID collision before writing PREPARED', () => {
      const ports = stockPortsWithBalances({ 'STK-000001': 0 })

      expect(() => executeStockCommand({
        requestId: 'create-id-collision', staffId: 'ADMIN_03', commandType: 'CREATE_PRODUCT',
        payload: {
          name: 'ชื่อไม่ซ้ำ', category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
          openingQuantityMilli: 0, minimumQuantityMilli: 0,
        },
      }, ports)).toThrow('STOCK_IDEMPOTENCY_CONFLICT')
      expect(ports.auditRows().filter((row) => row.requestId === 'create-id-collision')).toHaveLength(0)
    })
  })
})
