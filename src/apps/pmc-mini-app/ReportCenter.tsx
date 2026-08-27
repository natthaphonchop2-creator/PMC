import {
  BanknoteArrowDown,
  CalendarCheck2,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  LayoutGrid,
  ReceiptText,
  ArrowLeft,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { ReportFilters } from './ReportFilters'
import type { ReportFilterOptions, ReportFilterState, ReportSelection } from './reports'

const REPORT_CARDS = [
  { type: 'TODAY_SUMMARY' as const, label: 'สรุปวันนี้', description: 'ภาพรวมยอดและคิว', icon: ChartNoAxesCombined },
  { type: 'PAYMENT' as const, label: 'ยอดรับชำระ', description: 'ยอดชำระและช่องทางเงิน', icon: CircleDollarSign },
  { type: 'DEPOSIT' as const, label: 'มัดจำ', description: 'เงินสดและมัดจำสินค้า', icon: ReceiptText },
  { type: 'REFUND' as const, label: 'คืนเงิน', description: 'รายการและยอดคืน', icon: BanknoteArrowDown },
  { type: 'APPOINTMENT' as const, label: 'นัดหมาย', description: 'จำนวนคิวและสถานะ', icon: CalendarCheck2 },
  { type: 'ADDITIONAL' as const, label: 'รายงานเพิ่มเติม', description: 'OPD สินค้า และคอร์ส', icon: LayoutGrid },
]

export function ReportCenter({
  filters,
  onFiltersChange,
  onSelect,
  options,
}: {
  filters: ReportFilterState
  onFiltersChange: (value: ReportFilterState) => void
  onSelect: (selection: ReportSelection) => void
  options?: ReportFilterOptions
}) {
  return (
    <main className="pmc-report-center">
      <header className="pmc-report-center-header">
        <BrandMark />
        <p lang="en">REPORT CENTER</p>
        <h1>รายงานคลินิก</h1>
        <span>ข้อมูลจาก JERA Production แบบอ่านอย่างเดียว</span>
      </header>
      <ReportFilters reportType="TODAY_SUMMARY" value={filters} onChange={onFiltersChange} options={options} />
      <section className="pmc-report-card-grid" aria-label="ประเภทรายงาน">
        {REPORT_CARDS.map((report) => <button key={report.type} type="button" aria-label={report.label} onClick={() => onSelect(report.type)}>
          <span className="pmc-report-card-icon"><report.icon aria-hidden="true" /></span>
          <strong>{report.label}</strong>
          <small>{report.description}</small>
          <ChevronRight aria-hidden="true" />
        </button>)}
      </section>
    </main>
  )
}

const ADDITIONAL_REPORTS = [
  { type: 'PRODUCT_USE' as const, label: 'การใช้สินค้าและบริการ' },
  { type: 'PRODUCT_SALES' as const, label: 'ยอดขายสินค้าและบริการ' },
  { type: 'CANCELLED_PAYMENT' as const, label: 'รับชำระที่ยกเลิก' },
  { type: 'OPD' as const, label: 'รายงาน OPD' },
  { type: 'CANCELLED_UNPAID' as const, label: 'ค้างชำระที่ยกเลิก' },
  { type: 'COURSE_SALES' as const, label: 'ยอดขายคอร์ส' },
  { type: 'REMAINING_COURSE' as const, label: 'คอร์สคงเหลือ' },
  { type: 'REMAINING_COURSE_BY_DATE' as const, label: 'คอร์สคงเหลือตามวันที่' },
]

export function AdditionalReportMenu({ onBack, onSelect }: {
  onBack: () => void
  onSelect: (selection: ReportSelection) => void
}) {
  return <main className="pmc-additional-report-menu">
    <header className="pmc-report-page-header">
      <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงาน" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      <div><p lang="en">JERA REPORT</p><h1>รายงานเพิ่มเติม</h1></div>
    </header>
    <p className="pmc-additional-report-intro">เลือกข้อมูลที่ต้องการดู</p>
    <section aria-label="รายการรายงานเพิ่มเติม">
      {ADDITIONAL_REPORTS.map((report) => <button key={report.type} type="button" aria-label={report.label} onClick={() => onSelect(report.type)}>
        <span><strong>{report.label}</strong><small>ดูข้อมูลจาก JERA</small></span><ChevronRight aria-hidden="true" />
      </button>)}
    </section>
  </main>
}
