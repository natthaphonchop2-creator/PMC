import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageAutomationMiddleware } from '../../server/pageAutomationPlugin'
import type { ManagedPageRecord, SharedAdsInsightForPageRecord } from '../../server/pageAutomationTypes'

const FIXED_NOW = '2026-05-21T04:00:00.000Z'

describe('pageAutomationPlugin middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through non Page Automation API requests without writing a response', async () => {
    const next = vi.fn()
    const res = mockResponse()
    const ensureStore = vi.fn()
    const middleware = createPageAutomationMiddleware({}, { ensureStore })

    await middleware(mockRequest('GET', '/api/meta/status'), res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(ensureStore).not.toHaveBeenCalled()
    expect(res.ended).toBe(false)
    expect(res.body).toBe('')
    expect(res.headers).toEqual({})
  })

  it('returns ready status with Auto mode off when the store is available', async () => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/status'), res)

    expect(deps.ensureStore).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      autoMode: 'off',
      storage: 'ready',
      checkedAt: FIXED_NOW,
    })
  })

  it('returns cached pages when Meta fetch fails', async () => {
    const cachedPages = [managedPage({ id: 'cached-page', name: 'Cached Clinic' })]
    const deps = baseDeps({
      fetchPages: vi.fn(async () => {
        throw new Error('Meta unavailable')
      }),
      readJsonSnapshot: vi.fn(async () => cachedPages),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/pages'), res)

    expect(deps.readJsonSnapshot).toHaveBeenCalledWith('/tmp/page-automation/pages.json', [])
    expect(deps.writeJsonSnapshot).not.toHaveBeenCalled()
    expect(JSON.parse(res.body)).toEqual({
      pages: cachedPages,
      source: 'cache',
    })
  })

  it('returns unavailable pages when Meta fetch and cache read both fail', async () => {
    const deps = baseDeps({
      fetchPages: vi.fn(async () => {
        throw new Error('Meta unavailable with meta-token')
      }),
      readJsonSnapshot: vi.fn(async () => {
        throw new Error('Cache unreadable')
      }),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/pages'), res)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      pages: [],
      source: 'unavailable',
    })
  })

  it('writes live Meta pages to cache when fetch succeeds', async () => {
    const livePages = [managedPage({ id: 'live-page', name: 'Live Clinic' })]
    const deps = baseDeps({
      fetchPages: vi.fn(async () => livePages),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/pages'), res)

    expect(deps.readJsonSnapshot).not.toHaveBeenCalled()
    expect(deps.writeJsonSnapshot).toHaveBeenCalledWith('/tmp/page-automation/pages.json', livePages)
    expect(JSON.parse(res.body)).toEqual({
      pages: livePages,
      source: 'meta',
    })
  })

  it('returns live Meta pages when cache write fails', async () => {
    const livePages = [managedPage({ id: 'live-page', name: 'Live Clinic' })]
    const deps = baseDeps({
      fetchPages: vi.fn(async () => livePages),
      writeJsonSnapshot: vi.fn(async () => {
        throw new Error('Cache write failed')
      }),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/pages'), res)

    expect(deps.writeJsonSnapshot).toHaveBeenCalledWith('/tmp/page-automation/pages.json', livePages)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      pages: livePages,
      source: 'meta',
    })
  })

  it('rejects post drafts without JSON content type and does not append', async () => {
    const deps = baseDeps()
    const middleware = createPageAutomationMiddleware({}, deps)

    for (const contentType of [null, 'text/plain']) {
      const res = mockResponse()

      await middleware(
        mockRequest(
          'POST',
          '/api/page-automation/post-drafts',
          {
            id: 'draft-1',
            pageId: 'page-1',
            caption: 'New service reminder',
          },
          { contentType },
        ),
        res,
      )

      expect(res.statusCode).toBe(415)
      expect(JSON.parse(res.body)).toEqual({ error: 'POST /post-drafts requires application/json' })
    }

    expect(deps.appendJsonlRecord).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON post draft bodies and does not append', async () => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', '{"id":', { contentType: 'application/json', rawBody: true }),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'Request body must be valid JSON' })
    expect(deps.appendJsonlRecord).not.toHaveBeenCalled()
  })

  it('rejects post drafts with missing required fields and does not append', async () => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', {
        id: 'draft-1',
        caption: 'New service reminder',
      }),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'Post draft requires id, pageId, and content' })
    expect(deps.appendJsonlRecord).not.toHaveBeenCalled()
  })

  it.each(['posted', 'scheduled'])('rejects post drafts with %s status and does not append', async (status) => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', {
        id: 'draft-1',
        pageId: 'page-1',
        caption: 'New service reminder',
        status,
      }),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'Post draft status must be draft, needs_review, or ready' })
    expect(deps.appendJsonlRecord).not.toHaveBeenCalled()
  })

  it('appends a post draft and audit event', async () => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', {
        id: 'draft-1',
        pageId: 'page-1',
        caption: 'New service reminder',
        status: 'ready',
      }),
      res,
    )

    expect(deps.appendJsonlRecord).toHaveBeenCalledTimes(2)
    expect(deps.appendJsonlRecord).toHaveBeenNthCalledWith(
      1,
      '/tmp/page-automation/audit-log.jsonl',
      expect.objectContaining({
        actor: 'user',
        action: 'intent_create_post_draft',
        target: 'draft-1',
        reason: 'intent to create post draft from Page Automation UI',
        createdAt: FIXED_NOW,
      }),
    )
    expect(deps.appendJsonlRecord).toHaveBeenNthCalledWith(
      2,
      '/tmp/page-automation/post-drafts.jsonl',
      expect.objectContaining({
        id: 'draft-1',
        pageId: 'page-1',
        caption: 'New service reminder',
        status: 'draft',
        createdAt: FIXED_NOW,
      }),
    )
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('does not append a post draft when audit intent append fails', async () => {
    const deps = baseDeps({
      appendJsonlRecord: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('/audit-log.jsonl')) throw new Error('Audit log unavailable')
      }),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', {
        id: 'draft-1',
        pageId: 'page-1',
        caption: 'New service reminder',
      }),
      res,
    )

    expect(res.statusCode).toBe(500)
    expect(deps.appendJsonlRecord).toHaveBeenCalledTimes(1)
    expect(deps.appendJsonlRecord).toHaveBeenCalledWith(
      '/tmp/page-automation/audit-log.jsonl',
      expect.objectContaining({
        action: 'intent_create_post_draft',
        target: 'draft-1',
      }),
    )
  })

  it('returns a normalized read-only Ads insight with a null workspace by default', async () => {
    const insight = adsInsight()
    const deps = baseDeps({
      normalizeAdsInsightForPage: vi.fn(() => insight),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/ads-insights?pageId=page-1&pageName=Fifth%20Clinic'), res)

    expect(deps.normalizeAdsInsightForPage).toHaveBeenCalledWith({
      datePreset: 'last_7d',
      pageId: 'page-1',
      pageName: 'Fifth Clinic',
      workspace: null,
    })
    expect(JSON.parse(res.body)).toEqual({ insight })
  })

  it('returns 404 JSON for unknown Page Automation endpoints', async () => {
    const deps = baseDeps()
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({}, deps)

    await middleware(mockRequest('GET', '/api/page-automation/unknown'), res)

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(res.body)).toEqual({ error: 'Page Automation endpoint not found' })
  })

  it('returns 500 JSON without leaking configured tokens on internal failure', async () => {
    const deps = baseDeps({
      appendJsonlRecord: vi.fn(async () => {
        throw new Error('failed with secret-token')
      }),
    })
    const res = mockResponse()
    const middleware = createPageAutomationMiddleware({ PAGE_AUTOMATION_META_ACCESS_TOKEN: 'secret-token' }, deps)

    await middleware(
      mockRequest('POST', '/api/page-automation/post-drafts', {
        id: 'draft-1',
        pageId: 'page-1',
        caption: 'New service reminder',
      }),
      res,
    )

    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(res.body).error).toBe('failed with [redacted]')
  })
})

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    store: {
      root: '/tmp/page-automation',
      files: {
        pages: '/tmp/page-automation/pages.json',
        postDrafts: '/tmp/page-automation/post-drafts.jsonl',
        schedules: '/tmp/page-automation/schedules.jsonl',
        publishEvents: '/tmp/page-automation/publish-events.jsonl',
        messageCache: '/tmp/page-automation/message-cache.jsonl',
        auditLog: '/tmp/page-automation/audit-log.jsonl',
        pageAdsMapping: '/tmp/page-automation/page-ads-mapping.json',
      },
    },
    now: () => FIXED_NOW,
    ensureStore: vi.fn(async () => undefined),
    readMetaConfig: vi.fn(async () => ({ accessToken: 'meta-token', graphVersion: 'v88.0' })),
    fetchPages: vi.fn(async () => []),
    fetchPageInsights: vi.fn(async () => ({ reach: 0, engagementRate: 0 })),
    readJsonSnapshot: vi.fn(async (_filePath: string, fallback: unknown) => fallback),
    writeJsonSnapshot: vi.fn(async () => undefined),
    appendJsonlRecord: vi.fn(async () => undefined),
    normalizeAdsInsightForPage: vi.fn(() => adsInsight()),
    ...overrides,
  }
}

