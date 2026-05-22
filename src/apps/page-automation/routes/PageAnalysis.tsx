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
        <MetricCard detail={`${summary.pages} เพจที่เชื่อมต่อ`} icon={Users} label="เพจ" tone={summary.pages ? 'good' : 'watch'} value={formatNumber(summary.pages)} />
        <MetricCard
          detail="ผู้ติดตามรวมจากทุกเพจ"
          icon={Activity}
          label="ผู้ติดตาม"
          tone={summary.followers ? 'good' : 'neutral'}
          value={formatNumber(summary.followers)}
        />
        <MetricCard
          detail={`${messages.filter((message) => message.priority === 'high').length} รายการควรตอบก่อน`}
          icon={ShieldCheck}
          label="ข้อความรอตอบ"
          tone={summary.unread > 0 ? 'watch' : 'good'}
          value={formatNumber(summary.unread)}
        />
        <MetricCard
          detail={autoMode === 'on' ? 'เปิดเฉพาะรายการความเสี่ยงต่ำ' : 'แนะนำเท่านั้น'}
          icon={BarChart3}
          label="สถานะ Auto"
          tone={autoMode === 'on' ? 'watch' : 'neutral'}
          value={autoMode === 'on' ? 'เปิด' : 'ปิด'}
        />
      </section>

      <div className="pa-grid">
        <PageAutomationPanel className="pa-span-8" subtitle="ดูผู้ติดตาม การมีส่วนร่วม ข้อความรอตอบ และคะแนนสุขภาพของแต่ละเพจ" title="สุขภาพเพจ">
          {pages.length ? (
            <div className="pa-page-health-list">
              {pages.map((page) => (
                <article className="pa-page-health-row expanded" key={page.id}>
                  <div>
                    <strong>{page.name}</strong>
                    <p>{page.handle} · {page.platform}</p>
                  </div>
                  <span>{formatNumber(page.followers)} ผู้ติดตาม</span>
                  <span>{page.engagementRate.toFixed(1)}% การมีส่วนร่วม</span>
                  <span>{page.unreadCount} ข้อความรอตอบ</span>
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
                <strong>ยังไม่มีเพจที่เชื่อมต่อ</strong>
                <p>เชื่อมต่อเพจก่อน ระบบจึงจะวิเคราะห์สุขภาพเพจได้</p>
              </div>
            </div>
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-4" subtitle="แสดงสิทธิ์ที่ต้องตรวจเพิ่มแยกตามเพจ" title="สิทธิ์ที่ต้องตรวจ">
          {hasPermissionNotices ? (
            <div className="pa-page-permissions">
              {pagesWithUnknownPermissions.map((page) => (
                <article className="pa-permission-hint" key={`${page.id}-unknown`}>
                  <strong>{page.name}</strong>
                  <p>ยังไม่มีรายงานสิทธิ์ของเพจนี้</p>
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
              title="สิทธิ์พร้อมใช้งาน"
            />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-7" subtitle="ใช้ข้อมูล Ads ที่มีอยู่เพื่อช่วยอ่านสุขภาพเพจ ไม่ดำเนินการแทนทีม" title="บริบทจาก Ads">
          {adsInsight ? (
            <div className="pa-insight-card compact">
              <div>
                <span className="pa-kicker">{adsInsight.scope.pageName ?? 'เพจที่เชื่อมกับข้อมูล Ads'}</span>
                <h3>{adsInsight.findings[0]?.title ?? 'มีข้อมูล Ads สำหรับประกอบการวิเคราะห์'}</h3>
                <p>{adsInsight.findings[0]?.summary ?? 'มีข้อมูลแคมเปญสำหรับช่วยอ่านภาพรวมของเพจนี้'}</p>
              </div>
              <div className="pa-insight-stats">
                <span>ROAS {adsInsight.metrics.roas.toFixed(2)}x</span>
                <span>Leads {adsInsight.metrics.leads ?? '-'}</span>
                <span>Bookings {adsInsight.metrics.bookings ?? '-'}</span>
              </div>
            </div>
          ) : (
            <PageAutomationState detail="ยังไม่มีข้อมูล Ads สำหรับเพจนี้ ระบบยังวิเคราะห์สุขภาพเพจจากข้อมูล Meta ได้" title="ยังไม่มีบริบทจาก Ads" />
          )}
        </PageAutomationPanel>

        <PageAutomationPanel className="pa-span-5" subtitle="ภาระข้อความที่อาจกระทบคุณภาพการดูแลเพจ" title="ภาระข้อความ">
          <div className="pa-list">
            <PageAutomationState
              detail={`${summary.unread} ข้อความยังไม่ได้อ่านจากทุกเพจ`}
              tone={summary.unread > 0 ? 'watch' : 'good'}
              title="ข้อความรอตอบ"
            />
            <PageAutomationState
              detail={`${messages.filter((message) => message.intent === 'complaint').length} รายการที่อาจเป็นเรื่องร้องเรียน`}
              tone={messages.some((message) => message.intent === 'complaint') ? 'critical' : 'good'}
              title="เรื่องที่ควรระวัง"
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
