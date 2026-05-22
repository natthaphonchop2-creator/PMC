import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Home,
  Inbox,
  MessageSquareText,
  Power,
  Search,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchAdsInsight, fetchManagedPages, fetchMessages, fetchPageAutomationStatus, fetchPostDrafts, updatePageAutomationStatus } from './api'
import { PageAutomationMetric, PageAutomationState } from './components'
import { PAGE_AUTOMATION_ROUTES } from './constants'
import { AnalyticsDashboard } from './routes/AnalyticsDashboard'
import { AutoPost } from './routes/AutoPost'
import { InboxWorkspace } from './routes/InboxWorkspace'
import { PageAnalysis } from './routes/PageAnalysis'
import type { AutoMode, ManagedPage, PageAutomationRouteId, PageMessage, PostDraft, SharedAdsInsightForPage } from './types'
import './styles.css'

type LoadState = 'loading' | 'ready' | 'error'
type DataSource = 'meta' | 'cache' | 'unavailable' | 'loading'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

const routeIcons: Record<PageAutomationRouteId, typeof BarChart3> = {
  dashboard: Inbox,
  'auto-post': CalendarClock,
  pages: Search,
  messages: Inbox,
  analytics: BarChart3,
}

const navRoutes = PAGE_AUTOMATION_ROUTES.filter((item) => item.id !== 'messages')

