import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  createStockReadStore,
  StockReadStoreError,
} from '../../server/pmc-mini-app/stock/readStore'
import {
  STOCK_AUDIT_HEADERS,
  STOCK_LEDGER_HEADERS,
  STOCK_PRODUCT_HEADERS,
} from '../../server/pmc-mini-app/setup'

const PRODUCT_RANGE = "'STOCK_PRODUCTS'!A:L"
const LEDGER_RANGE = "'STOCK_LEDGER'!A:N"
const AUDIT_RANGE = "'STOCK_AUDIT'!A:I"

describe('PMC Stock Cloud Run read store', () => {
  it('returns current balances, low-stock state, and ledger-activity state', async () => {
    const sheets = stockSheets({
      products: [productRow({ minimumQuantityMilli: '5000' })],
      ledger: [ledgerRow({ quantityDeltaMilli: '4000', balanceAfterMilli: '4000' })],
    })

    await expect(createStore(sheets).listProducts()).resolves.toEqual([{
      productId: 'STK-000001',
      name: 'ถุงมือ',
      category: 'CLINIC_SUPPLY',
      unit: 'กล่อง',
      minimumQuantityMilli: 5_000,
      onHandMilli: 4_000,
      lowStock: true,
      active: true,
      hasLedgerActivity: true,
      version: 1,
    }])
    expect(sheets.requests).toEqual([[PRODUCT_RANGE, LEDGER_RANGE, AUDIT_RANGE]])
  })

  it('returns newest documents with an opaque cursor and exact line details', async () => {
    const sheets = stockSheets({
      products: [
        productRow(),
        productRow({ productId: 'STK-000002', name: 'เข็ม', normalizedName: 'เข็ม', unit: 'ชิ้น' }),
      ],
      ledger: [
        ledgerRow(),
        ledgerRow({
          transactionId: 'RCV-000002:TX:1', documentId: 'RCV-000002', requestId: 'receive-1',
          productId: 'STK-000002', transactionType: 'RECEIVE', quantityDeltaMilli: 2_000,
          balanceAfterMilli: 2_000, idempotencyKey: 'receive-1:1', createdAt: '2026-08-28T11:00:00.000Z',
        }),
      ],
    })
    const store = createStore(sheets)

    const first = await store.listHistory(null, 1)

    expect(first.documents).toEqual([expect.objectContaining({
      documentId: 'RCV-000002',
      requestId: 'receive-1',
      transactionType: 'RECEIVE',
      lineCount: 1,
      lines: [{
        productId: 'STK-000002', productName: 'เข็ม', unit: 'ชิ้น', quantityDeltaMilli: 2_000,
        balanceBeforeMilli: 0, balanceAfterMilli: 2_000,
      }],
    })])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).not.toContain('RCV-000002')

    const second = await store.listHistory(first.nextCursor, 1)
    expect(second).toMatchObject({
      documents: [{ documentId: 'RCV-000001' }],
      nextCursor: null,
    })
    await expect(store.getDocument('RCV-000001')).resolves.toEqual(expect.objectContaining({
      documentId: 'RCV-000001',
      actorDisplayName: 'มัส',
      lineCount: 1,
    }))
    await expect(store.getDocument('ISS-missing')).resolves.toBeNull()
  })

  it('rejects malformed and stale history cursors without exposing cursor contents', async () => {
    const store = createStore(stockSheets({ products: [productRow()], ledger: [
      ledgerRow(),
      ledgerRow({ transactionId: 'RCV-000002:TX:1', documentId: 'RCV-000002', requestId: 'receive-1',
        quantityDeltaMilli: 1_000, balanceBeforeMilli: 4_000, balanceAfterMilli: 5_000,
        idempotencyKey: 'receive-1:1', createdAt: '2026-08-28T11:00:00.000Z' }),
    ] }))

    await expect(store.listHistory('not-a-stock-cursor', 25)).rejects.toMatchObject({
      code: 'STOCK_INVALID_CURSOR',
    })
    const page = await store.listHistory(null, 1)
    const changed = createStore(stockSheets({ products: [productRow()] }))
    await expect(changed.listHistory(page.nextCursor, 1)).rejects.toMatchObject({
      code: 'STOCK_INVALID_CURSOR',
    })
  })

  it.each([
    ['incompatible header', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][0]![0] = 'changedProductId' }],
    ['unknown category', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][1]![3] = 'UNKNOWN' }],
    ['wrong product field type', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][1]![1] = { private: true } }],
    ['non-ISO timestamp', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][1]![7] = '123' }],
    ['unsafe milli integer', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][1]![5] = '9007199254740992' }],
    ['malformed product ID', (tabs: StockTabs) => { tabs[PRODUCT_RANGE][1]![0] = 'not safe/id' }],
    ['duplicate product ID', (tabs: StockTabs) => { tabs[PRODUCT_RANGE].push([...tabs[PRODUCT_RANGE][1]!]) }],
    ['unknown transaction type', (tabs: StockTabs) => { tabs[LEDGER_RANGE][1]![5] = 'DELETE' }],
    ['duplicate transaction ID', (tabs: StockTabs) => { tabs[LEDGER_RANGE].push([...tabs[LEDGER_RANGE][1]!]) }],
    ['duplicate idempotency key', (tabs: StockTabs) => {
      tabs[PRODUCT_RANGE].push(productRow({ productId: 'STK-000002', name: 'เข็ม', normalizedName: 'เข็ม' }))
      tabs[LEDGER_RANGE].push(ledgerRow({ transactionId: 'RCV-000001:TX:2', lineNumber: 2,
        productId: 'STK-000002', quantityDeltaMilli: 1_000, balanceBeforeMilli: 0, balanceAfterMilli: 1_000 }))
    }],
    ['request mapped to two documents', (tabs: StockTabs) => {
      tabs[LEDGER_RANGE].push(ledgerRow({ transactionId: 'RCV-OTHER:TX:2', documentId: 'RCV-OTHER', lineNumber: 2,
        quantityDeltaMilli: 500, balanceBeforeMilli: 4_000, balanceAfterMilli: 4_500, idempotencyKey: 'receive-0:2' }))
    }],
    ['document mapped to two requests', (tabs: StockTabs) => {
      tabs[LEDGER_RANGE].push(ledgerRow({ transactionId: 'RCV-000001:TX:2', requestId: 'receive-other', lineNumber: 2,
        quantityDeltaMilli: 500, balanceBeforeMilli: 4_000, balanceAfterMilli: 4_500, idempotencyKey: 'receive-other:2' }))
    }],
    ['broken balance chain', (tabs: StockTabs) => { tabs[LEDGER_RANGE][1]![7] = 1_000 }],
    ['derived negative balance', (tabs: StockTabs) => {
      tabs[LEDGER_RANGE][1]![6] = -1
      tabs[LEDGER_RANGE][1]![8] = -1
    }],
  ])('fails closed on %s', async (_name, corrupt) => {
    const tabs = validTabs()
    corrupt(tabs)

    await expect(createStore(new MemoryStockSheets(tabs)).listProducts()).rejects.toEqual(
      expect.objectContaining({ code: 'STOCK_DATA_INTEGRITY_ERROR' }),
    )
  })

  it.each([
    ['unknown audit status', (tabs: StockTabs) => { tabs[AUDIT_RANGE][1]![4] = 'UNKNOWN' }],
    ['duplicate audit event ID', (tabs: StockTabs) => { tabs[AUDIT_RANGE].push([...tabs[AUDIT_RANGE][1]!]) }],
    ['accepted journal without prepared', (tabs: StockTabs) => { tabs[AUDIT_RANGE].splice(1, 1) }],
    ['prepared and accepted mismatch', (tabs: StockTabs) => { tabs[AUDIT_RANGE][2]![7] = `ISS-other|${'b'.repeat(64)}` }],
    ['multiple unresolved prepared journals', (tabs: StockTabs) => {
      tabs[AUDIT_RANGE].splice(2, 1)
      tabs[AUDIT_RANGE].push(auditRow({
        eventId: 'AUDIT:pending:P', requestId: 'pending-2', correlationId: `ISS-pending|${'c'.repeat(64)}`,
      }))
    }],
  ])('rejects %s as a data-integrity failure', async (_name, corrupt) => {
    const tabs = validTabs({ audit: true })
    corrupt(tabs)

    await expect(createStore(new MemoryStockSheets(tabs)).listHistory(null, 25)).rejects.toBeInstanceOf(
      StockReadStoreError,
    )
    await expect(createStore(new MemoryStockSheets(tabs)).listHistory(null, 25)).rejects.toMatchObject({
      code: 'STOCK_DATA_INTEGRITY_ERROR',
    })
  })

  it('maps Google read failures to one safe storage code', async () => {
    const sheets = stockSheets()
    sheets.failure = new Error('private spreadsheet sheet-1 range STOCK_PRODUCTS')

    await expect(createStore(sheets).listProducts()).rejects.toEqual(expect.objectContaining({
      code: 'STOCK_STORAGE_UNAVAILABLE',
      message: 'Stock read failed: STOCK_STORAGE_UNAVAILABLE',
    }))
  })
})

