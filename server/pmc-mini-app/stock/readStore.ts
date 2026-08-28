import type {
  StockAuditEvent,
  StockDocumentSummary,
  StockLedgerEntry,
  StockProduct,
  StockTransactionType,
} from '../../../shared/pmcStock.js'
import type { MiniAppSheetsPort } from '../googleClient.js'
import {
  STOCK_AUDIT_HEADERS,
  STOCK_LEDGER_HEADERS,
  STOCK_PRODUCT_HEADERS,
} from '../setup.js'
import type { StockProductProjection, StockReadStore } from '../contracts.js'

const PRODUCT_RANGE = "'STOCK_PRODUCTS'!A:L"
const LEDGER_RANGE = "'STOCK_LEDGER'!A:N"
const AUDIT_RANGE = "'STOCK_AUDIT'!A:I"
const STOCK_RANGES = [PRODUCT_RANGE, LEDGER_RANGE, AUDIT_RANGE] as const
const TRANSACTION_TYPES = new Set<StockTransactionType>(['OPENING', 'RECEIVE', 'ISSUE', 'ADJUST'])
const COMMAND_ACTIONS = new Set([
  'CREATE_PRODUCT', 'RECEIVE', 'ISSUE', 'ADJUST', 'UPDATE_PRODUCT',
  'DEACTIVATE_PRODUCT', 'REACTIVATE_PRODUCT',
])
const AUDIT_STATUSES = new Set<StockAuditEvent['status']>(['PREPARED', 'ACCEPTED', 'REJECTED', 'RECOVERED'])

export type StockReadStoreErrorCode =
  | 'STOCK_DATA_INTEGRITY_ERROR'
  | 'STOCK_INVALID_CURSOR'
  | 'STOCK_STORAGE_UNAVAILABLE'

export class StockReadStoreError extends Error {
  readonly code: StockReadStoreErrorCode

  constructor(code: StockReadStoreErrorCode) {
    super(`Stock read failed: ${code}`)
    this.name = 'StockReadStoreError'
    this.code = code
  }
}

export function createStockReadStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): StockReadStore {
  const spreadsheetId = input.spreadsheetId.trim()
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(spreadsheetId)) {
    throw new Error('Invalid Stock read-store configuration')
  }

  async function snapshot(): Promise<StockSnapshot> {
    let ranges: Record<string, unknown[][]>
    try {
      ranges = await input.sheets.batchGet(spreadsheetId, [...STOCK_RANGES])
    } catch {
      throw new StockReadStoreError('STOCK_STORAGE_UNAVAILABLE')
    }
    return validateSnapshot(ranges)
  }

  return {
    async listProducts() {
      return (await snapshot()).projections
    },
    async listHistory(cursor, pageSize) {
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new StockReadStoreError('STOCK_INVALID_CURSOR')
      }
      const documents = (await snapshot()).documents
      const start = cursor === null ? 0 : cursorStart(cursor, documents)
      const pageDocuments = documents.slice(start, start + pageSize)
      const nextIndex = start + pageDocuments.length
      return {
        documents: pageDocuments,
        nextCursor: nextIndex < documents.length
          ? encodeCursor(pageDocuments[pageDocuments.length - 1]!)
          : null,
      }
    },
    async getDocument(documentId) {
      if (!safeId(documentId)) return null
      return (await snapshot()).documents.find((document) => document.documentId === documentId) ?? null
    },
  }
}

interface StockSnapshot {
  projections: StockProductProjection[]
  documents: StockDocumentSummary[]
}

function validateSnapshot(ranges: Record<string, unknown[][]>): StockSnapshot {
  try {
    const productRows = requireRows(ranges[PRODUCT_RANGE], STOCK_PRODUCT_HEADERS)
    const ledgerRows = requireRows(ranges[LEDGER_RANGE], STOCK_LEDGER_HEADERS)
    const auditRows = requireRows(ranges[AUDIT_RANGE], STOCK_AUDIT_HEADERS)
    const products = productRows.map(parseProduct)
    const productIds = uniqueIds(products.map(({ productId }) => productId))
    const ledger = ledgerRows.map(parseLedgerEntry)
    const balances = validateLedger(ledger, productIds)
    validateAudit(auditRows.map(parseAuditEvent), ledger)

    const productsById = new Map(products.map((product) => [product.productId, product]))
    const activity = new Set(ledger.map(({ productId }) => productId))
    const projections = products.map((product) => {
      const onHandMilli = balances.get(product.productId) ?? 0
      return {
        productId: product.productId,
        name: product.name,
        category: product.category,
        unit: product.unit,
        minimumQuantityMilli: product.minimumQuantityMilli,
        onHandMilli,
        lowStock: onHandMilli <= product.minimumQuantityMilli,
        active: product.active,
        hasLedgerActivity: activity.has(product.productId),
        version: product.version,
      }
    })
    return { projections, documents: buildDocuments(ledger, productsById) }
  } catch (error) {
    if (error instanceof StockReadStoreError) throw error
    throw new StockReadStoreError('STOCK_DATA_INTEGRITY_ERROR')
  }
}

