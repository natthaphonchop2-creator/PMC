import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deriveBookDailyKey,
  deriveExpenseScope,
  parseExpenseDate,
  type EnabledExpenseCategory,
  type ExpensePaymentMethod,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense.js'
import { isMiniAppExpenseSafeErrorCode, type MiniAppExpenseCommand } from '../../../shared/pmcMiniAppExpenseIngress.js'
import type { AuthenticatedMiniAppContext, FinanceServerDependencies } from '../contracts.js'
import { FinanceEvidenceTokenError, signFinanceEvidenceToken, verifyFinanceEvidenceToken } from './evidenceToken.js'
import { ExpenseIngressClientError } from './ingressClient.js'
import { consumeExpenseMultipart, ExpenseMultipartError } from './multipart.js'
import { FinanceReadStoreError } from './readStore.js'
import { ExpenseStagingError, type ExpenseStagingReceipt } from './stagingStore.js'
import { ExpenseStagingTokenError, signExpenseStagingReceipt, verifyExpenseStagingReceipt } from './stagingToken.js'
import { ExpenseSubmissionError } from './submissionService.js'

const EXPENSE_PREFIX = '/api/mini-app/expenses'
const FINANCE_PREFIX = '/api/mini-app/finance'
const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,116}$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const MAX_JSON_BYTES = 64 * 1024
const MAX_TOKEN_LENGTH = 2_048
const HISTORY_PAGE_SIZE = 25 as const

export function isFinanceMiniAppApiPath(pathname: string): boolean {
  return pathname === EXPENSE_PREFIX
    || pathname.startsWith(`${EXPENSE_PREFIX}/`)
    || pathname === FINANCE_PREFIX
    || pathname.startsWith(`${FINANCE_PREFIX}/`)
}

