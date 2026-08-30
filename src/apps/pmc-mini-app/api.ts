import liff from '@line/liff'
import type {
  BookingConfirmationResult,
  BookingDraftInput,
  BookingDraftProjection,
  BookingQueuedResult,
  ExpenseSubmitInput,
  MiniAppConfig,
  MiniAppEnrollmentOptions,
  MiniAppSession,
  StockProductProjection,
} from './contracts'
import { monthSelectionToSearch, type FinanceDailyFilter, type FinanceMonthSelection } from './financeReports'
import { buildReportSearchParams, type JeraClientEnvelope, type JeraReportType, type ReportFilterState } from './reports'
import type { StockClientCommand, StockCommandResult, StockHistoryPage } from '../../../shared/pmcStock'
import type { DailyIncomeProjection, MonthlyIncomeProjection } from '../../../shared/pmcFinance'
import {
  deriveExpenseScope,
  parseExpenseDate,
  type ExpenseHistoryPage,
  type ExpenseHistoryRow,
  type ExpenseMonthlyProjection,
  type ExpenseAttachmentSummary,
  type EnabledExpenseCategory,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense'
import { isExpenseStagingToken } from './expense/expenseModel'

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
  loadDailyIncome(idToken: string, filter: FinanceDailyFilter): Promise<DailyIncomeProjection>
  refreshDailyIncome(idToken: string, eventDate: string): Promise<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>
  loadMonthlyIncome(idToken: string, selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
  loadMonthlyExpenses(idToken: string, monthKey: string): Promise<ExpenseMonthlyProjection>
  loadExpenseHistory(idToken: string, monthKey: string, cursor?: string): Promise<ExpenseHistoryPage>
  issueExpenseEvidenceToken(idToken: string, expenseId: string, attachmentId: string): Promise<string>
  downloadExpenseEvidence(idToken: string, token: string): Promise<Blob>
  replaceExpense(idToken: string, expenseId: string, input: ExpenseSubmitInput): Promise<ExpenseReceipt>
  voidExpense(idToken: string, expenseId: string, input: { rootRequestId: string; expectedRevision: number; reason: string }): Promise<void>
  loadStockProducts(idToken: string): Promise<{ products: StockProductProjection[] }>
  loadStockHistory(idToken: string, cursor?: string): Promise<StockHistoryPage>
  submitStockCommand(idToken: string, command: StockClientCommand): Promise<StockCommandResult>
  stageExpense(idToken: string, rootRequestId: string, files: File[]): Promise<{ stagingTokens: string[] }>
  submitExpense(idToken: string, input: ExpenseSubmitInput): Promise<ExpenseReceipt>
}

export class MiniAppApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSeconds: number | null
  readonly retryable: boolean | null

  constructor(code: string, status: number, retryAfterSeconds: number | null = null, retryable: boolean | null = null) {
    super(`Mini App API failed: ${code}`)
    this.name = 'MiniAppApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
    this.retryable = retryable
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
    loadMonthlyExpenses(idToken, monthKey) {
      return requestJson(request, `/api/mini-app/finance/months/${encodeURIComponent(monthKey)}/expenses`, authenticated(idToken), parseExpenseMonthlyProjection)
    },
    loadExpenseHistory(idToken, monthKey, cursor) {
      const query = new URLSearchParams({ month: monthKey })
      if (cursor) query.set('cursor', cursor)
      return requestJson(request, `/api/mini-app/finance/expenses?${query}`, authenticated(idToken), parseExpenseHistoryPage)
    },
    issueExpenseEvidenceToken(idToken, expenseId, attachmentId) {
      return requestJson(request,
        `/api/mini-app/finance/expenses/${encodeURIComponent(expenseId)}/evidence/${encodeURIComponent(attachmentId)}/token`,
        { method: 'POST', ...authenticated(idToken) },
        parseEvidenceToken,
      )
    },
    downloadExpenseEvidence(idToken, token) {
      return requestExpenseBlob(request, `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`, authenticated(idToken))
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
    stageExpense(idToken, rootRequestId, files) {
      const body = new FormData()
      files.forEach((file, index) => body.append(`file${index + 1}`, file))
      return requestJson(request, `/api/mini-app/expenses/staging/${encodeURIComponent(rootRequestId)}`, {
        method: 'POST', headers: { authorization: `Bearer ${idToken}` }, body,
      }, (responseBody, status) => parseExpenseStagingResponse(responseBody, status, files.length))
    },
    submitExpense(idToken, input) {
      return requestJson(request, '/api/mini-app/expenses', authenticatedJson(idToken, 'POST', input),
        (body, status) => parseExpenseReceiptResponse(body, status, input))
    },
    replaceExpense(idToken, expenseId, input) {
      const { expectedRevision, ...replacementInput } = input
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        return Promise.reject(new MiniAppApiError('MINI_APP_INVALID_RESPONSE', 0))
      }
      return requestJson(request,
        `/api/mini-app/finance/expenses/${encodeURIComponent(expenseId)}/replace`,
        authenticatedJson(idToken, 'POST', {
          expectedVersion: committedExpenseVersion(), expectedRevision, input: replacementInput,
        }),
        (body, status) => parseExpenseReceiptResponse(body, status, input),
      )
    },
    async voidExpense(idToken, expenseId, input) {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', 0)
      }
      await requestJson(request,
        `/api/mini-app/finance/expenses/${encodeURIComponent(expenseId)}/void`,
        authenticatedJson(idToken, 'POST', {
          rootRequestId: input.rootRequestId, expectedVersion: committedExpenseVersion(), reason: input.reason,
        }),
        parseVoidExpenseResponse,
      )
    },
  }
}

