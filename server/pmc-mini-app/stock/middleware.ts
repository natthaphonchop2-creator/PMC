import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MiniAppStockCommand, StockCategory, StockDocumentSummary } from '../../../shared/pmcStock.js'
import { isMiniAppStockSafeErrorCode } from '../../../shared/pmcMiniAppStockIngress.js'
import type { AuthenticatedMiniAppContext, StockServerDependencies } from '../contracts.js'
import { StockIngressClientError } from './ingressClient.js'
import { StockReadStoreError } from './readStore.js'

const STOCK_PREFIX = '/api/mini-app/stock'
const MAX_JSON_BYTES = 64 * 1024
const HISTORY_PAGE_SIZE = 25

export function isStockMiniAppApiPath(pathname: string): boolean {
  return pathname === STOCK_PREFIX || pathname.startsWith(`${STOCK_PREFIX}/`)
}

export async function handleStockMiniAppApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  authenticated: AuthenticatedMiniAppContext,
  stock: StockServerDependencies,
): Promise<void> {
  const { pathname } = url
  if (pathname === `${STOCK_PREFIX}/products`) {
    if (req.method === 'GET') {
      if (!noQuery(url)) return respond(res, 400, { error: 'STOCK_UNKNOWN_FIELD' })
      try {
        const products = await stock.readStore.listProducts()
        respond(res, 200, {
          products: authenticated.canManageStock ? products : products.filter(({ active }) => active),
        })
      } catch (error) {
        respondReadError(res, error)
      }
      return
    }
    if (req.method === 'POST') {
      if (!authenticated.canManageStock) return managerRequired(res)
      const body = await readStockJson(req, res)
      if (!body) return
      if (!hasExactKeys(body, [
        'requestId', 'name', 'category', 'unit', 'openingQuantityMilli', 'minimumQuantityMilli',
      ])) return unknownField(res)
      const command = createProductCommand(body, authenticated.staffId)
      if (!command) return invalidProduct(res)
      await forwardCommand(res, stock, command)
      return
    }
    return methodNotAllowed(res)
  }

  if (pathname === `${STOCK_PREFIX}/history`) {
    if (req.method !== 'GET') return methodNotAllowed(res)
    const cursors = url.searchParams.getAll('cursor')
    if ([...url.searchParams.keys()].some((key) => key !== 'cursor') || cursors.length > 1) return unknownField(res)
    const cursor = cursors[0] ?? null
    if (cursor !== null && (cursor.length < 1 || cursor.length > 512)) return respond(res, 400, { error: 'STOCK_INVALID_CURSOR' })
    try {
      const page = await stock.readStore.listHistory(cursor, HISTORY_PAGE_SIZE)
      respond(res, 200, {
        ...page,
        documents: page.documents.map((document) => visibleDocument(document, authenticated.canManageStock)),
      })
    } catch (error) {
      respondReadError(res, error)
    }
    return
  }

  const documentRoute = new RegExp(`^${STOCK_PREFIX}/documents/([A-Za-z0-9._:-]{1,124})$`).exec(pathname)
  if (documentRoute) {
    if (req.method !== 'GET') return methodNotAllowed(res)
    if (!noQuery(url)) return unknownField(res)
    try {
      const document = await stock.readStore.getDocument(documentRoute[1]!)
      if (!document) return respond(res, 404, { error: 'STOCK_DOCUMENT_NOT_FOUND' })
      respond(res, 200, visibleDocument(document, authenticated.canManageStock))
    } catch (error) {
      respondReadError(res, error)
    }
    return
  }

  if (pathname === `${STOCK_PREFIX}/issues`) {
    if (req.method !== 'POST') return methodNotAllowed(res)
    const body = await readStockJson(req, res)
    if (!body) return
    if (!hasExactKeys(body, ['requestId', 'lines'])) return unknownField(res)
    const command = lineCommand(body, authenticated.staffId, 'ISSUE')
    if (command === 'UNKNOWN_FIELD') return unknownField(res)
    if (command === 'INVALID_ID') return respond(res, 400, { error: 'STOCK_INVALID_ID' })
    if (command === 'DUPLICATE') return respond(res, 400, { error: 'STOCK_DUPLICATE_LINE' })
    if (!command) return respond(res, 400, { error: 'STOCK_INVALID_QUANTITY' })
    await forwardCommand(res, stock, command)
    return
  }

  if (pathname === `${STOCK_PREFIX}/receipts`) {
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!authenticated.canManageStock) return managerRequired(res)
    const body = await readStockJson(req, res)
    if (!body) return
    if (!hasExactKeys(body, ['requestId', 'lines'])) return unknownField(res)
    const command = lineCommand(body, authenticated.staffId, 'RECEIVE')
    if (command === 'UNKNOWN_FIELD') return unknownField(res)
    if (command === 'INVALID_ID') return respond(res, 400, { error: 'STOCK_INVALID_ID' })
    if (command === 'DUPLICATE') return respond(res, 400, { error: 'STOCK_DUPLICATE_LINE' })
    if (!command) return respond(res, 400, { error: 'STOCK_INVALID_QUANTITY' })
    await forwardCommand(res, stock, command)
    return
  }

  if (pathname === `${STOCK_PREFIX}/adjustments`) {
    if (req.method !== 'POST') return methodNotAllowed(res)
    if (!authenticated.canManageStock) return managerRequired(res)
    const body = await readStockJson(req, res)
    if (!body) return
    if (!hasExactKeys(body, ['requestId', 'productId', 'countedQuantityMilli', 'reason'])) return unknownField(res)
    if (!safeId(body.requestId) || !safeId(body.productId)) return respond(res, 400, { error: 'STOCK_INVALID_ID' })
    if (nonNegativeInteger(body.countedQuantityMilli) === null) return respond(res, 400, { error: 'STOCK_INVALID_QUANTITY' })
    if (!boundedTrimmed(body.reason, 300)) return respond(res, 400, { error: 'STOCK_ADJUST_REASON_REQUIRED' })
    const command = adjustmentCommand(body, authenticated.staffId)
    if (!command) return respond(res, 400, { error: 'STOCK_INVALID_PRODUCT' })
    await forwardCommand(res, stock, command)
    return
  }

  const productRoute = new RegExp(`^${STOCK_PREFIX}/products/([A-Za-z0-9._:-]{1,124})$`).exec(pathname)
  if (productRoute) {
    if (req.method !== 'PATCH') return methodNotAllowed(res)
    if (!authenticated.canManageStock) return managerRequired(res)
    const body = await readStockJson(req, res)
    if (!body) return
    const command = patchProductCommand(body, productRoute[1]!, authenticated.staffId)
    if (command === 'UNKNOWN_FIELD') return unknownField(res)
    if (!command) return invalidProduct(res)
    await forwardCommand(res, stock, command)
    return
  }

  respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
}

