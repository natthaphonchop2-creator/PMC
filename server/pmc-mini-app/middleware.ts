import { createHmac, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProductionMiddleware } from '../productionApp.js'
import type { PmcMiniAppServerConfig } from './config.js'
import type {
  AuthenticatedMiniAppContext,
  FinanceServerDependencies,
  LineIdentityPort,
  StockServerDependencies,
} from './contracts.js'
import { bookingPayloadHash, parseBookingDraft, parseBookingDraftV2 } from './bookingDraft.js'
import { consumeEvidenceMultipart, MiniAppEvidenceError, serverEvidenceName, validateEvidence } from './evidence.js'
import {
  BOOKING_PREPARE_LIMITS,
  consumeBookingPrepareMultipart,
  consumeEvidenceBatchMultipart,
  type EvidenceBatch,
} from './evidenceBatch.js'
import type { MiniAppDrivePort, MiniAppEvidenceKind, MiniAppEvidenceMime } from './googleClient.js'
import type { EvidenceStagingPort } from './stagingStore.js'
import type { MiniAppRequestRecord, MiniAppResumeStore, MiniAppStore } from './store.js'
import type { BookingTaskQueuePort } from './taskQueue.js'
import { isJeraMiniAppApiPath, type JeraMiniAppApi } from '../jera/middleware.js'
import { EnrollmentError, type EnrollmentService } from './enrollment.js'
import { extractWorkerBearerToken, type WorkerIdentityVerifier } from './workerAuth.js'
import type { AsyncBookingWorker } from './asyncWorker.js'
import type { AsyncStateIngressPort } from './asyncStateIngressClient.js'
import type { MiniAppAsyncStateMutation } from '../../shared/pmcMiniAppAsyncState.js'
import type { AsyncBookingTelemetry } from './asyncTelemetry.js'
import { handleStockMiniAppApi, isStockMiniAppApiPath } from './stock/middleware.js'
import { handleFinanceMiniAppApi, isFinanceMiniAppApiPath } from './finance/middleware.js'
import {
  BookingPreparePersistenceError,
  persistPrepareEvidence,
  projectionDigest,
  type PersistPrepareEvidenceInput,
} from './bookingPrepare.js'
import type { DraftStateIngressPort } from './draftStateIngressClient.js'
import type { MiniAppDraftStateMutation, MiniAppDraftStateResult } from '../../shared/pmcMiniAppDraftState.js'
import { validatedQueueFastPath, type SafeQueueProjection } from './queuedProjection.js'
import type {
  BookingPerformanceTelemetry,
  BookingTimingAction,
  BookingTimingEventName,
  BookingTimingRoute,
} from './bookingPerformanceTelemetry.js'

const ASYNC_WORKER_PATH = '/internal/mini-app/finalize-booking'
const ASYNC_WORKER_MAX_BODY_BYTES = 1_024

export type AsyncBookingWorkerEntrypoint = AsyncBookingWorker

export interface PmcMiniAppMiddlewareDependencies {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
  drive?: MiniAppDrivePort
  evidenceStaging?: EvidenceStagingPort
  taskQueue?: BookingTaskQueuePort
  workerIdentity?: WorkerIdentityVerifier
  asyncWorker?: AsyncBookingWorker
  stateIngress?: AsyncStateIngressPort
  draftStateIngress?: DraftStateIngressPort
  asyncTelemetry?: AsyncBookingTelemetry
  bookingPerformanceTelemetry?: BookingPerformanceTelemetry
  performanceNow?: () => number
  now?: () => Date
  randomId?: () => string
  requestId?: () => string
  draftId?: () => string
  ingress?: { send(draft: MiniAppRequestRecord): Promise<{ caseId: string; status: NonNullable<MiniAppRequestRecord['confirmationStatus']> }> }
  evidenceIngress?: { upload(input: {
    draftId: string
    requestId: string
    kind: MiniAppEvidenceKind
    mimeType: MiniAppEvidenceMime
    bytes: Buffer
  }): Promise<string> }
  enrollment?: EnrollmentService
  jera?: JeraMiniAppApi
  stock?: StockServerDependencies
  finance?: FinanceServerDependencies
}

export function createPmcMiniAppMiddleware(deps: PmcMiniAppMiddlewareDependencies): ProductionMiddleware {
  return async (req, res) => {
    applySecurityHeaders(res)
    if (req.url === ASYNC_WORKER_PATH) {
      await handleAsyncWorkerRoute(req, res, deps)
      return
    }

    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      respond(res, 400, { error: 'MINI_APP_INVALID_REQUEST' })
      return
    }

    const pathname = url.pathname
    if (deps.config.bookingMutationsPaused && isUserBookingMutation(pathname, req.method)) {
      respond(res, 503, { error: 'BOOKING_MUTATIONS_PAUSED' })
      return
    }
    if (pathname === '/internal/mini-app/jera-sync' || pathname === '/internal/mini-app/jera-allocation-worker'
      || pathname === '/internal/mini-app/finance-daily-seed') {
      if (!deps.jera) {
        respond(res, 503, { error: pathname === '/internal/mini-app/finance-daily-seed'
          ? 'FINANCE_REFRESH_UNAVAILABLE' : 'JERA_SCHEDULER_UNAVAILABLE' })
        return
      }
      if (!await deps.jera.handleInternal(req, res, url)) respond(res, 404, { error: 'JERA_INTERNAL_ROUTE_NOT_FOUND' })
      return
    }
    if (pathname === '/api/mini-app/client-config') {
      if (!requireGet(req, res)) return
      respond(res, 200, { miniAppId: deps.config.miniAppId })
      return
    }

    if (pathname === '/api/mini-app/enrollment-options' || pathname === '/api/mini-app/enroll') {
      if (!deps.enrollment) {
        respond(res, 503, { error: 'MINI_APP_ENROLLMENT_UNAVAILABLE' })
        return
      }
      const lineUserId = await authenticateLineIdentity(req, res, deps)
      if (!lineUserId) return
      if (pathname === '/api/mini-app/enrollment-options') {
        if (!requireGet(req, res)) return
        try {
          respond(res, 200, { staff: await deps.enrollment.listOptions() })
        } catch {
          respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
        }
        return
      }
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
        return
      }
      const body = await readRequiredJson(req, res)
      if (!body) return
      if (!hasExactKeys(body, ['staffId', 'pin']) || typeof body.staffId !== 'string' || typeof body.pin !== 'string') {
        respond(res, 400, { error: 'MINI_APP_INVALID_ENROLLMENT' })
        return
      }
      try {
        respond(res, 200, await deps.enrollment.enroll({ staffId: body.staffId, pin: body.pin, lineUserId }))
      } catch (error) {
        if (error instanceof EnrollmentError) {
          const status = error.code === 'ENROLLMENT_RATE_LIMITED' ? 429
            : error.code === 'ENROLLMENT_STAFF_UNAVAILABLE' ? 409
              : 403
          respond(res, status, {
            error: error.code,
            ...(error.retryAfterSeconds > 0 ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
          })
          return
        }
        respond(res, 503, { error: 'MINI_APP_ENROLLMENT_FAILED' })
      }
      return
    }

    if (isJeraMiniAppApiPath(pathname)) {
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      if (!deps.jera) {
        respond(res, 503, { error: 'JERA_REPORTING_UNAVAILABLE' })
        return
      }
      if (!await deps.jera.handle(req, res, url, authenticated)) respond(res, 404, { error: 'JERA_REPORT_NOT_FOUND' })
      return
    }

    if (isStockMiniAppApiPath(pathname)) {
      if (!deps.stock?.enabled) {
        respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
        return
      }
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      if (deps.stock.managerPilotOnly && !authenticated.canManageStock) {
        respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
        return
      }
      await handleStockMiniAppApi(req, res, url, authenticated, deps.stock)
      return
    }

    if (isFinanceMiniAppApiPath(pathname)) {
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      await handleFinanceMiniAppApi(req, res, url, authenticated, deps.finance)
      return
    }

    const prepareRoute = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})\/prepare$/.exec(pathname)
    if (prepareRoute) {
      const requestStartedAt = timingNow(deps)
      if (!deps.config.bookingProtocol.prepare) {
        respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
        return
      }
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
        return
      }
      const authenticated = await authenticate(req, res, deps, { name: 'prepare_completed', route: 'prepare' })
      if (!authenticated) {
        emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'request', responseStatus(res, 503), requestStartedAt)
        return
      }
      if (!requireBookingRecorder(authenticated, res)) {
        emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'request', responseStatus(res, 403), requestStartedAt)
        return
      }
      await handleBookingPrepare(req, res, prepareRoute[1]!, authenticated, deps)
      emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'request', responseStatus(res, 500), requestStartedAt)
      return
    }

    const evidenceBatchRoute = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})\/evidence-batch$/.exec(pathname)
    if (evidenceBatchRoute) {
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
        return
      }
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      if (!requireBookingRecorder(authenticated, res)) return
      await handleEvidenceBatchUpload(req, res, evidenceBatchRoute[1]!, authenticated, deps)
      return
    }

    if (pathname === '/api/mini-app/booking-drafts/active') {
      if (!requireGet(req, res)) return
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      if (!requireBookingRecorder(authenticated, res)) return
      const asyncOwner = Boolean(deps.config.asyncBooking?.ownerStaffIds.has(authenticated.staffId))
      if (!deps.config.bookingProtocol.prepare && !asyncOwner) {
        respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
        return
      }
      const store = deps.store as MiniAppStore & Partial<MiniAppResumeStore>
      if (!store.getLatestActiveDraftByStaff) {
        respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
        return
      }
      try {
        const draft = await store.getLatestActiveDraftByStaff(authenticated.staffId)
        respond(res, 200, draft ? safeActiveDraftProjection(draft) : null)
      } catch {
        respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
      }
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
      if (!requireBookingRecorder(authenticated, res)) return
      await handleEvidenceUpload(req, res, url, evidenceRoute[1]!, authenticated, deps)
      return
    }

    const bookingRoute = bookingDraftRoute(pathname)
    if (bookingRoute) {
      const confirmStartedAt = bookingRoute.action === 'CONFIRM' ? timingNow(deps) : null
      const authenticated = await authenticate(req, res, deps, confirmStartedAt === null ? undefined : { name: 'confirm_completed', route: 'confirm' })
      if (!authenticated) {
        if (confirmStartedAt !== null) emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'request', responseStatus(res, 503), confirmStartedAt)
        return
      }
      if (!requireBookingRecorder(authenticated, res)) {
        if (confirmStartedAt !== null) emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'request', responseStatus(res, 403), confirmStartedAt)
        return
      }
      await handleBookingDraftRoute(req, res, bookingRoute, authenticated, deps)
      if (confirmStartedAt !== null) emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'request', responseStatus(res, 500), confirmStartedAt)
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
        reportingEnabled: Boolean(deps.jera),
        financeReportsEnabled: deps.jera?.financeServiceReady === true && deps.config.financeReportsEnabled,
        stockEnabled: Boolean(deps.stock?.enabled) && (!deps.stock?.managerPilotOnly || authenticated.canManageStock),
        expenseCaptureEnabled: Boolean(deps.finance?.capture),
        financeReadsEnabled: Boolean(deps.finance?.reads),
        canManageStock: authenticated.canManageStock,
        canSubmitExpense: authenticated.canSubmitExpense,
        canViewFinance: authenticated.canViewFinance,
        canManageExpense: authenticated.canManageExpense,
        doctors: bookingConfig.doctors,
        services: bookingConfig.services,
        channels: bookingConfig.channels,
        bookingProtocol: deps.config.bookingProtocol,
        admins: bookingConfig.admins ?? bookingConfig.aes,
        aes: bookingConfig.aes,
      })
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    }
  }
}

