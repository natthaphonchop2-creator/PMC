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
      expect(html).toContain('PMC Ads Agent')
      expect(html).toContain('href="/"')
      expect(html).toContain('กลับ Home')
      expect(html).toContain('aria-label="กลับหน้า Home"')
      expect(countOccurrences(html, 'src="/pmc-ads-logo.png?v=transparent"')).toBe(1)
      expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
      expect(html).not.toContain('ศูนย์รวม App')
    })
  })

  it('shows campaign data as a chart on Ads analytics instead of the campaign performance list', () => {
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
        onApprove={() => undefined}
        onReject={() => undefined}
        recommendations={[]}
        recommendationStates={{}}
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

    expect(text).toContain('กราฟข้อมูลแคมเปญ')
    expect(text).toContain('ค่าใช้จ่าย รายได้ CPA ROAS และความถี่ของแคมเปญ')
    expect(html).toContain('aria-label="กราฟข้อมูลแคมเปญ"')
    expect(text).not.toContain('ผลงานแคมเปญ')
    expect(html).not.toContain('role="table" aria-label="ผลงานแคมเปญ"')
  })

  it('shows a Revenue Overview from real analytics data instead of reference placeholders', () => {
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
        onApprove={() => undefined}
        onReject={() => undefined}
        recommendations={[]}
        recommendationStates={{}}
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

    expect(text).toContain('Revenue Overview')
    expect(text).toContain('Total Revenue')
    expect(text).toContain('Bookings')
    expect(text).toContain('Paid Cases')
    expect(text).toContain('Conversion Rate')
    expect(text).toContain('Revenue by Campaign')
    expect(text).toContain('ตัวรี MSG เติมไขมัน 9900')
    expect(text).toContain('฿180k')
    expect(html).not.toContain('revenue-sparkline')
    expect(html).not.toContain('แนวโน้มย่อ')
    expect(text).not.toContain('Welcome back, James')
    expect(text).not.toContain('$24,560')
    expect(text).not.toContain('Website')
    expect(text).not.toContain('Mobile App')
  })

  it('uses the selected ECharts engine for Ads analytics charts without placeholder data', () => {
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
        onApprove={() => undefined}
        onReject={() => undefined}
        recommendations={[]}
        recommendationStates={{}}
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

    expect(countOccurrences(html, 'data-chart-engine="echarts"')).toBe(4)
    expect(countOccurrences(html, 'data-chart-source="real"')).toBe(4)
    expect(html).toContain('data-chart-style="sharp-lines"')
    expect(html).toContain('aria-label="Revenue Overview chart"')
    expect(html).toContain('aria-label="Revenue by Campaign chart"')
    expect(html).toContain('aria-label="Funnel คลินิก chart"')
    expect(html).toContain('aria-label="กราฟข้อมูลแคมเปญ"')
    expect(html).not.toContain('$24,560')
    expect(html).not.toContain('Website')
    expect(html).not.toContain('Mobile App')
  })

  it('shows period changes from each metric own real trend instead of reusing booking trend', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        onApprove={() => undefined}
        onReject={() => undefined}
        recommendations={[]}
        recommendationStates={{}}
        summary={{
          bookings: 600,
          cac: 0,
          cpa: 0,
          leads: 0,
          paidTreatments: 200,
          revenue: 600,
          roas: 0,
          spend: 0,
        }}
        trendData={[
          { bookings: 100, date: '2026-05-16', day: 'May 16', revenue: 100, spend: 0, treatments: 20 },
          { bookings: 100, date: '2026-05-17', day: 'May 17', revenue: 100, spend: 0, treatments: 20 },
          { bookings: 200, date: '2026-05-18', day: 'May 18', revenue: 200, spend: 0, treatments: 80 },
          { bookings: 200, date: '2026-05-19', day: 'May 19', revenue: 200, spend: 0, treatments: 80 },
        ]}
      />,
    )
    const text = visibleText(html)

    expect(text).toContain('Paid Cases')
    expect(text).toContain('↑ 300.0%')
    expect(text).toContain('จาก paid cases รายวัน')
    expect(text).toContain('Conversion Rate')
    expect(text).toContain('33.3%')
    expect(text).toContain('↑ 100.0%')
    expect(text).toContain('จาก paid / booking รายวัน')
    expect(countOccurrences(text, '↑ 100.0%')).toBe(3)
    expect(text).not.toContain('จริง')
  })

  it('does not show the audit trail panel on Ads analytics', () => {
    const html = renderToStaticMarkup(
      <AnalyticsPage
        campaigns={[]}
        funnelMetrics={[]}
        onApprove={() => undefined}
        onReject={() => undefined}
        recommendations={[]}
        recommendationStates={{}}
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
        onApprove={() => undefined}
        onReject={() => undefined}
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
        recommendationStates={{}}
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

    expect(text).toContain('คำแนะนำที่รออนุมัติ')
    expect(text).toContain('รายการที่ AI คัดมาให้คุณตรวจ')
    expect(text).toContain('ยังไม่มีรายการที่ต้องอนุมัติ')
    expect(text).toContain('เมื่อคุณให้ AI วิเคราะห์ข้อมูลล่าสุด')
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
    expect(html).not.toContain('<a class="home-tool-tile" href="#erp"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#crm"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#website-insight"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#knowledge"')
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
