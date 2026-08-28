import { formatQuantityMilli } from '../../../../shared/pmcStock'
import type { StockProductProjection } from '../contracts'

export type StockFilter = 'ALL' | 'CLINIC' | 'RETAIL' | 'LOW'

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