export async function handleFinanceMiniAppApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authenticated: AuthenticatedMiniAppContext,
  finance: FinanceServerDependencies | undefined,
): Promise<void> {
  const { pathname } = url

  if (pathname === EXPENSE_PREFIX) {
    if (!requirePermission(authenticated.canSubmitExpense, res, 'EXPENSE_SUBMIT_PERMISSION_REQUIRED')) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url)) return invalidField(res)
    if (!finance?.capture) return routeNotFound(res)
    await handleSubmit(req, res, authenticated, finance)
    return
  }

  if (pathname.startsWith(`${EXPENSE_PREFIX}/staging/`)) {
    if (!requirePermission(authenticated.canSubmitExpense, res, 'EXPENSE_SUBMIT_PERMISSION_REQUIRED')) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url)) return invalidField(res)
    const match = new RegExp(`^${EXPENSE_PREFIX}/staging/([A-Za-z0-9._:-]{1,116})$`).exec(pathname)
    if (!match) return invalidRequest(res)
    if (!finance?.capture) return routeNotFound(res)
    await handleStaging(req, res, match[1]!, authenticated, finance)
    return
  }

  const resumeRoute = new RegExp(`^${EXPENSE_PREFIX}/resume/([A-Za-z0-9._:-]{1,116})$`).exec(pathname)
  if (resumeRoute) {
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url) || !emptyBody(req)) return invalidField(res)
    if (!finance?.resume) return routeNotFound(res)
    try {
      const result = await finance.resume.ingress.resume({
        rootRequestId: resumeRoute[1]!,
        staffId: authenticated.staffId,
      })
      json(res, 200, result)
    } catch (error) {
      respondMutationError(res, error)
    }
    return
  }

  const monthlyRoute = new RegExp(`^${FINANCE_PREFIX}/months/([^/]+)/expenses$`).exec(pathname)
  if (monthlyRoute) {
    if (!requirePermission(authenticated.canViewFinance, res, 'EXPENSE_FINANCE_PERMISSION_REQUIRED')) return
    if (req.method !== 'GET') return methodNotAllowed(res)
    if (rejectFramedGetBody(req, res)) return
    if (!noQuery(url)) return invalidField(res)
    if (!finance?.reads) return routeNotFound(res)
    const monthKey = validMonthKey(monthlyRoute[1]!)
    if (!monthKey) return invalidMonth(res)
    try {
      json(res, 200, await finance.reads.readStore.loadMonthlyExpenses(monthKey))
    } catch (error) {
      respondReadError(res, error)
    }
    return
  }

  if (pathname === `${FINANCE_PREFIX}/expenses`) {
    if (!requirePermission(authenticated.canViewFinance, res, 'EXPENSE_FINANCE_PERMISSION_REQUIRED')) return
    if (req.method !== 'GET') return methodNotAllowed(res)
    if (rejectFramedGetBody(req, res)) return
    if (!finance?.reads) return routeNotFound(res)
    const query = exactHistoryQuery(url)
    if (!query) return invalidField(res)
    try {
      json(res, 200, await finance.reads.readStore.listExpenseHistory(
        query.monthKey,
        query.cursor,
        HISTORY_PAGE_SIZE,
      ))
    } catch (error) {
      respondReadError(res, error)
    }
    return
  }

  const evidenceTokenRoute = new RegExp(
    `^${FINANCE_PREFIX}/expenses/([^/]+)/evidence/([^/]+)/token$`,
  ).exec(pathname)
  if (evidenceTokenRoute) {
    if (!requirePermission(authenticated.canViewFinance, res, 'EXPENSE_FINANCE_PERMISSION_REQUIRED')) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url) || !emptyBody(req)) return invalidField(res)
    if (!finance?.reads) return routeNotFound(res)
    const expenseId = safeId(evidenceTokenRoute[1])
    const attachmentId = safeId(evidenceTokenRoute[2])
    const monthKey = expenseId ? monthFromExpenseId(expenseId) : null
    if (!expenseId || !attachmentId || !monthKey) return invalidRequest(res)
    try {
      const evidence = await finance.reads.readStore.getEvidence(monthKey, expenseId, attachmentId)
      if (!evidence) return json(res, 404, { error: 'EXPENSE_EVIDENCE_NOT_FOUND' })
      const token = signFinanceEvidenceToken({
        staffId: authenticated.staffId,
        monthKey,
        expenseId,
        attachmentId,
        secret: finance.signingSecret,
        now: finance.now,
      })
      json(res, 200, { token })
    } catch (error) {
      if (error instanceof FinanceEvidenceTokenError) return safeError(res, 503, 'EXPENSE_STORAGE_UNAVAILABLE', true)
      respondReadError(res, error)
    }
    return
  }

  if (pathname === `${FINANCE_PREFIX}/evidence`) {
    if (!requirePermission(authenticated.canViewFinance, res, 'EXPENSE_FINANCE_PERMISSION_REQUIRED')) return
    if (req.method !== 'GET') return methodNotAllowed(res)
    if (rejectFramedGetBody(req, res)) return
    if (!finance?.reads) return routeNotFound(res)
    const tokens = url.searchParams.getAll('token')
    if (
      [...url.searchParams.keys()].some((key) => key !== 'token')
      || tokens.length !== 1
      || tokens[0]!.length < 3
      || tokens[0]!.length > MAX_TOKEN_LENGTH
    ) return invalidField(res)
    let claims
    try {
      claims = verifyFinanceEvidenceToken(tokens[0]!, {
        staffId: authenticated.staffId,
        secret: finance.signingSecret,
        now: finance.now,
      })
    } catch {
      return json(res, 403, { error: 'EXPENSE_EVIDENCE_TOKEN_INVALID' })
    }
    try {
      const evidence = await finance.reads.readStore.getEvidence(
        claims.monthKey,
        claims.expenseId,
        claims.attachmentId,
      )
      if (!evidence) return json(res, 404, { error: 'EXPENSE_EVIDENCE_NOT_FOUND' })
      res.statusCode = 200
      res.setHeader('content-type', evidence.mimeType)
      res.setHeader('content-length', String(evidence.bytes.length))
      res.setHeader('cache-control', 'private, no-store')
      res.end(evidence.bytes)
    } catch (error) {
      respondReadError(res, error)
    }
    return
  }

  const replaceRoute = new RegExp(`^${FINANCE_PREFIX}/expenses/([^/]+)/replace$`).exec(pathname)
  if (replaceRoute) {
    if (!requirePermission(authenticated.canManageExpense, res, 'EXPENSE_MANAGE_PERMISSION_REQUIRED')) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url)) return invalidField(res)
    if (!finance?.capture || !finance.reads) return routeNotFound(res)
    const expenseId = safeId(replaceRoute[1])
    const monthKey = expenseId ? monthFromExpenseId(expenseId) : null
    if (!expenseId || !monthKey) return invalidRequest(res)
    await handleReplace(req, res, expenseId, monthKey, authenticated, finance)
    return
  }

  const voidRoute = new RegExp(`^${FINANCE_PREFIX}/expenses/([^/]+)/void$`).exec(pathname)
  if (voidRoute) {
    if (!requirePermission(authenticated.canManageExpense, res, 'EXPENSE_MANAGE_PERMISSION_REQUIRED')) return
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!noQuery(url)) return invalidField(res)
    if (!finance?.capture || !finance.reads) return routeNotFound(res)
    const expenseId = safeId(voidRoute[1])
    const monthKey = expenseId ? monthFromExpenseId(expenseId) : null
    if (!expenseId || !monthKey) return invalidRequest(res)
    await handleVoid(req, res, expenseId, monthKey, authenticated, finance)
    return
  }

  routeNotFound(res)
}

