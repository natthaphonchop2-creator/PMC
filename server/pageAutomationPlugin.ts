import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { readMetaWorkspaceForPageAutomation as readMetaWorkspaceForPageAutomationDefault } from './metaApiPlugin.js'
import { normalizeAdsInsightForPage as normalizeAdsInsightForPageDefault } from './pageAutomationAdsBridge.js'
import {
  fetchPageAutomationPages as fetchPageAutomationPagesDefault,
  fetchPageInsights as fetchPageInsightsDefault,
  fetchPageMessages as fetchPageMessagesDefault,
  readPageAutomationMetaConfig as readPageAutomationMetaConfigDefault,
  type PageAutomationMetaConfig,
} from './pageAutomationMetaApi.js'
import {
  appendJsonlRecord as appendJsonlRecordDefault,
  createPageAutomationStore,
  ensureStore as ensureStoreDefault,
  readJsonSnapshot as readJsonSnapshotDefault,
  readJsonlRecords as readJsonlRecordsDefault,
  writeJsonSnapshot as writeJsonSnapshotDefault,
  type PageAutomationStore,
} from './pageAutomationStore.js'
import type { ManagedPageRecord, PageAutomationStatus } from './pageAutomationTypes.js'
import type { PageMessage, PostDraft } from '../src/apps/page-automation/types'

const MAX_JSON_BODY_BYTES = 1_000_000

type PageAutomationEnv = Record<string, string | undefined>

type PageAutomationMiddlewareOptions = {
  store?: PageAutomationStore
  now?: () => string
  ensureStore?: typeof ensureStoreDefault
  readMetaConfig?: typeof readPageAutomationMetaConfigDefault
  fetchPages?: typeof fetchPageAutomationPagesDefault
  fetchPageInsights?: typeof fetchPageInsightsDefault
  fetchMessages?: typeof fetchPageMessagesDefault
  readJsonSnapshot?: typeof readJsonSnapshotDefault
  writeJsonSnapshot?: typeof writeJsonSnapshotDefault
  appendJsonlRecord?: typeof appendJsonlRecordDefault
  readJsonlRecords?: typeof readJsonlRecordsDefault
  normalizeAdsInsightForPage?: typeof normalizeAdsInsightForPageDefault
  readAdsWorkspace?: typeof readMetaWorkspaceForPageAutomationDefault
}

type PageAutomationResponse = Pick<ServerResponse, 'statusCode' | 'setHeader' | 'end'>

type PostScheduleRecord = {
  id: string
  draftId: string
  pageId: string
  scheduledAt: string
  status: 'scheduled' | 'cancelled'
  mode: 'operator' | 'auto_low_risk'
  createdAt: string
}

