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
  financeReportsEnabled = true,
  financeUiPreviewEnabled = false,
  monthlyReportsEnabled = true,
  financeReadsEnabled = false,
  expenseCaptureEnabled = false,
  canSubmitExpense = false,
  onSelect,
  onSelectExpense = () => undefined,
}: {
  canViewFinance: boolean
  financeReportsEnabled?: boolean
  financeUiPreviewEnabled?: boolean
  monthlyReportsEnabled?: boolean
  financeReadsEnabled?: boolean
  expenseCaptureEnabled?: boolean
  canSubmitExpense?: boolean
  onSelect: (view: FinanceReportView) => void
  onSelectExpense?: (category: EnabledExpenseCategory) => void
}) {
  const revenueStructureVisible = financeReportsEnabled || financeUiPreviewEnabled
  const monthlyIncomeAvailable = revenueStructureVisible && monthlyReportsEnabled
  const monthlyExpenseAvailable = financeReadsEnabled
  const monthlyAvailable = canViewFinance && (monthlyIncomeAvailable || monthlyExpenseAvailable)
  const monthlyExpenseOnly = !monthlyIncomeAvailable && monthlyExpenseAvailable
  return <main className="pmc-finance-home">
    <header className="pmc-finance-header">
      <BrandMark />
      <h1>รายงานคลินิก</h1>
      <p>{financeReportsEnabled ? 'เลือกดูรายรับตามช่วงเวลาที่ต้องการ' : financeUiPreviewEnabled
        ? 'ดูโครงร่างรายรับและบันทึกรายจ่ายของคลินิก'
        : financeReadsEnabled
        ? 'เลือกดูรายจ่ายที่บันทึกตามเดือน'
        : 'เลือกประเภทของรายการรายจ่าย'}</p>
    </header>

    {financeUiPreviewEnabled && !financeReportsEnabled && <p className="pmc-finance-preview-banner" role="status">
      ตัวอย่าง UX/UI — ยังไม่เชื่อมข้อมูลรายรับจริง
    </p>}

    {(revenueStructureVisible || financeReadsEnabled) && <section className="pmc-finance-primary-grid" aria-label={revenueStructureVisible ? 'รายงานรายรับ' : 'รายงานรายจ่าย'}>
      {revenueStructureVisible && <button type="button" onClick={() => onSelect('DAILY_INCOME')}>
        <span className="pmc-finance-card-icon"><Banknote aria-hidden="true" /></span>
        <span><strong>รายรับรายวัน</strong><small>{financeReportsEnabled ? 'วันนี้ เมื่อวาน หรือเลือกช่วงวันที่' : 'ดูโครงร่างหน้ารายงาน'}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>}
      <button
        type="button"
        aria-disabled={!monthlyAvailable || undefined}
        onClick={() => { if (monthlyAvailable) onSelect('MONTHLY_INCOME') }}
      >
        <span className="pmc-finance-card-icon">{monthlyAvailable
          ? <CalendarRange aria-hidden="true" />
          : <LockKeyhole aria-hidden="true" />}</span>
        <span><strong>{monthlyExpenseOnly ? 'รายจ่ายรายเดือน' : revenueStructureVisible ? 'รายงานรายเดือน' : 'รายจ่ายรายเดือน'}</strong><small>{monthlyExpenseOnly
          ? 'ยอดรายจ่ายและประวัติหลักฐาน'
          : revenueStructureVisible && !monthlyReportsEnabled
          ? 'ยังไม่เปิดข้อมูลย้อนหลัง'
          : canViewFinance
            ? revenueStructureVisible ? financeReportsEnabled ? 'สรุปรายรับประจำเดือน' : 'ดูโครงร่างหน้ารายงาน' : 'ยอดรายจ่ายและประวัติหลักฐาน'
            : 'เฉพาะฝ่ายการเงิน'}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </section>}

    <section className="pmc-finance-deferred" aria-labelledby="pmc-finance-deferred-heading">
      <h2 id="pmc-finance-deferred-heading">รายการรายจ่าย</h2>
      <ExpenseCards
        canSubmitExpense={expenseCaptureEnabled && canSubmitExpense}
        onSelect={onSelectExpense}
      />
    </section>
  </main>
}
