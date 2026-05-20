import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Inbox,
  LineChart,
  MessageSquareText,
  Power,
  Search,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchAdsInsight, fetchManagedPages, fetchMessages, fetchPageAutomationStatus } from './api'
import { PageAutomationMetric, PageAutomationState } from './components'
import { PAGE_AUTOMATION_ROUTES } from './constants'
import { AnalyticsDashboard } from './routes/AnalyticsDashboard'
import { AutoPost } from './routes/AutoPost'
import { Messages } from './routes/Messages'
import { PageAnalysis } from './routes/PageAnalysis'
import type { AutoMode, ManagedPage, PageAutomationRouteId, PageMessage, SharedAdsInsightForPage } from './types'
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
  dashboard: BarChart3,
  'auto-post': CalendarClock,
  pages: Search,
  messages: Inbox,
  analytics: LineChart,
}

export function PageAutomationApp() {
  const [route, setRoute] = useState<PageAutomationRouteId>(() => routeFromPath(currentPathname()))
  const [autoMode, setAutoMode] = useState<AutoMode>('off')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [dataSource, setDataSource] = useState<DataSource>('loading')
  const [statusCheckedAt, setStatusCheckedAt] = useState('')
  const [pages, setPages] = useState<ManagedPage[]>([])
  const [messages, setMessages] = useState<PageMessage[]>([])
  const [adsInsight, setAdsInsight] = useState<SharedAdsInsightForPage | null>(null)
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
        const [status, pageResult, messageResult] = await Promise.all([
          fetchPageAutomationStatus(),
          fetchManagedPages(),
          fetchMessages(),
        ])

        if (!active) return

        setAutoMode(status.autoMode)
        setStatusCheckedAt(status.checkedAt)
        setDataSource(pageResult.source)
        setPages(pageResult.pages)
        setMessages(messageResult.messages)
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

  const activeRoute = PAGE_AUTOMATION_ROUTES.find((item) => item.id === route) ?? PAGE_AUTOMATION_ROUTES[0]
  const sharedRouteProps = { adsInsight, autoMode, messages, pages, summary }

  return (
    <main className="pa-shell">
      <aside className="pa-dock" aria-label="Page Automation navigation">
        <a className="pa-back-link" href="/" title="กลับ PMC Ads Agent">
          PMC
        </a>
        <nav className="pa-dock-nav">
          {PAGE_AUTOMATION_ROUTES.map((item) => {
            const Icon = routeIcons[item.id]
            return (
              <a
                aria-current={route === item.id ? 'page' : undefined}
                className={route === item.id ? 'active' : ''}
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
      </aside>

      <section className="pa-main">
        <header className="pa-topbar">
          <div>
            <span className="pa-eyebrow">Meta API page operations</span>
            <h1>{activeRoute.label}</h1>
            <p>Page Automation แยกจาก PMC Ads Agent สำหรับ Auto Post, วิเคราะห์เพจ, unified inbox และ analytics.</p>
          </div>

          <div className="pa-topbar-actions">
            <span className={`pa-source-pill ${dataSource}`} title={statusCheckedAt ? `Status checked ${statusCheckedAt}` : sourceLabel(dataSource)}>
              {sourceLabel(dataSource)}
            </span>
            <button
              aria-pressed={autoMode === 'on'}
              className={`pa-auto-toggle ${autoMode}`}
              onClick={() => setAutoMode((current) => (current === 'on' ? 'off' : 'on'))}
              type="button"
            >
              <Power size={16} />
              <span>{autoMode === 'on' ? 'Auto ON' : 'Auto OFF'}</span>
              <small>UI only</small>
            </button>
          </div>
        </header>

        {error ? <div className="pa-error" role="alert">{error}</div> : null}

        <section className="pa-metric-grid" aria-label="Page Automation summary">
          <PageAutomationMetric
            detail={dataSource === 'unavailable' ? 'Meta unavailable' : `${summary.pages} connected pages`}
            icon={Users}
            label="ผู้ติดตามรวม"
            tone={summary.pages > 0 ? 'good' : 'watch'}
            value={formatNumber(summary.followers)}
          />
          <PageAutomationMetric
            detail="unread across channels"
            icon={MessageSquareText}
            label="ข้อความรอตอบ"
            tone={summary.unread > 0 ? 'watch' : 'good'}
            value={formatNumber(summary.unread)}
          />
          <PageAutomationMetric
            detail="average page health"
            icon={CheckCircle2}
            label="สุขภาพเพจ"
            tone={summary.avgHealth >= 80 ? 'good' : summary.avgHealth > 0 ? 'watch' : 'neutral'}
            value={summary.avgHealth ? `${Math.round(summary.avgHealth)}%` : '-'}
          />
          <PageAutomationMetric
            detail={adsInsight ? 'read-only Ads AI bridge' : 'waiting for first page'}
            icon={BarChart3}
            label="Ads ROAS"
            tone={adsInsight ? 'good' : 'neutral'}
            value={adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'}
          />
        </section>

        {loadState === 'loading' ? (
          <PageAutomationState detail="กำลังอ่าน status, pages, messages และ Ads AI insight ของเพจแรก" title="Loading Page Automation" />
        ) : null}

        {route === 'auto-post' ? <AutoPost {...sharedRouteProps} /> : null}
        {route === 'pages' ? <PageAnalysis {...sharedRouteProps} /> : null}
        {route === 'messages' ? <Messages {...sharedRouteProps} /> : null}
        {route === 'analytics' ? <AnalyticsDashboard {...sharedRouteProps} view="analytics" /> : null}
        {route === 'dashboard' ? <AnalyticsDashboard {...sharedRouteProps} view="dashboard" /> : null}
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
  if (source === 'meta') return 'Meta live'
  if (source === 'cache') return 'Cache'
  if (source === 'unavailable') return 'Unavailable'
  return 'Loading'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}