function createStore(sheets: MiniAppSheetsPort) {
  return createStockReadStore({ spreadsheetId: 'sheet-1', sheets })
}

type StockTabs = Record<typeof PRODUCT_RANGE | typeof LEDGER_RANGE | typeof AUDIT_RANGE, unknown[][]>

function validTabs(options: { audit?: boolean } = {}): StockTabs {
  return {
    [PRODUCT_RANGE]: [[...STOCK_PRODUCT_HEADERS], productRow()],
    [LEDGER_RANGE]: [[...STOCK_LEDGER_HEADERS], ledgerRow()],
    [AUDIT_RANGE]: options.audit
      ? [[...STOCK_AUDIT_HEADERS], auditRow(), auditRow({ eventId: 'AUDIT:issue:A', status: 'ACCEPTED' })]
      : [[...STOCK_AUDIT_HEADERS]],
  }
}

function stockSheets(input: { products?: unknown[][]; ledger?: unknown[][]; audit?: unknown[][] } = {}) {
  return new MemoryStockSheets({
    [PRODUCT_RANGE]: [[...STOCK_PRODUCT_HEADERS], ...(input.products ?? [])],
    [LEDGER_RANGE]: [[...STOCK_LEDGER_HEADERS], ...(input.ledger ?? [])],
    [AUDIT_RANGE]: [[...STOCK_AUDIT_HEADERS], ...(input.audit ?? [])],
  })
}

