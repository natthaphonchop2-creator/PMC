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
import { bookingPayloadHash, parseBookingDraft } from './bookingDraft.js'
import { consumeEvidenceMultipart, MiniAppEvidenceError, serverEvidenceName, validateEvidence } from './evidence.js'
import { consumeEvidenceBatchMultipart, type EvidenceBatch } from './evidenceBatch.js'
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
import { isExpenseRecoveryCounts } from '../../shared/pmcMiniAppExpenseIngress.js'
import type { AsyncBookingTelemetry } from './asyncTelemetry.js'
import { handleStockMiniAppApi, isStockMiniAppApiPath } from './stock/middleware.js'
import { handleFinanceMiniAppApi, isFinanceMiniAppApiPath } from './finance/middleware.js'

const ASYNC_WORKER_PATH = '/internal/mini-app/finalize-booking'
const EXPENSE_RECOVERY_PATH = '/internal/mini-app/recover-expenses'
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
  expenseRecoveryIdentity?: WorkerIdentityVerifier
  asyncWorker?: AsyncBookingWorker
  stateIngress?: AsyncStateIngressPort
  asyncTelemetry?: AsyncBookingTelemetry
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
    if (req.url === EXPENSE_RECOVERY_PATH) {
      await handleExpenseRecoveryRoute(req, res, deps)
      return
    }
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

    const evidenceBatchRoute = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})\/evidence-batch$/.exec(pathname)
    if (evidenceBatchRoute) {
      if (req.method !== 'POST') {
        respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
        return
      }
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      await handleEvidenceBatchUpload(req, res, evidenceBatchRoute[1]!, authenticated, deps)
      return
    }

    if (pathname === '/api/mini-app/booking-drafts/active') {
      if (!requireGet(req, res)) return
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      if (!deps.config.asyncBooking || !deps.config.asyncBooking.ownerStaffIds.has(authenticated.staffId)) {
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
      await handleEvidenceUpload(req, res, url, evidenceRoute[1]!, authenticated, deps)
      return
    }

    const bookingRoute = bookingDraftRoute(pathname)
    if (bookingRoute) {
      const authenticated = await authenticate(req, res, deps)
      if (!authenticated) return
      await handleBookingDraftRoute(req, res, bookingRoute, authenticated, deps)
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
        aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, ...bookingConfig.aes.filter(({ id }) => id !== 'NONE')],
      })
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    }
  }
}

async function handleExpenseRecoveryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
    return
  }
  if (!deps.expenseRecoveryIdentity) {
    respond(res, 503, { error: 'EXPENSE_RECOVERY_UNAVAILABLE' })
    return
  }
  const token = extractWorkerBearerToken(req.headers.authorization)
  if (!token) {
    respond(res, 401, { error: 'EXPENSE_RECOVERY_UNAUTHORIZED' })
    return
  }
  let worker: Awaited<ReturnType<WorkerIdentityVerifier['verify']>>
  try {
    worker = await deps.expenseRecoveryIdentity.verify(token)
  } catch {
    respond(res, 401, { error: 'EXPENSE_RECOVERY_UNAUTHORIZED' })
    return
  }
  if (hasFramedRecoveryBody(req)) {
    req.resume()
    res.setHeader('connection', 'close')
    respond(res, 400, { error: 'EXPENSE_RECOVERY_INVALID_REQUEST' })
    return
  }
  if (!deps.finance?.recovery) {
    respond(res, 503, { error: 'EXPENSE_RECOVERY_UNAVAILABLE' })
    return
  }
  try {
    const result = await deps.finance.recovery.recover(worker)
    if (!isExpenseRecoveryCounts(result)) throw new Error('unsafe expense recovery result')
    respond(res, 200, {
      recovered: result.recovered,
      abandoned: result.abandoned,
      unchanged: result.unchanged,
      failed: result.failed,
    })
  } catch {
    respond(res, 503, { error: 'EXPENSE_RECOVERY_FAILED' })
  }
}

