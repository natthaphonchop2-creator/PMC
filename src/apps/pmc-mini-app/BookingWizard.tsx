import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type ReactElement } from 'react'
import { ArrowLeft, Check, ImagePlus, X } from 'lucide-react'
import { BrandMark } from './BrandMark'
import {
  bookingInput,
  initialBooking,
  previewBooking,
  reduceBooking,
  validateBookingStep,
  type BookingEvidenceItem,
  type BookingWizardAction,
  type BookingValues,
} from './bookingModel'
import type {
  BookingConfirmationResult,
  BookingDraftInput,
  BookingDraftProjection,
  MiniAppConfig,
  MiniAppSession,
} from './contracts'

export interface BookingWizardAdapter {
  load(draftId: string): Promise<BookingDraftProjection>
  upload(draftId: string, kind: 'PAYMENT' | 'CHAT', files: File[]): Promise<BookingDraftProjection>
  save(draftId: string, version: number, input: BookingDraftInput): Promise<BookingDraftProjection>
  confirm(draftId: string, version: number): Promise<BookingConfirmationResult>
  cancel(draftId: string, version: number): Promise<BookingDraftProjection>
}

export function BookingWizard({
  session,
  config,
  draft: initialDraft,
  adapter,
  initialStep = 0,
  onExit,
}: {
  session: MiniAppSession
  config: MiniAppConfig
  draft: BookingDraftProjection
  adapter: BookingWizardAdapter
  initialStep?: number
  onExit?: () => void
}) {
  const [state, dispatch] = useReducer(reduceBooking, initialDraftState(initialDraft, initialStep))
  const [draft, setDraft] = useState(initialDraft)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [result, setResult] = useState<BookingConfirmationResult | null>(null)
  const preview = useMemo(() => safePreview(state, config), [state, config])
  const evidenceRef = useRef(state.evidence)

  useEffect(() => { evidenceRef.current = state.evidence }, [state.evidence])

  useEffect(() => () => {
    for (const item of [...evidenceRef.current.PAYMENT, ...evidenceRef.current.CHAT]) {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    }
  }, [])

  const update = (field: keyof BookingValues, value: string) => {
    dispatch({ type: 'SET_VALUE', field, value })
    if (errors[field]) setErrors((current) => ({ ...current, [field]: '' }))
  }
  const goBack = async () => {
    setFailure('')
    if (state.step > 0) {
      dispatch({ type: 'GO_BACK' })
      return
    }
    if (busy) return
    setBusy(true)
    try {
      await adapter.cancel(draft.draftId, draft.version)
      setBusy(false)
      onExit?.()
    } catch {
      setFailure('ยกเลิกร่างไม่สำเร็จ กรุณาลองอีกครั้ง')
      setBusy(false)
    }
  }
  const goNext = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors = validateBookingStep(state, state.step, config)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (state.step < 3) {
      dispatch({ type: 'GO_TO_STEP', step: state.step + 1 })
      return
    }
    if (state.step === 3) {
      setBusy(true)
      setFailure('')
      const input = bookingInput(state)
      try {
        let current = draft
        const newPayments = state.evidence.PAYMENT.flatMap(({ file }) => file ? [file] : [])
        const newChats = state.evidence.CHAT.flatMap(({ file }) => file ? [file] : [])
        if (newPayments.length > 0) {
          current = await adapter.upload(current.draftId, 'PAYMENT', newPayments)
          setDraft(current)
          replaceUploadedEvidence('PAYMENT', state.evidence.PAYMENT, current.paymentEvidenceIds, dispatch)
        }
        if (newChats.length > 0) {
          current = await adapter.upload(current.draftId, 'CHAT', newChats)
          setDraft(current)
          replaceUploadedEvidence('CHAT', state.evidence.CHAT, current.chatEvidenceIds, dispatch)
        }
        current = await adapter.save(current.draftId, current.version, input)
        setDraft(current)
        dispatch({ type: 'GO_TO_STEP', step: 4 })
      } catch (error) {
        if (errorCode(error) === 'STALE_DRAFT_VERSION') {
          try {
            const latest = await adapter.load(draft.draftId)
            if (latest.state === 'READY_TO_CONFIRM' && sameBookingInput(latest.input, input)) {
              setDraft(latest)
              replaceUploadedEvidence('PAYMENT', state.evidence.PAYMENT, latest.paymentEvidenceIds, dispatch)
              replaceUploadedEvidence('CHAT', state.evidence.CHAT, latest.chatEvidenceIds, dispatch)
              dispatch({ type: 'GO_TO_STEP', step: 4 })
              return
            }
          } catch {
            // Fall through to the safe generic message below.
          }
        }
        setFailure(draftSaveFailureMessage(error))
      } finally {
        setBusy(false)
      }
    }
  }
  const confirm = async () => {
    setBusy(true)
    setFailure('')
    try {
      const confirmed = await adapter.confirm(draft.draftId, draft.version)
      setResult(confirmed)
      dispatch({ type: 'GO_TO_STEP', step: 5 })
    } catch {
      setFailure('ยืนยันการจองไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setBusy(false)
    }
  }
  const addEvidence = (kind: 'PAYMENT' | 'CHAT', event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    if (state.evidence[kind].length + files.length > 10) {
      setErrors((current) => ({ ...current, [kind === 'PAYMENT' ? 'paymentEvidence' : 'chatEvidence']: 'แนบได้สูงสุด 10 รูป' }))
      event.target.value = ''
      return
    }
    const items = files.map((file, index): BookingEvidenceItem => ({
      id: `${kind.toLowerCase()}-${file.name}-${file.size}-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
      previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
      file,
    }))
    dispatch({ type: 'ADD_EVIDENCE', kind, items })
    setErrors((current) => ({ ...current, [kind === 'PAYMENT' ? 'paymentEvidence' : 'chatEvidence']: '' }))
    event.target.value = ''
  }
  const removeEvidence = (kind: 'PAYMENT' | 'CHAT', item: BookingEvidenceItem) => {
    if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
    dispatch({ type: 'REMOVE_EVIDENCE', kind, id: item.id })
  }

  if (state.step === 5 && result) {
    return (
      <main className="pmc-booking-success">
        <div className="pmc-success-mark"><Check aria-hidden="true" /></div>
        <p>บันทึกการจองแล้ว</p>
        <h1>{result.caseId}</h1>
        <span>{statusLabel(result.status)}</span>
        <button type="button" onClick={onExit}>กลับหน้าหลัก</button>
      </main>
    )
  }

  return (
    <main className="pmc-booking-page">
      <header className="pmc-booking-header">
        <button type="button" className="pmc-icon-button" aria-label="ย้อนกลับ" disabled={busy} onClick={() => { void goBack() }}><ArrowLeft aria-hidden="true" /></button>
        <BrandMark compact />
        <div>
          <p>ลงนัดหมาย</p>
          <span>ขั้นตอน {Math.min(state.step + 1, 5)} จาก 5</span>
        </div>
      </header>
      <div className="pmc-progress" aria-hidden="true"><span style={{ width: `${((state.step + 1) / 5) * 100}%` }} /></div>

      <form className="pmc-booking-form" onSubmit={goNext} noValidate>
        {state.step === 0 && <CustomerStep session={session} config={config} state={state.values} errors={errors} update={update} />}
        {state.step === 1 && <DetailsStep config={config} state={state.values} errors={errors} update={update} />}
        {state.step === 2 && <QueueStep state={state.values} errors={errors} update={update} onQueueType={(value) => dispatch({ type: 'SET_QUEUE_TYPE', value })} />}
        {state.step === 3 && <EvidenceStep
          state={state.values} evidence={state.evidence} errors={errors} update={update}
          addEvidence={addEvidence} removeEvidence={removeEvidence}
        />}
        {state.step === 4 && <PreviewStep session={session} preview={preview} evidence={state.evidence} />}

        {failure && <p className="pmc-form-alert" role="alert">{failure}</p>}
        <footer className="pmc-booking-footer">
          {state.step > 0 && <button type="button" className="pmc-secondary-button" onClick={goBack}>ย้อนกลับ</button>}
          {state.step < 4 && <button type="submit" className="pmc-primary-button" disabled={busy}>{busy ? 'กำลังบันทึก' : state.step === 3 ? 'ตรวจสอบข้อมูล' : 'ถัดไป'}</button>}
          {state.step === 4 && <button type="button" className="pmc-primary-button" disabled={busy} onClick={confirm}>{busy ? 'กำลังยืนยัน' : 'ยืนยันบันทึก'}</button>}
        </footer>
      </form>
    </main>
  )
}

function CustomerStep({ session, config, state, errors, update }: StepProps & { session: MiniAppSession; config: MiniAppConfig }) {
  return <section className="pmc-step"><StepHeading title="ข้อมูลลูกค้า" description="กรอกข้อมูลที่ใช้ค้นหาและติดต่อ" />
    <Field label="Admin" error=""><input value={session.displayName} disabled /></Field>
    <Field label="AE" error={errors.aeName}><select value={state.aeName} onChange={(event) => update('aeName', event.target.value)}>{config.aes.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></Field>
    <Field label="ชื่อลูกค้า" error={errors.customerName}><input name="customerName" value={state.customerName} onChange={(event) => update('customerName', event.target.value)} autoComplete="name" required /></Field>
    <Field label="ชื่อ Facebook" hint="ถ้าไม่มี ให้กรอกคำว่า ไม่มี" error={errors.facebookName}><input name="facebookName" value={state.facebookName} onChange={(event) => update('facebookName', event.target.value)} required /></Field>
    <Field label="เบอร์มือถือ" error={errors.phone}><input name="phone" value={state.phone} onChange={(event) => update('phone', event.target.value)} inputMode="tel" autoComplete="tel" required /></Field>
  </section>
}

interface StepProps { state: BookingValues; errors: Record<string, string>; update: (field: keyof BookingValues, value: string) => void }

function DetailsStep({ config, state, errors, update }: StepProps & { config: MiniAppConfig }) {
  return <section className="pmc-step"><StepHeading title="รายละเอียดการจอง" description="เลือกแพทย์ โปรแกรม และช่องทาง" />
    <Field label="แพทย์" error={errors.doctorId}><select value={state.doctorId} onChange={(event) => update('doctorId', event.target.value)}><option value="">เลือกแพทย์</option>{config.doctors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="โปรแกรม" error={errors.serviceId}><select value={state.serviceId} onChange={(event) => update('serviceId', event.target.value)}><option value="">เลือกโปรแกรม</option>{config.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="ช่องทาง" error={errors.channelId}><select value={state.channelId} onChange={(event) => update('channelId', event.target.value)}><option value="">เลือกช่องทาง</option>{config.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
  </section>
}

function QueueStep({ state, errors, update, onQueueType }: StepProps & { onQueueType: (value: 'NORMAL' | 'AUTO') => void }) {
  return <section className="pmc-step"><StepHeading title="รูปแบบคิว" description="เลือกตามข้อมูลที่ลูกค้าแจ้ง" />
    <fieldset className="pmc-queue-options"><legend>คิวนัดหมาย</legend>
      <label><input aria-label="คิวปกติ" type="radio" name="queueType" checked={state.queueType === 'NORMAL'} onChange={() => onQueueType('NORMAL')} /> <span><strong>คิวปกติ</strong><small>ลูกค้าเลือกวันและเวลาแล้ว</small></span></label>
      <label><input aria-label="คิวอัตโนมัติ" type="radio" name="queueType" checked={state.queueType === 'AUTO'} onChange={() => onQueueType('AUTO')} /> <span><strong>คิวอัตโนมัติ</strong><small>ระบบส่งต่อให้จัดคิวภายหลัง</small></span></label>
    </fieldset>
    {state.queueType === 'NORMAL' && <div className="pmc-date-time">
      <Field label="วันที่นัด" error={errors.appointmentDate}><input type="date" value={state.appointmentDate ?? ''} onChange={(event) => update('appointmentDate', event.target.value)} /></Field>
      <Field label="เวลานัด" error={errors.appointmentTime}><input type="time" value={state.appointmentTime ?? ''} onChange={(event) => update('appointmentTime', event.target.value)} /></Field>
    </div>}
  </section>
}

function EvidenceStep({ state, evidence, errors, update, addEvidence, removeEvidence }: StepProps & {
  evidence: { PAYMENT: BookingEvidenceItem[]; CHAT: BookingEvidenceItem[] }
  addEvidence: (kind: 'PAYMENT' | 'CHAT', event: ChangeEvent<HTMLInputElement>) => void
  removeEvidence: (kind: 'PAYMENT' | 'CHAT', item: BookingEvidenceItem) => void
}) {
  return <section className="pmc-step"><StepHeading title="ยอดจองและหลักฐาน" description="แนบรูปเล็กไว้ตรวจสอบก่อนส่ง" />
    <Field label="ยอดจอง (บาท)" error={errors.depositAmount}><input value={state.depositAmount} onChange={(event) => update('depositAmount', event.target.value)} inputMode="decimal" /></Field>
    <EvidencePicker label="สลิป" inputLabel="สลิปเงินจอง" kind="PAYMENT" items={evidence.PAYMENT} error={errors.paymentEvidence} onAdd={addEvidence} onRemove={removeEvidence} />
    <EvidencePicker label="แชท" inputLabel="หลักฐานแชท" kind="CHAT" items={evidence.CHAT} error={errors.chatEvidence} onAdd={addEvidence} onRemove={removeEvidence} />
  </section>
}

function EvidencePicker({ label, inputLabel, kind, items, error, onAdd, onRemove }: {
  label: string; inputLabel: string; kind: 'PAYMENT' | 'CHAT'; items: BookingEvidenceItem[]; error?: string
  onAdd: (kind: 'PAYMENT' | 'CHAT', event: ChangeEvent<HTMLInputElement>) => void
  onRemove: (kind: 'PAYMENT' | 'CHAT', item: BookingEvidenceItem) => void
}) {
  return <div className="pmc-evidence-block">
    <div className="pmc-evidence-head"><strong>{label} {items.length}/10 รูป</strong><label className="pmc-add-evidence"><ImagePlus aria-hidden="true" />เพิ่มรูป<input className="pmc-visually-hidden" aria-label={inputLabel} type="file" accept="image/jpeg,image/png" multiple onChange={(event) => onAdd(kind, event)} /></label></div>
    {items.length > 0 && <div className="pmc-evidence-grid">{items.map((item) => <figure key={item.id}>
      {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <div className="pmc-file-placeholder"><ImagePlus aria-hidden="true" /></div>}
      <figcaption>{item.name}</figcaption>
      <button type="button" aria-label={`ลบ ${item.name}`} onClick={() => onRemove(kind, item)}><X aria-hidden="true" /></button>
    </figure>)}</div>}
    {error && <span className="pmc-field-error" role="alert">{error}</span>}
  </div>
}

function PreviewStep({ session, preview, evidence }: { session: MiniAppSession; preview: ReturnType<typeof safePreview>; evidence: { PAYMENT: BookingEvidenceItem[]; CHAT: BookingEvidenceItem[] } }) {
  return <section className="pmc-step"><StepHeading title="ตรวจสอบก่อนยืนยัน" description="ตรวจข้อมูลให้ครบก่อนบันทึกเข้าระบบ" />
    <dl className="pmc-preview-list">
      <PreviewRow label="Admin" value={session.displayName} /><PreviewRow label="AE" value={preview.ae} />
      <PreviewRow label="ลูกค้า" value={preview.customerName} /><PreviewRow label="Facebook" value={preview.facebookName} />
      <PreviewRow label="โทร" value={preview.phone} /><PreviewRow label="แพทย์" value={preview.doctor} />
      <PreviewRow label="โปรแกรม" value={preview.service} /><PreviewRow label="ช่องทาง" value={preview.channel} />
      <PreviewRow label="คิว" value={preview.queueType === 'AUTO' ? 'คิวอัตโนมัติ' : `${preview.appointmentDate || '—'} · ${preview.appointmentTime || '—'} น.`} />
      <PreviewRow label="ยอดจอง" value={`${Number(preview.depositAmount || 0).toLocaleString('th-TH')} บาท`} />
    </dl>
    <div className="pmc-preview-evidence"><span>สลิป {evidence.PAYMENT.length} รูป</span><span>แชท {evidence.CHAT.length} รูป</span></div>
  </section>
}

function StepHeading({ title, description }: { title: string; description: string }) { return <div className="pmc-step-heading"><h1>{title}</h1><p>{description}</p></div> }
function PreviewRow({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value || '—'}</dd></div> }
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactElement }) {
  return <label className="pmc-field"><span>{label}</span>{hint && <small>{hint}</small>}{children}{error && <em role="alert">{error}</em>}</label>
}

function initialDraftState(draft: BookingDraftProjection, initialStep: number) {
  const state = initialBooking(draft.requestId)
  state.step = Math.max(0, Math.min(4, initialStep))
  if (draft.input) {
    state.values = { ...state.values, ...draft.input, depositAmount: String(draft.input.depositAmount) }
  }
  state.evidence.PAYMENT = draft.paymentEvidenceIds.map((id) => ({ id, name: 'สลิปที่แนบแล้ว', size: 0, type: 'image/jpeg', previewUrl: '' }))
  state.evidence.CHAT = draft.chatEvidenceIds.map((id) => ({ id, name: 'แชทที่แนบแล้ว', size: 0, type: 'image/jpeg', previewUrl: '' }))
  return state
}

function safePreview(state: ReturnType<typeof initialBooking>, config: MiniAppConfig) {
  try { return previewBooking(state, config) } catch {
    return { customerName: '', facebookName: '', phone: '', ae: state.values.aeName, doctor: '', service: '', channel: '', queueType: state.values.queueType, appointmentDate: state.values.appointmentDate, appointmentTime: state.values.appointmentTime, depositAmount: 0, paymentCount: state.evidence.PAYMENT.length, chatCount: state.evidence.CHAT.length }
  }
}

function statusLabel(status: BookingConfirmationResult['status']): string {
  if (status === 'CONFIRMED') return 'ยืนยันวันนัดแล้ว'
  if (status === 'TENTATIVE') return 'ได้วันนัดชั่วคราว'
  return 'รอ Admin จัดวันนัด'
}

function draftSaveFailureMessage(error: unknown): string {
  const code = errorCode(error)
  if (code === 'UNSUPPORTED_EVIDENCE') {
    return 'รูปหลักฐานบางรูปไม่รองรับ รองรับเฉพาะรูป JPG หรือ PNG กรุณาจับภาพหน้าจอแล้วแนบใหม่'
  }
  return 'บันทึกร่างไม่สำเร็จ กรุณาลองอีกครั้ง'
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function sameBookingInput(left: BookingDraftInput | null, right: BookingDraftInput): boolean {
  if (!left) return false
  const keys: Array<keyof BookingDraftInput> = [
    'requestId', 'aeName', 'customerName', 'facebookName', 'phone', 'doctorId', 'serviceId', 'queueType',
    'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
  ]
  return keys.every((key) => left[key] === right[key])
}

function replaceUploadedEvidence(
  kind: 'PAYMENT' | 'CHAT',
  currentItems: BookingEvidenceItem[],
  fileIds: string[],
  dispatch: Dispatch<BookingWizardAction>,
): void {
  for (const item of currentItems) {
    if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl)
  }
  dispatch({
    type: 'REPLACE_EVIDENCE',
    kind,
    items: fileIds.map((id) => ({
      id,
      name: kind === 'PAYMENT' ? 'สลิปที่แนบแล้ว' : 'แชทที่แนบแล้ว',
      size: 0,
      type: 'image/jpeg',
      previewUrl: '',
    })),
  })
}
