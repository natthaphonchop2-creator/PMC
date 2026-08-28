import liff from '@line/liff'
import type {
  BookingConfirmationResult,
  BookingDraftInput,
  BookingDraftProjection,
  BookingQueuedResult,
  MiniAppConfig,
  MiniAppEnrollmentOptions,
  MiniAppSession,
} from './contracts'
import { buildReportSearchParams, type JeraClientEnvelope, type JeraReportType, type ReportFilterState } from './reports'

export interface MiniAppLiffPort {
  init(input: { liffId: string }): Promise<void>
  isLoggedIn(): boolean
  login(input?: { redirectUri?: string }): void
  getIDToken(): string | null
}

export interface MiniAppBrowserApi {
  initialize(): Promise<string>
  loadSession(idToken: string): Promise<MiniAppSession>
  loadEnrollmentOptions(idToken: string): Promise<MiniAppEnrollmentOptions>
  enroll(idToken: string, staffId: string, pin: string): Promise<MiniAppSession>
  loadConfig(idToken: string): Promise<MiniAppConfig>
  createDraft(idToken: string): Promise<BookingDraftProjection>
  loadLatestActiveDraft(idToken: string): Promise<BookingDraftProjection | null>
  loadDraft(idToken: string, draftId: string, signal?: AbortSignal): Promise<BookingDraftProjection>
  upload(idToken: string, draftId: string, kind: 'PAYMENT' | 'CHAT', files: File[]): Promise<BookingDraftProjection>
  uploadEvidenceBatch(idToken: string, draftId: string, input: { paymentFiles: File[]; chatFiles: File[] }): Promise<BookingDraftProjection>
  save(idToken: string, draftId: string, version: number, input: BookingDraftInput): Promise<BookingDraftProjection>
  confirm(idToken: string, draftId: string, version: number): Promise<BookingQueuedResult | BookingConfirmationResult>
  cancel(idToken: string, draftId: string, version: number): Promise<BookingDraftProjection>
  loadReport<T = unknown>(idToken: string, reportType: JeraReportType, filters: ReportFilterState): Promise<JeraClientEnvelope<T>>
  refreshReport(idToken: string, reportType: JeraReportType, filters: ReportFilterState): Promise<{ accepted: true; correlationId: string }>
}