async function handleAsyncWorkerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
    return
  }
  if (!deps.config.asyncBooking) {
    respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
    return
  }
  if (!deps.workerIdentity) {
    respond(res, 503, { error: 'ASYNC_WORKER_UNAVAILABLE' })
    return
  }

  const token = extractWorkerBearerToken(req.headers.authorization)
  if (!token) {
    respond(res, 401, { error: 'ASYNC_WORKER_UNAUTHORIZED' })
    return
  }
  try {
    await deps.workerIdentity.verify(token)
  } catch {
    respond(res, 401, { error: 'ASYNC_WORKER_UNAUTHORIZED' })
    return
  }

  if (!deps.asyncWorker) {
    respond(res, 503, { error: 'ASYNC_WORKER_UNAVAILABLE' })
    return
  }
  const retryCount = taskRetryCount(req)
  if (retryCount === null) {
    respond(res, 400, { error: 'ASYNC_WORKER_INVALID_RETRY_COUNT' })
    return
  }
  const body = await readWorkerJson(req, res)
  if (!body) return
  if (!hasExactKeys(body, ['requestId', 'draftId', 'payloadHash', 'baseVersion'])
    || typeof body.requestId !== 'string'
    || typeof body.draftId !== 'string'
    || typeof body.payloadHash !== 'string'
    || typeof body.baseVersion !== 'number'
    || !safeWorkerId(body.requestId)
    || !safeWorkerId(body.draftId)
    || !safeWorkerId(body.payloadHash)
    || !Number.isSafeInteger(body.baseVersion)
    || body.baseVersion < 1) {
    respond(res, 400, { error: 'ASYNC_WORKER_INVALID_BODY' })
    return
  }

  try {
    const result = await deps.asyncWorker.finalize({
      requestId: body.requestId,
      draftId: body.draftId,
      payloadHash: body.payloadHash,
      baseVersion: body.baseVersion,
      attempt: retryCount + 1,
    })
    respond(res, 200, { ...result })
  } catch {
    respond(res, 503, { error: 'ASYNC_WORKER_FAILED' })
  }
}

function taskRetryCount(req: IncomingMessage): number | null {
  const values: string[] = []
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === 'x-cloudtasks-taskretrycount') {
      values.push(req.rawHeaders[index + 1] ?? '')
    }
  }
  if (values.length === 0) {
    const normalized = req.headers['x-cloudtasks-taskretrycount']
    if (typeof normalized === 'string') values.push(normalized)
    else if (Array.isArray(normalized)) values.push(...normalized)
  }
  if (values.length !== 1 || !/^[0-7]$/.test(values[0]!)) return null
  return Number(values[0])
}

async function readWorkerJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string'
    || contentType.includes(',')
    || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    respond(res, 415, { error: 'ASYNC_WORKER_JSON_REQUIRED' })
    return null
  }
  const contentLength = req.headers['content-length']
  if (contentLength !== undefined) {
    if (typeof contentLength !== 'string' || !/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      respond(res, 400, { error: 'ASYNC_WORKER_INVALID_BODY' })
      return null
    }
    if (Number(contentLength) > ASYNC_WORKER_MAX_BODY_BYTES) {
      respond(res, 413, { error: 'ASYNC_WORKER_PAYLOAD_TOO_LARGE' })
      return null
    }
  }

  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > ASYNC_WORKER_MAX_BODY_BYTES) {
        respond(res, 413, { error: 'ASYNC_WORKER_PAYLOAD_TOO_LARGE' })
        return null
      }
      chunks.push(bytes)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch {
    respond(res, 400, { error: 'ASYNC_WORKER_INVALID_JSON' })
    return null
  }
}

function safeWorkerId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

type BookingDraftRoute =
  | { action: 'CREATE' }
  | { action: 'GET' | 'PATCH' | 'CONFIRM' | 'CANCEL'; draftId: string }

function isUserBookingMutation(pathname: string, method: string | undefined): boolean {
  if (method === 'POST' && pathname === '/api/mini-app/booking-drafts') return true
  if (method === 'PATCH' && /^\/api\/mini-app\/booking-drafts\/[A-Za-z0-9._:-]{1,124}$/.test(pathname)) return true
  if (method !== 'POST') return false
  return /^\/api\/mini-app\/booking-drafts\/[A-Za-z0-9._:-]{1,124}\/(?:confirm|cancel|evidence|evidence-batch|prepare)$/.test(pathname)
}

function bookingDraftRoute(pathname: string): BookingDraftRoute | null {
  if (pathname === '/api/mini-app/booking-drafts') return { action: 'CREATE' }
  const match = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})(?:\/(confirm|cancel))?$/.exec(pathname)
  if (!match) return null
  if (match[2] === 'confirm') return { action: 'CONFIRM', draftId: match[1]! }
  if (match[2] === 'cancel') return { action: 'CANCEL', draftId: match[1]! }
  return { action: 'GET', draftId: match[1]! }
}

type BookingMutationEnvelope =
  | { protocolVersion: 1; version: number; input?: unknown }
  | { protocolVersion: 2; version: number; input?: unknown }

type BookingMutationEnvelopeResult =
  | { value: BookingMutationEnvelope }
  | { status: 400; error: 'INVALID_BOOKING_PROTOCOL_VERSION' | 'UNKNOWN_BOOKING_FIELD' }

