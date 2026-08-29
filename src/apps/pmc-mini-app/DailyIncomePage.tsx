import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RotateCw } from 'lucide-react'
import type { DailyIncomeProjection, FinanceComponentFreshness, FinancePaymentRow } from '../../../shared/pmcFinance'
import {
  applyFinanceDailyPreset,
  defaultFinanceDailyFilter,
  financeDailyFilterError,
  type FinanceDailyFilter,
  type FinanceDailyPreset,
} from './financeReports'
import { formatBaht } from './reportFormatting'

export interface DailyIncomePageAdapter {
  load(filter: FinanceDailyFilter): Promise<DailyIncomeProjection>
  refresh(eventDate: string): Promise<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>
}

export function DailyIncomePage({
  bangkokDate,
  adapter,
  onBack,
  initialFilter,
  onFilterChange,
}: {
  bangkokDate: string
  adapter: DailyIncomePageAdapter
  onBack: () => void
  initialFilter?: FinanceDailyFilter
  onFilterChange?: (filter: FinanceDailyFilter) => void
}) {
  const [filter, setFilter] = useState<FinanceDailyFilter>(() => initialFilter ?? defaultFinanceDailyFilter(bangkokDate))
  const [loadedProjection, setLoadedProjection] = useState<{ key: string; value: DailyIncomeProjection } | null>(null)
  const [loading, setLoading] = useState(() => financeDailyFilterError(initialFilter ?? defaultFinanceDailyFilter(bangkokDate)) === null)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'ERROR' | 'STATUS'>('STATUS')
  const requestEpochRef = useRef(0)
  const filterError = financeDailyFilterError(filter)
  const canRefresh = filterError === null && filter.startDate === filter.endDate
  const filterKey = dailyFilterKey(filter)
  const projection = loadedProjection?.key === filterKey ? loadedProjection.value : null

  useEffect(() => {
    const requestEpoch = ++requestEpochRef.current
    const requestKey = dailyFilterKey(filter)
    onFilterChange?.(filter)
    if (financeDailyFilterError(filter)) return
    void adapter.load(filter).then((next) => {
      if (requestEpoch !== requestEpochRef.current) return
      setLoadedProjection({ key: requestKey, value: next })
    }).catch(() => {
      if (requestEpoch !== requestEpochRef.current) return
      setMessageTone('ERROR')
      setMessage(projection ? 'โหลดข้อมูลไม่สำเร็จ ข้อมูลล่าสุดยังแสดงอยู่ กรุณาลองอีกครั้ง' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')
    }).finally(() => {
      if (requestEpoch === requestEpochRef.current) setLoading(false)
    })
  // `projection` is intentionally not a dependency: failed loads retain the last successful cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, filter, onFilterChange])

  const updateFilter = (next: FinanceDailyFilter) => {
    requestEpochRef.current += 1
    setRefreshing(false)
    setMessage('')
    setLoading(financeDailyFilterError(next) === null)
    setFilter(next)
  }
  const choosePreset = (preset: FinanceDailyPreset) => {
    updateFilter(applyFinanceDailyPreset(filter, preset, bangkokDate))
  }
  const refreshSelectedDay = async () => {
    if (!canRefresh || refreshing || loading) return
    const requestEpoch = ++requestEpochRef.current
    const selectedFilter = filter
    const requestKey = dailyFilterKey(selectedFilter)
    setRefreshing(true)
    setMessage('')
    try {
      await adapter.refresh(selectedFilter.startDate)
      if (requestEpoch !== requestEpochRef.current) return
      const next = await adapter.load(selectedFilter)
      if (requestEpoch !== requestEpochRef.current) return
      setLoadedProjection({ key: requestKey, value: next })
      setMessageTone('STATUS')
      setMessage('อัปเดตข้อมูลวันที่เลือกแล้ว')
    } catch {
      if (requestEpoch !== requestEpochRef.current) return
      setMessageTone('ERROR')
      setMessage('อัปเดตไม่สำเร็จ ข้อมูลล่าสุดยังแสดงอยู่ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === requestEpochRef.current) setRefreshing(false)
    }
  }

  return <main className="pmc-finance-page">
    <header className="pmc-finance-page-header">
      <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงาน" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div><h1>รายรับรายวัน</h1><p>ยอดรับชำระตามวันที่</p></div>
    </header>

    <section className="pmc-finance-filter" aria-labelledby="daily-filter-heading">
      <h2 id="daily-filter-heading">ช่วงเวลา</h2>
      <fieldset>
        <legend className="pmc-visually-hidden">เลือกช่วงเวลา</legend>
        <label><input type="radio" name="daily-preset" checked={filter.preset === 'TODAY'} onChange={() => choosePreset('TODAY')} /><span>วันนี้</span></label>
        <label><input type="radio" name="daily-preset" checked={filter.preset === 'YESTERDAY'} onChange={() => choosePreset('YESTERDAY')} /><span>เมื่อวาน</span></label>
        <label><input type="radio" name="daily-preset" checked={filter.preset === 'CUSTOM'} onChange={() => choosePreset('CUSTOM')} /><span>เลือกช่วงวันที่</span></label>
      </fieldset>
      {filter.preset === 'CUSTOM' && <div className="pmc-finance-date-grid">
        <label><span>วันเริ่มต้น</span><input type="date" value={filter.startDate} onChange={(event) => updateFilter({ ...filter, startDate: event.currentTarget.value })} /></label>
        <label><span>วันสิ้นสุด</span><input type="date" value={filter.endDate} onChange={(event) => updateFilter({ ...filter, endDate: event.currentTarget.value })} /></label>
      </div>}
      {filterError && <p className="pmc-finance-filter-error">{filterError}</p>}
      <button type="button" className="pmc-finance-refresh" disabled={!canRefresh || refreshing || loading} onClick={() => { void refreshSelectedDay() }}>
        <RotateCw aria-hidden="true" />{refreshing ? 'กำลังอัปเดต' : 'อัปเดตวันที่เลือก'}
      </button>
      {!canRefresh && !filterError && <p className="pmc-finance-filter-help">อัปเดตได้ครั้งละ 1 วัน</p>}
    </section>

    {message && <p className={`pmc-finance-message ${messageTone === 'ERROR' ? 'error' : ''}`} role={messageTone === 'ERROR' ? 'alert' : 'status'}>{message}</p>}
    {loading && !projection && <p className="pmc-finance-loading">กำลังโหลดรายรับ</p>}
    {projection && <DailyIncomeContent projection={projection} />}
  </main>
}

export function DailyIncomeContent({ projection }: { projection: DailyIncomeProjection }) {
  const paymentDays = groupPaymentsByNewestDay(projection.payments)
  const categoriesReady = projection.categories.state === 'READY'
  const categorySourceLate = projection.warnings.includes('CATEGORY_SOURCE_SNAPSHOT_MISMATCH')
    || projection.freshness.allocation.warningCode === 'CATEGORY_SOURCE_SNAPSHOT_MISMATCH'

  return <div className="pmc-finance-report-content">
    <section className="pmc-finance-authority" aria-label="ยอดรายรับหลัก">
      <article><span>ยอดรับชำระ</span><strong>{formatBaht(projection.receivedSatang)}</strong></article>
      <article><span>คืนเงิน</span><strong>{formatBaht(projection.refundSatang)}</strong></article>
      <article><span>รับสุทธิ</span><strong>{formatBaht(projection.netReceivedSatang)}</strong></article>
    </section>

    <section className="pmc-finance-section pmc-finance-categories" aria-label="หมวดรายรับ ไม่รวมเพิ่มจากยอดรับชำระ">
      <header><h2>หมวดรายรับ</h2><p>เป็นการแบ่งยอดรับชำระ ไม่ได้นำไปรวมเพิ่ม</p></header>
      {!categoriesReady && <div className="pmc-finance-checking">
        <strong>กำลังตรวจสอบหมวด</strong>
        <span>วันที่ยังไม่ครบ: {projection.categories.incompleteDates.join(', ')}</span>
      </div>}
      {categorySourceLate && <p className="pmc-finance-late-warning">ข้อมูลหมวดอาจล่าช้า</p>}
      <div className="pmc-finance-category-grid">
        <FinanceValue label="บริการและคอร์ส" value={categoriesReady ? projection.categories.serviceSatang : null} />
        <FinanceValue label="Product" value={categoriesReady ? projection.categories.productSatang : null} />
        <FinanceValue label="ยังไม่จัดหมวด" value={categoriesReady ? projection.categories.unclassifiedSatang : null} />
      </div>
    </section>

    <section className="pmc-finance-section" aria-label="ช่องทางรับชำระ">
      <h2>ช่องทางรับชำระ</h2>
      <dl className="pmc-finance-channel-list">
        <FinanceDefinition label="โอน" value={projection.channels.transferSatang} />
        <FinanceDefinition label="สด" value={projection.channels.cashSatang} />
        <FinanceDefinition label="Credit" value={projection.channels.creditSatang} />
        <FinanceDefinition label="อื่น ๆ" value={projection.channels.otherSatang} />
      </dl>
      {projection.channels.differenceSatang !== 0 && <p className="pmc-finance-channel-warning" role="alert">
        ยอดช่องทางต่างจากยอดรับชำระ {formatBaht(Math.abs(projection.channels.differenceSatang))}
      </p>}
    </section>

    <FreshnessSection freshness={projection.freshness} />

    <section className="pmc-finance-section pmc-finance-details" aria-labelledby="daily-details-heading">
      <h2 id="daily-details-heading">รายละเอียดรับชำระ</h2>
      {paymentDays.length === 0
        ? <p className="pmc-finance-empty">ไม่มีรายการในช่วงวันที่เลือก</p>
        : paymentDays.map(([date, payments]) => <section key={date} className="pmc-finance-payment-day">
          <h3>{date}</h3>
          <div className="pmc-finance-table-scroll" tabIndex={0}>
            <table>
              <caption className="pmc-visually-hidden">รายการรับชำระวันที่ {date}</caption>
              <thead><tr><th scope="col">เลขที่รับชำระ</th><th scope="col">ลูกค้า</th><th scope="col">ยอดรับ</th><th scope="col">บริการ/คอร์ส</th><th scope="col">Product</th><th scope="col">ยังไม่จัดหมวด</th></tr></thead>
              <tbody>{payments.map((payment) => <tr key={payment.paymentUuid}>
                <td>{payment.paymentCode ?? '—'}</td><td>{payment.patientName ?? '—'}</td><td>{formatBaht(payment.paidAmountSatang)}</td>
                <td>{formatBaht(payment.serviceSatang)}</td><td>{formatBaht(payment.productSatang)}</td><td>{formatBaht(payment.unclassifiedSatang)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>)}
    </section>
  </div>
}

function FinanceValue({ label, value }: { label: string; value: number | null }) {
  return <article><span>{label}</span><strong className="pmc-finance-category-value">{formatBaht(value)}</strong></article>
}

function FinanceDefinition({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{formatBaht(value)}</dd></div>
}

function FreshnessSection({ freshness }: { freshness: DailyIncomeProjection['freshness'] }) {
  return <section className="pmc-finance-section pmc-finance-freshness" aria-labelledby="finance-freshness-heading">
    <h2 id="finance-freshness-heading">สถานะข้อมูล</h2>
    <dl>
      <FreshnessRow label="ข้อมูลรับชำระ" value={freshness.payment} />
      <FreshnessRow label="ข้อมูลคืนเงิน" value={freshness.refund} />
      <FreshnessRow label="ข้อมูลหมวด" value={freshness.allocation} />
    </dl>
  </section>
}

function FreshnessRow({ label, value }: { label: string; value: FinanceComponentFreshness }) {
  return <div><dt>{label}</dt><dd><span>{value.stale ? 'ล่าช้า' : 'พร้อม'}</span>{value.lastSuccessAt
    ? <time dateTime={value.lastSuccessAt}>{formatBangkokTimestamp(value.lastSuccessAt)}</time>
    : <time>ยังไม่เคยซิงก์</time>}</dd></div>
}

function groupPaymentsByNewestDay(payments: FinancePaymentRow[]): Array<[string, FinancePaymentRow[]]> {
  const groups = new Map<string, FinancePaymentRow[]>()
  for (const payment of payments) groups.set(payment.eventDate, [...(groups.get(payment.eventDate) ?? []), payment])
  return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left))
}

function formatBangkokTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'เวลาไม่พร้อม'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function dailyFilterKey(filter: FinanceDailyFilter): string {
  return `${filter.startDate}|${filter.endDate}`
}
