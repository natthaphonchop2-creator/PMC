import { useEffect, useMemo, useState, type FormEvent, type InvalidEvent, type ReactNode } from 'react'
import type { OcrDirection, OcrDocumentType, OcrLineItem, OcrWarning } from './contracts'
import { initializeOcrLiff, loadOcrDraft, loadOcrImage, revokeOcrImage, submitOcrEdit } from './api'

export interface OcrReviewDraft {
  documentId: string
  state: string
  draftVersion: number
  imageUrl: string
  documentType: OcrDocumentType | null
  direction: OcrDirection | null
  documentDate: string | null
  documentTime: string | null
  counterpartyName: string | null
  currency: string | null
  subtotal: number | null
  discountAmount: number | null
  taxAmount: number | null
  serviceCharge: number | null
  grandTotal: number | null
  referenceNumber: string | null
  categoryId: string | null
  note: string | null
  warnings: OcrWarning[]
  lineItems: Array<Pick<OcrLineItem, 'lineNumber' | 'description' | 'quantity' | 'unit' | 'unitPrice' | 'discountAmount' | 'taxAmount' | 'lineTotal' | 'categoryId'>>
}

export type OcrEditablePatch = Omit<OcrReviewDraft, 'documentId' | 'state' | 'draftVersion' | 'imageUrl' | 'warnings'>

export interface OcrReviewAdapter {
  initialize(): Promise<string>
  loadDraft(rawIdToken: string): Promise<OcrReviewDraft>
  loadImage(rawIdToken: string): Promise<string>
  submitEdit(rawIdToken: string, patch: OcrEditablePatch): Promise<{ accepted: true; jobId: string }>
  revokeImage(url: string): void
}

const defaultAdapter: OcrReviewAdapter = {
  initialize: initializeOcrLiff,
  loadDraft: loadOcrDraft,
  loadImage: loadOcrImage,
  submitEdit: submitOcrEdit,
  revokeImage: revokeOcrImage,
}