function parseBookingMutationEnvelope(
  action: 'PATCH' | 'CONFIRM' | 'CANCEL',
  body: Record<string, unknown>,
): BookingMutationEnvelopeResult {
  const legacyKeys = action === 'PATCH' ? ['version', 'input'] : ['version']
  const protocol2Keys = action === 'PATCH' ? ['protocolVersion', 'version', 'input'] : ['protocolVersion', 'version']
  if (hasExactKeys(body, legacyKeys)) {
    return { value: { protocolVersion: 1, version: body.version as number, ...(action === 'PATCH' ? { input: body.input } : {}) } }
  }
  if (hasExactKeys(body, protocol2Keys)) {
    if (body.protocolVersion !== 2) return { status: 400, error: 'INVALID_BOOKING_PROTOCOL_VERSION' }
    return { value: { protocolVersion: 2, version: body.version as number, ...(action === 'PATCH' ? { input: body.input } : {}) } }
  }
  if ('protocolVersion' in body && body.protocolVersion !== 2) {
    return { status: 400, error: 'INVALID_BOOKING_PROTOCOL_VERSION' }
  }
  return { status: 400, error: 'UNKNOWN_BOOKING_FIELD' }
}

function isProtocol1Recovery(
  action: 'PATCH' | 'CONFIRM' | 'CANCEL',
  draft: MiniAppRequestRecord,
  mutation: BookingMutationEnvelope,
  asyncOwner: boolean,
): boolean {
  if (mutation.protocolVersion !== 1 || draft.protocolVersion !== 1) return false
  if (action === 'PATCH') {
    return mutation.version < draft.version && matchesSavedDraftInput(draft, mutation.input)
  }
  if (action === 'CANCEL') {
    return mutation.version < draft.version
      && draft.state === 'CANCELLED'
      && draft.retentionState === 'PENDING_APPROVAL'
  }
  return draft.state === 'CONFIRMED'
    || confirmedWithRetryResult(draft) !== null
    || asyncOwner && mutation.version <= draft.version && isBoundAsyncConfirmation(draft)
}

