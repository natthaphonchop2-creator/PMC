import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, X } from 'lucide-react'
import type { EnabledExpenseCategory, ExpensePaymentMethod, ExpenseReceipt } from '../../../../shared/pmcExpense'
import type { ExpenseResumeStatus } from '../../../../shared/pmcMiniAppExpenseIngress'
import type { ExpenseAsyncAck } from '../../../../shared/pmcExpenseAsync'
import { BrandMark } from '../BrandMark'
import { normalizeExpenseUploadFiles } from './expenseImageNormalizer'
import {
  expenseCategoryLabel,
  expenseFileFingerprint,
  expensePaymentLabel,
  formatExpenseSatang,
  isExpenseStagingToken,
  parseExpenseAmountSatang,
  validateExpenseFiles,
  validateExpenseValues,
  type ExpenseFormErrors,
  type ExpenseFormValues,
} from './expenseModel'

export interface ExpenseFormAdapter {
  stage(rootRequestId: string, files: File[]): Promise<{ stagingTokens: string[] }>
  submit(input: {
    rootRequestId: string
    category: EnabledExpenseCategory
    expenseDate: string
    amountSatang: number
    counterpartyName: string | null
    description: string
    paymentMethod: ExpensePaymentMethod | null
    expectedRevision: number
    stagingTokens: string[]
  }): Promise<ExpenseReceipt | ExpenseAsyncAck>
  resume(rootRequestId: string): Promise<ExpenseResumeStatus>
}

interface ExpenseFileItem {
  id: number
  file: File
  previewUrl: string
}

