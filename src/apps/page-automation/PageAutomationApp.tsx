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
import { PageAutomationMetric, PageAutomationPanel, PageAutomationState } from './components'
import { PAGE_AUTOMATION_ROUTES } from './constants'
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
            <span className={`pa-source-pill ${dataSource}`}>{sourceLabel(dataSource)}</span>
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

        {route === 'auto-post' ? (
          <AutoPostPlaceholder adsInsight={adsInsight} autoMode={autoMode} pages={pages} />
        ) : route === 'pages' ? (
          <PagesPlaceholder dataSource={dataSource} pages={pages} />
        ) : route === 'messages' ? (
          <MessagesPlaceholder messages={messages} pages={pages} />
        ) : route === 'analytics' ? (
          <AnalyticsPlaceholder adsInsight={adsInsight} pages={pages} summary={summary} />
        ) : (
          <DashboardPlaceholder
            adsInsight={adsInsight}
            dataSource={dataSource}
            messages={messages}
            pages={pages}
            statusCheckedAt={statusCheckedAt}
            summary={summary}
          />
        )}
      </section>
    </main>
  )
}

function DashboardPlaceholder({
  adsInsight,
  dataSource,
  messages,
  pages,
  statusCheckedAt,
  summary,
}: {
  adsInsight: SharedAdsInsightForPage | null
  dataSource: DataSource
  messages: PageMessage[]
  pages: ManagedPage[]
  statusCheckedAt: string
  summary: Summary
}) {
  const firstPage = pages[0]

  return (
    <div className="pa-grid">
      <PageAutomationPanel
        className="pa-span-7"
        subtitle="Page operations status, Auto guardrails, and first-page Ads AI context."
        title="Command dashboard"
      >
        <div className="pa-state-grid">
          <PageAutomationState
            detail={statusCheckedAt ? `checked ${formatDateTime(statusCheckedAt)}` : 'waiting for status'}
            tone="good"
            title="Backend namespace"
          />
          <PageAutomationState
            detail={sourceLabel(dataSource)}
            tone={dataSource === 'meta' ? 'good' : dataSource === 'cache' ? 'watch' : 'critical'}
            title="Pages source"
          />
          <PageAutomationState
            detail={adsInsight ? `${adsInsight.source.datePreset} checked ${formatDateTime(adsInsight.source.checkedAt)}` : 'no connected page yet'}
            tone={adsInsight ? 'good' : 'neutral'}
            title="Ads AI bridge"
          />
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="Queue view for messages that need operator attention." title="Unified inbox">
        {messages.length ? (
          <div className="pa-list">
            {messages.slice(0, 4).map((message) => (
              <MessageRow key={message.messageId} message={message} />
            ))}
          </div>
        ) : (
          <PageAutomationState detail="No messages returned by the polling endpoint." title="Inbox clear" />
        )}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="First connected page used for Task 7 Ads insight preview." title="Page context">
        {firstPage ? <PageRow page={firstPage} /> : <PageAutomationState detail="Connect a Meta page to populate this panel." title="No page available" />}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-7" subtitle="Read-only metrics from the Ads AI bridge for the selected page scope." title="Ads-linked insight">
        <div className="pa-insight-strip">
          <span>Spend {adsInsight ? formatMoney(adsInsight.metrics.spend) : '-'}</span>
          <span>CPA {adsInsight ? formatMoney(adsInsight.metrics.cpa) : '-'}</span>
          <span>CTR {adsInsight ? `${adsInsight.metrics.ctr.toFixed(2)}%` : '-'}</span>
          <span>Unread {summary.unread}</span>
        </div>
      </PageAutomationPanel>
    </div>
  )
}

function AutoPostPlaceholder({
  adsInsight,
  autoMode,
  pages,
}: {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  pages: ManagedPage[]
}) {
  return (
    <div className="pa-grid">
      <PageAutomationPanel
        className="pa-span-7"
        subtitle="Draft composer and pipeline screens arrive in the route implementation task."
        title="Draft pipeline"
      >
        <div className="pa-pipeline">
          {['Draft', 'Ready', 'Needs Review', 'Scheduled', 'Posted'].map((label, index) => (
            <PageAutomationState
              detail={index === 0 ? `${pages.length} page targets available` : 'pending route screen'}
              key={label}
              title={label}
              tone={index < 2 ? 'good' : index === 2 ? 'watch' : 'neutral'}
            />
          ))}
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="The toggle is local state only in Task 7." title="Auto policy">
        <PageAutomationState
          detail={autoMode === 'on' ? 'Local UI preview is ON. No Meta write endpoint is called.' : 'Suggest-only local UI state.'}
          tone={autoMode === 'on' ? 'watch' : 'neutral'}
          title={autoMode === 'on' ? 'Auto ON preview' : 'Auto OFF'}
        />
        <PageAutomationState
          detail={adsInsight ? 'Ads insight is available for guardrail display.' : 'Ads insight waits for a connected page.'}
          tone={adsInsight ? 'good' : 'neutral'}
          title="Ads AI freshness"
        />
      </PageAutomationPanel>
    </div>
  )
}

