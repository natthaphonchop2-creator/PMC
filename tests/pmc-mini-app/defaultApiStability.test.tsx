// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp } from '../../src/apps/pmc-mini-app/PmcMiniApp'

const liff = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  isLoggedIn: vi.fn(() => true),
  login: vi.fn(),
  getIDToken: vi.fn(() => 'raw-id-token'),
}))

vi.mock('@line/liff', () => ({ default: liff }))

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  vi.clearAllMocks()
})

describe('PMC Mini App default browser API stability', () => {
  it('loads only startup APIs once even when finance navigation is enabled', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/client-config')) return json(200, { miniAppId: 'mini-id' })
      if (url.endsWith('/session')) return json(200, { staffId: 'staff-1', displayName: 'มัส', active: true })
      if (url.endsWith('/config')) return json(200, {
        fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', reportingEnabled: false,
        financeReportsEnabled: true, financeUiPreviewEnabled: false, canViewFinance: true,
        doctors: [{ id: 'หมอ Benz', name: 'หมอ Benz' }],
        services: [{ id: 'เติมไขมัน', name: 'เติมไขมัน', durationMinutes: 60 }],
        channels: [{ id: 'เพจหลัก', name: 'เพจหลัก' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }],
      })
      return json(404, { error: 'NOT_FOUND' })
    })
    globalThis.fetch = request as typeof globalThis.fetch

    render(<PmcMiniApp />)

    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/mini-app/client-config',
      '/api/mini-app/session',
      '/api/mini-app/config',
    ])
  })
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
