import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Image, RotateCcw, Trash2 } from 'lucide-react'
import type { ExpenseHistoryPage, ExpenseHistoryRow } from '../../../../shared/pmcExpense'
import { formatBaht } from '../reportFormatting'
import { expenseCategoryLabel } from './expenseModel'

export interface ExpenseHistoryAdapter {
  replace(input: { row: ExpenseHistoryRow; expectedRevision: number }): void
  void(row: ExpenseHistoryRow, input: { rootRequestId: string; expectedRevision: number; reason: string }): Promise<void>
  issueEvidenceToken(expenseId: string, attachmentId: string): Promise<string>
  downloadEvidence(token: string): Promise<Blob>
  loadMore?: (monthKey: string, cursor: string) => Promise<ExpenseHistoryPage>
}

export function ExpenseHistory({
  monthKey,
  page,
  adapter,
  canManageExpense,
  canReplaceExpense = canManageExpense,
  loading = false,
  error = null,
  onBack,
}: {
  monthKey: string
  page: ExpenseHistoryPage
  adapter: ExpenseHistoryAdapter
  canManageExpense: boolean
  canReplaceExpense?: boolean
  loading?: boolean
  error?: string | null
  onBack?: () => void
}) {
  const [currentPage, setCurrentPage] = useState(() => page)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failure, setFailure] = useState(error ?? '')
  const [voiding, setVoiding] = useState<ExpenseHistoryRow | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const reasonLength = reason.trim().length
  const reasonInvalid = reasonLength > 0 && (reasonLength < 3 || reasonLength > 300)
  const loadMoreEpochRef = useRef(0)
  const voidEpochRef = useRef(0)

  useEffect(() => () => {
    loadMoreEpochRef.current += 1
    voidEpochRef.current += 1
  }, [])

  const loadMore = async () => {
    if (!currentPage.nextCursor || !adapter.loadMore || loadingMore) return
    const requestEpoch = ++loadMoreEpochRef.current
    setLoadingMore(true)
    setFailure('')
    try {
      const next = await adapter.loadMore(monthKey, currentPage.nextCursor)
      if (requestEpoch !== loadMoreEpochRef.current) return
      setCurrentPage((current) => ({
        expenses: [...current.expenses, ...next.expenses], nextCursor: next.nextCursor,
      }))
    } catch {
      if (requestEpoch !== loadMoreEpochRef.current) return
      setFailure('โหลดประวัติเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === loadMoreEpochRef.current) setLoadingMore(false)
    }
  }

  const confirmVoid = async () => {
    if (!voiding || busy || reasonLength < 3 || reasonLength > 300) return
    const requestEpoch = ++voidEpochRef.current
    setBusy(true)
    setFailure('')
    try {
      await adapter.void(voiding, {
        rootRequestId: globalThis.crypto.randomUUID(), expectedRevision: voiding.revision, reason: reason.trim(),
      })
      if (requestEpoch !== voidEpochRef.current) return
      setCurrentPage((current) => ({
        ...current,
        expenses: current.expenses.map((row) => row.expenseId === voiding.expenseId ? { ...row, recordState: 'VOID' as const } : row),
      }))
      setVoiding(null)
      setReason('')
    } catch {
      if (requestEpoch !== voidEpochRef.current) return
      setFailure('ยกเลิกรายการไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === voidEpochRef.current) setBusy(false)
    }
  }

  return <main className="pmc-expense-history-page">
    <header className="pmc-expense-history-header">
      {onBack && <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงานรายเดือน" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>}
      <div><h1>ประวัติรายจ่าย</h1><p>เดือน {monthKey}</p></div>
    </header>
    <p className="pmc-expense-history-note">แสดงครั้งละไม่เกิน 25 รายการ และจะไม่เปลี่ยนเดือนไปเอง</p>
    {failure && <p className="pmc-finance-message error" role="alert">{failure}</p>}
    {loading && !currentPage.expenses.length && <p className="pmc-finance-loading">กำลังโหลดประวัติรายจ่าย</p>}
    {!loading && !currentPage.expenses.length && <p className="pmc-finance-message">ยังไม่มีรายจ่ายที่บันทึกในเดือนนี้</p>}
    <ol className="pmc-expense-history-list">
      {currentPage.expenses.map((row, index) => <li key={row.expenseId}>
        <ExpenseHistoryItem row={row} adapter={adapter} canManageExpense={canManageExpense} canReplaceExpense={canReplaceExpense}
          listOrdinal={index + 1}
          onReplace={() => adapter.replace({ row, expectedRevision: row.revision })} onStartVoid={() => { setVoiding(row); setReason('') }} />
      </li>)}
    </ol>
    {currentPage.nextCursor && <button type="button" className="pmc-secondary-button pmc-expense-history-more" disabled={loadingMore}
      onClick={() => { void loadMore() }}>{loadingMore ? 'กำลังโหลด' : 'โหลดเพิ่ม'}</button>}
    {voiding && <section className="pmc-expense-void-confirm" aria-labelledby="void-expense-heading">
      <h2 id="void-expense-heading">ยกเลิกรายการ</h2>
      <p>รายการที่ยกเลิกจะไม่รวมในยอดรายจ่าย แต่หลักฐานเดิมยังคงเก็บไว้</p>
      <label htmlFor="void-reason">เหตุผลการยกเลิก</label>
      <textarea id="void-reason" value={reason} maxLength={300}
        aria-invalid={reasonInvalid} aria-describedby={reasonInvalid ? 'void-reason-error' : undefined}
        onChange={(event) => setReason(event.currentTarget.value)} />
      {reasonInvalid && <p id="void-reason-error" className="pmc-expense-error">เหตุผลต้องมี 3–300 ตัวอักษร</p>}
      <div><button type="button" className="pmc-secondary-button" disabled={busy} onClick={() => setVoiding(null)}>กลับ</button>
        <button type="button" className="pmc-danger-button" disabled={busy || reasonLength < 3 || reasonLength > 300} onClick={() => { void confirmVoid() }}>ยืนยันยกเลิก</button></div>
    </section>}
  </main>
}

function ExpenseHistoryItem({
  row,
  adapter,
  canManageExpense,
  canReplaceExpense,
  listOrdinal,
  onReplace,
  onStartVoid,
}: {
  row: ExpenseHistoryRow
  adapter: ExpenseHistoryAdapter
  canManageExpense: boolean
  canReplaceExpense: boolean
  listOrdinal: number
  onReplace: () => void
  onStartVoid: () => void
}) {
  const committed = row.recordState === 'COMMITTED'
  const isBook = row.category === 'BOOK_CLINIC' || row.category === 'BOOK_DOCTOR_PERSONAL'
  const recordContext = `รายการที่ ${listOrdinal} ${expenseCategoryLabel(row.category)} วันที่ ${row.expenseDate} revision ${row.revision}`
  return <article className="pmc-expense-history-card">
    <header><div><h2>{expenseCategoryLabel(row.category)}</h2><p>{row.expenseDate} · {row.submittedByName}</p></div>
      <span className={committed ? 'committed' : 'void'}>{committed ? 'บันทึกแล้ว' : 'ยกเลิกแล้ว'}</span></header>
    <strong className="pmc-expense-history-amount">{formatBaht(row.amountSatang)}</strong>
    {row.description && <p className="pmc-expense-history-description">{row.description}</p>}
    <p className="pmc-expense-history-meta">Revision {row.revision} · {row.attachments.length} หลักฐาน</p>
    {row.attachments.length > 0 && <ul className="pmc-expense-history-evidence">
      {row.attachments.map((attachment) => <li key={attachment.attachmentId}><EvidenceThumbnail row={row} attachment={attachment} adapter={adapter} recordContext={recordContext} /></li>)}
    </ul>}
    {canManageExpense && committed && <div className="pmc-expense-history-actions">
      {isBook && canReplaceExpense && <button type="button" aria-label={`แทนที่ยอดเดิม ${recordContext}`} onClick={onReplace}><RotateCcw aria-hidden="true" />แทนที่ยอดเดิม</button>}
      <button type="button" className="danger" aria-label={`ยกเลิกรายการ ${recordContext}`} onClick={onStartVoid}><Trash2 aria-hidden="true" />ยกเลิกรายการ</button>
    </div>}
  </article>
}

function EvidenceThumbnail({
  row,
  attachment,
  adapter,
  recordContext,
}: {
  row: ExpenseHistoryRow
  attachment: ExpenseHistoryRow['attachments'][number]
  adapter: ExpenseHistoryAdapter
  recordContext: string
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const urlRef = useRef('')
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      revokeObjectUrl(urlRef.current)
    }
  }, [])

  const load = async () => {
    if (url || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const token = await adapter.issueEvidenceToken(row.expenseId, attachment.attachmentId)
      const blob = await adapter.downloadEvidence(token)
      if (!activeRef.current) return
      const nextUrl = URL.createObjectURL(blob)
      revokeObjectUrl(urlRef.current)
      urlRef.current = nextUrl
      setUrl(nextUrl)
    } catch {
      if (activeRef.current) setFailed(true)
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }

  if (url) return <figure><img src={url} alt={`หลักฐาน ${attachment.ordinal}: ${attachment.originalFileName}`} /><figcaption>{attachment.originalFileName}</figcaption></figure>
  return <div className="pmc-expense-evidence-placeholder">
    <button type="button" aria-label={`ดูหลักฐาน ${attachment.ordinal} ${recordContext}`} disabled={loading} onClick={() => { void load() }}><Image aria-hidden="true" />{loading ? 'กำลังโหลด' : `ดูหลักฐาน ${attachment.ordinal}`}</button>
    {failed && <p role="alert">โหลดหลักฐานไม่สำเร็จ</p>}
  </div>
}

function revokeObjectUrl(value: string): void {
  if (value && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value)
}