function requireRows<const T extends readonly string[]>(
  rows: unknown[][] | undefined,
  headers: T,
): unknown[][] {
  if (!Array.isArray(rows) || rows.length === 0 || !sameRow(rows[0], headers)) integrity()
  return rows.slice(1).map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) integrity()
    return row
  })
}

function parseProduct(row: unknown[]): StockProduct {
  const productId = id(row[0])
  const name = nonEmptyText(row[1], 300)
  const normalizedName = nonEmptyText(row[2], 300)
  const category = row[3]
  if (category !== 'CLINIC_SUPPLY' && category !== 'RETAIL_PRODUCT') integrity()
  const unit = nonEmptyText(row[4], 100)
  const minimumQuantityMilli = integer(row[5], { minimum: 0 })
  const active = boolean(row[6])
  const createdAt = timestamp(row[7])
  const createdByStaffId = id(row[8])
  const updatedAt = timestamp(row[9])
  const updatedByStaffId = id(row[10])
  const version = integer(row[11], { minimum: 1 })
  return {
    productId, name, normalizedName, category, unit, minimumQuantityMilli, active,
    createdAt, createdByStaffId, updatedAt, updatedByStaffId, version,
  }
}

function parseLedgerEntry(row: unknown[]): StockLedgerEntry {
  const transactionId = id(row[0])
  const documentId = id(row[1])
  const requestId = id(row[2])
  const lineNumber = integer(row[3], { minimum: 1 })
  const productId = id(row[4])
  const transactionType = row[5]
  if (typeof transactionType !== 'string' || !TRANSACTION_TYPES.has(transactionType as StockTransactionType)) integrity()
  const quantityDeltaMilli = integer(row[6])
  const balanceBeforeMilli = integer(row[7], { minimum: 0 })
  const balanceAfterMilli = integer(row[8], { minimum: 0 })
  const actorStaffId = id(row[9])
  const actorDisplayName = nonEmptyText(row[10], 300)
  const reason = text(row[11], 300)
  const idempotencyKey = id(row[12])
  const createdAt = timestamp(row[13])
  if (
    ((transactionType === 'OPENING' || transactionType === 'RECEIVE') && quantityDeltaMilli <= 0) ||
    (transactionType === 'ISSUE' && quantityDeltaMilli >= 0) ||
    (transactionType === 'ADJUST' && quantityDeltaMilli === 0)
  ) integrity()
  return {
    transactionId, documentId, requestId, lineNumber, productId,
    transactionType: transactionType as StockTransactionType,
    quantityDeltaMilli, balanceBeforeMilli, balanceAfterMilli, actorStaffId,
    actorDisplayName, reason, idempotencyKey, createdAt,
  }
}

