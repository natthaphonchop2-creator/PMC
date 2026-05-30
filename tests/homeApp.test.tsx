import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App, { AdGroupsPage, AnalyticsPage, AutomationAdsPage, InsightsPage, ReportsPage } from '../src/App'
import { scopeWorkspaceByDatePreset } from '../src/adsDashboardDateScope'
import { buildRevenueTrendOption } from '../src/adsDashboardChart'
import { HomeApp } from '../src/apps/home/HomeApp'
import { PageAutomationApp } from '../src/apps/page-automation/PageAutomationApp'
import type { WebsiteContext, WorkspaceData } from '../src/types'

describe('Home app shell', () => {
  it('renders Home as a soft clinic app launcher with honest readiness states', () => {
    const html = renderToStaticMarkup(<HomeApp />)
    const text = visibleText(html)

    expect(html).toContain('class="home-clinic-media"')
    expect(html).toContain('src="/pmc-home-clinic-reception.png?v=clean"')
    expect(html).toContain('ยินดีต้อนรับกลับ')
    expect(html).toContain('เลือก App เพื่อเริ่มงาน')
    expect(html).toContain('Smart Clinic Workspace')
    expect(html).toContain('ตั้งค่า API เพื่อให้ App แสดงข้อมูลจริง')
    expect(html).toContain('เปิด Settings')
    expect(html).toContain('Ads Agent')
    expect(html).toContain('Page Auto')
    expect(html).toContain('Settings')
    expect(html).toContain('CRM')
    expect(html).toContain('ERP')
    expect(html).toContain('Knowledge')
    expect(html).toContain('Website')
    expect(html).toContain('Reports')
    expect(countOccurrences(html, 'class="home-app-card')).toBe(8)
    expect(countOccurrences(html, 'href="/ads-agent"')).toBe(1)
    expect(countOccurrences(html, 'href="/page-automation"')).toBe(1)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('พร้อมใช้งาน')
    expect(html).toContain('รอตั้งค่า')
    expect(html).toContain('กำลังมา')
    expect(text).not.toContain('AI Priorities')
    expect(text).not.toContain('System Status')
    expect(text).not.toContain('command bar')
    expect(text).not.toContain('AI Brain')
    expect(text).not.toContain('PMC Master Agent')
    expect(text).not.toContain('source')
    expect(text).not.toContain('bridge')
  })

  it('routes / to Home and /ads-agent to the existing PMC Ads Agent shell', () => {
    withPathname('/', () => {
      const html = renderToStaticMarkup(<App />)
      expect(html).toContain('PMC App Launcher')
      expect(html).toContain('Smart Clinic Workspace')
      expect(html).toContain('เลือก App เพื่อเริ่มงาน')
      expect(html).not.toContain('PMC Ads Agent</strong>')
    })

    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      const text = visibleText(html)

      expect(html).toMatch(/class="[^"]*\bads-workspace-shell\b[^"]*"/)
      expect(html).toContain('class="ads-outer-toolbar')
      expect(html).toContain('aria-label="Ads Agent navigation"')
      expect(html).toContain('href="/"')
      expect(text).toContain('PMC')
      expect(text).toContain('Aesthetic Clinic')
      expect(text).toContain('Ads Dashboard')
      expect(text).toContain('Campaigns')
      expect(text).toContain('Ad Groups')
      expect(text).toContain('Automation Ads')
      expect(text).toContain('Audience')
      expect(text).toContain('Reports')
      expect(text).toContain('Insights')
      expect(text).toContain('Settings')
      expect(countOccurrences(html, 'class="ads-toolbar-item')).toBe(8)
      expect(text.indexOf('Ad Groups')).toBeLessThan(text.indexOf('Insights'))
      expect(text.indexOf('Insights')).toBeLessThan(text.indexOf('Automation Ads'))
      expect(html).toContain('class="ads-toolbar-user-card"')
      expect(html).toContain('class="ads-toolbar-avatar"')
      expect(html).toContain('class="ads-toolbar-api-dot')
      expect(html).toContain('class="ads-toolbar-user-copy"')
      expect(html).toContain('class="ads-toolbar-user-role"')
      expect(text).toContain('ข้อมูลทั้งหมด')
      expect(text).toContain('เลือก Page')
      expect(html).toMatch(/<button(?=[^>]*class="ads-toolbar-user-card")(?=[^>]*aria-label="เลือก Page สำหรับดูข้อมูล")[^>]*>/)
      expect(html).toContain('class="ads-toolbar-user-menu"')
      expect(html).toContain('class="ads-page-selector-menu"')
      expect(html).toContain('class="ads-page-selector-option active"')
      expect(html).not.toContain('ads-toolbar-status-card')
      expect(html).not.toContain('data-source-bar')
      expect(html).toMatch(
        /<button(?=[^>]*class="ads-toolbar-item active")(?=[^>]*aria-current="page")(?=[^>]*aria-label="Ads Dashboard")[^>]*>/,
      )
      expect(html).not.toContain('aria-label="Ads Agent API tools"')
      expect(html).not.toContain('aria-label="เช็ค API"')
      expect(text).not.toContain('เช็ค API')
      expect(html).not.toContain('aria-label="ช่วงวันที่"')
      expect(html).not.toContain('aria-label="เปิดหรือปิด Auto"')
      expect(html).not.toContain('เตรียมรายงาน</button>')
      expect(html).not.toContain('class="nav-groups"')
      expect(html).not.toContain('Optimizer &amp; Automation')
      expect(text).not.toContain('Optimizer & Automation')
      expect(text).not.toContain('ศูนย์ช่วยเหลือ')
      expect(text).not.toContain('AI Brain')
      expect(text).not.toContain('PMC Master Agent')
    })
  })

  it('routes the Ad Groups toolbar item to a dedicated AdGroupsPage', () => {
    const source = readText('../src/App.tsx')
    const navSource = source.slice(source.indexOf('const navItems'), source.indexOf('const datePresetOptions'))
    const routeSource = source.slice(source.indexOf("{activeTab === 'ads'"), source.indexOf("{activeTab === 'marketer'"))
    const toolbarSource = source.slice(source.indexOf('function AdsOuterToolbar'), source.indexOf('function MasterAgentSkeleton'))
    const tabSelectSource = source.slice(source.indexOf('const handleTabSelect'), source.indexOf('const handlePageScopeSelect'))

    expect(navSource).toContain("{ id: 'ads', toolbarKey: 'ad-groups', label: 'Ad Groups'")
    expect(toolbarSource).toContain('onSelect(tab, toolbarKey)')
    expect(toolbarSource).toContain('onClick={() => selectTab(item.id, item.toolbarKey)}')
    expect(routeSource).toContain("activeToolbarKey === 'ad-groups'")
    expect(routeSource).toContain('<AdGroupsPage')
    expect(routeSource).toContain('<AdsManagerPage')
    expect(routeSource.indexOf('<AdGroupsPage')).toBeLessThan(routeSource.indexOf('<AdsManagerPage'))
    expect(tabSelectSource).toContain("nextToolbarKey === 'ad-groups'")
    expect(tabSelectSource).toContain('เปิด Ad Groups')
  })

  it('routes the Insights toolbar item to the rebuilt InsightsPage', () => {
    const source = readText('../src/App.tsx')
    const routeSource = source.slice(source.indexOf("{activeTab === 'marketer'"), source.indexOf("{activeTab === 'optimization'"))

    expect(routeSource).toContain('<InsightsPage')
    expect(routeSource).not.toContain('<AiMarketerPage')
  })

  it('renders the rebuilt Insights page without old assistant-first UI', () => {
    const html = renderToStaticMarkup(
      <InsightsPage
        datePreset="เดือนนี้"
        onBrainApprovalActions={() => undefined}
        onOpenPlanExecution={() => undefined}
        onQueueBrainAction={() => undefined}
        recommendationStates={{}}
        websiteContext={websiteContextForInsights()}
        workspace={workspaceForDateScoping()}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('สรุปล่าสุดจาก AI')
    expect(text).toContain('วิเคราะห์ใหม่ด้วย AI')
    expect(text).toContain('ความมั่นใจ')
    expect(text).toContain('วันนี้ควรรู้อะไร')
    expect(text).toContain('ตัวเลขสำคัญ')
    expect(text).toContain('กราฟแนวโน้ม')
    expect(text).toContain('วิเคราะห์สาเหตุ')
    expect(text).toContain('หลักฐานที่ใช้')
    expect(text).toContain('คำแนะนำที่ควรตรวจ')
    expect(text).toContain('Decision River')
    expect(text).toContain('Drivers')
    expect(text).toContain('Outcomes')
    expect(text).toContain('Evidence')
    expect(text).toContain('Source & caveats')
    expect(text).toContain('Approval required before Meta changes')
    expect(html).toContain('class="insights-scoreboard"')
    expect(html).toContain('class="insights-chart-grid"')
    expect(html).toContain('class="insights-formula-grid"')
    expect(html).toContain('class="insights-evidence-grid"')
    expect(html).toContain('class="insights-recommendation-list"')
    expect(html).toContain('two-column-page ads-tool-window single-column')
    expect(html).toContain('class="insights-decision-river"')
    expect(html).toContain('class="insights-river-desktop"')
    expect(html).toContain('class="insights-river-mobile"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('id="insights-river-tab-drivers"')
    expect(html).toContain('aria-controls="insights-river-mobile-drivers"')
    expect(html).toContain('id="insights-river-mobile-drivers"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-label="Decision River mobile view"')
    expect(html).toContain('aria-label="Decision River evidence"')
    expect(html).toContain('data-river-driver-id="cpm"')
    expect(html).toContain('id="insights-evidence-detail-section"')
    expect(html).toMatch(/<button(?=[^>]*class="insights-river-driver watch selected")(?=[^>]*aria-pressed="true")(?=[^>]*aria-label="CPM:)[^>]*>/)
    expect(text).toContain('ต้องอนุมัติก่อนส่ง Meta')
    expect(text).not.toContain('ผู้ช่วย Insights')
    expect(text).not.toContain('แผนที่เลือกทำต่อ')
    expect(html).not.toContain('ai-brain-panel')
    expect(html).not.toContain('master-agent-launch')
  })

  it('defines responsive Decision River styles for desktop and mobile', () => {
    const css = readText('../src/App.css')
    const mobileTabsRule = extractCssRule(css, '.insights-river-mobile-tabs')
    const mobileTabsButtonRule = extractCssRule(css, '.insights-river-mobile-tabs button')
    const tabletRiverMedia = extractCssBlocks(css, '@media (max-width: 1180px)').join('\n')
    const narrowRiverContainer = extractCssBlocks(css, '@container insights-decision-river (max-width: 900px)').join('\n')
    const mobileShellMedia = extractCssBlocks(css, '@media (max-width: 760px)').join('\n')

    expect(css).toContain('.insights-river-desktop')
    expect(css).toContain('.insights-river-mobile')
    expect(css).toContain('.insights-river-evidence-sheet')
    expect(css).toContain('.two-column-page.single-column')
    expect(css).toContain('container-name: insights-decision-river')
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('.insights-river-driver.critical')
    expect(css).toContain('.insights-river-driver.good')
    expect(css).toContain('.insights-river-outcome.critical')
    expect(css).toContain('.insights-river-outcome.good')
    expect(css).toContain('@media (max-width: 900px)')
    expect(mobileTabsRule).toContain('position: sticky')
    expect(mobileTabsButtonRule).toContain('min-height: 44px')
    expect(tabletRiverMedia).toMatch(/\.insights-river-desktop\s*\{[^}]*display:\s*none/)
    expect(tabletRiverMedia).toMatch(/\.insights-river-mobile\s*\{[^}]*display:\s*grid/)
    expect(narrowRiverContainer).toMatch(/\.insights-river-desktop\s*\{[^}]*display:\s*none/)
    expect(narrowRiverContainer).toMatch(/\.insights-river-mobile\s*\{[^}]*display:\s*grid/)
    expect(mobileShellMedia).toMatch(/\.insights-brief-grid\s*\{[^}]*display:\s*none/)
    expect(mobileShellMedia).toMatch(/\.insights-brief-meta > \.metric-line:nth-child\(2\),\s*\.insights-brief-meta > \.metric-line:nth-child\(3\)\s*\{[^}]*display:\s*none/)
    expect(mobileShellMedia).toMatch(/\.insights-decision-river \.insights-section-head p\s*\{[^}]*display:\s*none/)
    expect(mobileShellMedia).toMatch(/\.insights-river-driver small\s*\{[^}]*display:\s*none/)
    expect(mobileShellMedia).toMatch(/\.insights-river-evidence-sheet\s*\{[^}]*position:\s*fixed/)
    expect(mobileShellMedia).toContain('-webkit-line-clamp: 2')
  })

  it('sends structured Insights payload to the real AI brain endpoint', () => {
    const source = readText('../src/App.tsx')
    const pageSource = source.slice(source.indexOf('export function InsightsPage'), source.indexOf('function InsightsBriefPanel'))
    const endpointSource = readText('../server/openAiPlugin.ts').slice(
      readText('../server/openAiPlugin.ts').indexOf("requestUrl.pathname === '/api/ai/brain'"),
      readText('../server/openAiPlugin.ts').indexOf("requestUrl.pathname === '/api/ai/outcomes'"),
    )

    expect(pageSource).toContain("apiJson<AiBrainApiResponse>('/api/ai/brain'")
    expect(pageSource).toContain('insightsPayload')
    expect(pageSource).toContain('buildInsightsAnalysisPayload')
    expect(pageSource).toContain('rawMetrics')
    expect(pageSource).toContain('derivedMetrics')
    expect(pageSource).toContain('freshness')
    expect(pageSource).toContain('attribution')
    expect(endpointSource).toContain('structuredInsightsPayload')
    expect(endpointSource).toContain('sanitizeUnknownRecord(body.insightsPayload)')
    expect(endpointSource).toContain('insightsPayload: structuredInsightsPayload')
  })

  it('keeps Insights recommendations approval-gated and avoids direct Meta writes', () => {
    const source = readText('../src/App.tsx')
    const pageSource = source.slice(source.indexOf('export function InsightsPage'), source.indexOf('function InsightsBriefPanel'))

    expect(pageSource).toContain('canOpenInsightsApprovalCommand')
    expect(pageSource).toContain('onQueueBrainAction')
    expect(pageSource).toContain('onOpenPlanExecution')
    expect(source).toContain('closeEvidenceAndRestoreFocus')
    expect(source).toContain('onViewEvidenceDetails')
    expect(source).toContain('ดูรายละเอียด')
    expect(pageSource).not.toContain("'/api/meta/")
    expect(pageSource).not.toContain('apiJson<MetaStatusResponse>')
  })

  it('renders the static Ad Groups split inspector workspace', () => {
    const campaigns = [
      {
        aiTag: 'ดี',
        budget: 1200,
        conversions: 14,
        cpa: 42,
        ctr: 2.6,
        deliveryStatus: 'active' as const,
        frequency: 1.4,
        id: 'cmp-1',
        name: 'Lead Botox',
        revenue: 5400,
        roas: 3.4,
        spend: 520,
        status: 'Active' as const,
        tone: 'good' as const,
      },
    ]
    const adSets: WorkspaceData['adSets'] = [
      {
        audience: 'Bangkok',
        bookings: 10,
        budget: 700,
        campaignId: 'cmp-1',
        cpa: 35,
        deliveryStatus: 'active',
        id: 'set-1',
        name: 'Bangkok Core',
        roas: 2.2,
        spend: 350,
        status: 'healthy',
      },
      {
        audience: 'Chiang Mai',
        bookings: 3,
        budget: 500,
        campaignId: 'cmp-1',
        cpa: 50,
        deliveryStatus: 'paused',
        id: 'set-2',
        name: 'Chiang Mai Retarget',
        roas: 1.8,
        spend: 150,
        status: 'watch',
      },
    ]
    const ads: WorkspaceData['adInsights'] = [
      {
        adSetId: 'set-1',
        bookings: 6,
        campaignId: 'cmp-1',
        clicks: 80,
        cpc: 2.5,
        creative: 'Image',
        ctr: 4,
        id: 'ad-1',
        impressions: 2000,
        leads: 12,
        name: 'Botox A',
        roas: 2.5,
        score: 80,
        showRate: 50,
        spend: 200,
        status: 'active',
      },
      {
        adSetId: 'set-1',
        bookings: 2,
        campaignId: 'cmp-1',
        clicks: 30,
        cpc: 5,
        creative: 'Video',
        ctr: 2.5,
        id: 'ad-2',
        impressions: 1200,
        leads: 4,
        name: 'Botox B',
        roas: 1.2,
        score: 50,
        showRate: 50,
        spend: 150,
        status: 'paused',
      },
    ]

    const html = renderToStaticMarkup(
      <AdGroupsPage adSets={adSets} ads={ads} campaigns={campaigns} onMutationComplete={async () => undefined} />,
    )
    const text = visibleText(html)

    expect(html).toContain('ad-groups-workspace')
    expect(text).toContain('Ad Groups')
    expect(text).toContain('ค้นหา Ad Set หรือ Campaign')
    expect(text).toContain('จัดกลุ่มตาม Campaign')
    expect(text).toContain('Bangkok Core')
    expect(text).toContain('Lead Botox')
    expect(text).toContain('2 Ads')
    expect(text).toContain('ตรวจคำสั่งก่อนส่ง Meta')
    expect(text).toContain('ปิด Ad Set')
    expect(text).toContain('แก้งบ')
    expect(text).toContain('แก้ชื่อ')
    expect(text).toContain('ดู Ads')
    expect(text).not.toContain('ตัวจัดการโฆษณา')
    expect(text).not.toContain('แคมเปญที่เลือก')

    const pausedFirstHtml = renderToStaticMarkup(
      <AdGroupsPage
        adSets={[adSets[1], adSets[0]]}
        ads={ads}
        campaigns={campaigns}
        onMutationComplete={async () => undefined}
      />,
    )

    expect(visibleText(pausedFirstHtml)).toContain('เปิด Ad Set')
  })

  it('derives the Ad Groups inspector selection from filtered rows only', () => {
    const source = readText('../src/App.tsx')
    const selectionSource = source.slice(source.indexOf('const filteredRows'), source.indexOf('const activeCount'))

    expect(selectionSource).toContain('const selectedFilteredRow = filteredRows.find((row) => row.id === selectedAdSetId)')
    expect(selectionSource).toContain('const selectedRow = selectedFilteredRow ?? filteredRows[0]')
    expect(selectionSource).not.toContain('rows.find((row) => row.id === selectedAdSetId)')
    expect(selectionSource).not.toContain('?? rows[0]')
  })

  it('wires Ad Groups actions through approval-safe helpers only', () => {
    const source = readText('../src/App.tsx')
    const adGroupsSource = source.slice(source.indexOf('export function AdGroupsPage'), source.indexOf('function AdsManagerPage'))
    const approveCommandSource = extractFunctionBody(adGroupsSource, 'const approveCommand')
    const queueStatusCommandSource = extractFunctionBody(adGroupsSource, 'const queueStatusCommand')
    const queueEditCommandSource = extractFunctionBody(adGroupsSource, 'const queueEditCommand')
    const openEditRowSource = extractFunctionBody(adGroupsSource, 'const openEditRow')
    const inspectorSource = source.slice(source.indexOf('function AdGroupsInspector'), source.indexOf('function AdGroupEditModal'))

    expect(adGroupsSource).toContain('pendingApprovalCommand')
    expect(adGroupsSource).toContain('createAdGroupApprovalCommand')
    expect(adGroupsSource).toContain('AdGroupApprovalModal')
    expect(adGroupsSource).toContain('adGroupApprovalCommandToMetaRequest')
    expect(adGroupsSource).not.toContain('requestDelete')
    expect(approveCommandSource).toContain('apiJson(')
    expect(queueStatusCommandSource).not.toContain('apiJson(')
    expect(queueEditCommandSource).not.toContain('apiJson(')
    expect(openEditRowSource).not.toContain('apiJson(')
    expect(inspectorSource).not.toContain('apiJson(')
    expect(countOccurrences(adGroupsSource, 'apiJson(')).toBe(countOccurrences(approveCommandSource, 'apiJson('))
  })

  it('wires the Ad Groups Ads action to an expandable inspector detail', () => {
    const source = readText('../src/App.tsx')
    const inspectorSource = source.slice(source.indexOf('function AdGroupsInspector'), source.indexOf('function AdGroupEditModal'))

    expect(inspectorSource).not.toContain('onClick={() => undefined}')
    expect(inspectorSource).not.toContain('setShowAdsDetail(false)')
    expect(inspectorSource).toContain('showAdsDetailRowId')
    expect(inspectorSource).toContain('showAdsDetail')
    expect(inspectorSource).toContain('setShowAdsDetail')
    expect(inspectorSource).toContain('aria-expanded={showAdsDetail}')
    expect(inspectorSource).toContain('aria-controls="ad-groups-ads-detail"')
    expect(inspectorSource).toContain('id="ad-groups-ads-detail"')
  })

  it('renders the approved Ads Dashboard sections from existing Ads Agent data', () => {
    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      const text = visibleText(html)

      expect(text).toContain('Ads Dashboard')
      expect(text).toContain('Customize Dashboard')
      expect(html).toMatch(
        /<button(?=[^>]*class="clinic-secondary-button")(?=[^>]*disabled)(?=[^>]*aria-label="ปรับแต่งแดชบอร์ดยังไม่พร้อมใช้งาน")[^>]*>[\s\S]*Customize Dashboard[\s\S]*<\/button>/,
      )
      expect(text).toContain('New Campaign')
      expect(text).toContain('Impressions')
      expect(text).toContain('Clicks')
      expect(text).toContain('Conversions')
      expect(html).toMatch(
        /<article[^>]*class="[^"]*ads-dashboard-metric-card[^"]*"[^>]*>(?:(?!<\/article>)[\s\S])*<span>Cost<\/span>(?:(?!<\/article>)[\s\S])*<\/article>/,
      )
      expect(countOccurrences(html, '<h2>Performance Overview</h2>')).toBe(1)
      expect(html).not.toContain('class="panel revenue-chart-panel"')
      expect(text).toContain('Top Campaigns')
      expect(text).not.toContain('Conversions by Region')
      expect(text).toContain('Cost per Result')
      expect(text).toContain('CTR')
      expect(text).toContain('ROAS')
      expect(text).toContain('PMC Insights')
      expect(html).not.toContain('ads-region-panel')
      expect(html).not.toContain('ads-region-map')
      expect(countOccurrences(html, 'class="ads-dashboard-metric-card"')).toBe(7)
      expect(text).not.toContain('Revenue Overview')
      expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
    })
  })

  it('enables New Campaign and wires it to an in-page campaign composer', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const source = readText('../src/App.tsx')
    const buttonMatch = html.match(/<button(?=[^>]*aria-label="สร้างแคมเปญใหม่")(?=[^>]*aria-haspopup="dialog")[^>]*>[\s\S]*New Campaign[\s\S]*?<\/button>/)

    expect(buttonMatch?.[0]).toBeTruthy()
    expect(buttonMatch?.[0]).not.toContain('disabled')
    expect(source).toContain('setCampaignComposerOpen(true)')
    expect(source).toContain('NewCampaignComposer')
  })

  it('renders the Ads Dashboard date range as a working select control', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        dateLabel="30 วันล่าสุด"
        funnelMetrics={[]}
        onDatePresetChange={() => undefined}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const source = readText('../src/App.tsx')

    expect(html).toContain('class="ads-dashboard-date-pill"')
    expect(html).toContain('aria-label="ช่วงข้อมูล Ads Dashboard"')
    expect(html).toContain('<option value="ข้อมูลทั้งหมด">ข้อมูลทั้งหมด</option>')
    expect(html).toContain('<option value="7 วันล่าสุด">7 วันล่าสุด</option>')
    expect(html).toMatch(/<option(?=[^>]*value="30 วันล่าสุด")(?=[^>]*selected="")[^>]*>30 วันล่าสุด<\/option>/)
    expect(html).toContain('<option value="เดือนนี้">เดือนนี้</option>')
    expect(html).toContain('<option value="ไตรมาสนี้">ไตรมาสนี้</option>')
    expect(html).not.toContain('<span class="ads-dashboard-date-pill"')
    expect(source).toContain('onDatePresetChange={setDatePreset}')
    expect(source).toContain('handleDatePresetChange(event.currentTarget.value)')
  })

  it('scopes Ads Dashboard metrics to the selected date preset from the latest available daily data', () => {
    const scoped = scopeWorkspaceByDatePreset(workspaceForDateScoping(), '7 วันล่าสุด')

    expect(scoped?.trendData.map((point) => point.date)).toEqual([
      '2024-10-04',
      '2024-10-05',
      '2024-10-06',
      '2024-10-07',
      '2024-10-08',
      '2024-10-09',
      '2024-10-10',
    ])
    expect(scoped?.channelPerformance[0]).toEqual(expect.objectContaining({
      bookings: 49,
      clicks: 4900,
      impressions: 49000,
      revenue: 490,
      spend: 49,
    }))
    expect(scoped?.campaigns[0]).toEqual(expect.objectContaining({
      conversions: 49,
      cpa: 10,
      revenue: 980,
      roas: 2,
      spend: 490,
    }))
    expect(scoped?.adSets[0]).toEqual(expect.objectContaining({
      bookings: 49,
      cpa: 10,
      spend: 490,
    }))
    expect(scoped?.funnelMetrics.find((metric) => metric.stage === 'Impressions')?.count).toBe(49000)
    expect(scoped?.funnelMetrics.find((metric) => metric.stage === 'Clicks')?.count).toBe(4900)
    expect(scoped?.funnelMetrics.find((metric) => metric.stage === 'Bookings')?.count).toBe(49)
  })

  it('wires the Ads Insights banner button to open the Insights workspace', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        onOpenInsights={() => undefined}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const source = readText('../src/App.tsx')
    const buttonMatch = html.match(/<button(?=[^>]*aria-label="เปิดเมนู Insights จากแถบด้านซ้าย")(?=[^>]*class="clinic-secondary-button ads-insight-open-button")[^>]*>เปิด Insights<\/button>/)

    expect(buttonMatch?.[0]).toBeTruthy()
    expect(buttonMatch?.[0]).not.toContain('disabled')
    expect(source).toContain("onOpenInsights={() => handleTabSelect('marketer')}")
    expect(source).toContain('onOpenInsights?.()')
  })

  it('wires the Top Campaigns view-all button to open the Campaigns workspace', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'แข็งแรง',
            budget: 99000,
            conversions: 140,
            cpa: 520,
            ctr: 6.1,
            deliveryStatus: 'active',
            frequency: 3.2,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900',
            revenue: 208000,
            roas: 1.92,
            spend: 108000,
            status: 'Active',
            tone: 'good',
          },
        ]}
        funnelMetrics={[]}
        onOpenCampaigns={() => undefined}
        recommendations={[]}
        summary={{
          bookings: 140,
          cac: 0,
          cpa: 520,
          leads: 0,
          paidTreatments: 0,
          revenue: 208000,
          roas: 1.92,
          spend: 108000,
        }}
        trendData={[]}
      />,
    )
    const source = readText('../src/App.tsx')
    const buttonMatch = html.match(/<button(?=[^>]*class="ads-view-all-button")(?=[^>]*aria-label="เปิดหน้า Campaigns เพื่อดูแคมเปญทั้งหมด")[^>]*>ดูแคมเปญทั้งหมด<\/button>/)

    expect(buttonMatch?.[0]).toBeTruthy()
    expect(buttonMatch?.[0]).not.toContain('disabled')
    expect(source).toContain("onOpenCampaigns={() => handleTabSelect('ads', 'campaigns')}")
    expect(source).toContain('onOpenCampaigns?.()')
  })

  it('does not render panel collapse controls in Ads Agent tool windows', () => {
    const automationHtml = renderToStaticMarkup(<AutomationAdsPage components={[]} />)
    const reportsHtml = renderToStaticMarkup(
      <ReportsPage
        datePreset="ข้อมูลทั้งหมด"
        metaInfo={null}
        preparedReport={false}
        recommendations={[]}
        setPreparedReport={() => undefined}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        syncState="No data"
      />,
    )

    const html = `${automationHtml}${reportsHtml}`
    const text = visibleText(html)

    expect(html).not.toContain('class="collapse-button"')
    expect(text).not.toContain('พับข้อมูล')
    expect(text).not.toContain('ข้อมูลถูกพับเก็บไว้')
  })

  it('does not render bottom review status cards in the Ads manager workspace', () => {
    const source = readText('../src/App.tsx')
    const managerSource = source.slice(source.indexOf('function AdsManagerPage'), source.indexOf('function AdsReviewModal'))

    expect(managerSource).not.toContain('state="ข้อมูลล่าสุดพร้อมตรวจ"')
    expect(managerSource).not.toContain('detail="ข้อมูลแคมเปญ ชุดโฆษณา และโฆษณาพร้อมสำหรับรีวิว"')
    expect(managerSource).not.toContain('state="ข้อมูลอาจไม่ล่าสุด"')
    expect(managerSource).not.toContain('detail="ถ้าข้อมูลค้างนาน ควรตรวจข้อมูลอีกครั้งก่อนปรับแคมเปญ"')
  })

  it('shows only the top 3 campaign rankings on Ads Dashboard', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'จับตา',
            budget: 99000,
            conversions: 140,
            cpa: 520,
            ctr: 6.1,
            deliveryStatus: 'active',
            frequency: 3.2,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900 24.7.67',
            revenue: 208000,
            roas: 1.92,
            spend: 108000,
            status: 'Watch',
            tone: 'watch',
          },
          {
            aiTag: 'แข็งแรง',
            budget: 90000,
            conversions: 100,
            cpa: 480,
            ctr: 5.4,
            deliveryStatus: 'active',
            frequency: 3.7,
            id: 'campaign-2',
            name: 'ตัวรี MSG เติมไขมัน 9900 CA เพจTab',
            revenue: 160000,
            roas: 1.6,
            spend: 96000,
            status: 'Healthy',
            tone: 'healthy',
          },
          {
            aiTag: 'แข็งแรง',
            budget: 78000,
            conversions: 96,
            cpa: 510,
            ctr: 4.9,
            deliveryStatus: 'active',
            frequency: 3.1,
            id: 'campaign-3',
            name: 'ตัวรี MSG เติมไขมัน 9900 CA เพจFifth',
            revenue: 146000,
            roas: 1.9,
            spend: 76800,
            status: 'Healthy',
            tone: 'healthy',
          },
          {
            aiTag: 'พักก่อน',
            budget: 70000,
            conversions: 27,
            cpa: 1800,
            ctr: 2.1,
            deliveryStatus: 'limited',
            frequency: 5.2,
            id: 'campaign-4',
            name: 'ตัวเปิด2 MSG เติมไขมัน 9900 24.7.67',
            revenue: 42000,
            roas: 0.74,
            spend: 56800,
            status: 'Watch',
            tone: 'watch',
          },
        ]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 96,
          cac: 0,
          cpa: 758,
          leads: 0,
          paidTreatments: 0,
          revenue: 138324,
          roas: 1.9,
          spend: 72807,
        }}
        trendData={[]}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('Ads Dashboard')
    expect(text).toContain('Top Campaigns')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900 24.7.67')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900 CA เพจTab')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900 CA เพจFifth')
    expect(text).toContain('140 ผลลัพธ์ · ROAS 1.92x')
    expect(html).toContain('ads-top-campaign-list')
    expect(countOccurrences(html, 'class="ads-top-campaign-row"')).toBe(3)
    expect(text).not.toContain('ตัวเปิด2 MSG เติมไขมัน 9900 24.7.67')
    expect(text).not.toContain('กราฟข้อมูลแคมเปญ')
    expect(text).not.toContain('ผลงานแคมเปญ')
    expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
  })

  it('shows a compact Ads Insights performance status with a decorative visual asset', () => {
    const renderDashboard = (summaryOverrides = {}, recommendations = []) =>
      renderToStaticMarkup(
        <AnalyticsPage
          campaigns={[]}
          funnelMetrics={[]}
          recommendations={recommendations}
          summary={{
            bookings: 0,
            cac: 0,
            cpa: 0,
            leads: 0,
            paidTreatments: 0,
            revenue: 0,
            roas: 0,
            spend: 0,
            ...summaryOverrides,
          }}
          trendData={[]}
        />,
      )

    const goodText = visibleText(renderDashboard({ bookings: 18, revenue: 180000, roas: 2.4, spend: 75000 }))
    const mediumText = visibleText(renderDashboard({ bookings: 8, revenue: 72000, roas: 0.93, spend: 708000 }))
    const badText = visibleText(renderDashboard({ bookings: 0, revenue: 0, roas: 0, spend: 20000 }))
    const html = renderDashboard({ bookings: 8, revenue: 72000, roas: 0.93, spend: 708000 })

    expect(goodText).toContain('Your ads are performing Good')
    expect(mediumText).toContain('Your ads are performing Average')
    expect(badText).toContain('Your ads are performing Poor')
    expect(html).toContain('src="/pmc-insights-performance.svg"')
    expect(html).not.toContain('ads-insight-label')
    expect(html).not.toContain('รอคำแนะนำใหม่จากข้อมูลจริง')
    expect(html).not.toContain('รอคำแนะนำใหม่จากข้อมูลจริง')
    expect(html).not.toContain('เมื่อมีสัญญาณสำคัญจากข้อมูลโฆษณา')
    expect(html).not.toContain('insight-bar')
  })

  it('keeps the Ads Insights decorative image as a branded local SVG asset', () => {
    const asset = readText('../public/pmc-insights-performance.svg')

    expect(asset).toContain('<svg')
    expect(asset).toContain('linearGradient')
    expect(asset).toContain('chart-bars')
    expect(asset).toContain('growth-line')
  })

  it('shows Ads Dashboard sections from real analytics data instead of reference placeholders', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'แข็งแรง',
            budget: 120000,
            conversions: 140,
            cpa: 520,
            ctr: 6.1,
            deliveryStatus: 'active',
            frequency: 3.8,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900',
            revenue: 138324,
            roas: 1.9,
            spend: 72807,
            status: 'Active',
            tone: 'good',
          },
          {
            aiTag: 'เฝ้าดู',
            budget: 60000,
            conversions: 30,
            cpa: 780,
            ctr: 4.2,
            deliveryStatus: 'active',
            frequency: 5.1,
            id: 'campaign-2',
            name: 'Review Botox Lead',
            revenue: 42000,
            roas: 1.2,
            spend: 35000,
            status: 'Watch',
            tone: 'watch',
          },
        ]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[
          { bookings: 18, date: '2026-05-16', day: 'May 16', revenue: 38000, spend: 22000 },
          { bookings: 35, date: '2026-05-17', day: 'May 17', revenue: 62000, spend: 31000 },
          { bookings: 52, date: '2026-05-18', day: 'May 18', revenue: 80324, spend: 54807 },
        ]}
        adSets={[
          adSetForDashboard({
            audienceTargeting: {
              devicePlatforms: [],
              exclusions: [],
              genders: [],
              geoLocations: [{ country: 'TH', name: 'Bangkok', type: 'city' }],
              interests: [],
              locales: [],
              placements: [],
              publisherPlatforms: [],
              rawSummary: 'Bangkok',
            },
            bookings: 96,
            spend: 72807,
          }),
          adSetForDashboard({
            audienceTargeting: {
              devicePlatforms: [],
              exclusions: [],
              genders: [],
              geoLocations: [{ country: 'TH', name: 'Chiang Mai', type: 'city' }],
              interests: [],
              locales: [],
              placements: [],
              publisherPlatforms: [],
              rawSummary: 'Chiang Mai',
            },
            bookings: 30,
            id: 'set-2',
            name: 'Chiang Mai Lookalike',
            spend: 35000,
          }),
        ]}
      />,
    )
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
    expect(text).not.toContain('Conversions by Region')
    expect(text).not.toContain('Bangkok')
    expect(text).not.toContain('Chiang Mai')
    expect(text).toContain('PMC Insights')
    expect(text).toContain('Cost per Result')
    expect(text).toContain('CTR')
    expect(text).toContain('ROAS')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900')
    expect(text).toContain('฿108k')
    expect(html).toContain('ads-dashboard-layout')
    expect(countOccurrences(html, 'class="ads-dashboard-metric-card"')).toBe(7)
    expect(html).toContain('class="ads-dashboard-main-grid"')
    expect(html).not.toContain('class="ads-region-map"')
    expect(html).not.toContain('revenue-sparkline')
    expect(html).not.toContain('แนวโน้มย่อ')
    expect(text).not.toContain('Welcome back, James')
    expect(text).not.toContain('AeuxGlobal')
    expect(text).not.toContain('2.45M')
    expect(text).not.toContain('$24,680')
    expect(text).not.toContain('$24,560')
    expect(text).not.toContain('Website')
    expect(text).not.toContain('Mobile App')
  })

  it('removes regional reporting from the Ads Dashboard shell', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        adSets={[]}
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const text = visibleText(html)

    expect(html).toContain('ads-dashboard-layout')
    expect(html).toContain('ads-dashboard-metric-grid')
    expect(html).toContain('ads-dashboard-main-grid')
    expect(html).toContain('ads-dashboard-lower-grid')
    expect(text).toContain('Performance Overview')
    expect(text).toContain('Top Campaigns')
    expect(text).not.toContain('Conversions by Region')
    expect(text).toContain('PMC Insights')
    expect(text).toContain('Cost per Result')
    expect(text).toContain('CTR')
    expect(text).toContain('ROAS')
    expect(html).not.toContain('ads-region-panel')
    expect(html).not.toContain('ads-region-map')
    expect(text).not.toContain('ยังไม่มีข้อมูลพื้นที่จากบัญชีโฆษณา')
    expect(text).not.toContain('เชื่อมต่อข้อมูลพื้นที่จากชุดโฆษณาเพื่อดูสัดส่วนผลลัพธ์ตามจังหวัดหรือเมือง')
    expect(text).not.toContain('AeuxGlobal')
    expect(text).not.toContain('North America')
    expect(text).not.toContain('$24,680')
    expect(text).not.toContain('2.45M')
  })

  it('keeps unavailable Impressions and Clicks honest instead of showing lead, campaign, or booking proxies', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'แข็งแรง',
            budget: 120000,
            conversions: 140,
            cpa: 520,
            ctr: 6.1,
            deliveryStatus: 'active',
            frequency: 3.8,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900',
            revenue: 138324,
            roas: 1.9,
            spend: 72807,
            status: 'Active',
            tone: 'good',
          },
          {
            aiTag: 'เฝ้าดู',
            budget: 60000,
            conversions: 30,
            cpa: 780,
            ctr: 4.2,
            deliveryStatus: 'active',
            frequency: 5.1,
            id: 'campaign-2',
            name: 'Review Botox Lead',
            revenue: 42000,
            roas: 1.2,
            spend: 35000,
            status: 'Watch',
            tone: 'watch',
          },
        ]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[
          { bookings: 18, date: '2026-05-16', day: 'May 16', revenue: 38000, spend: 22000 },
          { bookings: 35, date: '2026-05-17', day: 'May 17', revenue: 62000, spend: 31000 },
          { bookings: 52, date: '2026-05-18', day: 'May 18', revenue: 80324, spend: 54807 },
        ]}
      />,
    )
    const impressionsCard = dashboardMetricCardHtml(html, 'Impressions')
    const clicksCard = dashboardMetricCardHtml(html, 'Clicks')

    expect(visibleText(impressionsCard)).toContain('รอข้อมูล')
    expect(visibleText(impressionsCard)).toContain('รอข้อมูลการแสดงผลสำหรับช่วงนี้')
    expect(visibleText(impressionsCard)).not.toContain('220')
    expect(visibleText(impressionsCard)).not.toContain('2 แคมเปญ')

    expect(visibleText(clicksCard)).toContain('รอข้อมูล')
    expect(visibleText(clicksCard)).toContain('รอข้อมูลการกดสำหรับช่วงนี้')
    expect(visibleText(clicksCard)).not.toContain('170')
  })

  it('uses real funnel metric counts for Impressions and Clicks dashboard cards when available', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[
          { count: 20000, conversionRate: 100, dropOffRate: 0, stage: 'Impressions' },
          { count: 1220, conversionRate: 6.1, dropOffRate: 93.9, stage: 'Clicks' },
        ]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[]}
      />,
    )
    const impressionsCard = dashboardMetricCardHtml(html, 'Impressions')
    const clicksCard = dashboardMetricCardHtml(html, 'Clicks')

    expect(visibleText(impressionsCard)).toContain('20,000')
    expect(visibleText(impressionsCard)).toContain('จำนวนครั้งที่โฆษณาถูกเห็น')
    expect(visibleText(impressionsCard)).not.toContain('รอ Meta ส่ง impressions สำหรับช่วงนี้')
    expect(visibleText(impressionsCard)).not.toContain('220')

    expect(visibleText(clicksCard)).toContain('1,220')
    expect(visibleText(clicksCard)).toContain('จำนวนครั้งที่คนกดจากโฆษณา')
    expect(visibleText(clicksCard)).not.toContain('รอ Meta ส่ง clicks สำหรับช่วงนี้')
    expect(visibleText(clicksCard)).not.toContain('170')
  })

  it('renders KPI sparklines from real dashboard series instead of decorative CSS lines', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[
          { count: 20000, conversionRate: 100, dropOffRate: 0, stage: 'Impressions' },
          { count: 1220, conversionRate: 6.1, dropOffRate: 93.9, stage: 'Clicks' },
          { count: 220, conversionRate: 18, dropOffRate: 82, stage: 'Leads' },
          { count: 170, conversionRate: 77.3, dropOffRate: 22.7, stage: 'Bookings' },
          { count: 128, conversionRate: 75.3, dropOffRate: 24.7, stage: 'Paid' },
        ]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[
          { bookings: 18, clicks: 400, date: '2026-05-16', day: 'May 16', leads: 58, revenue: 38000, spend: 22000, treatments: 10 },
          { bookings: 35, clicks: 520, date: '2026-05-17', day: 'May 17', leads: 72, revenue: 62000, spend: 31000, treatments: 24 },
          { bookings: 52, clicks: 610, date: '2026-05-18', day: 'May 18', leads: 90, revenue: 80324, spend: 54807, treatments: 38 },
        ]}
      />,
    )

    const impressionsCard = dashboardMetricCardHtml(html, 'Impressions')
    const clicksCard = dashboardMetricCardHtml(html, 'Clicks')
    const conversionsCard = dashboardMetricCardHtml(html, 'Conversions')
    const costCard = dashboardMetricCardHtml(html, 'Cost')

    expect(countOccurrences(html, 'data-sparkline="metric-summary"')).toBe(7)
    expect(countOccurrences(html, 'class="ads-dashboard-metric-footer"')).toBe(7)
    expect(impressionsCard).toMatch(/ads-dashboard-metric-footer[\s\S]*ads-dashboard-metric-change[\s\S]*data-sparkline="metric-summary"/)
    expect(impressionsCard).toContain('data-sparkline-source="funnel"')
    expect(impressionsCard).toContain('data-values="20000,1220,220,170,128"')
    expect(clicksCard).toContain('data-sparkline-source="daily-trend"')
    expect(clicksCard).toContain('data-values="400,520,610"')
    expect(conversionsCard).toContain('data-values="18,35,52"')
    expect(costCard).toContain('data-values="22000,31000,54807"')
    expect(impressionsCard).toContain('data-tooltip="Impressions: สรุปเส้นทางลูกค้า · ล่าสุด 128 · สูงสุด 20,000 · ต่ำสุด 128"')
    expect(impressionsCard).toContain('title="Impressions: สรุปเส้นทางลูกค้า · ล่าสุด 128 · สูงสุด 20,000 · ต่ำสุด 128"')
    expect(impressionsCard).toContain('tabindex="0"')
    expect(impressionsCard).toContain('<svg')
    expect(clicksCard).toContain('<path')
    expect(html).not.toContain('ads-mini-sparkline" aria-hidden="true"')
  })

  it('preserves zero funnel metric counts as real Impressions and Clicks data', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[
          { count: 0, conversionRate: 0, dropOffRate: 0, stage: 'Impressions' },
          { count: 0, conversionRate: 0, dropOffRate: 0, stage: 'Clicks' },
        ]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[]}
      />,
    )
    const impressionsCard = dashboardMetricCardHtml(html, 'Impressions')
    const clicksCard = dashboardMetricCardHtml(html, 'Clicks')

    expect(visibleText(impressionsCard)).toContain('Impressions 0')
    expect(visibleText(impressionsCard)).toContain('จำนวนครั้งที่โฆษณาถูกเห็น')
    expect(visibleText(impressionsCard)).not.toContain('รอ Meta ส่ง impressions สำหรับช่วงนี้')

    expect(visibleText(clicksCard)).toContain('Clicks 0')
    expect(visibleText(clicksCard)).toContain('จำนวนครั้งที่คนกดจากโฆษณา')
    expect(visibleText(clicksCard)).not.toContain('รอ Meta ส่ง clicks สำหรับช่วงนี้')
  })

  it('uses the selected ECharts engine for Ads Dashboard performance chart without placeholder data', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'แข็งแรง',
            budget: 120000,
            conversions: 140,
            cpa: 520,
            ctr: 6.1,
            deliveryStatus: 'active',
            frequency: 3.8,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900',
            revenue: 138324,
            roas: 1.9,
            spend: 72807,
            status: 'Active',
            tone: 'good',
          },
          {
            aiTag: 'เฝ้าดู',
            budget: 60000,
            conversions: 30,
            cpa: 780,
            ctr: 4.2,
            deliveryStatus: 'active',
            frequency: 5.1,
            id: 'campaign-2',
            name: 'Review Botox Lead',
            revenue: 42000,
            roas: 1.2,
            spend: 35000,
            status: 'Watch',
            tone: 'watch',
          },
        ]}
        funnelMetrics={[
          { count: 20000, conversionRate: 100, dropOffRate: 0, stage: 'Impressions' },
          { count: 1220, conversionRate: 6.1, dropOffRate: 93.9, stage: 'Clicks' },
          { count: 170, conversionRate: 13.9, dropOffRate: 86.1, stage: 'Bookings' },
        ]}
        recommendations={[]}
        summary={{
          bookings: 170,
          cac: 640,
          cpa: 635,
          leads: 220,
          paidTreatments: 128,
          revenue: 180324,
          roas: 1.67,
          spend: 107807,
        }}
        trendData={[
          { bookings: 18, date: '2026-05-16', day: 'May 16', revenue: 38000, spend: 22000 },
          { bookings: 35, date: '2026-05-17', day: 'May 17', revenue: 62000, spend: 31000 },
          { bookings: 52, date: '2026-05-18', day: 'May 18', revenue: 80324, spend: 54807 },
        ]}
      />,
    )

    expect(countOccurrences(html, 'data-chart-engine="echarts"')).toBe(1)
    expect(countOccurrences(html, 'data-chart-source="real"')).toBe(1)
    expect(html).toContain('data-chart-style="separated-lines"')
    expect(html).toContain('data-chart-layout="separated-lanes"')
    expect(html).toContain('Performance Overview')
    expect(html).toContain('aria-label="กราฟรายวันแบบแยกเส้นรายได้ ค่าโฆษณา และยอดนัดหมาย"')
    expect(html).not.toContain('Revenue Overview')
    expect(html).not.toContain('aria-label="Revenue by Campaign chart"')
    expect(html).not.toContain('aria-label="Funnel คลินิก chart"')
    expect(html).not.toContain('aria-label="กราฟข้อมูลแคมเปญ"')
    expect(html).not.toContain('$24,560')
    expect(html).not.toContain('Website')
    expect(html).not.toContain('Mobile App')
  })

  it('uses per-lane Y numeric axis labels for Performance Overview lanes', () => {
    const option = buildRevenueTrendOption([
      { bookings: 18, date: '2026-05-16', day: 'May 16', revenue: 38000, spend: 22000 },
      { bookings: 35, date: '2026-05-17', day: 'May 17', revenue: 62000, spend: 31000 },
      { bookings: 52, date: '2026-05-18', day: 'May 18', revenue: 80324, spend: 54807 },
    ])
    const xAxes = (Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]) as Array<{
      axisLabel?: { show?: boolean }
    }>
    const yAxes = (Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]) as Array<{
      axisLabel?: { align?: string; formatter?: unknown; margin?: number; show?: boolean; width?: number }
      axisLine?: { show?: boolean }
      interval?: number
      max?: number
      min?: number
      splitNumber?: number
    }>
    const grids = (Array.isArray(option.grid) ? option.grid : [option.grid]) as Array<{
      left?: number
    }>
    const graphicLabels = (Array.isArray(option.graphic) ? option.graphic : [option.graphic]) as Array<{
      left?: number
      style?: { text?: string }
      type?: string
    }>

    expect(grids.map((grid) => grid.left)).toEqual([96, 96, 96])
    expect(graphicLabels.map((label) => label.style?.text)).toEqual(['Revenue', 'Spend', 'Bookings'])
    expect(graphicLabels.map((label) => label.left)).toEqual([96, 96, 96])
    expect(graphicLabels.every((label) => label.type === 'text')).toBe(true)
    expect(xAxes).toHaveLength(3)
    expect(xAxes.map((axis) => axis.axisLabel?.show ?? true)).toEqual([false, false, true])
    expect(yAxes).toHaveLength(3)
    expect(yAxes.map((axis) => ({ interval: axis.interval, max: axis.max, min: axis.min, splitNumber: axis.splitNumber }))).toEqual([
      { interval: 25_000, max: 100_000, min: 0, splitNumber: 4 },
      { interval: 25_000, max: 100_000, min: 0, splitNumber: 4 },
      { interval: 25, max: 100, min: 0, splitNumber: 4 },
    ])
    expect(yAxes.map((axis) => axis.axisLabel?.show ?? true)).toEqual([true, true, true])
    yAxes.forEach((axis) => {
      expect(axis.axisLabel?.align).toBe('right')
      expect(axis.axisLabel?.margin).toBe(12)
      expect(axis.axisLabel?.width).toBe(46)
      expect(axis.axisLine?.show).toBe(true)
    })
    expect(yAxes[0]?.axisLabel?.formatter).toBe(yAxes[1]?.axisLabel?.formatter)
    expect(yAxes[1]?.axisLabel?.formatter).toBe(yAxes[2]?.axisLabel?.formatter)
    if (typeof yAxes[0]?.axisLabel?.formatter === 'function') {
      const tickLabel = String(yAxes[0].axisLabel.formatter(25_000))

      expect(tickLabel).toBe('25k')
      expect(tickLabel).not.toContain('฿')
    }
  })

  it('shows dashboard period changes from real trend data without fake metric values', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 600,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 200,
          revenue: 600,
          roas: 0,
          spend: 600,
        }}
        trendData={[
          { bookings: 100, date: '2026-05-16', day: 'May 16', revenue: 100, spend: 100, treatments: 20 },
          { bookings: 100, date: '2026-05-17', day: 'May 17', revenue: 100, spend: 100, treatments: 20 },
          { bookings: 200, date: '2026-05-18', day: 'May 18', revenue: 200, spend: 200, treatments: 80 },
          { bookings: 200, date: '2026-05-19', day: 'May 19', revenue: 200, spend: 200, treatments: 80 },
        ]}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('Conversions')
    expect(text).toContain('↑ 100.0%')
    expect(text).toContain('เทียบยอดนัดรายวัน')
    expect(text).not.toContain('จากลูกค้าชำระเงินเทียบยอดนัดรายวัน')
    expect(text).toContain('Cost')
    expect(text).toContain('จากค่าโฆษณารายวัน')
    expect(text).toContain('รอข้อมูล')
    expect(text).not.toContain('AI จริง')
    expect(text).not.toContain('$24,680')
  })

  it('keeps Conversions period-change helper copy compact while waiting for paid-customer data', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[
          { bookings: 100, date: '2026-05-16', day: 'May 16', revenue: 0, spend: 0 },
          { bookings: 120, date: '2026-05-17', day: 'May 17', revenue: 0, spend: 0 },
        ]}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('รอข้อมูลชำระเงิน')
    expect(text).not.toContain('ต้องมีข้อมูลลูกค้าชำระเงินรายวัน')
  })

  it('does not show the audit trail panel on Ads analytics', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const text = visibleText(html)

    expect(text).not.toContain('Audit Trail ล่าสุด')
    expect(text).not.toContain('การอนุมัติ เหตุการณ์ซิงก์ และผลการดำเนินการ')
    expect(html).not.toContain('audit-panel')
  })

  it('keeps Reports focused on report creation instead of system monitoring panels', () => {
    const html = renderToStaticMarkup(
      <ReportsPage
        datePreset="7 วันล่าสุด"
        metaInfo={{
          accountName: 'PMC Meta Account',
          adAccountId: 'act_123',
          fetchedAt: '2026-05-22T00:00:00.000Z',
          graphVersion: 'v23.0',
          source: 'test',
          workspaceLabel: 'PMC Workspace',
        }}
        preparedReport={false}
        recommendations={[]}
        setPreparedReport={() => undefined}
        summary={{
          aov: 0,
          bookings: 0,
          budget: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        syncState="Synced"
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('ตัวสร้างรายงาน')
    expect(text).toContain('รายงานฉบับร่าง')
    expect(html).toContain('report-text-preview')
    expect(text).not.toContain('Phase 4 Learning & Monitoring')
    expect(text).not.toContain('รัน Outcome Learning')
    expect(text).not.toContain('Audit Trail ล่าสุด')
    expect(text).not.toContain('การอนุมัติ เหตุการณ์ซิงก์ และผลการดำเนินการ')
    expect(html).not.toContain('audit-panel')
  })

  it('does not present deterministic Meta guardrail actions as AI approval items', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        recommendations={[
          {
            action: 'ลดงบ 10-15%',
            confidence: 80,
            evidence: 'ROAS 0.84x ต่ำกว่าเกณฑ์',
            guardrail: 'ตรวจข้อมูลล่าสุดก่อนดำเนินการ',
            id: 'meta-action-campaign-1-budget-protection',
            impact: 'ลด spend leakage',
            risk: 'Medium',
            targetName: 'ป้องกันงบและตรวจ Tracking',
            title: 'ป้องกันงบและตรวจ Tracking',
          },
        ]}
        summary={{
          bookings: 0,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 0,
          revenue: 0,
          roas: 0,
          spend: 0,
        }}
        trendData={[]}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('PMC Insights')
    expect(text).toContain('Your ads are performing Poor')
    expect(text).not.toContain('ป้องกันงบและตรวจ Tracking')
    expect(text).not.toContain('Meta metrics')
    expect(text).not.toContain('PMC Master Agent')
    expect(text).not.toContain('หลังผู้ใช้')
    expect(text).not.toContain('AI เท่านั้น')
    expect(text).not.toContain('AI จริง')
  })

  it('shows Automation Ads as a safe approval queue workspace', () => {
    const html = renderToStaticMarkup(
      <AutomationAdsPage
        ads={[
          { adSetId: 'set-1', bookings: 1, campaignId: 'campaign-1', clicks: 44, cpc: 24, creative: 'Video', ctr: 1.1, id: 'ad-1', impressions: 4000, leads: 3, name: 'Filler Loser', roas: 0.4, score: 38, showRate: 33, spend: 1050, status: 'active' },
        ]}
        adSets={[
          { audience: 'Retarget', bookings: 1, budget: 1500, campaignId: 'campaign-1', cpa: 520, deliveryStatus: 'active', id: 'set-1', name: 'Retarget Filler', roas: 0.4, spend: 1300, status: 'watch' },
        ]}
        campaigns={[
          { aiStatus: 'watch', aiSummary: 'ต้องจับตา creative fatigue', budget: 3000, conversions: 1, cpa: 520, ctr: 1.1, deliveryStatus: 'active', frequency: 4.7, id: 'campaign-1', name: 'Filler Review', objective: 'Leads', revenue: 520, roas: 0.4, spend: 1300 },
        ]}
        components={[
          {
            ads: 1,
            campaignId: 'campaign-1',
            clicks: 640,
            costPerResult: 742,
            ctr: 6.39,
            id: 'creative-1',
            purchaseValue: 138324,
            results: 96,
            roas: 3.2,
            score: 8.5,
            service: 'เติมไขมัน',
            spend: 72000,
            thumbTone: 'blue',
            title: 'เติมไขมัน 9900',
            tone: 'good',
          },
        ]}
      />,
    )
    const text = visibleText(html)
    const source = readText('../src/App.tsx')

    expect(text).toContain('Automation Ads')
    expect(text).toContain('ตรวจ Automation ตอนนี้')
    expect(text).toContain('Approval Queue')
    expect(text).toContain('Rule Builder')
    expect(text).toContain('Run History')
    expect(text).toContain('ต้องอนุมัติก่อนส่ง Meta')
    expect(text).toContain('กฎที่เปิดใช้งาน')
    expect(text).not.toContain('Automation Ads กำลังอัพเดท')
    expect(text).not.toContain('ทีมกำลังจัดระบบ workflow โฆษณาอัตโนมัติ')
    expect(text).not.toContain('กลับมาทำต่อเร็ว ๆ นี้')
    expect(html).not.toContain('placeholder="ค้นหาครีเอทีฟ"')
    expect(text).not.toContain('บรีฟครีเอทีฟ')
    expect(text).not.toContain('Creative Studio')
    expect(text).not.toContain('สตูดิโอครีเอทีฟ')
    expect(text).not.toContain('ใช้เป็นต้นแบบ')
    expect(source).toContain('evaluateAutomationRules')
    expect(source).toContain('workspace={visibleWorkspace}')
    expect(source).toContain('ads={visibleWorkspace?.adInsights ?? []}')
    expect(source).not.toMatch(/AutomationAdsPage[\s\S]{0,260}apiJson\('\/api\/meta/)
  })

  it('uses standard launcher icons for Ads and Page Auto entries on Home', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('class="lucide lucide-infinity')
    expect(html).toContain('class="lucide lucide-message-circle')
    expect(html).not.toContain('src="/pmc-ads-logo.png?v=transparent"')
    expect(html).not.toContain('src="/pmc-page-auto-logo.png?v=transparent"')
    expect(html).not.toContain('home-product-logo')
  })

  it('keeps standard Home icons free of product-logo styling', () => {
    const homeCss = readText('../src/apps/home/styles.css')

    expect(homeCss).not.toContain('.home-product-logo')
    expect(homeCss).not.toContain('.home-suggestion-icon')
    expect(homeCss).toMatch(/\.home-app-icon\.blue\s*\{\s*background:\s*#eaf0f2;\s*color:\s*#587484;\s*\}/)
    expect(homeCss).not.toContain('background: linear-gradient(90deg, var(--home-taupe), #2f86eb, #30a77c)')
  })

  it('marks future modules as setup launchers instead of pretending they are live routes', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('ยังไม่ได้เชื่อมต่อระบบ CRM')
    expect(html).toContain('กำลังเตรียมโมดูล ERP')
    expect(html).toContain('รอตั้งค่าฐานความรู้')
    expect(html).toContain('กำลังเตรียมข้อมูลเว็บไซต์')
    expect(html).toContain('กำลังเตรียมรายงานรวม')
    expect(countOccurrences(html, 'class="home-app-card is-disabled"')).toBe(5)
    expect(html).not.toContain('<a class="home-app-card" href="#crm"')
    expect(html).not.toContain('<a class="home-app-card" href="#erp"')
    expect(html).not.toContain('<a class="home-app-card" href="#knowledge"')
    expect(html).not.toContain('<a class="home-app-card" href="#website-insight"')
    expect(html).not.toContain('<a class="home-app-card" href="#reports"')
  })

  it('uses clinic media without repeated PMC brand decoration', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(countOccurrences(html, 'src="/pmc-home-clinic-reception.png?v=clean"')).toBe(1)
    expect(html).toContain('alt="PMC Aesthetic Clinic reception"')
    expect(html).not.toContain('src="/pmc-ads-logo.png?v=transparent"')
    expect(html).not.toContain('src="/pmc-page-auto-logo.png?v=transparent"')
    expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
    expect(html).not.toContain('home-tool-watermark')
    expect(html).not.toContain('home-chip-mark')
    expect(html).not.toContain('home-action-mark')
  })

  it('renders the inbox-first Page Automation shell at root and messages routes', () => {
    for (const pathname of ['/page-automation', '/page-automation/messages']) {
      withPathname(pathname, () => {
        const html = renderToStaticMarkup(<PageAutomationApp />)

        expect(html).not.toContain('src="/pmc-page-auto-logo.png?v=transparent"')
        expect(html).not.toContain('pa-brand-logo-wrap')
        expect(html).toContain('PMC Page Auto')
        expect(html).toContain('class="pa-shell"')
        expect(html).toContain('ศูนย์จัดการเพจและข้อความ')
        expect(html).toContain('ข้อความ')
        expect(html).toContain('โพสต์')
        expect(html).toContain('วิเคราะห์เพจ')
        expect(html).toContain('รายงาน')
        expect(countOccurrences(html, 'href="/page-automation"')).toBe(1)
        expect(html).not.toContain('href="/page-automation/messages"')
        expect(html).toContain('href="/"')
        expect(html).toContain('กลับ Home')
        expect(html).toContain('aria-label="กลับหน้า Home"')
        expect(html).toContain('กำลังโหลด')
        expect(html).toContain('Auto ปิด')
        expect(html).toContain('ทีมตรวจได้ก่อนส่ง')
        expect(html).toContain('pa-inbox-workspace')
        expect(html).toContain('ข้อความที่ควรดู')
        expect(html).not.toContain('Meta API operations')
        expect(html).not.toContain('Unified inbox')
        expect(html).not.toContain('Dashboard')
        expect(html).not.toContain('class="app-shell"')
        expect(html).not.toContain('page-app-shell')
        expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
        expect(html).not.toContain('<a class="pa-back-link" href="/" title="กลับ PMC Ads Agent">PMC</a>')
      })
    }
  })

  it('keeps Page Automation aligned with the soft launcher palette', () => {
    const homeCss = readText('../src/apps/home/styles.css')
    const pageCss = readText('../src/apps/page-automation/styles.css')
    const shellRule = pageCss.match(/\.pa-shell\s*\{[^}]+\}/)?.[0] ?? ''

    expect(homeCss).toContain('#fbfaf8')
    expect(homeCss).toContain('#aa8358')
    expect(homeCss).toContain('#167047')
    expect(shellRule).toContain('--pa-bg: #fbfaf8;')
    expect(shellRule).toContain('--pa-taupe: #aa8358;')
    expect(shellRule).toContain('--pa-blue: #587484;')
    expect(shellRule).toContain('--pa-green: #167047;')
    expect(shellRule).toContain('background-image: url("/pmc-page-auto-background.png");')
    expect(pageCss).toContain('#fbfaf8')
    expect(pageCss).toContain('#aa8358')
    expect(pageCss).toContain('#587484')
    expect(pageCss).toContain('.pa-inbox-workspace')
    expect(pageCss).toContain('grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.42fr) minmax(250px, 0.8fr)')
    expect(pageCss).toContain('@media (max-width: 760px)')
    expect(pageCss).not.toContain('#2f86eb')
    expect(pageCss).not.toContain('#30d5a8')
    expect(pageCss).not.toMatch(/linear-gradient\([^)]*(#2f86eb|#30d5a8|#30a77c|#e16447)[^)]*\)/i)
    expect(pageCss).not.toContain('#242424')
    expect(pageCss).not.toContain('#e16447')
  })

  it('has Ads Agent outer-toolbar shell styles isolated from Home and Page Automation', () => {
    const appCss = readText('../src/App.css')
    const homeCss = readText('../src/apps/home/styles.css')
    const pageCss = readText('../src/apps/page-automation/styles.css')

    expect(appCss).toContain('.ads-workspace-shell')
    expect(appCss).toMatch(/\.ads-workspace-shell\s*\{[^}]*grid-template-columns:\s*[^;}]+/s)
    expect(appCss).toContain('.ads-outer-toolbar')
    expect(appCss).toContain('.ads-main-panel')
    expect(appCss).toContain('.ads-toolbar-item.active')
    expect(appCss).toContain('.ads-dashboard-metric-grid')
    expect(appCss).toContain('@media (max-width: 760px)')
    expect(appCss).toContain('@media (max-width: 640px)')
    expect(homeCss).not.toContain('ads-workspace-shell')
    expect(pageCss).not.toContain('ads-workspace-shell')
  })

  it('uses the supplied clinic shell image as the Ads Agent toolbar and panel background', () => {
    const appCss = readText('../src/App.css')
    const backgroundBytes = readFileSync(new URL('../public/pmc-dashboard-shell-bg.png', import.meta.url))
    const workspaceShellBlock = appCss.match(/\.ads-workspace-shell\s*\{[^}]*\}/s)?.[0] ?? ''
    const outerToolbarBlock = appCss.match(/\.ads-outer-toolbar\s*\{[^}]*\}/s)?.[0] ?? ''
    const mainPanelBlock = appCss.match(/\.ads-main-panel\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(backgroundBytes.byteLength).toBeGreaterThan(900_000)
    expect(backgroundBytes.byteLength).toBeLessThan(1_000_000)
    expect(appCss).toContain("url('/pmc-dashboard-shell-bg.png')")
    expect(workspaceShellBlock).toContain('background: #fbf7ef;')
    expect(workspaceShellBlock).not.toContain('pmc-dashboard-shell-bg.png')
    expect(outerToolbarBlock).toContain("url('/pmc-dashboard-shell-bg.png')")
    expect(outerToolbarBlock).not.toContain('linear-gradient')
    expect(mainPanelBlock).toContain("url('/pmc-dashboard-shell-bg.png')")
    expect(mainPanelBlock).not.toContain('linear-gradient')
    expect(appCss).not.toMatch(/\.ads-toolbar-brand > \*\s*\{[^}]*opacity:\s*0/s)
    expect(appCss).not.toContain("url('/pmc-soft-dashboard-bg.png')")
    expect(appCss).not.toContain('rgba(255, 253, 249, 0.9), rgba(255, 253, 249, 0.86)')
  })

  it('does not animate removed sidebar mascot targets in the Ads Agent shell', () => {
    const appSource = readText('../src/App.tsx')

    expect(appSource).not.toContain("'.sidebar-mascot'")
    expect(appSource).toContain("'.ads-toolbar-brand-mark'")
  })

  it('keeps the Ads Agent toolbar wordmark single-column when the logo mark is hidden', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.ads-toolbar-brand\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*0;/)
    expect(appCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.ads-toolbar-brand\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*0;/)
  })

  it('uses the compact Thai-friendly Ads Agent typography scale', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toMatch(/\.ads-workspace-shell\s*\{[^}]*font-family:\s*'Noto Sans Thai', 'IBM Plex Sans Thai', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;[^}]*font-size:\s*13px;/)
    expect(appCss).toMatch(/\.ads-toolbar-brand strong\s*\{[^}]*font-family:\s*inherit;[^}]*font-size:\s*26px;/)
    expect(appCss).toMatch(/\.ads-toolbar-item\s*\{[^}]*font-size:\s*12\.5px;/)
    expect(appCss).toMatch(/\.ads-dashboard-head h2\s*\{[^}]*font-size:\s*30px;/)
    expect(appCss).toMatch(/\.ads-dashboard-metric-card strong\s*\{[^}]*font-size:\s*24px;/)
    expect(appCss).toMatch(/\.ads-dashboard-panel-head h2\s*\{[^}]*font-size:\s*14\.5px;/)
  })

  it('shows KPI sparkline data on hover and keyboard focus', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toMatch(/\.ads-mini-sparkline::after\s*\{[^}]*content:\s*attr\(data-tooltip\);/)
    expect(appCss).toMatch(/\.ads-mini-sparkline:hover::after,\s*\.ads-mini-sparkline:focus-visible::after\s*\{[^}]*opacity:\s*1;/)
    expect(appCss).toMatch(/\.ads-mini-sparkline:focus-visible\s*\{[^}]*box-shadow:/)
  })

  it('centers lower metric card sparklines inside their cards', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toMatch(/\.ads-dashboard-lower-grid \.ads-dashboard-metric-card \.ads-dashboard-metric-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/)
    expect(appCss).toMatch(/\.ads-dashboard-lower-grid \.ads-mini-sparkline\s*\{[^}]*justify-self:\s*center;[^}]*width:\s*min\(150px,\s*100%\);/)
  })

  it('removes the Ads Agent API topbar gap and keeps dashboard actions aligned', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).not.toMatch(/\.ads-main-panel \.topbar\s*\{/)
    expect(appCss).toMatch(/\.ads-main-panel \.page-body\s*\{[^}]*padding:\s*28px 32px 30px;/)
    expect(appCss).toMatch(/\.ads-dashboard-head\s*\{[^}]*align-items:\s*flex-start;/)
    expect(appCss).toMatch(/\.ads-dashboard-date-pill\s*\{[^}]*margin-top:\s*10px;/)
    expect(appCss).toMatch(/\.ads-dashboard-actions\s*\{[^}]*align-self:\s*flex-start;[^}]*flex-wrap:\s*nowrap;[^}]*padding-top:\s*15px;/)
    expect(appCss).toMatch(/\.ads-workspace-shell \.clinic-primary-button,\s*\.ads-workspace-shell \.clinic-secondary-button\s*\{[^}]*white-space:\s*nowrap;/)
  })

  it('lays out the Ads Agent user card as a compact profile control', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toMatch(/\.ads-toolbar-user-card\s*\{[^}]*grid-template-columns:\s*42px minmax\(0,\s*1fr\) 30px;[^}]*padding:\s*10px 12px;/)
    expect(appCss).toMatch(/\.ads-toolbar-avatar\s*\{[^}]*position:\s*relative;[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*width:\s*42px;[^}]*height:\s*42px;/)
    expect(appCss).toMatch(/\.ads-toolbar-api-dot\s*\{[^}]*position:\s*absolute;[^}]*right:\s*1px;[^}]*bottom:\s*1px;[^}]*width:\s*10px;[^}]*height:\s*10px;/)
    expect(appCss).toMatch(/\.ads-toolbar-api-dot\.live\s*\{[^}]*background:\s*#24b56b;/)
    expect(appCss).toMatch(/\.ads-toolbar-api-dot\.error\s*\{[^}]*background:\s*#dc4b43;/)
    expect(appCss).toMatch(/\.ads-toolbar-user-copy\s*\{[^}]*display:\s*grid;[^}]*gap:\s*4px;/)
    expect(appCss).toMatch(/\.ads-toolbar-user-role\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*5px;/)
    expect(appCss).toMatch(/\.ads-toolbar-user-menu\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border-radius:\s*999px;/)
    expect(appCss).toMatch(/\.ads-page-selector-popover\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 10px\);/)
    expect(appCss).toMatch(/\.ads-page-selector-option\s*\{[^}]*grid-template-columns:\s*34px minmax\(0,\s*1fr\);/)
  })

  it('adds subtle decorative effects to the Ads Agent shell without adding visible helper text', () => {
    const appCss = readText('../src/App.css')

    expect(appCss).toContain('@keyframes clinicShellDrift')
    expect(appCss).toContain('@keyframes clinicSheenSweep')
    expect(appCss).toContain('@keyframes clinicLinePulse')
    expect(appCss).toMatch(/\.ads-workspace-shell::before\s*\{[\s\S]*?animation:\s*clinicShellDrift 18s linear infinite;/)
    expect(appCss).toMatch(/\.ads-main-panel::before\s*\{[\s\S]*?repeating-linear-gradient[\s\S]*?animation:\s*clinicShellDrift 24s linear infinite;/)
    expect(appCss).toMatch(/\.ads-toolbar-item::after\s*\{[\s\S]*?linear-gradient\(90deg,\s*transparent,\s*rgba\(255,\s*255,\s*255,\s*0\.62\),\s*transparent\)/)
    expect(appCss).toMatch(/\.ads-toolbar-item:hover::after,\s*\.ads-toolbar-item:focus-visible::after,\s*\.ads-toolbar-item\.active::after\s*\{[\s\S]*?animation:\s*clinicSheenSweep 1\.8s ease-out;/)
    expect(appCss).toMatch(/\.ads-dashboard-metric-card::after,\s*\.ads-dashboard-panel::after,\s*\.ads-workspace-shell \.panel::after\s*\{[\s\S]*?pointer-events:\s*none;/)
    expect(appCss).toMatch(/\.ads-workspace-shell \.automation-run-monitor::before\s*\{[\s\S]*?animation:\s*clinicLinePulse 3\.8s ease-in-out infinite;/)
    expect(appCss).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation-duration:\s*0\.01ms !important;/)
  })

  it('applies the approved clinic shell styling to every Ads Agent toolbar workspace', () => {
    const appSource = readText('../src/App.tsx')
    const appCss = readText('../src/App.css')

    expect(appSource).toContain('two-column-page ads-tool-window')
    expect(appSource).toContain("aside ? 'has-right-rail' : 'single-column'")
    expect(appCss).toMatch(/\.ads-workspace-shell \.ads-tool-window\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(260px,\s*300px\);[^}]*gap:\s*12px;/s)
    expect(appCss).toMatch(/\.ads-workspace-shell \.ads-tool-window\.single-column\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s)
    expect(appCss).toMatch(/\.ads-workspace-shell \.panel\s*\{[^}]*background:\s*rgba\(255,\s*253,\s*249,\s*0\.86\);[^}]*box-shadow:\s*0 12px 28px rgba\(77,\s*57,\s*32,\s*0\.065\);/s)
    expect(appCss).toMatch(/\.ads-workspace-shell \.panel-head h2\s*\{[^}]*font-size:\s*14\.5px;[^}]*font-weight:\s*900;/s)
    expect(appCss).toMatch(/\.ads-workspace-shell \.primary-button\s*\{[^}]*background:\s*linear-gradient\(135deg,\s*#c18a55,\s*#9c6433\);/s)
    expect(appCss).toMatch(/\.automation-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s)
    expect(appCss).toMatch(/\.ads-workspace-shell \.ads-entity-row\.campaign\s*\{[^}]*rgba\(157,\s*110,\s*62,\s*0\.12\)/s)
    expect(appCss).toMatch(/@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.ads-workspace-shell \.ads-tool-window\s*\{[^}]*grid-template-columns:\s*1fr;/)
  })

  it('does not run dashboard card animations when the active tool has no dashboard cards', () => {
    const appSource = readText('../src/App.tsx')

    expect(appSource).toContain("root.querySelectorAll('.ads-dashboard-metric-card, .ads-dashboard-panel')")
    expect(appSource).toMatch(/if \(dashboardAnimationTargets\.length > 0\) \{[\s\S]*?timeline\.from\(dashboardAnimationTargets,/)
  })

  it('keeps Insights copy user-facing instead of internal agent labels', () => {
    const appSource = readText('../src/App.tsx')

    expect(appSource).toContain('สรุปล่าสุดจาก AI')
    expect(appSource).toContain('คำแนะนำที่ควรตรวจ')
    expect(appSource).not.toContain('ผู้ช่วย Insights')
    expect(appSource).not.toContain('PMC Master Agent')
    expect(appSource).not.toContain('เรียก Master Agent')
    expect(appSource).not.toContain('AI Brain')
  })

  it('does not show hardcoded sidebar alert or task counts as if they were live data', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).not.toContain('home-count')
  })

  it('keeps the Ads sidebar AI notice from overlapping the mascot image', () => {
    const appCss = readText('../src/App.css')
    const mascotStageRule = appCss.match(/\.sidebar-mascot-stage\s*\{[^}]+\}/)?.[0] ?? ''
    const mascotMessageRule = appCss.match(/\.sidebar-mascot-message\s*\{[^}]+\}/)?.[0] ?? ''

    expect(mascotStageRule).toContain('grid-template-rows: auto auto')
    expect(mascotStageRule).toContain('gap: 20px')
    expect(mascotMessageRule).toContain('position: relative')
    expect(mascotMessageRule).not.toContain('position: absolute')
    expect(mascotMessageRule).not.toContain('transform: translateX(-50%)')
  })

  it('has responsive Home rules for slanted desktop panel and stacked mobile layout', () => {
    const homeCss = readText('../src/apps/home/styles.css')

    expect(homeCss).toContain('.home-stage')
    expect(homeCss).toContain('.home-clinic-media')
    expect(homeCss).toContain('.home-launcher-panel')
    expect(homeCss).toContain('clip-path: polygon(12% 0, 100% 0, 100% 100%, 0 100%)')
    expect(homeCss).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(homeCss).toContain('@media (max-width: 1120px)')
    expect(homeCss).toContain('clip-path: none')
    expect(homeCss).toContain('@media (max-width: 760px)')
    expect(homeCss).toContain('@media (max-width: 480px)')
    expect(homeCss).toContain('overflow-wrap: anywhere')
    expect(homeCss).not.toContain('radial-gradient(circle at 15% 0%')
    expect(homeCss).not.toContain('home-ai-note')
  })

  it('keeps Home launcher regression fixes for status dots, desktop copy, and static controls', () => {
    const homeCss = readText('../src/apps/home/styles.css')
    const roundButtonRule = homeCss.match(/\.home-round-button\s*\{[^}]+\}/)?.[0] ?? ''

    expect(homeCss).toContain('.home-dot.good')
    expect(homeCss).toContain('@media (max-width: 1400px) and (min-width: 1121px)')
    expect(homeCss).toContain('.home-clinic-copy p')
    expect(roundButtonRule).not.toContain('cursor: pointer')
  })

  it('keeps Home motion minimal with a reduced-motion escape hatch', () => {
    const homeCss = readText('../src/apps/home/styles.css')

    expect(homeCss).toContain('@keyframes home-modal-in')
    expect(homeCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(homeCss).toContain('animation-iteration-count: 1 !important')
    expect(homeCss).not.toContain('@keyframes home-panel-sweep')
    expect(homeCss).not.toContain('@keyframes home-status-breathe')
    expect(homeCss).not.toContain('@keyframes home-image-drift')
  })
})

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1
}