function PagesPlaceholder({ dataSource, pages }: { dataSource: DataSource; pages: ManagedPage[] }) {
  return (
    <div className="pa-grid">
      <PageAutomationPanel className="pa-span-12" subtitle={`Source: ${sourceLabel(dataSource)}`} title="Connected pages">
        {pages.length ? (
          <div className="pa-list">
            {pages.map((page) => (
              <PageRow key={page.id} page={page} />
            ))}
          </div>
        ) : (
          <PageAutomationState detail="No pages returned from Meta or cache." tone="watch" title="No connected pages" />
        )}
      </PageAutomationPanel>
    </div>
  )
}

function MessagesPlaceholder({ messages, pages }: { messages: PageMessage[]; pages: ManagedPage[] }) {
  return (
    <div className="pa-grid">
      <PageAutomationPanel className="pa-span-7" subtitle="Polling-backed message preview for all connected pages." title="Inbox queue">
        {messages.length ? (
          <div className="pa-list">
            {messages.map((message) => (
              <MessageRow key={message.messageId} message={message} />
            ))}
          </div>
        ) : (
          <PageAutomationState detail="No messages returned by /api/page-automation/messages." title="No open messages" />
        )}
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-5" subtitle="Per-page unread count from the pages endpoint." title="Page SLA">
        <div className="pa-list">
          {pages.slice(0, 5).map((page) => (
            <PageAutomationState
              detail={`${page.unreadCount} unread, ${Math.round(page.responseRate)}% response rate`}
              key={page.id}
              tone={page.unreadCount > 0 ? 'watch' : 'good'}
              title={page.name}
            />
          ))}
          {!pages.length ? <PageAutomationState detail="Connect a page to show SLA state." title="No SLA data" /> : null}
        </div>
      </PageAutomationPanel>
    </div>
  )
}

function AnalyticsPlaceholder({
  adsInsight,
  pages,
  summary,
}: {
  adsInsight: SharedAdsInsightForPage | null
  pages: ManagedPage[]
  summary: Summary
}) {
  return (
    <div className="pa-grid">
      <PageAutomationPanel className="pa-span-8" subtitle="Task 7 placeholder for the full analytics route." title="Analytics overview">
        <div className="pa-insight-strip">
          <span>{summary.pages} pages</span>
          <span>{formatNumber(summary.followers)} followers</span>
          <span>{adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x ROAS` : 'No Ads insight'}</span>
          <span>{summary.avgHealth ? `${Math.round(summary.avgHealth)}% health` : 'No health data'}</span>
        </div>
      </PageAutomationPanel>

      <PageAutomationPanel className="pa-span-4" subtitle="Current page-level metric availability." title="Data quality">
        <div className="pa-list">
          <PageAutomationState detail={`${pages.length} page records loaded`} tone={pages.length ? 'good' : 'watch'} title="Meta pages" />
          <PageAutomationState detail={adsInsight ? adsInsight.source.datePreset : 'No first-page scope'} tone={adsInsight ? 'good' : 'neutral'} title="Ads bridge" />
        </div>
      </PageAutomationPanel>
    </div>
  )
}

function PageRow({ page }: { page: ManagedPage }) {
  return (
    <article className="pa-row">
      <div>
        <strong>{page.name}</strong>
        <p>{page.handle}</p>
      </div>
      <span>{formatNumber(page.followers)} followers</span>
      <span>{page.engagementRate.toFixed(1)}% engagement</span>
      <span>{Math.round(page.healthScore)} health</span>
    </article>
  )
}

function MessageRow({ message }: { message: PageMessage }) {
  return (
    <article className="pa-row">
      <div>
        <strong>{message.customerDisplayName}</strong>
        <p>{message.textExcerpt}</p>
      </div>
      <span>{message.intent}</span>
      <span className={message.priority}>{message.priority}</span>
      <span>{formatDateTime(message.receivedAt)}</span>
    </article>
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

function formatMoney(value: number) {
  return new Intl.NumberFormat('th-TH', {
    currency: 'THB',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value)
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value || '-'

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time))
}
