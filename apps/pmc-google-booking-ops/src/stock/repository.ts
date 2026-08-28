import {
  aggregateStockBalances,
  type StockAuditEvent,
  type StockDocumentSummary,
  type StockLedgerEntry,
  type StockProduct,
} from '../../../../shared/pmcStock'
import type { StockRepository } from '../ports'
import type { SheetRow, SheetStore } from '../repositories'

const STOCK_PRODUCT_HEADERS = [
  'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
  'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
] as const satisfies readonly (keyof StockProduct)[]

const STOCK_LEDGER_HEADERS = [
  'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
  'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
  'reason', 'idempotencyKey', 'createdAt',
] as const satisfies readonly (keyof StockLedgerEntry)[]

const STOCK_AUDIT_HEADERS = [
  'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
  'targetProductIdsJson', 'correlationId', 'createdAt',
] as const satisfies readonly (keyof StockAuditEvent)[]

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toSheetRow<T extends object>(value: T, headers: readonly (keyof T)[]): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, value[header]]))
}

function asProduct(row: SheetRow): StockProduct {
  return clonePlain(row as unknown as StockProduct)
}

function asLedgerEntry(row: SheetRow): StockLedgerEntry {
  return clonePlain(row as unknown as StockLedgerEntry)
}

function validateLedgerBatch(existing: StockLedgerEntry[], entries: StockLedgerEntry[]): void {
  const transactionIds = new Set(existing.map((entry) => entry.transactionId))
  const documentsByRequest = new Map<string, string>()
  const balances = aggregateStockBalances(existing)

  for (const entry of existing) documentsByRequest.set(entry.requestId, entry.documentId)

  for (const entry of entries) {
    if (transactionIds.has(entry.transactionId)) throw new Error('stock transaction already exists')
    transactionIds.add(entry.transactionId)

    const existingDocumentId = documentsByRequest.get(entry.requestId)
    if (existingDocumentId && existingDocumentId !== entry.documentId) {
      throw new Error('stock request conflicts with document')
    }
    documentsByRequest.set(entry.requestId, entry.documentId)

    const balanceBeforeMilli = balances.get(entry.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli + entry.quantityDeltaMilli
    if (
      !Number.isSafeInteger(balanceAfterMilli) ||
      entry.balanceBeforeMilli !== balanceBeforeMilli ||
      entry.balanceAfterMilli !== balanceAfterMilli
    ) {
      throw new Error('stock balance chain mismatch')
    }
    balances.set(entry.productId, balanceAfterMilli)
  }
}

export function createStockRepository(store: SheetStore): StockRepository {
  return {
    listProducts(): StockProduct[] {
      return store.read('STOCK_PRODUCTS').map(asProduct)
    },
    getProduct(productId: string): StockProduct | null {
      const row = store.read('STOCK_PRODUCTS').find((candidate) => candidate.productId === productId)
      return row ? asProduct(row) : null
    },
    insertProduct(product: StockProduct): StockProduct {
      const rows = store.read('STOCK_PRODUCTS')
      if (rows.some((row) => row.productId === product.productId)) throw new Error('stock product already exists')
      store.replace('STOCK_PRODUCTS', [...rows, toSheetRow(product, STOCK_PRODUCT_HEADERS)])
      return clonePlain(product)
    },
    updateProduct(productId: string, expectedVersion: number, patch: Partial<StockProduct>): StockProduct {
      const rows = store.read('STOCK_PRODUCTS')
      const index = rows.findIndex((row) => row.productId === productId)
      if (index === -1) throw new Error('stock product not found')
      const before = asProduct(rows[index])
      if (before.version !== expectedVersion) throw new Error('version conflict')
      const after: StockProduct = {
        ...before,
        ...patch,
        productId: before.productId,
        version: before.version + 1,
      }
      const updated = [...rows]
      updated[index] = toSheetRow(after, STOCK_PRODUCT_HEADERS)
      store.replace('STOCK_PRODUCTS', updated)
      return clonePlain(after)
    },
    listLedger(): StockLedgerEntry[] {
      return store.read('STOCK_LEDGER').map(asLedgerEntry)
    },
    appendLedgerBatch(entries: StockLedgerEntry[]): void {
      if (entries.length === 0) return
      const rows = store.read('STOCK_LEDGER')
      const existing = rows.map(asLedgerEntry)
      validateLedgerBatch(existing, entries)
      store.replace('STOCK_LEDGER', [...rows, ...entries.map((entry) => toSheetRow(entry, STOCK_LEDGER_HEADERS))])
    },
    balanceByProduct(): Map<string, number> {
      return aggregateStockBalances(store.read('STOCK_LEDGER').map(asLedgerEntry))
    },
    findDocumentByRequestId(requestId: string): StockDocumentSummary | null {
      const entries = store
        .read('STOCK_LEDGER')
        .map(asLedgerEntry)
        .filter((entry) => entry.requestId === requestId)
        .sort((left, right) => left.lineNumber - right.lineNumber)
      if (entries.length === 0) return null

      const first = entries[0]
      const products = new Map(this.listProducts().map((product) => [product.productId, product]))
      return {
        documentId: first.documentId,
        requestId: first.requestId,
        transactionType: first.transactionType,
        actorStaffId: first.actorStaffId,
        actorDisplayName: first.actorDisplayName,
        createdAt: first.createdAt,
        reason: first.reason,
        lineCount: entries.length,
        lines: entries.map((entry) => {
          const product = products.get(entry.productId)
          return {
            productId: entry.productId,
            productName: product?.name ?? '',
            unit: product?.unit ?? '',
            quantityDeltaMilli: entry.quantityDeltaMilli,
            balanceBeforeMilli: entry.balanceBeforeMilli,
            balanceAfterMilli: entry.balanceAfterMilli,
          }
        }),
      }
    },
    appendAudit(event: StockAuditEvent): void {
      const rows = store.read('STOCK_AUDIT')
      store.replace('STOCK_AUDIT', [...rows, toSheetRow(clonePlain(event), STOCK_AUDIT_HEADERS)])
    },
  }
}
