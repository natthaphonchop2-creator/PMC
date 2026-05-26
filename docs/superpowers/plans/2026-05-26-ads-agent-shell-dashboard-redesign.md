# Ads Agent Shell Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/ads-agent` phase 1 as a premium clinic workspace shell with an outer toolbar and refreshed Ads Dashboard first view.

**Architecture:** Keep the first slice inside `src/App.tsx` and `src/App.css` because Ads Agent state and page components currently live there. Add focused component boundaries inside `App.tsx`: `AdsOuterToolbar`, `AdsDashboardPage`, `DashboardMetricCard`, `DashboardPanel`, and `ApprovalInsightCard`. Preserve current Meta API, sync, approval, and route behavior.

**Tech Stack:** React 19, TypeScript, Vite, Vitest server-render tests, lucide-react icons, existing Recharts/ECharts components, CSS in `src/App.css`.

---

## File Structure

- Modify `src/App.tsx`
  - Replace the old `navItems` content with the approved 8-item toolbar set.
  - Replace `Sidebar` with `AdsOuterToolbar`.
  - Wrap the main area in the new clinic workspace shell.
  - Replace `AnalyticsPage` with the new `AdsDashboardPage` composition while preserving existing props and approval callbacks.
  - Keep non-dashboard pages behind the same `activeTab` routing.
- Modify `src/App.css`
  - Add the new outer toolbar, main panel, dashboard grid, metric card, panel, and responsive styles.
  - Keep existing page-specific styles where non-dashboard pages still need them.
- Modify `tests/homeApp.test.tsx`
  - Update Ads Agent route assertions from the old sidebar to the new outer toolbar.
  - Add dashboard-section assertions.
  - Add CSS regression assertions for outer toolbar, panel, mobile drawer behavior, and route isolation.

Do not modify backend files, Home files, or Page Automation files for this redesign task.

---

### Task 1: Add failing tests for the approved Ads Agent shell and dashboard

**Files:**
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Replace the old `/ads-agent` route expectations**

Find the existing test named `routes / to Home and /ads-agent to the existing PMC Ads Agent shell` and replace the `/ads-agent` block with this content:

```tsx
    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      const text = visibleText(html)

      expect(html).toContain('class="ads-workspace-shell"')
      expect(html).toContain('class="ads-outer-toolbar')
      expect(html).toContain('aria-label="Ads Agent navigation"')
      expect(html).toContain('href="/"')
      expect(text).toContain('PMC')
      expect(text).toContain('Aesthetic Clinic')
      expect(text).toContain('Ads Dashboard')
      expect(text).toContain('Campaigns')
      expect(text).toContain('Ad Groups')
      expect(text).toContain('Creatives')
      expect(text).toContain('Audience')
      expect(text).toContain('Reports')
      expect(text).toContain('Insights')
      expect(text).toContain('Settings')
      expect(countOccurrences(html, 'class="ads-toolbar-item')).toBe(8)
      expect(html).toContain('aria-current="page"')
      expect(html).not.toContain('class="nav-groups"')
      expect(text).not.toContain('Optimizer & Automation')
      expect(text).not.toContain('ศูนย์ช่วยเหลือ')
      expect(text).not.toContain('AI Brain')
      expect(text).not.toContain('PMC Master Agent')
    })
```

- [ ] **Step 2: Add a new dashboard-section render test**

Add this test after the route test:

```tsx
  it('renders the approved Ads Dashboard sections from existing Ads Agent data', () => {
    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      const text = visibleText(html)

      expect(text).toContain('Ads Dashboard')
      expect(text).toContain('Customize Dashboard')
      expect(text).toContain('New Campaign')
      expect(text).toContain('Impressions')
      expect(text).toContain('Clicks')
      expect(text).toContain('Conversions')
      expect(text).toContain('Cost')
      expect(text).toContain('Performance Overview')
      expect(text).toContain('Top Campaigns')
      expect(text).toContain('คำแนะนำที่รออนุมัติ')
      expect(text).toContain('Cost per Result')
      expect(text).toContain('CTR')
      expect(text).toContain('ROAS')
      expect(html).not.toContain('Revenue Overview')
      expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
    })
  })
```

- [ ] **Step 3: Add a CSS regression test for the new shell**

Add this test near the existing CSS tests:

```tsx
  it('has Ads Agent outer-toolbar shell styles isolated from Home and Page Automation', () => {
    const appCss = readText('../src/App.css')
    const homeCss = readText('../src/apps/home/styles.css')
    const pageCss = readText('../src/apps/page-automation/styles.css')

    expect(appCss).toContain('.ads-workspace-shell')
    expect(appCss).toContain('grid-template-columns: 280px minmax(0, 1fr)')
    expect(appCss).toContain('.ads-outer-toolbar')
    expect(appCss).toContain('.ads-main-panel')
    expect(appCss).toContain('.ads-toolbar-item.active')
    expect(appCss).toContain('.ads-dashboard-metric-grid')
    expect(appCss).toContain('@media (max-width: 980px)')
    expect(appCss).toContain('@media (max-width: 640px)')
    expect(homeCss).not.toContain('ads-workspace-shell')
    expect(pageCss).not.toContain('ads-workspace-shell')
  })
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because `.ads-workspace-shell`, the new toolbar labels, and dashboard section labels do not exist yet.

- [ ] **Step 5: Commit the failing tests**

```bash
git add tests/homeApp.test.tsx
git commit -m "test: specify ads agent shell dashboard redesign"
```

---

### Task 2: Add the approved toolbar model and outer shell markup

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Extend `NavItem` with a stable toolbar key**

Update the `NavItem` type to include `toolbarKey`:

```tsx
type NavItem = {
  id: TabId
  toolbarKey: string
  label: string
  group: 'Main' | 'Creative' | 'System'
  icon: LucideIcon
  description: string
}
```

This prevents `Campaigns` and `Ad Groups` from both appearing active when they map to the same existing `ads` tab.

- [ ] **Step 2: Replace `navItems` with the approved toolbar set**

Replace the current `navItems` array with:

```tsx
const navItems: NavItem[] = [
  { id: 'analytics', toolbarKey: 'dashboard', label: 'Ads Dashboard', group: 'Main', icon: LineChart, description: 'ภาพรวมโฆษณาและคำแนะนำที่ควรตรวจวันนี้' },
  { id: 'ads', toolbarKey: 'campaigns', label: 'Campaigns', group: 'Main', icon: Megaphone, description: 'จัดการ Campaign, Ad group และ Ad จากข้อมูล Meta จริง' },
  { id: 'ads', toolbarKey: 'ad-groups', label: 'Ad Groups', group: 'Main', icon: Layers3, description: 'ตรวจชุดโฆษณาและกลุ่มงานที่อยู่ใต้ Campaign' },
  { id: 'creative', toolbarKey: 'creatives', label: 'Creatives', group: 'Creative', icon: ImageIcon, description: 'ผลงานครีเอทีฟและ asset ที่ซิงก์มา' },
  { id: 'audience', toolbarKey: 'audience', label: 'Audience', group: 'Creative', icon: Users, description: 'กลุ่มเป้าหมาย พื้นที่ และคุณภาพ lead' },
  { id: 'reports', toolbarKey: 'reports', label: 'Reports', group: 'System', icon: FileText, description: 'รายงานสรุปผลงานโฆษณาให้ทีมตรวจและนำไปใช้ต่อ' },
  { id: 'marketer', toolbarKey: 'insights', label: 'Insights', group: 'Main', icon: BrainCircuit, description: 'คำแนะนำและ insight ที่รอทีมตรวจ' },
  { id: 'settings', toolbarKey: 'settings', label: 'Settings', group: 'System', icon: Settings, description: 'การเชื่อมต่อ Meta, workspace และความพร้อมของ API' },
]
```

This keeps `TabId` unchanged and maps `Ad Groups` to the existing `ads` page for phase 1.

- [ ] **Step 3: Add toolbar active-key state**

In `PmcAdsAgentApp`, add this state near `activeTab`:

```tsx
const [activeToolbarKey, setActiveToolbarKey] = useState('dashboard')
```

Replace the current `activePage` assignment with:

```tsx
const activePage = navItems.find((item) => item.toolbarKey === activeToolbarKey) ?? navItems.find((item) => item.id === activeTab) ?? navItems[0]
```

Update `handleTabSelect` so it accepts an optional toolbar key and updates both pieces of state:

```tsx
const handleTabSelect = useCallback((tab: TabId, toolbarKey?: string) => {
  setActiveTab(tab)
  setActiveToolbarKey(toolbarKey ?? navItems.find((item) => item.id === tab)?.toolbarKey ?? 'dashboard')
  const tabNotices: Record<TabId, { message: string; tone: Tone }> = {
    ads: { message: 'เปิด Campaigns แล้ว ตรวจชื่อให้ชัดก่อนเขียน Meta นะครับ', tone: 'watch' },
    analytics: { message: 'กลับมาดู Ads Dashboard ล่าสุดแล้วครับ', tone: 'info' },
    audience: { message: 'เปิด Audience แล้ว ใช้ดู segment ก่อนปรับแคมเปญ', tone: 'info' },
    creative: { message: 'เปิด Creatives แล้ว ดูสัญญาณงานโฆษณาได้ตรงนี้', tone: 'info' },
    help: { message: 'เปิดศูนย์ช่วยเหลือแล้ว ถ้าติดตั้งค่าให้ไป Settings ได้เลย', tone: 'info' },
    library: { message: 'เปิดคลังโฆษณาแล้ว ตรวจ compliance ก่อนนำไปใช้ต่อครับ', tone: 'watch' },
    marketer: { message: 'เปิด Insights แล้ว ตรวจคำแนะนำก่อนตัดสินใจ', tone: 'info' },
    optimization: { message: 'เปิด Optimizer แล้ว กดวิเคราะห์ล่าสุดก่อนดำเนินแผน', tone: 'info' },
    reports: { message: 'เปิด Reports แล้ว ใช้สรุปงานให้ทีมรีวิวได้', tone: 'good' },
    settings: { message: 'เปิด Settings แล้ว ตั้งค่า Meta และ OpenAI API ได้ตรงนี้', tone: 'watch' },
  }
  const notice = tabNotices[tab]
  showMascotNotice(notice.message, notice.tone)
}, [showMascotNotice])
```

- [ ] **Step 4: Update `PmcAdsAgentApp` shell markup**

Replace the top-level return wrapper in `PmcAdsAgentApp` from:

```tsx
return (
  <div className="app-shell" ref={shellRef}>
    <Sidebar activeTab={activeTab} accountName={metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta'} automationMode={automationMode} dataState={dataState} mascotNotice={mascotNotice} onSelect={handleTabSelect} syncState={syncState} />
    <main className="app-main">
```

to:

```tsx
return (
  <div className="ads-workspace-shell app-shell" ref={shellRef}>
    <AdsOuterToolbar activeToolbarKey={activeToolbarKey} accountName={metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta'} automationMode={automationMode} dataState={dataState} mascotNotice={mascotNotice} onSelect={handleTabSelect} syncState={syncState} />
    <main className="ads-main-panel app-main">
```

Keep the closing tags and modals in the same order.

- [ ] **Step 5: Replace `SidebarProps` with `AdsOuterToolbarProps`**

Replace:

```tsx
type SidebarProps = {
  activeTab: TabId
  accountName: string
  automationMode: string
  dataState: DataSourceState
  mascotNotice: MascotNotice | null
  onSelect: (tab: TabId) => void
  syncState: string
}
```

with:

```tsx
type AdsOuterToolbarProps = {
  activeToolbarKey: string
  accountName: string
  automationMode: string
  dataState: DataSourceState
  mascotNotice: MascotNotice | null
  onSelect: (tab: TabId, toolbarKey?: string) => void
  syncState: string
}
```

- [ ] **Step 6: Replace `Sidebar` with `AdsOuterToolbar`**

Replace the full `function Sidebar(...)` declaration with this implementation:

```tsx
function AdsOuterToolbar({ activeToolbarKey, accountName, automationMode, dataState, mascotNotice, onSelect, syncState }: AdsOuterToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const statusTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const mascotMessage = mascotNotice?.message ?? mascotNoticeForState(dataState, syncState, automationMode)
  const freshnessLabel =
    dataState === 'live'
      ? 'ข้อมูลจริงจาก API'
      : dataState === 'loading'
        ? 'กำลังซิงก์'
        : dataState === 'empty'
          ? 'ยังไม่มีข้อมูล'
          : dataState === 'setup-required'
            ? 'ต้องตั้งค่าก่อน'
            : 'ซิงก์ผิดพลาด'
  const selectTab = (tab: TabId, toolbarKey?: string) => {
    onSelect(tab, toolbarKey)
    setIsMenuOpen(false)
  }

  return (
    <aside className={`ads-outer-toolbar ${isMenuOpen ? 'menu-open' : ''}`}>
      <div className="ads-toolbar-brand-row">
        <a className="ads-toolbar-brand" href="/" aria-label="กลับหน้า Home">
          <span className="ads-toolbar-brand-mark">P</span>
          <span>
            <strong>PMC</strong>
            <small>Aesthetic Clinic</small>
          </span>
        </a>
        <button
          className="ads-mobile-menu-button"
          type="button"
          aria-controls="ads-agent-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'ปิดเมนู Ads Agent' : 'เปิดเมนู Ads Agent'}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <nav className="ads-toolbar-nav" id="ads-agent-navigation" aria-label="Ads Agent navigation">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = item.toolbarKey === activeToolbarKey
          return (
            <button
              className={`ads-toolbar-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              data-description={item.description}
              key={item.label}
              type="button"
              onClick={() => selectTab(item.id, item.toolbarKey)}
            >
              <span className="ads-toolbar-icon">
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="ads-toolbar-user-card">
        <div className="ads-toolbar-avatar" aria-hidden="true" />
        <div>
          <strong>PMC Team</strong>
          <span>Marketing Manager</span>
        </div>
        <ChevronDown size={16} aria-hidden="true" />
      </div>

      <div className="ads-toolbar-status-card">
        <StatusBadge label={syncStateLabel(syncState)} tone={statusTone} />
        <strong>บัญชีโฆษณา: {accountName}</strong>
        <span>{freshnessLabel}</span>
        <small>{mascotMessage}</small>
      </div>
    </aside>
  )
}
```

- [ ] **Step 7: Run focused test and verify shell assertions now pass or move forward to remaining failures**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: The shell-related assertions pass. Dashboard section assertions still fail until Task 3.

- [ ] **Step 8: Commit shell markup**

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: add ads agent outer toolbar shell"
```

---

### Task 3: Replace the analytics first view with Ads Dashboard sections

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Replace `AnalyticsPage` render body**

Keep the `AnalyticsPage` props unchanged. Replace its return statement with:

```tsx
  const topCampaigns = [...campaigns]
    .sort((left, right) => right.conversions - left.conversions || right.roas - left.roas)
    .slice(0, 5)
  const averageCtr = campaigns.length > 0 ? campaigns.reduce((sum, campaign) => sum + campaign.ctr, 0) / campaigns.length : 0
  const totalConversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const totalImpressionsLabel = summary.leads > 0 ? fmtNum(summary.leads) : campaigns.length > 0 ? `${campaigns.length} แคมเปญ` : 'รอข้อมูล'
  const metricCards: DashboardMetric[] = [
    { icon: Info, label: 'Impressions', tone: 'sand', value: totalImpressionsLabel, helper: summary.leads > 0 ? 'จาก lead ที่ซิงก์' : 'ใช้จำนวนแคมเปญแทนจนกว่า Meta จะส่ง impressions', change: periodChange(metricTrendValues(trendData, (point) => point.bookings), 'เทียบช่วงก่อนหน้า') },
    { icon: Megaphone, label: 'Clicks', tone: 'blue', value: summary.bookings > 0 ? fmtNum(summary.bookings) : 'รอข้อมูล', helper: 'ใช้ booking เป็น click-through proxy จากข้อมูลเดิม', change: periodChange(metricTrendValues(trendData, (point) => point.bookings), 'จาก booking รายวัน') },
    { icon: Users, label: 'Conversions', tone: 'purple', value: fmtNum(totalConversions || summary.bookings), helper: 'Conversion ที่ Meta track หรือ booking ที่ซิงก์', change: conversionRatePeriodChange(trendData) },
    { icon: CircleDollarSign, label: 'Cost', tone: 'gold', value: fmtMoneyShort(summary.spend), helper: 'ยอด spend รวมในช่วงที่เลือก', change: periodChange(metricTrendValues(trendData, (point) => point.spend), 'จาก spend รายวัน') },
  ]

  return (
    <div className="ads-dashboard-layout">
      <section className="ads-dashboard-metric-grid" aria-label="Ads Dashboard metrics">
        {metricCards.map((metric) => (
          <DashboardMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="ads-dashboard-main-grid">
        <DashboardPanel className="performance-panel" title="Performance Overview" subtitle="Spend, revenue และ booking จากข้อมูลที่ซิงก์">
          <RevenueOverviewChart trendData={trendData} />
        </DashboardPanel>
        <DashboardPanel title="Top Campaigns" subtitle="เรียงตาม conversion และ ROAS">
          <div className="ads-top-campaign-list">
            {topCampaigns.length > 0 ? topCampaigns.map((campaign) => (
              <article className="ads-top-campaign-row" key={campaign.id}>
                <span className={`ads-campaign-rank-dot ${campaign.tone}`} />
                <div>
                  <strong>{campaign.name}</strong>
                  <small>{fmtNum(campaign.conversions)} conversions · ROAS {campaign.roas.toFixed(2)}x</small>
                </div>
                <StatusBadge label={campaignStatusLabel(campaign.status)} tone={campaign.tone} />
              </article>
            )) : <EmptyState title="ยังไม่มีแคมเปญให้จัดอันดับ" detail="เมื่อซิงก์ข้อมูล Meta แล้ว แคมเปญที่ทำผลงานดีที่สุดจะแสดงที่นี่" />}
          </div>
        </DashboardPanel>
        <DashboardPanel className="approval-panel" title="คำแนะนำที่รออนุมัติ" subtitle="รายการที่ควรตรวจวันนี้">
          <ApprovalInsightCard onApprove={onApprove} onReject={onReject} recommendations={recommendations} recommendationStates={recommendationStates} />
        </DashboardPanel>
      </section>

      <section className="ads-dashboard-lower-grid" aria-label="Ads Dashboard secondary metrics">
        <DashboardMetricCard metric={{ icon: CircleDollarSign, label: 'Cost per Result', tone: 'sand', value: summary.cpa > 0 ? fmtMoney(summary.cpa) : 'รอข้อมูล', helper: 'spend / booking', change: { label: summary.cpa > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: summary.cpa > 0 ? 'good' : 'neutral', detail: 'คำนวณจากข้อมูลเดิม' } }} />
        <DashboardMetricCard metric={{ icon: Percent, label: 'CTR', tone: 'blue', value: averageCtr > 0 ? `${averageCtr.toFixed(2)}%` : 'รอข้อมูล', helper: 'ค่าเฉลี่ย CTR ของแคมเปญ', change: { label: averageCtr > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: averageCtr > 0 ? 'good' : 'neutral', detail: 'จาก campaign insights' } }} />
        <DashboardMetricCard metric={{ icon: LineChart, label: 'ROAS', tone: 'purple', value: summary.roas > 0 ? `${summary.roas.toFixed(2)}x` : 'รอข้อมูล', helper: 'revenue / spend', change: { label: summary.roas > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: summary.roas > 0 ? 'good' : 'neutral', detail: 'คำนวณจากข้อมูลเดิม' } }} />
        <DashboardPanel className="ads-insight-panel" title="PMC Insights" subtitle="สรุปจากข้อมูลล่าสุด">
          <p>{recommendations.length > 0 ? 'มีคำแนะนำที่รอทีมตรวจและตัดสินใจ' : 'ยังไม่มีคำแนะนำใหม่ในช่วงนี้'}</p>
          <button className="clinic-primary-button" type="button" disabled aria-label="Insights ใช้งานจากเมนูด้านซ้าย">
            View Insights
          </button>
        </DashboardPanel>
      </section>
    </div>
  )
```

- [ ] **Step 2: Add dashboard helper types and components**

Place this block before `function RevenueOverview`:

```tsx
type DashboardMetricTone = 'sand' | 'blue' | 'purple' | 'gold'

type DashboardMetric = {
  change: MetricChange
  helper: string
  icon: LucideIcon
  label: string
  tone: DashboardMetricTone
  value: string
}

function DashboardMetricCard({ metric }: { metric: DashboardMetric }) {
  const Icon = metric.icon
  return (
    <article className="ads-dashboard-metric-card">
      <span className={`ads-dashboard-metric-icon ${metric.tone}`}>
        <Icon size={22} />
      </span>
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>{metric.helper}</small>
      </div>
      <div className="ads-dashboard-metric-change">
        <em className={metric.change.tone}>{metric.change.label}</em>
        <small>{metric.change.detail}</small>
      </div>
    </article>
  )
}

function DashboardPanel({ children, className = '', subtitle, title }: { children: ReactNode; className?: string; subtitle: string; title: string }) {
  return (
    <section className={`ads-dashboard-panel ${className}`.trim()}>
      <div className="ads-dashboard-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ApprovalInsightCard({
  onApprove,
  onReject,
  recommendations,
  recommendationStates,
}: {
  onApprove: (id: string) => void
  onReject: (id: string) => void
  recommendations: Recommendation[]
  recommendationStates: Record<string, ActionState>
}) {
  const pendingRecommendations = recommendations.slice(0, 3)
  if (pendingRecommendations.length === 0) {
    return <EmptyState title="ยังไม่มีรายการที่ต้องอนุมัติ" detail="เมื่อ AI วิเคราะห์ข้อมูลล่าสุด รายการที่ต้องตัดสินใจจะแสดงที่นี่" />
  }

  return (
    <div className="approval-insight-list">
      {pendingRecommendations.map((rec) => {
        const state = recommendationStates[rec.id] ?? 'Suggested'
        const isFinal = state === 'Approved' || state === 'Executed' || state === 'Rejected' || state === 'Failed'
        const isExecuting = state === 'Executing'
        return (
          <article className="approval-insight-card" key={rec.id}>
            <div>
              <StatusBadge label={riskLabel(rec.risk)} tone={toneForRisk(rec.risk)} />
              <strong>{rec.title}</strong>
              <p>{rec.evidence}</p>
            </div>
            {isFinal ? (
              <StatusBadge label={actionStateLabelForPlan(state, rec.execution)} tone={state === 'Executed' || state === 'Approved' ? 'good' : 'critical'} />
            ) : (
              <div className="approval-insight-actions">
                <button className="clinic-primary-button" type="button" onClick={() => onApprove(rec.id)} disabled={isExecuting}>
                  {isExecuting ? 'กำลังดำเนินการ...' : 'รีวิว'}
                </button>
                <button className="clinic-secondary-button" type="button" onClick={() => onReject(rec.id)} disabled={isExecuting}>
                  ปฏิเสธ
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Import the `ReactNode` type**

Change the first import from:

```tsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
```

to:

```tsx
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 4: Run focused test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: Dashboard section assertions pass. CSS assertions still fail until Task 4.

- [ ] **Step 5: Commit dashboard markup**

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: refresh ads dashboard layout"
```

---

### Task 4: Add the clinic workspace visual system in CSS

**Files:**
- Modify: `src/App.css`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Add shell and toolbar CSS**

Append this block near the top of `src/App.css`, after global `body`/root rules and before old `.app-shell` rules:

```css
.ads-workspace-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 0;
  padding: 14px;
  background:
    linear-gradient(140deg, rgba(255, 255, 255, 0.92), rgba(244, 232, 218, 0.82)),
    #f4eadf;
  color: #101828;
}

.ads-outer-toolbar {
  min-width: 0;
  min-height: calc(100vh - 28px);
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  gap: 22px;
  padding: 28px 18px;
  border-radius: 30px 0 0 30px;
  background:
    linear-gradient(160deg, rgba(255, 250, 244, 0.96) 0%, rgba(244, 230, 216, 0.94) 74%, rgba(235, 213, 193, 0.95) 100%);
  border: 1px solid rgba(206, 174, 142, 0.58);
  border-right: 0;
}

.ads-toolbar-brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ads-toolbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #111827;
  text-decoration: none;
}

.ads-toolbar-brand-mark {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid #b77a42;
  border-radius: 50%;
  color: #9b5d2d;
  font-family: Georgia, serif;
  font-size: 24px;
}

.ads-toolbar-brand strong {
  display: block;
  font-family: Georgia, serif;
  font-size: 34px;
  line-height: 0.95;
  letter-spacing: 0;
}

.ads-toolbar-brand small {
  display: block;
  margin-top: 4px;
  color: #6b4b32;
  font-size: 10px;
  letter-spacing: 2.2px;
  text-transform: uppercase;
}

.ads-mobile-menu-button {
  display: none;
}

.ads-toolbar-nav {
  display: grid;
  align-content: start;
  gap: 13px;
}

.ads-toolbar-item {
  min-height: 48px;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 4px 10px;
  border: 0;
  border-radius: 24px;
  background: transparent;
  color: #1f2937;
  font: inherit;
  font-weight: 760;
  text-align: left;
  cursor: pointer;
}

.ads-toolbar-item.active {
  min-height: 58px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid #ead8c5;
  box-shadow: 0 12px 28px rgba(129, 85, 50, 0.12);
}

.ads-toolbar-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid #ead8c5;
  color: #a96632;
}

.ads-toolbar-item.active .ads-toolbar-icon {
  width: 46px;
  height: 46px;
  border-radius: 17px;
  background: #ba7944;
  border-color: #ba7944;
  color: #ffffff;
}

.ads-toolbar-user-card,
.ads-toolbar-status-card {
  border: 1px solid #ead8c5;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 14px 34px rgba(129, 85, 50, 0.1);
}

.ads-toolbar-user-card {
  min-height: 84px;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-radius: 22px;
}

.ads-toolbar-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f8fafc, #e7dfd5);
}

.ads-toolbar-user-card strong,
.ads-toolbar-user-card span {
  display: block;
}

.ads-toolbar-user-card span {
  color: #667085;
  font-size: 13px;
}

.ads-toolbar-status-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 20px;
  color: #475467;
  font-size: 13px;
}

.ads-main-panel {
  min-width: 0;
  margin: 0;
  padding: 30px;
  border-radius: 30px;
  border: 1px solid #ead8c5;
  background: linear-gradient(158deg, #ffffff 0%, #fffdfb 55%, #fbf4ec 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 22px 70px rgba(112, 75, 43, 0.12);
}
```

- [ ] **Step 2: Add dashboard CSS**

Append this block after the shell styles:

```css
.ads-dashboard-layout {
  display: grid;
  gap: 18px;
}

.ads-dashboard-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.ads-dashboard-metric-card,
.ads-dashboard-panel {
  border: 1px solid #ead8c5;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16px 36px rgba(16, 24, 40, 0.06);
}

.ads-dashboard-metric-card {
  min-height: 118px;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
}

.ads-dashboard-metric-icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
}

.ads-dashboard-metric-icon.sand { background: #f7eadc; color: #a8642f; }
.ads-dashboard-metric-icon.blue { background: #e7f0ff; color: #246bfd; }
.ads-dashboard-metric-icon.purple { background: #f2e6ff; color: #a855f7; }
.ads-dashboard-metric-icon.gold { background: #fff0df; color: #d97706; }

.ads-dashboard-metric-card span,
.ads-dashboard-metric-card small {
  color: #667085;
}

.ads-dashboard-metric-card strong {
  display: block;
  margin-top: 6px;
  color: #101828;
  font-size: 24px;
}

.ads-dashboard-metric-change {
  grid-column: 2;
}

.ads-dashboard-metric-change em {
  display: block;
  font-style: normal;
  font-weight: 800;
}

.ads-dashboard-metric-change .good { color: #079455; }
.ads-dashboard-metric-change .critical { color: #d92d20; }
.ads-dashboard-metric-change .neutral,
.ads-dashboard-metric-change .watch,
.ads-dashboard-metric-change .info {
  color: #667085;
}

.ads-dashboard-main-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.85fr 1.05fr;
  gap: 14px;
}

.ads-dashboard-lower-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(260px, 1.05fr);
  gap: 14px;
}

.ads-dashboard-panel {
  min-width: 0;
  border-radius: 20px;
  padding: 18px;
}

.ads-dashboard-panel-head h2 {
  margin: 0;
  color: #101828;
  font-size: 18px;
}

.ads-dashboard-panel-head p {
  margin: 5px 0 16px;
  color: #667085;
}

.ads-top-campaign-list,
.approval-insight-list {
  display: grid;
  gap: 12px;
}

.ads-top-campaign-row,
.approval-insight-card {
  display: grid;
  gap: 10px;
  border-radius: 14px;
  border: 1px solid #f0dfcc;
  background: #fffaf5;
  padding: 12px;
}

.ads-top-campaign-row {
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
}

.ads-campaign-rank-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ba7944;
}

.approval-insight-card p,
.ads-insight-panel p {
  margin: 6px 0 0;
  color: #667085;
}

.approval-insight-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.clinic-primary-button,
.clinic-secondary-button {
  min-height: 38px;
  border-radius: 14px;
  padding: 0 16px;
  font: inherit;
  font-weight: 780;
  cursor: pointer;
}

.clinic-primary-button {
  border: 0;
  background: #b97843;
  color: #ffffff;
}

.clinic-secondary-button {
  border: 1px solid #ead8c5;
  background: #ffffff;
  color: #7a4d28;
}
```

- [ ] **Step 3: Add responsive CSS**

Append this block after the dashboard styles:

```css
@media (max-width: 1180px) {
  .ads-workspace-shell {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .ads-dashboard-metric-grid,
  .ads-dashboard-lower-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ads-dashboard-main-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .ads-workspace-shell {
    display: block;
    padding: 12px;
  }

  .ads-outer-toolbar {
    min-height: 0;
    border-right: 1px solid #ead8c5;
    border-radius: 24px;
    margin-bottom: 12px;
  }

  .ads-mobile-menu-button {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: 1px solid #ead8c5;
    border-radius: 14px;
    background: #ffffff;
    color: #7a4d28;
  }

  .ads-toolbar-nav,
  .ads-toolbar-status-card {
    display: none;
  }

  .ads-outer-toolbar.menu-open .ads-toolbar-nav,
  .ads-outer-toolbar.menu-open .ads-toolbar-status-card {
    display: grid;
  }

  .ads-main-panel {
    border-radius: 24px;
    padding: 22px;
  }
}

@media (max-width: 640px) {
  .ads-workspace-shell {
    padding: 8px;
  }

  .ads-toolbar-brand strong {
    font-size: 28px;
  }

  .ads-toolbar-user-card {
    grid-template-columns: 42px minmax(0, 1fr) 18px;
  }

  .ads-dashboard-metric-grid,
  .ads-dashboard-lower-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .ads-dashboard-metric-card {
    min-height: 0;
  }
}
```

- [ ] **Step 4: Run focused test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit styles**

```bash
git add src/App.css tests/homeApp.test.tsx
git commit -m "feat: style ads agent clinic workspace"
```

---

### Task 5: Verify integration and browser behavior

**Files:**
- Modify only if verification finds issues: `src/App.tsx`, `src/App.css`, `tests/homeApp.test.tsx`

- [ ] **Step 1: Run the required automated checks**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
npm run test -- tests/page-automation/autoPostRoute.test.tsx
npm run lint
npm run build
```

Expected:

- `tests/homeApp.test.tsx` passes.
- `tests/page-automation/autoPostRoute.test.tsx` passes.
- `npm run lint` exits 0.
- `npm run build` exits 0. The existing Vite chunk-size warning is acceptable.

- [ ] **Step 2: Start local dev server if none is already running**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 3: Browser QA desktop**

Open `http://127.0.0.1:5173/ads-agent` in the in-app browser.

Verify:

- Outer toolbar is visually outside the main panel.
- Toolbar shows `PMC`, clinic label, 8 approved menu items, active `Ads Dashboard`, and user card at the bottom.
- Main panel shows `Ads Dashboard`, KPI cards, performance panel, top campaigns, and approval insights.
- No horizontal overflow at desktop width.
- Browser console has no warn/error entries from the app.

- [ ] **Step 4: Browser QA mobile**

Set viewport to `390x844` and reload `http://127.0.0.1:5173/ads-agent`.

Verify:

- Toolbar collapses to a compact top area.
- Menu trigger opens and closes the navigation.
- Main panel cards stack without horizontal overflow.
- Text does not overlap inside toolbar, cards, or buttons.

- [ ] **Step 5: Route isolation QA**

Open these URLs:

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/ads-agent
http://127.0.0.1:5173/page-automation
```

Verify:

- `/` still shows the Home App Launcher, not Ads Agent.
- `/ads-agent` shows the new Ads Agent shell.
- `/page-automation` still shows Page Automation and does not inherit `.ads-workspace-shell` styling.

- [ ] **Step 6: Fix any QA issues and rerun checks**

If browser QA reveals overflow or broken navigation, make the smallest scoped CSS or markup fix, then rerun:

```bash
npm run test -- tests/homeApp.test.tsx
npm run lint
npm run build
```

Expected: all commands pass after the fix.

- [ ] **Step 7: Commit final QA fixes**

If Task 5 changed files:

```bash
git add src/App.tsx src/App.css tests/homeApp.test.tsx
git commit -m "fix: polish ads agent responsive shell"
```

If Task 5 did not change files, do not create an empty commit.
