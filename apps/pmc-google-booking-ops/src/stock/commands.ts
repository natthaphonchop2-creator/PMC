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

function requireSafeId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,124}$/.test(value)) throw new Error('STOCK_INVALID_ID')
  return value
}

function lineIdempotencyKey(requestId: string, lineNumber: number): string {
  return requireSafeId(`${requestId}:${lineNumber}`)
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

function resultFromAcceptedAudit(
  input: MiniAppStockCommand,
  fingerprint: string,
  audit: StockAuditEvent,
  ports: StockCommandPorts,
): StockCommandResult {
  const separator = audit.correlationId.indexOf('|')
  if (separator <= 0 || audit.correlationId.indexOf('|', separator + 1) !== -1) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }
  const documentId = audit.correlationId.slice(0, separator)
  const priorFingerprint = audit.correlationId.slice(separator + 1)
  if (
    !/^[A-Za-z0-9._:-]{1,124}$/.test(documentId) ||
    audit.action !== input.commandType ||
    priorFingerprint !== fingerprint
  ) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }

  const document = ports.stock.findDocumentByRequestId(input.requestId)
  const expectedTransactionType: StockTransactionType | null =
    input.commandType === 'CREATE_PRODUCT' ? 'OPENING'
      : input.commandType === 'RECEIVE' ? 'RECEIVE'
        : input.commandType === 'ISSUE' ? 'ISSUE'
          : input.commandType === 'ADJUST' ? 'ADJUST'
            : null
  const documentRequired =
    input.commandType === 'RECEIVE' ||
    input.commandType === 'ISSUE' ||
    (input.commandType === 'CREATE_PRODUCT' && input.payload.openingQuantityMilli > 0)
  const documentForbidden =
    expectedTransactionType === null ||
    (input.commandType === 'CREATE_PRODUCT' && input.payload.openingQuantityMilli === 0)
  if (
    (!document && documentRequired) ||
    (document && (
      documentForbidden ||
      document.documentId !== documentId ||
      document.transactionType !== expectedTransactionType ||
      document.actorStaffId !== audit.actorStaffId ||
      document.createdAt !== audit.createdAt
    ))
  ) {
    throw new Error('STOCK_IDEMPOTENCY_CONFLICT')
  }
  return {
    requestId: input.requestId,
    documentId,
    commandType: input.commandType,
    createdAt: audit.createdAt,
    lines: document?.lines.map((line) => ({
      productId: line.productId,
      quantityDeltaMilli: line.quantityDeltaMilli,
      balanceAfterMilli: line.balanceAfterMilli,
    })) ?? [],
  }
}

function acceptedAudit(
  input: MiniAppStockCommand,
  actor: StockActor,
  documentId: string,
  fingerprint: string,
  targetProductIds: string[],
  createdAt: string,
  ports: StockCommandPorts,
): StockAuditEvent {
  if (documentId.includes('|')) throw new Error('STOCK_INVALID_ID')
  return {
    eventId: requireSafeId(ports.allocateId('AUDIT')),
    requestId: input.requestId,
    actorStaffId: actor.id,
    action: input.commandType,
    status: 'ACCEPTED',
    safeErrorCode: '',
    targetProductIdsJson: JSON.stringify(targetProductIds),
    correlationId: `${documentId}|${fingerprint}`,
    createdAt,
  }
}

function resultFromEntries(
  input: MiniAppStockCommand,
  documentId: string,
  createdAt: string,
  entries: StockLedgerEntry[],
): StockCommandResult {
  return {
    requestId: input.requestId,
    documentId,
    commandType: input.commandType,
    createdAt,
    lines: entries.map((entry) => ({
      productId: entry.productId,
      quantityDeltaMilli: entry.quantityDeltaMilli,
      balanceAfterMilli: entry.balanceAfterMilli,
    })),
  }
}

function appendSuccessfulCommand(
  input: MiniAppStockCommand,
  actor: StockActor,
  documentId: string,
  fingerprint: string,
  entries: StockLedgerEntry[],
  targetProductIds: string[],
  createdAt: string,
  ports: StockCommandPorts,
): StockCommandResult {
  const audit = acceptedAudit(input, actor, documentId, fingerprint, targetProductIds, createdAt, ports)
  ports.stock.appendLedgerBatch(entries)
  ports.stock.appendAudit(audit)
  return resultFromEntries(input, documentId, createdAt, entries)
}

