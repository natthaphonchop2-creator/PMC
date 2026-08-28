import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  PackageCheck,
  PackagePlus,
  Pencil,
  Power,
  PowerOff,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import {
  formatQuantityMilli,
  normalizeStockProductText,
  parseNonNegativeQuantityToMilli,
  parseQuantityToMilli,
  type StockCategory,
  type StockClientCommand,
  type StockCommandResult,
} from '../../../../shared/pmcStock'
import type { StockProductProjection } from '../contracts'
import { StockLineEditor } from './StockLineEditor'
import {
  canEditProductUnit,
  createAdjustmentCommand,
  formatStockQuantity,
  stockCategoryLabel,
  type StockLineDraft,
} from './stockModel'

export type StockManagerMode = 'RECEIVE' | 'MANAGE'

type StockManagerScreen = StockManagerMode | 'CREATE' | 'ADJUST' | 'EDIT'

export interface StockManagerAdapter {
  submit(command: StockClientCommand): Promise<StockCommandResult>
  loadProducts(): Promise<{ products: StockProductProjection[] }>
}

export function StockManager({
  initialProducts,
  initialMode,
  adapter,
  onCancel,
  onReturnToStock,
  requestIdFactory = createRequestId,
}: {
  initialProducts: StockProductProjection[]
  initialMode: StockManagerMode
  adapter: StockManagerAdapter
  onCancel: () => void
  onReturnToStock: (products: StockProductProjection[]) => void
  requestIdFactory?: () => string
}) {
  const [products, setProducts] = useState(initialProducts)
  const [screen, setScreen] = useState<StockManagerScreen>(initialMode)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [result, setResult] = useState<{ value: StockCommandResult; title: string } | null>(null)
  const [resultMessage, setResultMessage] = useState('')
  const [returning, setReturning] = useState(false)

  const complete = async (value: StockCommandResult, title: string) => {
    let refreshMessage = ''
    try {
      const response = await adapter.loadProducts()
      setProducts(response.products)
    } catch {
      refreshMessage = 'บันทึกสำเร็จแล้ว แต่โหลดรายการสินค้าล่าสุดไม่สำเร็จ'
    }
    setResultMessage(refreshMessage)
    setResult({ value, title })
  }

  const returnToStock = async () => {
    if (returning) return
    setReturning(true)
    setResultMessage('')
    try {
      const response = await adapter.loadProducts()
      onReturnToStock(response.products)
    } catch {
      setResultMessage('โหลดหน้า Stock ล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setReturning(false)
    }
  }

  if (result) {
    return <ManagerSuccess
      result={result.value}
      title={result.title}
      message={resultMessage}
      returning={returning}
      onReturn={() => void returnToStock()}
    />
  }

  if (screen === 'RECEIVE') {
    return <ReceiveFlow
      products={products}
      adapter={adapter}
      requestIdFactory={requestIdFactory}
      onCancel={onCancel}
      onSuccess={(value) => complete(value, 'รับเข้าสำเร็จ')}
    />
  }

  if (screen === 'CREATE') {
    return <CreateProductFlow
      adapter={adapter}
      requestIdFactory={requestIdFactory}
      onCancel={() => setScreen('MANAGE')}
      onSuccess={(value) => complete(value, 'เพิ่มสินค้าสำเร็จ')}
    />
  }

  const selectedProduct = products.find((product) => product.productId === selectedProductId)
  if (screen === 'ADJUST' && selectedProduct) {
    return <AdjustmentFlow
      products={products}
      initialProductId={selectedProduct.productId}
      adapter={adapter}
      requestIdFactory={requestIdFactory}
      onCancel={() => setScreen('MANAGE')}
      onSuccess={(value) => complete(value, 'ปรับยอดสำเร็จ')}
    />
  }

  if (screen === 'EDIT' && selectedProduct) {
    return <EditProductFlow
      product={selectedProduct}
      adapter={adapter}
      requestIdFactory={requestIdFactory}
      onProductsReloaded={setProducts}
      onCancel={() => setScreen('MANAGE')}
      onSuccess={(value) => complete(value, 'แก้ไขสินค้าสำเร็จ')}
    />
  }

  return <ManageProducts
    products={products}
    adapter={adapter}
    requestIdFactory={requestIdFactory}
    onProductsReloaded={setProducts}
    onCancel={onCancel}
    onCreate={() => setScreen('CREATE')}
    onAdjust={(productId) => { setSelectedProductId(productId); setScreen('ADJUST') }}
    onEdit={(productId) => { setSelectedProductId(productId); setScreen('EDIT') }}
    onSuccess={(value, title) => complete(value, title)}
  />
}

function ReceiveFlow({ products, adapter, requestIdFactory, onCancel, onSuccess }: {
  products: StockProductProjection[]
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onCancel: () => void
  onSuccess: (result: StockCommandResult) => Promise<void>
}) {
  const [requestId] = useState(requestIdFactory)
  const [lines, setLines] = useState<StockLineDraft[]>([{ lineId: 'line-1', productId: '', quantity: '' }])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const nextLineNumber = useRef(2)

  const updateLine = (lineId: string, patch: Partial<Pick<StockLineDraft, 'productId' | 'quantity'>>) => {
    setLines((current) => current.map((line) => line.lineId === lineId ? { ...line, ...patch } : line))
    setFieldErrors((current) => withoutKey(current, lineId))
    setMessage('')
  }

  const submit = async () => {
    if (pending) return
    const validation = validateReceiveDraft(products, lines)
    if (validation) {
      setMessage(validation.message)
      setFieldErrors(validation.fieldErrors)
      return
    }
    const command: StockClientCommand = {
      requestId,
      commandType: 'RECEIVE',
      payload: { lines: lines.map((line) => ({
        productId: line.productId,
        quantityMilli: parseQuantityToMilli(line.quantity),
      })) },
    }
    setPending(true)
    setMessage('')
    setFieldErrors({})
    try {
      await onSuccess(await adapter.submit(command))
    } catch (error) {
      setMessage(managerFailureMessage(error, 'บันทึกรับเข้าไม่สำเร็จ กรุณาลองอีกครั้ง รายการรับเข้ายังอยู่ครบ'))
    } finally {
      setPending(false)
    }
  }

  return <ManagerPage
    eyebrow="RECEIVE DOCUMENT"
    title="รับเข้าสินค้า"
    description="เลือกสินค้าและระบุจำนวนที่รับเข้า"
    icon={<PackageCheck aria-hidden="true" />}
    cancelLabel="ยกเลิกการรับเข้าสินค้า"
    pending={pending}
    onCancel={onCancel}
  >
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <FlowAlert message={message} />
      <StockLineEditor
        products={products}
        lines={lines}
        disabled={pending}
        helpText="เลือกสินค้ารับเข้าได้หลายรายการ โดยไม่เลือกซ้ำ"
        quantityLabel="จำนวนรับเข้า"
        emptyText="ยังไม่มีสินค้าในรายการรับเข้า"
        projectedLabel="หลังรับเข้า"
        projectBalance={(currentMilli, quantityMilli) => currentMilli + quantityMilli}
        errors={fieldErrors}
        onChange={updateLine}
        onAdd={() => {
          const lineId = `line-${nextLineNumber.current++}`
          setLines((current) => [...current, { lineId, productId: '', quantity: '' }])
          setMessage('')
        }}
        onRemove={(lineId) => {
          setLines((current) => current.filter((line) => line.lineId !== lineId))
          setFieldErrors((current) => withoutKey(current, lineId))
          setMessage('')
        }}
      />
      <FlowFooter pending={pending} cancelLabel="ยกเลิก" submitLabel="ยืนยันรับเข้า" onCancel={onCancel} />
    </form>
  </ManagerPage>
}

function CreateProductFlow({ adapter, requestIdFactory, onCancel, onSuccess }: {
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onCancel: () => void
  onSuccess: (result: StockCommandResult) => Promise<void>
}) {
  const [requestId] = useState(requestIdFactory)
  const [form, setForm] = useState({
    name: '', category: 'CLINIC_SUPPLY' as StockCategory, unit: '', openingQuantity: '', minimumQuantity: '',
  })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async () => {
    if (pending) return
    let command: StockClientCommand
    try {
      const name = requiredText(form.name, 300)
      const unit = requiredText(form.unit, 100)
      command = {
        requestId,
        commandType: 'CREATE_PRODUCT',
        payload: {
          name,
          category: form.category,
          unit,
          openingQuantityMilli: parseNonNegativeQuantityToMilli(form.openingQuantity),
          minimumQuantityMilli: parseNonNegativeQuantityToMilli(form.minimumQuantity),
        },
      }
    } catch {
      setMessage('กรุณากรอกชื่อ หน่วย จำนวนเริ่มต้น และจำนวนขั้นต่ำให้ถูกต้อง')
      return
    }
    setPending(true)
    setMessage('')
    try {
      await onSuccess(await adapter.submit(command))
    } catch (error) {
      setMessage(managerFailureMessage(error, 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่ครบ'))
    } finally {
      setPending(false)
    }
  }

  return <ManagerPage
    eyebrow="NEW PRODUCT"
    title="เพิ่มสินค้าใหม่"
    description="สร้างสินค้าและกำหนดยอดเริ่มต้น"
    icon={<PackagePlus aria-hidden="true" />}
    cancelLabel="ยกเลิกการเพิ่มสินค้า"
    pending={pending}
    onCancel={onCancel}
  >
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <FlowAlert message={message} />
      <section className="pmc-stock-manager-card" aria-label="ข้อมูลสินค้าใหม่">
        <ManagerTextField label="ชื่อสินค้า" name="name" value={form.name} disabled={pending}
          onChange={(name) => { setForm((current) => ({ ...current, name })); setMessage('') }} />
        <ManagerCategoryField value={form.category} disabled={pending}
          onChange={(category) => { setForm((current) => ({ ...current, category })); setMessage('') }} />
        <ManagerTextField label="หน่วย" name="unit" value={form.unit} disabled={pending}
          onChange={(unit) => { setForm((current) => ({ ...current, unit })); setMessage('') }} />
        <ManagerQuantityField label="จำนวนเริ่มต้น" name="openingQuantity" value={form.openingQuantity} disabled={pending}
          onChange={(openingQuantity) => { setForm((current) => ({ ...current, openingQuantity })); setMessage('') }} />
        <ManagerQuantityField label="จำนวนขั้นต่ำ" name="minimumQuantity" value={form.minimumQuantity} disabled={pending}
          onChange={(minimumQuantity) => { setForm((current) => ({ ...current, minimumQuantity })); setMessage('') }} />
      </section>
      <FlowFooter pending={pending} cancelLabel="ยกเลิก" submitLabel="บันทึกสินค้า" onCancel={onCancel} />
    </form>
  </ManagerPage>
}

function AdjustmentFlow({ products, initialProductId, adapter, requestIdFactory, onCancel, onSuccess }: {
  products: StockProductProjection[]
  initialProductId: string
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onCancel: () => void
  onSuccess: (result: StockCommandResult) => Promise<void>
}) {
  const [requestId] = useState(requestIdFactory)
  const [productId, setProductId] = useState(initialProductId)
  const [countedQuantity, setCountedQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const product = products.find((item) => item.productId === productId && item.active) ?? null
  const preview = product ? adjustmentPreview(product, countedQuantity) : ''

  const submit = async () => {
    if (pending) return
    if (!product) {
      setMessage('กรุณาเลือกสินค้า')
      return
    }
    let command: StockClientCommand
    try {
      command = createAdjustmentCommand({ requestId, product, countedQuantity, reason })
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'STOCK_ADJUST_REASON_REQUIRED'
        ? 'กรุณาระบุเหตุผล 1-300 ตัวอักษร'
        : 'จำนวนที่นับจริงต้องเป็น 0 ขึ้นไป และไม่เกิน 3 ตำแหน่งทศนิยม')
      return
    }
    setPending(true)
    setMessage('')
    try {
      await onSuccess(await adapter.submit(command))
    } catch (error) {
      setMessage(managerFailureMessage(error, 'ปรับยอดไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่ครบ'))
    } finally {
      setPending(false)
    }
  }

  return <ManagerPage
    eyebrow="PHYSICAL COUNT"
    title="ปรับยอดตามจำนวนจริง"
    description="ระบุยอดที่นับได้ ระบบจะคำนวณส่วนต่าง"
    icon={<ClipboardCheck aria-hidden="true" />}
    cancelLabel="ยกเลิกการปรับยอด"
    pending={pending}
    onCancel={onCancel}
  >
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <FlowAlert message={message} />
      <section className="pmc-stock-manager-card" aria-label="ข้อมูลการตรวจนับ">
        <label className="pmc-stock-manager-field">
          <span>สินค้า</span>
          <select name="productId" value={productId} disabled={pending} required onChange={(event) => {
            setProductId(event.target.value); setMessage('')
          }}>
            {products.filter((item) => item.active).map((item) => <option key={item.productId} value={item.productId}>{item.name}</option>)}
          </select>
        </label>
        <dl className="pmc-stock-manager-summary">
          <div><dt>ยอดปัจจุบัน</dt><dd>{product ? formatStockQuantity(product) : '—'}</dd></div>
          <div><dt>ส่วนต่าง</dt><dd>{preview || '—'}</dd></div>
        </dl>
        <ManagerQuantityField label="จำนวนที่นับจริง" name="countedQuantity" value={countedQuantity} disabled={pending}
          onChange={(value) => { setCountedQuantity(value); setMessage('') }} />
        <div className="pmc-stock-manager-field">
          <label htmlFor="pmc-stock-adjust-reason">เหตุผล</label>
          <textarea
            id="pmc-stock-adjust-reason"
            name="reason"
            value={reason}
            maxLength={300}
            rows={3}
            disabled={pending}
            required
            aria-describedby="pmc-stock-adjust-reason-count"
            onChange={(event) => { setReason(event.target.value); setMessage('') }}
          />
          <small id="pmc-stock-adjust-reason-count">{reason.length}/300 ตัวอักษร</small>
        </div>
      </section>
      <FlowFooter pending={pending} cancelLabel="ยกเลิก" submitLabel="ยืนยันปรับยอด" onCancel={onCancel} />
    </form>
  </ManagerPage>
}

function EditProductFlow({ product, adapter, requestIdFactory, onProductsReloaded, onCancel, onSuccess }: {
  product: StockProductProjection
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onProductsReloaded: (products: StockProductProjection[]) => void
  onCancel: () => void
  onSuccess: (result: StockCommandResult) => Promise<void>
}) {
  const [requestId] = useState(requestIdFactory)
  const [latestProduct, setLatestProduct] = useState(product)
  const [form, setForm] = useState({
    name: product.name,
    category: product.category,
    unit: product.unit,
    minimumQuantity: formatQuantityMilli(product.minimumQuantityMilli),
  })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const unitEditable = canEditProductUnit(latestProduct)

  const submit = async () => {
    if (pending) return
    let command: StockClientCommand
    try {
      command = {
        requestId,
        commandType: 'UPDATE_PRODUCT',
        payload: {
          productId: latestProduct.productId,
          expectedVersion: latestProduct.version,
          name: requiredText(form.name, 300),
          category: form.category,
          unit: requiredText(unitEditable ? form.unit : latestProduct.unit, 100),
          minimumQuantityMilli: parseNonNegativeQuantityToMilli(form.minimumQuantity),
        },
      }
    } catch {
      setMessage('กรุณากรอกชื่อ หน่วย และจำนวนขั้นต่ำให้ถูกต้อง')
      return
    }
    setPending(true)
    setMessage('')
    try {
      await onSuccess(await adapter.submit(command))
    } catch (error) {
      if (safeErrorCode(error) === 'STOCK_STALE_PRODUCT') {
        try {
          const response = await adapter.loadProducts()
          const latest = response.products.find((item) => item.productId === product.productId)
          if (!latest) {
            setMessage('ไม่พบสินค้านี้ในรายการล่าสุด ข้อมูลที่แก้ยังอยู่ครบ')
          } else {
            onProductsReloaded(response.products)
            setLatestProduct(latest)
            setForm((current) => ({ ...current, unit: latest.hasLedgerActivity ? latest.unit : current.unit }))
            setMessage('โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบอีกครั้ง ข้อมูลที่แก้ยังอยู่ครบ')
          }
        } catch {
          setMessage('โหลดข้อมูลสินค้าล่าสุดไม่สำเร็จ ข้อมูลที่แก้ยังอยู่ครบ')
        }
      } else {
        setMessage(managerFailureMessage(error, 'แก้ไขสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลที่แก้ยังอยู่ครบ'))
      }
    } finally {
      setPending(false)
    }
  }

  return <ManagerPage
    eyebrow="PRODUCT SETTINGS"
    title="แก้ไขสินค้า"
    description={`${latestProduct.name} · เวอร์ชัน ${latestProduct.version}`}
    icon={<Pencil aria-hidden="true" />}
    cancelLabel="ยกเลิกการแก้ไขสินค้า"
    pending={pending}
    onCancel={onCancel}
  >
    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <FlowAlert message={message} />
      <section className="pmc-stock-manager-card" aria-label="ข้อมูลสินค้า">
        <ManagerTextField label="ชื่อสินค้า" name="name" value={form.name} disabled={pending}
          onChange={(name) => { setForm((current) => ({ ...current, name })); setMessage('') }} />
        <ManagerCategoryField value={form.category} disabled={pending}
          onChange={(category) => { setForm((current) => ({ ...current, category })); setMessage('') }} />
        <ManagerTextField
          label="หน่วย"
          name="unit"
          value={form.unit}
          disabled={pending || !unitEditable}
          describedBy={!unitEditable ? 'pmc-stock-unit-lock' : undefined}
          onChange={(unit) => { setForm((current) => ({ ...current, unit })); setMessage('') }}
        />
        {!unitEditable && <p className="pmc-stock-manager-help" id="pmc-stock-unit-lock">
          หน่วยเปลี่ยนไม่ได้เพราะมีประวัติ Stock แล้ว
        </p>}
        <ManagerQuantityField label="จำนวนขั้นต่ำ" name="minimumQuantity" value={form.minimumQuantity} disabled={pending}
          onChange={(minimumQuantity) => { setForm((current) => ({ ...current, minimumQuantity })); setMessage('') }} />
      </section>
      <FlowFooter pending={pending} cancelLabel="ยกเลิก" submitLabel="บันทึกการแก้ไข" onCancel={onCancel} />
    </form>
  </ManagerPage>
}

function ManageProducts({
  products,
  adapter,
  requestIdFactory,
  onProductsReloaded,
  onCancel,
  onCreate,
  onAdjust,
  onEdit,
  onSuccess,
}: {
  products: StockProductProjection[]
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onProductsReloaded: (products: StockProductProjection[]) => void
  onCancel: () => void
  onCreate: () => void
  onAdjust: (productId: string) => void
  onEdit: (productId: string) => void
  onSuccess: (result: StockCommandResult, title: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [lifecycleProduct, setLifecycleProduct] = useState<StockProductProjection | null>(null)
  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('th')
    return products.filter((product) => !normalized || `${product.name} ${product.productId} ${product.unit}`
      .toLocaleLowerCase('th').includes(normalized))
  }, [products, query])

  return <ManagerPage
    eyebrow="PRODUCT MANAGEMENT"
    title="จัดการสินค้า"
    description="เพิ่ม ปรับยอด แก้ไข หรือเปลี่ยนสถานะสินค้า"
    icon={<SlidersHorizontal aria-hidden="true" />}
    cancelLabel="กลับหน้า Stock"
    pending={false}
    onCancel={onCancel}
  >
    <section className="pmc-stock-manager-toolbar" aria-label="เครื่องมือจัดการสินค้า">
      <button type="button" className="pmc-primary-button" onClick={onCreate}><PackagePlus aria-hidden="true" />เพิ่มสินค้า</button>
      <label className="pmc-stock-manager-search">
        <span>ค้นหาสินค้า</span>
        <span><Search aria-hidden="true" /><input
          type="search"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        /></span>
      </label>
    </section>

    {visibleProducts.length > 0 ? <ul className="pmc-stock-manager-list" role="list">
      {visibleProducts.map((product) => <li key={product.productId}>
        <article>
          <header>
            <div>
              <h2>{product.name}</h2>
              <p>{stockCategoryLabel(product.category)} · {product.productId}</p>
            </div>
            <span className={product.active ? 'active' : 'inactive'}>{product.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
          </header>
          <dl>
            <div><dt>คงเหลือ</dt><dd>{formatStockQuantity(product)}</dd></div>
            <div><dt>ขั้นต่ำ</dt><dd>{formatQuantityMilli(product.minimumQuantityMilli)} {product.unit}</dd></div>
          </dl>
          <div className="pmc-stock-manager-actions">
            {product.active && <button type="button" onClick={() => onAdjust(product.productId)}>
              <ClipboardCheck aria-hidden="true" />ปรับยอด <span className="pmc-visually-hidden">{product.name}</span>
            </button>}
            <button type="button" onClick={() => onEdit(product.productId)}>
              <Pencil aria-hidden="true" />แก้ไข <span className="pmc-visually-hidden">{product.name}</span>
            </button>
            <button type="button" className="danger" onClick={() => setLifecycleProduct(product)}>
              {product.active ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
              {product.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} <span className="pmc-visually-hidden">{product.name}</span>
            </button>
          </div>
        </article>
      </li>)}
    </ul> : <p className="pmc-stock-empty">ไม่พบสินค้าที่ตรงกับการค้นหา</p>}

    {lifecycleProduct && <LifecycleConfirm
      key={`${lifecycleProduct.productId}:${lifecycleProduct.active}`}
      product={lifecycleProduct}
      adapter={adapter}
      requestIdFactory={requestIdFactory}
      onProductsReloaded={(nextProducts) => {
        onProductsReloaded(nextProducts)
        const latest = nextProducts.find((item) => item.productId === lifecycleProduct.productId)
        if (latest) setLifecycleProduct(latest)
      }}
      onCancel={() => setLifecycleProduct(null)}
      onSuccess={onSuccess}
    />}
  </ManagerPage>
}

function LifecycleConfirm({ product, adapter, requestIdFactory, onProductsReloaded, onCancel, onSuccess }: {
  product: StockProductProjection
  adapter: StockManagerAdapter
  requestIdFactory: () => string
  onProductsReloaded: (products: StockProductProjection[]) => void
  onCancel: () => void
  onSuccess: (result: StockCommandResult, title: string) => Promise<void>
}) {
  const [requestId] = useState(requestIdFactory)
  const [latestProduct, setLatestProduct] = useState(product)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const isDeactivating = product.active
  const actionLabel = isDeactivating ? 'ปิดใช้งาน' : 'เปิดใช้งาน'

  const submit = async () => {
    if (pending) return
    const command: StockClientCommand = {
      requestId,
      commandType: isDeactivating ? 'DEACTIVATE_PRODUCT' : 'REACTIVATE_PRODUCT',
      payload: { productId: latestProduct.productId, expectedVersion: latestProduct.version },
    }
    setPending(true)
    setMessage('')
    try {
      const result = await adapter.submit(command)
      await onSuccess(result, isDeactivating ? 'ปิดใช้งานสินค้าสำเร็จ' : 'เปิดใช้งานสินค้าสำเร็จ')
    } catch (error) {
      if (safeErrorCode(error) === 'STOCK_STALE_PRODUCT') {
        try {
          const response = await adapter.loadProducts()
          const latest = response.products.find((item) => item.productId === product.productId)
          if (!latest) setMessage('ไม่พบสินค้านี้ในรายการล่าสุด')
          else {
            setLatestProduct(latest)
            onProductsReloaded(response.products)
            setMessage('โหลดสถานะล่าสุดแล้ว กรุณาตรวจสอบก่อนยืนยันอีกครั้ง')
          }
        } catch {
          setMessage('โหลดสถานะล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง')
        }
      } else {
        setMessage(managerFailureMessage(error, `${actionLabel}สินค้าไม่สำเร็จ กรุณาลองอีกครั้ง`))
      }
    } finally {
      setPending(false)
    }
  }

  return <div className="pmc-stock-confirm-backdrop">
    <section className="pmc-stock-confirm" role="dialog" aria-modal="true" aria-labelledby="pmc-stock-confirm-title">
      <h2 id="pmc-stock-confirm-title">ยืนยัน{actionLabel}สินค้า</h2>
      <p>ต้องการ{actionLabel} “{product.name}” ใช่หรือไม่</p>
      <FlowAlert message={message} />
      <div>
        <button type="button" className="pmc-secondary-button" disabled={pending} onClick={onCancel}>ยกเลิก</button>
        <button type="button" className="pmc-primary-button" disabled={pending} onClick={() => void submit()}>
          {pending ? 'กำลังบันทึก' : `ยืนยัน${actionLabel}`}
        </button>
      </div>
    </section>
  </div>
}

function ManagerPage({ eyebrow, title, description, icon, cancelLabel, pending, onCancel, children }: {
  eyebrow: string
  title: string
  description: string
  icon: React.ReactNode
  cancelLabel: string
  pending: boolean
  onCancel: () => void
  children: React.ReactNode
}) {
  return <main className="pmc-stock-manager-page">
    <header className="pmc-stock-flow-header">
      <button type="button" aria-label={cancelLabel} onClick={onCancel} disabled={pending}><ArrowLeft aria-hidden="true" /></button>
      <div><p lang="en">{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>
      {icon}
    </header>
    {children}
  </main>
}

function FlowFooter({ pending, cancelLabel, submitLabel, onCancel }: {
  pending: boolean
  cancelLabel: string
  submitLabel: string
  onCancel: () => void
}) {
  return <footer className="pmc-stock-flow-footer">
    <button type="button" className="pmc-secondary-button" onClick={onCancel} disabled={pending}>{cancelLabel}</button>
    <button type="submit" className="pmc-primary-button" disabled={pending}>
      {pending ? 'กำลังบันทึก' : submitLabel}
    </button>
  </footer>
}

function FlowAlert({ message }: { message: string }) {
  return message ? <p className="pmc-stock-flow-alert" role="alert" aria-live="assertive">{message}</p> : null
}

function ManagerTextField({ label, name, value, disabled, describedBy, onChange }: {
  label: string
  name: string
  value: string
  disabled: boolean
  describedBy?: string
  onChange: (value: string) => void
}) {
  return <label className="pmc-stock-manager-field">
    <span>{label}</span>
    <input
      name={name}
      type="text"
      value={value}
      disabled={disabled}
      required
      aria-describedby={describedBy}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
}

function ManagerQuantityField({ label, name, value, disabled, onChange }: {
  label: string
  name: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return <label className="pmc-stock-manager-field">
    <span>{label}</span>
    <input
      name={name}
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?"
      value={value}
      disabled={disabled}
      required
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
}

function ManagerCategoryField({ value, disabled, onChange }: {
  value: StockCategory
  disabled: boolean
  onChange: (value: StockCategory) => void
}) {
  return <label className="pmc-stock-manager-field">
    <span>หมวดหมู่</span>
    <select name="category" value={value} disabled={disabled} required
      onChange={(event) => onChange(event.target.value as StockCategory)}>
      <option value="CLINIC_SUPPLY">ของใช้คลินิก</option>
      <option value="RETAIL_PRODUCT">สินค้าขาย</option>
    </select>
  </label>
}

function ManagerSuccess({ result, title, message, returning, onReturn }: {
  result: StockCommandResult
  title: string
  message: string
  returning: boolean
  onReturn: () => void
}) {
  return <main className="pmc-stock-success">
    <div className="pmc-success-mark" aria-hidden="true"><Check /></div>
    <p>บันทึกรายการเรียบร้อย</p>
    <h1>{title}</h1>
    <dl>
      <div><dt>เลขอ้างอิง</dt><dd>{result.documentId}</dd></div>
      <div><dt>ประเภท</dt><dd lang="en">{result.commandType}</dd></div>
    </dl>
    <FlowAlert message={message} />
    <button type="button" disabled={returning} onClick={onReturn}>
      {returning ? 'กำลังโหลด Stock' : 'กลับหน้า Stock'}
    </button>
  </main>
}

function validateReceiveDraft(products: StockProductProjection[], lines: StockLineDraft[]): {
  message: string
  fieldErrors: Record<string, string>
} | null {
  if (lines.length === 0) return { message: 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ', fieldErrors: {} }
  const selected = new Set<string>()
  for (const line of lines) {
    if (!line.productId) return { message: 'กรุณาเลือกสินค้าให้ครบทุกรายการ', fieldErrors: { [line.lineId]: 'กรุณาเลือกสินค้า' } }
    if (selected.has(line.productId)) return { message: 'เลือกสินค้าซ้ำ', fieldErrors: { [line.lineId]: 'สินค้านี้ถูกเลือกแล้ว' } }
    selected.add(line.productId)
    if (!products.some((product) => product.productId === line.productId && product.active)) {
      return { message: 'สินค้านี้ไม่พร้อมรับเข้า', fieldErrors: { [line.lineId]: 'สินค้านี้ไม่พร้อมใช้งาน' } }
    }
    try {
      parseQuantityToMilli(line.quantity)
    } catch {
      return {
        message: 'จำนวนรับเข้าต้องมากกว่า 0 และไม่เกิน 3 ตำแหน่งทศนิยม',
        fieldErrors: { [line.lineId]: 'กรอกจำนวนมากกว่า 0 และไม่เกิน 3 ตำแหน่งทศนิยม' },
      }
    }
  }
  return null
}

function adjustmentPreview(product: StockProductProjection, countedQuantity: string): string {
  try {
    const delta = parseNonNegativeQuantityToMilli(countedQuantity) - product.onHandMilli
    if (delta > 0) return `ปรับเพิ่ม ${formatQuantityMilli(delta)} ${product.unit}`
    if (delta < 0) return `ปรับลด ${formatQuantityMilli(Math.abs(delta))} ${product.unit}`
    return `ยอดตรงกัน 0 ${product.unit}`
  } catch {
    return ''
  }
}

function requiredText(value: string, maximum: number): string {
  const normalized = normalizeStockProductText(value)
  if (!normalized || normalized.length > maximum) throw new Error('STOCK_INVALID_PRODUCT')
  return normalized
}

function managerFailureMessage(error: unknown, fallback: string): string {
  const code = safeErrorCode(error)
  if (code === 'STOCK_MANAGER_REQUIRED') return 'บัญชีนี้ไม่มีสิทธิ์จัดการ Stock'
  if (code === 'STOCK_PRODUCT_NAME_EXISTS') return 'มีชื่อสินค้านี้อยู่แล้ว ข้อมูลที่กรอกยังอยู่ครบ'
  if (code === 'STOCK_PRODUCT_INACTIVE') return 'สินค้านี้ถูกปิดใช้งาน ข้อมูลที่กรอกยังอยู่ครบ'
  if (code === 'STOCK_UNIT_LOCKED') return 'เปลี่ยนหน่วยไม่ได้เพราะสินค้านี้มีประวัติ Stock แล้ว'
  return fallback
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
