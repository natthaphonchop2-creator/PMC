import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    throw new Error('No local Meta config in tests')
  }),
}))

import {
  buildPermissionReport,
  fetchPageAutomationPages,
  fetchPageInsights,
  readPageAutomationMetaConfig,
  type PageAutomationMetaConfig,
} from '../../server/pageAutomationMetaApi'
import type { ManagedPageRecord } from '../../server/pageAutomationTypes'

function graphResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  })
}

function graphTextResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    headers: { 'content-type': 'text/plain' },
    status: 500,
    ...init,
  })
}

describe('pageAutomationMetaApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no pages when no access token is configured', async () => {
    const fetchImpl = vi.fn()

    await expect(fetchPageAutomationPages({}, fetchImpl)).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats Graph pages without permission data as missing required Facebook permissions', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v88.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse({
        data: [
          {
            id: 'page-1',
            name: 'Fifth Clinic',
            username: 'fifthclinic',
            followers_count: 4242,
          },
        ],
      }),
    )

    const pages = await fetchPageAutomationPages(config, fetchImpl)
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))

    expect(requestedUrl.origin).toBe('https://graph.facebook.com')
    expect(requestedUrl.pathname).toBe('/v88.0/me/accounts')
    expect(requestedUrl.searchParams.get('fields')).toBe('id,name,username,followers_count,tasks')
    expect(requestedUrl.searchParams.get('access_token')).toBe('secret-token')
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject<Partial<ManagedPageRecord>>({
      id: 'page-1',
      name: 'Fifth Clinic',
      handle: '@fifthclinic',
      platform: 'facebook',
      followers: 4242,
      followerDelta: 0,
      reach: 0,
      engagementRate: 0,
      unreadCount: 0,
      responseRate: 0,
      avgFirstResponseMins: 0,
      healthScore: 50,
    })
    expect(pages[0]?.permissions).toHaveLength(1)
    expect(pages[0]?.permissions[0]).toMatchObject({
      pageId: 'page-1',
      platform: 'facebook',
      granted: [],
      missing: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        'pages_manage_posts',
        'pages_messaging',
      ],
    })
    expect(new Date(pages[0]?.lastSyncedAt ?? '').toString()).not.toBe('Invalid Date')
    expect(new Date(pages[0]?.permissions[0]?.checkedAt ?? '').toString()).not.toBe('Invalid Date')
  })

  it('maps only exact Graph permission strings and does not infer permissions from task names', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v88.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse({
        data: [
          {
            id: 'page-1',
            name: 'Fifth Clinic',
            perms: ['pages_show_list', 'pages_manage_posts', 'unknown_permission'],
            tasks: ['CREATE_CONTENT', 'MESSAGING'],
          },
        ],
      }),
    )

    const pages = await fetchPageAutomationPages(config, fetchImpl)

    expect(pages[0]?.permissions[0]).toMatchObject({
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list', 'pages_manage_posts'],
      missing: ['pages_read_engagement', 'pages_read_user_content', 'pages_messaging'],
    })
  })

  it('marks required Facebook permissions missing when absent', () => {
    expect(buildPermissionReport('page-1', 'facebook', ['pages_show_list'], '2026-05-21T04:00:00.000Z')).toEqual({
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list'],
      missing: ['pages_read_engagement', 'pages_read_user_content', 'pages_manage_posts', 'pages_messaging'],
      checkedAt: '2026-05-21T04:00:00.000Z',
    })
  })

  it('reads Meta config from the active env workspace and lets PAGE_AUTOMATION token override workspace token', async () => {
    await expect(
      readPageAutomationMetaConfig({
        META_ACTIVE_WORKSPACE_ID: 'workspace-b',
        META_WORKSPACES_JSON: JSON.stringify({
          activeWorkspaceId: 'workspace-a',
          workspaces: [
            {
              id: 'workspace-a',
              accessToken: 'workspace-token-a',
              graphVersion: 'v31.0',
              graphHost: 'https://graph.workspace-a.test',
            },
            {
              id: 'workspace-b',
              accessToken: 'workspace-token-b',
              graphVersion: 'v32.0',
              graphHost: 'https://graph.workspace-b.test/',
            },
          ],
        }),
        PAGE_AUTOMATION_META_ACCESS_TOKEN: 'page-automation-token',
      }),
    ).resolves.toEqual({
      accessToken: 'page-automation-token',
      graphVersion: 'v32.0',
      graphHost: 'https://graph.workspace-b.test/',
    })
  })

  it('uses latest page impressions as reach when no reach metric is returned', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v77.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse({
        data: [
          { name: 'page_impressions', values: [{ value: 1000 }, { value: 1200 }] },
          { name: 'page_post_engagements', values: [{ value: 85 }, { value: 96 }] },
        ],
      }),
    )

    await expect(fetchPageInsights(config, 'page-1', fetchImpl)).resolves.toEqual({
      reach: 1200,
      engagementRate: 8,
    })

    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(requestedUrl.pathname).toBe('/v77.0/page-1/insights')
    expect(requestedUrl.searchParams.get('metric')).toBe('page_impressions_unique,page_impressions,page_post_engagements')
    expect(requestedUrl.searchParams.get('period')).toBe('day')
  })

  it('prefers latest page reach metric for reach and engagement rate when available', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v77.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse({
        data: [
          { name: 'page_impressions', values: [{ value: 1000 }, { value: 2000 }] },
          { name: 'page_impressions_unique', values: [{ value: 200 }, { value: 250 }] },
          { name: 'page_post_engagements', values: [{ value: 30 }, { value: 50 }] },
        ],
      }),
    )

    await expect(fetchPageInsights(config, 'page-1', fetchImpl)).resolves.toEqual({
      reach: 250,
      engagementRate: 20,
    })
  })

  it('throws Graph errors without leaking the access token', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v77.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse(
        {
          error: {
            message: 'OAuth failed for secret-token',
          },
        },
        { status: 400 },
      ),
    )

    let caught: Error | null = null
    try {
      await fetchPageInsights(config, 'page-1', fetchImpl)
    } catch (error) {
      caught = error as Error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught?.message).toContain('OAuth failed')
    expect(caught?.message).not.toContain('secret-token')
  })

  it('uses custom graphHost and redacts tokens from fetch rejection errors', async () => {
    const token = 'secret token/with+chars'
    const config: PageAutomationMetaConfig = {
      accessToken: token,
      graphVersion: 'v77.0',
      graphHost: 'https://graph.custom.test/root/',
    }
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network failed for ${token} and ${encodeURIComponent(token)}`)
    })

    let caught: Error | null = null
    try {
      await fetchPageInsights(config, 'page-1', fetchImpl)
    } catch (error) {
      caught = error as Error
    }

    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(requestedUrl.origin).toBe('https://graph.custom.test')
    expect(requestedUrl.pathname).toBe('/root/v77.0/page-1/insights')
    expect(caught).toBeInstanceOf(Error)
    expect(caught?.message).toContain('network failed')
    expect(caught?.message).not.toContain(token)
    expect(caught?.message).not.toContain(encodeURIComponent(token))
  })

  it('redacts tokens from non-JSON Graph error bodies', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v77.0',
    }
    const fetchImpl = vi.fn(async () => graphTextResponse('upstream failed for secret-token', { status: 502 }))

    let caught: Error | null = null
    try {
      await fetchPageInsights(config, 'page-1', fetchImpl)
    } catch (error) {
      caught = error as Error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught?.message).toContain('upstream failed')
    expect(caught?.message).toContain('[redacted]')
    expect(caught?.message).not.toContain('secret-token')
  })
})