type PublishEventRecord = {
  id: string
  draftId: string
  status: 'posted' | 'failed'
  platformPostId?: string
  publishError?: string
  createdAt: string
}

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
    fetchMessages: options.fetchMessages ?? fetchPageMessagesDefault,
    readJsonSnapshot: options.readJsonSnapshot ?? readJsonSnapshotDefault,
    writeJsonSnapshot: options.writeJsonSnapshot ?? writeJsonSnapshotDefault,
    appendJsonlRecord: options.appendJsonlRecord ?? appendJsonlRecordDefault,
    readJsonlRecords: options.readJsonlRecords ?? readJsonlRecordsDefault,
    normalizeAdsInsightForPage: options.normalizeAdsInsightForPage ?? normalizeAdsInsightForPageDefault,
    readAdsWorkspace: options.readAdsWorkspace ?? readMetaWorkspaceForPageAutomationDefault,
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
        const savedStatus = await deps
          .readJsonSnapshot<Pick<PageAutomationStatus, 'autoMode'> | null>(deps.store.files.status, null)
          .catch(() => null)
        writeJson(res, 200, {
          ok: true,
          autoMode: normalizeAutoMode(savedStatus?.autoMode),
          storage: 'ready',
          checkedAt: deps.now(),
        } satisfies PageAutomationStatus)
        return
      }

      if (req.method === 'PUT' && requestUrl.pathname === '/api/page-automation/status') {
        assertJsonContentType(req)
        const body = await readJsonBody(req)
        const autoMode = validateAutoModeBody(body)
        const updatedAt = deps.now()
        await deps.appendJsonlRecord(deps.store.files.auditLog, {
          id: `audit-${Date.now()}`,
          actor: 'user',
          action: 'intent_update_auto_mode',
          target: 'global-auto-mode',
          reason: `operator set Page Automation auto mode ${autoMode}`,
          createdAt: updatedAt,
        })
        await deps.writeJsonSnapshot(deps.store.files.status, { autoMode, updatedAt })
        writeJson(res, 200, {
          ok: true,
          autoMode,
          storage: 'ready',
          checkedAt: updatedAt,
        } satisfies PageAutomationStatus)
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/pages') {
        const livePages = await deps.fetchPages(metaConfig).catch(() => null)
        if (livePages) {
          const enrichedPages = await enrichPagesWithInsights(livePages, metaConfig, deps.fetchPageInsights)
          await deps.writeJsonSnapshot(deps.store.files.pages, enrichedPages).catch(() => undefined)
          writeJson(res, 200, {
            pages: enrichedPages,
            source: 'meta',
          })
          return
        }

        const cachedPages = await deps
          .readJsonSnapshot<ManagedPageRecord[] | null>(deps.store.files.pages, null)
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
        const drafts = await readMaterializedPostDrafts(deps).catch(() => null)
        writeJson(res, 200, {
          drafts: drafts ?? [],
          source: drafts ? 'cache' : 'unavailable',
          checkedAt: deps.now(),
        })
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
          status: draft.status,
          createdAt,
          updatedAt: createdAt,
        })
        writeJson(res, 200, { ok: true })
        return
      }

      const scheduleMatch = requestUrl.pathname.match(/^\/api\/page-automation\/post-drafts\/([^/]+)\/schedule$/)
      if (req.method === 'POST' && scheduleMatch) {
        assertJsonContentType(req)
        const draftId = decodeURIComponent(scheduleMatch[1] ?? '')
        const body = await readJsonBody(req)
        const scheduledAt = validateScheduledAtBody(body)
        const drafts = await readMaterializedPostDrafts(deps)
        if (!drafts) throw new PageAutomationApiError('Post drafts unavailable', 503)
        const draft = drafts.find((item) => item.id === draftId)
        if (!draft) throw new PageAutomationApiError('Post draft not found', 404)
        if (draft.status !== 'ready') {
          throw new PageAutomationApiError('Only ready post drafts can be scheduled', 409)
        }

        const createdAt = deps.now()
        await deps.appendJsonlRecord(deps.store.files.auditLog, {
          id: `audit-${Date.now()}`,
          actor: 'user',
          action: 'intent_schedule_post_draft',
          target: draft.id,
          reason: 'operator scheduled ready Page Automation post draft',
          createdAt,
        })
        await deps.appendJsonlRecord(deps.store.files.schedules, {
          id: `schedule-${Date.now()}`,
          draftId: draft.id,
          pageId: draft.pageId,
          scheduledAt,
          status: 'scheduled',
          mode: 'operator',
          createdAt,
        } satisfies PostScheduleRecord)

        writeJson(res, 200, {
          ok: true,
          draft: {
            ...draft,
            scheduledAt,
            status: 'scheduled',
            updatedAt: createdAt,
          },
        })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/messages') {
        const messagePages = await resolvePagesForMessages(deps, metaConfig)
        const liveMessages = await deps.fetchMessages(metaConfig, messagePages).catch(() => null)
        if (liveMessages) {
          await Promise.all(
            liveMessages.map((message) => deps.appendJsonlRecord(deps.store.files.messageCache, message).catch(() => undefined)),
          )
          writeJson(res, 200, {
            messages: liveMessages,
            source: 'meta',
            checkedAt: deps.now(),
          })
          return
        }

        const messages = await deps.readJsonlRecords<PageMessage>(deps.store.files.messageCache, null).catch(() => null)
        writeJson(res, 200, {
          messages: messages ?? [],
          source: messages ? 'cache' : 'unavailable',
          checkedAt: deps.now(),
        })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/page-automation/ads-insights') {
        const datePreset = requestUrl.searchParams.get('datePreset') || 'last_7d'
        const workspace = await deps.readAdsWorkspace(env, datePreset).catch(() => null)
        if (!workspace) {
          writeJson(res, 200, {
            insight: null,
            source: 'unavailable',
          })
          return
        }

        writeJson(res, 200, {
          insight: deps.normalizeAdsInsightForPage({
            datePreset,
            pageId: requestUrl.searchParams.get('pageId') || undefined,
            pageName: requestUrl.searchParams.get('pageName') || undefined,
            workspace,
          }),
          source: 'ads-workspace',
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
    status: objectString(body, 'status') || 'draft',
  }
}

function validateAutoModeBody(body: Record<string, unknown>): PageAutomationStatus['autoMode'] {
  const autoMode = objectString(body, 'autoMode')
  if (autoMode !== 'on' && autoMode !== 'off') {
    throw new PageAutomationApiError('Auto mode must be on or off', 400)
  }

  return autoMode
}

function validateScheduledAtBody(body: Record<string, unknown>) {
  const scheduledAt = objectString(body, 'scheduledAt').trim()
  const time = Date.parse(scheduledAt)
  if (!scheduledAt || !Number.isFinite(time)) {
    throw new PageAutomationApiError('Schedule requires a valid scheduledAt ISO timestamp', 400)
  }

  return new Date(time).toISOString()
}

function normalizeAutoMode(autoMode: unknown): PageAutomationStatus['autoMode'] {
  return autoMode === 'on' ? 'on' : 'off'
}

async function resolvePagesForMessages(
  deps: {
    fetchPages: typeof fetchPageAutomationPagesDefault
    readJsonSnapshot: typeof readJsonSnapshotDefault
    store: PageAutomationStore
    writeJsonSnapshot: typeof writeJsonSnapshotDefault
  },
  metaConfig: PageAutomationMetaConfig,
) {
  const cachedPages = await deps
    .readJsonSnapshot<ManagedPageRecord[] | null>(deps.store.files.pages, null)
    .catch(() => null)
  if (cachedPages) return cachedPages

  const livePages = await deps.fetchPages(metaConfig).catch(() => null)
  if (!livePages) return []

  await deps.writeJsonSnapshot(deps.store.files.pages, livePages).catch(() => undefined)
  return livePages
}

async function readMaterializedPostDrafts(deps: {
  readJsonlRecords: typeof readJsonlRecordsDefault
  store: PageAutomationStore
}) {
  const drafts = await deps.readJsonlRecords<PostDraft>(deps.store.files.postDrafts, null)
  if (!drafts) return null

  const schedules = (await deps.readJsonlRecords<PostScheduleRecord>(deps.store.files.schedules, []).catch(() => [])) ?? []
  const publishEvents = (await deps.readJsonlRecords<PublishEventRecord>(deps.store.files.publishEvents, []).catch(() => [])) ?? []
  return materializePostDrafts(drafts, schedules, publishEvents)
}

function materializePostDrafts(
  drafts: PostDraft[],
  schedules: PostScheduleRecord[],
  publishEvents: PublishEventRecord[],
) {
  const latestScheduleByDraft = new Map<string, PostScheduleRecord>()
  const latestPublishEventByDraft = new Map<string, PublishEventRecord>()

  for (const schedule of schedules) {
    if (!isValidScheduleRecord(schedule)) continue
    const previous = latestScheduleByDraft.get(schedule.draftId)
    if (!previous || Date.parse(schedule.createdAt) >= Date.parse(previous.createdAt)) {
      latestScheduleByDraft.set(schedule.draftId, schedule)
    }
  }

  for (const event of publishEvents) {
    if (!isValidPublishEventRecord(event)) continue
    const previous = latestPublishEventByDraft.get(event.draftId)
    if (!previous || Date.parse(event.createdAt) >= Date.parse(previous.createdAt)) {
      latestPublishEventByDraft.set(event.draftId, event)
    }
  }

  return drafts.map((draft) => {
    const schedule = latestScheduleByDraft.get(draft.id)
    const publishEvent = latestPublishEventByDraft.get(draft.id)
    const scheduledDraft: PostDraft =
      schedule?.status === 'scheduled'
        ? {
            ...draft,
            scheduledAt: schedule.scheduledAt,
            status: 'scheduled',
            updatedAt: schedule.createdAt,
          }
        : draft

    if (!publishEvent) return scheduledDraft
    if (publishEvent.status === 'posted') {
      return {
        ...scheduledDraft,
        platformPostId: publishEvent.platformPostId,
        status: 'posted',
        updatedAt: publishEvent.createdAt,
      }
    }

    return {
      ...scheduledDraft,
      publishError: publishEvent.publishError,
      status: 'failed',
      updatedAt: publishEvent.createdAt,
    }
  })
}

function isValidScheduleRecord(record: PostScheduleRecord) {
  return Boolean(
    record &&
      typeof record.draftId === 'string' &&
      typeof record.pageId === 'string' &&
      typeof record.scheduledAt === 'string' &&
      Number.isFinite(Date.parse(record.scheduledAt)) &&
      typeof record.createdAt === 'string' &&
      (record.status === 'scheduled' || record.status === 'cancelled'),
  )
}

function isValidPublishEventRecord(record: PublishEventRecord) {
  return Boolean(
    record &&
      typeof record.draftId === 'string' &&
      typeof record.createdAt === 'string' &&
      (record.status === 'posted' || record.status === 'failed'),
  )
}

async function enrichPagesWithInsights(
  pages: ManagedPageRecord[],
  metaConfig: PageAutomationMetaConfig,
  fetchPageInsights: typeof fetchPageInsightsDefault,
) {
  return Promise.all(
    pages.map(async (page) => {
      const insights = await fetchPageInsights(metaConfig, page.id).catch(() => null)
      const reach = insights?.reach ?? page.reach
      const engagementRate = insights?.engagementRate ?? page.engagementRate

      return {
        ...page,
        reach,
        engagementRate,
        healthScore: scorePageHealth({
          engagementRate,
          permissionsMissing: page.permissions.reduce((sum, report) => sum + report.missing.length, 0),
          reach,
        }),
      }
    }),
  )
}

function scorePageHealth({
  engagementRate,
  permissionsMissing,
  reach,
}: {
  engagementRate: number
  permissionsMissing: number
  reach: number
}) {
  const reachScore = reach > 0 ? 24 : 0
  const engagementScore = Math.min(28, Math.round(Math.max(0, engagementRate) * 2))
  const permissionPenalty = Math.min(36, permissionsMissing * 6)
  return clamp(Math.round(54 + reachScore + engagementScore - permissionPenalty), 0, 100)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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
