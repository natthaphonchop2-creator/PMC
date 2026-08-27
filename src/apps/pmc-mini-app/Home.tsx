import { CalendarDays, FileChartColumn } from 'lucide-react'
import type { MiniAppSession } from './contracts'
import { BrandMark } from './BrandMark'

export type MiniAppHomeAction = 'BOOKING' | 'REPORTS'

export function Home({ session, onAction }: {
  session: MiniAppSession
  onAction?: (action: MiniAppHomeAction) => void
}) {
  return (
    <main className="pmc-mini-app-home">
      <header className="pmc-mini-app-header">
        <BrandMark />
        <h1>ระบบงานคลินิก</h1>
        <span>สวัสดี {session.displayName}</span>
      </header>

      <section className="pmc-mini-app-actions" aria-label="เมนูหลัก">
        <button type="button" aria-label="ลงนัดหมาย" aria-describedby="booking-action-description" onClick={() => onAction?.('BOOKING')}>
          <CalendarDays aria-hidden="true" />
          <span>
            <strong>ลงนัดหมาย</strong>
            <small id="booking-action-description">บันทึกเคสและแนบหลักฐาน</small>
          </span>
        </button>
        <button type="button" aria-label="รายงาน JERA" aria-describedby="reports-action-description" onClick={() => onAction?.('REPORTS')}>
          <FileChartColumn aria-hidden="true" />
          <span>
            <strong>รายงาน JERA</strong>
            <small id="reports-action-description">ดูข้อมูลจากระบบ JERA</small>
          </span>
        </button>
      </section>
    </main>
  )
}