async function handleBookingDraftRoute(
  req: IncomingMessage,
  res: ServerResponse,
  route: BookingDraftRoute,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  const handlerStartedAt = (deps.now ?? (() => new Date()))().getTime()
  if (route.action === 'CREATE') {
    if (req.method !== 'POST') return respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
    const body = await readRequiredJson(req, res)
    if (!body) return
    let requestedProtocol: 1 | 2
    if (hasExactKeys(body, [])) requestedProtocol = 1
    else if (hasExactKeys(body, ['protocolVersion'])) {
      if (body.protocolVersion !== 2) return respond(res, 400, { error: 'INVALID_BOOKING_PROTOCOL_VERSION' })
      requestedProtocol = 2
    } else return respond(res, 400, { error: 'UNKNOWN_BOOKING_FIELD' })
    if (requestedProtocol < deps.config.bookingProtocol.minimumMutation) {
      return respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
    }
    const now = currentIso(deps)
    const requestId = deps.requestId?.() ?? `request-${randomUUID()}`
    const draftId = deps.draftId?.() ?? `draft-${randomUUID()}`
    const draft: MiniAppRequestRecord = {
      requestId, draftId, protocolVersion: requestedProtocol, staffId: authenticated.staffId,
      recorderName: requestedProtocol === 2 ? authenticated.displayName : '',
      adminId: requestedProtocol === 2 ? '' : authenticated.staffId,
      adminName: '', aeId: null,
      lineUserIdHash: createHmac('sha256', deps.config.signingSecret).update(authenticated.lineUserId).digest('base64url'),
      state: 'DRAFT', retentionState: '', version: 1, payloadHash: null,
      aeName: requestedProtocol === 2 ? 'ไม่ระบุ' : '', customerName: '', facebookName: '',
      phoneNormalized: '', doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null, appointmentTime: null,
      depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
      paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null, processingStartedAt: null,
      processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
      processingOwnerToken: null,
      evidenceProjectionHash: null,
      createdAt: now, confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null, updatedAt: now,
    }
    try {
      respond(res, 201, draftProjection(await deps.store.createDraft(draft)))
    } catch (error) {
      if (error instanceof Error && error.message === 'BOOKING_PROTOCOL_SCHEMA_MISMATCH') {
        respond(res, 409, { error: 'BOOKING_PROTOCOL_SCHEMA_MISMATCH' })
      } else respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    }
    return
  }

  if (route.action === 'GET' && req.method === 'PATCH') route = { action: 'PATCH', draftId: route.draftId }
  if (route.action === 'GET') {
    if (req.method !== 'GET') return respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
    const draft = await ownedDraft(route.draftId, authenticated.staffId, deps, res)
    if (draft) respond(res, 200, draftProjection(draft))
    return
  }
  if (req.method !== 'POST' && route.action !== 'PATCH') return respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
  if (route.action === 'PATCH' && req.method !== 'PATCH') return respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
  const body = await readRequiredJson(req, res)
  if (!body) return

  const mutation = parseBookingMutationEnvelope(route.action, body)
  if ('error' in mutation) return respond(res, mutation.status, { error: mutation.error })

  const confirmDraftReadStartedAt = route.action === 'CONFIRM' ? timingNow(deps) : null
  const draft = await ownedDraft(route.draftId, authenticated.staffId, deps, res)
  if (confirmDraftReadStartedAt !== null) {
    emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'draft_read', responseStatus(res, draft ? 200 : 503), confirmDraftReadStartedAt, draft?.state)
  }
  if (!draft) return
  const version = mutation.value.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return respond(res, 409, { error: 'STALE_DRAFT_VERSION' })
  const asyncOwner = Boolean(deps.config.asyncBooking?.ownerStaffIds.has(authenticated.staffId))
  if (mutation.value.protocolVersion !== draft.protocolVersion) {
    return respond(res, mutation.value.protocolVersion < deps.config.bookingProtocol.minimumMutation ? 409 : 400, {
      error: mutation.value.protocolVersion < deps.config.bookingProtocol.minimumMutation
        ? 'CLIENT_UPGRADE_REQUIRED'
        : 'BOOKING_PROTOCOL_MISMATCH',
    })
  }
  if (mutation.value.protocolVersion < deps.config.bookingProtocol.minimumMutation
    && !isProtocol1Recovery(route.action, draft, mutation.value, asyncOwner)) {
    return respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
  }
  if (route.action === 'PATCH' && deps.config.bookingProtocol.prepare && draft.protocolVersion === 2) {
    if (version < draft.version && matchesSavedDraftInput(draft, mutation.value.input)) {
      respond(res, 200, draftProjection(draft))
    } else {
      respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
    }
    return
  }
  if (
    route.action === 'CONFIRM'
    && version <= draft.version
    && asyncOwner
    && isBoundAsyncConfirmation(draft)
  ) {
    respond(res, 202, queuedAcknowledgement(draft))
    return
  }
  const retryingConfirmation = route.action === 'CONFIRM' && version < draft.version
    && (draft.state === 'FAILED_RETRYABLE' || draft.state === 'CONFIRMED' || confirmedWithRetryResult(draft) !== null)
  const recoveringOwnerConfirmation = route.action === 'CONFIRM' && !asyncOwner
    && deps.config.bookingProtocol.prepare && draft.protocolVersion === 2
    && draft.state === 'CONFIRMING' && version <= draft.version
    && draft.payloadHash === bookingPayloadHash(draft)
  if (version !== draft.version && !retryingConfirmation && !recoveringOwnerConfirmation) {
    if (
      route.action === 'CANCEL' && version < draft.version
      && draft.state === 'CANCELLED' && draft.retentionState === 'PENDING_APPROVAL'
    ) {
      respond(res, 200, draftProjection(draft))
      return
    }
    if (
      route.action === 'PATCH' && version < draft.version
      && matchesSavedDraftInput(draft, mutation.value.input)
    ) {
      respond(res, 200, draftProjection(draft))
      return
    }
    return respond(res, 409, { error: 'STALE_DRAFT_VERSION' })
  }

  if (route.action === 'PATCH') {
    let config
    try { config = await deps.store.getActiveBookingConfig() } catch { return respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' }) }
    try {
      const commonContext = {
        draftId: draft.draftId, staffId: draft.staffId, lineUserIdHash: draft.lineUserIdHash,
        paymentEvidenceFileIds: draft.paymentEvidenceFileIds, chatEvidenceFileIds: draft.chatEvidenceFileIds,
        paymentEvidenceObjectKeys: draft.paymentEvidenceObjectKeys, chatEvidenceObjectKeys: draft.chatEvidenceObjectKeys,
        asyncEvidence: Boolean(deps.config.asyncBooking?.ownerStaffIds.has(draft.staffId)),
        now: currentIso(deps),
      }
      const parsed = draft.protocolVersion === 2
        ? parseBookingDraftV2(mutation.value.input, {
          ...commonContext,
          recorderName: draft.recorderName || authenticated.displayName,
          doctors: config.doctors,
          services: config.services,
          channels: config.channels,
          admins: config.admins,
          aes: config.aes,
        })
        : parseBookingDraft(mutation.value.input, {
          ...commonContext,
          doctorIds: config.doctors.map(({ id }) => id), serviceIds: config.services.map(({ id }) => id),
          channelIds: config.channels.map(({ id }) => id), eligibleAeNames: ['ไม่ระบุ', ...config.aes.map(({ name }) => name)],
        })
      if (parsed.requestId !== draft.requestId) throw new Error('REQUEST_ID_MISMATCH')
      const updated = await deps.store.updateDraft(draft.draftId, draft.version, {
        state: 'READY_TO_CONFIRM', payloadHash: null,
        protocolVersion: parsed.protocolVersion, recorderName: parsed.recorderName,
        adminId: parsed.adminId, adminName: parsed.adminName, aeId: parsed.aeId, aeName: parsed.aeName,
        customerName: parsed.customerName,
        facebookName: parsed.facebookName, phoneNormalized: parsed.phoneNormalized, doctorId: parsed.doctorId,
        serviceId: parsed.serviceId, queueType: parsed.queueType, appointmentDate: parsed.appointmentDate,
        appointmentTime: parsed.appointmentTime, depositAmount: parsed.depositAmount, channelId: parsed.channelId,
        evidenceCount: parsed.evidenceCount, safeErrorCode: null, updatedAt: currentIso(deps),
      })
      respond(res, 200, draftProjection(updated))
    } catch (error) {
      respond(res, bookingErrorStatus(error), { error: safeBookingError(error) })
    }
    return
  }

  if (route.action === 'CANCEL') {
    if (!['DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'FAILED_RETRYABLE'].includes(draft.state)) {
      return respond(res, 409, { error: 'INVALID_DRAFT_TRANSITION' })
    }
    if (deps.config.bookingProtocol.prepare && draft.protocolVersion === 2) {
      await cancelP2Draft(draft, deps, res)
      return
    }
    try {
      const cancelled = await deps.store.updateDraft(draft.draftId, draft.version, {
        state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: currentIso(deps),
      })
      respond(res, 200, draftProjection(cancelled))
    } catch (error) {
      respond(res, bookingErrorStatus(error), { error: safeBookingError(error) })
    }
    return
  }

  if (draft.state === 'CONFIRMED' && draft.caseId && draft.confirmationStatus) {
    respond(res, 200, { caseId: draft.caseId, status: draft.confirmationStatus })
    return
  }
  const retryTerminal = confirmedWithRetryResult(draft)
  if (retryTerminal) {
    respond(res, 200, retryTerminal)
    return
  }
  const ownerFencedSync = !asyncOwner && deps.config.bookingProtocol.prepare && draft.protocolVersion === 2
  if (draft.state !== 'READY_TO_CONFIRM' && draft.state !== 'FAILED_RETRYABLE'
    && !(ownerFencedSync && draft.state === 'CONFIRMING')) {
    respond(res, 409, { error: 'DRAFT_NOT_READY' })
    return
  }
  if (!deps.ingress) {
    respond(res, 503, { error: 'BOOKING_INGRESS_NOT_CONFIGURED' })
    return
  }
  const payloadHash = bookingPayloadHash(draft)
  if (asyncOwner) {
    if (!deps.taskQueue || !deps.stateIngress) {
      respond(res, 503, { error: 'BOOKING_TASK_QUEUE_NOT_CONFIGURED' })
      return
    }
    const now = (deps.now ?? (() => new Date()))()
    const nowIso = now.toISOString()
    let task: Awaited<ReturnType<BookingTaskQueuePort['enqueue']>>
    const taskEnqueueStartedAt = timingNow(deps)
    try {
      task = await deps.taskQueue.enqueue({
        requestId: draft.requestId,
        draftId: draft.draftId,
        payloadHash,
        baseVersion: draft.version,
        scheduleAt: new Date(now.getTime() + 2_000),
      })
    } catch {
      emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'task_enqueue', 503, taskEnqueueStartedAt)
      respond(res, 503, { error: 'BOOKING_TASK_QUEUE_FAILED' })
      return
    }
    emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'task_enqueue', 202, taskEnqueueStartedAt, draft.state, draft.evidenceCount, draft.attemptCount)
    const queueMutation: MiniAppAsyncStateMutation = {
      operation: 'QUEUE', requestId: draft.requestId, draftId: draft.draftId, payloadHash,
      expectedVersion: draft.version, expectedAttempt: draft.attemptCount, taskAttempt: 1,
      leaseOwnerToken: null, nowIso, leaseUntil: null, taskName: task.taskName,
      paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys],
      chatEvidenceObjectKeys: [...draft.chatEvidenceObjectKeys],
      paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds],
      chatEvidenceFileIds: [...draft.chatEvidenceFileIds], evidenceCount: draft.evidenceCount,
      safeErrorCode: null, caseId: null, confirmationStatus: null,
    }
    const queueBinding = {
      requestId: draft.requestId,
      draftId: draft.draftId,
      payloadHash,
      taskName: task.taskName,
      baseVersion: draft.version,
      baseAttempt: draft.attemptCount,
    }
    let trustedProjection: SafeQueueProjection | null = null
    const stateIngressStartedAt = timingNow(deps)
    try {
      trustedProjection = validatedQueueFastPath(queueBinding, await deps.stateIngress.mutate(queueMutation))
      emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'state_ingress', 202, stateIngressStartedAt, trustedProjection?.state)
    } catch {
      emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'state_ingress', 503, stateIngressStartedAt)
      /* persisted reread below resolves response loss */
    }
    let persisted = trustedProjection ? applyQueueProjection(draft, trustedProjection, nowIso) : null
    if (!persisted) {
      const rereadStartedAt = timingNow(deps)
      try { persisted = await deps.store.getDraft(draft.draftId) } catch { persisted = null }
      if (!persisted || !validQueuedPersistence(draft, persisted, payloadHash, task.taskName)) persisted = null
      emitBookingPerformance(deps, 'confirm_completed', 'confirm', 'recovery_reread', persisted ? 200 : 503, rereadStartedAt, persisted?.state)
    }
    if (persisted) {
      const terminal = confirmedWithRetryResult(persisted)
      emitAsyncTelemetry(deps, 'booking_task_enqueued', {
        route: 'confirm', action: 'enqueue', status: 202,
        attempt: Math.max(1, persisted.attemptCount), state: persisted.state,
        fileCount: persisted.evidenceCount, elapsedMs: Math.max(0, (deps.now ?? (() => new Date()))().getTime() - handlerStartedAt),
      })
      if (persisted.state === 'CONFIRMED' && persisted.caseId && persisted.confirmationStatus) {
        respond(res, 200, { caseId: persisted.caseId, status: persisted.confirmationStatus })
      } else if (terminal) respond(res, 200, terminal)
      else if (persisted.state === 'CANCELLED' || persisted.state === 'EXPIRED') {
        respond(res, 409, { error: 'DRAFT_NOT_READY' })
      }
      else respond(res, 202, queuedAcknowledgement(persisted))
    } else respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }
  if (ownerFencedSync) {
    if (!deps.draftStateIngress) {
      respond(res, 503, { error: 'BOOKING_PREPARE_UNAVAILABLE' })
      return
    }
    await confirmOwnerFencedP2(draft, payloadHash, { ...deps, draftStateIngress: deps.draftStateIngress }, res)
    return
  }
  try {
    const claimed = await deps.store.claimConfirmation(draft.requestId, payloadHash)
    if (!claimed.claimed) {
      if (claimed.caseId && claimed.status) respond(res, 200, { caseId: claimed.caseId, status: claimed.status })
      else respond(res, 409, { error: 'BOOKING_CONFIRMATION_IN_PROGRESS' })
      return
    }
    const result = await deps.ingress.send(claimed.draft)
    await deps.store.completeConfirmation(draft.requestId, result.caseId, currentIso(deps), result.status)
    respond(res, 200, result)
  } catch (error) {
    const code = safeIngressError(error)
    try { await deps.store.failConfirmation(draft.requestId, code, currentIso(deps)) } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
      return
    }
    respond(res, code === 'BOOKING_INGRESS_TIMEOUT' ? 504 : 502, { error: code })
  }
}

