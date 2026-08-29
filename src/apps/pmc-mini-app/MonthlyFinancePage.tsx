import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import type { MonthlyIncomeProjection } from '../../../shared/pmcFinance'
import {
  defaultFinanceMonthSelection,
  financeMonthSelectionError,
  type FinanceDailyFilter,
  type FinanceMonthSelection,
} from './financeReports'
import { formatBaht } from './reportFormatting'

export interface MonthlyIncomePageAdapter {
  load(selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
}

export function MonthlyFinancePage({
  canViewFinance,
  bangkokDate,
  adapter,
  onBack,
  onDrillDown,
  initialSelection,
  onSelectionChange,
}: {
  canViewFinance: boolean
  bangkokDate: string
  adapter: MonthlyIncomePageAdapter
  onBack: () => void
  onDrillDown: (filter: FinanceDailyFilter) => void
  initialSelection?: FinanceMonthSelection
  onSelectionChange?: (selection: FinanceMonthSelection) => void
}) {
  const [selection, setSelection] = useState(() => initialSelection ?? defaultFinanceMonthSelection(bangkokDate))
  const [projection, setProjection] = useState<MonthlyIncomeProjection | null>(null)
  const [loading, setLoading] = useState(canViewFinance)
  const [error, setError] = useState('')
  const requestEpochRef = useRef(0)

  useEffect(() => {
    if (!canViewFinance) return
    const requestEpoch = ++requestEpochRef.current
    onSelectionChange?.(selection)
    if (financeMonthSelectionError(selection)) return
    void adapter.load(selection).then((next) => {
      if (requestEpoch === requestEpochRef.current) setProjection(next)
    }).catch(() => {
      if (requestEpoch !== requestEpochRef.current) return
      setError(projection ? 'โหลดข้อมูลไม่สำเร็จ ข้อมูลล่าสุดยังแสดงอยู่ กรุณาลองอีกครั้ง' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')
    }).finally(() => {
      if (requestEpoch === requestEpochRef.current) setLoading(false)
    })
  // Keep the last successful projection visible when a later month load fails.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, canViewFinance, onSelectionChange, selection])

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
      <div><h1>รายงานรายเดือน</h1><p>ภาพรวมรายรับของฝ่ายการเงิน</p></div>
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
            setLoading(true)
            setSelection({ year: year!, month: month! })
          }
        }}
      /></label>
    </section>

    {error && <p className="pmc-finance-message error" role="alert">{error}</p>}
    {loading && !projection && <p className="pmc-finance-loading">กำลังโหลดรายงานรายเดือน</p>}
    {projection && <MonthlyIncomeContent projection={projection} onDrillDown={onDrillDown} />}
  </main>
}

function MonthlyIncomeContent({
  projection,
  onDrillDown,
}: {
  projection: MonthlyIncomeProjection
  onDrillDown: (filter: FinanceDailyFilter) => void
}) {
  const categoriesReady = projection.categories.state === 'READY'
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
      <div className="pmc-finance-category-grid">
        <MonthlyCategory label="บริการและคอร์ส" value={categoriesReady ? projection.categories.serviceSatang : null} />
        <MonthlyCategory label="Product" value={categoriesReady ? projection.categories.productSatang : null} />
        <MonthlyCategory label="ยังไม่จัดหมวด" value={categoriesReady ? projection.categories.unclassifiedSatang : null} />
      </div>
    </section>

    <section className="pmc-finance-section pmc-monthly-deferred" aria-labelledby="monthly-deferred-heading">
      <h2 id="monthly-deferred-heading">ส่วนที่กำลังเตรียม</h2>
      <p>รายจ่ายที่บันทึก — เตรียมระบบ</p>
      <p>คงเหลือโดยประมาณ — เตรียมระบบ</p>
    </section>
  </div>
}

function MonthlyDefinition({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{formatBaht(value)}</dd></div>
}

function MonthlyCategory({ label, value }: { label: string; value: number | null }) {
  return <article><span>{label}</span><strong className="pmc-finance-category-value">{formatBaht(value)}</strong></article>
}