function mockRequest(
  method: string,
  url: string,
  body?: unknown,
  options: {
    contentType?: string | null
    rawBody?: boolean
  } = {},
) {
  const chunks = body === undefined ? [] : [options.rawBody ? String(body) : JSON.stringify(body)]
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType
  return Object.assign(Readable.from(chunks), {
    method,
    url,
    headers: {
      host: 'localhost',
      ...(body === undefined || contentType === null ? {} : { 'content-type': contentType }),
    },
  })
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value
    },
    end(body = '') {
      this.body += body
      this.ended = true
    },
  }
}

function managedPage(overrides: Partial<ManagedPageRecord> = {}): ManagedPageRecord {
  return {
    id: 'page-1',
    name: 'Fifth Clinic',
    handle: '@fifthclinic',
    platform: 'facebook',
    followers: 1000,
    followerDelta: 0,
    reach: 500,
    engagementRate: 4,
    unreadCount: 2,
    responseRate: 95,
    avgFirstResponseMins: 10,
    healthScore: 88,
    permissions: [],
    lastSyncedAt: FIXED_NOW,
    ...overrides,
  }
}

function adsInsight(): SharedAdsInsightForPageRecord {
  return {
    source: {
      datePreset: 'last_7d',
      checkedAt: FIXED_NOW,
      taskId: 'page-automation-test',
    },
    scope: {
      pageId: 'page-1',
      pageName: 'Fifth Clinic',
      campaignIds: [],
      adSetIds: [],
      adIds: [],
    },
    metrics: {
      spend: 0,
      revenue: 0,
      roas: 0,
      cpa: 0,
      ctr: 0,
      leads: 0,
      bookings: 0,
    },
    findings: [],
    recommendations: [],
    creativeSignals: [],
    outcomeSignals: {
      alerts: [],
      learnings: [],
      nextActions: [],
    },
    policy: {
      readOnly: true,
      noMetaWrites: true,
      noInventedMetrics: true,
      approvalRequired: true,
    },
  }
}