export function ExpenseForm({
  category,
  adapter,
  expectedRevision = 0,
  lockedExpenseDate,
  normalizeFiles = normalizeExpenseUploadFiles,
  onCommitted,
  onAccepted,
  onStopTrackingPrepared,
  onBack,
}: {
  category: EnabledExpenseCategory
  adapter: ExpenseFormAdapter
  expectedRevision?: number
  lockedExpenseDate?: string
  normalizeFiles?: (files: File[]) => Promise<File[]>
  onCommitted: (receipt: ExpenseReceipt) => void
  onAccepted?: (acknowledgement: ExpenseAsyncAck) => void
  onStopTrackingPrepared: () => void
  onBack: () => void
}) {
  const [values, setValues] = useState<ExpenseFormValues>(() => ({
    expenseDate: lockedExpenseDate ?? currentBangkokDate(), amount: '', counterpartyName: '', paymentMethod: '', description: '',
  }))
  const [items, setItems] = useState<ExpenseFileItem[]>([])
  const [errors, setErrors] = useState<ExpenseFormErrors>({})
  const [reviewing, setReviewing] = useState(false)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [convertingFiles, setConvertingFiles] = useState(false)
  const [resumeStatus, setResumeStatus] = useState<'PENDING' | 'PREPARED' | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [initialRootRequestId] = useState(() => globalThis.crypto.randomUUID())
  const rootRequestIdRef = useRef(initialRootRequestId)
  const stagedRef = useRef<{ fingerprint: string; stagingTokens: string[] } | null>(null)
  const itemsRef = useRef(items)
  const busyRef = useRef(false)
  const itemSequenceRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => {
    for (const item of itemsRef.current) revokePreview(item.previewUrl)
  }, [])

  const update = (field: keyof ExpenseFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => current[field] ? { ...current, [field]: '' } : current)
    setFailure('')
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    const currentFiles = items.map(({ file }) => file)
    const fileError = validateExpenseFiles([...currentFiles, ...files])
    if (fileError) {
      setErrors((current) => ({ ...current, files: fileError }))
      return
    }
    setConvertingFiles(true)
    setFailure('')
    try {
      const normalized = await normalizeFiles(files)
      if (normalized.length !== files.length) throw new Error('EXPENSE_IMAGE_CONVERSION_FAILED')
      const normalizedError = validateExpenseFiles([...currentFiles, ...normalized])
      if (normalizedError) {
        setErrors((current) => ({ ...current, files: normalizedError }))
        return
      }
      const added = normalized.map((file): ExpenseFileItem => ({
        id: ++itemSequenceRef.current,
        file,
        previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
      }))
      stagedRef.current = null
      setItems((current) => [...current, ...added])
      setErrors((current) => ({ ...current, files: '' }))
    } catch {
      setErrors((current) => ({
        ...current,
        files: 'แปลงรูป HEIC หรือ WebP ไม่สำเร็จ กรุณาจับภาพหน้าจอแล้วแนบใหม่',
      }))
    } finally {
      setConvertingFiles(false)
    }
  }

  const removeFile = (id: number) => {
    const item = items.find((candidate) => candidate.id === id)
    if (item) revokePreview(item.previewUrl)
    stagedRef.current = null
    setItems((current) => current.filter((candidate) => candidate.id !== id))
    setFailure('')
  }

  const moveFile = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= items.length) return
    stagedRef.current = null
    setItems((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item!)
      return next
    })
    setFailure('')
  }

  const openReview = (event: FormEvent) => {
    event.preventDefault()
    if (convertingFiles) return
    const nextErrors = validateExpenseValues(category, values)
    const fileError = validateExpenseFiles(items.map(({ file }) => file))
    if (fileError) nextErrors.files = fileError
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(nextErrors, fileInputRef.current)
      return
    }
    setFailure('')
    setReviewing(true)
  }

  const rotateRootRequest = () => {
    rootRequestIdRef.current = globalThis.crypto.randomUUID()
    stagedRef.current = null
  }

  const checkResume = async () => {
    if (resumeBusy) return
    setResumeStatus('PENDING')
    setResumeBusy(true)
    try {
      const status = await adapter.resume(rootRequestIdRef.current)
      if (status.status === 'COMMITTED') {
        setResumeStatus(null)
        onCommitted(status.receipt)
        return
      }
      if (status.status === 'PREPARED' || status.status === 'PENDING') {
        setResumeStatus(status.status)
        setReviewing(true)
        return
      }
      if (status.status === 'FAILED' && status.error === 'EXPENSE_STORAGE_UNAVAILABLE') {
        setResumeStatus('PENDING')
        setReviewing(true)
        return
      }
      rotateRootRequest()
      setResumeStatus(null)
      setReviewing(false)
      setFailure(status.status === 'FAILED'
        ? 'รายการเดิมสิ้นสุดแล้ว กรุณาตรวจข้อมูลและเริ่มบันทึกใหม่'
        : 'ไม่พบรายการที่บันทึกค้างอยู่ กรุณาตรวจข้อมูลและยืนยันใหม่')
    } catch (error) {
      if (!ambiguousExpenseResult(error)) {
        rotateRootRequest()
        setResumeStatus(null)
        setReviewing(false)
        setFailure(expenseFailureMessage(error))
      } else {
        setResumeStatus('PENDING')
        setReviewing(true)
        setFailure('')
      }
    } finally {
      setResumeBusy(false)
    }
  }

  const confirm = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailure('')
    const files = items.map(({ file }) => file)
    const fingerprint = expenseFileFingerprint(files)
    try {
      let staged = stagedRef.current
      if (!staged || staged.fingerprint !== fingerprint) {
        const result = await adapter.stage(rootRequestIdRef.current, files)
        if (!validStagingTokens(result.stagingTokens, files.length)) throw safeClientError()
        staged = { fingerprint, stagingTokens: [...result.stagingTokens] }
        stagedRef.current = staged
      }
      const amountSatang = parseExpenseAmountSatang(values.amount)
      if (amountSatang === null) throw safeClientError()
      const paymentMethod = category === 'BILL_DOCUMENT' ? values.paymentMethod as ExpensePaymentMethod : null
      const result = await adapter.submit({
        rootRequestId: rootRequestIdRef.current,
        category,
        expenseDate: values.expenseDate,
        amountSatang,
        counterpartyName: category === 'BILL_DOCUMENT' ? values.counterpartyName.trim() : null,
        description: values.description.trim(),
        paymentMethod,
        expectedRevision,
        stagingTokens: [...staged.stagingTokens],
      })
      if (isExpenseAsyncAcknowledgement(result)) {
        if (result.rootRequestId !== rootRequestIdRef.current) throw safeClientError()
        onAccepted?.(result)
        return
      }
      if (result.recordState !== 'COMMITTED' || result.unreviewed !== true) throw safeClientError()
      onCommitted(result)
    } catch (error) {
      if (requiresFreshExpenseStaging(error)) stagedRef.current = null
      if (ambiguousExpenseResult(error)) {
        setResumeStatus('PENDING')
        setReviewing(true)
        setFailure('')
        await checkResume()
      } else {
        rotateRootRequest()
        setFailure(expenseFailureMessage(error))
        setReviewing(false)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return <main className="pmc-expense-page">
    <header className="pmc-expense-header">
      <button type="button" aria-label="ย้อนกลับ" disabled={busy || resumeStatus !== null || convertingFiles} onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      <BrandMark compact />
      <div><p>จัดเก็บรายจ่าย</p><span>{expenseCategoryLabel(category)}</span></div>
    </header>

    {reviewing
      ? <>
        <ExpenseReview category={category} values={values} files={items.map(({ file }) => file)} />
        {resumeStatus === 'PREPARED'
          ? <p className="pmc-expense-alert" role="status">รายการเดิมยังคงอยู่ฝั่งระบบเพื่อการตรวจสอบ แต่สถานะ PREPARED ยังไม่ถูกนับเป็นรายจ่าย</p>
          : resumeStatus === 'PENDING'
            ? <p className="pmc-expense-alert" role="status">กำลังตรวจสอบสถานะรายการที่บันทึก</p>
            : null}
      </>
      : <form className="pmc-expense-form" onSubmit={openReview} noValidate>
        <div className="pmc-expense-heading">
          <h1>{expenseCategoryLabel(category)}</h1>
          <p>{category === 'BILL_DOCUMENT' ? 'กรอกรายละเอียดและแนบรูปเอกสาร' : 'กรอกยอดรวมของวันและแนบรูปหน้าสมุด'}</p>
        </div>
        <Field id="expense-date" label="วันที่รายจ่าย" error={errors.expenseDate}>
          <input id="expense-date" name="expenseDate" type="date" value={values.expenseDate} required readOnly={Boolean(lockedExpenseDate)}
            aria-invalid={Boolean(errors.expenseDate)} aria-describedby={errors.expenseDate ? 'expense-date-error' : undefined}
            onChange={(event) => { if (!lockedExpenseDate) update('expenseDate', event.target.value) }} />
        </Field>
        <Field id="expense-amount" label={category === 'BILL_DOCUMENT' ? 'จำนวนเงิน' : 'ยอดรวมรายวัน'} error={errors.amount}>
          <input id="expense-amount" name="amount" type="text" inputMode="decimal" value={values.amount} required
            aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'expense-amount-error' : undefined}
            onChange={(event) => update('amount', event.target.value)} />
        </Field>
        {category === 'BILL_DOCUMENT' && <>
          <Field id="expense-counterparty" label="ชื่อร้านหรือผู้รับเงิน" error={errors.counterpartyName}>
            <input id="expense-counterparty" name="counterpartyName" type="text" value={values.counterpartyName} required maxLength={160}
              aria-invalid={Boolean(errors.counterpartyName)} aria-describedby={errors.counterpartyName ? 'expense-counterparty-error' : undefined}
              onChange={(event) => update('counterpartyName', event.target.value)} />
          </Field>
          <Field id="expense-payment" label="วิธีชำระ" error={errors.paymentMethod}>
            <select id="expense-payment" name="paymentMethod" value={values.paymentMethod} required
              aria-invalid={Boolean(errors.paymentMethod)} aria-describedby={errors.paymentMethod ? 'expense-payment-error' : undefined}
              onChange={(event) => update('paymentMethod', event.target.value)}>
              <option value="">เลือกวิธีชำระ</option>
              <option value="TRANSFER">โอนเงิน</option>
              <option value="CASH">เงินสด</option>
              <option value="CREDIT">บัตรเครดิต</option>
              <option value="OTHER">อื่น ๆ</option>
            </select>
          </Field>
        </>}
        <Field id="expense-description" label="หมายเหตุ (ไม่บังคับ)" error={errors.description}>
          <textarea id="expense-description" name="description" value={values.description} maxLength={500}
            aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'expense-description-error' : undefined}
            onChange={(event) => update('description', event.target.value)} />
        </Field>

        <section className="pmc-expense-evidence" aria-busy={convertingFiles || undefined}>
          <div>
            <h2 id="expense-evidence-heading">รูปหลักฐาน</h2>
            <span>เลือกแล้ว {items.length} รูป</span>
          </div>
          <label className="pmc-expense-add-file" htmlFor="expense-files">
            <ImagePlus aria-hidden="true" /> <span aria-live="polite">{convertingFiles ? 'กำลังแปลงรูป' : 'เพิ่มรูป'}</span>
            <input ref={fileInputRef} id="expense-files" className="pmc-visually-hidden" aria-label="รูปหลักฐาน" type="file" multiple
              disabled={convertingFiles}
              aria-invalid={Boolean(errors.files)} aria-describedby={errors.files ? 'expense-files-error' : undefined}
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(event) => { void addFiles(event) }} />
          </label>
          {errors.files && <p id="expense-files-error" className="pmc-expense-error" role="alert">{errors.files}</p>}
          {items.length > 0 && <ol className="pmc-expense-file-list">
            {items.map((item, index) => <li key={item.id}>
              {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="pmc-expense-file-placeholder"><ImagePlus aria-hidden="true" /></span>}
              <p>{item.file.name}</p>
              <div>
                <button type="button" aria-label={`เลื่อนรูปที่ ${index + 1} ${item.file.name} ขึ้น`} disabled={convertingFiles || index === 0} onClick={() => moveFile(index, -1)}><ArrowUp aria-hidden="true" /></button>
                <button type="button" aria-label={`เลื่อนรูปที่ ${index + 1} ${item.file.name} ลง`} disabled={convertingFiles || index === items.length - 1} onClick={() => moveFile(index, 1)}><ArrowDown aria-hidden="true" /></button>
                <button type="button" aria-label={`ลบรูปที่ ${index + 1} ${item.file.name}`} disabled={convertingFiles} onClick={() => removeFile(item.id)}><X aria-hidden="true" /></button>
              </div>
            </li>)}
          </ol>}
        </section>

        {failure && <p className="pmc-expense-alert" role="alert">{failure}</p>}
        <footer className="pmc-expense-footer"><button type="submit" disabled={busy || convertingFiles}>{convertingFiles ? 'กำลังแปลงรูป' : 'ตรวจสอบข้อมูล'}</button></footer>
      </form>}

    {reviewing && <footer className="pmc-expense-footer review">
      {resumeStatus !== null
        ? <>
          <button type="button" disabled={busy || resumeBusy} onClick={() => { void checkResume() }}>
            {resumeBusy ? 'กำลังตรวจสอบ' : 'ตรวจสอบสถานะอีกครั้ง'}
          </button>
          {resumeStatus === 'PREPARED' && <button
            type="button"
            className="secondary"
            disabled={busy || resumeBusy}
            onClick={onStopTrackingPrepared}
          >หยุดติดตามรายการเดิมและเริ่มใหม่</button>}
        </>
        : <>
          <button type="button" className="secondary" disabled={busy} onClick={() => setReviewing(false)}>แก้ไขข้อมูล</button>
          <button type="button" disabled={busy} onClick={() => { void confirm() }}>{busy ? 'กำลังยืนยัน' : 'ยืนยันบันทึก'}</button>
        </>}
    </footer>}
  </main>
}