function createProductCommand(
  body: Record<string, unknown>,
  staffId: string,
): Extract<MiniAppStockCommand, { commandType: 'CREATE_PRODUCT' }> | null {
  const requestId = requestIdValue(body.requestId)
  const name = boundedTrimmed(body.name, 300)
  const category = categoryValue(body.category)
  const unit = boundedTrimmed(body.unit, 100)
  const openingQuantityMilli = nonNegativeInteger(body.openingQuantityMilli)
  const minimumQuantityMilli = nonNegativeInteger(body.minimumQuantityMilli)
  if (!requestId || !name || !category || !unit || openingQuantityMilli === null || minimumQuantityMilli === null) return null
  return {
    requestId, staffId, commandType: 'CREATE_PRODUCT',
    payload: { name, category, unit, openingQuantityMilli, minimumQuantityMilli },
  }
}

function lineCommand(
  body: Record<string, unknown>,
  staffId: string,
  commandType: 'RECEIVE' | 'ISSUE',
): Extract<MiniAppStockCommand, { commandType: 'RECEIVE' | 'ISSUE' }> | 'DUPLICATE' | 'INVALID_ID' | 'UNKNOWN_FIELD' | null {
  if (!safeId(body.requestId)) return 'INVALID_ID'
  const requestId = body.requestId
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) return null
  const lines: Array<{ productId: string; quantityMilli: number }> = []
  const productIds = new Set<string>()
  for (const line of body.lines) {
    if (!hasExactKeys(line, ['productId', 'quantityMilli'])) return 'UNKNOWN_FIELD'
    if (!safeId(line.productId)) return 'INVALID_ID'
    const productId = line.productId
    const quantityMilli = positiveInteger(line.quantityMilli)
    if (quantityMilli === null) return null
    if (productIds.has(productId)) return 'DUPLICATE'
    productIds.add(productId)
    lines.push({ productId, quantityMilli })
  }
  return { requestId, staffId, commandType, payload: { lines } }
}

function adjustmentCommand(
  body: Record<string, unknown>,
  staffId: string,
): Extract<MiniAppStockCommand, { commandType: 'ADJUST' }> | null {
  const requestId = requestIdValue(body.requestId)
  const productId = safeId(body.productId) ? body.productId : null
  const countedQuantityMilli = nonNegativeInteger(body.countedQuantityMilli)
  const reason = boundedTrimmed(body.reason, 300)
  if (!requestId || !productId || countedQuantityMilli === null || !reason) return null
  return { requestId, staffId, commandType: 'ADJUST', payload: { productId, countedQuantityMilli, reason } }
}

