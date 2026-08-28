import {
  aggregateStockBalances,
  type StockAuditEvent,
  type StockDocumentSummary,
  type StockLedgerEntry,
  type StockProduct,
} from '../../../../shared/pmcStock'
import type { StockRepository } from '../ports'
import type { SheetRow, SheetStore } from '../repositories'

const STOCK_PRODUCT_HEADERS = [
  'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
  'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
] as const satisfies readonly (keyof StockProduct)[]

const STOCK_LEDGER_HEADERS = [
  'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
  'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
  'reason', 'idempotencyKey', 'createdAt',
] as const satisfies readonly (keyof StockLedgerEntry)[]

const STOCK_AUDIT_HEADERS = [
  'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
  'targetProductIdsJson', 'correlationId', 'createdAt',
] as const satisfies readonly (keyof StockAuditEvent)[]

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function toSheetRow<T extends object>(value: T, headers: readonly (keyof T)[]): SheetRow {
  return Object.fromEntries(headers.map((header) => [header, value[header]]))
}

function asProduct(row: SheetRow): StockProduct {
  return clonePlain(row as unknown as StockProduct)
}

function asLedgerEntry(row: SheetRow): StockLedgerEntry {
  return clonePlain(row as unknown as StockLedgerEntry)
}

function asAuditEvent(row: SheetRow): StockAuditEvent {
  return clonePlain(row as unknown as StockAuditEvent)
}

function sameAuditJournalIntent(left: StockAuditEvent, right: StockAuditEvent): boolean {
  return (
    left.requestId === right.requestId &&
    left.actorStaffId === right.actorStaffId &&
    left.action === right.action &&
    left.targetProductIdsJson === right.targetProductIdsJson &&
    left.correlationId === right.correlationId &&
    left.createdAt === right.createdAt
  )
}

const STOCK_COMMAND_ACTIONS = new Set([
  'CREATE_PRODUCT',
  'RECEIVE',
  'ISSUE',
  'ADJUST',
  'UPDATE_PRODUCT',
  'DEACTIVATE_PRODUCT',
  'REACTIVATE_PRODUCT',
])

const STOCK_AUDIT_STATUSES = new Set(['PREPARED', 'ACCEPTED', 'REJECTED', 'RECOVERED'])

function validateAuditStatuses(events: StockAuditEvent[]): void {
  if (events.some((event) => typeof event.status !== 'string' || !STOCK_AUDIT_STATUSES.has(event.status))) {
    throw new Error('stock audit journal invalid')
  }
}

function validateJournalEvent(event: StockAuditEvent): void {
  if (
    typeof event.correlationId !== 'string' ||
    typeof event.targetProductIdsJson !== 'string' ||
    typeof event.createdAt !== 'string'
  ) {
    throw new Error('stock audit journal invalid')
  }
  const correlation = parseJournalCorrelation(event.correlationId, event.action)
  let targets: unknown
  try {
    targets = JSON.parse(event.targetProductIdsJson)
  } catch {
    throw new Error('stock audit journal invalid')
  }
  if (
    !isSafeId(event.eventId) ||
    !isSafeId(event.requestId) ||
    !isSafeId(event.actorStaffId) ||
    !STOCK_COMMAND_ACTIONS.has(event.action) ||
    !event.createdAt ||
    !Number.isFinite(Date.parse(event.createdAt)) ||
    event.safeErrorCode !== '' ||
    correlation === null ||
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.some((target) => !isSafeId(target)) ||
    new Set(targets).size !== targets.length ||
    JSON.stringify(targets) !== event.targetProductIdsJson
  ) {
    throw new Error('stock audit journal invalid')
  }
}

function parseJournalCorrelation(
  correlationId: string,
  action: string,
): { documentId: string; fingerprint: string; adjustmentLedgerEffect: boolean | null } | null {
  const parts = correlationId.split('|')
  const [documentId, fingerprint, marker] = parts
  if (
    !isSafeId(documentId) ||
    !/^[a-f0-9]{64}$/.test(fingerprint ?? '') ||
    (parts.length !== 2 && parts.length !== 3) ||
    (parts.length === 3 && action !== 'ADJUST')
  ) return null
  if (parts.length === 2) return { documentId, fingerprint: fingerprint!, adjustmentLedgerEffect: null }
  if (marker === 'ADJUST:LEDGER') return { documentId, fingerprint: fingerprint!, adjustmentLedgerEffect: true }
  if (marker === 'ADJUST:NO_LEDGER') return { documentId, fingerprint: fingerprint!, adjustmentLedgerEffect: false }
  return null
}

