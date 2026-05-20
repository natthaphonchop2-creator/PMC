import { Activity, BarChart3, ShieldCheck, Users } from 'lucide-react'
import { PageAutomationPanel, PageAutomationState } from '../components'
import { missingPermissionStates } from '../policy'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type PageAnalysisProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  pages: ManagedPage[]
  summary: Summary
}

export function PageAnalysis({ adsInsight, autoMode, messages, pages, summary }: PageAnalysisProps) {
  const pagesWithUnknownPermissions = pages.filter((page) => page.permissions.length === 0)
  const pagesWithPermissionHints = pages.filter((page) => permissionHints(page).length > 0)
  const hasPermissionNotices = pagesWithUnknownPermissions.length > 0 || pagesWithPermissionHints.length > 0

  return (
    <div className="pa-route-stack">
      <section className="pa-route-metrics" aria-label="Page analysis metrics">
        <MetricCard detail={`${summary.pages} connected`} icon={Users} label="Pages" tone={summary.pages ? 'good' : 'watch'} value={formatNumber(summary.pages)} />
        <MetricCard
          detail="combined page audience"
          icon={Activity}
          label="Followers"
          tone={summary.followers ? 'good' : 'neutral'}
          value={formatNumber(summary.followers)}
        />
        <MetricCard
          detail={`${messages.filter((message) => message.priority === 'high').length} high priority`}
          icon={ShieldCheck}
          label="Unread"
          tone={summary.unread > 0 ? 'watch' : 'good'}
          value={formatNumber(summary.unread)}
        />
        <MetricCard
          detail={autoMode === 'on' ? 'guarded by permissions and freshness' : 'analysis only'}
          icon={BarChart3}
          label="Auto context"
          tone={autoMode === 'on' ? 'watch' : 'neutral'}
          value={autoMode === 'on' ? 'ON' : 'OFF'}
        />
      </section>

      <div className="pa-grid">
        <PageAutomationPanel className="pa-span-8" subtitle="Followers, engagement, unread load, and health by connected page." title="Page health matrix">
          {pages.length ? (
            <div className="pa-page-health-list">
              {pages.map((page) => (
                <article className="pa-page-health-row expanded" key={page.id}>
                  <div>
                    <strong>{page.name}</strong>
                    <p>{page.handle} · {page.platform}</p>
                  </div>
                  <span>{formatNumber(page.followers)} followers</span>
                  <span>{page.engagementRate.toFixed(1)}% engagement</span>
                  <span>{page.unreadCount} unread</span>
                  <div className="pa-health-meter" aria-label={`${page.name} health ${Math.round(page.healthScore)} percent`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, page.healthScore))}%` }} />
                  </div>
                  <strong className={healthClass(page.healthScore)}>{Math.round(page.healthScore)}%</strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="pa-empty-state">
              <Users size={20} />
              <div>
                <strong>No connected pages</strong>
                <p>Meta page data or cache data is required before Page Analysis can calculate health.</p>
              </div>
            </div>
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-4" subtitle="Permission-specific degradation instead of one global error." title="Permission hints">
          {hasPermissionNotices ? (
            <div className="pa-page-permissions">
              {pagesWithUnknownPermissions.map((page) => (
                <article className="pa-permission-hint" key={`${page.id}-unknown`}>
                  <strong>{page.name}</strong>
                  <p>Permission state unknown: no permission reports loaded.</p>
                </article>
              ))}
              {pagesWithPermissionHints.map((page) => (
                <article className="pa-permission-hint" key={page.id}>
                  <strong>{page.name}</strong>
                  <p>{permissionHints(page).slice(0, 3).join(', ')}</p>
                </article>
              ))}
            </div>
          ) : (
            <PageAutomationState
              detail={pages.length ? 'All required permissions reported granted in current page reports.' : 'No page permission reports loaded.'}
              tone={pages.length ? 'good' : 'neutral'}
              title="Permission state"
            />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-7" subtitle="Read-only paid media context used to enrich Page Analysis." title="Ads AI context">
          {adsInsight ? (
            <div className="pa-insight-card compact">
              <div>
                <span className="pa-kicker">{adsInsight.scope.pageName ?? 'Mapped page scope'}</span>
                <h3>{adsInsight.findings[0]?.title ?? 'Ads bridge loaded'}</h3>
                <p>{adsInsight.findings[0]?.summary ?? 'Paid media metrics are available for page-level analysis.'}</p>
              </div>
              <div className="pa-insight-stats">
                <span>ROAS {adsInsight.metrics.roas.toFixed(2)}x</span>
                <span>Leads {adsInsight.metrics.leads ?? '-'}</span>
                <span>Bookings {adsInsight.metrics.bookings ?? '-'}</span>
              </div>
            </div>
          ) : (
            <PageAutomationState detail="Page health can load without Ads AI, but Ads-linked recommendations need the bridge." title="No Ads AI context" />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-5" subtitle="Operational load that can affect page health." title="Inbox pressure">
          <div className="pa-list">
            <PageAutomationState
              detail={`${summary.unread} unread messages across connected pages`}
              tone={summary.unread > 0 ? 'watch' : 'good'}
              title="Unread messages"
            />
            <PageAutomationState
              detail={`${messages.filter((message) => message.intent === 'complaint').length} complaint intent items`}
              tone={messages.some((message) => message.intent === 'complaint') ? 'critical' : 'good'}
              title="Complaint load"
            />
          </div>
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
  icon: typeof Users
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

function permissionHints(page: ManagedPage) {
  return page.permissions
    .flatMap((report) => missingPermissionStates(report))
    .map((state) => `${state.feature}: ${state.missing.join(', ')}`)
}

function healthClass(score: number) {
  if (score >= 80) return 'good'
  if (score >= 65) return 'watch'
  return 'critical'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}
