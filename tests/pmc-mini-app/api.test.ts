import { describe, expect, it, vi } from 'vitest'
import { createMiniAppApi } from '../../src/apps/pmc-mini-app/api'

describe('PMC Mini App browser API', () => {
  it('initializes LIFF from public config and keeps the raw ID token in authorization headers only', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/client-config')) return jsonResponse(200, { miniAppId: 'mini-id' })
      if (url.endsWith('/session')) return jsonResponse(200, { staffId: 'staff-1', displayName: 'มัส', active: true })
      return jsonResponse(404, {})
    })
    const liff = {
      init: vi.fn(async () => undefined), isLoggedIn: vi.fn(() => true), login: vi.fn(), getIDToken: vi.fn(() => 'raw-id-token'),
    }
    const api = createMiniAppApi({ fetch, liff })

    const token = await api.initialize()
    await api.loadSession(token)

    expect(token).toBe('raw-id-token')
    expect(liff.init).toHaveBeenCalledWith({ liffId: 'mini-id' })
    expect(fetch).toHaveBeenLastCalledWith('/api/mini-app/session', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
    expect(fetch.mock.calls.map(([url]) => String(url)).join(' ')).not.toContain('raw-id-token')
  })

  it('uploads every selected file in one multipart request', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 2,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: ['chat-1', 'chat-2'], confirmationStatus: null,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })]

    await api.upload('raw-id-token', 'draft-1', 'CHAT', files)

    const [, init] = fetch.mock.calls[0]!
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer raw-id-token' } })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).getAll('files')).toHaveLength(2)
  })
})

function inertLiff() {
  return { init: vi.fn(async () => undefined), isLoggedIn: () => true, login: vi.fn(), getIDToken: () => 'token' }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
