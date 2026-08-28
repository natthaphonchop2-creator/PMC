import { Plus, Trash2 } from 'lucide-react'
import { formatQuantityMilli, parseQuantityToMilli } from '../../../../shared/pmcStock'
import type { StockProductProjection } from '../contracts'
import type { StockLineDraft } from './stockModel'

export function StockLineEditor({
  products,
  lines,
  disabled,
  helpText,
  quantityLabel,
  emptyText,
  projectedLabel,
  projectBalance,
  errors = {},
  onChange,
  onAdd,
  onRemove,
}: {
  products: StockProductProjection[]
  lines: StockLineDraft[]
  disabled: boolean
  helpText: string
  quantityLabel: string
  emptyText: string
  projectedLabel: string
  projectBalance: (currentMilli: number, quantityMilli: number) => number
  errors?: Record<string, string>
  onChange: (lineId: string, patch: Partial<Pick<StockLineDraft, 'productId' | 'quantity'>>) => void
  onAdd: () => void
  onRemove: (lineId: string) => void
}) {
  const activeProducts = products.filter((product) => product.active)
  const selectedProductIds = new Set(lines.map((line) => line.productId).filter(Boolean))
  const canAdd = activeProducts.some((product) => !selectedProductIds.has(product.productId))

  return <section className="pmc-stock-line-editor" aria-labelledby="stock-lines-heading">
    <div className="pmc-stock-line-heading">
      <div>
        <h2 id="stock-lines-heading">รายการสินค้า</h2>
        <p>{helpText}</p>
      </div>
      <button type="button" onClick={onAdd} disabled={disabled || !canAdd}>
        <Plus aria-hidden="true" />เพิ่มสินค้า
      </button>
    </div>

    {lines.length > 0 ? <div className="pmc-stock-line-list">
      {lines.map((line, index) => {
        const product = activeProducts.find((item) => item.productId === line.productId)
        const quantityMilli = quantityOrNull(line.quantity)
        const projectedMilli = product && quantityMilli !== null
          ? projectBalance(product.onHandMilli, quantityMilli)
          : null
        const errorId = `stock-line-${line.lineId}-error`
        return <fieldset className="pmc-stock-line-card" key={line.lineId} disabled={disabled}>
          <legend>รายการที่ {index + 1}</legend>
          <button
            className="pmc-stock-line-remove"
            type="button"
            aria-label={`ลบสินค้า ${index + 1}`}
            onClick={() => onRemove(line.lineId)}
          ><Trash2 aria-hidden="true" /></button>

          <label className="pmc-stock-line-field">
            <span>สินค้า {index + 1}</span>
            <select
              name={`product-${line.lineId}`}
              value={line.productId}
              required
              aria-invalid={errors[line.lineId] ? 'true' : undefined}
              aria-describedby={errors[line.lineId] ? errorId : undefined}
              onChange={(event) => onChange(line.lineId, { productId: event.target.value })}
            >
              <option value="">เลือกสินค้า</option>
              {activeProducts
                .filter((item) => item.productId === line.productId || !selectedProductIds.has(item.productId))
                .map((item) => <option key={item.productId} value={item.productId}>{item.name}</option>)}
            </select>
          </label>

          <label className="pmc-stock-line-field">
            <span>{quantityLabel} {index + 1}</span>
            <input
              name={`quantity-${line.lineId}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?"
              value={line.quantity}
              required
              aria-invalid={errors[line.lineId] ? 'true' : undefined}
              aria-describedby={errors[line.lineId] ? errorId : undefined}
              onChange={(event) => onChange(line.lineId, { quantity: event.target.value })}
            />
          </label>

          {errors[line.lineId] && <p className="pmc-stock-line-error" id={errorId}>{errors[line.lineId]}</p>}
          <dl className={projectedMilli !== null && projectedMilli < 0 ? 'pmc-stock-line-balance negative' : 'pmc-stock-line-balance'}>
            <div><dt>คงเหลือปัจจุบัน</dt><dd>{product ? `${formatQuantityMilli(product.onHandMilli)} ${product.unit}` : '—'}</dd></div>
            <div><dt>{projectedLabel}</dt><dd>{product && projectedMilli !== null ? `${formatQuantityMilli(projectedMilli)} ${product.unit}` : '—'}</dd></div>
          </dl>
        </fieldset>
      })}
    </div> : <p className="pmc-stock-line-empty">{emptyText}</p>}
  </section>
}

function quantityOrNull(value: string): number | null {
  try {
    return parseQuantityToMilli(value)
  } catch {
    return null
  }
}