function committedExpenseVersion(): 2 {
  // PREPARED v1 becomes the immutable browser-visible COMMITTED row at v2.
  return 2
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
    const retryable = body && typeof body === 'object' && !Array.isArray(body) && 'retryable' in body
      && typeof body.retryable === 'boolean' ? body.retryable : null
    throw new MiniAppApiError(
      /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'MINI_APP_REQUEST_FAILED',
      response.status,
      retryAfterSeconds,
      retryable,
    )
  }
  return parse ? parse(body, response.status) : body as T
}

async function requestExpenseBlob(
  request: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Blob> {
  let response: Response
  try { response = await request(url, init) } catch { throw new MiniAppApiError('MINI_APP_NETWORK_FAILED', 0) }
  if (!response.ok) {
    let body: unknown = null
    try { body = await response.json() } catch { /* Deliberately keep private evidence errors opaque. */ }
    const code = isRecord(body) && typeof body.error === 'string' && /^[A-Z0-9_]{1,80}$/.test(body.error)
      ? body.error : 'MINI_APP_REQUEST_FAILED'
    throw new MiniAppApiError(code, response.status)
  }
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', response.status)
  const blob = await response.blob()
  if (blob.size < 1 || blob.size > 10_000_000 || blob.type !== mimeType) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', response.status)
  }
  return blob
}

function parseFinanceRefreshResponse(body: unknown, status: number): { accepted: true; allocationQueued: boolean; retryAfterSeconds: number } {
  if (status === 202 && isRecord(body) && body.accepted === true && typeof body.allocationQueued === 'boolean'
    && safeRetryAfterSeconds(body.retryAfterSeconds) !== null) {
    return { accepted: true, allocationQueued: body.allocationQueued, retryAfterSeconds: safeRetryAfterSeconds(body.retryAfterSeconds)! }
  }
  throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
}

function safeRetryAfterSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 3_600 ? value : null
}

function parseExpenseStagingResponse(body: unknown, status: number, expectedCount: number): { stagingTokens: string[] } {
  if (status !== 200 || !isRecord(body) || Object.keys(body).join(',') !== 'stagingTokens' || !Array.isArray(body.stagingTokens)) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  const tokens = body.stagingTokens
  if (expectedCount < 1 || expectedCount > 5 || tokens.length !== expectedCount || new Set(tokens).size !== tokens.length
    || !tokens.every(isExpenseStagingToken)) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  return { stagingTokens: tokens as string[] }
}

