import {
  normalizeStockProductName,
  normalizeStockProductText,
} from '../../../../shared/pmcStock'
import type {
  MiniAppStockCommand,
  StockAuditEvent,
  StockCommandResult,
  StockLedgerEntry,
  StockProduct,
  StockTransactionType,
} from '../../../../shared/pmcStock'
import type { StockRepository } from '../ports'

export interface StockCommandPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  staff: {
    findById(staffId: string): { id: string; name: string; active: boolean; canManageStock: boolean } | null
  }
  stock: StockRepository
  commandFingerprint(command: MiniAppStockCommand): string
  allocateId(prefix: 'STK' | 'ISS' | 'RCV' | 'ADJ' | 'TX' | 'AUDIT'): string
}

type StockActor = NonNullable<ReturnType<StockCommandPorts['staff']['findById']>>
type StockDocumentCommand = Extract<MiniAppStockCommand, { commandType: 'RECEIVE' | 'ISSUE' }>
type ProductLifecycleCommand = Extract<
  MiniAppStockCommand,
  { commandType: 'DEACTIVATE_PRODUCT' | 'REACTIVATE_PRODUCT' }
>

interface JournalContext {
  documentId: string
  fingerprint: string
  adjustmentLedgerEffect: boolean | null
  createdAt: string
  targetProductIds: string[]
  prepared: StockAuditEvent
  accepted: StockAuditEvent
}

function journalCorrelationId(
  documentId: string,
  fingerprint: string,
  commandType: MiniAppStockCommand['commandType'],
  adjustmentLedgerEffect: boolean | null,
): string {
  if (commandType !== 'ADJUST') return `${documentId}|${fingerprint}`
  if (adjustmentLedgerEffect === null) return `${documentId}|${fingerprint}`
  return `${documentId}|${fingerprint}|ADJUST:${adjustmentLedgerEffect ? 'LEDGER' : 'NO_LEDGER'}`
}

function parseJournalCorrelation(
  correlationId: string,
  commandType: MiniAppStockCommand['commandType'],
): { documentId: string; fingerprint: string; adjustmentLedgerEffect: boolean | null } {
  const parts = correlationId.split('|')
  const [documentId, fingerprint, marker] = parts
  if (
    !/^[A-Za-z0-9._:-]{1,124}$/.test(documentId ?? '') ||
    !/^[a-f0-9]{64}$/.test(fingerprint ?? '') ||
    (parts.length !== 2 && parts.length !== 3) ||
    (parts.length === 3 && commandType !== 'ADJUST')
  ) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  if (parts.length === 2) return { documentId: documentId!, fingerprint: fingerprint!, adjustmentLedgerEffect: null }
  if (marker === 'ADJUST:LEDGER') return { documentId: documentId!, fingerprint: fingerprint!, adjustmentLedgerEffect: true }
  if (marker === 'ADJUST:NO_LEDGER') return { documentId: documentId!, fingerprint: fingerprint!, adjustmentLedgerEffect: false }
  throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
}

function requireSafeId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,124}$/.test(value)) throw new Error('STOCK_INVALID_ID')
  return value
}

function lineIdempotencyKey(requestId: string, lineNumber: number): string {
  return requireSafeId(`${requestId}:${lineNumber}`)
}

function deterministicTransactionId(documentId: string, lineNumber: number): string {
  return requireSafeId(`${documentId}:TX:${lineNumber}`)
}

function requireFingerprint(input: MiniAppStockCommand, ports: StockCommandPorts): string {
  const fingerprint = ports.commandFingerprint(input)
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('STOCK_INVALID_FINGERPRINT')
  return fingerprint
}

function requireAuthorizedActor(input: MiniAppStockCommand, ports: StockCommandPorts): StockActor {
  const actor = ports.staff.findById(input.staffId)
  if (!actor?.active) throw new Error('STOCK_STAFF_REQUIRED')
  return actor
}

function requireManager(actor: StockActor): void {
  if (!actor.canManageStock) throw new Error('STOCK_MANAGER_REQUIRED')
}

function auditEventId(fingerprint: string, status: 'PREPARED' | 'ACCEPTED'): string {
  return requireSafeId(`AUDIT:${fingerprint}:${status === 'PREPARED' ? 'P' : 'A'}`)
}