async function confirmOwnerFencedP2(
  draft: MiniAppRequestRecord,
  payloadHash: string,
  deps: PmcMiniAppMiddlewareDependencies & { draftStateIngress: DraftStateIngressPort },
  res: ServerResponse,
): Promise<void> {
  const claim = draft.state === 'CONFIRMING'
    ? validConfirmingDraft(draft, payloadHash) ? draft : null
    : await claimOwnerConfirmation(draft, payloadHash, deps)
  if (!claim) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }
  if (claim.state === 'CONFIRMED' && claim.caseId && claim.confirmationStatus) {
    respond(res, 200, { caseId: claim.caseId, status: claim.confirmationStatus })
    return
  }
  if (claim.state === 'CANCELLED' || claim.state === 'EXPIRED') {
    respond(res, 409, { error: 'DRAFT_NOT_READY' })
    return
  }
  if (claim.state !== 'CONFIRMING') {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }

  let bookingResult: Awaited<ReturnType<NonNullable<PmcMiniAppMiddlewareDependencies['ingress']>['send']>>
  try {
    bookingResult = await deps.ingress!.send(claim)
  } catch (error) {
    const code = safeIngressError(error)
    const failure = await failOwnerConfirmation(claim, payloadHash, code, deps)
    if (failure?.state === 'CONFIRMED' && failure.caseId && failure.confirmationStatus) {
      respond(res, 200, { caseId: failure.caseId, status: failure.confirmationStatus })
      return
    }
    if (!failure || failure.state !== 'FAILED_RETRYABLE' || failure.safeErrorCode !== code) {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
      return
    }
    respond(res, code === 'BOOKING_INGRESS_TIMEOUT' ? 504 : 502, { error: code })
    return
  }

  const completed = await completeOwnerConfirmation(claim, payloadHash, bookingResult, deps)
  if (completed?.state === 'CONFIRMED' && completed.caseId === bookingResult.caseId
    && completed.confirmationStatus === bookingResult.status) {
    respond(res, 200, bookingResult)
    return
  }
  respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
}

async function claimOwnerConfirmation(
  draft: MiniAppRequestRecord,
  payloadHash: string,
  deps: PmcMiniAppMiddlewareDependencies & { draftStateIngress: DraftStateIngressPort },
): Promise<MiniAppRequestRecord | null> {
  const nowIso = currentIso(deps)
  const mutation: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_CLAIM' }> = {
    operation: 'CONFIRM_CLAIM', requestId: draft.requestId, draftId: draft.draftId,
    expectedVersion: draft.version, expectedAttempt: draft.attemptCount, nowIso, payloadHash,
  }
  const expected: MiniAppRequestRecord = {
    ...structuredClone(draft), state: 'CONFIRMING', payloadHash, safeErrorCode: null,
    updatedAt: nowIso, version: draft.version + 1,
  }
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    if (trustedOwnerResult(result, expected)) return expected
  } catch { /* exactly one authoritative reread below */ }

  const reread = await readOwnerDraft(draft, deps)
  if (!reread) return null
  if (validClaimRecovery(draft, reread, expected, payloadHash)) return reread
  if (validConfirmedDraft(reread, payloadHash) || reread.state === 'CANCELLED' || reread.state === 'EXPIRED') return reread
  if (projectionDigest(reread) !== projectionDigest(draft)) return null
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    return trustedOwnerResult(result, expected) ? expected : null
  } catch { return null }
}

function validClaimRecovery(
  base: MiniAppRequestRecord,
  reread: MiniAppRequestRecord,
  expected: MiniAppRequestRecord,
  payloadHash: string,
): boolean {
  return validConfirmingDraft(reread, payloadHash)
    && reread.version === base.version + 1
    && reread.attemptCount === base.attemptCount
    && projectionDigest(reread) === projectionDigest(expected)
}

async function completeOwnerConfirmation(
  claimed: MiniAppRequestRecord,
  payloadHash: string,
  bookingResult: { caseId: string; status: NonNullable<MiniAppRequestRecord['confirmationStatus']> },
  deps: PmcMiniAppMiddlewareDependencies & { draftStateIngress: DraftStateIngressPort },
): Promise<MiniAppRequestRecord | null> {
  const nowIso = currentIso(deps)
  const mutation: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_COMPLETE' }> = {
    operation: 'CONFIRM_COMPLETE', requestId: claimed.requestId, draftId: claimed.draftId,
    expectedVersion: claimed.version, expectedAttempt: claimed.attemptCount, nowIso, payloadHash,
    caseId: bookingResult.caseId, confirmationStatus: bookingResult.status,
  }
  const expected: MiniAppRequestRecord = {
    ...structuredClone(claimed), state: 'CONFIRMED', caseId: bookingResult.caseId,
    confirmationStatus: bookingResult.status, confirmedAt: nowIso, safeErrorCode: null,
    updatedAt: nowIso, version: claimed.version + 1,
  }
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    if (trustedOwnerResult(result, expected)) return expected
  } catch { /* exactly one authoritative reread below */ }

  const reread = await readOwnerDraft(claimed, deps)
  if (!reread) return null
  if (validCompletedDraft(reread, payloadHash, bookingResult)) return reread
  if (!validConfirmingDraft(reread, payloadHash) || projectionDigest(reread) !== projectionDigest(claimed)) return null
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    return trustedOwnerResult(result, expected) ? expected : null
  } catch { return null }
}

async function failOwnerConfirmation(
  claimed: MiniAppRequestRecord,
  payloadHash: string,
  safeErrorCode: string,
  deps: PmcMiniAppMiddlewareDependencies & { draftStateIngress: DraftStateIngressPort },
): Promise<MiniAppRequestRecord | null> {
  const nowIso = currentIso(deps)
  const mutation: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_FAIL' }> = {
    operation: 'CONFIRM_FAIL', requestId: claimed.requestId, draftId: claimed.draftId,
    expectedVersion: claimed.version, expectedAttempt: claimed.attemptCount, nowIso, payloadHash, safeErrorCode,
  }
  const expected: MiniAppRequestRecord = {
    ...structuredClone(claimed), state: 'FAILED_RETRYABLE', safeErrorCode,
    updatedAt: nowIso, version: claimed.version + 1,
  }
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    if (trustedOwnerResult(result, expected)) return expected
  } catch { /* exactly one authoritative reread below */ }

  const reread = await readOwnerDraft(claimed, deps)
  if (!reread) return null
  if (reread.state === 'FAILED_RETRYABLE' && reread.payloadHash === payloadHash
    && reread.safeErrorCode === safeErrorCode) return reread
  if (validConfirmedDraft(reread, payloadHash)) return reread
  if (!validConfirmingDraft(reread, payloadHash) || projectionDigest(reread) !== projectionDigest(claimed)) return null
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    return trustedOwnerResult(result, expected) ? expected : null
  } catch { return null }
}

function trustedOwnerResult(result: MiniAppDraftStateResult, expected: MiniAppRequestRecord): boolean {
  return result.requestId === expected.requestId && result.draftId === expected.draftId
    && result.state === expected.state && result.version === expected.version
    && result.projectionDigest === projectionDigest(expected)
    && (result.outcome === 'APPLIED' || result.outcome === 'IDEMPOTENT')
}