function readText(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function extractCssRule(css: string, selector: string) {
  return extractCssBlock(css, selector)
}

function extractCssBlocks(css: string, marker: string) {
  const blocks: string[] = []
  let searchFrom = 0
  while (searchFrom < css.length) {
    const markerIndex = css.indexOf(marker, searchFrom)
    if (markerIndex === -1) break
    const block = extractCssBlock(css.slice(markerIndex), marker)
    blocks.push(block)
    searchFrom = markerIndex + block.length
  }

  expect(blocks.length).toBeGreaterThan(0)
  return blocks
}

function extractCssBlock(css: string, marker: string) {
  const markerIndex = css.indexOf(marker)
  expect(markerIndex).toBeGreaterThanOrEqual(0)
  const openBraceIndex = css.indexOf('{', markerIndex)
  expect(openBraceIndex).toBeGreaterThan(markerIndex)

  let depth = 0
  for (let index = openBraceIndex; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(markerIndex, index + 1)
  }

  throw new Error(`Could not extract CSS block for ${marker}`)
}

function adSetForDashboard(overrides = {}) {
  return {
    audience: 'Bangkok skincare buyers',
    budget: 50000,
    bookings: 10,
    campaignId: 'campaign-1',
    cpa: 500,
    deliveryStatus: 'active',
    id: 'set-1',
    name: 'Bangkok Core Audience',
    roas: 1.5,
    spend: 5000,
    status: 'healthy',
    ...overrides,
  }
}

function workspaceForDateScoping(): WorkspaceData {
  const trendData = Array.from({ length: 10 }, (_, index) => {
    const value = index + 1
    return {
      bookings: value,
      clicks: value * 100,
      cpa: 1,
      date: `2024-10-${String(value).padStart(2, '0')}`,
      impressions: value * 1000,
      leads: value * 10,
      reach: value * 500,
      revenue: value * 10,
      showUps: value,
      spend: value,
      treatments: value,
    }
  })

  return {
    actions: [],
    adInsights: [
      {
        adSetId: 'set-1',
        bookings: 55,
        campaignId: 'campaign-1',
        clicks: 5500,
        cpc: 0.1,
        creative: 'creative-1',
        ctr: 10,
        id: 'ad-1',
        impressions: 55000,
        leads: 550,
        name: 'Clinic Lead Ad',
        roas: 2,
        score: 80,
        showRate: 50,
        spend: 550,
        status: 'active',
      },
    ],
    adSets: [
      {
        audience: 'Bangkok skincare buyers',
        bookings: 55,
        budget: 1000,
        campaignId: 'campaign-1',
        cpa: 10,
        deliveryStatus: 'active',
        id: 'set-1',
        name: 'Bangkok Core Audience',
        roas: 2,
        spend: 550,
        status: 'healthy',
      },
    ],
    appointmentStages: [],
    auditTrail: [],
    autoAds: [],
    autoMode: 'suggest',
    campaigns: [
      {
        aiStatus: 'healthy',
        aiSummary: 'Stable test campaign',
        budget: 1000,
        conversions: 55,
        cpa: 10,
        ctr: 10,
        deliveryStatus: 'active',
        frequency: 1.2,
        id: 'campaign-1',
        name: 'Date scoped campaign',
        objective: 'OUTCOME_LEADS',
        revenue: 1100,
        roas: 2,
        spend: 550,
      },
    ],
    channelPerformance: [
      {
        bookings: 55,
        channel: 'Meta Ads',
        clicks: 5500,
        firstTimePatients: 55,
        impressions: 55000,
        leadQuality: 80,
        leads: 550,
        reach: 27500,
        revenue: 550,
        showUps: 55,
        spend: 55,
        treatments: 55,
      },
    ],
    complianceReviews: [],
    funnelMetrics: [
      { benchmark: 'Meta delivery', conversionRate: 100, count: 55000, dropOffRate: 0, help: '', stage: 'Impressions' },
      { benchmark: 'Clicks rate', conversionRate: 10, count: 5500, dropOffRate: 90, help: '', stage: 'Clicks' },
      { benchmark: 'Bookings rate', conversionRate: 10, count: 55, dropOffRate: 90, help: '', stage: 'Bookings' },
    ],
    insightComponents: [],
    insights: [],
    memoryItems: [],
    serviceLines: [],
    tasks: [],
    trendData,
    updatedAt: 'Meta sync',
  }
}

function websiteContextForInsights(): WebsiteContext {
  return {
    activeTab: 'marketer',
    capturedAt: '2026-05-29T08:00:00.000Z',
    dataState: 'live',
    datePreset: 'เดือนนี้',
    route: '/ads-agent',
    visibleCards: ['Insights', 'สรุปล่าสุดจาก AI', 'ตัวเลขสำคัญ'],
    visibleTableRows: [],
  }
}

function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function dashboardMetricCardHtml(html: string, label: string) {
  const match = html.match(new RegExp(`<article class="ads-dashboard-metric-card">(?:(?!</article>)[\\s\\S])*<span>${label}</span>(?:(?!</article>)[\\s\\S])*</article>`))
  expect(match?.[0]).toBeTruthy()
  return match?.[0] ?? ''
}

function extractFunctionBody(source: string, marker: string) {
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)

  const arrowStart = source.indexOf('=> {', start)
  expect(arrowStart).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = source.indexOf('{', arrowStart); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new Error(`Could not extract function body for ${marker}`)
}

function withPathname(pathname: string, callback: () => void) {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { pathname },
    },
  })

  try {
    callback()
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
}
