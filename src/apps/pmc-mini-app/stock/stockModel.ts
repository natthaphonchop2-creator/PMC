import {
  formatQuantityMilli,
  parseNonNegativeQuantityToMilli,
  parseQuantityToMilli,
  type StockClientCommand,
} from '../../../../shared/pmcStock'
import type { StockProductProjection } from '../contracts'

export type StockFilter = 'ALL' | 'CLINIC' | 'RETAIL' | 'LOW'

export interface StockLineDraft {
  lineId: string
  productId: string
  quantity: string
}

export interface StockIssueState {
  requestId: string
  products: StockProductProjection[]
  lines: StockLineDraft[]
}

export type StockIssueCommand = Extract<StockClientCommand, { commandType: 'RECEIVE' | 'ISSUE' }> & {
  commandType: 'ISSUE'
}

export function issueLines(state: StockIssueState): Array<{ productId: string; quantityMilli: number }> {
  if (state.lines.length === 0) throw new Error('STOCK_EMPTY_LINES')
  const seen = new Set<string>()
  return state.lines.map((line) => {
    if (seen.has(line.productId)) throw new Error('STOCK_DUPLICATE_LINE')
    seen.add(line.productId)
    const quantityMilli = parseQuantityToMilli(line.quantity)
    const product = state.products.find((item) => item.productId === line.productId && item.active)
    if (!product) throw new Error('STOCK_PRODUCT_INACTIVE')
    if (quantityMilli > product.onHandMilli) throw new Error(`STOCK_INSUFFICIENT_BALANCE:${line.productId}`)
    return { productId: line.productId, quantityMilli }
  })
}

export function createIssueCommand(state: StockIssueState): StockIssueCommand {
  return { requestId: state.requestId, commandType: 'ISSUE', payload: { lines: issueLines(state) } }
}

export function filterStockProducts(
  products: StockProductProjection[],
  query: string,
  filter: StockFilter,
): StockProductProjection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  return products.filter((product) => {
    if (!product.active) return false
    if (normalizedQuery && !`${product.name} ${product.productId} ${product.unit}`.toLocaleLowerCase('th').includes(normalizedQuery)) {
      return false
    }
    if (filter === 'CLINIC') return product.category === 'CLINIC_SUPPLY'
    if (filter === 'RETAIL') return product.category === 'RETAIL_PRODUCT'
    if (filter === 'LOW') return product.lowStock
    return true
  })
}

export function formatStockQuantity(product: Pick<StockProductProjection, 'onHandMilli' | 'unit'>): string {
  return `${formatQuantityMilli(product.onHandMilli)} ${product.unit}`
}

export function stockCategoryLabel(category: StockProductProjection['category']): string {
  return category === 'CLINIC_SUPPLY' ? 'ของใช้คลินิก' : 'สินค้าขาย'
}

export function createAdjustmentCommand(input: {
  requestId: string
  product: StockProductProjection
  countedQuantity: string
  reason: string
}): StockClientCommand {
  const countedQuantityMilli = parseNonNegativeQuantityToMilli(input.countedQuantity)
  const reason = input.reason.trim()
  if (!reason || reason.length > 300) throw new Error('STOCK_ADJUST_REASON_REQUIRED')
  return {
    requestId: input.requestId,
    commandType: 'ADJUST',
    payload: { productId: input.product.productId, countedQuantityMilli, reason },
  }
}

export function canEditProductUnit(product: StockProductProjection): boolean {
  return !product.hasLedgerActivity
}
