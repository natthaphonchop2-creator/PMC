import {
  Banknote,
  CalendarRange,
  ChevronRight,
  LockKeyhole,
} from 'lucide-react'
import type { EnabledExpenseCategory } from '../../../shared/pmcExpense'
import { BrandMark } from './BrandMark'
import { ExpenseCards } from './expense/ExpenseCards'

export type FinanceReportView = 'DAILY_INCOME' | 'MONTHLY_INCOME'

export function FinanceReportHome({
  canViewFinance,
  expenseCaptureEnabled = false,
  canSubmitExpense = false,
  onSelect,
  onSelectExpense = () => undefined,
}: {
  canViewFinance: boolean
  expenseCaptureEnabled?: boolean
  canSubmitExpense?: boolean
  onSelect: (view: FinanceReportView) => void
  onSelectExpense?: (category: EnabledExpenseCategory) => void
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
      <ExpenseCards
        canSubmitExpense={expenseCaptureEnabled && canSubmitExpense}
        onSelect={onSelectExpense}
      />
    </section>
  </main>
}