async function readOwnerDraft(
  expectedOwner: MiniAppRequestRecord,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<MiniAppRequestRecord | null> {
  try {
    const reread = await deps.store.getDraft(expectedOwner.draftId)
    return reread?.staffId === expectedOwner.staffId && reread.requestId === expectedOwner.requestId ? reread : null
  } catch { return null }
}

function validConfirmingDraft(draft: MiniAppRequestRecord, payloadHash: string): boolean {
  return draft.protocolVersion === 2 && draft.state === 'CONFIRMING'
    && draft.payloadHash === payloadHash && bookingPayloadHash(draft) === payloadHash
}

function validConfirmedDraft(draft: MiniAppRequestRecord, payloadHash: string): boolean {
  return draft.state === 'CONFIRMED' && draft.payloadHash === payloadHash && bookingPayloadHash(draft) === payloadHash
    && /^PMC-\d{6}-\d{4,}$/.test(draft.caseId ?? '') && isConfirmationStatus(draft.confirmationStatus)
}

function validCompletedDraft(
  draft: MiniAppRequestRecord,
  payloadHash: string,
  bookingResult: { caseId: string; status: NonNullable<MiniAppRequestRecord['confirmationStatus']> },
): boolean {
  return validConfirmedDraft(draft, payloadHash)
    && draft.caseId === bookingResult.caseId && draft.confirmationStatus === bookingResult.status
}

function isBoundAsyncConfirmation(draft: MiniAppRequestRecord): boolean {
  return (draft.state === 'QUEUED' || draft.state === 'PROCESSING' || draft.state === 'RETRYING')
    && typeof draft.payloadHash === 'string'
    && /^[A-Za-z0-9_-]{4,128}$/.test(draft.payloadHash)
    && (typeof draft.taskName === 'string' && /^[A-Za-z0-9._:/-]{1,512}$/.test(draft.taskName)
      || draft.taskName === null && draft.state !== 'QUEUED')
}

function validQueuedPersistence(
  before: MiniAppRequestRecord,
  persisted: MiniAppRequestRecord,
  payloadHash: string,
  taskName: string,
): boolean {
  return persisted.requestId === before.requestId && persisted.draftId === before.draftId
    && persisted.payloadHash === payloadHash && bookingPayloadHash(persisted) === payloadHash
    && persisted.protocolVersion === before.protocolVersion
    && persisted.staffId === before.staffId && persisted.recorderName === before.recorderName
    && persisted.adminId === before.adminId && persisted.adminName === before.adminName
    && persisted.aeId === before.aeId && persisted.aeName === before.aeName
    && persisted.customerName === before.customerName && persisted.facebookName === before.facebookName
    && persisted.phoneNormalized === before.phoneNormalized && persisted.doctorId === before.doctorId
    && persisted.serviceId === before.serviceId && persisted.queueType === before.queueType
    && persisted.appointmentDate === before.appointmentDate && persisted.appointmentTime === before.appointmentTime
    && persisted.depositAmount === before.depositAmount && persisted.channelId === before.channelId
    && sameStringArray(persisted.paymentEvidenceObjectKeys, before.paymentEvidenceObjectKeys)
    && sameStringArray(persisted.chatEvidenceObjectKeys, before.chatEvidenceObjectKeys)
    && persisted.taskName === taskName
    && (
      ['QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMED', 'NEEDS_REVIEW'].includes(persisted.state)
      || confirmedWithRetryResult(persisted) !== null
    )
}

function applyQueueProjection(
  draft: MiniAppRequestRecord,
  projection: SafeQueueProjection,
  queuedAt: string,
): MiniAppRequestRecord {
  return {
    ...structuredClone(draft),
    state: projection.state,
    version: projection.version,
    attemptCount: projection.attemptCount,
    payloadHash: projection.payloadHash,
    taskName: projection.taskName,
    queuedAt: draft.queuedAt ?? queuedAt,
    caseId: projection.caseId,
    confirmationStatus: projection.confirmationStatus,
    safeErrorCode: draft.safeErrorCode,
    retentionState: draft.retentionState,
    updatedAt: queuedAt,
  }
}

function confirmedWithRetryResult(draft: MiniAppRequestRecord): { caseId: string; status: NonNullable<MiniAppRequestRecord['confirmationStatus']> } | null {
  if (draft.state !== 'CONFIRMED_WITH_RETRY'
    || !/^PMC-\d{6}-\d{4,}$/.test(draft.caseId ?? '')
    || !isConfirmationStatus(draft.confirmationStatus)
    || draft.safeErrorCode !== 'DOWNSTREAM_RETRY') return null
  return { caseId: draft.caseId!, status: draft.confirmationStatus }
}

function isConfirmationStatus(value: unknown): value is NonNullable<MiniAppRequestRecord['confirmationStatus']> {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function ownedDraft(
  draftId: string,
  staffId: string,
  deps: PmcMiniAppMiddlewareDependencies,
  res: ServerResponse,
): Promise<MiniAppRequestRecord | null> {
  try {
    const draft = await deps.store.getDraft(draftId)
    if (!draft || draft.staffId !== staffId) {
      respond(res, 404, { error: 'DRAFT_NOT_FOUND' })
      return null
    }
    return draft
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return null
  }
}

function draftProjection(draft: MiniAppRequestRecord): Record<string, unknown> {
  const hasInput = Boolean(draft.customerName && draft.phoneNormalized && draft.doctorId && draft.serviceId && draft.channelId)
  return {
    draftId: draft.draftId,
    requestId: draft.requestId,
    state: draft.state,
    retentionState: draft.retentionState,
    version: draft.version,
    input: hasInput ? {
      requestId: draft.requestId,
      ...(draft.protocolVersion === 2 ? { adminId: draft.adminId, aeId: draft.aeId } : { aeName: draft.aeName }),
      customerName: draft.customerName, facebookName: draft.facebookName,
      phone: draft.phoneNormalized, doctorId: draft.doctorId, serviceId: draft.serviceId, queueType: draft.queueType,
      appointmentDate: draft.appointmentDate, appointmentTime: draft.appointmentTime, depositAmount: draft.depositAmount,
      channelId: draft.channelId,
    } : null,
    ...(draft.protocolVersion === 2 && hasInput ? {
      attribution: {
        protocolVersion: 2,
        recorder: { id: draft.staffId, name: draft.recorderName },
        admin: { id: draft.adminId, name: draft.adminName },
        ae: draft.aeId === null ? null : { id: draft.aeId, name: draft.aeName },
      },
    } : {}),
    paymentEvidenceIds: [...draft.paymentEvidenceFileIds],
    chatEvidenceIds: [...draft.chatEvidenceFileIds],
    ...evidenceCounts(draft),
    confirmationStatus: draft.confirmationStatus,
    caseId: draft.caseId,
    safeErrorCode: draft.safeErrorCode,
    queuedAt: draft.queuedAt,
    lastProgressAt: draft.lastProgressAt,
  }
}

function safeActiveDraftProjection(draft: MiniAppRequestRecord): Record<string, unknown> {
  return {
    draftId: draft.draftId,
    requestId: draft.requestId,
    state: draft.state,
    retentionState: draft.retentionState,
    version: draft.version,
    input: null,
    paymentEvidenceIds: [],
    chatEvidenceIds: [],
    ...evidenceCounts(draft),
    confirmationStatus: draft.confirmationStatus,
    caseId: draft.caseId,
    safeErrorCode: draft.safeErrorCode,
    queuedAt: draft.queuedAt,
    lastProgressAt: draft.lastProgressAt,
  }
}

function evidenceCounts(draft: MiniAppRequestRecord): { paymentEvidenceCount: number; chatEvidenceCount: number } {
  return {
    paymentEvidenceCount: Math.max(draft.paymentEvidenceFileIds.length, draft.paymentEvidenceObjectKeys.length),
    chatEvidenceCount: Math.max(draft.chatEvidenceFileIds.length, draft.chatEvidenceObjectKeys.length),
  }
}

function queuedAcknowledgement(draft: MiniAppRequestRecord): Record<string, unknown> {
  return {
    requestId: draft.requestId,
    status: 'QUEUED',
    projection: safeActiveDraftProjection(draft),
  }
}

async function readRequiredJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    respond(res, 415, { error: 'MINI_APP_JSON_REQUIRED' })
    return null
  }
  const advertised = Number(req.headers['content-length'])
  if (Number.isFinite(advertised) && advertised > 64 * 1024) {
    respond(res, 413, { error: 'MINI_APP_PAYLOAD_TOO_LARGE' })
    return null
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 64 * 1024) {
        respond(res, 413, { error: 'MINI_APP_PAYLOAD_TOO_LARGE' })
        return null
      }
      chunks.push(bytes)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch {
    respond(res, 400, { error: 'MINI_APP_INVALID_JSON' })
    return null
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function matchesSavedDraftInput(draft: MiniAppRequestRecord, candidate: unknown): boolean {
  if (draft.state !== 'READY_TO_CONFIRM' || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const input = candidate as Record<string, unknown>
  const expected: Record<string, unknown> = {
    requestId: draft.requestId,
    ...(draft.protocolVersion === 2 ? { adminId: draft.adminId, aeId: draft.aeId } : { aeName: draft.aeName }),
    customerName: draft.customerName,
    facebookName: draft.facebookName,
    phone: draft.phoneNormalized,
    doctorId: draft.doctorId,
    serviceId: draft.serviceId,
    queueType: draft.queueType,
    appointmentDate: draft.appointmentDate,
    appointmentTime: draft.appointmentTime,
    depositAmount: draft.depositAmount,
    channelId: draft.channelId,
  }
  return hasExactKeys(input, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => input[key] === value)
}

function currentIso(deps: PmcMiniAppMiddlewareDependencies): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

function emitAsyncTelemetry(
  deps: PmcMiniAppMiddlewareDependencies,
  name: Parameters<AsyncBookingTelemetry>[0],
  fields: Parameters<AsyncBookingTelemetry>[1],
): void {
  try { deps.asyncTelemetry?.(name, fields) } catch { /* observability cannot alter the request outcome */ }
}

function emitBookingPerformance(
  deps: PmcMiniAppMiddlewareDependencies,
  name: BookingTimingEventName,
  route: BookingTimingRoute,
  action: BookingTimingAction,
  status: number,
  startedAt: number,
  state?: string,
  fileCount?: number,
  attempt?: number,
): void {
  try {
    deps.bookingPerformanceTelemetry?.(name, {
      route,
      action,
      status,
      ...(state ? { state } : {}),
      ...(fileCount === undefined ? {} : { fileCount }),
      ...(attempt === undefined ? {} : { attempt: Math.min(8, Math.max(0, attempt)) }),
      elapsedMs: timingElapsed(deps, startedAt),
    })
  } catch { /* observability cannot alter the request outcome */ }
}

function timingNow(deps: PmcMiniAppMiddlewareDependencies): number {
  try {
    const value = (deps.performanceNow ?? (() => globalThis.performance.now()))()
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

function timingElapsed(deps: PmcMiniAppMiddlewareDependencies, startedAt: number): number {
  const elapsed = timingNow(deps) - startedAt
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(elapsed, 86_400_000) : 0
}

function responseStatus(res: ServerResponse, fallback: number): number {
  return Number.isSafeInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : fallback
}

function safeBookingError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'INVALID_BOOKING_INPUT'
}

function bookingErrorStatus(error: unknown): number {
  const code = safeBookingError(error)
  if (code === 'STALE_DRAFT_VERSION' || code === 'PAYLOAD_HASH_CONFLICT' || code === 'INVALID_DRAFT_TRANSITION') return 409
  if (code === 'DRAFT_NOT_FOUND') return 404
  return 400
}

function safeIngressError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /^BOOKING_INGRESS_[A-Z_]{1,60}$/.test(code) ? code : 'BOOKING_INGRESS_FAILED'
}

async function handleBookingPrepare(
  req: IncomingMessage,
  res: ServerResponse,
  draftId: string,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  if (deps.config.bookingProtocol.minimumMutation !== 2 || !deps.draftStateIngress) {
    respond(res, 503, { error: 'BOOKING_PREPARE_UNAVAILABLE' })
    return
  }
  const draftReadStartedAt = timingNow(deps)
  const draft = await ownedDraft(draftId, authenticated.staffId, deps, res)
  emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'draft_read', responseStatus(res, draft ? 200 : 503), draftReadStartedAt, draft?.state)
  if (!draft) return
  if (draft.protocolVersion !== 2) {
    respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
    return
  }
  const asyncOwner = Boolean(deps.config.asyncBooking?.ownerStaffIds.has(draft.staffId))
  const persistence = asyncOwner
    ? deps.evidenceStaging ? { type: 'ASYNC' as const, staging: deps.evidenceStaging } : null
    : deps.evidenceIngress ? { type: 'SYNC' as const, ingress: deps.evidenceIngress } : null
  if (!persistence) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }

  const hasBinding = draft.evidenceProjectionHash !== null
  const reserved = hasBinding && hasReservedPrepareAttribution(draft)
  if (hasBinding && !reserved) {
    respond(res, 409, { error: 'BOOKING_PREPARE_CONFLICT' })
    return
  }
  let bookingContext: PersistPrepareEvidenceInput['bookingContext']
  if (!reserved) {
    let bookingConfig: Awaited<ReturnType<MiniAppStore['getActiveBookingConfig']>>
    const configStartedAt = timingNow(deps)
    try {
      bookingConfig = await deps.store.getActiveBookingConfig()
    } catch {
      emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'config_snapshot', 503, configStartedAt)
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
      return
    }
    emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'config_snapshot', 200, configStartedAt)
    bookingContext = {
      doctors: bookingConfig.doctors,
      services: bookingConfig.services,
      channels: bookingConfig.channels,
      admins: bookingConfig.admins ?? bookingConfig.aes,
      aes: bookingConfig.aes,
    }
  }

  let parsed: Awaited<ReturnType<typeof consumeBookingPrepareMultipart>>
  const multipartStartedAt = timingNow(deps)
  try {
    parsed = await consumeBookingPrepareMultipart(req, BOOKING_PREPARE_LIMITS)
  } catch (error) {
    const code = error instanceof MiniAppEvidenceError ? error.code : 'BOOKING_PREPARE_JSON_REQUIRED'
    emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'multipart_parse', evidenceStatus(code), multipartStartedAt)
    respond(res, evidenceStatus(code), { error: code })
    return
  }
  const fileCount = parsed.paymentFiles.length + parsed.chatFiles.length
  emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'multipart_parse', 200, multipartStartedAt, draft.state, fileCount, draft.attemptCount)

  const persistStartedAt = timingNow(deps)
  try {
    const prepared = await persistPrepareEvidence({
      draft,
      version: parsed.version,
      input: parsed.input,
      paymentFiles: parsed.paymentFiles,
      chatFiles: parsed.chatFiles,
      bookingContext,
      persistence,
      store: deps.store,
      draftStateIngress: deps.draftStateIngress,
      now: () => currentIso(deps),
    })
    emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'persist', 200, persistStartedAt, prepared.draft.state, fileCount, prepared.draft.attemptCount)
    respond(res, 200, draftProjection(prepared.draft))
  } catch (error) {
    if (error instanceof BookingPreparePersistenceError) {
      const status = error.code === 'BOOKING_PREPARE_CONFLICT' ? 409 : 503
      emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'persist', status, persistStartedAt, undefined, fileCount, draft.attemptCount)
      respond(res, status, { error: error.code })
      return
    }
    const code = safeBookingError(error)
    const status = bookingErrorStatus(error)
    emitBookingPerformance(deps, 'prepare_completed', 'prepare', 'persist', status, persistStartedAt, undefined, fileCount, draft.attemptCount)
    respond(res, status, { error: code })
  }
}