function parseExpenseMonthlyProjection(body: unknown, status: number): ExpenseMonthlyProjection {
  const expected = ['clinicByCategorySatang', 'clinicCommittedSatang', 'doctorPersonalCommittedSatang', 'effectiveExpenseCount', 'monthKey', 'unreviewed']
  if (status !== 200 || !isRecord(body) || Object.keys(body).sort().join(',') !== expected.join(',')) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  const categories = body.clinicByCategorySatang
  if (!validMonthKey(body.monthKey)
    || !positiveOrZeroInteger(body.clinicCommittedSatang)
    || !positiveOrZeroInteger(body.doctorPersonalCommittedSatang)
    || !positiveOrZeroInteger(body.effectiveExpenseCount)
    || body.unreviewed !== true
    || !isRecord(categories)
    || Object.keys(categories).sort().join(',') !== 'BILL_DOCUMENT,BOOK_CLINIC'
    || !positiveOrZeroInteger(categories.BILL_DOCUMENT)
    || !positiveOrZeroInteger(categories.BOOK_CLINIC)
    || categories.BILL_DOCUMENT + categories.BOOK_CLINIC !== body.clinicCommittedSatang
  ) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  return {
    monthKey: body.monthKey,
    clinicCommittedSatang: body.clinicCommittedSatang,
    doctorPersonalCommittedSatang: body.doctorPersonalCommittedSatang,
    clinicByCategorySatang: { BILL_DOCUMENT: categories.BILL_DOCUMENT, BOOK_CLINIC: categories.BOOK_CLINIC },
    effectiveExpenseCount: body.effectiveExpenseCount,
    unreviewed: true,
  }
}

function parseExpenseHistoryPage(body: unknown, status: number): ExpenseHistoryPage {
  if (status !== 200 || !isRecord(body) || Object.keys(body).sort().join(',') !== 'expenses,nextCursor'
    || !Array.isArray(body.expenses) || body.expenses.length > 25
    || !(body.nextCursor === null || (typeof body.nextCursor === 'string' && body.nextCursor.length >= 3 && body.nextCursor.length <= 256))
  ) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  const expenses = body.expenses.map((row) => parseExpenseHistoryRow(row, status))
  if (new Set(expenses.map(({ expenseId }) => expenseId)).size !== expenses.length) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  return { expenses, nextCursor: body.nextCursor }
}

function parseExpenseHistoryRow(value: unknown, status: number): ExpenseHistoryRow {
  const expected = ['amountSatang', 'attachments', 'category', 'committedAt', 'description', 'expenseDate', 'expenseId', 'recordState', 'revision', 'scope', 'submittedAt', 'submittedByName']
  const category = isRecord(value) ? enabledExpenseCategory(value.category) : null
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== expected.join(',')
    || typeof value.expenseId !== 'string' || !/^EXP-\d{6}-[A-Za-z0-9._:-]{1,107}$/.test(value.expenseId)
    || typeof value.expenseDate !== 'string' || !validMonthKey(value.expenseDate.slice(0, 7))
    || !category || value.scope !== deriveExpenseScope(category)
    || !positiveOrZeroInteger(value.amountSatang) || value.amountSatang < 1
    || typeof value.description !== 'string' || value.description.length > 500
    || (value.recordState !== 'COMMITTED' && value.recordState !== 'VOID')
    || !positiveOrZeroInteger(value.revision) || value.revision < 1
    || typeof value.submittedByName !== 'string' || value.submittedByName.length < 1 || value.submittedByName.length > 300
    || typeof value.submittedAt !== 'string' || !canonicalIsoTimestamp(value.submittedAt)
    || !(value.committedAt === null || (typeof value.committedAt === 'string' && canonicalIsoTimestamp(value.committedAt)))
    || !Array.isArray(value.attachments) || value.attachments.length > 5
  ) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  const expenseId = value.expenseId as string
  const attachments = value.attachments.map((attachment) => parseExpenseAttachment(attachment, expenseId, status))
  if (new Set(attachments.map(({ attachmentId }) => attachmentId)).size !== attachments.length) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  return {
    expenseId,
    expenseDate: value.expenseDate,
    category,
    scope: deriveExpenseScope(category),
    amountSatang: value.amountSatang,
    description: value.description,
    recordState: value.recordState,
    revision: value.revision,
    submittedByName: value.submittedByName,
    submittedAt: value.submittedAt,
    committedAt: value.committedAt,
    attachments,
  }
}

