import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { normalizeAdsInsightForPage as normalizeAdsInsightForPageDefault } from './pageAutomationAdsBridge.js'
import {
  fetchPageAutomationPages as fetchPageAutomationPagesDefault,
  fetchPageInsights as fetchPageInsightsDefault,
  readPageAutomationMetaConfig as readPageAutomationMetaConfigDefault,
  type PageAutomationMetaConfig,
} from './pageAutomationMetaApi.js'
import {
  appendJsonlRecord as appendJsonlRecordDefault,
  createPageAutomationStore,
  ensureStore as ensureStoreDefault,
  readJsonSnapshot as readJsonSnapshotDefault,
  writeJsonSnapshot as writeJsonSnapshotDefault,
  type PageAutomationStore,
} from './pageAutomationStore.js'
import type { ManagedPageRecord, PageAutomationStatus } from './pageAutomationTypes.js'

const MAX_JSON_BODY_BYTES = 1_000_000

type PageAutomationEnv = Record<string, string | undefined>

type PageAutomationMiddlewareOptions = {
  store?: PageAutomationStore
  now?: () => string
  ensureStore?: typeof ensureStoreDefault
  readMetaConfig?: typeof readPageAutomationMetaConfigDefault
  fetchPages?: typeof fetchPageAutomationPagesDefault
  fetchPageInsights?: typeof fetchPageInsightsDefault
  readJsonSnapshot?: typeof readJsonSnapshotDefault
  writeJsonSnapshot?: typeof writeJsonSnapshotDefault
  appendJsonlRecord?: typeof appendJsonlRecordDefault
  normalizeAdsInsightForPage?: typeof normalizeAdsInsightForPageDefault
}

type PageAutomationResponse = Pick<ServerResponse, 'statusCode' | 'setHeader' | 'end'>

class PageAutomationApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'PageAutomationApiError'
    this.status = status
  }
}

export function createPageAutomationPlugin(env: PageAutomationEnv): Plugin {
  return {
    name: 'page-automation-api',
    configureServer(server) {
      server.middlewares.use(createPageAutomationMiddleware(env))
    },
  }
}

export function createPageAutomationMiddleware(env: PageAutomationEnv, options: PageAutomationMiddlewareOptions = {}) {
  const deps = {
    store: options.store ?? createPageAutomationStore(),
    now: options.now ?? (() => new Date().toISOString()),
    ensureStore: options.ensureStore ?? ensureStoreDefault,
    readMetaConfig: options.readMetaConfig ?? readPageAutomationMetaConfigDefault,
    fetchPages: options.fetchPages ?? fetchPageAutomationPagesDefault,
    fetchPageInsights: options.fetchPageInsights ?? fetchPageInsightsDefault,
    readJsonSnapshot: options.readJsonSnapshot ?? readJsonSnapshotDefault,
    writeJsonSnapshot: options.writeJsonSnapshot ?? writeJsonSnapshotDefault,
    appendJsonlRecord: options.appendJsonlRecord ?? appendJsonlRecordDefault,
    normalizeAdsInsightForPage: options.normalizeAdsInsightForPage ?? normalizeAdsInsightForPageDefault,
  }

  return async function pageAutomationMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void = () => undefined) {
    if (!req.url?.startsWith('/api/page-automation/')) {
      next()
      return
    }

    let metaConfig: PageAutomationMetaConfig | null = null

    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      await deps.ensureStore(deps.store)
      metaConfig = await deps.readMetaConfig(env)

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/status') {
        writeJson(res, 200, {
          ok: true,
          autoMode: 'off',
          storage: 'ready',
          checkedAt: deps.now(),
        } satisfies PageAutomationStatus)
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/pages') {
        const livePages = await deps.fetchPages(metaConfig).catch(() => null)
        if (livePages) {
          await deps.writeJsonSnapshot(deps.store.files.pages, livePages).catch(() => undefined)
          writeJson(res, 200, {
            pages: livePages,
            source: 'meta',
          })
          return
        }

        const cachedPages = await deps
          .readJsonSnapshot<ManagedPageRecord[]>(deps.store.files.pages, [])
          .catch(() => null)

        writeJson(res, 200, {
          pages: cachedPages ?? [],
          source: cachedPages ? 'cache' : 'unavailable',
        })
        return
      }

      const pageInsightsMatch = requestUrl.pathname.match(/^\/api\/page-automation\/pages\/([^/]+)\/insights$/)
      if (req.method === 'GET' && pageInsightsMatch) {
        const pageId = decodeURIComponent(pageInsightsMatch[1] ?? '')
        const insights = await deps.fetchPageInsights(metaConfig, pageId)
        writeJson(res, 200, {
          pageId,
          insights,
          checkedAt: deps.now(),
        })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/post-drafts') {
        writeJson(res, 200, { drafts: [] })
        return
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/page-automation/post-drafts') {
        assertJsonContentType(req)
        const body = await readJsonBody(req)
        const draft = validatePostDraftBody(body)
        const createdAt = deps.now()
        await deps.appendJsonlRecord(deps.store.files.auditLog, {
          id: `audit-${Date.now()}`,
          actor: 'user',
          action: 'intent_create_post_draft',
          target: draft.id,
          reason: 'intent to create post draft from Page Automation UI',
          createdAt,
        })
        await deps.appendJsonlRecord(deps.store.files.postDrafts, {
          ...body,
          ...draft,
          status: 'draft',
          createdAt,
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/messages') {
        writeJson(res, 200, {
          messages: [],
          source: 'polling',
          checkedAt: deps.now(),
        })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/ads-insights') {
        writeJson(res, 200, {
          insight: deps.normalizeAdsInsightForPage({
            datePreset: requestUrl.searchParams.get('datePreset') || 'last_7d',
            pageId: requestUrl.searchParams.get('pageId') || undefined,
            pageName: requestUrl.searchParams.get('pageName') || undefined,
            workspace: null,
          }),
        })
        return
      }

      writeJson(res, 404, { error: 'Page Automation endpoint not found' })
    } catch (error) {
      const status = error instanceof PageAutomationApiError ? error.status : 500
      writeJson(res, status, {
        error: sanitizeErrorMessage(errorMessage(error), env, metaConfig?.accessToken),
      })
    }
  }
}