function productRow(patch: Record<string, unknown> = {}): unknown[] {
  const value = {
    productId: 'STK-000001', name: 'ถุงมือ', normalizedName: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
    minimumQuantityMilli: 5_000, active: true, createdAt: '2026-08-28T09:00:00.000Z',
    createdByStaffId: 'ADMIN_07', updatedAt: '2026-08-28T09:00:00.000Z', updatedByStaffId: 'ADMIN_07', version: 1,
    ...patch,
  }
  return STOCK_PRODUCT_HEADERS.map((key) => value[key])
}

function ledgerRow(patch: Record<string, unknown> = {}): unknown[] {
  const value = {
    transactionId: 'RCV-000001:TX:1', documentId: 'RCV-000001', requestId: 'receive-0', lineNumber: 1,
    productId: 'STK-000001', transactionType: 'RECEIVE', quantityDeltaMilli: 4_000,
    balanceBeforeMilli: 0, balanceAfterMilli: 4_000, actorStaffId: 'ADMIN_01', actorDisplayName: 'มัส', reason: '',
    idempotencyKey: 'receive-0:1', createdAt: '2026-08-28T10:00:00.000Z',
    ...patch,
  }
  return STOCK_LEDGER_HEADERS.map((key) => value[key])
}

function auditRow(patch: Record<string, unknown> = {}): unknown[] {
  const value = {
    eventId: 'AUDIT:receive:P', requestId: 'receive-0', actorStaffId: 'ADMIN_01', action: 'RECEIVE', status: 'PREPARED',
    safeErrorCode: '', targetProductIdsJson: '["STK-000001"]', correlationId: `RCV-000001|${'a'.repeat(64)}`,
    createdAt: '2026-08-28T10:00:00.000Z',
    ...patch,
  }
  return STOCK_AUDIT_HEADERS.map((key) => value[key])
}

class MemoryStockSheets implements MiniAppSheetsPort {
  readonly requests: string[][] = []
  failure: Error | null = null

  constructor(private readonly tabs: StockTabs) {}

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    this.requests.push([...ranges])
    if (this.failure) throw this.failure
    return Object.fromEntries(ranges.map((range) => [range, structuredClone(this.tabs[range as keyof StockTabs] ?? [])]))
  }

  async append(): Promise<void> { throw new Error('not implemented') }
  async update(): Promise<void> { throw new Error('not implemented') }
  async batchUpdate(): Promise<void> { throw new Error('not implemented') }
  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { throw new Error('not implemented') }
  async applyWorkbookRequests(): Promise<void> { throw new Error('not implemented') }
}
