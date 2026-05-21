import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHomeSettings, saveHomeAiSettings, saveHomeMetaSettings } from '../src/apps/home/settingsApi'

describe('Home shared API settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads Meta and AI settings from the shared configuration endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/meta/config') {
        return json({ configured: true, connected: true, workspaceLabel: 'PMC', hasSavedToken: true })
      }
      if (url === '/api/ai/config') {
        return json({ configured: true, connected: true, model: 'gpt-5.5', hasSavedApiKey: true })
      }
      return json({ error: 'not found' }, 404)
    }))

    const settings = await fetchHomeSettings()

    expect(settings.meta).toEqual(expect.objectContaining({ connected: true, hasSavedToken: true, workspaceLabel: 'PMC' }))
    expect(settings.ai).toEqual(expect.objectContaining({ connected: true, hasSavedApiKey: true, model: 'gpt-5.5' }))
  })

  it('saves Meta API credentials to the global Meta config endpoint', async () => {
    const fetchMock = vi.fn(async () => json({ configured: true, connected: true }))
    vi.stubGlobal('fetch', fetchMock)

    await saveHomeMetaSettings({
      accessToken: 'meta-token',
      adAccountId: 'act_123',
      workspaceLabel: 'PMC Main',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/meta/config', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      accessToken: 'meta-token',
      adAccountId: 'act_123',
      workspaceLabel: 'PMC Main',
    }))
  })

  it('saves AI API credentials to the global AI config endpoint', async () => {
    const fetchMock = vi.fn(async () => json({ configured: true, connected: true, model: 'gpt-5.5' }))
    vi.stubGlobal('fetch', fetchMock)

    await saveHomeAiSettings({
      apiKey: 'sk-proj-test',
      maxOutputTokens: 3200,
      model: 'gpt-5.5',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/config', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      apiKey: 'sk-proj-test',
      maxOutputTokens: 3200,
      model: 'gpt-5.5',
    })
  })
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}