function auditJournalByRequest(
  events: StockAuditEvent[],
  requestId: string,
): { prepared: StockAuditEvent | null; accepted: StockAuditEvent | null } {
  validateAuditStatuses(events)
  const preparedEvents = events.filter((event) => event.requestId === requestId && event.status === 'PREPARED')
  const acceptedEvents = events.filter((event) => event.requestId === requestId && event.status === 'ACCEPTED')
  for (const event of [...preparedEvents, ...acceptedEvents]) validateJournalEvent(event)
  if (preparedEvents.length > 1) throw new Error('stock prepared audit conflict')
  if (acceptedEvents.length > 1) throw new Error('stock accepted audit conflict')
  const prepared = preparedEvents[0] ?? null
  const accepted = acceptedEvents[0] ?? null
  if (prepared && accepted && !sameAuditJournalIntent(prepared, accepted)) {
    throw new Error('stock audit journal mismatch')
  }
  return { prepared, accepted }
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function validateLedgerIds(entry: StockLedgerEntry): void {
  if (
    !isSafeId(entry.transactionId) ||
    !isSafeId(entry.requestId) ||
    !isSafeId(entry.documentId) ||
    !isSafeId(entry.productId) ||
    !isSafeId(entry.actorStaffId) ||
    !isSafeId(entry.idempotencyKey)
  ) {
    throw new Error('stock ledger invalid ID')
  }
}

interface LedgerValidationState {
  transactionIds: Set<string>
  idempotencyKeys: Set<string>
  documentsByRequest: Map<string, string>
  requestsByDocument: Map<string, string>
  balances: Map<string, number>
}

function validateLedgerEntries(
  entries: StockLedgerEntry[],
  state: LedgerValidationState = {
    transactionIds: new Set(),
    idempotencyKeys: new Set(),
    documentsByRequest: new Map(),
    requestsByDocument: new Map(),
    balances: new Map(),
  },
): LedgerValidationState {
  for (const entry of entries) {
    validateLedgerIds(entry)
    if (state.transactionIds.has(entry.transactionId)) throw new Error('stock transaction already exists')
    state.transactionIds.add(entry.transactionId)
    if (state.idempotencyKeys.has(entry.idempotencyKey)) throw new Error('stock idempotency key already exists')
    state.idempotencyKeys.add(entry.idempotencyKey)

    if (state.documentsByRequest.has(entry.requestId) && state.documentsByRequest.get(entry.requestId) !== entry.documentId) {
      throw new Error('stock request conflicts with document')
    }
    state.documentsByRequest.set(entry.requestId, entry.documentId)

    if (state.requestsByDocument.has(entry.documentId) && state.requestsByDocument.get(entry.documentId) !== entry.requestId) {
      throw new Error('stock document conflicts with request')
    }
    state.requestsByDocument.set(entry.documentId, entry.requestId)

    const balanceBeforeMilli = state.balances.get(entry.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli + entry.quantityDeltaMilli
    if (
      !Number.isSafeInteger(balanceAfterMilli) ||
      entry.balanceBeforeMilli !== balanceBeforeMilli ||
      entry.balanceAfterMilli !== balanceAfterMilli
    ) {
      throw new Error('stock balance chain mismatch')
    }
    state.balances.set(entry.productId, balanceAfterMilli)
  }
  return state
}

export function createStockRepository(store: SheetStore): StockRepository {
  return {
    listProducts(): StockProduct[] {
      return store.read('STOCK_PRODUCTS').map(asProduct)
    },
    getProduct(productId: string): StockProduct | null {
      const row = store.read('STOCK_PRODUCTS').find((candidate) => candidate.productId === productId)
      return row ? asProduct(row) : null
    },
    insertProduct(product: StockProduct): StockProduct {
      const rows = store.read('STOCK_PRODUCTS')
      if (rows.some((row) => row.productId === product.productId)) throw new Error('stock product already exists')
      store.append('STOCK_PRODUCTS', [toSheetRow(product, STOCK_PRODUCT_HEADERS)])
      return clonePlain(product)
    },
    updateProduct(productId: string, expectedVersion: number, patch: Partial<StockProduct>): StockProduct {
      const rows = store.read('STOCK_PRODUCTS')
      const index = rows.findIndex((row) => row.productId === productId)
      if (index === -1) throw new Error('stock product not found')
      const before = asProduct(rows[index])
      if (before.version !== expectedVersion) throw new Error('version conflict')
      const after: StockProduct = {
        ...before,
        ...patch,
        productId: before.productId,
        version: before.version + 1,
      }
      store.update('STOCK_PRODUCTS', index, toSheetRow(after, STOCK_PRODUCT_HEADERS))
      return clonePlain(after)
    },
    listLedger(): StockLedgerEntry[] {
      return store.read('STOCK_LEDGER').map(asLedgerEntry)
    },
    appendLedgerBatch(entries: StockLedgerEntry[]): void {
      if (entries.length === 0) return
      const rows = store.read('STOCK_LEDGER')
      const existing = rows.map(asLedgerEntry)
      const state = validateLedgerEntries(existing)
      validateLedgerEntries(entries, state)
      store.append('STOCK_LEDGER', entries.map((entry) => toSheetRow(entry, STOCK_LEDGER_HEADERS)))
    },
    balanceByProduct(): Map<string, number> {
      return aggregateStockBalances(store.read('STOCK_LEDGER').map(asLedgerEntry))
    },
    findDocumentByRequestId(requestId: string): StockDocumentSummary | null {
      const entries = store
        .read('STOCK_LEDGER')
        .map(asLedgerEntry)
        .filter((entry) => entry.requestId === requestId)
        .sort((left, right) => left.lineNumber - right.lineNumber)
      if (entries.length === 0) return null

      const first = entries[0]
      const products = new Map(this.listProducts().map((product) => [product.productId, product]))
      return {
        documentId: first.documentId,
        requestId: first.requestId,
        transactionType: first.transactionType,
        actorStaffId: first.actorStaffId,
        actorDisplayName: first.actorDisplayName,
        createdAt: first.createdAt,
        reason: first.reason,
        lineCount: entries.length,
        lines: entries.map((entry) => {
          const product = products.get(entry.productId)
          return {
            productId: entry.productId,
            productName: product?.name ?? '',
            unit: product?.unit ?? '',
            quantityDeltaMilli: entry.quantityDeltaMilli,
            balanceBeforeMilli: entry.balanceBeforeMilli,
            balanceAfterMilli: entry.balanceAfterMilli,
          }
        }),
      }
    },
    findAuditJournalByRequestId(requestId: string) {
      return auditJournalByRequest(store.read('STOCK_AUDIT').map(asAuditEvent), requestId)
    },
    listUnresolvedPrepared(): StockAuditEvent[] {
      const events = store.read('STOCK_AUDIT').map(asAuditEvent)
      validateAuditStatuses(events)
      const requestIds = new Set(
        events
          .filter((event) => event.status === 'PREPARED' || event.status === 'ACCEPTED')
          .map((event) => event.requestId),
      )
      const unresolved: StockAuditEvent[] = []
      for (const requestId of requestIds) {
        const journal = auditJournalByRequest(events, requestId)
        if (journal.accepted && !journal.prepared) throw new Error('stock audit journal missing prepared')
        if (journal.prepared && !journal.accepted) unresolved.push(journal.prepared)
      }
      if (unresolved.length > 1) throw new Error('stock multiple unresolved prepared audits')
      return unresolved
    },
    findAcceptedAuditByRequestId(requestId: string): StockAuditEvent | null {
      return this.findAuditJournalByRequestId(requestId).accepted
    },
    appendAudit(event: StockAuditEvent): void {
      const rows = store.read('STOCK_AUDIT')
      const existing = rows.map(asAuditEvent)
      validateAuditStatuses([...existing, event])
      if (event.status === 'PREPARED' || event.status === 'ACCEPTED') validateJournalEvent(event)
      if (
        event.status === 'PREPARED' &&
        existing.some((row) => row.requestId === event.requestId && row.status === 'PREPARED')
      ) {
        throw new Error('stock prepared audit already exists')
      }
      if (
        event.status === 'ACCEPTED' &&
        existing.some((row) => row.requestId === event.requestId && row.status === 'ACCEPTED')
      ) {
        throw new Error('stock accepted audit already exists')
      }
      const candidate = [...existing, clonePlain(event)]
      const journal = auditJournalByRequest(candidate, event.requestId)
      if (event.status === 'ACCEPTED' && !journal.prepared) {
        throw new Error('stock audit journal missing prepared')
      }
      store.append('STOCK_AUDIT', [toSheetRow(event, STOCK_AUDIT_HEADERS)])
    },
  }
}
