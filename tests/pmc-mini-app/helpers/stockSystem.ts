import { createHash } from 'node:crypto'
import type {
  MiniAppStockCommand,
  StockCommandResult,
  StockProduct,
} from '../../../shared/pmcStock'
import type { MiniAppSheetsPort } from '../../../server/pmc-mini-app/googleClient'
import { createStockReadStore } from '../../../server/pmc-mini-app/stock/readStore'
import {
  STOCK_AUDIT_HEADERS,
  STOCK_LEDGER_HEADERS,
  STOCK_PRODUCT_HEADERS,
} from '../../../server/pmc-mini-app/setup'
import { createStockRepository, type SheetStore } from '../../../apps/pmc-google-booking-ops/src/repositories'
import { executeStockCommand, type StockCommandPorts } from '../../../apps/pmc-google-booking-ops/src/stock/commands'
import { createMemorySheetStore } from '../../../apps/pmc-google-booking-ops/tests/helpers/fakes'

export interface StockTestSystem {
  createProduct(input: { openingQuantityMilli: number; minimumQuantityMilli: number }): Promise<StockProduct>
  receive(lines: Array<{ productId: string; quantityMilli: number }>): Promise<StockCommandResult>
  issue(lines: Array<{ productId: string; quantityMilli: number }>): Promise<StockCommandResult>
  adjust(input: { productId: string; countedQuantityMilli: number; reason: string }): Promise<StockCommandResult>
  balance(productId: string): Promise<number>
  ledgerDeltas(productId: string): number[]
}

export function createStockTestSystem(): StockTestSystem {
  const ports = createStockCommandTestPorts()
  let sequence = 0
  const requestId = (prefix: string) => `${prefix}-${++sequence}`

  return {
    async createProduct(input) {
      const result = executeStockCommand({
        requestId: requestId('create'),
        staffId: 'shared-account-test',
        commandType: 'CREATE_PRODUCT',
        payload: {
          name: `สินค้าทดสอบ ${sequence}`,
          category: 'CLINIC_SUPPLY',
          unit: 'ชิ้น',
          openingQuantityMilli: input.openingQuantityMilli,
          minimumQuantityMilli: input.minimumQuantityMilli,
        },
      }, ports)
      return ports.stock.getProduct(result.lines[0]!.productId)!
    },
    async receive(lines) {
      return executeStockCommand({
        requestId: requestId('receive'),
        staffId: 'shared-account-test',
        commandType: 'RECEIVE',
        payload: { lines },
      }, ports)
    },
    async issue(lines) {
      return executeStockCommand({
        requestId: requestId('issue'),
        staffId: 'ADMIN_01',
        commandType: 'ISSUE',
        payload: { lines },
      }, ports)
    },
    async adjust(input) {
      return executeStockCommand({
        requestId: requestId('adjust'),
        staffId: 'ADMIN_07',
        commandType: 'ADJUST',
        payload: input,
      }, ports)
    },
    async balance(productId) {
      const product = (await ports.readStore.listProducts()).find((candidate) => candidate.productId === productId)
      return product?.onHandMilli ?? 0
    },
    ledgerDeltas(productId) {
      return ports.stock.listLedger()
        .filter((row) => row.productId === productId)
        .map((row) => row.quantityDeltaMilli)
    },
  }
}

function createStockCommandTestPorts(): StockCommandPorts & {
  readStore: ReturnType<typeof createStockReadStore>
} {
  const store = createMemorySheetStore()
  const stock = createStockRepository(store)
  const sequences = new Map<string, number>()
  const actors = new Map([
    ['shared-account-test', { id: 'shared-account-test', name: 'owner/Admin', active: true, canManageStock: true }],
    ['ADMIN_01', { id: 'ADMIN_01', name: 'พนักงาน', active: true, canManageStock: false }],
    ['ADMIN_07', { id: 'ADMIN_07', name: 'อาย', active: true, canManageStock: true }],
    ['ADMIN_03', { id: 'ADMIN_03', name: 'หมวย', active: true, canManageStock: true }],
  ])

  return {
    clock: { nowIso: () => '2026-08-28T10:00:00+07:00' },
    locks: { withLock: (operation) => operation() },
    staff: { findById: (staffId) => actors.get(staffId) ?? null },
    stock,
    commandFingerprint(command: MiniAppStockCommand) {
      return createHash('sha256').update(JSON.stringify(command)).digest('hex')
    },
    allocateId(prefix) {
      const next = (sequences.get(prefix) ?? 0) + 1
      sequences.set(prefix, next)
      return `${prefix}-${String(next).padStart(6, '0')}`
    },
    readStore: createStockReadStore({
      spreadsheetId: 'stock-system-test',
      sheets: new MemoryStockSheetsTransport(store),
    }),
  }
}

const HEADERS_BY_TAB = {
  STOCK_PRODUCTS: STOCK_PRODUCT_HEADERS,
  STOCK_LEDGER: STOCK_LEDGER_HEADERS,
  STOCK_AUDIT: STOCK_AUDIT_HEADERS,
} as const

class MemoryStockSheetsTransport implements MiniAppSheetsPort {
  constructor(private readonly store: SheetStore) {}

  async batchGet(spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    if (spreadsheetId !== 'stock-system-test') throw new Error('unexpected spreadsheet')
    return Object.fromEntries(ranges.map((range) => {
      const tab = stockTab(range)
      const headers = HEADERS_BY_TAB[tab]
      const rows = this.store.read(tab)
      return [range, [[...headers], ...rows.map((row) => headers.map((header) => row[header]))]]
    }))
  }

  async append(): Promise<void> { throw new Error('read-only transport') }
  async update(): Promise<void> { throw new Error('read-only transport') }
  async batchUpdate(): Promise<void> { throw new Error('read-only transport') }
  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { throw new Error('read-only transport') }
  async applyWorkbookRequests(): Promise<void> { throw new Error('read-only transport') }
}

function stockTab(range: string): keyof typeof HEADERS_BY_TAB {
  const match = range.match(/^'([^']+)'!/)
  const tab = match?.[1]
  if (tab === 'STOCK_PRODUCTS' || tab === 'STOCK_LEDGER' || tab === 'STOCK_AUDIT') return tab
  throw new Error(`unexpected Stock range: ${range}`)
}
