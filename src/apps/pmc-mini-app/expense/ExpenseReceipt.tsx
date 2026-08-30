import { Check } from 'lucide-react'
import type { ExpenseReceipt } from '../../../../shared/pmcExpense'
import { expenseCategoryLabel } from './expenseModel'

export function ExpenseReceiptView({ receipt, onDone }: { receipt: ExpenseReceipt; onDone: () => void }) {
  return <main className="pmc-expense-receipt">
    <div className="pmc-expense-receipt-mark"><Check aria-hidden="true" /></div>
    <h1>บันทึกแล้ว — ยังไม่ผ่านการตรวจสอบ</h1>
    <p className="pmc-expense-receipt-number">{receipt.receiptNumber}</p>
    <dl>
      <div><dt>ประเภท</dt><dd>{expenseCategoryLabel(receipt.category)}</dd></div>
      <div><dt>วันที่รายจ่าย</dt><dd>{receipt.expenseDate}</dd></div>
      <div><dt>จำนวนเงิน</dt><dd>{formatSatang(receipt.amountSatang)}</dd></div>
      {receipt.revision > 1 && <div><dt>ฉบับที่</dt><dd>{receipt.revision}</dd></div>}
    </dl>
    <p className="pmc-expense-receipt-note">รายการและรูปหลักฐานถูกบันทึกเรียบร้อย</p>
    <button type="button" onClick={onDone}>กลับหน้ารายงาน</button>
  </main>
}

function formatSatang(value: number): string {
  return `${new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} บาท`
}