function ExpenseReview({ category, values, files }: {
  category: EnabledExpenseCategory
  values: ExpenseFormValues
  files: File[]
}) {
  const amountSatang = parseExpenseAmountSatang(values.amount) ?? 0
  return <section className="pmc-expense-review">
    <div className="pmc-expense-heading"><h1>ตรวจสอบข้อมูล</h1><p>ตรวจอีกครั้งก่อนบันทึกรายการ</p></div>
    <dl>
      <div><dt>ประเภท</dt><dd>{expenseCategoryLabel(category)}</dd></div>
      <div><dt>วันที่รายจ่าย</dt><dd>{values.expenseDate}</dd></div>
      <div><dt>{category === 'BILL_DOCUMENT' ? 'จำนวนเงิน' : 'ยอดรวมรายวัน'}</dt><dd>{formatExpenseSatang(amountSatang)}</dd></div>
      {category === 'BILL_DOCUMENT' && <>
        <div><dt>ชื่อร้านหรือผู้รับเงิน</dt><dd>{values.counterpartyName.trim()}</dd></div>
        <div><dt>วิธีชำระ</dt><dd>{expensePaymentLabel(values.paymentMethod as ExpensePaymentMethod)}</dd></div>
      </>}
      <div><dt>หมายเหตุ</dt><dd>{values.description.trim() || '—'}</dd></div>
      <div><dt>รูปหลักฐาน</dt><dd>{files.length} รูป</dd></div>
    </dl>
    <ol className="pmc-expense-review-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>{index + 1}. {file.name}</li>)}</ol>
  </section>
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return <div className="pmc-expense-field">
    <label htmlFor={id}>{label}</label>
    {children}
    {error && <p id={`${id}-error`} className="pmc-expense-error">{error}</p>}
  </div>
}

