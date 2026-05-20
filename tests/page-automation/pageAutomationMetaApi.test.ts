import { describe, expect, it, vi } from 'vitest'
import {
  buildPermissionReport,
  fetchPageAutomationPages,
  fetchPageInsights,
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

describe('pageAutomationMetaApi', () => {
  it('returns no pages when no access token is configured', async () => {
    const fetchImpl = vi.fn()

    await expect(fetchPageAutomationPages({}, fetchImpl)).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches managed pages from Graph me/accounts and includes a Facebook permission report', async () => {
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
    expect(requestedUrl.searchParams.get('fields')).toBe('id,name,username,followers_count')
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
      granted: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        'pages_manage_posts',
        'pages_messaging',
      ],
      missing: [],
    })
    expect(new Date(pages[0]?.lastSyncedAt ?? '').toString()).not.toBe('Invalid Date')
    expect(new Date(pages[0]?.permissions[0]?.checkedAt ?? '').toString()).not.toBe('Invalid Date')
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

  it('maps page impressions and post engagements to reach and engagement rate', async () => {
    const config: PageAutomationMetaConfig = {
      accessToken: 'secret-token',
      graphVersion: 'v77.0',
    }
    const fetchImpl = vi.fn(async () =>
      graphResponse({
        data: [
          { name: 'page_impressions', values: [{ value: 1000 }] },
          { name: 'page_post_engagements', values: [{ value: 85 }] },
        ],
      }),
    )

    await expect(fetchPageInsights(config, 'page-1', fetchImpl)).resolves.toEqual({
      reach: 1000,
      engagementRate: 8.5,
    })

    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(requestedUrl.pathname).toBe('/v77.0/page-1/insights')
    expect(requestedUrl.searchParams.get('metric')).toBe('page_impressions,page_post_engagements')
    expect(requestedUrl.searchParams.get('period')).toBe('day')
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
})