function patchProductCommand(
  body: Record<string, unknown>,
  productId: string,
  staffId: string,
): MiniAppStockCommand | 'UNKNOWN_FIELD' | null {
  if (body.action === 'UPDATE') {
    if (!hasExactKeys(body, [
      'requestId', 'action', 'expectedVersion', 'name', 'category', 'unit', 'minimumQuantityMilli',
    ])) return 'UNKNOWN_FIELD'
    const requestId = requestIdValue(body.requestId)
    const expectedVersion = positiveInteger(body.expectedVersion)
    const name = boundedTrimmed(body.name, 300)
    const category = categoryValue(body.category)
    const unit = boundedTrimmed(body.unit, 100)
    const minimumQuantityMilli = nonNegativeInteger(body.minimumQuantityMilli)
    if (!requestId || expectedVersion === null || !name || !category || !unit || minimumQuantityMilli === null) return null
    return {
      requestId, staffId, commandType: 'UPDATE_PRODUCT',
      payload: { productId, expectedVersion, name, category, unit, minimumQuantityMilli },
    }
  }
  if (body.action === 'DEACTIVATE' || body.action === 'REACTIVATE') {
    if (!hasExactKeys(body, ['requestId', 'action', 'expectedVersion'])) return 'UNKNOWN_FIELD'
    const requestId = requestIdValue(body.requestId)
    const expectedVersion = positiveInteger(body.expectedVersion)
    if (!requestId || expectedVersion === null) return null
    return {
      requestId,
      staffId,
      commandType: body.action === 'DEACTIVATE' ? 'DEACTIVATE_PRODUCT' : 'REACTIVATE_PRODUCT',
      payload: { productId, expectedVersion },
    }
  }
  return 'UNKNOWN_FIELD'
}

async function forwardCommand(
  res: ServerResponse,
  stock: StockServerDependencies,
  command: MiniAppStockCommand,
): Promise<void> {
  try {
    respond(res, 200, await stock.ingress.send(command))
  } catch (error) {
    const code = safeCommandError(error)
    respond(res, commandErrorStatus(code), { error: code })
  }
}

function safeCommandError(error: unknown): string {
  if (!(error instanceof StockIngressClientError)) return 'STOCK_STORAGE_UNAVAILABLE'
  const candidate = error.code
  if (candidate === 'STOCK_DUPLICATE_PRODUCT') return 'STOCK_DUPLICATE_LINE'
  if (isMiniAppStockSafeErrorCode(candidate)) return candidate
  return 'STOCK_STORAGE_UNAVAILABLE'
}

function commandErrorStatus(code: string): number {
  if (code === 'STOCK_MANAGER_REQUIRED') return 403
  if (code === 'STOCK_PRODUCT_NOT_FOUND') return 404
  if (code === 'STOCK_STORAGE_UNAVAILABLE' || code === 'STOCK_RECOVERY_REQUIRED') return 503
  if (['STOCK_INSUFFICIENT_BALANCE', 'STOCK_PRODUCT_INACTIVE', 'STOCK_STALE_PRODUCT',
    'STOCK_PRODUCT_NAME_EXISTS', 'STOCK_UNIT_LOCKED', 'STOCK_IDEMPOTENCY_CONFLICT'].includes(code)) return 409
  return 400
}

async function readStockJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    respond(res, 415, { error: 'STOCK_JSON_REQUIRED' })
    return null
  }
  const advertised = Number(req.headers['content-length'])
  if (Number.isFinite(advertised) && advertised > MAX_JSON_BYTES) {
    respond(res, 413, { error: 'STOCK_PAYLOAD_TOO_LARGE' })
    return null
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_JSON_BYTES) {
        respond(res, 413, { error: 'STOCK_PAYLOAD_TOO_LARGE' })
        return null
      }
      chunks.push(bytes)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch {
    respond(res, 400, { error: 'STOCK_INVALID_JSON' })
    return null
  }
}

function respondReadError(res: ServerResponse, error: unknown): void {
  if (error instanceof StockReadStoreError) {
    const status = error.code === 'STOCK_INVALID_CURSOR' ? 400
      : error.code === 'STOCK_DATA_INTEGRITY_ERROR' ? 500 : 503
    respond(res, status, { error: error.code })
    return
  }
  respond(res, 503, { error: 'STOCK_STORAGE_UNAVAILABLE' })
}

function noQuery(url: URL): boolean {
  return [...url.searchParams].length === 0
}

function visibleDocument(document: StockDocumentSummary, canManageStock: boolean): StockDocumentSummary {
  return canManageStock || !document.reason ? document : { ...document, reason: '' }
}

function requestIdValue(value: unknown): string | null {
  return safeId(value) ? value : null
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function categoryValue(value: unknown): StockCategory | null {
  return value === 'CLINIC_SUPPLY' || value === 'RETAIL_PRODUCT' ? value : null
}

function boundedTrimmed(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maximum && !hasForbiddenTextCharacter(trimmed) ? trimmed : null
}

function hasForbiddenTextCharacter(value: string): boolean {
  return [...value].some((character) => [0, 10, 13].includes(character.charCodeAt(0)))
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function hasExactKeys<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): value is Record<T[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function managerRequired(res: ServerResponse): void {
  respond(res, 403, { error: 'STOCK_MANAGER_REQUIRED' })
}

function unknownField(res: ServerResponse): void {
  respond(res, 400, { error: 'STOCK_UNKNOWN_FIELD' })
}

function invalidProduct(res: ServerResponse): void {
  respond(res, 400, { error: 'STOCK_INVALID_PRODUCT' })
}

function methodNotAllowed(res: ServerResponse): void {
  respond(res, 405, { error: 'STOCK_METHOD_NOT_ALLOWED' })
}

function respond(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