export function OcrReviewApp({ adapter = defaultAdapter, initialDraft, initialImageUrl }: {
  adapter?: OcrReviewAdapter
  initialDraft?: OcrReviewDraft
  initialImageUrl?: string
}) {
  const [draft, setDraft] = useState<OcrReviewDraft | null>(initialDraft ?? null)
  const [imageUrl, setImageUrl] = useState(initialImageUrl ?? '')
  const [failure, setFailure] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [rawIdToken, setRawIdToken] = useState('')

  useEffect(() => {
    if (initialDraft) return
    let active = true
    void (async () => {
      try {
        const rawIdToken = await adapter.initialize()
        const [nextDraft, nextImageUrl] = await Promise.all([adapter.loadDraft(rawIdToken), adapter.loadImage(rawIdToken)])
        if (!active) {
          adapter.revokeImage(nextImageUrl)
          return
        }
        setRawIdToken(rawIdToken)
        setDraft(nextDraft)
        setImageUrl(nextImageUrl)
      } catch (error) {
        if (active) setFailure(reviewFailureMessage(error))
      }
    })()
    return () => { active = false }
  }, [adapter, initialDraft])

  useEffect(() => () => {
    if (imageUrl) adapter.revokeImage(imageUrl)
  }, [adapter, imageUrl])

  const formValues = useMemo(() => draft ? editablePatch(draft) : null, [draft])

  if (failure) return <ReviewNotice tone="error">{failure}</ReviewNotice>
  if (!formValues || !draft) return <ReviewNotice>กำลังเปิดเอกสารเพื่อตรวจสอบ</ReviewNotice>
  if (submitted) return <ReviewNotice tone="success">รับการแก้ไขเข้าคิวแล้ว ระบบจะตรวจเอกสารต่อ ไม่ได้ยืนยันเอกสารทันที</ReviewNotice>

  const fieldError = (name: string) => fieldErrors[name]
  const inputProps = (name: string) => ({
    'aria-describedby': `${name}-hint ${name}-error`,
    'aria-invalid': fieldError(name) ? true : undefined,
  })
  const update = <K extends keyof OcrEditablePatch>(key: K, value: OcrEditablePatch[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }
  const updateLine = (index: number, key: keyof OcrEditablePatch['lineItems'][number], value: string) => {
    setDraft((current) => {
      if (!current) return current
      const lineItems = current.lineItems.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: nullableInput(value, numericLineKeys.has(key)) } : line)
      return { ...current, lineItems }
    })
  }
  const onInvalid = (event: InvalidEvent<HTMLFormElement>) => {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (!element.name) return
    setFieldErrors((current) => ({ ...current, [element.name]: errorFor(element) }))
  }
  const onBlur = (event: FormEvent<HTMLFormElement>) => {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (!element.name) return
    setFieldErrors((current) => ({ ...current, [element.name]: element.validity.valid ? '' : errorFor(element) }))
  }
  const onInput = (event: FormEvent<HTMLFormElement>) => {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (!element.name || !fieldError(element.name)) return
    setFieldErrors((current) => ({ ...current, [element.name]: element.validity.valid ? '' : current[element.name] ?? '' }))
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      if (!rawIdToken) throw Object.assign(new Error('No LINE ID token'), { code: 'UNAUTHORIZED' })
      const response = await adapter.submitEdit(rawIdToken, editablePatch(draft))
      if (!response.accepted) throw new Error('queue failed')
      setSubmitted(true)
    } catch (error) {
      setFailure(reviewFailureMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="ocr-review-page">
    <header className="ocr-review-header">
      <p>ตรวจเอกสารก่อนบันทึก</p>
      <h1>{documentTypeLabel(draft.documentType)} · {directionLabel(draft.direction)}</h1>
      <span>เลขที่ {draft.documentId}</span>
    </header>
    <section className="ocr-review-preview" aria-label="ภาพเอกสารต้นฉบับ">
      {imageUrl ? <img src={imageUrl} alt="ภาพเอกสารต้นฉบับสำหรับตรวจสอบ" /> : <p>กำลังโหลดภาพเอกสาร</p>}
    </section>
    {draft.warnings.length > 0 && <section className="ocr-review-warnings" aria-labelledby="ocr-review-warnings-title">
      <h2 id="ocr-review-warnings-title">จุดที่ควรตรวจ</h2>
      <ul>{draft.warnings.map((warning) => <li key={`${warning.code}-${warning.field}`}>{warning.message}</li>)}</ul>
    </section>}
    <form className="ocr-review-form" onSubmit={submit} onInvalid={onInvalid} onBlur={onBlur} onInput={onInput}>
      <fieldset>
        <legend>ข้อมูลเอกสาร <span aria-hidden="true">*</span></legend>
        <div className="ocr-review-fields">
          <Field name="documentType" label="ประเภทเอกสาร" error={fieldError('documentType')}><select name="documentType" required value={draft.documentType ?? ''} onChange={(event) => update('documentType', event.target.value as OcrDocumentType)} {...inputProps('documentType')}><option value="">เลือกประเภท</option><option value="RECEIPT">ใบเสร็จ</option><option value="TRANSFER_SLIP">สลิปโอนเงิน</option></select></Field>
          <Field name="direction" label="ทิศทางรายการ" error={fieldError('direction')}><select name="direction" required value={draft.direction ?? ''} onChange={(event) => update('direction', event.target.value as OcrDirection)} {...inputProps('direction')}><option value="">เลือกทิศทาง</option><option value="EXPENSE">รายจ่าย</option><option value="INCOME">รายรับ</option></select></Field>
          <Field name="documentDate" label="วันที่เอกสาร" error={fieldError('documentDate')}><input name="documentDate" type="date" required value={draft.documentDate ?? ''} onChange={(event) => update('documentDate', event.target.value)} {...inputProps('documentDate')} /></Field>
          <Field name="categoryId" label="หมวดหมู่" error={fieldError('categoryId')}><input name="categoryId" type="text" required value={draft.categoryId ?? ''} onChange={(event) => update('categoryId', event.target.value)} {...inputProps('categoryId')} /></Field>
          <Field name="grandTotal" label="ยอดรวม" error={fieldError('grandTotal')}><input name="grandTotal" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required value={moneyText(draft.grandTotal)} onChange={(event) => update('grandTotal', nullableNumber(event.target.value) ?? Number.NaN)} {...inputProps('grandTotal')} /></Field>
          <Field name="counterpartyName" label="ชื่อร้าน / คู่ค้า"><input name="counterpartyName" type="text" value={draft.counterpartyName ?? ''} onChange={(event) => update('counterpartyName', nullableString(event.target.value))} /></Field>
          <Field name="referenceNumber" label="เลขอ้างอิง"><input name="referenceNumber" type="text" value={draft.referenceNumber ?? ''} onChange={(event) => update('referenceNumber', nullableString(event.target.value))} /></Field>
          <Field name="note" label="หมายเหตุ"><textarea name="note" value={draft.note ?? ''} onChange={(event) => update('note', nullableString(event.target.value))} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>รายการย่อย</legend>
        {draft.lineItems.map((line, index) => <section className="ocr-review-line" key={line.lineNumber} aria-label={`รายการ ${index + 1}`}>
          <div className="ocr-review-line-head"><h2>รายการ {index + 1}</h2><button type="button" aria-label={`ลบรายการ ${index + 1}`} onClick={() => update('lineItems', draft.lineItems.filter((_, lineIndex) => lineIndex !== index).map((item, lineIndex) => ({ ...item, lineNumber: lineIndex + 1 })))}>ลบ</button></div>
          <div className="ocr-review-fields"><Field name={`line-${index}-description`} label="รายละเอียด"><input name={`line-${index}-description`} value={line.description ?? ''} onChange={(event) => updateLine(index, 'description', event.target.value)} /></Field><Field name={`line-${index}-quantity`} label="จำนวน"><input name={`line-${index}-quantity`} inputMode="decimal" value={numberText(line.quantity)} onChange={(event) => updateLine(index, 'quantity', event.target.value)} /></Field><Field name={`line-${index}-lineTotal`} label="ยอดรายการ"><input name={`line-${index}-lineTotal`} inputMode="decimal" value={numberText(line.lineTotal)} onChange={(event) => updateLine(index, 'lineTotal', event.target.value)} /></Field></div>
        </section>)}
        <button className="ocr-review-add-line" type="button" aria-label="เพิ่มรายการ" onClick={() => update('lineItems', [...draft.lineItems, emptyLine(draft.lineItems.length + 1)])}>เพิ่มรายการ</button>
      </fieldset>
      <div className="ocr-review-submit"><p aria-live="polite">การส่งครั้งนี้จะเข้าคิวให้ตรวจต่อ ยังไม่ใช่การยืนยันเอกสาร</p><button type="submit" disabled={submitting}>{submitting ? 'กำลังส่งเข้าคิว…' : 'บันทึกการแก้ไขเข้าคิว'}</button></div>
    </form>
  </main>
}

function Field({ name, label, error, children }: { name: string; label: string; error?: string; children: ReactNode }) {
  return <div className="ocr-review-field"><label htmlFor={name}>{label}{['documentType', 'direction', 'documentDate', 'categoryId', 'grandTotal'].includes(name) && <span aria-hidden="true"> *</span>}</label><span id={`${name}-hint`} className="ocr-review-hint">ตรวจจากภาพต้นฉบับก่อนบันทึก</span>{children}<span id={`${name}-error`} className="ocr-review-error" aria-live="polite">{error}</span></div>
}

function ReviewNotice({ children, tone }: { children: ReactNode; tone?: 'error' | 'success' }) {
  return <main className={`ocr-review-notice ${tone ?? ''}`} aria-live="polite"><p>{children}</p></main>
}

function reviewFailureMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
  if (code === 'EXPIRED') return 'ลิงก์ตรวจสอบหมดอายุแล้ว กรุณาเปิดจากข้อความล่าสุดใน LINE'
  if (code === 'UNAUTHORIZED') return 'ไม่มีสิทธิ์เปิดเอกสารนี้ กรุณาเปิดจากกลุ่ม LINE ที่ได้รับอนุญาต'
  return 'เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
}

