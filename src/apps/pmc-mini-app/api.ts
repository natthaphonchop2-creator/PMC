import liff from '@line/liff'
import type {
  BookingConfirmationResult,
  BookingDraftAttributionV2,
  BookingDraftInput,
  BookingDraftInputV2,
  BookingDraftProjection,
  BookingQueuedResult,
  MiniAppConfig,
  MiniAppEnrollmentOptions,
  MiniAppSession,
  StockProductProjection,
} from './contracts'
import { bookingProtocolVersion } from './contracts'
import { monthSelectionToSearch, type FinanceDailyFilter, type FinanceMonthSelection } from './financeReports'
import { buildReportSearchParams, type JeraClientEnvelope, type JeraReportType, type ReportFilterState } from './reports'
import type { StockClientCommand, StockCommandResult, StockHistoryPage } from '../../../shared/pmcStock'
import type { DailyIncomeProjection, MonthlyIncomeProjection } from '../../../shared/pmcFinance'
import { PMC_BOOKING_PROTOCOL_VERSION } from '../../../shared/pmcBookingProtocol'
import type { BookingProtocolVersion } from '../../../shared/pmcBookingProtocol'
import type { BookingPrepareFilesInput } from '../../../shared/pmcMiniAppBookingPrepare'

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
  createDraft(idToken: string, protocolVersion?: BookingProtocolVersion): Promise<BookingDraftProjection>
  loadLatestActiveDraft(idToken: string): Promise<BookingDraftProjection | null>
  loadDraft(idToken: string, draftId: string, signal?: AbortSignal): Promise<BookingDraftProjection>
  upload(idToken: string, draftId: string, kind: 'PAYMENT' | 'CHAT', files: File[]): Promise<BookingDraftProjection>
  uploadEvidenceBatch(idToken: string, draftId: string, input: { paymentFiles: File[]; chatFiles: File[] }): Promise<BookingDraftProjection>
  prepare(idToken: string, draftId: string, version: number, input: BookingPrepareFilesInput): Promise<BookingDraftProjection>
  save(idToken: string, draftId: string, version: number, input: BookingDraftInput, protocolVersion?: BookingProtocolVersion): Promise<BookingDraftProjection>
  confirm(idToken: string, draftId: string, version: number, protocolVersion?: BookingProtocolVersion): Promise<BookingQueuedResult | BookingConfirmationResult>
  cancel(idToken: string, draftId: string, version: number, protocolVersion?: BookingProtocolVersion): Promise<BookingDraftProjection>
  loadReport<T = unknown>(idToken: string, reportType: JeraReportType, filters: ReportFilterState): Promise<JeraClientEnvelope<T>>
  refreshReport(idToken: string, reportType: JeraReportType, filters: ReportFilterState): Promise<{ accepted: true; correlationId: string }>
  loadDailyIncome(idToken: string, filter: FinanceDailyFilter): Promise<DailyIncomeProjection>
  refreshDailyIncome(idToken: string, eventDate: string): Promise<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>
  loadMonthlyIncome(idToken: string, selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
  loadStockProducts(idToken: string): Promise<{ products: StockProductProjection[] }>
  loadStockHistory(idToken: string, cursor?: string): Promise<StockHistoryPage>
  submitStockCommand(idToken: string, command: StockClientCommand): Promise<StockCommandResult>
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
  let activeBookingProtocol: BookingProtocolVersion = 1
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
      const projected = { miniAppId, ...config }
      activeBookingProtocol = bookingProtocolVersion(projected)
      return projected
    },
    createDraft(idToken, protocolVersion = activeBookingProtocol) {
      return requestJson(request, '/api/mini-app/booking-drafts', authenticatedJson(
        idToken,
        'POST',
        protocolVersion === 2 ? { protocolVersion: PMC_BOOKING_PROTOCOL_VERSION } : {},
      ))
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
      return requestJson(
        request,
        `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}`,
        { ...authenticated(idToken), signal },
        parseFullBookingDraftProjection,
      )
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
    prepare(idToken, draftId, version, input) {
      const body = new FormData()
      body.append('input', JSON.stringify({
        protocolVersion: PMC_BOOKING_PROTOCOL_VERSION,
        version,
        input: exactBookingDraftInputV2(input.input),
      }))
      for (const file of input.paymentFiles) body.append('paymentFiles', file)
      for (const file of input.chatFiles) body.append('chatFiles', file)
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/prepare`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` }, body,
      })
    },
    save(idToken, draftId, version, input, protocolVersion = activeBookingProtocol) {
      const body = protocolVersion === 2
        ? { protocolVersion: PMC_BOOKING_PROTOCOL_VERSION, version, input }
        : { version, input }
      return requestJson(request, `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}`, authenticatedJson(idToken, 'PATCH', body))
    },
    confirm(idToken, draftId, version, protocolVersion = activeBookingProtocol) {
      const body = protocolVersion === 2 ? { protocolVersion: PMC_BOOKING_PROTOCOL_VERSION, version } : { version }
      return requestJson(
        request,
        `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/confirm`,
        authenticatedJson(idToken, 'POST', body),
        parseBookingConfirmationResponse,
      )
    },
    cancel(idToken, draftId, version, protocolVersion = activeBookingProtocol) {
      const body = protocolVersion === 2 ? { protocolVersion: PMC_BOOKING_PROTOCOL_VERSION, version } : { version }
      return requestJson(
        request,
        `/api/mini-app/booking-drafts/${encodeURIComponent(draftId)}/cancel`,
        authenticatedJson(idToken, 'POST', body),
      )
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
    loadDailyIncome(idToken, filter) {
      const query = new URLSearchParams({ startDate: filter.startDate, endDate: filter.endDate })
      return requestJson(request, `/api/mini-app/finance/daily?${query}`, authenticated(idToken))
    },
    refreshDailyIncome(idToken, eventDate) {
      return requestJson(request, `/api/mini-app/finance/daily/refresh?date=${encodeURIComponent(eventDate)}`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` },
      }, parseFinanceRefreshResponse)
    },
    loadMonthlyIncome(idToken, selection) {
      const query = monthSelectionToSearch(selection)
      return requestJson(request, `/api/mini-app/finance/monthly?${query}`, authenticated(idToken))
    },
    loadStockProducts(idToken) {
      return requestJson(request, '/api/mini-app/stock/products', authenticated(idToken))
    },
    loadStockHistory(idToken, cursor) {
      const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`
      return requestJson(request, `/api/mini-app/stock/history${query}`, authenticated(idToken))
    },
    submitStockCommand(idToken, command) {
      const mapped = stockCommandRequest(command)
      return requestJson(request, mapped.url, authenticatedJson(idToken, mapped.method, mapped.body))
    },
  }
}