function parseExpenseAttachment(value: unknown, expenseId: string, status: number): ExpenseAttachmentSummary {
  const expected = ['attachmentId', 'expenseId', 'mediaType', 'ordinal', 'originalFileName']
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== expected.join(',')
    || typeof value.attachmentId !== 'string' || !/^[A-Za-z0-9._:-]{1,124}$/.test(value.attachmentId)
    || value.expenseId !== expenseId || !positiveOrZeroInteger(value.ordinal) || value.ordinal < 1 || value.ordinal > 5
    || (value.mediaType !== 'image/jpeg' && value.mediaType !== 'image/png')
    || typeof value.originalFileName !== 'string' || value.originalFileName.length < 1 || value.originalFileName.length > 180
  ) throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  return {
    attachmentId: value.attachmentId,
    expenseId,
    ordinal: value.ordinal,
    mediaType: value.mediaType,
    originalFileName: value.originalFileName,
  }
}

function parseEvidenceToken(body: unknown, status: number): string {
  if (status !== 200 || !isRecord(body) || Object.keys(body).join(',') !== 'token'
    || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}$/.test(body.token)) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  return body.token
}

function parseVoidExpenseResponse(body: unknown, status: number): void {
  if (status !== 200 || !isRecord(body) || Object.keys(body).sort().join(',') !== 'expenseId,recordState,updatedAt,version'
    || typeof body.expenseId !== 'string' || body.recordState !== 'VOID'
    || !positiveOrZeroInteger(body.version) || !canonicalIsoTimestamp(String(body.updatedAt))) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
}

function validMonthKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return parseExpenseDate(`${value}-01`).monthKey === value } catch { return false }
}

function positiveOrZeroInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseExpenseReceiptResponse(body: unknown, status: number, expected?: ExpenseSubmitInput): ExpenseReceipt {
  const expectedKeys = [
    'amountSatang', 'category', 'committedAt', 'expenseDate', 'expenseId', 'monthKey',
    'receiptNumber', 'recordState', 'revision', 'scope', 'unreviewed',
  ]
  if (status !== 200 || !isRecord(body) || Object.keys(body).sort().join(',') !== expectedKeys.join(',')) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  const category = enabledExpenseCategory(body.category)
  let monthKey: string | null = null
  if (typeof body.expenseDate === 'string') {
    try { monthKey = parseExpenseDate(body.expenseDate).monthKey } catch { monthKey = null }
  }
  if (!category || !monthKey || body.monthKey !== monthKey
    || typeof body.expenseId !== 'string'
    || body.receiptNumber !== body.expenseId
    || !new RegExp(`^EXP-${monthKey.replace('-', '')}-[A-Za-z0-9._:-]{1,107}$`).test(body.expenseId)
    || body.scope !== deriveExpenseScope(category)
    || typeof body.amountSatang !== 'number' || !Number.isSafeInteger(body.amountSatang) || body.amountSatang <= 0
    || body.recordState !== 'COMMITTED'
    || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 1
    || typeof body.committedAt !== 'string' || !canonicalIsoTimestamp(body.committedAt)
    || body.unreviewed !== true) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  if (expected && (category !== expected.category
    || body.expenseDate !== expected.expenseDate
    || body.amountSatang !== expected.amountSatang
    || body.revision !== expected.expectedRevision + 1)) {
    throw new MiniAppApiError('MINI_APP_INVALID_RESPONSE', status)
  }
  return {
    expenseId: body.expenseId,
    receiptNumber: body.expenseId,
    expenseDate: body.expenseDate as string,
    monthKey,
    category,
    scope: deriveExpenseScope(category),
    amountSatang: body.amountSatang,
    recordState: 'COMMITTED',
    revision: body.revision,
    committedAt: body.committedAt,
    unreviewed: true,
  }
}

function enabledExpenseCategory(value: unknown): EnabledExpenseCategory | null {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL' ? value : null
}

function canonicalIsoTimestamp(value: string): boolean {
  try { return new Date(value).toISOString() === value } catch { return false }
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