async function handleStaging(
  req: IncomingMessage,
  res: ServerResponse,
  rootRequestId: string,
  authenticated: AuthenticatedMiniAppContext,
  finance: FinanceServerDependencies,
): Promise<void> {
  const staged: ExpenseStagingReceipt[] = []
  try {
    const batch = await consumeExpenseMultipart(req)
    for (const file of batch.files) {
      staged.push(await finance.capture!.staging.put({
        rootRequestId,
        ordinal: file.ordinal,
        originalFileName: file.originalFileName,
        mimeType: file.mimeType,
        bytes: file.bytes,
      }))
    }
    const stagingTokens = staged.map((receipt) => signExpenseStagingReceipt({
      receipt,
      staffId: authenticated.staffId,
      rootRequestId,
      secret: finance.signingSecret,
      now: finance.now,
    }))
    json(res, 200, { stagingTokens })
  } catch (error) {
    if (staged.length > 0) {
      await Promise.allSettled(staged.map(({ objectKey }) => finance.capture!.staging.deleteVerified(objectKey)))
    }
    if (error instanceof ExpenseMultipartError) {
      const status = error.code.includes('TOO_LARGE') || error.code.includes('BATCH_TOO_LARGE') ? 413
        : error.code === 'EXPENSE_UNSUPPORTED_IMAGE' ? 415 : 400
      return safeError(res, status, error.code, false)
    }
    safeError(res, 503, 'EXPENSE_STORAGE_UNAVAILABLE', true)
  }
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  authenticated: AuthenticatedMiniAppContext,
  finance: FinanceServerDependencies,
): Promise<void> {
  const body = await readExpenseJson(req, res)
  if (!body) return
  if (!hasExactKeys(body, [
    'rootRequestId', 'expenseDate', 'category', 'amountSatang', 'counterpartyName',
    'description', 'paymentMethod', 'expectedRevision', 'stagingTokens',
  ])) return invalidField(res)
  const parsed = parseSubmissionInput(body)
  if (!parsed) return invalidRequest(res)
  try {
    const stagingReceipts = await resolveStagingTokens(
      parsed.stagingTokens,
      parsed.rootRequestId,
      authenticated.staffId,
      finance,
    )
    const receipt = await finance.capture!.submission.submit({
      rootRequestId: parsed.rootRequestId,
      staffId: authenticated.staffId,
      expenseDate: parsed.expenseDate,
      category: parsed.category,
      amountSatang: parsed.amountSatang,
      counterpartyName: parsed.counterpartyName,
      description: parsed.description,
      paymentMethod: parsed.paymentMethod,
      expectedRevision: parsed.expectedRevision,
      stagingReceipts,
    })
    const projected = expenseReceipt(receipt)
    if (!projected) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
    json(res, 200, projected)
  } catch (error) {
    respondMutationError(res, error)
  }
}