function exactBookingDraftInputV2(input: BookingDraftInputV2): BookingDraftInputV2 {
  return {
    requestId: input.requestId,
    adminId: input.adminId,
    aeId: input.aeId,
    customerName: input.customerName,
    facebookName: input.facebookName,
    phone: input.phone,
    doctorId: input.doctorId,
    serviceId: input.serviceId,
    queueType: input.queueType,
    appointmentDate: input.appointmentDate,
    appointmentTime: input.appointmentTime,
    depositAmount: input.depositAmount,
    channelId: input.channelId,
  }
}

function stockCommandRequest(command: StockClientCommand): { url: string; method: 'POST' | 'PATCH'; body: unknown } {
  if (command.commandType === 'ISSUE') {
    return { url: '/api/mini-app/stock/issues', method: 'POST', body: { requestId: command.requestId, ...command.payload } }
  }
  if (command.commandType === 'RECEIVE') {
    return { url: '/api/mini-app/stock/receipts', method: 'POST', body: { requestId: command.requestId, ...command.payload } }
  }
  if (command.commandType === 'CREATE_PRODUCT') {
    return { url: '/api/mini-app/stock/products', method: 'POST', body: { requestId: command.requestId, ...command.payload } }
  }
  if (command.commandType === 'ADJUST') {
    return { url: '/api/mini-app/stock/adjustments', method: 'POST', body: { requestId: command.requestId, ...command.payload } }
  }
  if (command.commandType === 'UPDATE_PRODUCT') {
    const { productId, ...payload } = command.payload
    return {
      url: `/api/mini-app/stock/products/${encodeURIComponent(productId)}`,
      method: 'PATCH',
      body: { requestId: command.requestId, action: 'UPDATE', ...payload },
    }
  }
  const action = command.commandType === 'DEACTIVATE_PRODUCT' ? 'DEACTIVATE' : 'REACTIVATE'
  if (!('productId' in command.payload)) throw new Error('Unsupported Stock command')
  const { productId, ...payload } = command.payload
  return {
    url: `/api/mini-app/stock/products/${encodeURIComponent(productId)}`,
    method: 'PATCH',
    body: { requestId: command.requestId, action, ...payload },
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
      && safeRetryAfterSeconds(body.retryAfterSeconds) !== null ? safeRetryAfterSeconds(body.retryAfterSeconds) : null
    throw new MiniAppApiError(/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'MINI_APP_REQUEST_FAILED', response.status, retryAfterSeconds)
  }
  return parse ? parse(body, response.status) : body as T
}

