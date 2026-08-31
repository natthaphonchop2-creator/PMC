import type { ExpenseMonthlyProjection } from '../../../../shared/pmcExpense'
import { formatBahtFixed } from '../reportFormatting'

export interface MonthlyExpensePanelProps {
  projection: ExpenseMonthlyProjection | null
  loading?: boolean
  error?: 'EMPTY' | 'UNAVAILABLE' | null
  onOpenHistory?: () => void
}

export function MonthlyExpensePanel({
  projection,
  loading = false,
  error = null,
  onOpenHistory,
}: MonthlyExpensePanelProps) {
  return <section className="pmc-finance-section pmc-monthly-expenses" aria-labelledby="monthly-expenses-heading">
    <header>
      <div>
        <h2 id="monthly-expenses-heading">รายจ่ายที่บันทึก</h2>
        <p>เป็นรายการที่บันทึกแล้ว ยังไม่ใช่การอนุมัติหรือการตรวจสอบบัญชี</p>
      </div>
      {onOpenHistory && <button type="button" className="pmc-finance-text-button" onClick={onOpenHistory}>ประวัติรายจ่าย</button>}
    </header>
    {loading && !projection && <p className="pmc-finance-loading" aria-live="polite">กำลังโหลดรายจ่ายที่บันทึก</p>}
    {error === 'EMPTY' && <p className="pmc-finance-message">ยังไม่มีรายจ่ายที่บันทึกในเดือนนี้</p>}
    {error === 'UNAVAILABLE' && <p className="pmc-finance-message error" role="alert">โหลดรายจ่ายที่บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
    {projection && <>
      <dl className="pmc-monthly-expense-summary">
        <div><dt>รายจ่ายคลินิก</dt><dd><strong>{formatBahtFixed(projection.clinicCommittedSatang)}</strong></dd></div>
        <div><dt>รายจ่ายส่วนตัวหมอ</dt><dd><strong>{formatBahtFixed(projection.doctorPersonalCommittedSatang)}</strong></dd></div>
        <div><dt>รายการที่มีผล</dt><dd>{projection.effectiveExpenseCount} รายการ</dd></div>
      </dl>
      <div className="pmc-monthly-expense-categories" aria-label="สรุปหมวดรายจ่ายคลินิก">
        <div><span>บิลเอกสาร</span><strong>{formatBahtFixed(projection.clinicByCategorySatang.BILL_DOCUMENT)}</strong></div>
        <div><span>สมุดรายจ่ายภายในคลินิก</span><strong>{formatBahtFixed(projection.clinicByCategorySatang.BOOK_CLINIC)}</strong></div>
      </div>
      {projection.unreviewed && <p className="pmc-expense-unreviewed">ยังไม่ผ่านการตรวจสอบ</p>}
    </>}
  </section>
}