function journalAudit(
  input: MiniAppStockCommand,
  actorStaffId: string,
  documentId: string,
  fingerprint: string,
  targetProductIds: string[],
  createdAt: string,
  status: 'PREPARED' | 'ACCEPTED',
  adjustmentLedgerEffect: boolean | null,
): StockAuditEvent {
  return {
    eventId: auditEventId(fingerprint, status),
    requestId: input.requestId,
    actorStaffId,
    action: input.commandType,
    status,
    safeErrorCode: '',
    targetProductIdsJson: JSON.stringify(targetProductIds),
    correlationId: journalCorrelationId(documentId, fingerprint, input.commandType, adjustmentLedgerEffect),
    createdAt,
  }
}

function newJournalContext(
  input: MiniAppStockCommand,
  actor: StockActor,
  documentId: string,
  fingerprint: string,
  targetProductIds: string[],
  createdAt: string,
  adjustmentLedgerEffect: boolean | null = null,
): JournalContext {
  requireSafeId(documentId)
  const prepared = journalAudit(
    input, actor.id, documentId, fingerprint, targetProductIds, createdAt, 'PREPARED', adjustmentLedgerEffect,
  )
  return {
    documentId,
    fingerprint,
    adjustmentLedgerEffect,
    createdAt,
    targetProductIds,
    prepared,
    accepted: journalAudit(
      input, actor.id, documentId, fingerprint, targetProductIds, createdAt, 'ACCEPTED', adjustmentLedgerEffect,
    ),
  }
}

function targetProductIds(input: MiniAppStockCommand, documentId: string): string[] {
  if (input.commandType === 'CREATE_PRODUCT') return [documentId]
  if ('lines' in input.payload) {
    return input.payload.lines.map((line) => line.productId)
  }
  return [input.payload.productId]
}

function contextFromPrepared(
  input: MiniAppStockCommand,
  fingerprint: string,
  prepared: StockAuditEvent,
): JournalContext {
  const { documentId, fingerprint: storedFingerprint, adjustmentLedgerEffect } = parseJournalCorrelation(
    prepared.correlationId, input.commandType,
  )
  const targets = targetProductIds(input, documentId)
  if (
    !/^[A-Za-z0-9._:-]{1,124}$/.test(documentId) ||
    prepared.status !== 'PREPARED' ||
    prepared.requestId !== input.requestId ||
    prepared.action !== input.commandType ||
    prepared.actorStaffId !== input.staffId ||
    storedFingerprint !== fingerprint ||
    prepared.targetProductIdsJson !== JSON.stringify(targets)
  ) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }
  return {
    documentId,
    fingerprint,
    adjustmentLedgerEffect,
    createdAt: prepared.createdAt,
    targetProductIds: targets,
    prepared,
    accepted: journalAudit(
      input, prepared.actorStaffId, documentId, fingerprint, targets, prepared.createdAt, 'ACCEPTED', adjustmentLedgerEffect,
    ),
  }
}

function resultFromEntries(
  input: MiniAppStockCommand,
  context: JournalContext,
  entries: StockLedgerEntry[],
): StockCommandResult {
  return {
    requestId: input.requestId,
    documentId: context.documentId,
    commandType: input.commandType,
    createdAt: context.createdAt,
    lines: entries.map((entry) => ({
      productId: entry.productId,
      quantityDeltaMilli: entry.quantityDeltaMilli,
      balanceAfterMilli: entry.balanceAfterMilli,
    })),
  }
}

function existingDocumentEntries(requestId: string, ports: StockCommandPorts): StockLedgerEntry[] {
  return ports.stock
    .listLedger()
    .filter((entry) => entry.requestId === requestId)
    .sort((left, right) => left.lineNumber - right.lineNumber)
}

function sameLedgerEntry(left: StockLedgerEntry, right: StockLedgerEntry): boolean {
  return (
    left.transactionId === right.transactionId &&
    left.documentId === right.documentId &&
    left.requestId === right.requestId &&
    left.lineNumber === right.lineNumber &&
    left.productId === right.productId &&
    left.transactionType === right.transactionType &&
    left.quantityDeltaMilli === right.quantityDeltaMilli &&
    left.balanceBeforeMilli === right.balanceBeforeMilli &&
    left.balanceAfterMilli === right.balanceAfterMilli &&
    left.actorStaffId === right.actorStaffId &&
    left.actorDisplayName === right.actorDisplayName &&
    left.reason === right.reason &&
    left.idempotencyKey === right.idempotencyKey &&
    left.createdAt === right.createdAt
  )
}

function requireMatchingEntries(actual: StockLedgerEntry[], expected: StockLedgerEntry[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => !sameLedgerEntry(entry, expected[index]))
  ) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }
}