function hasReservedPrepareAttribution(draft: MiniAppRequestRecord): boolean {
  return Boolean(draft.recorderName && draft.adminId && draft.adminName)
    && (draft.aeId === null ? draft.aeName === 'ไม่ระบุ' : Boolean(draft.aeName))
}

async function cancelP2Draft(
  draft: MiniAppRequestRecord,
  deps: PmcMiniAppMiddlewareDependencies,
  res: ServerResponse,
): Promise<void> {
  if (!deps.draftStateIngress) {
    respond(res, 503, { error: 'BOOKING_PREPARE_UNAVAILABLE' })
    return
  }
  const nowIso = currentIso(deps)
  const mutation = {
    operation: 'CANCEL' as const,
    requestId: draft.requestId,
    draftId: draft.draftId,
    expectedVersion: draft.version,
    expectedAttempt: draft.attemptCount,
    nowIso,
  }
  const expected: MiniAppRequestRecord = {
    ...structuredClone(draft),
    state: 'CANCELLED',
    retentionState: 'PENDING_APPROVAL',
    updatedAt: nowIso,
    version: draft.version + 1,
  }
  const trusted = (result: MiniAppDraftStateResult): boolean => result.requestId === expected.requestId
    && result.draftId === expected.draftId && result.state === expected.state && result.version === expected.version
    && result.projectionDigest === projectionDigest(expected)
    && (result.outcome === 'APPLIED' || result.outcome === 'IDEMPOTENT')
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    if (trusted(result)) {
      respond(res, 200, draftProjection(expected))
      return
    }
  } catch { /* authoritative recovery below */ }

  let reread: MiniAppRequestRecord | null
  try { reread = await deps.store.getDraft(draft.draftId) } catch { reread = null }
  if (!reread || reread.staffId !== draft.staffId) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }
  if (reread.state === 'CANCELLED' && reread.retentionState === 'PENDING_APPROVAL') {
    respond(res, 200, draftProjection(reread))
    return
  }
  if (projectionDigest(reread) !== projectionDigest(draft)) {
    respond(res, 409, { error: 'STALE_DRAFT_VERSION' })
    return
  }
  try {
    const result = await deps.draftStateIngress.mutate(mutation)
    if (trusted(result)) {
      respond(res, 200, draftProjection(expected))
      return
    }
  } catch { /* no uncertain acknowledgement */ }
  respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
}