function editablePatch(draft: OcrReviewDraft): OcrEditablePatch {
  return {
    documentType: draft.documentType, direction: draft.direction, documentDate: draft.documentDate, documentTime: draft.documentTime,
    counterpartyName: draft.counterpartyName, currency: draft.currency, subtotal: draft.subtotal, discountAmount: draft.discountAmount,
    taxAmount: draft.taxAmount, serviceCharge: draft.serviceCharge, grandTotal: draft.grandTotal, referenceNumber: draft.referenceNumber,
    categoryId: draft.categoryId, note: draft.note, lineItems: draft.lineItems,
  }
}

const numericLineKeys = new Set<keyof OcrEditablePatch['lineItems'][number]>(['quantity', 'unitPrice', 'discountAmount', 'taxAmount', 'lineTotal'])

function nullableInput(value: string, numeric: boolean): string | number | null {
  if (!value.trim()) return null
  return numeric ? Number(value) : value
}

function nullableNumber(value: string): number | null { return nullableInput(value, true) as number | null }
function nullableString(value: string): string | null { return nullableInput(value, false) as string | null }

function numberText(value: number | null): string { return value === null || !Number.isFinite(value) ? '' : String(value) }
function moneyText(value: number | null): string { return value === null || !Number.isFinite(value) ? '' : value.toFixed(2) }
function errorFor(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string { return element.validity.valueMissing ? 'กรุณากรอกข้อมูลนี้' : 'กรุณาตรวจรูปแบบข้อมูล' }
function documentTypeLabel(value: OcrDocumentType | null): string { return value === 'RECEIPT' ? 'ใบเสร็จ' : value === 'TRANSFER_SLIP' ? 'สลิปโอนเงิน' : 'เอกสาร' }
function directionLabel(value: OcrDirection | null): string { return value === 'EXPENSE' ? 'รายจ่าย' : value === 'INCOME' ? 'รายรับ' : 'ยังไม่ระบุ' }
function emptyLine(lineNumber: number): OcrReviewDraft['lineItems'][number] { return { lineNumber, description: null, quantity: null, unit: null, unitPrice: null, discountAmount: null, taxAmount: null, lineTotal: null, categoryId: null } }