function ledgerEntry(
  input: MiniAppStockCommand,
  context: JournalContext,
  actor: StockActor,
  lineNumber: number,
  productId: string,
  transactionType: StockTransactionType,
  quantityDeltaMilli: number,
  balanceBeforeMilli: number,
  balanceAfterMilli: number,
  reason: string,
): StockLedgerEntry {
  return {
    transactionId: deterministicTransactionId(context.documentId, lineNumber),
    documentId: context.documentId,
    requestId: input.requestId,
    lineNumber,
    productId,
    transactionType,
    quantityDeltaMilli,
    balanceBeforeMilli,
    balanceAfterMilli,
    actorStaffId: actor.id,
    actorDisplayName: actor.name,
    reason,
    idempotencyKey: lineIdempotencyKey(input.requestId, lineNumber),
    createdAt: context.createdAt,
  }
}

function prepare(context: JournalContext, ports: StockCommandPorts): void {
  ports.stock.appendAudit(context.prepared)
}

function finalize(context: JournalContext, ports: StockCommandPorts): void {
  ports.stock.appendAudit(context.accepted)
}

function requireDocumentLines(input: StockDocumentCommand): void {
  if (input.payload.lines.length === 0) throw new Error('STOCK_INVALID_LINES')
  const seen = new Set<string>()
  for (const line of input.payload.lines) {
    requireSafeId(line.productId)
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new Error('STOCK_INVALID_QUANTITY')
    }
    if (seen.has(line.productId)) throw new Error('STOCK_DUPLICATE_PRODUCT')
    seen.add(line.productId)
  }
}

function requireProducts(
  productIds: string[],
  ports: StockCommandPorts,
  requireActive: boolean,
): Map<string, StockProduct> {
  const products = new Map<string, StockProduct>()
  for (const productId of productIds) {
    const product = ports.stock.getProduct(productId)
    if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
    if (requireActive && !product.active) throw new Error('STOCK_PRODUCT_INACTIVE')
    products.set(productId, product)
  }
  return products
}

