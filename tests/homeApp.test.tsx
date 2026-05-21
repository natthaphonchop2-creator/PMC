import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from '../src/App'
import { HomeApp } from '../src/apps/home/HomeApp'

describe('Home app shell', () => {
  it('renders the reference Home command center with core tools and conservative statuses', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('Home')
    expect(html).toContain('COMMAND CENTER')
    expect(html).toContain('AI Priorities')
    expect(html).toContain('Tools')
    expect(html).toContain('System Status')
    expect(html).toContain('Ads Agent')
    expect(html).toContain('Page Automation')
    expect(html).toContain('ERP')
    expect(html).toContain('CRM')
    expect(html).toContain('Website Insight')
    expect(html).toContain('Knowledge')
    expect(html).toContain('รอตรวจสถานะ')
    expect(html).not.toContain('ROAS')
  })

  it('routes / to Home and /ads-agent to the existing PMC Ads Agent shell', () => {
    withPathname('/', () => {
      const html = renderToStaticMarkup(<App />)
      expect(html).toContain('Home')
      expect(html).toContain('COMMAND CENTER')
      expect(html).not.toContain('PMC Ads Agent</strong>')
    })

    withPathname('/ads-agent', () => {
      const html = renderToStaticMarkup(<App />)
      expect(html).toContain('PMC Ads Agent')
      expect(html).not.toContain('COMMAND CENTER')
    })
  })

  it('marks future modules as setup launchers instead of pretending they are live routes', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).toContain('ยังไม่มี ERP connector')
    expect(html).toContain('ยังไม่มี CRM connector')
    expect(html).toContain('ยังไม่มี Website Insight connector')
    expect(html).toContain('รอออกแบบ RAG workflow')
    expect(html).not.toContain('<a class="home-tool-tile" href="#erp"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#crm"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#website-insight"')
    expect(html).not.toContain('<a class="home-tool-tile" href="#knowledge"')
  })

  it('does not use the PMC logo image as repeated decoration on Home', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).not.toContain('/promedclinicpmc-logo.png')
    expect(html).not.toContain('home-tool-watermark')
    expect(html).not.toContain('home-chip-mark')
    expect(html).not.toContain('home-action-mark')
  })

  it('does not show hardcoded sidebar alert or task counts as if they were live data', () => {
    const html = renderToStaticMarkup(<HomeApp />)

    expect(html).not.toContain('home-count')
  })
})

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
