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
        const pages = livePages ?? (await deps.readJsonSnapshot<ManagedPageRecord[]>(deps.store.files.pages, []))
        if (livePages) await deps.writeJsonSnapshot(deps.store.files.pages, livePages)

        writeJson(res, 200, {
          pages,
          source: livePages ? 'meta' : 'cache',
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
        const body = await readJsonBody(req)
        const draftId = objectString(body, 'id') || 'draft'
        await deps.appendJsonlRecord(deps.store.files.postDrafts, {
          ...body,
          createdAt: deps.now(),
        })
        await deps.appendJsonlRecord(deps.store.files.auditLog, {
          id: `audit-${Date.now()}`,
          actor: 'user',
          action: 'create_post_draft',
          target: draftId,
          reason: 'created from Page Automation UI',
          createdAt: deps.now(),
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

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PageAutomationApiError('JSON body must be an object', 400)
  }

  return parsed as Record<string, unknown>
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