function intendedDocumentEntries(
  input: StockDocumentCommand,
  actor: StockActor,
  context: JournalContext,
  transactionType: 'RECEIVE' | 'ISSUE',
  ports: StockCommandPorts,
  existing: StockLedgerEntry[],
): StockLedgerEntry[] {
  const balances = ports.stock.balanceByProduct()
  return input.payload.lines.map((line, index) => {
    const quantityDeltaMilli = transactionType === 'ISSUE' ? -line.quantityMilli : line.quantityMilli
    const balanceBeforeMilli = existing[index]?.balanceBeforeMilli ?? balances.get(line.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli + quantityDeltaMilli
    if (!Number.isSafeInteger(balanceAfterMilli)) throw new Error('STOCK_BALANCE_OVERFLOW')
    if (balanceAfterMilli < 0) throw new Error('STOCK_INSUFFICIENT_BALANCE')
    return ledgerEntry(
      input, context, actor, index + 1, line.productId, transactionType,
      quantityDeltaMilli, balanceBeforeMilli, balanceAfterMilli, '',
    )
  })
}

function executeStockDocument(
  input: StockDocumentCommand,
  actor: StockActor,
  fingerprint: string,
  preparedContext: JournalContext | null,
  ports: StockCommandPorts,
): StockCommandResult {
  requireDocumentLines(input)
  const transactionType = input.commandType
  requireProducts(input.payload.lines.map((line) => line.productId), ports, preparedContext === null)
  const existing = existingDocumentEntries(input.requestId, ports)
  if (!preparedContext && existing.length > 0) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  const context = preparedContext ?? newJournalContext(
    input,
    actor,
    requireSafeId(ports.allocateId(transactionType === 'ISSUE' ? 'ISS' : 'RCV')),
    fingerprint,
    input.payload.lines.map((line) => line.productId),
    ports.clock.nowIso(),
  )
  const intended = intendedDocumentEntries(input, actor, context, transactionType, ports, existing)
  if (!preparedContext) prepare(context, ports)
  if (existing.length > 0) {
    requireMatchingEntries(existing, intended)
  } else {
    ports.stock.appendLedgerBatch(intended)
  }
  finalize(context, ports)
  return resultFromEntries(input, context, intended)
}

function requireProductFields(input: {
  name: string
  category: unknown
  unit: string
  minimumQuantityMilli: number
}): { name: string; normalizedName: string; category: StockProduct['category']; unit: string; minimumQuantityMilli: number } {
  const name = normalizeStockProductText(input.name)
  const unit = normalizeStockProductText(input.unit)
  if (!name || !unit) throw new Error('STOCK_INVALID_PRODUCT')
  if (input.category !== 'CLINIC_SUPPLY' && input.category !== 'RETAIL_PRODUCT') {
    throw new Error('STOCK_INVALID_PRODUCT')
  }
  if (!Number.isSafeInteger(input.minimumQuantityMilli) || input.minimumQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  return {
    name,
    normalizedName: normalizeStockProductName(name),
    category: input.category,
    unit,
    minimumQuantityMilli: input.minimumQuantityMilli,
  }
}

function requireUniqueActiveName(
  normalizedName: string,
  ports: StockCommandPorts,
  excludingProductId?: string,
): void {
  if (ports.stock.listProducts().some((product) => (
    product.active && product.productId !== excludingProductId && product.normalizedName === normalizedName
  ))) {
    throw new Error('STOCK_PRODUCT_NAME_EXISTS')
  }
}

function sameProduct(left: StockProduct, right: StockProduct): boolean {
  return (
    left.productId === right.productId &&
    left.name === right.name &&
    left.normalizedName === right.normalizedName &&
    left.category === right.category &&
    left.unit === right.unit &&
    left.minimumQuantityMilli === right.minimumQuantityMilli &&
    left.active === right.active &&
    left.createdAt === right.createdAt &&
    left.createdByStaffId === right.createdByStaffId &&
    left.updatedAt === right.updatedAt &&
    left.updatedByStaffId === right.updatedByStaffId &&
    left.version === right.version
  )
}

function createProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'CREATE_PRODUCT' }>,
  actor: StockActor,
  fingerprint: string,
  preparedContext: JournalContext | null,
  ports: StockCommandPorts,
): StockCommandResult {
  const fields = requireProductFields(input.payload)
  if (!Number.isSafeInteger(input.payload.openingQuantityMilli) || input.payload.openingQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  if (!preparedContext) requireUniqueActiveName(fields.normalizedName, ports)
  const productId = preparedContext?.documentId ?? requireSafeId(ports.allocateId('STK'))
  const existingProduct = ports.stock.getProduct(productId)
  if (!preparedContext && existingProduct) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  if (preparedContext) requireUniqueActiveName(fields.normalizedName, ports, productId)
  const existingEntries = existingDocumentEntries(input.requestId, ports)
  if (!preparedContext && existingEntries.length > 0) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  const context = preparedContext ?? newJournalContext(
    input, actor, productId, fingerprint, [productId], ports.clock.nowIso(),
  )
  const intendedProduct: StockProduct = {
    productId,
    ...fields,
    active: true,
    createdAt: context.createdAt,
    createdByStaffId: actor.id,
    updatedAt: context.createdAt,
    updatedByStaffId: actor.id,
    version: 1,
  }
  const openingEntries = input.payload.openingQuantityMilli > 0 ? [ledgerEntry(
    input, context, actor, 1, productId, 'OPENING', input.payload.openingQuantityMilli,
    0, input.payload.openingQuantityMilli, '',
  )] : []

  if (!preparedContext) prepare(context, ports)
  if (existingProduct) {
    if (!sameProduct(existingProduct, intendedProduct)) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  } else {
    ports.stock.insertProduct(intendedProduct)
  }
  if (existingEntries.length > 0) {
    requireMatchingEntries(existingEntries, openingEntries)
  } else if (openingEntries.length > 0) {
    if ((ports.stock.balanceByProduct().get(productId) ?? 0) !== 0) {
      throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
    }
    ports.stock.appendLedgerBatch(openingEntries)
  }
  finalize(context, ports)
  return resultFromEntries(input, context, openingEntries)
}

function requireAdjustmentInput(
  input: Extract<MiniAppStockCommand, { commandType: 'ADJUST' }>,
): string {
  requireSafeId(input.payload.productId)
  if (!Number.isSafeInteger(input.payload.countedQuantityMilli) || input.payload.countedQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  const reason = input.payload.reason.trim()
  if (!reason || reason.length > 300) throw new Error('STOCK_ADJUST_REASON_REQUIRED')
  return reason
}

function adjustProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'ADJUST' }>,
  actor: StockActor,
  fingerprint: string,
  preparedContext: JournalContext | null,
  ports: StockCommandPorts,
): StockCommandResult {
  const reason = requireAdjustmentInput(input)
  requireProducts([input.payload.productId], ports, preparedContext === null)
  const existing = existingDocumentEntries(input.requestId, ports)
  if (!preparedContext && existing.length > 0) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  const balanceBeforeMilli = existing[0]?.balanceBeforeMilli ??
    ports.stock.balanceByProduct().get(input.payload.productId) ?? 0
  const quantityDeltaMilli = input.payload.countedQuantityMilli - balanceBeforeMilli
  if (!Number.isSafeInteger(quantityDeltaMilli)) throw new Error('STOCK_BALANCE_OVERFLOW')
  const adjustmentLedgerEffect = quantityDeltaMilli !== 0
  if (
    preparedContext &&
    preparedContext.adjustmentLedgerEffect !== null &&
    preparedContext.adjustmentLedgerEffect !== adjustmentLedgerEffect
  ) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  const context = preparedContext ?? newJournalContext(
    input, actor, requireSafeId(ports.allocateId('ADJ')), fingerprint,
    [input.payload.productId], ports.clock.nowIso(), adjustmentLedgerEffect,
  )
  const intended = quantityDeltaMilli === 0 ? [] : [ledgerEntry(
    input, context, actor, 1, input.payload.productId, 'ADJUST', quantityDeltaMilli,
    balanceBeforeMilli, input.payload.countedQuantityMilli, reason,
  )]

  if (!preparedContext) prepare(context, ports)
  if (existing.length > 0) {
    requireMatchingEntries(existing, intended)
  } else if (intended.length > 0) {
    ports.stock.appendLedgerBatch(intended)
  }
  finalize(context, ports)
  return resultFromEntries(input, context, intended)
}