function parseFinanceRefreshResponse(body: unknown, status: number): { accepted: true; allocationQueued: boolean; retryAfterSeconds: number } {
  if (status === 202 && isRecord(body) && body.accepted === true && typeof body.allocationQueued === 'boolean'
    && safeRetryAfterSeconds(body.retryAfterSeconds) !== null) {
    return { accepted: true, allocationQueued: body.allocationQueued, retryAfterSeconds: safeRetryAfterSeconds(body.retryAfterSeconds)! }
  }
  throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
}

function parseFullBookingDraftProjection(body: unknown, status: number): BookingDraftProjection {
  if (!isRecord(body)) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  if (!('attribution' in body)) return body as unknown as BookingDraftProjection
  const attribution = parseBookingAttribution(body.attribution)
  if (!attribution || !isBookingDraftInputV2(body.input)
    || attribution.admin.id !== body.input.adminId
    || (attribution.ae?.id ?? null) !== body.input.aeId) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  return { ...(body as unknown as BookingDraftProjection), attribution }
}

function parseBookingAttribution(value: unknown): BookingDraftAttributionV2 | null {
  if (!isRecord(value) || exactKeys(value) !== 'admin,ae,protocolVersion,recorder' || value.protocolVersion !== 2) return null
  const recorder = parseAttributionIdentity(value.recorder)
  const admin = parseAttributionIdentity(value.admin)
  const ae = value.ae === null ? null : parseAttributionIdentity(value.ae)
  if (!recorder || !admin || value.ae !== null && !ae) return null
  return { protocolVersion: 2, recorder, admin, ae }
}

function parseAttributionIdentity(value: unknown): { id: string; name: string } | null {
  if (!isRecord(value) || exactKeys(value) !== 'id,name') return null
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 256) return null
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256) return null
  return { id: value.id, name: value.name }
}

function isBookingDraftInputV2(value: unknown): value is BookingDraftInputV2 {
  return isRecord(value) && typeof value.adminId === 'string' && (typeof value.aeId === 'string' || value.aeId === null)
}

function exactKeys(value: Record<string, unknown>): string {
  return Object.keys(value).sort().join(',')
}

function safeRetryAfterSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 3_600 ? value : null
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
    'caseId', 'chatEvidenceCount', 'chatEvidenceIds', 'confirmationStatus', 'draftId', 'input', 'lastProgressAt',
    'paymentEvidenceCount', 'paymentEvidenceIds', 'queuedAt', 'requestId', 'retentionState', 'safeErrorCode', 'state', 'version',
  ]
  if (Object.keys(value).sort().join(',') !== expectedKeys.join(',')) return null
  if (typeof value.draftId !== 'string' || typeof value.requestId !== 'string' || !isProjectionState(value.state)
    || (value.retentionState !== '' && value.retentionState !== 'PENDING_APPROVAL')
    || !isSafeInteger(value.version) || value.input !== null
    || !emptyStringArray(value.paymentEvidenceIds) || !emptyStringArray(value.chatEvidenceIds)
    || !evidenceCount(value.paymentEvidenceCount) || !evidenceCount(value.chatEvidenceCount)
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
    paymentEvidenceCount: value.paymentEvidenceCount,
    chatEvidenceCount: value.chatEvidenceCount,
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

function evidenceCount(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0 && value <= 10
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