async function handleEvidenceBatchUpload(
  req: IncomingMessage,
  res: ServerResponse,
  draftId: string,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  const handlerStartedAt = (deps.now ?? (() => new Date()))().getTime()
  const draft = await ownedDraft(draftId, authenticated.staffId, deps, res)
  if (!draft) return
  if (deps.config.bookingProtocol.prepare && draft.protocolVersion === 2) {
    respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
    return
  }
  const asyncConfig = deps.config.asyncBooking
  if (!asyncConfig || !asyncConfig.ownerStaffIds.has(authenticated.staffId)) {
    respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
    return
  }
  if (!deps.evidenceStaging) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }

  if (draft.protocolVersion < deps.config.bookingProtocol.minimumMutation) {
    respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
    return
  }
  if (draft.state !== 'DRAFT') {
    respond(res, 409, { error: 'DRAFT_NOT_UPLOADABLE' })
    return
  }

  try {
    const batch = await consumeEvidenceBatchMultipart(req, {
      maxFilesPerKind: deps.config.maxFilesPerKind,
      maxFileBytes: deps.config.maxImageBytes,
      maxTotalBytes: asyncConfig.maxBatchBytes,
    })
    emitAsyncTelemetry(deps, 'evidence_stage_started', {
      route: 'evidence', action: 'stage', status: 102,
      fileCount: batch.paymentFiles.length + batch.chatFiles.length,
    })
    const staged = await stageEvidenceBatch(draft.draftId, batch, deps.evidenceStaging)
    const updated = await deps.store.updateDraft(draft.draftId, draft.version, {
      state: 'DRAFT',
      paymentEvidenceObjectKeys: staged.paymentObjectKeys,
      chatEvidenceObjectKeys: staged.chatObjectKeys,
      evidenceCount: staged.paymentObjectKeys.length + staged.chatObjectKeys.length,
      updatedAt: currentIso(deps),
    })
    emitAsyncTelemetry(deps, 'evidence_stage_completed', {
      route: 'evidence', action: 'stage', status: 200, state: updated.state,
      fileCount: staged.paymentObjectKeys.length + staged.chatObjectKeys.length,
      elapsedMs: Math.max(0, (deps.now ?? (() => new Date()))().getTime() - handlerStartedAt),
    })
    respond(res, 200, draftProjection(updated))
  } catch (error) {
    const code = error instanceof MiniAppEvidenceError ? error.code : safeBookingError(error) === 'STALE_DRAFT_VERSION'
      ? 'STALE_DRAFT_VERSION'
      : 'EVIDENCE_UPLOAD_FAILED'
    respond(res, code === 'STALE_DRAFT_VERSION' ? 409 : evidenceStatus(code), { error: code })
  }
}

async function stageEvidenceBatch(
  draftId: string,
  batch: EvidenceBatch,
  staging: EvidenceStagingPort,
): Promise<{ paymentObjectKeys: string[]; chatObjectKeys: string[] }> {
  const paymentObjectKeys = Array<string>(batch.paymentFiles.length)
  const chatObjectKeys = Array<string>(batch.chatFiles.length)
  const items = [
    ...batch.paymentFiles.map((file, index) => ({ file, index, kind: 'PAYMENT' as const })),
    ...batch.chatFiles.map((file, index) => ({ file, index, kind: 'CHAT' as const })),
  ]
  let nextIndex = 0
  let firstFailure: unknown

  const worker = async () => {
    while (firstFailure === undefined) {
      const itemIndex = nextIndex
      nextIndex += 1
      const item = items[itemIndex]
      if (!item) return
      try {
        const mimeType = validateEvidence(item.file.bytes, item.file.advertisedMime)
        const staged = await staging.put({ draftId, kind: item.kind, mimeType, bytes: item.file.bytes })
        if (item.kind === 'PAYMENT') paymentObjectKeys[item.index] = staged.objectKey
        else chatObjectKeys[item.index] = staged.objectKey
      } catch (error) {
        firstFailure ??= error
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker))
  if (firstFailure !== undefined) throw firstFailure
  return { paymentObjectKeys, chatObjectKeys }
}

async function handleEvidenceUpload(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  draftId: string,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
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
    if (draft.protocolVersion < deps.config.bookingProtocol.minimumMutation) {
      respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
      return
    }
    if (deps.config.bookingProtocol.prepare && draft.protocolVersion === 2) {
      respond(res, 409, { error: 'CLIENT_UPGRADE_REQUIRED' })
      return
    }
    if (!deps.drive && !deps.evidenceIngress) {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
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

  try {
    await consumeEvidenceMultipart(req, {
      maxFiles: deps.config.maxFilesPerKind,
      maxFileBytes: deps.config.maxImageBytes,
    }, async (file) => {
      const existing = evidenceIdsFor(current, kind)
      if (existing.length >= deps.config.maxFilesPerKind) throw new MiniAppEvidenceError(`${kind}_EVIDENCE_LIMIT`)
      const mimeType = validateEvidence(file.bytes, file.advertisedMime)
      const fileId = deps.evidenceIngress
        ? await deps.evidenceIngress.upload({
          draftId: current.draftId,
          requestId: current.requestId,
          kind,
          mimeType,
          bytes: file.bytes,
        })
        : await deps.drive!.uploadEvidence({
          parentId: deps.config.intakeFolderId,
          draftId: current.draftId,
          requestId: current.requestId,
          kind,
          name: serverEvidenceName(kind, mimeType, (deps.randomId ?? randomUUID)()),
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
    })
    current = await deps.store.updateDraft(current.draftId, current.version, {
      state: 'DRAFT',
      updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    })
    respond(res, 200, draftProjection(current))
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
  if (code === 'EVIDENCE_TOO_LARGE' || code === 'EVIDENCE_BATCH_TOO_LARGE') return 413
  if (code.endsWith('_EVIDENCE_LIMIT') || code === 'EVIDENCE_FILE_LIMIT') return 409
  if (code === 'EVIDENCE_UPLOAD_FAILED') return 503
  return 400
}

async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
  timing?: { name: BookingTimingEventName; route: BookingTimingRoute },
): Promise<AuthenticatedMiniAppContext | null> {
  const lineVerifyStartedAt = timing ? timingNow(deps) : null
  const lineUserId = await authenticateLineIdentity(req, res, deps)
  if (timing && lineVerifyStartedAt !== null) {
    emitBookingPerformance(deps, timing.name, timing.route, 'line_verify', responseStatus(res, lineUserId ? 200 : 503), lineVerifyStartedAt)
  }
  if (!lineUserId) return null

  const staffSnapshotStartedAt = timing ? timingNow(deps) : null
  try {
    const staff = await deps.store.getActiveStaffByLineUserId(lineUserId)
    if (!staff) {
      respond(res, 403, { error: 'STAFF_NOT_ALLOWED' })
      if (timing && staffSnapshotStartedAt !== null) {
        emitBookingPerformance(deps, timing.name, timing.route, 'staff_snapshot', 403, staffSnapshotStartedAt)
      }
      return null
    }
    if (timing && staffSnapshotStartedAt !== null) {
      emitBookingPerformance(deps, timing.name, timing.route, 'staff_snapshot', 200, staffSnapshotStartedAt)
    }
    return {
      staffId: staff.id,
      displayName: staff.name,
      lineUserId,
      canCloseBooking: staff.canCloseBooking === true,
      canManageStock: staff.canManageStock === true,
      canSubmitExpense: staff.canSubmitExpense === true,
      canViewFinance: staff.canViewFinance === true,
      canManageExpense: staff.canManageExpense === true,
    }
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    if (timing && staffSnapshotStartedAt !== null) {
      emitBookingPerformance(deps, timing.name, timing.route, 'staff_snapshot', 503, staffSnapshotStartedAt)
    }
    return null
  }
}

function requireBookingRecorder(authenticated: AuthenticatedMiniAppContext, res: ServerResponse): boolean {
  if (authenticated.canCloseBooking) return true
  respond(res, 403, { error: 'STAFF_NOT_ALLOWED' })
  return false
}

async function authenticateLineIdentity(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<string | null> {
  const idToken = bearerToken(req.headers.authorization)
  if (!idToken) {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
    return null
  }

  try {
    return (await deps.identity.verify(idToken)).lineUserId
  } catch {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
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

function respond(res: ServerResponse, status: number, body: Record<string, unknown> | null): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