function requireExistingProduct(productId: string, ports: StockCommandPorts): StockProduct {
  requireSafeId(productId)
  const product = ports.stock.getProduct(productId)
  if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
  return product
}

function matchesProductPatch(product: StockProduct, patch: Partial<StockProduct>): boolean {
  return Object.entries(patch).every(([key, value]) => product[key as keyof StockProduct] === value)
}

function applyRecoverableProductUpdate(
  product: StockProduct,
  expectedVersion: number,
  patch: Partial<StockProduct>,
  ports: StockCommandPorts,
): void {
  if (product.version === expectedVersion) {
    ports.stock.updateProduct(product.productId, expectedVersion, patch)
    return
  }
  if (product.version === expectedVersion + 1 && matchesProductPatch(product, patch)) return
  throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
}

function updateProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'UPDATE_PRODUCT' }>,
  actor: StockActor,
  fingerprint: string,
  preparedContext: JournalContext | null,
  ports: StockCommandPorts,
): StockCommandResult {
  const before = requireExistingProduct(input.payload.productId, ports)
  const fields = requireProductFields(input.payload)
  if (before.active) requireUniqueActiveName(fields.normalizedName, ports, before.productId)
  if (
    before.version === input.payload.expectedVersion &&
    fields.unit !== before.unit &&
    ports.stock.listLedger().some((entry) => entry.productId === before.productId)
  ) {
    throw new Error('STOCK_UNIT_LOCKED')
  }
  if (!preparedContext && before.version !== input.payload.expectedVersion) throw new Error('version conflict')
  const context = preparedContext ?? newJournalContext(
    input, actor, before.productId, fingerprint, [before.productId], ports.clock.nowIso(),
  )
  const productPatch = {
    ...fields,
    updatedAt: context.createdAt,
    updatedByStaffId: actor.id,
  }

  if (!preparedContext) prepare(context, ports)
  applyRecoverableProductUpdate(before, input.payload.expectedVersion, productPatch, ports)
  finalize(context, ports)
  return resultFromEntries(input, context, [])
}

function setProductActive(
  input: ProductLifecycleCommand,
  actor: StockActor,
  fingerprint: string,
  preparedContext: JournalContext | null,
  ports: StockCommandPorts,
): StockCommandResult {
  const before = requireExistingProduct(input.payload.productId, ports)
  const active = input.commandType === 'REACTIVATE_PRODUCT'
  if (active) requireUniqueActiveName(before.normalizedName, ports, before.productId)
  if (!preparedContext && before.version !== input.payload.expectedVersion) throw new Error('version conflict')
  const context = preparedContext ?? newJournalContext(
    input, actor, before.productId, fingerprint, [before.productId], ports.clock.nowIso(),
  )
  const productPatch = { active, updatedAt: context.createdAt, updatedByStaffId: actor.id }

  if (!preparedContext) prepare(context, ports)
  applyRecoverableProductUpdate(before, input.payload.expectedVersion, productPatch, ports)
  finalize(context, ports)
  return resultFromEntries(input, context, [])
}

