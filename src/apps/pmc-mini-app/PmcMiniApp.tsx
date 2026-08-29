import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, FileChartColumn, House, PackageOpen, UserRound } from 'lucide-react'
import { createMiniAppApi, type MiniAppBrowserApi } from './api'
import { BookingWizard, type BookingWizardAdapter } from './BookingWizard'
import { BookingProcessing, type BookingProcessingAdapter } from './BookingProcessing'
import {
  isBookingTerminalState,
  type BookingDraftProjection,
  type MiniAppConfig,
  type MiniAppSession,
  type StockProductProjection,
} from './contracts'
import { EnrollmentPage } from './EnrollmentPage'
import { Home } from './Home'
import { AdditionalReportMenu, ReportCenter } from './ReportCenter'
import { ReportPage, type ReportPageAdapter } from './ReportPage'
import { StockHome } from './stock/StockHome'
import { StockHistory } from './stock/StockHistory'
import { StockIssueFlow, type StockIssueFlowAdapter } from './stock/StockIssueFlow'
import { StockManager, type StockManagerAdapter } from './stock/StockManager'
import {
  loadReportFilterPreferences,
  saveReportFilterPreferences,
  type ReportFilterState,
  type ReportSelection,
} from './reports'
import type { StockHistoryPage } from '../../../shared/pmcStock'

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
  const [messageTone, setMessageTone] = useState<'ERROR' | 'SUCCESS'>('ERROR')
  const [enrollmentStaff, setEnrollmentStaff] = useState<Array<{ id: string; name: string }> | null>(null)
  const [enrollmentBusy, setEnrollmentBusy] = useState(false)
  const [enrollmentMessage, setEnrollmentMessage] = useState('')
  const [reportFilters, setReportFilters] = useState<ReportFilterState>(() => loadReportFilterPreferences())
  const [selectedReport, setSelectedReport] = useState<ReportSelection | null>(null)
  const openingBookingRef = useRef<Promise<void> | null>(null)
  const [stockProducts, setStockProducts] = useState<StockProductProjection[]>([])
  const [stockView, setStockView] = useState<'HOME' | 'ISSUE' | 'RECEIVE' | 'MANAGE' | 'HISTORY'>('HOME')
  const [stockHistoryPage, setStockHistoryPage] = useState<StockHistoryPage | null>(null)
  const [stockHistoryLoadingMore, setStockHistoryLoadingMore] = useState(false)
  const [stockHistoryMessage, setStockHistoryMessage] = useState('')
  const navigationEpochRef = useRef(0)

  useEffect(() => { saveReportFilterPreferences(reportFilters) }, [reportFilters])

  useEffect(() => {
    if (!message || messageTone !== 'SUCCESS') return
    const timeout = setTimeout(() => setMessage(''), 3_000)
    return () => clearTimeout(timeout)
  }, [message, messageTone])

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
        const activeDraft = await api.loadLatestActiveDraft(token)
        if (!active || !activeDraft) return
        const resumedDraft = await hydrateActiveDraft(api, token, activeDraft)
        if (!active) return
        setDraft(resumedDraft)
        setView('BOOKING')
      } catch (error) {
        if (!active) return
        const code = safeErrorCode(error)
        setMessageTone('ERROR')
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
    uploadEvidenceBatch: (draftId, input) => api.uploadEvidenceBatch(idToken, draftId, input),
    save: (draftId, version, input) => api.save(idToken, draftId, version, input),
    confirm: (draftId, version) => api.confirm(idToken, draftId, version),
    cancel: (draftId, version) => api.cancel(idToken, draftId, version),
  }), [api, idToken])

  const processingAdapter = useMemo<BookingProcessingAdapter>(() => ({
    load: (draftId, signal) => api.loadDraft(idToken, draftId, signal),
  }), [api, idToken])

  const reportAdapter = useMemo<ReportPageAdapter>(() => ({
    load: (reportType, filters) => api.loadReport(idToken, reportType, filters),
    refresh: (reportType, filters) => api.refreshReport(idToken, reportType, filters),
  }), [api, idToken])

  const stockIssueAdapter = useMemo<StockIssueFlowAdapter>(() => ({
    issue: (command) => api.submitStockCommand(idToken, command),
    loadProducts: () => api.loadStockProducts(idToken),
  }), [api, idToken])

  const stockManagerAdapter = useMemo<StockManagerAdapter>(() => ({
    submit: (command) => api.submitStockCommand(idToken, command),
    loadProducts: () => api.loadStockProducts(idToken),
  }), [api, idToken])

  const openBooking = () => {
    if (openingBookingRef.current) return openingBookingRef.current
    const requestEpoch = ++navigationEpochRef.current
    const operation = (async () => {
      if (!config) {
        if (requestEpoch === navigationEpochRef.current) {
          setMessageTone('ERROR')
          setMessage('ข้อมูลตั้งค่ายังไม่พร้อม')
        }
        return
      }
      setLoading(true)
      setMessage('')
      try {
        const activeDraft = await api.loadLatestActiveDraft(idToken)
        const nextDraft = activeDraft ? await hydrateActiveDraft(api, idToken, activeDraft) : await api.createDraft(idToken)
        if (requestEpoch !== navigationEpochRef.current) return
        setDraft(nextDraft)
        setView('BOOKING')
      } catch {
        if (requestEpoch === navigationEpochRef.current) {
          setMessageTone('ERROR')
          setMessage('สร้างรายการจองไม่สำเร็จ กรุณาลองอีกครั้ง')
        }
      } finally {
        if (requestEpoch === navigationEpochRef.current) setLoading(false)
      }
    })()
    openingBookingRef.current = operation
    operation.finally(() => {
      if (openingBookingRef.current === operation) openingBookingRef.current = null
    }).catch(() => undefined)
    return operation
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
      setMessageTone('ERROR')
      setMessage('โหลดรายการสต็อกไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === navigationEpochRef.current) setLoading(false)
    }
  }

  const openStockHistory = async () => {
    const requestEpoch = ++navigationEpochRef.current
    setStockHistoryPage(null)
    setStockHistoryMessage('')
    setLoading(true)
    setMessage('')
    try {
      const page = await api.loadStockHistory(idToken)
      if (requestEpoch !== navigationEpochRef.current) return
      setStockHistoryPage(page)
      setStockView('HISTORY')
    } catch {
      if (requestEpoch !== navigationEpochRef.current) return
      setStockView('HOME')
      setMessageTone('ERROR')
      setMessage('โหลดประวัติ Stock ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (requestEpoch === navigationEpochRef.current) setLoading(false)
    }
  }

  const loadMoreStockHistory = async (cursor: string) => {
    if (stockHistoryLoadingMore) return
    const requestEpoch = navigationEpochRef.current
    setStockHistoryLoadingMore(true)
    setStockHistoryMessage('')
    try {
      const next = await api.loadStockHistory(idToken, cursor)
      if (requestEpoch !== navigationEpochRef.current) return
      setStockHistoryPage((current) => current ? appendHistoryPage(current, next) : next)
    } catch {
      if (requestEpoch === navigationEpochRef.current) {
        setStockHistoryMessage('โหลดประวัติเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
    } finally {
      if (requestEpoch === navigationEpochRef.current) setStockHistoryLoadingMore(false)
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
    if (isAsyncBookingState(draft.state) || isBookingTerminalState(draft.state)) {
      return <BookingProcessing
        draft={draft}
        adapter={processingAdapter}
        onProjection={setDraft}
        onExit={() => { navigateTo('HOME'); setDraft(null) }}
      />
    }
    return <BookingWizard
      session={session}
      config={config}
      draft={draft}
      adapter={bookingAdapter}
      initialStep={draft.state === 'READY_TO_CONFIRM' ? 4 : 0}
      onQueued={() => {
        navigateTo('HOME')
        setDraft(null)
        setMessageTone('SUCCESS')
        setMessage('ทำรายการเรียบร้อย ระบบจะบันทึกภายใน 5 นาที')
      }}
      onConfirmed={() => {
        navigateTo('HOME')
        setDraft(null)
        setMessageTone('SUCCESS')
        setMessage('บันทึกการจองแล้ว')
      }}
      onExit={() => { navigateTo('HOME'); setDraft(null) }}
    />
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
  if (view === 'STOCK' && stockView === 'HISTORY') {
    if (!stockHistoryPage) return <Notice>กำลังโหลดประวัติ Stock</Notice>
    return <StockHistory
      page={stockHistoryPage}
      canManageStock={Boolean(config?.canManageStock)}
      loadingMore={stockHistoryLoadingMore}
      message={stockHistoryMessage}
      onLoadMore={(cursor) => { void loadMoreStockHistory(cursor) }}
      onBack={() => {
        navigationEpochRef.current += 1
        setStockHistoryPage(null)
        setStockHistoryMessage('')
        setStockHistoryLoadingMore(false)
        setStockView('HOME')
      }}
    />
  }
  if (view === 'STOCK' && (stockView === 'RECEIVE' || stockView === 'MANAGE') && config?.canManageStock) {
    return <StockManager
      initialProducts={stockProducts}
      initialMode={stockView}
      adapter={stockManagerAdapter}
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
      {view === 'STOCK' && stockView === 'HOME' && <StockHome
        products={stockProducts}
        canManageStock={Boolean(config?.canManageStock)}
        onIssue={() => { setMessage(''); setStockView('ISSUE') }}
        onManagerAction={(action) => {
          if (!config?.canManageStock) return
          setMessage('')
          setStockView(action)
        }}
        onHistory={() => { void openStockHistory() }}
      />}
      {message && <p
        className={`pmc-shell-alert${messageTone === 'SUCCESS' ? ' success' : ''}`}
        role={messageTone === 'SUCCESS' ? 'status' : 'alert'}
      >{message}</p>}
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

function isAsyncBookingState(state: BookingDraftProjection['state']): boolean {
  return state === 'QUEUED' || state === 'PROCESSING' || state === 'RETRYING' || state === 'CONFIRMING'
}

async function hydrateActiveDraft(
  api: MiniAppBrowserApi,
  idToken: string,
  draft: BookingDraftProjection,
): Promise<BookingDraftProjection> {
  if (draft.state !== 'DRAFT' && draft.state !== 'READY_TO_CONFIRM') return draft
  return api.loadDraft(idToken, draft.draftId)
}

function safeErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function safeRetryAfterSeconds(error: unknown): number {
  if (!error || typeof error !== 'object' || !('retryAfterSeconds' in error)) return 0
  const value = Number(error.retryAfterSeconds)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function appendHistoryPage(current: StockHistoryPage, next: StockHistoryPage): StockHistoryPage {
  const known = new Set(current.documents.map((document) => document.documentId))
  return {
    documents: [...current.documents, ...next.documents.filter((document) => !known.has(document.documentId))],
    nextCursor: next.nextCursor,
  }
}
