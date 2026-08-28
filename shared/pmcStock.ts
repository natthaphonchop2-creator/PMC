export const STOCK_QUANTITY_SCALE = 1000

export type StockCategory = 'CLINIC_SUPPLY' | 'RETAIL_PRODUCT'
export type StockTransactionType = 'OPENING' | 'RECEIVE' | 'ISSUE' | 'ADJUST'

export interface StockProduct {
  productId: string
  name: string
  normalizedName: string
  category: StockCategory
  unit: string
  minimumQuantityMilli: number
  active: boolean
  createdAt: string
  createdByStaffId: string
  updatedAt: string
  updatedByStaffId: string
  version: number
}

export interface StockLedgerEntry {
  transactionId: string
  documentId: string
  requestId: string
  lineNumber: number
  productId: string
  transactionType: StockTransactionType
  quantityDeltaMilli: number
  balanceBeforeMilli: number
  balanceAfterMilli: number
  actorStaffId: string
  actorDisplayName: string
  reason: string
  idempotencyKey: string
  createdAt: string
}

export interface StockAuditEvent {
  eventId: string
  requestId: string
  actorStaffId: string
  action: string
  status: 'PREPARED' | 'ACCEPTED' | 'REJECTED' | 'RECOVERED'
  safeErrorCode: string
  targetProductIdsJson: string
  correlationId: string
  createdAt: string
}

export interface StockDocumentSummary {
  documentId: string
  requestId: string
  transactionType: StockTransactionType
  actorStaffId: string
  actorDisplayName: string
  createdAt: string
  reason: string
  lineCount: number
  lines: Array<{
    productId: string
    productName: string
    unit: string
    quantityDeltaMilli: number
    balanceBeforeMilli: number
    balanceAfterMilli: number
  }>
}

export interface StockHistoryPage {
  documents: StockDocumentSummary[]
  nextCursor: string | null
}

export type MiniAppStockCommand =
  | { requestId: string; staffId: string; commandType: 'CREATE_PRODUCT'; payload: {
      name: string; category: StockCategory; unit: string; openingQuantityMilli: number; minimumQuantityMilli: number
    } }
  | { requestId: string; staffId: string; commandType: 'RECEIVE' | 'ISSUE'; payload: {
      lines: Array<{ productId: string; quantityMilli: number }>
    } }
  | { requestId: string; staffId: string; commandType: 'ADJUST'; payload: {
      productId: string; countedQuantityMilli: number; reason: string
    } }
  | { requestId: string; staffId: string; commandType: 'UPDATE_PRODUCT'; payload: {
      productId: string; expectedVersion: number; name: string; category: StockCategory;
      unit: string; minimumQuantityMilli: number
    } }
  | { requestId: string; staffId: string; commandType: 'DEACTIVATE_PRODUCT' | 'REACTIVATE_PRODUCT'; payload: {
      productId: string; expectedVersion: number
    } }

type WithoutStaff<T> = T extends { staffId: string } ? Omit<T, 'staffId'> : never
export type StockClientCommand = WithoutStaff<MiniAppStockCommand>

export interface StockCommandResult {
  requestId: string
  documentId: string
  commandType: MiniAppStockCommand['commandType']
  createdAt: string
  lines: Array<{ productId: string; quantityDeltaMilli: number; balanceAfterMilli: number }>
}

export function parseNonNegativeQuantityToMilli(value: string): number {
  const normalized = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(normalized)) throw new Error('STOCK_INVALID_QUANTITY')
  const [whole, fraction = ''] = normalized.split('.')
  const result = Number(whole) * STOCK_QUANTITY_SCALE + Number(fraction.padEnd(3, '0'))
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('STOCK_INVALID_QUANTITY')
  return result
}

export function parseQuantityToMilli(value: string): number {
  const result = parseNonNegativeQuantityToMilli(value)
  if (result === 0) throw new Error('STOCK_INVALID_QUANTITY')
  return result
}

export function formatQuantityMilli(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('STOCK_INVALID_QUANTITY')
  return (value / STOCK_QUANTITY_SCALE).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export function aggregateStockBalances(
  entries: Array<Pick<StockLedgerEntry, 'productId' | 'quantityDeltaMilli'>>,
): Map<string, number> {
  const balances = new Map<string, number>()
  for (const entry of entries) {
    const next = (balances.get(entry.productId) ?? 0) + entry.quantityDeltaMilli
    if (!Number.isSafeInteger(next)) throw new Error('STOCK_BALANCE_OVERFLOW')
    balances.set(entry.productId, next)
  }
  return balances
}