async function handleReplace(
  req: IncomingMessage,
  res: ServerResponse,
  expenseId: string,
  monthKey: string,
  authenticated: AuthenticatedMiniAppContext,
  finance: FinanceServerDependencies,
): Promise<void> {
  const body = await readExpenseJson(req, res)
  if (!body) return
  if (!hasExactKeys(body, ['expectedVersion', 'expectedRevision', 'input']) || !isRecord(body.input)) {
    return invalidField(res)
  }
  if (!hasExactKeys(body.input, [
    'rootRequestId', 'expenseDate', 'category', 'amountSatang', 'counterpartyName',
    'description', 'paymentMethod', 'stagingTokens',
  ])) return invalidField(res)
  const expectedVersion = positiveInteger(body.expectedVersion)
  const expectedRevision = positiveInteger(body.expectedRevision)
  const parsed = parseSubmissionInput({ ...body.input, expectedRevision: body.expectedRevision })
  if (expectedVersion === null || expectedRevision === null || !parsed) return invalidRequest(res)
  try {
    const context = await finance.reads!.readStore.getExpenseMutationContext(monthKey, expenseId)
    if (!context) return safeError(res, 404, 'EXPENSE_NOT_FOUND', false)
    if (context.version !== expectedVersion || context.revision !== expectedRevision) {
      return safeError(res, 409, 'EXPENSE_REVISION_CONFLICT', false)
    }
    if (
      context.category === 'BILL_DOCUMENT'
      || parsed.category !== context.category
      || parsed.expenseDate !== context.expenseDate
      || deriveExpenseScope(parsed.category) !== context.scope
      || deriveBookDailyKey(parsed.category, parsed.expenseDate) !== context.bookDailyKey
    ) return safeError(res, 409, 'EXPENSE_IMMUTABLE_FIELD', false)
    const stagingReceipts = await resolveStagingTokens(
      parsed.stagingTokens,
      parsed.rootRequestId,
      authenticated.staffId,
      finance,
    )
    const receipt = await finance.capture!.submission.submit({
      rootRequestId: parsed.rootRequestId,
      staffId: authenticated.staffId,
      expenseDate: parsed.expenseDate,
      category: parsed.category,
      amountSatang: parsed.amountSatang,
      counterpartyName: parsed.counterpartyName,
      description: parsed.description,
      paymentMethod: parsed.paymentMethod,
      expectedRevision,
      stagingReceipts,
    })
    const projected = expenseReceipt(receipt)
    if (!projected) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
    json(res, 200, projected)
  } catch (error) {
    if (!res.writableEnded) respondMutationError(res, error)
  }
}