function resultFromAcceptedJournal(
  input: MiniAppStockCommand,
  context: JournalContext,
  ports: StockCommandPorts,
): StockCommandResult {
  const document = ports.stock.findDocumentByRequestId(input.requestId)
  const documentEntries = existingDocumentEntries(input.requestId, ports)
  const expectedTransactionType: StockTransactionType | null =
    input.commandType === 'CREATE_PRODUCT' ? 'OPENING'
      : input.commandType === 'RECEIVE' ? 'RECEIVE'
        : input.commandType === 'ISSUE' ? 'ISSUE'
          : input.commandType === 'ADJUST' ? 'ADJUST'
            : null
  const documentRequired =
    input.commandType === 'RECEIVE' ||
    input.commandType === 'ISSUE' ||
    (input.commandType === 'CREATE_PRODUCT' && input.payload.openingQuantityMilli > 0) ||
    (input.commandType === 'ADJUST' && context.adjustmentLedgerEffect !== false)
  const documentForbidden =
    expectedTransactionType === null ||
    (input.commandType === 'CREATE_PRODUCT' && input.payload.openingQuantityMilli === 0) ||
    (input.commandType === 'ADJUST' && context.adjustmentLedgerEffect === false)
  const documentIsCoherent = document !== null &&
    documentEntries.length > 0 &&
    document.lineCount === documentEntries.length &&
    documentEntries.every((entry, index) => (
      entry.documentId === context.documentId &&
      entry.transactionType === expectedTransactionType &&
      entry.actorStaffId === context.prepared.actorStaffId &&
      entry.createdAt === context.createdAt &&
      entry.lineNumber === index + 1
    ))
  if (
    (!document && documentRequired) ||
    (document && (
      documentForbidden ||
      !documentIsCoherent ||
      document.documentId !== context.documentId ||
      document.transactionType !== expectedTransactionType ||
      document.actorStaffId !== context.prepared.actorStaffId ||
      document.createdAt !== context.createdAt
    ))
  ) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }
  return {
    requestId: input.requestId,
    documentId: context.documentId,
    commandType: input.commandType,
    createdAt: context.createdAt,
    lines: document?.lines.map((line) => ({
      productId: line.productId,
      quantityDeltaMilli: line.quantityDeltaMilli,
      balanceAfterMilli: line.balanceAfterMilli,
    })) ?? [],
  }
}

export function executeStockCommand(
  input: MiniAppStockCommand,
  ports: StockCommandPorts,
): StockCommandResult {
  return ports.locks.withLock(() => {
    requireSafeId(input.requestId)
    const fingerprint = requireFingerprint(input, ports)
    const unresolved = ports.stock.listUnresolvedPrepared()
    if (unresolved[0] && unresolved[0].requestId !== input.requestId) {
      throw new Error('STOCK_RECOVERY_REQUIRED')
    }
    const journal = ports.stock.findAuditJournalByRequestId(input.requestId)
    if (journal.accepted) {
      if (!journal.prepared) throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
      return resultFromAcceptedJournal(
        input, contextFromPrepared(input, fingerprint, journal.prepared), ports,
      )
    }

    const preparedContext = journal.prepared
      ? contextFromPrepared(input, fingerprint, journal.prepared)
      : null
    const actor = requireAuthorizedActor(input, ports)
    if (input.commandType === 'ISSUE') {
      return executeStockDocument(input, actor, fingerprint, preparedContext, ports)
    }
    requireManager(actor)
    if (input.commandType === 'CREATE_PRODUCT') {
      return createProduct(input, actor, fingerprint, preparedContext, ports)
    }
    if (input.commandType === 'RECEIVE') {
      return executeStockDocument(input, actor, fingerprint, preparedContext, ports)
    }
    if (input.commandType === 'ADJUST') {
      return adjustProduct(input, actor, fingerprint, preparedContext, ports)
    }
    if (input.commandType === 'UPDATE_PRODUCT') {
      return updateProduct(input, actor, fingerprint, preparedContext, ports)
    }
    if (input.commandType === 'DEACTIVATE_PRODUCT' || input.commandType === 'REACTIVATE_PRODUCT') {
      return setProductActive(input, actor, fingerprint, preparedContext, ports)
    }
    throw new Error('STOCK_UNKNOWN_COMMAND')
  })
}