export function PageAutomationApp() {
  const [route, setRoute] = useState<PageAutomationRouteId>(() => routeFromPath(currentPathname()))
  const [autoMode, setAutoMode] = useState<AutoMode>('off')
  const [autoModeSaving, setAutoModeSaving] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [dataSource, setDataSource] = useState<DataSource>('loading')
  const [statusCheckedAt, setStatusCheckedAt] = useState('')
  const [pages, setPages] = useState<ManagedPage[]>([])
  const [messages, setMessages] = useState<PageMessage[]>([])
  const [drafts, setDrafts] = useState<PostDraft[]>([])
  const [adsInsight, setAdsInsight] = useState<SharedAdsInsightForPage | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>()
  const [error, setError] = useState('')

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromPath(currentPathname()))
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      setLoadState('loading')
      setError('')

      try {
        const [status, pageResult, messageResult, draftResult] = await Promise.all([
          fetchPageAutomationStatus(),
          fetchManagedPages(),
          fetchMessages(),
          fetchPostDrafts(),
        ])

        if (!active) return

        setAutoMode(status.autoMode)
        setStatusCheckedAt(status.checkedAt)
        setDataSource(pageResult.source)
        setPages(pageResult.pages)
        setMessages(messageResult.messages)
        setDrafts(draftResult.drafts)
        setLoadState('ready')

        const firstPage = pageResult.pages[0]
        if (!firstPage) {
          setAdsInsight(null)
          return
        }

        const insightResult = await fetchAdsInsight(firstPage.id, firstPage.name)
        if (active) setAdsInsight(insightResult.insight)
      } catch (loadError) {
        if (!active) return
        setLoadState('error')
        setError(loadError instanceof Error ? loadError.message : 'โหลด Page Automation ไม่สำเร็จ')
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (route !== 'dashboard' && route !== 'messages') return undefined

    let active = true
    const pollMessages = async () => {
      try {
        const result = await fetchMessages()
        if (active) setMessages(result.messages)
      } catch {
        // Keep the last known cache visible; the top-level load path owns user-facing errors.
      }
    }

    const timer = window.setInterval(() => void pollMessages(), 30_000)
    void pollMessages()

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [route])

  const summary = useMemo<Summary>(() => {
    const followers = pages.reduce((sum, page) => sum + page.followers, 0)
    const unread = messages.filter((message) => message.unread).length
    const avgHealth = pages.length ? pages.reduce((sum, page) => sum + page.healthScore, 0) / pages.length : 0

    return {
      avgHealth,
      followers,
      pages: pages.length,
      unread,
    }
  }, [messages, pages])

  const sharedRouteProps = { adsInsight, autoMode, messages, pages, summary }

  async function refreshDrafts() {
    const draftResult = await fetchPostDrafts()
    setDrafts(draftResult.drafts)
  }

  async function handleAutoToggle() {
    const nextMode: AutoMode = autoMode === 'on' ? 'off' : 'on'
    setAutoModeSaving(true)
    setError('')

    try {
      const status = await updatePageAutomationStatus(nextMode)
      setAutoMode(status.autoMode)
      setStatusCheckedAt(status.checkedAt)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'บันทึก Auto mode ไม่สำเร็จ')
    } finally {
      setAutoModeSaving(false)
    }
  }

  return (
    <main className="pa-shell">
      <header className="pa-app-topbar">
        <a className="pa-brand-link" href="/" title="กลับ Home">
          <span className="pa-brand-logo-wrap">
            <img src="/pmc-page-auto-logo.png?v=transparent" alt="PMC Page Auto" />
          </span>
          <span>
            <strong>PMC Page Auto</strong>
            <small>ศูนย์จัดการเพจและข้อความ</small>
          </span>
        </a>

        <nav className="pa-app-nav" aria-label="เมนู Page Automation">
          {navRoutes.map((item) => {
            const Icon = routeIcons[item.id]
            const active = route === item.id || (item.id === 'dashboard' && route === 'messages')
            return (
              <a
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : ''}
                href={item.href}
                key={item.id}
                onClick={(event) => {
                  event.preventDefault()
                  window.history.pushState(null, '', item.href)
                  setRoute(item.id)
                }}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>

        <div className="pa-topbar-actions">
          <span className={`pa-source-pill ${dataSource}`} title={statusCheckedAt ? `ตรวจสถานะล่าสุด ${statusCheckedAt}` : sourceLabel(dataSource)}>
            {sourceLabel(dataSource)}
          </span>
          <button
            aria-pressed={autoMode === 'on'}
            className={`pa-auto-toggle ${autoMode}`}
            disabled={autoModeSaving}
            onClick={() => void handleAutoToggle()}
            type="button"
          >
            <Power size={16} />
            <span>{autoMode === 'on' ? 'Auto เปิด' : 'Auto ปิด'}</span>
            <small>{autoModeSaving ? 'กำลังบันทึก' : 'ทีมตรวจได้ก่อนส่ง'}</small>
          </button>
          <a className="pa-home-link" href="/" aria-label="กลับหน้า Home">
            <Home size={15} />
            <span>กลับ Home</span>
          </a>
        </div>
      </header>

      <section className="pa-main">
        {error ? <div className="pa-error" role="alert">{error}</div> : null}

        <section className="pa-metric-grid" aria-label="Page Automation summary">
          <PageAutomationMetric
            detail={dataSource === 'unavailable' ? 'เชื่อมต่อ Meta ไม่สำเร็จ' : `${formatNumber(summary.pages)} เพจที่เชื่อมต่อ`}
            icon={Users}
            label="ผู้ติดตามรวม"
            tone={summary.pages > 0 ? 'good' : 'watch'}
            value={formatNumber(summary.followers)}
          />
          <PageAutomationMetric
            detail="ข้อความที่ยังไม่ได้อ่าน"
            icon={MessageSquareText}
            label="ข้อความรอตอบ"
            tone={summary.unread > 0 ? 'watch' : 'good'}
            value={formatNumber(summary.unread)}
          />
          <PageAutomationMetric
            detail="คะแนนสุขภาพเพจเฉลี่ย"
            icon={CheckCircle2}
            label="สุขภาพเพจ"
            tone={summary.avgHealth >= 80 ? 'good' : summary.avgHealth > 0 ? 'watch' : 'neutral'}
            value={summary.avgHealth ? `${Math.round(summary.avgHealth)}%` : '-'}
          />
          <PageAutomationMetric
            detail={adsInsight ? 'ใช้เป็นบริบทประกอบคำแนะนำ' : 'รอข้อมูลเพจแรก'}
            icon={BarChart3}
            label="Ads ROAS"
            tone={adsInsight ? 'good' : 'neutral'}
            value={adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'}
          />
        </section>

        {loadState === 'loading' ? (
          <PageAutomationState detail="กำลังดึงข้อมูลเพจ ข้อความ และสถานะ Auto ล่าสุด" title="กำลังโหลดข้อมูลเพจ" />
        ) : null}

        {route === 'auto-post' ? <AutoPost {...sharedRouteProps} drafts={drafts} onDraftsChanged={refreshDrafts} /> : null}
        {route === 'pages' ? <PageAnalysis {...sharedRouteProps} /> : null}
        {route === 'messages' ? (
          <InboxWorkspace {...sharedRouteProps} onSelectedMessageChange={setSelectedMessageId} selectedMessageId={selectedMessageId} />
        ) : null}
        {route === 'analytics' ? <AnalyticsDashboard {...sharedRouteProps} view="analytics" /> : null}
        {route === 'dashboard' ? (
          <InboxWorkspace {...sharedRouteProps} onSelectedMessageChange={setSelectedMessageId} selectedMessageId={selectedMessageId} />
        ) : null}
      </section>
    </main>
  )
}

function routeFromPath(pathname: string): PageAutomationRouteId {
  if (pathname.includes('/page-automation/auto-post')) return 'auto-post'
  if (pathname.includes('/page-automation/pages')) return 'pages'
  if (pathname.includes('/page-automation/messages')) return 'messages'
  if (pathname.includes('/page-automation/analytics')) return 'analytics'
  return 'dashboard'
}

function currentPathname() {
  return typeof window === 'undefined' ? '/page-automation' : window.location.pathname
}

function sourceLabel(source: DataSource) {
  if (source === 'meta') return 'เชื่อมต่อ Meta แล้ว'
  if (source === 'cache') return 'ใช้ข้อมูลล่าสุดที่บันทึกไว้'
  if (source === 'unavailable') return 'เชื่อมต่อ Meta ไม่สำเร็จ'
  return 'กำลังโหลด'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}
