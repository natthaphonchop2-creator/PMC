import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, FileChartColumn, House, UserRound } from 'lucide-react'
import { createMiniAppApi, type MiniAppBrowserApi } from './api'
import { BookingWizard, type BookingWizardAdapter } from './BookingWizard'
import type { BookingDraftProjection, MiniAppConfig, MiniAppSession } from './contracts'
import { Home } from './Home'
import { AdditionalReportMenu, ReportCenter } from './ReportCenter'
import { ReportPage, type ReportPageAdapter } from './ReportPage'
import {
  loadReportFilterPreferences,
  saveReportFilterPreferences,
  type ReportFilterState,
  type ReportSelection,
} from './reports'

export type PmcMiniAppApi = MiniAppBrowserApi
type MiniAppView = 'HOME' | 'BOOKING' | 'REPORTS' | 'ACCOUNT'

export function PmcMiniApp({
  initialSession,
  initialConfig,
  api = createMiniAppApi(),
}: {
  initialSession?: MiniAppSession
  initialConfig?: MiniAppConfig
  api?: PmcMiniAppApi
}) {
  const [session, setSession] = useState<MiniAppSession | null>(initialSession ?? null)
  const [config, setConfig] = useState<MiniAppConfig | null>(initialConfig ?? null)
  const [idToken, setIdToken] = useState(initialSession ? 'preview-token' : '')
  const [view, setView] = useState<MiniAppView>('HOME')
  const [draft, setDraft] = useState<BookingDraftProjection | null>(null)
  const [loading, setLoading] = useState(!initialSession)
  const [message, setMessage] = useState('')
  const [reportFilters, setReportFilters] = useState<ReportFilterState>(() => loadReportFilterPreferences())
  const [selectedReport, setSelectedReport] = useState<ReportSelection | null>(null)

  useEffect(() => { saveReportFilterPreferences(reportFilters) }, [reportFilters])

  useEffect(() => {
    if (initialSession) return
    let active = true
    void (async () => {
      try {
        const token = await api.initialize()
        const [nextSession, nextConfig] = await Promise.all([api.loadSession(token), api.loadConfig(token)])
        if (!active) return
        setIdToken(token)
        setSession(nextSession)
        setConfig(nextConfig)
      } catch (error) {
        if (!active) return
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        setMessage(code === 'STAFF_NOT_ALLOWED' ? 'รอผู้ดูแลอนุมัติ' : 'เปิดระบบไม่สำเร็จ กรุณาลองอีกครั้ง')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [api, initialSession])

  const bookingAdapter = useMemo<BookingWizardAdapter>(() => ({
    upload: (draftId, kind, files) => api.upload(idToken, draftId, kind, files),
    save: (draftId, version, input) => api.save(idToken, draftId, version, input),
    confirm: (draftId, version) => api.confirm(idToken, draftId, version),
  }), [api, idToken])

  const reportAdapter = useMemo<ReportPageAdapter>(() => ({
    load: (reportType, filters) => api.loadReport(idToken, reportType, filters),
    refresh: (reportType, filters) => api.refreshReport(idToken, reportType, filters),
  }), [api, idToken])

  const openBooking = async () => {
    if (!config) {
      setMessage('ข้อมูลตั้งค่ายังไม่พร้อม')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const nextDraft = await api.createDraft(idToken)
      setDraft(nextDraft)
      setView('BOOKING')
    } catch {
      setMessage('สร้างรายการจองไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !session) return <Notice>กำลังเปิดระบบ</Notice>
  if (!session) return <Notice>{message || 'รอผู้ดูแลอนุมัติ'}</Notice>
  if (view === 'BOOKING' && config && draft) {
    return <BookingWizard session={session} config={config} draft={draft} adapter={bookingAdapter} onExit={() => { setView('HOME'); setDraft(null) }} />
  }

  return (
    <div className="pmc-mini-app-shell">
      {view === 'HOME' && <Home
        session={session}
        onAction={(action) => {
          if (action === 'BOOKING') void openBooking()
          else setView(action)
        }}
      />}
      {view === 'REPORTS' && (selectedReport === 'ADDITIONAL'
        ? <AdditionalReportMenu onBack={() => setSelectedReport(null)} onSelect={setSelectedReport} />
        : selectedReport
          ? <ReportPage
            reportType={selectedReport}
            filters={reportFilters}
            onFiltersChange={setReportFilters}
            adapter={reportAdapter}
            onBack={() => setSelectedReport(isAdditionalReport(selectedReport) ? 'ADDITIONAL' : null)}
          />
          : <ReportCenter filters={reportFilters} onFiltersChange={setReportFilters} onSelect={setSelectedReport} />)}
      {view === 'ACCOUNT' && <AccountPage session={session} fallbackFormUrl={config?.fallbackFormUrl} />}
      {message && <p className="pmc-shell-alert" role="alert">{message}</p>}
      {loading && session && <div className="pmc-shell-loading" aria-live="polite">กำลังเตรียมรายการ</div>}
      <BottomNavigation view={view} onChange={(next) => {
        if (next === 'BOOKING') void openBooking()
        else {
          if (next === 'REPORTS' && view === 'REPORTS') setSelectedReport(null)
          else { setView(next); if (next !== 'REPORTS') setSelectedReport(null) }
        }
      }} />
    </div>
  )
}

function BottomNavigation({ view, onChange }: { view: MiniAppView; onChange: (view: MiniAppView) => void }) {
  const items = [
    { view: 'HOME' as const, label: 'หน้าหลัก', icon: House },
    { view: 'BOOKING' as const, label: 'ลงนัด', icon: CalendarDays },
    { view: 'REPORTS' as const, label: 'รายงาน', icon: FileChartColumn },
    { view: 'ACCOUNT' as const, label: 'บัญชี', icon: UserRound },
  ]
  return <nav className="pmc-bottom-nav" aria-label="เมนูด้านล่าง">{items.map((item) => <button
    key={item.view} type="button" className={view === item.view ? 'active' : ''} aria-current={view === item.view ? 'page' : undefined}
    onClick={() => onChange(item.view)}
  ><item.icon aria-hidden="true" /><span>{item.label}</span></button>)}</nav>
}

function AccountPage({ session, fallbackFormUrl }: { session: MiniAppSession; fallbackFormUrl?: string }) {
  return <main className="pmc-simple-page"><h1>บัญชี</h1><dl className="pmc-account-list"><div><dt>ชื่อผู้ใช้งาน</dt><dd>{session.displayName}</dd></div><div><dt>สถานะ</dt><dd>ใช้งานได้</dd></div></dl>{fallbackFormUrl && <a className="pmc-fallback-link" href={fallbackFormUrl}>เปิด Google Form สำรอง</a>}</main>
}

function Notice({ children }: { children: string }) {
  return <main className="pmc-mini-app-notice" aria-live="polite"><p>{children}</p></main>
}

function isAdditionalReport(value: ReportSelection): boolean {
  return !['TODAY_SUMMARY', 'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT'].includes(value)
}
