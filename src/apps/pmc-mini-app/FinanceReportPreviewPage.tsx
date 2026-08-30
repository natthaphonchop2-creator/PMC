import { ArrowLeft } from 'lucide-react'
import type { FinanceReportView } from './FinanceReportHome'

export function FinanceReportPreviewPage({
  view,
  onBack,
}: {
  view: FinanceReportView
  onBack: () => void
}) {
  const monthly = view === 'MONTHLY_INCOME'
  return <main className="pmc-finance-page pmc-finance-preview-page">
    <header className="pmc-finance-page-header">
      <button type="button" className="pmc-icon-button" aria-label="กลับไปรายงาน" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div>
        <h1>{monthly ? 'รายงานรายเดือน' : 'รายรับรายวัน'}</h1>
        <p>{monthly ? 'ภาพรวมรายรับและรายจ่ายประจำเดือน' : 'ยอดรับชำระตามวันที่'}</p>
      </div>
    </header>

    <aside className="pmc-finance-preview-note" aria-label="สถานะหน้าตัวอย่าง">
      <strong>ตัวอย่าง UX/UI</strong>
      <span>ยังไม่เชื่อมข้อมูลรายรับจริง</span>
    </aside>

    {monthly ? <MonthlyPreview /> : <DailyPreview />}
  </main>
}

function DailyPreview() {
  return <div className="pmc-finance-preview-content">
    <section className="pmc-finance-filter" aria-labelledby="preview-daily-filter-heading">
      <h2 id="preview-daily-filter-heading">ช่วงเวลา</h2>
      <fieldset disabled>
        <legend className="pmc-visually-hidden">ตัวเลือกช่วงเวลาในโครงร่าง</legend>
        <label><input type="radio" name="preview-daily" defaultChecked /><span>วันนี้</span></label>
        <label><input type="radio" name="preview-daily" /><span>เมื่อวาน</span></label>
        <label><input type="radio" name="preview-daily" /><span>เลือกช่วงวันที่</span></label>
      </fieldset>
    </section>

    <PreviewAuthority labels={['ยอดรับชำระ', 'คืนเงิน', 'รับสุทธิ']} />
    <PreviewChannels />
    <PreviewCategories />

    <section className="pmc-finance-section pmc-finance-preview-history" aria-labelledby="preview-payment-list-heading">
      <header><h2 id="preview-payment-list-heading">รายการรับชำระ</h2><p>เรียงจากรายการล่าสุด</p></header>
      <div className="pmc-finance-preview-rows" aria-hidden="true"><i /><i /><i /></div>
    </section>
  </div>
}

function MonthlyPreview() {
  return <div className="pmc-finance-preview-content">
    <section className="pmc-finance-filter pmc-monthly-filter" aria-labelledby="preview-month-filter-heading">
      <h2 id="preview-month-filter-heading">เดือนรายงาน</h2>
      <label><span className="pmc-visually-hidden">เดือนรายงานตัวอย่าง</span><input type="month" disabled /></label>
    </section>

    <PreviewAuthority labels={['รายรับสุทธิ', 'รายจ่ายคลินิก', 'คงเหลือโดยประมาณ']} />

    <section className="pmc-finance-section pmc-finance-preview-trend" aria-labelledby="preview-trend-heading">
      <h2 id="preview-trend-heading">รายรับรายวัน</h2>
      <div className="pmc-finance-preview-bars" aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i />
      </div>
    </section>

    <PreviewChannels />
    <PreviewCategories />
  </div>
}

function PreviewAuthority({ labels }: { labels: [string, string, string] }) {
  return <section className="pmc-finance-authority pmc-finance-preview-authority" aria-label="สรุปยอดตัวอย่าง">
    {labels.map((label) => <article key={label}><span>{label}</span><strong>—</strong></article>)}
  </section>
}

function PreviewChannels() {
  return <section className="pmc-finance-section" aria-labelledby="preview-channels-heading">
    <h2 id="preview-channels-heading">ช่องทางรับชำระ</h2>
    <dl className="pmc-finance-channel-list">
      {['โอน', 'สด', 'Credit', 'อื่น ๆ'].map((label) => <div key={label}><dt>{label}</dt><dd>—</dd></div>)}
    </dl>
  </section>
}

function PreviewCategories() {
  return <section className="pmc-finance-section pmc-finance-categories" aria-labelledby="preview-categories-heading">
    <header><h2 id="preview-categories-heading">หมวดรายรับ</h2><p>แยกยอดตามประเภทบริการ</p></header>
    <div className="pmc-finance-category-grid">
      {['หัตถการและบริการ', 'Product', 'ยังไม่จัดหมวด'].map((label) => <article key={label}><span>{label}</span><strong>—</strong></article>)}
    </div>
  </section>
}
