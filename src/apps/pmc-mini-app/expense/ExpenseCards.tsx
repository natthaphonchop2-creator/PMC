import { FileText, HandCoins, Plus, ReceiptText, Stethoscope, UserRoundCog, WalletCards } from 'lucide-react'
import type { EnabledExpenseCategory } from '../../../../shared/pmcExpense'

const ENABLED_CARDS: Array<{ category: EnabledExpenseCategory; label: string; icon: typeof FileText }> = [
  { category: 'BILL_DOCUMENT', label: 'บิลเอกสาร', icon: FileText },
  { category: 'BOOK_CLINIC', label: 'สมุดรายจ่ายภายในคลินิก', icon: ReceiptText },
  { category: 'BOOK_DOCTOR_PERSONAL', label: 'สมุดรายจ่ายส่วนตัวหมอ', icon: Stethoscope },
]

const DEFERRED_CARDS = [
  { label: 'เงินเดือนพนักงาน', icon: WalletCards },
  { label: 'DF พนักงานตามแพ็กเกจ', icon: UserRoundCog },
  { label: 'DF แพทย์', icon: HandCoins },
]

export function ExpenseCards({
  captureEnabled = false,
  canSubmitExpense,
  onSelect,
}: {
  captureEnabled?: boolean
  canSubmitExpense: boolean
  onSelect: (category: EnabledExpenseCategory) => void
}) {
  const inactiveStatus = captureEnabled ? 'ไม่มีสิทธิ์' : 'ยังไม่เปิดใช้'
  const inactiveDescription = captureEnabled ? 'บัญชีนี้ยังบันทึกไม่ได้' : 'ระบบบันทึกรายจ่ายยังไม่เปิด'
  return <>
    <section className="pmc-finance-menu-section" aria-labelledby="pmc-expense-entry-heading">
      <header className="pmc-finance-section-heading">
        <div>
          <h2 id="pmc-expense-entry-heading">บันทึกรายจ่าย</h2>
          <p id="pmc-expense-entry-description">เลือกประเภทเพื่อกรอกข้อมูลและแนบหลักฐาน</p>
        </div>
      </header>
      <ul className="pmc-expense-card-grid" role="list">
        {ENABLED_CARDS.map((card) => <li key={card.category}>{canSubmitExpense
          ? <button
            type="button"
            aria-label={`${card.label} บันทึก`}
            aria-describedby="pmc-expense-entry-description"
            onClick={() => onSelect(card.category)}
          >
            <span className="pmc-expense-row-icon"><card.icon aria-hidden="true" /></span>
            <span className="pmc-expense-row-copy"><strong>{card.label}</strong><small>กรอกข้อมูลและแนบหลักฐาน</small></span>
            <span className="pmc-expense-save-action" aria-hidden="true"><Plus />บันทึก</span>
          </button>
          : <DeferredCard label={card.label} icon={card.icon} description={inactiveDescription} status={inactiveStatus} />}</li>)}
      </ul>
    </section>

    <section className="pmc-finance-menu-section" aria-labelledby="pmc-expense-compensation-heading">
      <header className="pmc-finance-section-heading">
        <div>
          <h2 id="pmc-expense-compensation-heading">ค่าตอบแทน</h2>
          <p>เงินเดือนและค่าแพทย์</p>
        </div>
        <span className="pmc-finance-section-status">เตรียมระบบ</span>
      </header>
      <ul className="pmc-expense-card-grid pmc-expense-compensation-list" role="list">
        {DEFERRED_CARDS.map((card) => <li key={card.label}><DeferredCard {...card} description="ยังไม่เปิดให้บันทึก" status="เตรียมระบบ" /></li>)}
      </ul>
    </section>
  </>
}

function DeferredCard({
  label,
  icon: Icon,
  description,
  status,
}: { label: string; icon: typeof FileText; description: string; status: string }) {
  return <div className="pmc-expense-card-deferred">
    <span className="pmc-expense-row-icon"><Icon aria-hidden="true" /></span>
    <span className="pmc-expense-row-copy"><strong>{label}</strong><small>{description}</small></span>
    <span className="pmc-expense-row-status">{status}</span>
  </div>
}
