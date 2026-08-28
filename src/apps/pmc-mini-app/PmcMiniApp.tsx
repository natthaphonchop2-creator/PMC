import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, FileChartColumn, House, PackageOpen, UserRound } from 'lucide-react'
import { createMiniAppApi, type MiniAppBrowserApi } from './api'
import { BookingWizard, type BookingWizardAdapter } from './BookingWizard'
import type { BookingDraftProjection, MiniAppConfig, MiniAppSession, StockProductProjection } from './contracts'
import { EnrollmentPage } from './EnrollmentPage'
import { Home } from './Home'
import { AdditionalReportMenu, ReportCenter } from './ReportCenter'
import { ReportPage, type ReportPageAdapter } from './ReportPage'
import { StockHome } from './stock/StockHome'
import { StockIssueFlow, type StockIssueFlowAdapter } from './stock/StockIssueFlow'
import {
  loadReportFilterPreferences,
  saveReportFilterPreferences,
  type ReportFilterState,
  type ReportSelection,
} from './reports'

export type PmcMiniAppApi = MiniAppBrowserApi
type MiniAppView = 'HOME' | 'BOOKING' | 'REPORTS' | 'STOCK' | 'ACCOUNT'

export function PmcMiniApp({
  initialSession,
  initialConfig,
  api: suppliedApi,
}: {
  initialSession?: MiniAppSession
  initialConfig?: MiniAppConfig
  api?: PmcMiniAppApi
}) {
  const api = useMemo(() => suppliedApi ?? createMiniAppApi(), [suppliedApi])
  const [session, setSession] = useState<MiniAppSession | null>(initialSession ?? null)
  const [config, setConfig] = useState<MiniAppConfig | null>(initialConfig ?? null)
  const [idToken, setIdToken] = useState(initialSession ? 'preview-token' : '')
  const [view, setView] = useState<MiniAppView>('HOME')
  const [draft, setDraft] = useState<BookingDraftProjection | null>(null)
  const [loading, setLoading] = useState(!initialSession)
  const [message, setMessage] = useState('')
  const [enrollmentStaff, setEnrollmentStaff] = useState<Array<{ id: string; name: string }> | null>(null)
  const [enrollmentBusy, setEnrollmentBusy] = useState(false)
  const [enrollmentMessage, setEnrollmentMessage] = useState('')
  const [reportFilters, setReportFilters] = useState<ReportFilterState>(() => loadReportFilterPreferences())
  const [selectedReport, setSelectedReport] = useState<ReportSelection | null>(null)
  const [stockProducts, setStockProducts] = useState<StockProductProjection[]>([])
  const [stockView, setStockView] = useState<'HOME' | 'ISSUE'>('HOME')
  const navigationEpochRef = useRef(0)

  useEffect(() => { saveReportFilterPreferences(reportFilters) }, [reportFilters])

  useEffect(() => {
    if (initialSession) return
    let active = true
    void (async () => {
      try {
        const token = await api.initialize()
        if (!active) return
        setIdToken(token)
        let nextSession: MiniAppSession
        try {
          nextSession = await api.loadSession(token)
        } catch (error) {
          if (safeErrorCode(error) !== 'STAFF_NOT_ALLOWED') throw error
          const options = await api.loadEnrollmentOptions(token)
          if (!active) return
          setEnrollmentStaff(options.staff)
          setMessage('')
          return
        }
        const nextConfig = await api.loadConfig(token)
        if (!active) return
        setSession(nextSession)
        setConfig(nextConfig)
      } catch (error) {
        if (!active) return
        const code = safeErrorCode(error)
        setMessage(code === 'MINI_APP_ENROLLMENT_UNAVAILABLE' ? 'ระบบผูกบัญชียังไม่พร้อม กรุณาติดต่อผู้ดูแล' : 'เปิดระบบไม่สำเร็จ กรุณาลองอีกครั้ง')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [api, initialSession])

  const bookingAdapter = useMemo<BookingWizardAdapter>(() => ({
    load: (draftId) => api.loadDraft(idToken, draftId),
    upload: (draftId, kind, files) => api.upload(idToken, draftId, kind, files),
    save: (draftId, version, input) => api.save(idToken, draftId, version, input),
    confirm: (draftId, version) => api.confirm(idToken, draftId, version),
    cancel: (draftId, version) => api.cancel(idToken, draftId, version),
  }), [api, idToken])

  const reportAdapter = useMemo<ReportPageAdapter>(() => ({
    load: (reportType, filters) => api.loadReport(idToken, reportType, filters),
    refresh: (reportType, filters) => api.refreshReport(idToken, reportType, filters),
  }), [api, idToken])

  const stockIssueAdapter = useMemo<StockIssueFlowAdapter>(() => ({
    issue: (command) => api.submitStockCommand(idToken, command),
    loadProducts: () => api.loadStockProducts(idToken),
  }), [api, idToken])

  const openBooking = async () => {
    const requestEpoch = ++navigationEpochRef.current
    setLoading(true)
    setMessage('')
    if (!config) {
      if (requestEpoch === navigationEpochRef.current) {
        setLoading(false)
        setMessage('ข้อมูลตั้งค่ายังไม่พร้อม')
      }
      return
    }
    try {
      const nextDraft = await api.createDraft(idToken)
      if (requestEpoch !== navigationEpochRef.current) return
      setDraft(nextDraft)
      setView('BOOKING')
    } catch {
      if (requestEpoch !== navigationEpochRef.current) return
      setMessage('สร้างรายการจองไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === navigationEpochRef.current) setLoading(false)
    }
  }

  const openStock = async () => {
    if (!config?.stockEnabled) return
    const requestEpoch = ++navigationEpochRef.current
    setLoading(true)
    setMessage('')
    try {
      const result = await api.loadStockProducts(idToken)
      if (requestEpoch !== navigationEpochRef.current) return
      setStockProducts(result.products)
      setStockView('HOME')
      setView('STOCK')
    } catch {
      if (requestEpoch !== navigationEpochRef.current) return
      setMessage('โหลดรายการสต็อกไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === navigationEpochRef.current) setLoading(false)
    }
  }

  const navigateTo = (next: MiniAppView) => {
    navigationEpochRef.current += 1
    setLoading(false)
    setMessage('')
    if (next === 'REPORTS' && view === 'REPORTS') {
      setSelectedReport(null)
      return
    }
    setView(next)
    if (next !== 'REPORTS') setSelectedReport(null)
  }

  const linkAccount = async (staffId: string, pin: string) => {
    setEnrollmentBusy(true)
    setEnrollmentMessage('')
    try {
      const nextSession = await api.enroll(idToken, staffId, pin)
      const nextConfig = await api.loadConfig(idToken)
      setSession(nextSession)
      setConfig(nextConfig)
      setEnrollmentStaff(null)
    } catch (error) {
      const code = safeErrorCode(error)
      if (code === 'ENROLLMENT_RATE_LIMITED') {
        const seconds = safeRetryAfterSeconds(error)
        setEnrollmentMessage(`ลอง PIN หลายครั้งเกินไป กรุณารอ ${Math.max(1, Math.ceil(seconds / 60))} นาที`)
      } else if (code === 'ENROLLMENT_STAFF_UNAVAILABLE') {
        setEnrollmentMessage('ชื่อนี้ถูกผูกบัญชีแล้ว กรุณาเลือกชื่ออื่นหรือติดต่อผู้ดูแล')
      } else if (code === 'ENROLLMENT_DENIED') {
        setEnrollmentMessage('PIN ไม่ถูกต้อง กรุณาลองใหม่')
      } else {
        setEnrollmentMessage('ผูกบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
    } finally {
      setEnrollmentBusy(false)
    }
  }

  if (loading && !session) return <Notice>กำลังเปิดระบบ</Notice>
  if (!session && enrollmentStaff) return <EnrollmentPage
    staff={enrollmentStaff}
    busy={enrollmentBusy}
    message={enrollmentMessage}
    onSubmit={linkAccount}
  />
  if (!session) return <Notice>{message || 'รอผู้ดูแลอนุมัติ'}</Notice>
  if (view === 'BOOKING' && config && draft) {
    return <BookingWizard session={session} config={config} draft={draft} adapter={bookingAdapter} onExit={() => { navigateTo('HOME'); setDraft(null) }} />
  }
  if (view === 'STOCK' && stockView === 'ISSUE') {
    return <StockIssueFlow
      initialProducts={stockProducts}
      adapter={stockIssueAdapter}
      onCancel={() => setStockView('HOME')}
      onReturnToStock={(products) => {
        setStockProducts(products)
        setStockView('HOME')
      }}
    />
  }

  return (
    <div className="pmc-mini-app-shell">
      {view === 'HOME' && <Home
        session={session}
        reportingEnabled={Boolean(config?.reportingEnabled)}
        stockEnabled={Boolean(config?.stockEnabled)}
        onAction={(action) => {
          if (action === 'BOOKING') void openBooking()
          else if (action === 'STOCK') void openStock()
          else navigateTo(action)
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
      {view === 'STOCK' && <StockHome
        products={stockProducts}
        canManageStock={Boolean(config?.canManageStock)}
        onIssue={() => { setMessage(''); setStockView('ISSUE') }}
        onManagerAction={(action) => setMessage(action === 'RECEIVE'
          ? 'ขั้นตอนรับเข้าจะเปิดใช้งานในลำดับถัดไป'
          : 'หน้าจัดการสินค้าจะเปิดใช้งานในลำดับถัดไป')}
        onHistory={() => setMessage('ประวัติสต็อกจะเปิดใช้งานในลำดับถัดไป')}
      />}
      {message && <p className="pmc-shell-alert" role="alert">{message}</p>}
      {loading && session && <div className="pmc-shell-loading" aria-live="polite">กำลังเตรียมรายการ</div>}
      <BottomNavigation
        view={view}
        reportingEnabled={Boolean(config?.reportingEnabled)}
        stockEnabled={Boolean(config?.stockEnabled)}
        onChange={(next) => {
        if (next === 'BOOKING') void openBooking()
        else if (next === 'STOCK') void openStock()
        else navigateTo(next)
      }} />
    </div>
  )
}

function BottomNavigation({ view, reportingEnabled, stockEnabled, onChange }: {
  view: MiniAppView
  reportingEnabled: boolean
  stockEnabled: boolean
  onChange: (view: MiniAppView) => void
}) {
  const items = [
    { view: 'HOME' as const, label: 'หน้าหลัก', icon: House },
    { view: 'BOOKING' as const, label: 'ลงนัด', icon: CalendarDays },
    ...(stockEnabled ? [{ view: 'STOCK' as const, label: 'สต็อก', icon: PackageOpen }] : []),
    ...(reportingEnabled ? [{ view: 'REPORTS' as const, label: 'รายงาน', icon: FileChartColumn }] : []),
    { view: 'ACCOUNT' as const, label: 'บัญชี', icon: UserRound },
  ]
  return <nav
    className="pmc-bottom-nav"
    aria-label="เมนูด้านล่าง"
    style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
  >{items.map((item) => <button
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

function safeErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function safeRetryAfterSeconds(error: unknown): number {
  if (!error || typeof error !== 'object' || !('retryAfterSeconds' in error)) return 0
  const value = Number(error.retryAfterSeconds)
  return Number.isFinite(value) && value > 0 ? value : 0
}