function hasFramedRecoveryBody(req: IncomingMessage): boolean {
  if (req.headers['transfer-encoding'] !== undefined || req.headers.expect !== undefined) return true
  const contentLength = req.headers['content-length']
  return contentLength !== undefined && contentLength !== '0'
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

function bookingDraftRoute(pathname: string): BookingDraftRoute | null {
  if (pathname === '/api/mini-app/booking-drafts') return { action: 'CREATE' }
  const match = /^\/api\/mini-app\/booking-drafts\/([A-Za-z0-9._:-]{1,124})(?:\/(confirm|cancel))?$/.exec(pathname)
  if (!match) return null
  if (match[2] === 'confirm') return { action: 'CONFIRM', draftId: match[1]! }
  if (match[2] === 'cancel') return { action: 'CANCEL', draftId: match[1]! }
  return { action: 'GET', draftId: match[1]! }
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
    if (!hasExactKeys(body, [])) return respond(res, 400, { error: 'UNKNOWN_BOOKING_FIELD' })
    const now = currentIso(deps)
    const requestId = deps.requestId?.() ?? `request-${randomUUID()}`
    const draftId = deps.draftId?.() ?? `draft-${randomUUID()}`
    const draft: MiniAppRequestRecord = {
      requestId, draftId, staffId: authenticated.staffId,
      lineUserIdHash: createHmac('sha256', deps.config.signingSecret).update(authenticated.lineUserId).digest('base64url'),
      state: 'DRAFT', retentionState: '', version: 1, payloadHash: null, aeName: '', customerName: '', facebookName: '',
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
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
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

  const draft = await ownedDraft(route.draftId, authenticated.staffId, deps, res)
  if (!draft) return
  const version = body.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return respond(res, 409, { error: 'STALE_DRAFT_VERSION' })
  const asyncOwner = Boolean(deps.config.asyncBooking?.ownerStaffIds.has(authenticated.staffId))
  if (
    route.action === 'CONFIRM'
    && version <= draft.version
    && hasExactKeys(body, ['version'])
    && asyncOwner
    && isBoundAsyncConfirmation(draft)
  ) {
    respond(res, 202, queuedAcknowledgement(draft))
    return
  }
  const retryingConfirmation = route.action === 'CONFIRM' && version < draft.version
    && (draft.state === 'FAILED_RETRYABLE' || draft.state === 'CONFIRMED' || confirmedWithRetryResult(draft) !== null)
  if (version !== draft.version && !retryingConfirmation) {
    if (
      route.action === 'CANCEL' && version < draft.version && hasExactKeys(body, ['version'])
      && draft.state === 'CANCELLED' && draft.retentionState === 'PENDING_APPROVAL'
    ) {
      respond(res, 200, draftProjection(draft))
      return
    }
    if (
      route.action === 'PATCH' && version < draft.version && hasExactKeys(body, ['version', 'input'])
      && matchesSavedDraftInput(draft, body.input)
    ) {
      respond(res, 200, draftProjection(draft))
      return
    }
    return respond(res, 409, { error: 'STALE_DRAFT_VERSION' })
  }

  if (route.action === 'PATCH') {
    if (!hasExactKeys(body, ['version', 'input'])) return respond(res, 400, { error: 'UNKNOWN_BOOKING_FIELD' })
    let config
    try { config = await deps.store.getActiveBookingConfig() } catch { return respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' }) }
    try {
      const parsed = parseBookingDraft(body.input, {
        draftId: draft.draftId, staffId: draft.staffId, lineUserIdHash: draft.lineUserIdHash,
        doctorIds: config.doctors.map(({ id }) => id), serviceIds: config.services.map(({ id }) => id),
        channelIds: config.channels.map(({ id }) => id), eligibleAeNames: ['ไม่ระบุ', ...config.aes.map(({ name }) => name)],
        paymentEvidenceFileIds: draft.paymentEvidenceFileIds, chatEvidenceFileIds: draft.chatEvidenceFileIds,
        paymentEvidenceObjectKeys: draft.paymentEvidenceObjectKeys, chatEvidenceObjectKeys: draft.chatEvidenceObjectKeys,
        asyncEvidence: Boolean(deps.config.asyncBooking?.ownerStaffIds.has(draft.staffId)),
        now: currentIso(deps),
      })
      if (parsed.requestId !== draft.requestId) throw new Error('REQUEST_ID_MISMATCH')
      const updated = await deps.store.updateDraft(draft.draftId, draft.version, {
        state: 'READY_TO_CONFIRM', payloadHash: null, aeName: parsed.aeName, customerName: parsed.customerName,
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

  if (!hasExactKeys(body, ['version'])) return respond(res, 400, { error: 'UNKNOWN_BOOKING_FIELD' })
  if (route.action === 'CANCEL') {
    if (!['DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'FAILED_RETRYABLE'].includes(draft.state)) {
      return respond(res, 409, { error: 'INVALID_DRAFT_TRANSITION' })
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
  if (draft.state !== 'READY_TO_CONFIRM' && draft.state !== 'FAILED_RETRYABLE') {
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
    try {
      task = await deps.taskQueue.enqueue({
        requestId: draft.requestId,
        draftId: draft.draftId,
        payloadHash,
        baseVersion: draft.version,
        scheduleAt: new Date(now.getTime() + 2_000),
      })
    } catch {
      respond(res, 503, { error: 'BOOKING_TASK_QUEUE_FAILED' })
      return
    }
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
    try {
      await deps.stateIngress.mutate(queueMutation)
    } catch { /* persisted reread below resolves response loss */ }
    let persisted: MiniAppRequestRecord | null
    try { persisted = await deps.store.getDraft(draft.draftId) } catch { persisted = null }
    if (persisted && validQueuedPersistence(draft, persisted, payloadHash)) {
      const terminal = confirmedWithRetryResult(persisted)
      emitAsyncTelemetry(deps, 'booking_task_enqueued', {
        requestId: persisted.requestId, draftId: persisted.draftId, attempt: 1, state: persisted.state,
        fileCount: persisted.evidenceCount, elapsedMs: Math.max(0, (deps.now ?? (() => new Date()))().getTime() - handlerStartedAt),
      })
      if (terminal) respond(res, 200, terminal)
      else respond(res, 202, queuedAcknowledgement(persisted))
    } else respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
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
): boolean {
  return persisted.requestId === before.requestId && persisted.draftId === before.draftId
    && persisted.payloadHash === payloadHash && bookingPayloadHash(persisted) === payloadHash
    && persisted.staffId === before.staffId && persisted.aeName === before.aeName
    && persisted.customerName === before.customerName && persisted.facebookName === before.facebookName
    && persisted.phoneNormalized === before.phoneNormalized && persisted.doctorId === before.doctorId
    && persisted.serviceId === before.serviceId && persisted.queueType === before.queueType
    && persisted.appointmentDate === before.appointmentDate && persisted.appointmentTime === before.appointmentTime
    && persisted.depositAmount === before.depositAmount && persisted.channelId === before.channelId
    && sameStringArray(persisted.paymentEvidenceObjectKeys, before.paymentEvidenceObjectKeys)
    && sameStringArray(persisted.chatEvidenceObjectKeys, before.chatEvidenceObjectKeys)
    && (
      ['QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMED', 'NEEDS_REVIEW'].includes(persisted.state)
      || confirmedWithRetryResult(persisted) !== null
    )
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
      requestId: draft.requestId, aeName: draft.aeName, customerName: draft.customerName, facebookName: draft.facebookName,
      phone: draft.phoneNormalized, doctorId: draft.doctorId, serviceId: draft.serviceId, queueType: draft.queueType,
      appointmentDate: draft.appointmentDate, appointmentTime: draft.appointmentTime, depositAmount: draft.depositAmount,
      channelId: draft.channelId,
    } : null,
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
    aeName: draft.aeName,
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

async function handleEvidenceBatchUpload(
  req: IncomingMessage,
  res: ServerResponse,
  draftId: string,
  authenticated: AuthenticatedMiniAppContext,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<void> {
  const handlerStartedAt = (deps.now ?? (() => new Date()))().getTime()
  const asyncConfig = deps.config.asyncBooking
  if (!asyncConfig || !asyncConfig.ownerStaffIds.has(authenticated.staffId)) {
    respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
    return
  }
  if (!deps.evidenceStaging) {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return
  }

  const draft = await ownedDraft(draftId, authenticated.staffId, deps, res)
  if (!draft) return
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
      requestId: draft.requestId, draftId: draft.draftId,
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
      requestId: updated.requestId, draftId: updated.draftId, state: updated.state,
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
): Promise<AuthenticatedMiniAppContext | null> {
  const lineUserId = await authenticateLineIdentity(req, res, deps)
  if (!lineUserId) return null

  try {
    const staff = await deps.store.getActiveStaffByLineUserId(lineUserId)
    if (!staff) {
      respond(res, 403, { error: 'STAFF_NOT_ALLOWED' })
      return null
    }
    return {
      staffId: staff.id,
      displayName: staff.name,
      lineUserId,
      canManageStock: staff.canManageStock === true,
      canSubmitExpense: staff.canSubmitExpense === true,
      canViewFinance: staff.canViewFinance === true,
      canManageExpense: staff.canManageExpense === true,
    }
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return null
  }
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