function assertJsonContentType(req: IncomingMessage) {
  const contentType = req.headers['content-type']
  const values = Array.isArray(contentType) ? contentType : [contentType]
  const hasJsonContentType = values.some((value) => value?.toLowerCase().split(';', 1)[0].trim() === 'application/json')
  if (!hasJsonContentType) {
    throw new PageAutomationApiError('POST /post-drafts requires application/json', 415)
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_JSON_BODY_BYTES) {
      throw new PageAutomationApiError('Request body too large', 413)
    }
    chunks.push(buffer)
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new PageAutomationApiError('Request body must be valid JSON', 400)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PageAutomationApiError('JSON body must be an object', 400)
  }

  return parsed as Record<string, unknown>
}

function validatePostDraftBody(body: Record<string, unknown>) {
  const id = objectString(body, 'id').trim()
  const pageId = objectString(body, 'pageId').trim()
  const hasContent = ['caption', 'captionTh', 'title'].some((key) => Boolean(objectString(body, key).trim()))
  if (!id || !pageId || !hasContent) {
    throw new PageAutomationApiError('Post draft requires id, pageId, and content', 400)
  }

  const status = body.status
  if (status !== undefined && (!objectString(body, 'status') || !['draft', 'needs_review', 'ready'].includes(objectString(body, 'status')))) {
    throw new PageAutomationApiError('Post draft status must be draft, needs_review, or ready', 400)
  }

  return {
    id,
    pageId,
  }
}

function writeJson(res: PageAutomationResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function objectString(value: Record<string, unknown>, key: string) {
  const maybeString = value[key]
  return typeof maybeString === 'string' ? maybeString : ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Page Automation API failed'
}

function sanitizeErrorMessage(message: string, env: PageAutomationEnv, ...extraSecrets: Array<string | undefined>) {
  let sanitized = message
  const secretValues = [...extraSecrets, ...Object.entries(env).filter(([key]) => isSecretKey(key)).map(([, value]) => value)]

  for (const secret of secretValues) {
    const trimmed = secret?.trim()
    if (!trimmed) continue
    sanitized = sanitized.split(trimmed).join('[redacted]')
    sanitized = sanitized.split(encodeURIComponent(trimmed)).join('[redacted]')
  }

  return sanitized
}

function isSecretKey(key: string) {
  return /(token|secret|password|api_?key|access_?key)/i.test(key)
}