function validateLedger(entries: StockLedgerEntry[], productIds: Set<string>): Map<string, number> {
  const transactionIds = new Set<string>()
  const idempotencyKeys = new Set<string>()
  const documentsByRequest = new Map<string, string>()
  const requestsByDocument = new Map<string, string>()
  const balances = new Map<string, number>()
  const documentRows = new Map<string, StockLedgerEntry[]>()

  for (const entry of entries) {
    if (
      !productIds.has(entry.productId) ||
      transactionIds.has(entry.transactionId) ||
      idempotencyKeys.has(entry.idempotencyKey)
    ) integrity()
    transactionIds.add(entry.transactionId)
    idempotencyKeys.add(entry.idempotencyKey)
    if (documentsByRequest.has(entry.requestId) && documentsByRequest.get(entry.requestId) !== entry.documentId) integrity()
    if (requestsByDocument.has(entry.documentId) && requestsByDocument.get(entry.documentId) !== entry.requestId) integrity()
    documentsByRequest.set(entry.requestId, entry.documentId)
    requestsByDocument.set(entry.documentId, entry.requestId)

    const balanceBeforeMilli = balances.get(entry.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli + entry.quantityDeltaMilli
    if (
      !Number.isSafeInteger(balanceAfterMilli) ||
      balanceAfterMilli < 0 ||
      entry.balanceBeforeMilli !== balanceBeforeMilli ||
      entry.balanceAfterMilli !== balanceAfterMilli
    ) integrity()
    balances.set(entry.productId, balanceAfterMilli)
    const rows = documentRows.get(entry.documentId) ?? []
    rows.push(entry)
    documentRows.set(entry.documentId, rows)
  }

  for (const rows of documentRows.values()) validateDocumentRows(rows)
  return balances
}

function validateDocumentRows(rows: StockLedgerEntry[]): void {
  const first = rows[0]!
  const lineNumbers = new Set<number>()
  const productIds = new Set<string>()
  for (const row of rows) {
    if (
      row.requestId !== first.requestId ||
      row.transactionType !== first.transactionType ||
      row.actorStaffId !== first.actorStaffId ||
      row.actorDisplayName !== first.actorDisplayName ||
      row.reason !== first.reason ||
      row.createdAt !== first.createdAt ||
      lineNumbers.has(row.lineNumber) ||
      productIds.has(row.productId)
    ) integrity()
    lineNumbers.add(row.lineNumber)
    productIds.add(row.productId)
  }
  const ordered = [...lineNumbers].sort((left, right) => left - right)
  if (ordered.some((line, index) => line !== index + 1)) integrity()
}

function parseAuditEvent(row: unknown[]): StockAuditEvent {
  const eventId = id(row[0])
  const requestId = id(row[1])
  const actorStaffId = id(row[2])
  const action = row[3]
  if (typeof action !== 'string' || !COMMAND_ACTIONS.has(action)) integrity()
  const status = row[4]
  if (typeof status !== 'string' || !AUDIT_STATUSES.has(status as StockAuditEvent['status'])) integrity()
  const safeErrorCode = text(row[5], 80)
  if (safeErrorCode && !/^STOCK_[A-Z0-9_]{1,70}$/.test(safeErrorCode)) integrity()
  const targetProductIdsJson = text(row[6], 4_096)
  const correlationId = text(row[7], 300)
  const createdAt = timestamp(row[8])
  parseTargets(targetProductIdsJson)
  return {
    eventId, requestId, actorStaffId, action,
    status: status as StockAuditEvent['status'],
    safeErrorCode, targetProductIdsJson, correlationId, createdAt,
  }
}

function validateAudit(events: StockAuditEvent[], ledger: StockLedgerEntry[]): void {
  uniqueIds(events.map(({ eventId }) => eventId))
  const journals = new Map<string, { prepared: StockAuditEvent[]; accepted: StockAuditEvent[] }>()
  for (const event of events) {
    if (event.status !== 'PREPARED' && event.status !== 'ACCEPTED') continue
    validateJournalEvent(event)
    const journal = journals.get(event.requestId) ?? { prepared: [], accepted: [] }
    if (event.status === 'PREPARED') journal.prepared.push(event)
    else journal.accepted.push(event)
    journals.set(event.requestId, journal)
  }

  let unresolved = 0
  for (const [requestId, journal] of journals) {
    if (journal.prepared.length !== 1 || journal.accepted.length > 1) integrity()
    const prepared = journal.prepared[0]!
    const accepted = journal.accepted[0]
    if (!accepted) unresolved += 1
    else if (!sameJournalIntent(prepared, accepted)) integrity()

    const requestEntries = ledger.filter((entry) => entry.requestId === requestId)
    if (requestEntries.length > 0) {
      const documentId = journalDocumentId(prepared)
      if (
        requestEntries.some((entry) => entry.documentId !== documentId) ||
        !journalActionMatchesTransaction(prepared.action, requestEntries[0]!.transactionType)
      ) integrity()
    }
  }
  if (unresolved > 1) integrity()
}

function validateJournalEvent(event: StockAuditEvent): void {
  const targets = parseTargets(event.targetProductIdsJson)
  if (
    event.safeErrorCode !== '' ||
    targets.length === 0 ||
    !/^([A-Za-z0-9._:-]{1,124})\|[a-f0-9]{64}$/.test(event.correlationId)
  ) integrity()
}

function sameJournalIntent(left: StockAuditEvent, right: StockAuditEvent): boolean {
  return left.requestId === right.requestId &&
    left.actorStaffId === right.actorStaffId &&
    left.action === right.action &&
    left.safeErrorCode === right.safeErrorCode &&
    left.targetProductIdsJson === right.targetProductIdsJson &&
    left.correlationId === right.correlationId &&
    left.createdAt === right.createdAt
}

function journalDocumentId(event: StockAuditEvent): string {
  return event.correlationId.slice(0, event.correlationId.indexOf('|'))
}

function journalActionMatchesTransaction(action: string, transactionType: StockTransactionType): boolean {
  return (action === 'CREATE_PRODUCT' && transactionType === 'OPENING') || action === transactionType
}

function parseTargets(value: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { integrity() }
  if (!Array.isArray(parsed) || parsed.some((item) => !safeId(item)) || new Set(parsed).size !== parsed.length) integrity()
  if (JSON.stringify(parsed) !== value) integrity()
  return parsed as string[]
}

function buildDocuments(
  entries: StockLedgerEntry[],
  productsById: Map<string, StockProduct>,
): StockDocumentSummary[] {
  const byDocument = new Map<string, StockLedgerEntry[]>()
  for (const entry of entries) {
    const rows = byDocument.get(entry.documentId) ?? []
    rows.push(entry)
    byDocument.set(entry.documentId, rows)
  }
  return [...byDocument.values()]
    .map((rows) => {
      const ordered = [...rows].sort((left, right) => left.lineNumber - right.lineNumber)
      const first = ordered[0]!
      return {
        documentId: first.documentId,
        requestId: first.requestId,
        transactionType: first.transactionType,
        actorStaffId: first.actorStaffId,
        actorDisplayName: first.actorDisplayName,
        createdAt: first.createdAt,
        reason: first.reason,
        lineCount: ordered.length,
        lines: ordered.map((entry) => {
          const product = productsById.get(entry.productId)!
          return {
            productId: entry.productId,
            productName: product.name,
            unit: product.unit,
            quantityDeltaMilli: entry.quantityDeltaMilli,
            balanceBeforeMilli: entry.balanceBeforeMilli,
            balanceAfterMilli: entry.balanceAfterMilli,
          }
        }),
      }
    })
    .sort((left, right) => {
      const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt)
      return byTime || right.documentId.localeCompare(left.documentId)
    })
}

