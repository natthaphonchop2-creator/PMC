import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHomeSnapshot, fetchHomeStatusSnapshot } from '../src/apps/home/api'

describe('Home API snapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows connected states only when the status APIs explicitly return connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/meta/status') return json({ configured: true, connected: true })
      if (url === '/api/ai/status') return json({ configured: true, connected: true, model: 'gpt-5.5' })
      if (url === '/api/page-automation/status') return json({ ok: true, storage: 'ready', autoMode: 'off' })
      if (url === '/api/page-automation/messages') return json({ messages: [] })
      if (url === '/api/page-automation/post-drafts') return json({ drafts: [] })
      return json({ actions: [], auditTrail: [] })
    }))

    const snapshot = await fetchHomeStatusSnapshot()

    expect(snapshot.headerStatuses).toEqual([
      expect.objectContaining({ id: 'meta', state: 'connected', value: 'เชื่อมต่อ' }),
      expect.objectContaining({ id: 'ai', state: 'connected', value: 'เชื่อมต่อ' }),
      expect.objectContaining({ id: 'knowledge', state: 'ready', value: 'พร้อมใช้งาน' }),
    ])
    expect(snapshot.tools.find((tool) => tool.id === 'page')).toEqual(expect.objectContaining({ status: 'ready', statusText: 'พร้อมใช้งาน' }))
  })

  it('does not invent connected states when endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    const snapshot = await fetchHomeSnapshot()

    expect(snapshot.headerStatuses).toEqual([
      expect.objectContaining({ id: 'meta', state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }),
      expect.objectContaining({ id: 'ai', state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }),
      expect.objectContaining({ id: 'knowledge', state: 'setup', value: 'รอตั้งค่า' }),
    ])
    expect(snapshot.systemStatuses.find((status) => status.id === 'erp')).toEqual(expect.objectContaining({ state: 'setup', value: 'รอตั้งค่า' }))
    expect(snapshot.systemStatuses.find((status) => status.id === 'crm')).toEqual(expect.objectContaining({ state: 'setup', value: 'รอตั้งค่า' }))
  })

  it('keeps exactly three priorities without fake unread or draft counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/meta/status') return json({ configured: true, connected: true })
      if (url === '/api/ai/status') return json({ configured: true, connected: true })
      if (url === '/api/page-automation/status') return json({ ok: true, storage: 'ready' })
      if (url === '/api/page-automation/messages') return json({ messages: [] })
      if (url === '/api/page-automation/post-drafts') return json({ drafts: [] })
      return json({ actions: [], auditTrail: [] })
    }))

    const snapshot = await fetchHomeSnapshot()

    expect(snapshot.priorities).toHaveLength(3)
    expect(snapshot.priorities.map((priority) => priority.title).join(' ')).not.toMatch(/12|3 รายการ/)
    expect(snapshot.priorities.map((priority) => priority.source)).toEqual(['Ads Agent', 'Page Automation', 'Page Automation'])
  })
})

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
