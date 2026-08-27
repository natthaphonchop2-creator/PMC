import { CalendarDays, ChartNoAxesCombined, ChevronRight, PackageOpen, Plus, UserRound } from 'lucide-react'
import { BrandMark } from './BrandMark'
import type { MiniAppSession } from './contracts'

export type MiniAppHomeAction = 'BOOKING' | 'REPORTS' | 'ACCOUNT'

export function Home({ session, onAction }: {
  session: MiniAppSession
  onAction?: (action: MiniAppHomeAction) => void
}) {
  return (
    <main className="pmc-mini-app-home">
      <header className="pmc-mini-app-header">
        <BrandMark />
        <h1>สวัสดี, {session.displayName}</h1>
        <p>จัดการงานจองและรายงานของคลินิก</p>
      </header>

      <section className="pmc-home-primary-card" aria-labelledby="booking-card-title">
        <div className="pmc-primary-card-copy">
          <h2 id="booking-card-title">ลงนัดหมาย</h2>
          <p>สร้างรายการจองและแนบหลักฐานลูกค้า</p>
          <button type="button" onClick={() => onAction?.('BOOKING')}>เริ่มลงนัด <Plus aria-hidden="true" /></button>
        </div>
        <div className="pmc-primary-card-art" aria-hidden="true"><CalendarDays /></div>
      </section>

      <section className="pmc-home-quick-grid" aria-label="ทางลัด">
        <button type="button" className="pmc-home-quick-card" aria-label="รายงาน JERA" onClick={() => onAction?.('REPORTS')}>
          <span className="pmc-card-icon"><ChartNoAxesCombined aria-hidden="true" /></span>
          <strong>รายงาน JERA</strong>
          <small>ดูข้อมูลรายงานของคลินิก</small>
          <ChevronRight className="pmc-card-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="pmc-home-quick-card unavailable" aria-label="Stock" disabled>
          <span className="pmc-card-icon"><PackageOpen aria-hidden="true" /></span>
          <strong>Stock</strong>
          <small>ยังไม่เปิดใช้งาน</small>
        </button>
      </section>

      <button type="button" className="pmc-home-account-card" aria-label="บัญชีผู้ใช้" onClick={() => onAction?.('ACCOUNT')}>
        <span className="pmc-card-icon"><UserRound aria-hidden="true" /></span>
        <span><strong>บัญชีผู้ใช้</strong><small>ดูชื่อผู้ใช้งานและทางเลือกสำรอง</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </main>
  )
}
