import { BarChart3, CheckCircle2, Inbox, Power, Users } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type AnalyticsDashboardProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  pages: ManagedPage[]
  summary: Summary
  view?: 'dashboard' | 'analytics'
}

export function AnalyticsDashboard({
  adsInsight,
  autoMode,
  messages,
  pages,
  summary,
  view = 'dashboard',
}: AnalyticsDashboardProps) {
  const leadingPage = [...pages].sort((a, b) => b.healthScore - a.healthScore)[0]
  const highPriorityUnread = messages.filter((message) => message.unread && message.priority === 'high').length
  const roas = adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'

  return (
    <div className="pa-route-stack">
      <section className="pa-route-metrics" aria-label="Analytics dashboard metrics">
        <MetricCard
          detail={autoMode === 'on' ? 'low-risk publishing guardrails active' : 'suggestions require operator click'}
          icon={Power}
          label="Auto mode"
          tone={autoMode === 'on' ? 'good' : 'neutral'}
          value={autoMode === 'on' ? 'ON' : 'OFF'}
        />
        <MetricCard
          detail={`${summary.pages} connected page${summary.pages === 1 ? '' : 's'}`}
          icon={Users}
          label="Followers"
          tone={summary.followers > 0 ? 'good' : 'watch'}
          value={formatNumber(summary.followers)}
        />
        <MetricCard
          detail={`${highPriorityUnread} high priority unread`}
          icon={Inbox}
          label="Unread"
          tone={summary.unread > 0 ? 'watch' : 'good'}
          value={formatNumber(summary.unread)}
        />
        <MetricCard
          detail={adsInsight ? `Ads bridge ${adsInsight.source.datePreset}` : 'waiting for Ads AI bridge'}
          icon={BarChart3}
          label="Ads ROAS"
          tone={adsInsight ? 'good' : 'neutral'}
          value={roas}
        />
      </section>

      <div className="pa-grid">
        <PageAutomationPanel
          className="pa-span-7"
          subtitle="Page health combined with read-only Ads AI performance for the active page scope."
          title="Joint Ads + Page insight"
        >
          {adsInsight && leadingPage ? (
            <div className="pa-insight-card">
              <div>
                <span className="pa-kicker">{leadingPage.name}</span>
                <h3>{jointInsightTitle(leadingPage, adsInsight.metrics.roas)}</h3>
                <p>
                  {formatNumber(leadingPage.followers)} followers, {leadingPage.engagementRate.toFixed(1)}% engagement,
                  and {formatMoney(adsInsight.metrics.spend)} spend in the Ads AI bridge.
                </p>
              </div>
              <div className="pa-insight-stats">
                <span>ROAS {roas}</span>
                <span>CPA {formatMoney(adsInsight.metrics.cpa)}</span>
                <span>CTR {adsInsight.metrics.ctr.toFixed(2)}%</span>
                <span>Health {Math.round(leadingPage.healthScore)}%</span>
              </div>
            </div>
          ) : (
            <PageAutomationState
              detail={pages.length ? 'Ads AI bridge has not returned a page scope yet.' : 'Connect a Meta page to unlock page and Ads-linked analytics.'}
              tone={pages.length ? 'watch' : 'neutral'}
              title="No joint insight available"
            />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel
          className="pa-span-5"
          subtitle="Operational signals for dashboard triage."
          title={view === 'analytics' ? 'Analytics quality' : 'Command queue'}
        >
          <div className="pa-list">
            <PageAutomationState
              detail={summary.avgHealth ? `${Math.round(summary.avgHealth)}% average page health` : 'No page health returned'}
              tone={summary.avgHealth >= 80 ? 'good' : summary.avgHealth > 0 ? 'watch' : 'neutral'}
              title="Page health"
            />
            <PageAutomationState
              detail={messages.length ? `${messages.length} inbox items loaded` : 'No message data returned by polling'}
              tone={summary.unread > 0 ? 'watch' : 'good'}
              title="Inbox data"
            />
            <PageAutomationState
              detail={adsInsight ? `${adsInsight.recommendations.length} approval-required Ads recommendations` : 'No Ads recommendations available'}
              tone={adsInsight ? 'good' : 'neutral'}
              title="Ads AI context"
            />
          </div>
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-12" subtitle="Top pages by current Page Automation health score." title="Page health scan">
          {pages.length ? (
            <div className="pa-page-health-list compact">
              {pages.slice(0, view === 'analytics' ? 8 : 4).map((page) => (
                <article className="pa-page-health-row" key={page.id}>
                  <div>
                    <strong>{page.name}</strong>
                    <p>{page.handle}</p>
                  </div>
                  <span>{formatNumber(page.followers)} followers</span>
                  <span>{page.engagementRate.toFixed(1)}% engagement</span>
                  <div className="pa-health-meter" aria-label={`${page.name} health ${Math.round(page.healthScore)} percent`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, page.healthScore))}%` }} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="pa-empty-state">
              <CheckCircle2 size={18} />
              <div>
                <strong>No pages to analyze</strong>
                <p>Meta page data or cache data is required before this dashboard can rank page health.</p>
              </div>
            </div>
          )}
        </PageAutomationPanel>
      </div>
    </div>
  )
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  tone,
  value,
}: {
  detail: string
  icon: typeof Power
  label: string
  tone: 'good' | 'watch' | 'neutral'
  value: string
}) {
  return (
    <article className={`pa-route-metric ${tone}`}>
      <span className="pa-route-metric-icon">
        <Icon size={18} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function jointInsightTitle(page: ManagedPage, roas: number) {
  if (page.healthScore >= 85 && roas >= 3) {
    return 'Healthy page with strong paid demand'
  }

  if (page.healthScore < 70 && roas >= 3) {
    return 'Paid demand is stronger than page health'
  }

  if (page.unreadCount > 0) {
    return 'Inbox pressure may be holding back conversion'
  }

  return 'Page and Ads signals are ready for review'
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