async function handleVoid(
  req: IncomingMessage,
  res: ServerResponse,
  expenseId: string,
  monthKey: string,
  authenticated: AuthenticatedMiniAppContext,
  finance: FinanceServerDependencies,
): Promise<void> {
  const body = await readExpenseJson(req, res)
  if (!body) return
  if (!hasExactKeys(body, ['rootRequestId', 'expectedVersion', 'expectedRevision', 'reason'])) return invalidField(res)
  const rootRequestId = typeof body.rootRequestId === 'string' && ROOT_REQUEST_ID.test(body.rootRequestId)
    ? body.rootRequestId : null
  const expectedVersion = positiveInteger(body.expectedVersion)
  const expectedRevision = positiveInteger(body.expectedRevision)
  const reason = boundedReason(body.reason)
  if (!rootRequestId || expectedVersion === null || expectedRevision === null || !reason) return invalidRequest(res)
  try {
    const context = await finance.reads!.readStore.getExpenseMutationContext(monthKey, expenseId)
    if (!context) return safeError(res, 404, 'EXPENSE_NOT_FOUND', false)
    if (context.version !== expectedVersion) return safeError(res, 409, 'EXPENSE_REVISION_CONFLICT', false)
    if (context.revision !== expectedRevision) return safeError(res, 409, 'EXPENSE_REVISION_CONFLICT', false)
    const command: Extract<MiniAppExpenseCommand, { commandType: 'VOID_EXPENSE' }> = {
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:void`,
      staffId: authenticated.staffId,
      commandType: 'VOID_EXPENSE',
      payload: { expenseId, expectedVersion, expectedRevision, reason },
    }
    const result = await finance.capture!.ingress.void(command)
    if (
      !isRecord(result)
      || (Object.keys(result).length !== 4 && Object.keys(result).length !== 5)
      || result.expenseId !== expenseId
      || result.recordState !== 'VOID'
      || result.version !== expectedVersion + 1
      || typeof result.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(result.updatedAt))
    ) throw new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE')
    json(res, 200, {
      expenseId,
      recordState: 'VOID',
      version: result.version,
      updatedAt: result.updatedAt,
    })
  } catch (error) {
    if (!res.writableEnded) respondMutationError(res, error)
  }
}

async function resolveStagingTokens(
  tokens: string[],
  rootRequestId: string,
  staffId: string,
  finance: FinanceServerDependencies,
): Promise<ExpenseStagingReceipt[]> {
  const receipts: ExpenseStagingReceipt[] = []
  const objectKeys = new Set<string>()
  for (const [index, token] of tokens.entries()) {
    let claims
    try {
      claims = verifyExpenseStagingReceipt(token, {
        staffId,
        rootRequestId,
        secret: finance.signingSecret,
        now: finance.now,
      })
    } catch {
      throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
    }
    if (claims.ordinal !== index + 1 || objectKeys.has(claims.objectKey)) {
      throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
    }
    objectKeys.add(claims.objectKey)
    let staged
    try {
      staged = await finance.capture!.staging.get(claims.objectKey)
    } catch {
      throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
    }
    const receipt: ExpenseStagingReceipt = {
      objectKey: staged.objectKey,
      sizeBytes: staged.sizeBytes,
      mimeType: staged.mimeType,
      sha256: staged.sha256,
      ordinal: staged.ordinal,
      originalFileName: staged.originalFileName,
      createdAt: staged.createdAt,
    }
    if (
      receipt.objectKey !== claims.objectKey
      || receipt.ordinal !== claims.ordinal
      || receipt.sha256 !== claims.sha256
    ) throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
    receipts.push(receipt)
  }
  return receipts
}

interface ParsedSubmissionInput {
  rootRequestId: string
  expenseDate: string
  category: EnabledExpenseCategory
  amountSatang: number
  counterpartyName: string | null
  description: string
  paymentMethod: ExpensePaymentMethod | null
  expectedRevision: number
  stagingTokens: string[]
}

function parseSubmissionInput(body: Record<string, unknown>): ParsedSubmissionInput | null {
  const rootRequestId = typeof body.rootRequestId === 'string' && ROOT_REQUEST_ID.test(body.rootRequestId)
    ? body.rootRequestId : null
  let expenseDate: string | null = null
  if (typeof body.expenseDate === 'string') {
    try { expenseDate = parseExpenseDate(body.expenseDate).expenseDate } catch { expenseDate = null }
  }
  const category = enabledCategory(body.category)
  const amountSatang = positiveInteger(body.amountSatang)
  const counterpartyName = nullableBoundedText(body.counterpartyName, 160)
  const description = boundedText(body.description, 500)
  const paymentMethod = paymentMethodValue(body.paymentMethod)
  const expectedRevision = nonNegativeInteger(body.expectedRevision)
  const stagingTokens = tokenArray(body.stagingTokens)
  if (
    !rootRequestId || !expenseDate || !category || amountSatang === null
    || counterpartyName === undefined || description === null || paymentMethod === undefined
    || expectedRevision === null || !stagingTokens
  ) return null
  if (
    category === 'BILL_DOCUMENT'
      ? expectedRevision !== 0 || !counterpartyName?.trim() || paymentMethod === null
      : counterpartyName !== null || paymentMethod !== null
  ) return null
  return {
    rootRequestId, expenseDate, category, amountSatang, counterpartyName,
    description, paymentMethod, expectedRevision, stagingTokens,
  }
}

async function readExpenseJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const contentType = singleHeader(req, 'content-type')
  if (!contentType || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    safeError(res, 415, 'EXPENSE_JSON_REQUIRED', false)
    return null
  }
  const contentLength = singleHeader(req, 'content-length')
  if (contentLength === null && req.headers['content-length'] !== undefined) {
    invalidRequest(res)
    return null
  }
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      invalidRequest(res)
      return null
    }
    if (Number(contentLength) > MAX_JSON_BYTES) {
      safeError(res, 413, 'EXPENSE_PAYLOAD_TOO_LARGE', false)
      return null
    }
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (!Number.isSafeInteger(size) || size > MAX_JSON_BYTES) {
        safeError(res, 413, 'EXPENSE_PAYLOAD_TOO_LARGE', false)
        return null
      }
      chunks.push(bytes)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    if (hasDuplicateJsonKeys(raw)) {
      invalidField(res)
      return null
    }
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    safeError(res, 400, 'EXPENSE_INVALID_JSON', false)
    return null
  }
}

function hasDuplicateJsonKeys(value: string): boolean {
  const keys = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '"') continue
    const start = index
    index += 1
    let escaped = false
    while (index < value.length) {
      const character = value[index]!
      if (!escaped && character === '"') break
      if (!escaped && character === '\\') escaped = true
      else escaped = false
      index += 1
    }
    if (index >= value.length) return false
    let next = index + 1
    while (/\s/.test(value[next] ?? '')) next += 1
    if (value[next] !== ':') continue
    let key: string
    try { key = JSON.parse(value.slice(start, index + 1)) as string } catch { return false }
    if (keys.has(key)) return true
    keys.add(key)
  }
  return false
}

function exactHistoryQuery(url: URL): { monthKey: string; cursor: string | null } | null {
  if ([...url.searchParams.keys()].some((key) => key !== 'month' && key !== 'cursor')) return null
  const months = url.searchParams.getAll('month')
  const cursors = url.searchParams.getAll('cursor')
  if (months.length !== 1 || cursors.length > 1) return null
  const monthKey = validMonthKey(months[0]!)
  if (!monthKey) return null
  const cursor = cursors[0] ?? null
  if (cursor !== null && (cursor.length < 3 || cursor.length > 256)) return null
  return { monthKey, cursor }
}

function respondMutationError(res: ServerResponse, error: unknown): void {
  if (
    error instanceof ExpenseSubmissionError
    || error instanceof ExpenseIngressClientError
  ) {
    const code = error.code
    return safeError(res, mutationStatus(code), code, error.retryable)
  }
  if (error instanceof ExpenseStagingTokenError || error instanceof ExpenseStagingError) {
    return safeError(res, 400, 'EXPENSE_INVALID_ATTACHMENTS', false)
  }
  safeError(res, 503, 'EXPENSE_STORAGE_UNAVAILABLE', true)
}

function respondReadError(res: ServerResponse, error: unknown): void {
  if (error instanceof FinanceReadStoreError) {
    const status = error.code === 'EXPENSE_INVALID_MONTH' || error.code === 'EXPENSE_INVALID_CURSOR' ? 400
      : error.code === 'EXPENSE_DATA_INTEGRITY_ERROR' ? 500 : 503
    json(res, status, { error: error.code })
    return
  }
  json(res, 503, { error: 'EXPENSE_STORAGE_UNAVAILABLE' })
}

function mutationStatus(code: string): number {
  if (code === 'EXPENSE_STAFF_REQUIRED' || code === 'EXPENSE_RESUME_FORBIDDEN' || code.endsWith('_PERMISSION_REQUIRED')) return 403
  if (code === 'EXPENSE_NOT_FOUND') return 404
  if (['EXPENSE_IDEMPOTENCY_CONFLICT', 'EXPENSE_NOT_PREPARED', 'EXPENSE_REVISION_CONFLICT',
    'EXPENSE_IMMUTABLE_FIELD', 'EXPENSE_PRIVATE_FILE_INVALID'].includes(code)) return 409
  if (code === 'EXPENSE_STORAGE_UNAVAILABLE') return 503
  return 400
}

function expenseReceipt(value: ExpenseReceipt): ExpenseReceipt | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'expenseId', 'receiptNumber', 'expenseDate', 'monthKey', 'category', 'scope',
      'amountSatang', 'recordState', 'revision', 'committedAt', 'unreviewed',
    ])
    || !SAFE_ID.test(String(value.expenseId))
    || value.receiptNumber !== value.expenseId
    || typeof value.expenseDate !== 'string'
    || typeof value.monthKey !== 'string'
    || parseDateMonth(value.expenseDate) !== value.monthKey
    || !enabledCategory(value.category)
    || value.scope !== deriveExpenseScope(value.category)
    || positiveInteger(value.amountSatang) === null
    || value.recordState !== 'COMMITTED'
    || positiveInteger(value.revision) === null
    || typeof value.committedAt !== 'string'
    || !Number.isFinite(Date.parse(value.committedAt))
    || value.unreviewed !== true
  ) return null
  return {
    expenseId: value.expenseId,
    receiptNumber: value.receiptNumber,
    expenseDate: value.expenseDate,
    monthKey: value.monthKey,
    category: value.category,
    scope: value.scope,
    amountSatang: value.amountSatang,
    recordState: 'COMMITTED',
    revision: value.revision,
    committedAt: value.committedAt,
    unreviewed: true,
  }
}

function parseDateMonth(value: string): string | null {
  try { return parseExpenseDate(value).monthKey } catch { return null }
}

function tokenArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null
  if (value.some((token) => typeof token !== 'string' || token.length < 3 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token))) return null
  if (new Set(value).size !== value.length) return null
  return [...value]
}

function enabledCategory(value: unknown): EnabledExpenseCategory | null {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL' ? value : null
}

function paymentMethodValue(value: unknown): ExpensePaymentMethod | null | undefined {
  if (value === null) return null
  return value === 'TRANSFER' || value === 'CASH' || value === 'CREDIT' || value === 'OTHER' ? value : undefined
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || forbiddenText(value)) return null
  return value
}

function nullableBoundedText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null
  return boundedText(value, maximum) ?? undefined
}

function boundedReason(value: unknown): string | null {
  const reason = boundedText(value, 300)
  return reason && reason.trim().length >= 3 ? reason : null
}

function forbiddenText(value: string): boolean {
  return [...value].some((character) => [0, 10, 13, 127].includes(character.charCodeAt(0)))
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function validMonthKey(value: string): string | null {
  try { return parseExpenseDate(`${value}-01`).monthKey === value ? value : null } catch { return null }
}

function monthFromExpenseId(value: string): string | null {
  const match = /^EXP-(\d{4})(\d{2})-[A-Za-z0-9._:-]{1,107}$/.exec(value)
  return match ? validMonthKey(`${match[1]}-${match[2]}`) : null
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null
}

function requirePermission(granted: boolean, res: ServerResponse, code: string): boolean {
  if (granted === true) return true
  json(res, 403, { error: code })
  return false
}

function noQuery(url: URL): boolean {
  return [...url.searchParams].length === 0
}

function emptyBody(req: IncomingMessage): boolean {
  const contentLength = singleHeader(req, 'content-length')
  return req.headers['transfer-encoding'] === undefined
    && (contentLength === null ? req.headers['content-length'] === undefined : contentLength === '0')
}

function rejectFramedGetBody(req: IncomingMessage, res: ServerResponse): boolean {
  const contentLengths = rawHeaderValues(req, 'content-length')
  const transferEncodings = rawHeaderValues(req, 'transfer-encoding')
  const expects = rawHeaderValues(req, 'expect')
  const invalid = transferEncodings.length > 0
    || expects.length > 0
    || contentLengths.length > 1
    || contentLengths.length === 1 && contentLengths[0] !== '0'
  if (!invalid) return false

  req.on('error', () => undefined)
  req.resume()
  res.setHeader('connection', 'close')
  res.once('finish', () => {
    if (!req.complete) req.destroy()
  })
  invalidRequest(res)
  return true
}

function rawHeaderValues(req: IncomingMessage, name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === name) values.push(req.rawHeaders[index + 1] ?? '')
  }
  return values
}

function singleHeader(req: IncomingMessage, name: string): string | null {
  const values = rawHeaderValues(req, name)
  return values.length === 1 ? values[0]! : null
}

function hasExactKeys<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): value is Record<T[number], unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
}

function routeNotFound(res: ServerResponse): void {
  json(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
}

function invalidField(res: ServerResponse): void {
  safeError(res, 400, 'EXPENSE_UNKNOWN_FIELD', false)
}

function invalidRequest(res: ServerResponse): void {
  safeError(res, 400, 'EXPENSE_INVALID_REQUEST', false)
}

function invalidMonth(res: ServerResponse): void {
  safeError(res, 400, 'EXPENSE_INVALID_MONTH', false)
}

function safeError(res: ServerResponse, status: number, code: string, retryable: boolean): void {
  const safeCode = isMiniAppExpenseSafeErrorCode(code)
    || /^EXPENSE_[A-Z0-9_]{1,80}$/.test(code)
    ? code : 'EXPENSE_STORAGE_UNAVAILABLE'
  json(res, status, { error: safeCode, retryable })
}

function json(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
