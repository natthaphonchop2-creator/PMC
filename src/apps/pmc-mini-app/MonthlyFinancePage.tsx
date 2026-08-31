import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import type { FinanceComponentFreshness, MonthlyIncomeProjection } from '../../../shared/pmcFinance'
import type { ExpenseMonthlyProjection } from '../../../shared/pmcExpense'
import {
  defaultFinanceMonthSelection,
  financeMonthSelectionError,
  type FinanceDailyFilter,
  type FinanceMonthSelection,
} from './financeReports'
import { formatBaht, formatBahtFixed } from './reportFormatting'
import { MonthlyExpensePanel } from './expense/MonthlyExpensePanel'

export interface MonthlyIncomePageAdapter {
  load(selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
}

export interface MonthlyExpensePageAdapter {
  load(monthKey: string): Promise<ExpenseMonthlyProjection>
}

export function MonthlyFinancePage({
  canViewFinance,
  incomeEnabled = true,
  bangkokDate,
  adapter,
  expenseAdapter,
  onBack,
  onDrillDown,
  onOpenExpenseHistory,
  initialSelection,
  onSelectionChange,
}: {
  canViewFinance: boolean
  incomeEnabled?: boolean
  bangkokDate: string
  adapter: MonthlyIncomePageAdapter
  expenseAdapter?: MonthlyExpensePageAdapter
  onBack: () => void
  onDrillDown: (filter: FinanceDailyFilter) => void
  onOpenExpenseHistory?: (monthKey: string) => void
  initialSelection?: FinanceMonthSelection
  onSelectionChange?: (selection: FinanceMonthSelection) => void
}) {
  const [selection, setSelection] = useState(() => initialSelection ?? defaultFinanceMonthSelection(bangkokDate))
  const [loadedProjection, setLoadedProjection] = useState<{ key: string; value: MonthlyIncomeProjection } | null>(null)
  const [loading, setLoading] = useState(canViewFinance && incomeEnabled)
  const [error, setError] = useState('')
  const [loadedExpenseProjection, setLoadedExpenseProjection] = useState<{ key: string; value: ExpenseMonthlyProjection } | null>(null)
  const [expenseError, setExpenseError] = useState<{ key: string; value: 'EMPTY' | 'UNAVAILABLE' } | null>(null)
  const requestEpochRef = useRef(0)
  const selectionKey = monthSelectionKey(selection)
  const projection = loadedProjection?.key === selectionKey ? loadedProjection.value : null
  const expenseProjection = loadedExpenseProjection?.key === selectionKey ? loadedExpenseProjection.value : null
  const currentExpenseError = expenseError?.key === selectionKey ? expenseError.value : null
  const expenseLoading = Boolean(expenseAdapter && !expenseProjection && currentExpenseError !== 'UNAVAILABLE')

  useEffect(() => {
    if (!canViewFinance) return
    const requestEpoch = ++requestEpochRef.current
    const requestKey = monthSelectionKey(selection)
    onSelectionChange?.(selection)
    if (financeMonthSelectionError(selection)) return
    if (incomeEnabled) {
      void adapter.load(selection).then((next) => {
        if (requestEpoch === requestEpochRef.current) setLoadedProjection({ key: requestKey, value: next })
      }).catch(() => {
        if (requestEpoch !== requestEpochRef.current) return
        setError(projection ? 'โหลดข้อมูลไม่สำเร็จ ข้อมูลล่าสุดยังแสดงอยู่ กรุณาลองอีกครั้ง' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')
      }).finally(() => {
        if (requestEpoch === requestEpochRef.current) setLoading(false)
      })
    }
    if (expenseAdapter) {
      void expenseAdapter.load(monthValueForSelection(selection)).then((next) => {
        if (requestEpoch === requestEpochRef.current) {
          setLoadedExpenseProjection({ key: requestKey, value: next })
          setExpenseError(next.effectiveExpenseCount === 0 ? { key: requestKey, value: 'EMPTY' } : null)
        }
      }).catch(() => {
        if (requestEpoch === requestEpochRef.current) setExpenseError({ key: requestKey, value: 'UNAVAILABLE' })
      })
    }
  // Keep the last successful projection visible when a later month load fails.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, canViewFinance, expenseAdapter, incomeEnabled, onSelectionChange, selection])

  if (!canViewFinance) return <main className="pmc-finance-page pmc-finance-locked-page">
    <LockKeyhole aria-hidden="true" />
    <h1>รายงานนี้สำหรับฝ่ายการเงิน</h1>
    <p>บัญชีของคุณยังไม่มีสิทธิ์ดูรายงานรายเดือน</p>
    <button type="button" className="pmc-secondary-button" onClick={onBack}>กลับไปรายงาน</button>
  </main>

  const monthValue = `${selection.year}-${String(selection.month).padStart(2, '0')}`
  return <main className="pmc-finance-page">
    <header className="pmc-finance-page-header">
      <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงาน" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div><h1>{incomeEnabled ? 'รายงานรายเดือน' : 'รายจ่ายรายเดือน'}</h1><p>{incomeEnabled
        ? 'ภาพรวมรายรับของฝ่ายการเงิน'
        : 'ยอดรายจ่ายที่บันทึกและหลักฐานย้อนหลัง'}</p></div>
    </header>

    <section className="pmc-finance-filter pmc-monthly-filter" aria-label="ตัวกรองเดือนรายงาน">
      <h2>เดือนรายงาน</h2>
      <label><span className="pmc-visually-hidden">เดือนรายงาน</span><input
        type="month"
        value={monthValue}
        min="2020-01"
        max="2100-12"
        onChange={(event) => {
          const [year, month] = event.currentTarget.value.split('-').map(Number)
          if (Number.isSafeInteger(year) && Number.isSafeInteger(month)) {
            requestEpochRef.current += 1
            setError('')
            setExpenseError(null)
            setLoading(incomeEnabled)
            setSelection({ year: year!, month: month! })
          }
        }}
      /></label>
    </section>

    {error && <p className="pmc-finance-message error" role="alert">{error}</p>}
    {loading && !projection && <p className="pmc-finance-loading">กำลังโหลดรายงานรายเดือน</p>}
    {projection && <MonthlyIncomeContent projection={projection} onDrillDown={onDrillDown}
      expenseProjection={expenseProjection} expenseLoading={expenseLoading} expenseError={currentExpenseError}
      onOpenExpenseHistory={onOpenExpenseHistory ? () => onOpenExpenseHistory(monthValue) : undefined} />}
    {!incomeEnabled && <MonthlyExpensePanel
      projection={expenseProjection}
      loading={expenseLoading}
      error={currentExpenseError}
      onOpenHistory={onOpenExpenseHistory ? () => onOpenExpenseHistory(monthValue) : undefined}
    />}
  </main>
}

function MonthlyIncomeContent({
  projection,
  onDrillDown,
  expenseProjection,
  expenseLoading,
  expenseError,
  onOpenExpenseHistory,
}: {
  projection: MonthlyIncomeProjection
  onDrillDown: (filter: FinanceDailyFilter) => void
  expenseProjection: ExpenseMonthlyProjection | null
  expenseLoading: boolean
  expenseError: 'EMPTY' | 'UNAVAILABLE' | null
  onOpenExpenseHistory?: () => void
}) {
  const categoriesReady = projection.categories.state === 'READY'
  const categorySourceLate = projection.warnings.includes('CATEGORY_SOURCE_SNAPSHOT_MISMATCH')
  return <div className="pmc-finance-report-content">
    <section className="pmc-finance-authority" aria-label="ยอดรายรับหลักประจำเดือน">
      <article><span>ยอดรับชำระ</span><strong>{formatBaht(projection.receivedSatang)}</strong></article>
      <article><span>คืนเงิน</span><strong>{formatBaht(projection.refundSatang)}</strong></article>
      <article><span>รับสุทธิ</span><strong>{formatBaht(projection.netReceivedSatang)}</strong></article>
    </section>

    <section className="pmc-finance-section pmc-monthly-trend">
      <h2>รายรับรายวัน</h2>
      <div className="pmc-finance-table-scroll" tabIndex={0}>
        <table>
          <caption>รายรับรายวันในเดือน</caption>
          <thead><tr><th scope="col">วันที่</th><th scope="col">รับชำระ</th><th scope="col">คืนเงิน</th><th scope="col">รับสุทธิ</th></tr></thead>
          <tbody>{projection.dailyTrend.map((day) => <tr key={day.date}>
            <th scope="row"><button type="button" aria-label={`ดูรายรับวันที่ ${day.date}`} onClick={() => onDrillDown({
              preset: 'CUSTOM', startDate: day.date, endDate: day.date,
            })}>{day.date}</button></th>
            <td>{formatBaht(day.receivedSatang)}</td><td>{formatBaht(day.refundSatang)}</td><td>{formatBaht(day.netReceivedSatang)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="pmc-finance-section" aria-labelledby="monthly-channels-heading">
      <h2 id="monthly-channels-heading">ช่องทางรับชำระ</h2>
      <dl className="pmc-finance-channel-list">
        <MonthlyDefinition label="โอน" value={projection.channels.transferSatang} />
        <MonthlyDefinition label="สด" value={projection.channels.cashSatang} />
        <MonthlyDefinition label="Credit" value={projection.channels.creditSatang} />
        <MonthlyDefinition label="อื่น ๆ" value={projection.channels.otherSatang} />
      </dl>
      {projection.channels.differenceSatang !== 0 && <p className="pmc-finance-channel-warning">
        ยอดช่องทางต่างจากยอดรับชำระ {formatBaht(Math.abs(projection.channels.differenceSatang))}
      </p>}
    </section>

    <section className="pmc-finance-section pmc-finance-categories" aria-label="หมวดรายรับ ไม่รวมเพิ่มจากยอดรับชำระ">
      <header><h2>หมวดรายรับ</h2><p>เป็นการแบ่งยอดรับชำระ ไม่ได้นำไปรวมเพิ่ม</p></header>
      {!categoriesReady && <div className="pmc-finance-checking">
        <strong>กำลังตรวจสอบหมวด</strong>
        <span>วันที่ยังไม่ครบ: {projection.categories.incompleteDates.join(', ')}</span>
      </div>}
      {categorySourceLate && <p className="pmc-finance-late-warning">ข้อมูลหมวดอาจล่าช้า</p>}
      <div className="pmc-finance-category-grid">
        <MonthlyCategory label="บริการและคอร์ส" value={categoriesReady ? projection.categories.serviceSatang : null} />
        <MonthlyCategory label="Product" value={categoriesReady ? projection.categories.productSatang : null} />
        <MonthlyCategory label="ยังไม่จัดหมวด" value={categoriesReady ? projection.categories.unclassifiedSatang : null} />
      </div>
    </section>

    <MonthlyFreshnessSection freshness={projection.freshness} />
    <MonthlyExpensePanel projection={expenseProjection} loading={expenseLoading} error={expenseError} onOpenHistory={onOpenExpenseHistory} />
    {expenseProjection && <section className="pmc-finance-section pmc-monthly-balance" aria-labelledby="monthly-balance-heading">
      <h2 id="monthly-balance-heading">ยอดคงเหลือโดยประมาณ <strong>{formatBahtFixed(estimatedClinicBalance(projection.netReceivedSatang, expenseProjection.clinicCommittedSatang) ?? Number.NaN)}</strong></h2>
      <small>รับสุทธิ หักเฉพาะรายจ่ายคลินิกที่บันทึกแล้ว ไม่รวมรายจ่ายส่วนตัวหมอ</small>
    </section>}
  </div>
}

function MonthlyDefinition({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{formatBaht(value)}</dd></div>
}

function MonthlyCategory({ label, value }: { label: string; value: number | null }) {
  return <article><span>{label}</span><strong className="pmc-finance-category-value">{formatBaht(value)}</strong></article>
}

function MonthlyFreshnessSection({ freshness }: { freshness: MonthlyIncomeProjection['freshness'] }) {
  return <section className="pmc-finance-section pmc-finance-freshness" aria-labelledby="monthly-freshness-heading">
    <h2 id="monthly-freshness-heading">สถานะข้อมูล</h2>
    <dl>
      <MonthlyFreshnessRow label="ข้อมูลรับชำระ" value={freshness.payment} />
      <MonthlyFreshnessRow label="ข้อมูลคืนเงิน" value={freshness.refund} />
      <MonthlyFreshnessRow label="ข้อมูลหมวด" value={freshness.allocation} />
    </dl>
  </section>
}

function MonthlyFreshnessRow({ label, value }: { label: string; value: FinanceComponentFreshness }) {
  return <div><dt>{label}</dt><dd><span>{value.stale ? 'ล่าช้า' : 'พร้อม'}</span>{value.lastSuccessAt
    ? <time dateTime={value.lastSuccessAt}>{formatBangkokTimestamp(value.lastSuccessAt)}</time>
    : <span>ยังไม่เคยซิงก์</span>}</dd></div>
}

function formatBangkokTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'เวลาไม่พร้อม'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function monthSelectionKey(selection: FinanceMonthSelection): string {
  return `${selection.year}|${selection.month}`
}

function monthValueForSelection(selection: FinanceMonthSelection): string {
  return `${selection.year}-${String(selection.month).padStart(2, '0')}`
}

function estimatedClinicBalance(netReceivedSatang: number, clinicCommittedSatang: number): number | null {
  const balance = netReceivedSatang - clinicCommittedSatang
  return Number.isSafeInteger(balance) ? balance : null
}