export class MiniAppApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(code: string, status: number, retryAfterSeconds: number | null = null) {
    super(`Mini App API failed: ${code}`)
    this.name = 'MiniAppApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function createMiniAppApi(options: {
  fetch?: typeof globalThis.fetch
  liff?: MiniAppLiffPort
} = {}): MiniAppBrowserApi {
  const request = options.fetch ?? globalThis.fetch
  const liffClient = options.liff ?? liff
  let miniAppId = ''
  if (!request) throw new Error('Browser fetch is unavailable')

  return {
    async initialize() {
      const clientConfig = await requestJson<{ miniAppId: string }>(request, '/api/mini-app/client-config')
      if (!clientConfig.miniAppId) throw new MiniAppApiError('MINI_APP_NOT_CONFIGURED', 503)
      miniAppId = clientConfig.miniAppId
      await liffClient.init({ liffId: miniAppId })
      if (!liffClient.isLoggedIn()) {
        liffClient.login(typeof window === 'undefined' ? undefined : { redirectUri: window.location.href })
        throw new MiniAppApiError('MINI_APP_LOGIN_REDIRECT', 401)
      }
      const idToken = liffClient.getIDToken()
      if (!idToken) throw new MiniAppApiError('MINI_APP_UNAUTHORIZED', 401)
      return idToken
    },
    loadSession(idToken) {
      return requestJson(request, '/api/mini-app/session', authenticated(idToken))
    },
    loadEnrollmentOptions(idToken) {
      return requestJson(request, '/api/mini-app/enrollment-options', authenticated(idToken))
    },
    enroll(idToken, staffId, pin) {
      return requestJson(request, '/api/mini-app/enroll', authenticatedJson(idToken, 'POST', { staffId, pin }))
    },
    async loadConfig(idToken) {
      const config = await requestJson<Omit<MiniAppConfig, 'miniAppId'>>(request, '/api/mini-app/config', authenticated(idToken))
      return { miniAppId, ...config }
    },
    createDraft(idToken) {
      return requestJson(request, '/api/mini-app/booking-drafts', authenticatedJson(idToken, 'POST', {}))
    },
    async loadLatestActiveDraft(idToken) {
      try {
        return await requestJson(request, '/api/mini-app/booking-drafts/active', authenticated(idToken))
      } catch (error) {
        if (error instanceof MiniAppApiError && error.code === 'MINI_APP_ROUTE_NOT_FOUND') return null
        throw error
      }
    },
    loadDraft(idToken, draftId, signal) {
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}`, { ...authenticated(idToken), signal })
    },
    upload(idToken, draftId, kind, files) {
      const body = new FormData()
      for (const file of files) body.append('files', file)
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/evidence?kind=${kind}`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` }, body,
      })
    },
    uploadEvidenceBatch(idToken, draftId, input) {
      const body = new FormData()
      for (const file of input.paymentFiles) body.append('paymentFiles', file)
      for (const file of input.chatFiles) body.append('chatFiles', file)
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/evidence-batch`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` }, body,
      })
    },
    save(idToken, draftId, version, input) {
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}`, authenticatedJson(idToken, 'PATCH', { version, input }))
    },
    confirm(idToken, draftId, version) {
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/confirm`, authenticatedJson(idToken, 'POST', { version }), parseBookingConfirmationResponse)
    },
    cancel(idToken, draftId, version) {
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/cancel`, authenticatedJson(idToken, 'POST', { version }))
    },
    loadReport(idToken, reportType, filters) {
      const query = buildReportSearchParams(reportType, filters)
      return requestJson(request, `/api/mini-app/reports/${encodeURIComponent(reportType)}?${query}`, authenticated(idToken))
    },
    refreshReport(idToken, reportType, filters) {
      const query = buildReportSearchParams(reportType, filters)
      return requestJson(request, `/api/mini-app/reports/${encodeURIComponent(reportType)}/refresh?${query}`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` },
      })
    },
  }
}

function authenticated(idToken: string): RequestInit {
  return { headers: { authorization: `Bearer ${idToken}` } }
}

function authenticatedJson(idToken: string, method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function requestJson<T>(
  request: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
  parse?: (body: unknown, status: number) => T,
): Promise<T> {
  let response: Response
  try { response = await request(url, init) } catch { throw new MiniAppApiError('MINI_APP_NETWORK_FAILED', 0) }
  let body: unknown
  try { body = await response.json() } catch { throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', response.status) }
  if (!response.ok) {
    const code = body && typeof body === 'object' && !Array.isArray(body) && 'error' in body ? String(body.error) : 'MINI_APP_REQUEST_FAILED'
    const retryAfterSeconds = body && typeof body === 'object' && !Array.isArray(body) && 'retryAfterSeconds' in body
      && Number.isSafeInteger(Number(body.retryAfterSeconds)) ? Number(body.retryAfterSeconds) : null
    throw new MiniAppApiError(/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'MINI_APP_REQUEST_FAILED', response.status, retryAfterSeconds)
  }
  return parse ? parse(body, response.status) : body as T
}

export function parseBookingConfirmationResponse(body: unknown, status: number): BookingQueuedResult | BookingConfirmationResult {
  if (isRecord(body) && status === 202) {
    const keys = Object.keys(body).sort()
    if (keys.length === 3 && keys[0] === 'projection' && keys[1] === 'requestId' && keys[2] === 'status'
      && body.status === 'QUEUED' && typeof body.requestId === 'string') {
      const projection = parseSafeQueuedProjection(body.projection)
      if (projection && projection.requestId === body.requestId) return { requestId: body.requestId, status: 'QUEUED', projection }
    }
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  if (isRecord(body) && status === 200 && Object.keys(body).sort().join(',') === 'caseId,status'
    && typeof body.caseId === 'string' && isConfirmationStatus(body.status)) {
    return { caseId: body.caseId, status: body.status }
  }
  throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
}

function parseSafeQueuedProjection(value: unknown): BookingDraftProjection | null {
  if (!isRecord(value)) return null
  const expectedKeys = [
    'caseId', 'chatEvidenceIds', 'confirmationStatus', 'draftId', 'input', 'lastProgressAt',
    'paymentEvidenceIds', 'queuedAt', 'requestId', 'retentionState', 'safeErrorCode', 'state', 'version',
  ]
  if (Object.keys(value).sort().join(',') !== expectedKeys.join(',')) return null
  if (typeof value.draftId !== 'string' || typeof value.requestId !== 'string' || !isProjectionState(value.state)
    || (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL')
    || !isSafeInteger(value.version) || value.input !== null
    || !emptyStringArray(value.paymentEvidenceIds) || !emptyStringArray(value.chatEvidenceIds)
    || !nullableString(value.caseId) || !nullableString(value.safeErrorCode)
    || !nullableString(value.queuedAt) || !nullableString(value.lastProgressAt)
    || !(value.confirmationStatus === null || isConfirmationStatus(value.confirmationStatus))) return null
  return {
    draftId: value.draftId,
    requestId: value.requestId,
    state: value.state,
    retentionState: value.retentionState,
    version: value.version,
    input: null,
    paymentEvidenceIds: value.paymentEvidenceIds,
    chatEvidenceIds: value.chatEvidenceIds,
    confirmationStatus: value.confirmationStatus,
    caseId: value.caseId,
    safeErrorCode: value.safeErrorCode,
    queuedAt: value.queuedAt,
    lastProgressAt: value.lastProgressAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function emptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 0
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isConfirmationStatus(value: unknown): value is BookingConfirmationResult['status'] {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}

function isProjectionState(value: unknown): value is BookingDraftProjection['state'] {
  return value === 'DRAFT' || value === 'UPLOADING' || value === 'READY_TO_CONFIRM' || value === 'QUEUED'
    || value === 'PROCESSING' || value === 'RETRYING' || value === 'CONFIRMING' || value === 'CONFIRMED'
    || value === 'CONFIRMED_WITH_RETRY' || value === 'NEEDS_REVIEW' || value === 'FAILED_RETRYABLE'
    || value === 'CANCELLED' || value === 'EXPIRED'
}
