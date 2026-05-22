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
          detail={autoMode === 'on' ? 'เปิดเฉพาะงานความเสี่ยงต่ำ' : 'คำแนะนำรอให้ทีมกดเอง'}
          icon={Power}
          label="สถานะ Auto"
          tone={autoMode === 'on' ? 'good' : 'neutral'}
          value={autoMode === 'on' ? 'เปิด' : 'ปิด'}
        />
        <MetricCard
          detail={`${summary.pages} เพจที่เชื่อมต่อ`}
          icon={Users}
          label="ผู้ติดตาม"
          tone={summary.followers > 0 ? 'good' : 'watch'}
          value={formatNumber(summary.followers)}
        />
        <MetricCard
          detail={`${highPriorityUnread} รายการควรตอบก่อน`}
          icon={Inbox}
          label="ข้อความรอตอบ"
          tone={summary.unread > 0 ? 'watch' : 'good'}
          value={formatNumber(summary.unread)}
        />
        <MetricCard
          detail={adsInsight ? `ช่วงข้อมูล ${adsInsight.source.datePreset}` : 'รอข้อมูล Ads สำหรับประกอบรายงาน'}
          icon={BarChart3}
          label="Ads ROAS"
          tone={adsInsight ? 'good' : 'neutral'}
          value={roas}
        />
      </section>

      <div className="pa-grid">
        <PageAutomationPanel
          className="pa-span-7"
          subtitle="อ่านสุขภาพเพจร่วมกับข้อมูลโฆษณาที่เกี่ยวข้อง"
          title="ภาพรวม Ads + Page"
        >
          {adsInsight && leadingPage ? (
            <div className="pa-insight-card">
              <div>
                <span className="pa-kicker">{leadingPage.name}</span>
                <h3>{jointInsightTitle(leadingPage, adsInsight.metrics.roas)}</h3>
                <p>
                  {formatNumber(leadingPage.followers)} ผู้ติดตาม, การมีส่วนร่วม {leadingPage.engagementRate.toFixed(1)}%,
                  และใช้งบ {formatMoney(adsInsight.metrics.spend)} ในข้อมูล Ads ล่าสุด
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
              detail={pages.length ? 'ยังไม่มีข้อมูล Ads ที่จับคู่กับเพจนี้' : 'เชื่อมต่อเพจก่อนเพื่อดูรายงานร่วมกับข้อมูล Ads'}
              tone={pages.length ? 'watch' : 'neutral'}
              title="ยังไม่มีภาพรวมร่วม"
            />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel
          className="pa-span-5"
          subtitle="สัญญาณสำคัญที่ช่วยจัดลำดับงานประจำวัน"
          title={view === 'analytics' ? 'คุณภาพข้อมูลรายงาน' : 'คิวงานวันนี้'}
        >
          <div className="pa-list">
            <PageAutomationState
              detail={summary.avgHealth ? `สุขภาพเพจเฉลี่ย ${Math.round(summary.avgHealth)}%` : 'ยังไม่มีข้อมูลสุขภาพเพจ'}
              tone={summary.avgHealth >= 80 ? 'good' : summary.avgHealth > 0 ? 'watch' : 'neutral'}
              title="สุขภาพเพจ"
            />
            <PageAutomationState
              detail={messages.length ? `โหลดข้อความแล้ว ${messages.length} รายการ` : 'ยังไม่มีข้อความจาก Meta ในช่วงนี้'}
              tone={summary.unread > 0 ? 'watch' : 'good'}
              title="ข้อมูลข้อความ"
            />
            <PageAutomationState
              detail={adsInsight ? `${adsInsight.recommendations.length} คำแนะนำจาก Ads ที่ควรตรวจ` : 'ยังไม่มีคำแนะนำจาก Ads'}
              tone={adsInsight ? 'good' : 'neutral'}
              title="บริบทจาก Ads"
            />
          </div>
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-12" subtitle="เรียงเพจตามคะแนนสุขภาพล่าสุด" title="สุขภาพเพจทั้งหมด">
          {pages.length ? (
            <div className="pa-page-health-list compact">
              {pages.slice(0, view === 'analytics' ? 8 : 4).map((page) => (
                <article className="pa-page-health-row" key={page.id}>
                  <div>
                    <strong>{page.name}</strong>
                    <p>{page.handle}</p>
                  </div>
                  <span>{formatNumber(page.followers)} ผู้ติดตาม</span>
                  <span>{page.engagementRate.toFixed(1)}% การมีส่วนร่วม</span>
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
                <strong>ยังไม่มีเพจให้วิเคราะห์</strong>
                <p>เชื่อมต่อเพจก่อน ระบบจึงจะจัดอันดับสุขภาพเพจได้</p>
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
    return 'เพจแข็งแรงและโฆษณามีแรงตอบรับดี'
  }

  if (page.healthScore < 70 && roas >= 3) {
    return 'โฆษณาดี แต่เพจยังต้องปรับการดูแล'
  }

  if (page.unreadCount > 0) {
    return 'ข้อความค้างอาจกระทบโอกาสปิดการขาย'
  }

  return 'ข้อมูลเพจและ Ads พร้อมให้ทีมตรวจ'
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