function requireDocumentLines(input: StockDocumentCommand) {
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

function issueProducts(
  input: StockDocumentCommand,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  requireDocumentLines(input)
  const balances = ports.stock.balanceByProduct()
  const createdAt = ports.clock.nowIso()
  const documentId = requireSafeId(ports.allocateId('ISS'))
  const entries: StockLedgerEntry[] = input.payload.lines.map((line, index) => {
    const product = ports.stock.getProduct(line.productId)
    if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
    if (!product.active) throw new Error('STOCK_PRODUCT_INACTIVE')
    const balanceBeforeMilli = balances.get(line.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli - line.quantityMilli
    if (!Number.isSafeInteger(balanceAfterMilli)) throw new Error('STOCK_BALANCE_OVERFLOW')
    if (balanceAfterMilli < 0) throw new Error('STOCK_INSUFFICIENT_BALANCE')
    return {
      transactionId: requireSafeId(ports.allocateId('TX')),
      documentId,
      requestId: input.requestId,
      lineNumber: index + 1,
      productId: line.productId,
      transactionType: 'ISSUE',
      quantityDeltaMilli: -line.quantityMilli,
      balanceBeforeMilli,
      balanceAfterMilli,
      actorStaffId: actor.id,
      actorDisplayName: actor.name,
      reason: '',
      idempotencyKey: lineIdempotencyKey(input.requestId, index + 1),
      createdAt,
    }
  })
  return appendSuccessfulCommand(
    input, actor, documentId, fingerprint, entries, entries.map((entry) => entry.productId), createdAt, ports,
  )
}

function receiveProducts(
  input: StockDocumentCommand,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  requireDocumentLines(input)
  const balances = ports.stock.balanceByProduct()
  const createdAt = ports.clock.nowIso()
  const documentId = requireSafeId(ports.allocateId('RCV'))
  const entries: StockLedgerEntry[] = input.payload.lines.map((line, index) => {
    const product = ports.stock.getProduct(line.productId)
    if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
    if (!product.active) throw new Error('STOCK_PRODUCT_INACTIVE')
    const balanceBeforeMilli = balances.get(line.productId) ?? 0
    const balanceAfterMilli = balanceBeforeMilli + line.quantityMilli
    if (!Number.isSafeInteger(balanceAfterMilli)) throw new Error('STOCK_BALANCE_OVERFLOW')
    return {
      transactionId: requireSafeId(ports.allocateId('TX')),
      documentId,
      requestId: input.requestId,
      lineNumber: index + 1,
      productId: line.productId,
      transactionType: 'RECEIVE',
      quantityDeltaMilli: line.quantityMilli,
      balanceBeforeMilli,
      balanceAfterMilli,
      actorStaffId: actor.id,
      actorDisplayName: actor.name,
      reason: '',
      idempotencyKey: lineIdempotencyKey(input.requestId, index + 1),
      createdAt,
    }
  })
  return appendSuccessfulCommand(
    input, actor, documentId, fingerprint, entries, entries.map((entry) => entry.productId), createdAt, ports,
  )
}

function normalizeProductText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeProductName(value: string): string {
  return normalizeProductText(value).toLowerCase()
}

function requireProductFields(input: {
  name: string
  category: unknown
  unit: string
  minimumQuantityMilli: number
}): { name: string; normalizedName: string; category: StockProduct['category']; unit: string; minimumQuantityMilli: number } {
  const name = normalizeProductText(input.name)
  const unit = normalizeProductText(input.unit)
  if (!name || !unit) throw new Error('STOCK_INVALID_PRODUCT')
  if (input.category !== 'CLINIC_SUPPLY' && input.category !== 'RETAIL_PRODUCT') {
    throw new Error('STOCK_INVALID_PRODUCT')
  }
  if (!Number.isSafeInteger(input.minimumQuantityMilli) || input.minimumQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  return {
    name,
    normalizedName: normalizeProductName(name),
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

function createProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'CREATE_PRODUCT' }>,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  const fields = requireProductFields(input.payload)
  if (!Number.isSafeInteger(input.payload.openingQuantityMilli) || input.payload.openingQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  requireUniqueActiveName(fields.normalizedName, ports)
  const createdAt = ports.clock.nowIso()
  const productId = requireSafeId(ports.allocateId('STK'))
  const product: StockProduct = {
    productId,
    ...fields,
    active: true,
    createdAt,
    createdByStaffId: actor.id,
    updatedAt: createdAt,
    updatedByStaffId: actor.id,
    version: 1,
  }
  const entries: StockLedgerEntry[] = input.payload.openingQuantityMilli > 0 ? [{
    transactionId: requireSafeId(ports.allocateId('TX')),
    documentId: productId,
    requestId: input.requestId,
    lineNumber: 1,
    productId,
    transactionType: 'OPENING',
    quantityDeltaMilli: input.payload.openingQuantityMilli,
    balanceBeforeMilli: 0,
    balanceAfterMilli: input.payload.openingQuantityMilli,
    actorStaffId: actor.id,
    actorDisplayName: actor.name,
    reason: '',
    idempotencyKey: lineIdempotencyKey(input.requestId, 1),
    createdAt,
  }] : []
  const audit = acceptedAudit(input, actor, productId, fingerprint, [productId], createdAt, ports)
  ports.stock.insertProduct(product)
  ports.stock.appendLedgerBatch(entries)
  ports.stock.appendAudit(audit)
  return resultFromEntries(input, productId, createdAt, entries)
}

function adjustProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'ADJUST' }>,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  requireSafeId(input.payload.productId)
  if (!Number.isSafeInteger(input.payload.countedQuantityMilli) || input.payload.countedQuantityMilli < 0) {
    throw new Error('STOCK_INVALID_QUANTITY')
  }
  const reason = input.payload.reason.trim()
  if (!reason || reason.length > 300) throw new Error('STOCK_ADJUST_REASON_REQUIRED')
  const product = ports.stock.getProduct(input.payload.productId)
  if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
  if (!product.active) throw new Error('STOCK_PRODUCT_INACTIVE')
  const balanceBeforeMilli = ports.stock.balanceByProduct().get(product.productId) ?? 0
  const quantityDeltaMilli = input.payload.countedQuantityMilli - balanceBeforeMilli
  if (!Number.isSafeInteger(quantityDeltaMilli)) throw new Error('STOCK_BALANCE_OVERFLOW')
  const createdAt = ports.clock.nowIso()
  const documentId = requireSafeId(ports.allocateId('ADJ'))
  const entries: StockLedgerEntry[] = quantityDeltaMilli === 0 ? [] : [{
    transactionId: requireSafeId(ports.allocateId('TX')),
    documentId,
    requestId: input.requestId,
    lineNumber: 1,
    productId: product.productId,
    transactionType: 'ADJUST',
    quantityDeltaMilli,
    balanceBeforeMilli,
    balanceAfterMilli: input.payload.countedQuantityMilli,
    actorStaffId: actor.id,
    actorDisplayName: actor.name,
    reason,
    idempotencyKey: lineIdempotencyKey(input.requestId, 1),
    createdAt,
  }]
  return appendSuccessfulCommand(input, actor, documentId, fingerprint, entries, [product.productId], createdAt, ports)
}

function requireExistingProduct(productId: string, ports: StockCommandPorts): StockProduct {
  requireSafeId(productId)
  const product = ports.stock.getProduct(productId)
  if (!product) throw new Error('STOCK_PRODUCT_NOT_FOUND')
  return product
}

function updateProduct(
  input: Extract<MiniAppStockCommand, { commandType: 'UPDATE_PRODUCT' }>,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  const before = requireExistingProduct(input.payload.productId, ports)
  const fields = requireProductFields(input.payload)
  if (before.active) requireUniqueActiveName(fields.normalizedName, ports, before.productId)
  if (
    fields.unit !== before.unit &&
    ports.stock.listLedger().some((entry) => entry.productId === before.productId)
  ) {
    throw new Error('STOCK_UNIT_LOCKED')
  }
  const createdAt = ports.clock.nowIso()
  const audit = acceptedAudit(input, actor, before.productId, fingerprint, [before.productId], createdAt, ports)
  ports.stock.updateProduct(before.productId, input.payload.expectedVersion, {
    ...fields,
    updatedAt: createdAt,
    updatedByStaffId: actor.id,
  })
  ports.stock.appendAudit(audit)
  return resultFromEntries(input, before.productId, createdAt, [])
}

function setProductActive(
  input: Extract<MiniAppStockCommand, { commandType: 'DEACTIVATE_PRODUCT' | 'REACTIVATE_PRODUCT' }>,
  actor: StockActor,
  fingerprint: string,
  ports: StockCommandPorts,
): StockCommandResult {
  const before = requireExistingProduct(input.payload.productId, ports)
  const active = input.commandType === 'REACTIVATE_PRODUCT'
  if (active) requireUniqueActiveName(before.normalizedName, ports, before.productId)
  const createdAt = ports.clock.nowIso()
  const audit = acceptedAudit(input, actor, before.productId, fingerprint, [before.productId], createdAt, ports)
  ports.stock.updateProduct(before.productId, input.payload.expectedVersion, {
    active,
    updatedAt: createdAt,
    updatedByStaffId: actor.id,
  })
  ports.stock.appendAudit(audit)
  return resultFromEntries(input, before.productId, createdAt, [])
}

export function executeStockCommand(
  input: MiniAppStockCommand,
  ports: StockCommandPorts,
): StockCommandResult {
  return ports.locks.withLock(() => {
    requireSafeId(input.requestId)
    const fingerprint = requireFingerprint(input, ports)
    const prior = ports.stock.findAcceptedAuditByRequestId(input.requestId)
    if (prior) return resultFromAcceptedAudit(input, fingerprint, prior, ports)

    const actor = requireAuthorizedActor(input, ports)
    if (input.commandType === 'ISSUE') return issueProducts(input, actor, fingerprint, ports)
    requireManager(actor)
    if (input.commandType === 'CREATE_PRODUCT') return createProduct(input, actor, fingerprint, ports)
    if (input.commandType === 'RECEIVE') return receiveProducts(input, actor, fingerprint, ports)
    if (input.commandType === 'ADJUST') return adjustProduct(input, actor, fingerprint, ports)
    if (input.commandType === 'UPDATE_PRODUCT') return updateProduct(input, actor, fingerprint, ports)
    if (input.commandType === 'DEACTIVATE_PRODUCT' || input.commandType === 'REACTIVATE_PRODUCT') {
      return setProductActive(input, actor, fingerprint, ports)
    }
    throw new Error('STOCK_UNKNOWN_COMMAND')
  })
}
