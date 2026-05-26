import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App, { AnalyticsPage, CreativeStudioPage, ReportsPage } from '../src/App'
import { HomeApp } from '../src/apps/home/HomeApp'
import { PageAutomationApp } from '../src/apps/page-automation/PageAutomationApp'

describe('Home app shell', () => {
  it('renders Home as a soft clinic app launcher with honest readiness states', () => {
    const html = renderToStaticMarkup(<HomeApp />)
    const text = visibleText(html)

    expect(html).toContain('class="home-clinic-media"')
    expect(html).toContain('src="/pmc-clinic-reception.png"')
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
      expect(text).toContain('Creatives')
      expect(text).toContain('Audience')
      expect(text).toContain('Reports')
      expect(text).toContain('Insights')
      expect(text).toContain('Settings')
      expect(countOccurrences(html, 'class="ads-toolbar-item')).toBe(8)
      expect(html).toMatch(
        /<button(?=[^>]*class="ads-toolbar-item active")(?=[^>]*aria-current="page")(?=[^>]*aria-label="Ads Dashboard")[^>]*>/,
      )
      expect(html).toMatch(/<div class="topbar-actions"><button[^>]*aria-label="เช็ค API"[^>]*>[\s\S]*เช็ค API[\s\S]*<\/button><\/div>/)
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

  it('renders the approved Ads Dashboard sections from existing Ads Agent data', () => {
    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      const text = visibleText(html)

      expect(text).toContain('Ads Dashboard')
      expect(text).toContain('Customize Dashboard')
      expect(html).toMatch(
        /<button(?=[^>]*class="clinic-secondary-button")(?=[^>]*disabled)(?=[^>]*aria-label="Customize Dashboard ยังไม่พร้อมใช้งาน")[^>]*>Customize Dashboard<\/button>/,
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
      expect(text).toContain('Conversions by Region')
      expect(text).toContain('Cost per Result')
      expect(text).toContain('CTR')
      expect(text).toContain('ROAS')
      expect(text).toContain('PMC Insights')
      expect(text).not.toContain('Revenue Overview')
      expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
    })
  })

  it('shows top campaign rankings on Ads Dashboard instead of the campaign performance list', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[
          {
            aiTag: 'จับตา',
            budget: 99000,
            conversions: 96,
            cpa: 758,
            ctr: 5.9,
            deliveryStatus: 'active',
            frequency: 4.1,
            id: 'campaign-1',
            name: 'ตัวรี MSG เติมไขมัน 9900',
            revenue: 138324,
            roas: 1.9,
            spend: 72807,
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
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900')
    expect(text).toContain('96 conversions · ROAS 1.90x')
    expect(html).toContain('ads-top-campaign-list')
    expect(html).toContain('ads-top-campaign-row')
    expect(text).not.toContain('กราฟข้อมูลแคมเปญ')
    expect(text).not.toContain('ผลงานแคมเปญ')
    expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
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
    expect(text).toContain('Conversions by Region')
    expect(text).toContain('PMC Insights')
    expect(text).toContain('Cost per Result')
    expect(text).toContain('CTR')
    expect(text).toContain('ROAS')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900')
    expect(text).toContain('฿108k')
    expect(html).toContain('ads-dashboard-layout')
    expect(countOccurrences(html, 'class="ads-dashboard-metric-card"')).toBe(7)
    expect(html).not.toContain('revenue-sparkline')
    expect(html).not.toContain('แนวโน้มย่อ')
    expect(text).not.toContain('Welcome back, James')
    expect(text).not.toContain('AeuxGlobal')
    expect(text).not.toContain('North America')
    expect(text).not.toContain('32%')
    expect(text).not.toContain('2.45M')
    expect(text).not.toContain('$24,680')
    expect(text).not.toContain('$24,560')
    expect(text).not.toContain('Website')
    expect(text).not.toContain('Mobile App')
  })

  it('arranges the Ads Dashboard report like the reference while keeping regional data honest', () => {
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

    expect(html).toContain('ads-dashboard-layout')
    expect(html).toContain('ads-dashboard-metric-grid')
    expect(html).toContain('ads-dashboard-main-grid')
    expect(html).toContain('ads-dashboard-lower-grid')
    expect(html).toContain('ads-region-panel')
    expect(html).toContain('ads-region-map')
    expect(text).toContain('Performance Overview')
    expect(text).toContain('Top Campaigns')
    expect(text).toContain('Conversions by Region')
    expect(text).toContain('รอข้อมูลภูมิภาคจาก Meta')
    expect(text).toContain('PMC Insights')
    expect(text).toContain('Cost per Result')
    expect(text).toContain('CTR')
    expect(text).toContain('ROAS')
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
    expect(visibleText(impressionsCard)).toContain('รอ Meta ส่ง impressions สำหรับช่วงนี้')
    expect(visibleText(impressionsCard)).not.toContain('220')
    expect(visibleText(impressionsCard)).not.toContain('2 แคมเปญ')

    expect(visibleText(clicksCard)).toContain('รอข้อมูล')
    expect(visibleText(clicksCard)).toContain('รอ Meta ส่ง clicks สำหรับช่วงนี้')
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
    expect(visibleText(impressionsCard)).toContain('จาก Meta funnel ที่ซิงก์')
    expect(visibleText(impressionsCard)).not.toContain('รอ Meta ส่ง impressions สำหรับช่วงนี้')
    expect(visibleText(impressionsCard)).not.toContain('220')

    expect(visibleText(clicksCard)).toContain('1,220')
    expect(visibleText(clicksCard)).toContain('จาก Meta funnel ที่ซิงก์')
    expect(visibleText(clicksCard)).not.toContain('รอ Meta ส่ง clicks สำหรับช่วงนี้')
    expect(visibleText(clicksCard)).not.toContain('170')
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
    expect(visibleText(impressionsCard)).toContain('จาก Meta funnel ที่ซิงก์')
    expect(visibleText(impressionsCard)).not.toContain('รอ Meta ส่ง impressions สำหรับช่วงนี้')

    expect(visibleText(clicksCard)).toContain('Clicks 0')
    expect(visibleText(clicksCard)).toContain('จาก Meta funnel ที่ซิงก์')
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
    expect(html).toContain('data-chart-style="sharp-lines"')
    expect(html).toContain('Performance Overview')
    expect(html).toContain('aria-label="Performance Overview chart"')
    expect(html).not.toContain('Revenue Overview')
    expect(html).not.toContain('aria-label="Revenue by Campaign chart"')
    expect(html).not.toContain('aria-label="Funnel คลินิก chart"')
    expect(html).not.toContain('aria-label="กราฟข้อมูลแคมเปญ"')
    expect(html).not.toContain('$24,560')
    expect(html).not.toContain('Website')
    expect(html).not.toContain('Mobile App')
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
    expect(text).toContain('จาก paid / booking รายวัน')
    expect(text).toContain('Cost')
    expect(text).toContain('จาก spend รายวัน')
    expect(text).toContain('รอข้อมูล')
    expect(text).not.toContain('AI จริง')
    expect(text).not.toContain('$24,680')
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
    expect(text).toContain('รอ insight ใหม่จากข้อมูลจริง')
    expect(text).not.toContain('ป้องกันงบและตรวจ Tracking')
    expect(text).not.toContain('Meta metrics')
    expect(text).not.toContain('PMC Master Agent')
    expect(text).not.toContain('หลังผู้ใช้')
    expect(text).not.toContain('AI เท่านั้น')
    expect(text).not.toContain('AI จริง')
  })

  it('shows Creative Studio as updating while the full workspace is paused', () => {
    const html = renderToStaticMarkup(
      <CreativeStudioPage
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

    expect(text).toContain('สตูดิโอครีเอทีฟกำลังอัพเดท')
    expect(text).toContain('ทีมกำลังปรับหน้า Creative Studio')
    expect(text).toContain('ข้อมูลครีเอทีฟที่ซิงก์ไว้')
    expect(text).toContain('กลับมาทำต่อเร็ว ๆ นี้')
    expect(html).not.toContain('placeholder="ค้นหาครีเอทีฟ"')
    expect(text).not.toContain('บรีฟครีเอทีฟ')
    expect(text).not.toContain('ใช้เป็นต้นแบบ')
  })

  it('uses generated product logos for Ads and Page Auto entries on Home', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('src="/pmc-ads-logo.png?v=transparent"')
    expect(html).toContain('src="/pmc-page-auto-logo.png?v=transparent"')
    expect(html).toContain('alt="PMC Ads"')
    expect(html).toContain('alt="PMC Page Auto"')
  })

  it('uses transparent product logo assets without card-like image shadows', () => {
    const homeCss = readText('../src/apps/home/styles.css')
    const productLogoRule = homeCss.match(/\.home-product-logo\s*\{[^}]+\}/)?.[0] ?? ''

    expect(readPngColorType('../public/pmc-ads-logo.png')).toBe(6)
    expect(readPngColorType('../public/pmc-page-auto-logo.png')).toBe(6)
    expect(productLogoRule).not.toContain('box-shadow')
    expect(productLogoRule).not.toContain('background')
    expect(homeCss).not.toContain('.home-suggestion-icon')
    expect(homeCss).toMatch(/\.home-app-icon\.blue\s*\{\s*background:\s*#e6f0fb;\s*color:\s*#2f86eb;\s*\}/)
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

  it('uses clinic media and product logos without repeated PMC brand decoration', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(countOccurrences(html, 'src="/pmc-clinic-reception.png"')).toBe(1)
    expect(html).toContain('alt="PMC Aesthetic Clinic reception"')
    expect(countOccurrences(html, 'src="/pmc-ads-logo.png?v=transparent"')).toBe(1)
    expect(countOccurrences(html, 'src="/pmc-page-auto-logo.png?v=transparent"')).toBe(1)
    expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
    expect(html).not.toContain('home-tool-watermark')
    expect(html).not.toContain('home-chip-mark')
    expect(html).not.toContain('home-action-mark')
  })

  it('renders the inbox-first Page Automation shell at root and messages routes', () => {
    for (const pathname of ['/page-automation', '/page-automation/messages']) {
      withPathname(pathname, () => {
        const html = renderToStaticMarkup(<PageAutomationApp />)

        expect(countOccurrences(html, 'src="/pmc-page-auto-logo.png?v=transparent"')).toBe(1)
        expect(html).toContain('PMC Page Auto')
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
        expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
        expect(html).not.toContain('<a class="pa-back-link" href="/" title="กลับ PMC Ads Agent">PMC</a>')
      })
    }
  })

  it('keeps Page Automation on the PMC Ads palette and Home on the soft launcher palette', () => {
    const homeCss = readText('../src/apps/home/styles.css')
    const pageCss = readText('../src/apps/page-automation/styles.css')

    expect(homeCss).toContain('#fbfaf8')
    expect(homeCss).toContain('#aa8358')
    expect(homeCss).toContain('#167047')
    expect(pageCss).toContain('#7567d8')
    expect(pageCss).toContain('#2f86eb')
    expect(pageCss).toContain('#30d5a8')
    expect(pageCss).toContain('.pa-inbox-workspace')
    expect(pageCss).toContain('grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.42fr) minmax(250px, 0.8fr)')
    expect(pageCss).toContain('@media (max-width: 760px)')
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
    expect(appCss).toContain('@media (max-width: 980px)')
    expect(appCss).toContain('@media (max-width: 640px)')
    expect(homeCss).not.toContain('ads-workspace-shell')
    expect(pageCss).not.toContain('ads-workspace-shell')
  })

  it('does not animate removed sidebar mascot targets in the Ads Agent shell', () => {
    const appSource = readText('../src/App.tsx')

    expect(appSource).not.toContain("'.sidebar-mascot'")
    expect(appSource).toContain("'.ads-toolbar-brand-mark'")
  })

  it('keeps Insights copy user-facing instead of internal agent labels', () => {
    const appSource = readText('../src/App.tsx')

    expect(appSource).toContain('ผู้ช่วย Insights')
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
})

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1
}

function readText(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function dashboardMetricCardHtml(html: string, label: string) {
  const match = html.match(new RegExp(`<article class="ads-dashboard-metric-card">(?:(?!</article>)[\\s\\S])*<span>${label}</span>(?:(?!</article>)[\\s\\S])*</article>`))
  expect(match?.[0]).toBeTruthy()
  return match?.[0] ?? ''
}

function readPngColorType(relativePath: string) {
  const bytes = readFileSync(new URL(relativePath, import.meta.url))
  const signature = '89504e470d0a1a0a'
  expect(bytes.subarray(0, 8).toString('hex')).toBe(signature)
  return bytes[25]
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
