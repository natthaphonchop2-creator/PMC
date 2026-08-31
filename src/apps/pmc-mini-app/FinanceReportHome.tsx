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
  const expenseRecordingAvailable = expenseCaptureEnabled && canSubmitExpense
  return <main className="pmc-finance-home">
    <header className="pmc-finance-header">
      <BrandMark />
      <h1>รายงานคลินิก</h1>
      <p>{revenueStructureVisible && expenseRecordingAvailable ? 'ดูรายงานและบันทึกรายจ่ายของคลินิก' : financeReportsEnabled
        ? 'เลือกดูข้อมูลการเงินตามช่วงเวลา' : financeUiPreviewEnabled
        ? 'ดูโครงร่างรายงานและรายการรายจ่ายของคลินิก'
        : financeReadsEnabled
        ? 'ดูยอดรายจ่ายและประวัติหลักฐาน'
        : expenseCaptureEnabled && !canSubmitExpense
        ? 'บัญชีนี้ยังไม่มีสิทธิ์บันทึกรายจ่าย'
        : 'เลือกประเภทเพื่อบันทึกรายจ่าย'}</p>
    </header>

    {financeUiPreviewEnabled && !financeReportsEnabled && <p className="pmc-finance-preview-banner" role="status">
      ตัวอย่าง UX/UI — ยังไม่เชื่อมข้อมูลรายรับจริง
    </p>}

    {(revenueStructureVisible || financeReadsEnabled) && <section className="pmc-finance-menu-section" aria-labelledby="pmc-finance-report-heading">
      <header className="pmc-finance-section-heading">
        <div>
          <h2 id="pmc-finance-report-heading">ดูรายงาน</h2>
          <p>ตรวจยอดตามวันหรือเดือน</p>
        </div>
      </header>
      <ul className="pmc-finance-action-list" role="list">
        {revenueStructureVisible && <li><button type="button" onClick={() => onSelect('DAILY_INCOME')}>
          <span className="pmc-finance-card-icon"><Banknote aria-hidden="true" /></span>
          <span className="pmc-finance-row-copy"><strong>รายรับรายวัน</strong><small>{financeReportsEnabled ? 'วันนี้ เมื่อวาน หรือเลือกช่วงวันที่' : 'ดูโครงร่างหน้ารายงาน'}</small></span>
          <span className="pmc-finance-row-end"><span className="pmc-finance-row-action">ดูรายงาน</span><ChevronRight aria-hidden="true" /></span>
        </button></li>}
        <li><button
          type="button"
          aria-disabled={!monthlyAvailable || undefined}
          onClick={() => { if (monthlyAvailable) onSelect('MONTHLY_INCOME') }}
        >
          <span className="pmc-finance-card-icon"><CalendarRange aria-hidden="true" /></span>
          <span className="pmc-finance-row-copy"><strong>{monthlyExpenseOnly ? 'รายจ่ายรายเดือน' : revenueStructureVisible ? 'รายงานรายเดือน' : 'รายจ่ายรายเดือน'}</strong><small>{monthlyExpenseOnly
            ? 'ยอดรายจ่ายและประวัติหลักฐาน'
            : revenueStructureVisible && !monthlyReportsEnabled
            ? 'ยังไม่เปิดข้อมูลย้อนหลัง'
            : canViewFinance
              ? revenueStructureVisible ? financeReportsEnabled ? 'สรุปรายรับและรายจ่ายประจำเดือน' : 'ดูโครงร่างหน้ารายงาน' : 'ยอดรายจ่ายและประวัติหลักฐาน'
              : 'เฉพาะฝ่ายการเงิน'}</small></span>
          <span className="pmc-finance-row-end">
            <span className={`pmc-finance-row-action${monthlyAvailable ? '' : ' unavailable'}`}>{monthlyAvailable ? 'ดูรายงาน' : 'ยังไม่เปิดใช้'}</span>
            {monthlyAvailable ? <ChevronRight aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
          </span>
        </button></li>
      </ul>
    </section>}

    <ExpenseCards
      canSubmitExpense={expenseRecordingAvailable}
      onSelect={onSelectExpense}
    />
  </main>
}
