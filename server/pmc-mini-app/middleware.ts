import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProductionMiddleware } from '../productionApp.js'
import type { PmcMiniAppServerConfig } from './config.js'
import type { AuthenticatedMiniAppContext, LineIdentityPort } from './contracts.js'
import { consumeEvidenceMultipart, MiniAppEvidenceError, serverEvidenceName, validateEvidence } from './evidence.js'
import type { MiniAppDrivePort, MiniAppEvidenceKind } from './googleClient.js'
import type { MiniAppRequestRecord, MiniAppStore } from './store.js'

export interface PmcMiniAppMiddlewareDependencies {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
  drive?: MiniAppDrivePort
  now?: () => Date
  randomId?: () => string
}

export function createPmcMiniAppMiddleware(deps: PmcMiniAppMiddlewareDependencies): ProductionMiddleware {
  return async (req, res) => {
    applySecurityHeaders(res)
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      respond(res, 400, { error: 'MINI_APP_INVALID_REQUEST' })
      return
    }

    const pathname = url.pathname
    if (pathname === '/api/mini-app/client-config') {
      if (!requireGet(req, res)) return
      respond(res, 200, { miniAppId: deps.config.miniAppId })
      return
    }

    const evidenceRoute = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})\/evidence$/.exec(pathname)
    if (evidenceRoute) {
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
        return
      }
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      await handleEvidenceUpload(req, res, url, evidenceRoute[1]!, authenticated, deps)
      return
    }

    if (pathname !== '/api/mini-app/session' && pathname !== '/api/mini-app/config') {
      respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
      return
    }
    if (!requireGet(req, res)) return

    const authenticated = await authenticate(req, res, deps)
    if (!authenticated) return

    if (pathname === '/api/mini-app/session') {
      respond(res, 200, {
        staffId: authenticated.staffId,
        displayName: authenticated.displayName,
        active: true,
      })
      return
    }

    try {
      const bookingConfig = await deps.store.getActiveBookingConfig()
      respond(res, 200, {
        fallbackFormUrl: deps.config.fallbackFormUrl,
        doctors: bookingConfig.doctors,
        services: bookingConfig.services,
        channels: bookingConfig.channels,
        aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, ...bookingConfig.aes.filter(({ id }) => id !== 'NONE')],
      })
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    }
  }
}

async function handleEvidenceUpload(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  draftId: string,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  if (!deps.drive) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }
  const kinds = url.searchParams.getAll('kind')
  const kind = kinds.length === 1 && (kinds[0] === 'PAYMENT' || kinds[0] === 'CHAT') ? kinds[0] as MiniAppEvidenceKind : null
  if (!kind) {
    respond(res, 400, { error: 'INVALID_EVIDENCE_KIND' })
    return
  }

  let current: MiniAppRequestRecord
  try {
    const draft = await deps.store.getDraft(draftId)
    if (!draft || draft.staffId !== authenticated.staffId) {
      respond(res, 404, { error: 'DRAFT_NOT_FOUND' })
      return
    }
    if (draft.state !== 'DRAFT' && draft.state !== 'UPLOADING') {
      respond(res, 409, { error: 'DRAFT_NOT_UPLOADABLE' })
      return
    }
    const existing = evidenceIdsFor(draft, kind)
    if (existing.length >= deps.config.maxFilesPerKind) {
      respond(res, 409, { error: `${kind}_EVIDENCE_LIMIT` })
      return
    }
    const now = (deps.now ?? (() => new Date()))().toISOString()
    current = await deps.store.updateDraft(draftId, draft.version, { state: 'UPLOADING', updatedAt: now })
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }

  const uploaded: Array<{ fileId: string; kind: MiniAppEvidenceKind; order: number }> = []
  try {
    await consumeEvidenceMultipart(req, {
      maxFiles: deps.config.maxFilesPerKind,
      maxFileBytes: deps.config.maxImageBytes,
    }, async (file) => {
      const existing = evidenceIdsFor(current, kind)
      if (existing.length >= deps.config.maxFilesPerKind) throw new MiniAppEvidenceError(`${kind}_EVIDENCE_LIMIT`)
      const mimeType = validateEvidence(file.bytes, file.advertisedMime)
      const name = serverEvidenceName(kind, mimeType, (deps.randomId ?? randomUUID)())
      const fileId = await deps.drive!.uploadEvidence({
        parentId: deps.config.intakeFolderId,
        draftId: current.draftId,
        requestId: current.requestId,
        kind,
        name,
        mimeType,
        bytes: file.bytes,
      })
      const paymentEvidenceFileIds = kind === 'PAYMENT' ? [...current.paymentEvidenceFileIds, fileId] : current.paymentEvidenceFileIds
      const chatEvidenceFileIds = kind === 'CHAT' ? [...current.chatEvidenceFileIds, fileId] : current.chatEvidenceFileIds
      current = await deps.store.updateDraft(current.draftId, current.version, {
        state: 'UPLOADING',
        paymentEvidenceFileIds,
        chatEvidenceFileIds,
        evidenceCount: paymentEvidenceFileIds.length + chatEvidenceFileIds.length,
        updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      })
      uploaded.push({ fileId, kind, order: evidenceIdsFor(current, kind).length })
    })
    current = await deps.store.updateDraft(current.draftId, current.version, {
      state: 'DRAFT',
      updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    })
    respond(res, 200, { uploaded, draftVersion: current.version })
  } catch (error) {
    try {
      if (current.state === 'UPLOADING') {
        current = await deps.store.updateDraft(current.draftId, current.version, {
          state: 'DRAFT', updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
        })
      }
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
      return
    }
    const code = error instanceof MiniAppEvidenceError ? error.code : 'EVIDENCE_UPLOAD_FAILED'
    respond(res, evidenceStatus(code), { error: code })
  }
}

function evidenceIdsFor(draft: MiniAppRequestRecord, kind: MiniAppEvidenceKind): string[] {
  return kind === 'PAYMENT' ? draft.paymentEvidenceFileIds : draft.chatEvidenceFileIds
}

function evidenceStatus(code: string): number {
  if (code === 'UNSUPPORTED_EVIDENCE') return 415
  if (code === 'EVIDENCE_TOO_LARGE') return 413
  if (code.endsWith('_EVIDENCE_LIMIT') || code === 'EVIDENCE_FILE_LIMIT') return 409
  if (code === 'EVIDENCE_UPLOAD_FAILED') return 503
  return 400
}

async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<AuthenticatedMiniAppContext | null> {
  const idToken = bearerToken(req.headers.authorization)
  if (!idToken) {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
    return null
  }

  let lineUserId: string
  try {
    lineUserId = (await deps.identity.verify(idToken)).lineUserId
  } catch {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
    return null
  }

  try {
    const staff = await deps.store.getActiveStaffByLineUserId(lineUserId)
    if (!staff) {
      respond(res, 403, { error: 'STAFF_NOT_ALLOWED' })
      return null
    }
    return { staffId: staff.id, displayName: staff.name, lineUserId }
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return null
  }
}

function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length)
  return token.length > 0 && token.length <= 8_192 && !/\s/.test(token) ? token : null
}

function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
  return false
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
}

function respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
