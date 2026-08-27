import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ReportFilters } from './ReportFilters'
import { ReportView } from './reportViews'
import {
  reportFilterError,
  type JeraClientEnvelope,
  type JeraReportType,
  type ReportFilterOptions,
  type ReportFilterState,
} from './reports'

export interface ReportPageAdapter {
  load(reportType: JeraReportType, filters: ReportFilterState): Promise<JeraClientEnvelope<unknown>>
  refresh(reportType: JeraReportType, filters: ReportFilterState): Promise<{ accepted: true; correlationId: string }>
}

export function ReportPage({
  reportType,
  filters,
  onFiltersChange,
  options,
  adapter,
  onBack,
  pollDelayMs = 1_500,
}: {
  reportType: JeraReportType
  filters: ReportFilterState
  onFiltersChange: (value: ReportFilterState) => void
  options?: ReportFilterOptions
  adapter: ReportPageAdapter
  onBack: () => void
  pollDelayMs?: number
}) {
  const [envelope, setEnvelope] = useState<JeraClientEnvelope<unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const filterKey = useMemo(() => JSON.stringify(filters), [filters])
  const filterError = reportFilterError(filters)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setEnvelope(null)
    setMessage('')
    if (filterError) { setLoading(false); return () => undefined }
    setLoading(true)

    const load = async (poll: boolean) => {
      try {
        const next = await adapter.load(reportType, filters)
        if (!active) return
        setEnvelope(next)
        setLoading(false)
        if (!poll && next.refreshing) timer = setTimeout(() => { void load(true) }, Math.max(0, pollDelayMs))
      } catch (error) {
        if (!active) return
        const code = safeErrorCode(error)
        setEnvelope((current) => current ? { ...current, refreshing: false, stale: true, warningCode: code } : null)
        setMessage(code === 'JERA_TIMEOUT' ? 'อัปเดตไม่สำเร็จ ระบบยังแสดงข้อมูลล่าสุด' : 'เปิดรายงานไม่สำเร็จ กรุณาลองอีกครั้ง')
        setLoading(false)
      }
    }
    void load(false)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [adapter, filterError, filterKey, filters, pollDelayMs, reportType])

  const refresh = async () => {
    if (filterError) return
    setRefreshing(true)
    setMessage('')
    try {
      await adapter.refresh(reportType, filters)
      const next = await adapter.load(reportType, filters)
      setEnvelope(next)
    } catch (error) {
      const retry = retryAfter(error)
      setMessage(retry ? `รีเฟรชได้อีกครั้งใน ${Math.ceil(retry / 60)} นาที` : 'รีเฟรชไม่สำเร็จ ระบบยังแสดงข้อมูลล่าสุด')
      setEnvelope((current) => current ? { ...current, stale: true, refreshing: false, warningCode: safeErrorCode(error) } : null)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <main className="pmc-report-page">
      <header className="pmc-report-page-header">
        <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงาน" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
        <div><p lang="en">JERA REPORT</p><h1>{REPORT_TITLES[reportType]}</h1></div>
      </header>
      <ReportFilters reportType={reportType} value={filters} onChange={onFiltersChange} options={options} />
      <section className="pmc-report-status" aria-live="polite">
        <div>
          <span>{envelope?.lastSuccessAt ? `อัปเดตล่าสุดเมื่อ ${formatBangkokTime(envelope.lastSuccessAt)}` : 'ยังไม่เคยอัปเดตสำเร็จ'}</span>
          {(envelope?.stale || envelope?.warningCode) && <strong>ข้อมูลอาจล่าช้า</strong>}
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || loading || Boolean(filterError)} aria-label="รีเฟรชข้อมูล">
          <RefreshCw className={refreshing || envelope?.refreshing ? 'spinning' : ''} aria-hidden="true" />
          <span>รีเฟรช</span>
        </button>
      </section>
      {message && <p className="pmc-report-message" role="alert">{message}</p>}
      {loading && !envelope && <p className="pmc-report-loading">กำลังเปิดรายงาน</p>}
      {envelope && <>
        {isUnconfirmedEmpty(envelope) && <p className="pmc-report-empty">ยังไม่มีข้อมูลที่ยืนยันแล้ว</p>}
        <ReportView reportType={reportType} data={envelope.data} />
      </>}
    </main>
  )
}

const REPORT_TITLES: Record<JeraReportType, string> = {
  TODAY_SUMMARY: 'สรุปวันนี้', PAYMENT: 'ยอดรับชำระ', DEPOSIT: 'มัดจำ', REFUND: 'คืนเงิน',
  APPOINTMENT: 'นัดหมาย', PAYMENT_LIST: 'รายการรับชำระ', PRODUCT_USE: 'การใช้สินค้าและบริการ',
  PRODUCT_SALES: 'ยอดขายสินค้าและบริการ', CANCELLED_PAYMENT: 'รายการรับชำระที่ยกเลิก',
  OPD: 'รายงาน OPD', CANCELLED_UNPAID: 'ค้างชำระที่ยกเลิก', COURSE_SALES: 'ยอดขายคอร์ส',
  REMAINING_COURSE: 'คอร์สคงเหลือ', REMAINING_COURSE_BY_DATE: 'คอร์สคงเหลือตามวันที่',
}

function formatBangkokTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  }).format(date)
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code)
    if (/^[A-Z0-9_]{1,80}$/.test(code)) return code
  }
  return 'JERA_REPORT_UNAVAILABLE'
}

function retryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('retryAfterSeconds' in error)) return null
  const value = Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function isUnconfirmedEmpty(envelope: JeraClientEnvelope<unknown>): boolean {
  if (envelope.warningCode === 'JERA_CACHE_EMPTY' || !envelope.lastSuccessAt) return true
  return false
}
