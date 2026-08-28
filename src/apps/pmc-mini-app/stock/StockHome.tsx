import { useMemo, useState } from 'react'
import { Boxes, ClipboardClock, PackageCheck, PackageMinus, Search, Settings2 } from 'lucide-react'
import type { StockProductProjection } from '../contracts'
import { filterStockProducts, formatStockQuantity, stockCategoryLabel, type StockFilter } from './stockModel'

export type StockManagerAction = 'RECEIVE' | 'MANAGE'

const FILTERS: Array<{ value: StockFilter; label: string }> = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'CLINIC', label: 'ของใช้คลินิก' },
  { value: 'RETAIL', label: 'สินค้าขาย' },
  { value: 'LOW', label: 'ใกล้หมด' },
]

export function StockHome({ products, canManageStock, onIssue, onManagerAction, onHistory }: {
  products: StockProductProjection[]
  canManageStock: boolean
  onIssue: () => void
  onManagerAction: (action: StockManagerAction) => void
  onHistory: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StockFilter>('ALL')
  const visibleProducts = useMemo(() => filterStockProducts(products, query, filter), [filter, products, query])

  return <main className="pmc-stock-page">
    <header className="pmc-stock-header">
      <p lang="en">PMC INVENTORY</p>
      <h1>Stock</h1>
      <span>ตรวจยอด เบิกสินค้า และดูประวัติในที่เดียว</span>
    </header>

    <section className="pmc-stock-actions" aria-label="งานสต็อก">
      <button type="button" onClick={onIssue}><PackageMinus aria-hidden="true" /><span>เบิกสินค้า</span></button>
      <button type="button" onClick={onHistory}><ClipboardClock aria-hidden="true" /><span>ประวัติ</span></button>
      {canManageStock && <>
        <button type="button" onClick={() => onManagerAction('RECEIVE')}><PackageCheck aria-hidden="true" /><span>รับเข้า</span></button>
        <button type="button" onClick={() => onManagerAction('MANAGE')}><Settings2 aria-hidden="true" /><span>จัดการสินค้า</span></button>
      </>}
    </section>

    <section className="pmc-stock-browser" aria-labelledby="stock-list-heading">
      <h2 id="stock-list-heading">รายการสินค้า</h2>
      <label className="pmc-stock-search" htmlFor="pmc-stock-search">
        <span>ค้นหาสินค้า</span>
        <span className="pmc-stock-search-control"><Search aria-hidden="true" /><input
          id="pmc-stock-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ชื่อ รหัส หรือหน่วยสินค้า"
          autoComplete="off"
        /></span>
      </label>

      <div className="pmc-stock-filters" role="group" aria-label="กรองสินค้า">
        {FILTERS.map((item) => <button
          key={item.value}
          type="button"
          aria-pressed={filter === item.value}
          onClick={() => setFilter(item.value)}
        >{item.label}</button>)}
      </div>

      <p className="pmc-stock-result-count" aria-live="polite">พบ {visibleProducts.length} รายการ</p>
      {visibleProducts.length > 0 ? <ul className="pmc-stock-product-list" role="list">
        {visibleProducts.map((product) => <li key={product.productId}>
          <article className={product.lowStock ? 'low' : undefined}>
            <div className="pmc-stock-product-icon" aria-hidden="true"><Boxes /></div>
            <div className="pmc-stock-product-copy">
              <h3>{product.name}</h3>
              <p>{stockCategoryLabel(product.category)} · {product.productId}</p>
              {product.lowStock && <span className="pmc-stock-low-badge">ใกล้หมด</span>}
            </div>
            <strong>{formatStockQuantity(product)}</strong>
          </article>
        </li>)}
      </ul> : <p className="pmc-stock-empty">ไม่พบสินค้าที่ตรงกับการค้นหา</p>}
    </section>
  </main>
}