function cursorStart(cursor: string, documents: StockDocumentSummary[]): number {
  if (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new StockReadStoreError('STOCK_INVALID_CURSOR')
  }
  let decoded: unknown
  try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) } catch {
    throw new StockReadStoreError('STOCK_INVALID_CURSOR')
  }
  if (!hasExactKeys(decoded, ['version', 'documentId', 'createdAt'])) {
    throw new StockReadStoreError('STOCK_INVALID_CURSOR')
  }
  if (decoded.version !== 1 || !safeId(decoded.documentId) || !validTimestamp(decoded.createdAt)) {
    throw new StockReadStoreError('STOCK_INVALID_CURSOR')
  }
  const index = documents.findIndex((document) =>
    document.documentId === decoded.documentId && document.createdAt === decoded.createdAt)
  if (index < 0) throw new StockReadStoreError('STOCK_INVALID_CURSOR')
  return index + 1
}

function encodeCursor(document: StockDocumentSummary): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    documentId: document.documentId,
    createdAt: document.createdAt,
  }), 'utf8').toString('base64url')
}

function sameRow(actual: unknown[] | undefined, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
}

function uniqueIds(values: string[]): Set<string> {
  const result = new Set(values)
  if (result.size !== values.length) integrity()
  return result
}

function id(value: unknown): string {
  if (!safeId(value)) integrity()
  return value
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function integer(value: unknown, bounds: { minimum?: number } = {}): number {
  let parsed: number
  if (typeof value === 'number') parsed = value
  else if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(value)) parsed = Number(value)
  else integrity()
  if (!Number.isSafeInteger(parsed) || (bounds.minimum !== undefined && parsed < bounds.minimum)) integrity()
  return parsed
}

function boolean(value: unknown): boolean {
  if (value === true || value === 'TRUE') return true
  if (value === false || value === 'FALSE') return false
  integrity()
}

function nonEmptyText(value: unknown, maximum: number): string {
  const result = text(value, maximum)
  if (!result.trim()) integrity()
  return result
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || hasForbiddenTextCharacter(value)) integrity()
  return value
}

function hasForbiddenTextCharacter(value: string): boolean {
  return [...value].some((character) => [0, 10, 13].includes(character.charCodeAt(0)))
}

function timestamp(value: unknown): string {
  if (!validTimestamp(value)) integrity()
  return value
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
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

function integrity(): never {
  throw new StockReadStoreError('STOCK_DATA_INTEGRITY_ERROR')
}
