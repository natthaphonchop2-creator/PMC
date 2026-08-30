import { FileText, HandCoins, ReceiptText, Stethoscope, UserRoundCog, WalletCards } from 'lucide-react'
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
  canSubmitExpense,
  onSelect,
}: {
  canSubmitExpense: boolean
  onSelect: (category: EnabledExpenseCategory) => void
}) {
  return <div className="pmc-expense-card-grid">
    {ENABLED_CARDS.map((card) => canSubmitExpense
      ? <button key={card.category} type="button" aria-label={card.label} onClick={() => onSelect(card.category)}>
        <card.icon aria-hidden="true" />
        <span><strong>{card.label}</strong><small>เพิ่มรายการ</small></span>
      </button>
      : <DeferredCard key={card.category} label={card.label} icon={card.icon} />)}
    {DEFERRED_CARDS.map((card) => <DeferredCard key={card.label} {...card} />)}
  </div>
}

function DeferredCard({ label, icon: Icon }: { label: string; icon: typeof FileText }) {
  return <div className="pmc-expense-card-deferred">
    <Icon aria-hidden="true" />
    <span><strong>{label}</strong><small>เตรียมระบบ</small></span>
  </div>
}