function validStagingTokens(tokens: unknown, expectedCount: number): tokens is string[] {
  return Array.isArray(tokens) && tokens.length === expectedCount && new Set(tokens).size === tokens.length
    && tokens.every(isExpenseStagingToken)
}

function isExpenseAsyncAcknowledgement(
  value: ExpenseReceipt | ExpenseAsyncAck,
): value is ExpenseAsyncAck {
  return 'status' in value && value.status === 'PENDING'
}

function focusFirstError(errors: ExpenseFormErrors, fileInput: HTMLInputElement | null): void {
  const ids: Partial<Record<keyof ExpenseFormErrors, string>> = {
    expenseDate: 'expense-date', amount: 'expense-amount', counterpartyName: 'expense-counterparty',
    paymentMethod: 'expense-payment', description: 'expense-description',
  }
  const first = Object.keys(errors)[0] as keyof ExpenseFormErrors | undefined
  if (!first) return
  queueMicrotask(() => {
    if (first === 'files') fileInput?.focus()
    else document.getElementById(ids[first] ?? '')?.focus()
  })
}

function expenseFailureMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'EXPENSE_REVISION_CONFLICT') return 'มีรายการของวันนี้แล้ว กรุณาแจ้งผู้ดูแล'
  if (code === 'EXPENSE_RESUME_STORAGE_UNAVAILABLE') {
    return 'อุปกรณ์นี้ไม่สามารถเก็บสถานะป้องกันรายการซ้ำได้ กรุณาตรวจการตั้งค่าเบราว์เซอร์แล้วลองใหม่'
  }
  if (code === 'EXPENSE_UNSUPPORTED_IMAGE' || code === 'EXPENSE_INVALID_FILE_NAME') {
    return 'รูปบางรูปไม่รองรับหรือแปลงไม่สำเร็จ กรุณาใช้ JPG, PNG, WebP, HEIC หรือ HEIF'
  }
  return 'บันทึกรายจ่ายไม่สำเร็จ กรุณาลองอีกครั้ง'
}

function requiresFreshExpenseStaging(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return [
    'EXPENSE_INVALID_ATTACHMENTS',
    'EXPENSE_PRIVATE_FILE_INVALID',
    'EXPENSE_STAGING_TOKEN_INVALID',
    'EXPENSE_STAGING_NOT_FOUND',
    'EXPENSE_STAGING_EXPIRED',
    'EXPENSE_STAGING_OBJECT_NOT_FOUND',
  ].includes(code)
}

function ambiguousExpenseResult(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  if ('retryable' in error && error.retryable === false) return false
  return true
}

function safeClientError(): Error & { code: string } {
  return Object.assign(new Error('Invalid expense response'), { code: 'MINI_APP_INVALID_RESPONSE' })
}

function revokePreview(value: string): void {
  if (value.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value)
}

function currentBangkokDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
