import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App, { AnalyticsPage, CreativeStudioPage } from '../src/App'
import { HomeApp } from '../src/apps/home/HomeApp'
import { PageAutomationApp } from '../src/apps/page-automation/PageAutomationApp'

describe('Home app shell', () => {
  it('renders Home as an app selection portal instead of a dashboard', () => {
    const html = renderToStaticMarkup(<HomeApp />)
    const text = visibleText(html)

    expect(html).toContain('Home')
    expect(html).toContain('ศูนย์รวม App')
    expect(html).toContain('เลือก App เพื่อเริ่มงาน')
    expect(html).toContain('ตั้งค่า API Key')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('App ทั้งหมด')
    expect(html).toContain('Ads Agent')
    expect(html).toContain('Page Automation')
    expect(html).toContain('ERP')
    expect(html).toContain('CRM')
    expect(html).toContain('Website Insight')
    expect(html).toContain('Knowledge')
    expect(html).toContain('รอตรวจสถานะ')
    expect(html).not.toContain('home-sidebar')
    expect(html).not.toContain('home-nav')
    expect(html).not.toContain('AI Priorities')
    expect(html).not.toContain('System Status')
    expect(html).not.toContain('Recent Activity')
    expect(text).not.toContain('dashboard')
    expect(text).not.toContain('ROAS')
    expect(text).not.toContain('หน้า Home เป็น')
    expect(text).not.toContain('action')
    expect(text).not.toContain('connector')
    expect(text).not.toContain('RAG')
  })

  it('routes / to Home and /ads-agent to the existing PMC Ads Agent shell', () => {
    withPathname('/', () => {
      const html = renderToStaticMarkup(<App />)
      expect(html).toContain('Home')
      expect(html).toContain('ศูนย์รวม App')
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
    expect(homeCss).toMatch(/\.home-suggestion-icon,[\s\S]*?background:\s*transparent;/)
    expect(homeCss).toMatch(/\.home-app-icon\.blue[\s\S]*?color:\s*#1877f2;/)
  })

  it('marks future modules as setup launchers instead of pretending they are live routes', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('ยังไม่ได้เชื่อมต่อระบบ ERP')
    expect(html).toContain('ยังไม่ได้เชื่อมต่อระบบ CRM')
    expect(html).toContain('ยังไม่ได้เชื่อมต่อข้อมูลเว็บไซต์')
    expect(html).toContain('อยู่ระหว่างเตรียมฐานความรู้')
    expect(html).not.toContain('<a class="home-tool-tile" href="#erp"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#crm"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#website-insight"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#knowledge"')
  })

  it('uses the PMC logo only in the Home brand slot, not as repeated decoration', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(countOccurrences(html, 'src="/promedclinicpmc-logo.png"')).toBe(1)
    expect(html).toContain('alt="PMC"')
    expect(html).not.toContain('home-tool-watermark')
    expect(html).not.toContain('home-chip-mark')
    expect(html).not.toContain('home-action-mark')
  })

  it('uses the same PMC logo treatment on Page Automation', () => {
    withPathname('/page-automation/messages', () => {
      const html = renderToStaticMarkup(<PageAutomationApp />)

      expect(countOccurrences(html, 'src="/pmc-page-auto-logo.png?v=transparent"')).toBe(1)
      expect(html).toContain('PMC Page Automation')
      expect(html).toContain('href="/page-automation"')
      expect(html).toContain('href="/"')
      expect(html).toContain('กลับ Home')
      expect(html).toContain('aria-label="กลับหน้า Home"')
      expect(html).not.toContain('src="/promedclinicpmc-logo.png"')
      expect(html).not.toContain('<a class="pa-back-link" href="/" title="กลับ PMC Ads Agent">PMC</a>')
    })
  })

  it('keeps Home and Page Automation on the PMC Ads palette', () => {
    const homeCss = readText('../src/apps/home/styles.css')
    const pageCss = readText('../src/apps/page-automation/styles.css')

    for (const css of [homeCss, pageCss]) {
      expect(css).toContain('#7567d8')
      expect(css).toContain('#2f86eb')
      expect(css).toContain('#30d5a8')
    }
    expect(pageCss).not.toContain('#242424')
    expect(pageCss).not.toContain('#e16447')
  })

  it('does not show hardcoded sidebar alert or task counts as if they were live data', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).not.toContain('home-count')
  })

  it('has dedicated compact Home rules for tablet, phone, and narrow phone widths', () => {
    const homeCss = readText('../src/apps/home/styles.css')

    expect(homeCss).toContain('@media (max-width: 760px)')
    expect(homeCss).toContain('@media (max-width: 480px)')
    expect(homeCss).toContain('@media (max-width: 380px)')
    expect(homeCss).toContain('overflow-wrap: anywhere')
    expect(homeCss).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(homeCss).toContain('.home-app-grid')
    expect(homeCss).toContain('.home-app-card')
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
