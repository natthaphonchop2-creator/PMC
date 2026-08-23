import { useEffect, useRef, useState, type FormEvent, type InvalidEvent, type ReactNode } from 'react'
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
  senderName: string | null
  senderBank: string | null
  senderAccountMasked: string | null
  receiverName: string | null
  receiverBank: string | null
  receiverAccountMasked: string | null
  transferDate: string | null
  transferTime: string | null
  amount: number | null
  merchantName: string | null
  merchantTaxId: string | null
  branch: string | null
  receiptNumber: string | null
  receiptDate: string | null
  paymentMethod: string | null
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

type Line = OcrReviewDraft['lineItems'][number]
export function OcrReviewApp({ adapter = defaultAdapter, initialDraft, initialImageUrl }: {
  adapter?: OcrReviewAdapter
  initialDraft?: OcrReviewDraft
  initialImageUrl?: string
}) {
  const [draft, setDraft] = useState<OcrReviewDraft | null>(initialDraft ?? null)
  const [imageUrl, setImageUrl] = useState(initialImageUrl ?? '')
  const [loadFailure, setLoadFailure] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [numericTexts, setNumericTexts] = useState<Record<string, string>>({})
  const [rawIdToken, setRawIdToken] = useState('')
  const [rowIds, setRowIds] = useState<string[]>(() => initialDraft?.lineItems.map((_, index) => `initial-${index}`) ?? [])
  const nextRowId = useRef(0)
  const createRowId = () => `row-${++nextRowId.current}`

  useEffect(() => {
    if (initialDraft) return
    let active = true
    let ownedImageUrl: string | null = null
    const releaseOwnedImage = (url: string) => {
      if (ownedImageUrl === url) {
        adapter.revokeImage(url)
        ownedImageUrl = null
      }
    }
    void (async () => {
      try {
        const token = await adapter.initialize()
        const imagePromise = adapter.loadImage(token).then((url) => {
          if (!active) {
            adapter.revokeImage(url)
            return url
          }
          ownedImageUrl = url
          return url
        })
        const [draftResult, imageResult] = await Promise.allSettled([adapter.loadDraft(token), imagePromise])
        if (!active) {
          if (imageResult.status === 'fulfilled') releaseOwnedImage(imageResult.value)
          return
        }
        if (draftResult.status === 'fulfilled' && imageResult.status === 'fulfilled') {
          ownedImageUrl = null
          setRawIdToken(token)
          setRowIds(draftResult.value.lineItems.map(() => createRowId()))
          setDraft(draftResult.value)
          setImageUrl(imageResult.value)
          return
        }
        if (imageResult.status === 'fulfilled') releaseOwnedImage(imageResult.value)
        setLoadFailure(reviewFailureMessage(draftResult.status === 'rejected' ? draftResult.reason : imageResult.status === 'rejected' ? imageResult.reason : undefined))
      } catch (error) {
        if (active) setLoadFailure(reviewFailureMessage(error))
      }
    })()
    return () => {
      active = false
      if (ownedImageUrl) releaseOwnedImage(ownedImageUrl)
    }
  }, [adapter, initialDraft])

  useEffect(() => () => {
    if (imageUrl) adapter.revokeImage(imageUrl)
  }, [adapter, imageUrl])

  if (loadFailure) return <ReviewNotice tone="error">{loadFailure}</ReviewNotice>
  if (!draft) return <ReviewNotice>กำลังเปิดเอกสารเพื่อตรวจสอบ</ReviewNotice>
  if (submitted) return <ReviewNotice tone="success">รับการแก้ไขเข้าคิวแล้ว ระบบจะตรวจเอกสารต่อ ไม่ได้ยืนยันเอกสารทันที</ReviewNotice>

  const fieldError = (name: string) => fieldErrors[name]
  const inputProps = (name: string) => ({
    'aria-describedby': `${name}-hint ${name}-error`,
    'aria-invalid': fieldError(name) ? true : undefined,
  })
  const update = <K extends keyof OcrEditablePatch>(key: K, value: OcrEditablePatch[K]) => {
    setSaveError(null)
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }
  const updateDocumentType = (documentType: OcrDocumentType) => {
    setSaveError(null)
    setDraft((current) => current ? documentType === 'TRANSFER_SLIP'
      ? {
          ...current, documentType, lineItems: [], merchantName: null, merchantTaxId: null, branch: null,
          receiptNumber: null, receiptDate: null, paymentMethod: null,
        }
      : {
          ...current, documentType, senderName: null, senderBank: null, senderAccountMasked: null,
          receiverName: null, receiverBank: null, receiverAccountMasked: null, transferDate: null,
          transferTime: null, amount: null,
        } : current)
    if (documentType === 'TRANSFER_SLIP') {
      setRowIds([])
      setNumericTexts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('line:'))))
    } else {
      setNumericTexts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'amount')))
    }
  }
  const updateLineText = (index: number, key: 'description' | 'unit' | 'categoryId', value: string) => {
    setSaveError(null)
    setDraft((current) => {
      if (!current) return current
      const lineItems = current.lineItems.map((line, lineIndex) => {
        if (lineIndex !== index) return line
        const next = { ...line }
        next[key] = nullableString(value)
        return next
      })
      return { ...current, lineItems }
    })
  }
  const updateNumeric = (name: string, value: string) => {
    setSaveError(null)
    setNumericTexts((current) => ({ ...current, [name]: value }))
  }
  const numberValue = (name: string, value: number | null) => numericTexts[name] ?? numberText(value)
  const removeLine = (index: number) => {
    const rowId = rowIds[index]
    setSaveError(null)
    setDraft((current) => current ? { ...current, lineItems: current.lineItems.filter((_, lineIndex) => lineIndex !== index) } : current)
    setRowIds((current) => current.filter((_, lineIndex) => lineIndex !== index))
    if (rowId) setNumericTexts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`line:${rowId}:`))))
  }
  const addLine = () => {
    setSaveError(null)
    setDraft((current) => current ? { ...current, lineItems: [...current.lineItems, emptyLine()] } : current)
    setRowIds((current) => [...current, createRowId()])
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
    setSaveError(null)
    try {
      if (!rawIdToken) throw Object.assign(new Error('No LINE ID token'), { code: 'UNAUTHORIZED' })
      const response = await adapter.submitEdit(rawIdToken, editablePatch(draft, numericTexts, rowIds))
      if (!response.accepted) throw new Error('queue failed')
      setSubmitted(true)
    } catch {
      setSaveError('บันทึกการแก้ไขไม่สำเร็จ กรุณาลองส่งอีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="ocr-review-page">
    <header className="ocr-review-header"><p>ตรวจเอกสารก่อนบันทึก</p><h1>{documentTypeLabel(draft.documentType)} · {directionLabel(draft.direction)}</h1><span>เลขที่ {draft.documentId}</span></header>
    <section className="ocr-review-preview" aria-label="ภาพเอกสารต้นฉบับ">{imageUrl ? <img src={imageUrl} alt="ภาพเอกสารต้นฉบับสำหรับตรวจสอบ" /> : <p>กำลังโหลดภาพเอกสาร</p>}</section>
    {draft.warnings.length > 0 && <section className="ocr-review-warnings" aria-labelledby="ocr-review-warnings-title"><h2 id="ocr-review-warnings-title">จุดที่ควรตรวจ</h2><ul>{draft.warnings.map((warning) => <li key={`${warning.code}-${warning.field}`}>{warning.message}</li>)}</ul></section>}
    <form className="ocr-review-form" onSubmit={submit} onInvalid={onInvalid} onBlur={onBlur} onInput={onInput}>
      <fieldset><legend>ข้อมูลเอกสาร <span aria-hidden="true">*</span></legend><div className="ocr-review-fields">
        <Field name="documentType" label="ประเภทเอกสาร" error={fieldError('documentType')} required><select id="documentType" name="documentType" required value={draft.documentType ?? ''} onChange={(event) => updateDocumentType(event.target.value as OcrDocumentType)} {...inputProps('documentType')}><option value="">เลือกประเภท</option><option value="RECEIPT">ใบเสร็จ</option><option value="TRANSFER_SLIP">สลิปโอนเงิน</option></select></Field>
        <Field name="direction" label="ทิศทางรายการ" error={fieldError('direction')} required><select id="direction" name="direction" required value={draft.direction ?? ''} onChange={(event) => update('direction', event.target.value as OcrDirection)} {...inputProps('direction')}><option value="">เลือกทิศทาง</option><option value="EXPENSE">รายจ่าย</option><option value="INCOME">รายรับ</option></select></Field>
        <Field name="documentDate" label="วันที่เอกสาร" error={fieldError('documentDate')} required><input id="documentDate" name="documentDate" type="date" required value={draft.documentDate ?? ''} onChange={(event) => update('documentDate', event.target.value)} {...inputProps('documentDate')} /></Field>
        <Field name="documentTime" label="เวลาเอกสาร"><input id="documentTime" name="documentTime" type="time" value={draft.documentTime ?? ''} onChange={(event) => update('documentTime', nullableString(event.target.value))} /></Field>
        <Field name="categoryId" label="หมวดหมู่" error={fieldError('categoryId')} required><input id="categoryId" name="categoryId" type="text" required value={draft.categoryId ?? ''} onChange={(event) => update('categoryId', event.target.value)} {...inputProps('categoryId')} /></Field>
        <Field name="currency" label="สกุลเงิน"><input id="currency" name="currency" type="text" value={draft.currency ?? ''} onChange={(event) => update('currency', nullableString(event.target.value))} /></Field>
        <NumberField name="subtotal" label="ยอดก่อนลด" value={numberValue('subtotal', draft.subtotal)} onChange={updateNumeric} />
        <NumberField name="discountAmount" label="ส่วนลด" value={numberValue('discountAmount', draft.discountAmount)} onChange={updateNumeric} />
        <NumberField name="taxAmount" label="ภาษี" value={numberValue('taxAmount', draft.taxAmount)} onChange={updateNumeric} />
        <NumberField name="serviceCharge" label="ค่าบริการ" value={numberValue('serviceCharge', draft.serviceCharge)} onChange={updateNumeric} />
        <NumberField name="grandTotal" label="ยอดรวม" value={numberValue('grandTotal', draft.grandTotal)} onChange={updateNumeric} error={fieldError('grandTotal')} required inputProps={inputProps('grandTotal')} />
        <Field name="counterpartyName" label="ชื่อร้าน / คู่ค้า"><input id="counterpartyName" name="counterpartyName" type="text" value={draft.counterpartyName ?? ''} onChange={(event) => update('counterpartyName', nullableString(event.target.value))} /></Field>
        <Field name="referenceNumber" label="เลขอ้างอิง"><input id="referenceNumber" name="referenceNumber" type="text" value={draft.referenceNumber ?? ''} onChange={(event) => update('referenceNumber', nullableString(event.target.value))} /></Field>
        <Field name="note" label="หมายเหตุ"><textarea id="note" name="note" value={draft.note ?? ''} onChange={(event) => update('note', nullableString(event.target.value))} /></Field>
      </div></fieldset>
      {draft.documentType === 'TRANSFER_SLIP' && <fieldset><legend>ข้อมูลการโอน</legend><div className="ocr-review-fields">
        <Field name="senderName" label="ชื่อผู้โอน"><input id="senderName" name="senderName" type="text" value={draft.senderName ?? ''} onChange={(event) => update('senderName', nullableString(event.target.value))} /></Field>
        <Field name="senderBank" label="ธนาคารผู้โอน"><input id="senderBank" name="senderBank" type="text" value={draft.senderBank ?? ''} onChange={(event) => update('senderBank', nullableString(event.target.value))} /></Field>
        <Field name="senderAccountMasked" label="บัญชีผู้โอน"><input id="senderAccountMasked" name="senderAccountMasked" type="text" value={draft.senderAccountMasked ?? ''} onChange={(event) => update('senderAccountMasked', nullableString(event.target.value))} /></Field>
        <Field name="receiverName" label="ชื่อผู้รับ"><input id="receiverName" name="receiverName" type="text" value={draft.receiverName ?? ''} onChange={(event) => update('receiverName', nullableString(event.target.value))} /></Field>
        <Field name="receiverBank" label="ธนาคารผู้รับ"><input id="receiverBank" name="receiverBank" type="text" value={draft.receiverBank ?? ''} onChange={(event) => update('receiverBank', nullableString(event.target.value))} /></Field>
        <Field name="receiverAccountMasked" label="บัญชีผู้รับ"><input id="receiverAccountMasked" name="receiverAccountMasked" type="text" value={draft.receiverAccountMasked ?? ''} onChange={(event) => update('receiverAccountMasked', nullableString(event.target.value))} /></Field>
        <Field name="transferDate" label="วันที่โอน"><input id="transferDate" name="transferDate" type="date" value={draft.transferDate ?? ''} onChange={(event) => update('transferDate', nullableString(event.target.value))} /></Field>
        <Field name="transferTime" label="เวลาโอน"><input id="transferTime" name="transferTime" type="time" value={draft.transferTime ?? ''} onChange={(event) => update('transferTime', nullableString(event.target.value))} /></Field>
        <NumberField name="amount" label="ยอดโอน" value={numberValue('amount', draft.amount)} onChange={updateNumeric} />
      </div></fieldset>}
      {draft.documentType === 'RECEIPT' && <fieldset><legend>ข้อมูลใบเสร็จ</legend><div className="ocr-review-fields">
        <Field name="merchantName" label="ชื่อร้านค้า"><input id="merchantName" name="merchantName" type="text" value={draft.merchantName ?? ''} onChange={(event) => update('merchantName', nullableString(event.target.value))} /></Field>
        <Field name="merchantTaxId" label="เลขประจำตัวผู้เสียภาษี"><input id="merchantTaxId" name="merchantTaxId" type="text" inputMode="numeric" value={draft.merchantTaxId ?? ''} onChange={(event) => update('merchantTaxId', nullableString(event.target.value))} /></Field>
        <Field name="branch" label="สาขา"><input id="branch" name="branch" type="text" value={draft.branch ?? ''} onChange={(event) => update('branch', nullableString(event.target.value))} /></Field>
        <Field name="receiptNumber" label="เลขที่ใบเสร็จ"><input id="receiptNumber" name="receiptNumber" type="text" value={draft.receiptNumber ?? ''} onChange={(event) => update('receiptNumber', nullableString(event.target.value))} /></Field>
        <Field name="receiptDate" label="วันที่ใบเสร็จ"><input id="receiptDate" name="receiptDate" type="date" value={draft.receiptDate ?? ''} onChange={(event) => update('receiptDate', nullableString(event.target.value))} /></Field>
        <Field name="paymentMethod" label="วิธีชำระเงิน"><input id="paymentMethod" name="paymentMethod" type="text" value={draft.paymentMethod ?? ''} onChange={(event) => update('paymentMethod', nullableString(event.target.value))} /></Field>
      </div></fieldset>}
      {draft.documentType === 'RECEIPT' && <fieldset><legend>รายการย่อย</legend>
        {draft.lineItems.map((line, index) => {
          const rowId = rowIds[index] ?? `initial-${index}`
          return <section className="ocr-review-line" key={rowId} aria-label={`รายการ ${index + 1}`}><div className="ocr-review-line-head"><h2>รายการ {index + 1}</h2><button type="button" aria-label={`ลบรายการ ${index + 1}`} onClick={() => removeLine(index)}>ลบ</button></div><div className="ocr-review-fields">
          <Field name={`line-${index}-description`} label="รายละเอียด"><input id={`line-${index}-description`} name={`line-${index}-description`} value={line.description ?? ''} onChange={(event) => updateLineText(index, 'description', event.target.value)} /></Field>
          <NumberField name={`line-${index}-quantity`} stateName={lineNumericKey(rowId, 'quantity')} label="จำนวน" value={numberValue(lineNumericKey(rowId, 'quantity'), line.quantity)} onChange={updateNumeric} />
          <Field name={`line-${index}-unit`} label="หน่วย"><input id={`line-${index}-unit`} name={`line-${index}-unit`} value={line.unit ?? ''} onChange={(event) => updateLineText(index, 'unit', event.target.value)} /></Field>
          <NumberField name={`line-${index}-unitPrice`} stateName={lineNumericKey(rowId, 'unitPrice')} label="ราคาต่อหน่วย" value={numberValue(lineNumericKey(rowId, 'unitPrice'), line.unitPrice)} onChange={updateNumeric} />
          <NumberField name={`line-${index}-discountAmount`} stateName={lineNumericKey(rowId, 'discountAmount')} label="ส่วนลดรายการ" value={numberValue(lineNumericKey(rowId, 'discountAmount'), line.discountAmount)} onChange={updateNumeric} />
          <NumberField name={`line-${index}-taxAmount`} stateName={lineNumericKey(rowId, 'taxAmount')} label="ภาษีรายการ" value={numberValue(lineNumericKey(rowId, 'taxAmount'), line.taxAmount)} onChange={updateNumeric} />
          <NumberField name={`line-${index}-lineTotal`} stateName={lineNumericKey(rowId, 'lineTotal')} label="ยอดรายการ" value={numberValue(lineNumericKey(rowId, 'lineTotal'), line.lineTotal)} onChange={updateNumeric} />
          <Field name={`line-${index}-categoryId`} label="หมวดหมู่รายการ"><input id={`line-${index}-categoryId`} name={`line-${index}-categoryId`} value={line.categoryId ?? ''} onChange={(event) => updateLineText(index, 'categoryId', event.target.value)} /></Field>
        </div></section>
        })}
        <button className="ocr-review-add-line" type="button" aria-label="เพิ่มรายการ" onClick={addLine}>เพิ่มรายการ</button>
      </fieldset>}
      <div className="ocr-review-submit">{saveError && <p className="ocr-review-save-error" role="alert">{saveError}</p>}<p aria-live="polite">การส่งครั้งนี้จะเข้าคิวให้ตรวจต่อ ยังไม่ใช่การยืนยันเอกสาร</p><button type="submit" disabled={submitting}>{submitting ? 'กำลังส่งเข้าคิว…' : 'บันทึกการแก้ไขเข้าคิว'}</button></div>
    </form>
  </main>
}

function Field({ name, label, error, required, children }: { name: string; label: string; error?: string; required?: boolean; children: ReactNode }) {
  return <div className="ocr-review-field"><label htmlFor={name}>{label}{required && <span aria-hidden="true"> *</span>}</label><span id={`${name}-hint`} className="ocr-review-hint">ตรวจจากภาพต้นฉบับก่อนบันทึก</span>{children}<span id={`${name}-error`} className="ocr-review-error" aria-live="polite">{error}</span></div>
}

function NumberField({ name, stateName, label, value, onChange, error, required, inputProps }: { name: string; stateName?: string; label: string; value: string; onChange: (name: string, value: string) => void; error?: string; required?: boolean; inputProps?: Record<string, string | boolean | undefined> }) {
  return <Field name={name} label={label} error={error} required={required}><input id={name} name={name} type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required={required} value={value} onChange={(event) => onChange(stateName ?? name, event.target.value)} {...inputProps} /></Field>
}

function ReviewNotice({ children, tone }: { children: ReactNode; tone?: 'error' | 'success' }) { return <main className={`ocr-review-notice ${tone ?? ''}`} aria-live="polite"><p>{children}</p></main> }
function reviewFailureMessage(error: unknown): string { const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined; if (code === 'EXPIRED') return 'ลิงก์ตรวจสอบหมดอายุแล้ว กรุณาเปิดจากข้อความล่าสุดใน LINE'; if (code === 'UNAUTHORIZED') return 'ไม่มีสิทธิ์เปิดเอกสารนี้ กรุณาเปิดจากกลุ่ม LINE ที่ได้รับอนุญาต'; return 'เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }

function editablePatch(draft: OcrReviewDraft, numericTexts: Record<string, string>, rowIds: string[]): OcrEditablePatch {
  return { documentType: draft.documentType, direction: draft.direction, documentDate: draft.documentDate, documentTime: draft.documentTime, counterpartyName: draft.counterpartyName, currency: draft.currency, subtotal: parseNumeric('subtotal', draft.subtotal, numericTexts), discountAmount: parseNumeric('discountAmount', draft.discountAmount, numericTexts), taxAmount: parseNumeric('taxAmount', draft.taxAmount, numericTexts), serviceCharge: parseNumeric('serviceCharge', draft.serviceCharge, numericTexts), grandTotal: parseNumeric('grandTotal', draft.grandTotal, numericTexts), referenceNumber: draft.referenceNumber, categoryId: draft.categoryId, note: draft.note, senderName: draft.senderName, senderBank: draft.senderBank, senderAccountMasked: draft.senderAccountMasked, receiverName: draft.receiverName, receiverBank: draft.receiverBank, receiverAccountMasked: draft.receiverAccountMasked, transferDate: draft.transferDate, transferTime: draft.transferTime, amount: parseNumeric('amount', draft.amount, numericTexts), merchantName: draft.merchantName, merchantTaxId: draft.merchantTaxId, branch: draft.branch, receiptNumber: draft.receiptNumber, receiptDate: draft.receiptDate, paymentMethod: draft.paymentMethod, lineItems: draft.lineItems.map((line, index) => {
    const rowId = rowIds[index] ?? `initial-${index}`
    return { ...line, lineNumber: index + 1, quantity: parseNumeric(lineNumericKey(rowId, 'quantity'), line.quantity, numericTexts), unitPrice: parseNumeric(lineNumericKey(rowId, 'unitPrice'), line.unitPrice, numericTexts), discountAmount: parseNumeric(lineNumericKey(rowId, 'discountAmount'), line.discountAmount, numericTexts), taxAmount: parseNumeric(lineNumericKey(rowId, 'taxAmount'), line.taxAmount, numericTexts), lineTotal: parseNumeric(lineNumericKey(rowId, 'lineTotal'), line.lineTotal, numericTexts) }
  }) }
}

function parseNumeric(name: string, fallback: number | null, values: Record<string, string>): number | null { const value = values[name]; if (value === undefined) return fallback; return value.trim() ? Number(value) : null }
function lineNumericKey(rowId: string, field: 'quantity' | 'unitPrice' | 'discountAmount' | 'taxAmount' | 'lineTotal'): string { return `line:${rowId}:${field}` }
function nullableString(value: string): string | null { return value.trim() ? value : null }
function numberText(value: number | null): string { return value === null || !Number.isFinite(value) ? '' : String(value) }
function errorFor(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string { return element.validity.valueMissing ? 'กรุณากรอกข้อมูลนี้' : 'กรุณาตรวจรูปแบบข้อมูล' }
function documentTypeLabel(value: OcrDocumentType | null): string { return value === 'RECEIPT' ? 'ใบเสร็จ' : value === 'TRANSFER_SLIP' ? 'สลิปโอนเงิน' : 'เอกสาร' }
function directionLabel(value: OcrDirection | null): string { return value === 'EXPENSE' ? 'รายจ่าย' : value === 'INCOME' ? 'รายรับ' : 'ยังไม่ระบุ' }
function emptyLine(): Line { return { lineNumber: 0, description: null, quantity: null, unit: null, unitPrice: null, discountAmount: null, taxAmount: null, lineTotal: null, categoryId: null } }
