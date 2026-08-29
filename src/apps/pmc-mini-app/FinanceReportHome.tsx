import {
  Banknote,
  CalendarRange,
  ChevronRight,
  FileText,
  HandCoins,
  LockKeyhole,
  ReceiptText,
  Stethoscope,
  UserRoundCog,
  WalletCards,
} from 'lucide-react'
import { BrandMark } from './BrandMark'

export type FinanceReportView = 'DAILY_INCOME' | 'MONTHLY_INCOME'

const EXPENSE_CARDS = [
  { label: 'บิลเอกสาร', icon: FileText },
  { label: 'สมุดรายจ่ายภายในคลินิก', icon: ReceiptText },
  { label: 'สมุดรายจ่ายส่วนตัวหมอ', icon: Stethoscope },
  { label: 'เงินเดือนพนักงาน', icon: WalletCards },
  { label: 'DF พนักงานตามแพ็กเกจ', icon: UserRoundCog },
  { label: 'DF แพทย์', icon: HandCoins },
]

export function FinanceReportHome({
  canViewFinance,
  onSelect,
}: {
  canViewFinance: boolean
  onSelect: (view: FinanceReportView) => void
}) {
  return <main className="pmc-finance-home">
    <header className="pmc-finance-header">
      <BrandMark />
      <h1>รายงานคลินิก</h1>
      <p>เลือกดูรายรับตามช่วงเวลาที่ต้องการ</p>
    </header>

    <section className="pmc-finance-primary-grid" aria-label="รายงานรายรับ">
      <button type="button" onClick={() => onSelect('DAILY_INCOME')}>
        <span className="pmc-finance-card-icon"><Banknote aria-hidden="true" /></span>
        <span><strong>รายรับรายวัน</strong><small>วันนี้ เมื่อวาน หรือเลือกช่วงวันที่</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-disabled={!canViewFinance || undefined}
        onClick={() => { if (canViewFinance) onSelect('MONTHLY_INCOME') }}
      >
        <span className="pmc-finance-card-icon">{canViewFinance
          ? <CalendarRange aria-hidden="true" />
          : <LockKeyhole aria-hidden="true" />}</span>
        <span><strong>รายงานรายเดือน</strong><small>{canViewFinance ? 'สรุปรายรับประจำเดือน' : 'เฉพาะฝ่ายการเงิน'}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </section>

    <section className="pmc-finance-deferred" aria-labelledby="pmc-finance-deferred-heading">
      <h2 id="pmc-finance-deferred-heading">รายการรายจ่าย</h2>
      <div className="pmc-finance-deferred-grid">
        {EXPENSE_CARDS.map((card) => <button
          key={card.label}
          type="button"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
        >
          <card.icon aria-hidden="true" />
          <span><strong>{card.label}</strong><small>เตรียมระบบ</small></span>
        </button>)}
      </div>
    </section>
  </main>
}
