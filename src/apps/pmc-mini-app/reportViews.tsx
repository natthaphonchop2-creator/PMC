import type { JeraReportType } from './reports'
import { formatBaht } from './reportFormatting'

export interface ReportDisplayRow {
  sourceUuid: string
  eventDate: string
  patientName: string | null
  patientCode?: string | null
  paymentCode: string | null
  itemName?: string | null
  itemCode?: string | null
  status: string | null
  paidAmountSatang: number | null
  refundAmountSatang: number | null
  remainingValueSatang?: number | null
}

export interface ReportProjection {
  totals: Record<string, number>
  rows?: ReportDisplayRow[]
  breakdowns?: Record<string, Array<{ key: string; label: string; count: number; paidAmountSatang?: number; refundAmountSatang?: number }>>
  warnings?: string[]
}

export function ReportView({ reportType, data }: { reportType: JeraReportType; data: unknown }) {
  const report = projection(data)
  const metrics = reportMetrics(reportType, report.totals)
  const rows = report.rows ?? []
  return (
    <div className="pmc-report-content">
      <section className="pmc-report-kpi-grid" aria-label="ตัวเลขสรุป">
        {metrics.map((metric) => <article key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.money ? formatBaht(metric.value) : formatCount(metric.value)}</strong>
        </article>)}
      </section>
      <CompactBreakdown breakdowns={report.breakdowns} />
      {rows.length > 0 && (reportType === 'REFUND'
        ? <RefundRows rows={rows} />
        : <ReportRows rows={rows} />)}
    </div>
  )
}

export function RefundRows({ rows }: { rows: ReportDisplayRow[] }) {
  return <ReportRows rows={rows} amount="REFUND" />
}

export function ReportRows({ rows, amount = 'PAID' }: { rows: ReportDisplayRow[]; amount?: 'PAID' | 'REFUND' | 'REMAINING' }) {
  const visibleRows = rows.slice(0, 100)
  return (
    <section className="pmc-report-table-section" aria-labelledby="report-row-title">
      <div className="pmc-report-section-heading"><h2 id="report-row-title">รายละเอียด</h2><span>{rows.length} รายการ</span></div>
      <div className="pmc-report-table-scroll" tabIndex={0} role="region" aria-label="ตารางรายละเอียดรายงาน">
        <table>
          <thead><tr><th>วันที่</th><th>ลูกค้า / รายการ</th><th>เลขที่</th><th>สถานะ</th><th>จำนวน</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.sourceUuid}>
            <td>{formatThaiDate(row.eventDate)}</td>
            <td>{row.patientName ?? row.itemName ?? 'ไม่ระบุ'}</td>
            <td>{row.paymentCode ?? row.itemCode ?? '—'}</td>
            <td>{row.status ?? '—'}</td>
            <td>{formatBaht(amount === 'REFUND'
              ? row.refundAmountSatang
              : amount === 'REMAINING' ? row.remainingValueSatang ?? null : row.paidAmountSatang)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > visibleRows.length && <p className="pmc-report-limit-note">แสดง 100 รายการแรก กรุณาปรับช่วงเวลาเพื่อดูรายการที่เหลือ</p>}
    </section>
  )
}

function projection(value: unknown): ReportProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { totals: {} }
  const object = value as Record<string, unknown>
  const totals = object.totals && typeof object.totals === 'object' && !Array.isArray(object.totals)
    ? object.totals as Record<string, number> : {}
  const rows = Array.isArray(object.rows) ? object.rows as ReportDisplayRow[] : undefined
  const breakdowns = object.breakdowns && typeof object.breakdowns === 'object' && !Array.isArray(object.breakdowns)
    ? object.breakdowns as ReportProjection['breakdowns'] : undefined
  const warnings = Array.isArray(object.warnings) ? object.warnings.map(String) : undefined
  return { totals, rows, breakdowns, warnings }
}

function reportMetrics(reportType: JeraReportType, totals: Record<string, number>) {
  if (reportType === 'TODAY_SUMMARY') return [
    metric('ยอดรับ', totals.receivedSatang, true), metric('มัดจำ', totals.depositSatang, true),
    metric('คืนเงิน', totals.refundSatang, true), metric('นัดหมาย', totals.appointmentCount, false),
  ]
  if (reportType === 'APPOINTMENT') return [metric('นัดหมายทั้งหมด', totals.appointmentCount, false)]
  if (reportType === 'REFUND') return [
    metric('ยอดคืน', totals.refundAmountSatang, true), metric('รายการ', totals.rowCount, false),
  ]
  if (reportType === 'DEPOSIT') return [
    metric('รับมัดจำ', totals.paidAmountSatang, true), metric('คืนมัดจำ', totals.refundAmountSatang, true),
    metric('สุทธิ', totals.netSatang, true), metric('รายการ', totals.rowCount, false),
  ]
  if (reportType === 'REMAINING_COURSE' || reportType === 'REMAINING_COURSE_BY_DATE') return [
    metric('มูลค่าคงเหลือ', totals.remainingValueSatang, true), metric('จำนวนคงเหลือ', totals.remainingQuantity, false),
    metric('รายการ', totals.rowCount, false),
  ]
  return [
    metric('ยอดรับ', totals.paidAmountSatang, true), metric('ยอดรวม', totals.totalSatang, true),
    metric('คืนเงิน', totals.refundAmountSatang, true), metric('รายการ', totals.rowCount, false),
  ]
}

function metric(label: string, value: number | undefined, money: boolean) {
  return { label, value: Number.isFinite(value) ? Number(value) : 0, money }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)
}

function formatThaiDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date)
}

function CompactBreakdown({ breakdowns }: { breakdowns: ReportProjection['breakdowns'] }) {
  const first = Object.values(breakdowns ?? {}).find((items) => items.length > 0)
  if (!first) return null
  return <section className="pmc-report-breakdown" aria-labelledby="report-breakdown-title">
    <div className="pmc-report-section-heading"><h2 id="report-breakdown-title">สรุปแยก</h2><span>สูงสุด 5 รายการ</span></div>
    <ul>{first.slice(0, 5).map((item) => <li key={item.key}>
      <span>{item.label}</span><strong>{item.paidAmountSatang !== undefined ? formatBaht(item.paidAmountSatang) : `${item.count} รายการ`}</strong>
    </li>)}</ul>
  </section>
}
