import {
  Activity,
  Bell,
  BookOpen,
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Grid2X2,
  Home,
  InfinityIcon,
  MessageCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareActivity,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchHomeSnapshot, fetchHomeStatusSnapshot, initialHomeSnapshot } from './api'
import type { HomePriority, HomeSnapshot, HomeStatusState, HomeTool } from './types'
import './styles.css'

const navItems = [
  { icon: Home, label: 'Home', active: true },
  { icon: Grid2X2, label: 'Tools' },
  { icon: SquareActivity, label: 'Reports' },
  { icon: BookOpen, label: 'Knowledge' },
  { icon: Bell, label: 'Alerts' },
  { icon: CheckSquare, label: 'Tasks' },
  { icon: ShieldCheck, label: 'Approvals' },
  { icon: FileText, label: 'Audit Log' },
  { icon: Settings, label: 'Settings', separated: true },
]

const toolIcons: Record<HomeTool['id'], LucideIcon> = {
  ads: InfinityIcon,
  crm: Users,
  erp: Building2,
  knowledge: BookOpen,
  page: MessageCircle,
  website: Activity,
}

export function HomeApp() {
  const [snapshot, setSnapshot] = useState<HomeSnapshot>(initialHomeSnapshot)

  useEffect(() => {
    let active = true
    async function loadHome() {
      try {
        const statusSnapshot = await fetchHomeStatusSnapshot()
        if (active) setSnapshot(statusSnapshot)

        const nextSnapshot = await fetchHomeSnapshot()
        if (active) setSnapshot(nextSnapshot)
      } catch {
        // Keep the conservative loading state when the local API is unavailable.
      }
    }

    void loadHome()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="home-shell">
      <aside className="home-sidebar" aria-label="PMC navigation">
        <div className="home-brand">
          <strong>PMC</strong>
          <span>COMMAND CENTER</span>
        </div>

        <nav className="home-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <a className={`home-nav-item ${item.active ? 'active' : ''} ${item.separated ? 'separated' : ''}`} href={item.active ? '/' : '#'} key={item.label}>
                <Icon size={19} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>

        <div className="home-admin">
          <div className="home-avatar">A</div>
          <div>
            <strong>Admin</strong>
            <span>PMC Organization</span>
          </div>
          <ChevronDown size={16} />
        </div>
      </aside>

      <main className="home-main">
        <header className="home-topbar">
          <div>
            <h1>Home</h1>
            <p>ศูนย์กลางการทำงานอัจฉริยะ เพื่อการตัดสินใจที่ดีขึ้นทุกวัน</p>
          </div>
          <div className="home-status-chips" aria-label="Connection status">
            {snapshot.headerStatuses.map((status) => (
              <StatusChip key={status.id} label={status.label} state={status.state} value={status.value} />
            ))}
          </div>
        </header>

        <section className="home-panel home-priorities" aria-label="AI priorities">
          <PanelHeading icon={Sparkles} subtitle="สิ่งที่ AI แนะนำให้คุณโฟกัสตอนนี้" title="AI Priorities">
            <a className="home-ghost-button" href="/ads-agent">ดูทั้งหมด <ChevronRight size={15} /></a>
          </PanelHeading>
          <div className="home-priority-list">
            {snapshot.priorities.map((priority, index) => <PriorityRow index={index + 1} key={priority.id} priority={priority} />)}
          </div>
          <p className="home-policy-note">AI แนะนำเท่านั้น การอนุมัติและการดำเนินการเป็นหน้าที่ของมนุษย์</p>
        </section>

        <section className="home-lower-grid">
          <section className="home-panel" aria-label="Tools">
            <PanelHeading icon={Grid2X2} subtitle="เครื่องมือที่คุณใช้งานบ่อย" title="Tools" />
            <div className="home-tools-grid">
              {snapshot.tools.map((tool) => <ToolTile key={tool.id} tool={tool} />)}
            </div>
            <div className="home-panel-footer">
              <button className="home-footer-button" type="button">ดูเครื่องมือทั้งหมด</button>
            </div>
          </section>

          <section className="home-panel" aria-label="System Status">
            <PanelHeading icon={SquareActivity} subtitle="สถานะการเชื่อมต่อและระบบหลัก" title="System Status" />
            <div className="home-system-list">
              {snapshot.systemStatuses.map((status) => (
                <a className="home-system-row" href="#" key={status.id}>
                  <span className={`home-mini-icon ${statusStateClass(status.state)}`}>
                    {renderSystemIcon(status.id)}
                  </span>
                  <strong>{status.label}</strong>
                  <b className={statusStateClass(status.state)}>{status.value}</b>
                  <ChevronRight size={16} />
                </a>
              ))}
            </div>
          </section>
        </section>

        <section className="home-panel home-recent" aria-label="Recent Activity">
          <PanelHeading icon={Clock} subtitle="กิจกรรมล่าสุด" title="Recent Activity">
            <a className="home-ghost-button" href="/ads-agent">ดูทั้งหมด <ChevronRight size={15} /></a>
          </PanelHeading>
          {snapshot.activities.length ? (
            <div className="home-recent-list">
              {snapshot.activities.map((activity) => (
                <div className="home-recent-row" key={activity.id}>
                  <span className="home-check">✓</span>
                  <div>
                    <strong>{activity.label}</strong>
                    <p>{activity.time}</p>
                  </div>
                  <b>{activity.source}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="home-empty-activity">
              <span className="home-check">✓</span>
              <div>
                <strong>ยังไม่มีกิจกรรมล่าสุดจากระบบที่เชื่อมต่อ</strong>
                <p>เมื่อ Ads Agent, Page Automation หรือ Knowledge มีเหตุการณ์ใหม่ ระบบจะแสดงที่นี่</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function PanelHeading({
  children,
  icon: Icon,
  subtitle,
  title,
}: {
  children?: ReactNode
  icon: LucideIcon
  subtitle: string
  title: string
}) {
  return (
    <div className="home-panel-head">
      <div className="home-panel-title">
        <Icon size={23} />
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function StatusChip({ label, state, value }: { label: string; state: HomeStatusState; value: string }) {
  return (
    <div className="home-status-chip">
      <span className={`home-dot ${statusStateClass(state)}`} />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </div>
  )
}

function PriorityRow({ index, priority }: { index: number; priority: HomePriority }) {
  return (
    <article className="home-priority-row">
      <div className="home-priority-rank">{index}</div>
      <div className={`home-priority-icon ${priority.iconTone}`}>
        {renderPriorityIcon(priority)}
      </div>
      <div className="home-priority-source">
        <strong>{priority.source}</strong>
      </div>
      <div className="home-priority-copy">
        <strong>{priority.title}</strong>
        <span>{priority.sourceLabel}</span>
      </div>
      <span className={`home-risk ${riskClass(priority.risk)}`}>ความเสี่ยง: {priority.risk}</span>
      <div className="home-confidence">
        <span>ความมั่นใจ</span>
        <strong>{priority.confidence ? `${priority.confidence}%` : '-'}</strong>
      </div>
      <a className="home-row-action" href={priority.href}>{priority.actionLabel}</a>
    </article>
  )
}

function renderPriorityIcon(priority: HomePriority) {
  if (priority.id.includes('draft')) return <FileText size={28} />
  if (priority.source === 'Page Automation') return <MessageCircle size={28} />
  if (priority.source === 'Ads Agent') return <InfinityIcon size={28} />
  if (priority.source === 'Knowledge') return <BookOpen size={28} />
  return <Sparkles size={28} />
}

function renderSystemIcon(id: string) {
  if (id === 'ai') return <Sparkles size={21} />
  if (id === 'crm') return <Users size={21} />
  if (id === 'erp') return <Building2 size={21} />
  if (id === 'meta') return <InfinityIcon size={21} />
  if (id === 'rag') return <BookOpen size={21} />
  if (id === 'website') return <Activity size={21} />
  return <SquareActivity size={21} />
}

function ToolTile({ tool }: { tool: HomeTool }) {
  const Icon = toolIcons[tool.id] ?? Grid2X2
  const isSetup = tool.routeState !== 'enabled'
  const content = (
    <>
      <div className={`home-tool-icon ${tool.iconTone}`}>
        <Icon size={26} />
      </div>
      <div>
        <strong>{tool.title}</strong>
        <span><i className={`home-dot ${statusStateClass(tool.status)}`} />{tool.statusText}</span>
        {tool.setupLabel ? <em>{tool.setupLabel}</em> : null}
      </div>
      <ChevronRight size={17} />
    </>
  )

  if (isSetup) {
    return (
      <div className="home-tool-tile is-setup" role="group" aria-label={`${tool.title}: ${tool.setupLabel ?? tool.statusText}`}>
        {content}
      </div>
    )
  }

  return (
    <a className="home-tool-tile" href={tool.href}>
      {content}
    </a>
  )
}

function statusStateClass(state: HomeStatusState) {
  if (state === 'connected' || state === 'ready') return 'good'
  if (state === 'setup' || state === 'loading') return 'watch'
  return 'critical'
}

function riskClass(risk: HomePriority['risk']) {
  if (risk === 'สูง') return 'high'
  if (risk === 'ปานกลาง') return 'medium'
  return 'low'
}
