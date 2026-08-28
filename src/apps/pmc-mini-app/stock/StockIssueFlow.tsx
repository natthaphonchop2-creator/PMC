import { useRef, useState } from 'react'
import { ArrowLeft, Check, PackageMinus } from 'lucide-react'
import {
  parseQuantityToMilli,
  type StockCommandResult,
} from '../../../../shared/pmcStock'
import type { StockProductProjection } from '../contracts'
import { StockLineEditor } from './StockLineEditor'
import {
  createIssueCommand,
  formatStockQuantity,
  useStockCommandAttemptTracker,
  type StockIssueCommand,
  type StockLineDraft,
} from './stockModel'

export interface StockIssueFlowAdapter {
  issue(command: StockIssueCommand): Promise<StockCommandResult>
  loadProducts(): Promise<{ products: StockProductProjection[] }>
}

export function StockIssueFlow({
  initialProducts,
  adapter,
  onCancel,
  onReturnToStock,
  requestIdFactory = createRequestId,
}: {
  initialProducts: StockProductProjection[]
  adapter: StockIssueFlowAdapter
  onCancel: () => void
  onReturnToStock: (products: StockProductProjection[]) => void
  requestIdFactory?: () => string
}) {
  const commandForAttempt = useStockCommandAttemptTracker(requestIdFactory)
  const [products, setProducts] = useState(() => initialProducts.filter((product) => product.active))
  const [lines, setLines] = useState<StockLineDraft[]>([{ lineId: 'line-1', productId: '', quantity: '' }])
  const [pending, setPending] = useState(false)
  const [returning, setReturning] = useState(false)
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<StockCommandResult | null>(null)
  const nextLineNumber = useRef(2)

  const updateLine = (lineId: string, patch: Partial<Pick<StockLineDraft, 'productId' | 'quantity'>>) => {
    setLines((current) => current.map((line) => line.lineId === lineId ? { ...line, ...patch } : line))
    setFieldErrors((current) => withoutKey(current, lineId))
    setMessage('')
  }

  const addLine = () => {
    const lineId = `line-${nextLineNumber.current++}`
    setLines((current) => [...current, { lineId, productId: '', quantity: '' }])
    setMessage('')
  }

  const removeLine = (lineId: string) => {
    setLines((current) => current.filter((line) => line.lineId !== lineId))
    setFieldErrors((current) => withoutKey(current, lineId))
    setMessage('')
  }

  const submit = async () => {
    if (pending) return
    const validation = validateIssueDraft(products, lines)
    if (validation) {
      setFieldErrors(validation.fieldErrors)
      setMessage(validation.message)
      return
    }

    const command = commandForAttempt(createIssueCommand({ requestId: '', products, lines })) as StockIssueCommand
    setPending(true)
    setMessage('')
    setFieldErrors({})
    try {
      const nextResult = await adapter.issue(command)
      setResult(nextResult)
    } catch (error) {
      const code = safeErrorCode(error)
      if (code === 'STOCK_INSUFFICIENT_BALANCE' || code === 'STOCK_PRODUCT_INACTIVE') {
        await reloadAfterSafeConflict(code)
      } else {
        setMessage('บันทึกการเบิกไม่สำเร็จ กรุณาลองอีกครั้ง ร่างรายการยังอยู่ครบ')
      }
    } finally {
      setPending(false)
    }
  }

  const reloadAfterSafeConflict = async (code: 'STOCK_INSUFFICIENT_BALANCE' | 'STOCK_PRODUCT_INACTIVE') => {
    try {
      const response = await adapter.loadProducts()
      const activeProducts = response.products.filter((product) => product.active)
      const activeIds = new Set(activeProducts.map((product) => product.productId))
      const removedLines = lines.filter((line) => line.productId && !activeIds.has(line.productId))
      const removedNames = removedLines.map((line) => productName(products, line.productId))
      setProducts(activeProducts)
      setLines((current) => current.filter((line) => !line.productId || activeIds.has(line.productId)))
      setFieldErrors({})
      if (removedNames.length > 0) {
        setMessage(`อัปเดตรายการสินค้าล่าสุดแล้ว และนำสินค้า ${removedNames.join(', ')} ออกจากรายการเบิกเพราะไม่พร้อมใช้งาน`)
      } else if (code === 'STOCK_INSUFFICIENT_BALANCE') {
        setMessage('อัปเดตยอดคงเหลือล่าสุดแล้ว กรุณาตรวจและแก้จำนวนก่อนลองอีกครั้ง')
      } else {
        setMessage('อัปเดตรายการสินค้าล่าสุดแล้ว กรุณาตรวจสอบก่อนลองอีกครั้ง')
      }
    } catch {
      setMessage('ตรวจสอบรายการสินค้าล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง ร่างรายการยังอยู่ครบ')
    }
  }

  const returnToStock = async () => {
    if (returning) return
    setReturning(true)
    setMessage('')
    try {
      const response = await adapter.loadProducts()
      onReturnToStock(response.products)
    } catch {
      setMessage('บันทึกสำเร็จแล้ว แต่โหลดหน้า Stock ล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setReturning(false)
    }
  }

  if (result) {
    return <main className="pmc-stock-success">
      <div className="pmc-success-mark" aria-hidden="true"><Check /></div>
      <p>บันทึกเอกสารเรียบร้อย</p>
      <h1>เบิกสินค้าสำเร็จ</h1>
      <dl>
        <div><dt>เลขที่เอกสาร</dt><dd>{result.documentId}</dd></div>
        <div><dt>จำนวนรายการ</dt><dd>{result.lines.length} รายการ</dd></div>
      </dl>
      {message && <p className="pmc-stock-flow-alert" role="alert" aria-live="assertive">{message}</p>}
      <button type="button" disabled={returning} onClick={() => void returnToStock()}>
        {returning ? 'กำลังโหลด Stock' : 'กลับหน้า Stock'}
      </button>
    </main>
  }

  return <main className="pmc-stock-issue-page">
    <header className="pmc-stock-flow-header">
      <button type="button" aria-label="ยกเลิกการเบิกสินค้า" onClick={onCancel} disabled={pending}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div>
        <p lang="en">ISSUE DOCUMENT</p>
        <h1>เบิกสินค้า</h1>
        <span>เลือกสินค้าและระบุจำนวนที่ต้องการเบิก</span>
      </div>
      <PackageMinus aria-hidden="true" />
    </header>

    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {message && <p className="pmc-stock-flow-alert" role="alert" aria-live="assertive">{message}</p>}
      <StockLineEditor
        products={products}
        lines={lines}
        disabled={pending}
        helpText="เลือกสินค้าได้หลายรายการ โดยไม่เลือกซ้ำ"
        quantityLabel="จำนวน"
        emptyText="ยังไม่มีสินค้าในรายการเบิก"
        projectedLabel="หลังเบิก"
        projectBalance={(currentMilli, quantityMilli) => currentMilli - quantityMilli}
        errors={fieldErrors}
        onChange={updateLine}
        onAdd={addLine}
        onRemove={removeLine}
      />
      <footer className="pmc-stock-flow-footer">
        <button type="button" className="pmc-secondary-button" onClick={onCancel} disabled={pending}>ยกเลิก</button>
        <button type="submit" className="pmc-primary-button" disabled={pending}>
          {pending ? 'กำลังบันทึก' : 'ยืนยันเบิกสินค้า'}
        </button>
      </footer>
    </form>
  </main>
}

function validateIssueDraft(products: StockProductProjection[], lines: StockLineDraft[]): {
  message: string
  fieldErrors: Record<string, string>
} | null {
  if (lines.length === 0) return { message: 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ', fieldErrors: {} }
  const selectedIds = new Set<string>()
  for (const line of lines) {
    if (!line.productId) return {
      message: 'กรุณาเลือกสินค้าให้ครบทุกรายการ',
      fieldErrors: { [line.lineId]: 'กรุณาเลือกสินค้า' },
    }
    if (selectedIds.has(line.productId)) return {
      message: 'เลือกสินค้าซ้ำ กรุณาเลือกสินค้าแต่ละรายการเพียงครั้งเดียว',
      fieldErrors: { [line.lineId]: 'สินค้านี้ถูกเลือกแล้ว' },
    }
    selectedIds.add(line.productId)
    const product = products.find((item) => item.productId === line.productId && item.active)
    if (!product) return {
      message: `สินค้า ${productName(products, line.productId)} ไม่พร้อมใช้งาน`,
      fieldErrors: { [line.lineId]: 'สินค้านี้ไม่พร้อมใช้งาน' },
    }
    let quantityMilli: number
    try {
      quantityMilli = parseQuantityToMilli(line.quantity)
    } catch {
      return {
        message: 'จำนวนต้องมากกว่า 0 และไม่เกิน 3 ตำแหน่งทศนิยม',
        fieldErrors: { [line.lineId]: 'กรอกจำนวนมากกว่า 0 และไม่เกิน 3 ตำแหน่งทศนิยม' },
      }
    }
    if (quantityMilli > product.onHandMilli) return {
      message: `สินค้า ${product.name} คงเหลือ ${formatStockQuantity(product)}`,
      fieldErrors: { [line.lineId]: `จำนวนเบิกเกินยอดคงเหลือ ${formatStockQuantity(product)}` },
    }
  }
  return null
}

function productName(products: StockProductProjection[], productId: string): string {
  return products.find((product) => product.productId === productId)?.name ?? productId
}

function safeErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function withoutKey(input: Record<string, string>, key: string): Record<string, string> {
  const next = { ...input }
  delete next[key]
  return next
}

function createRequestId(): string {
  return globalThis.crypto.randomUUID()
}
