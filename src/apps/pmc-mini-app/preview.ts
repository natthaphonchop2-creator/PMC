import type { MiniAppBrowserApi } from './api'
import type {
  BookingDraftInput,
  BookingDraftProjection,
  MiniAppConfig,
  MiniAppSession,
  StockProductProjection,
} from './contracts'
import type { JeraClientEnvelope, JeraReportType } from './reports'
import type {
  StockClientCommand,
  StockCommandResult,
  StockDocumentSummary,
  StockHistoryPage,
} from '../../../shared/pmcStock'

export const PREVIEW_SESSION: MiniAppSession = { staffId: 'staff-preview', displayName: 'มัส', active: true }

export const PREVIEW_CONFIG: MiniAppConfig = {
  miniAppId: 'preview-mini-app',
  fallbackFormUrl: 'https://docs.google.com/forms/',
  reportingEnabled: false,
  stockEnabled: false,
  canManageStock: false,
  doctors: [{ id: 'doctor-benz', name: 'หมอ Benz' }, { id: 'doctor-jam', name: 'หมอ Jam' }],
  services: [
    { id: 'fat-transfer', name: 'เติมไขมัน', durationMinutes: 60 },
    { id: 'rhinoplasty', name: 'เสริมจมูก', durationMinutes: 60 },
    { id: 'eyelid', name: 'ทำตาสองชั้น', durationMinutes: 60 },
  ],
  channels: [{ id: 'page-tab', name: 'เพจTAB' }, { id: 'page-main', name: 'เพจหลัก' }],
  aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-mus', name: 'มัส' }, { id: 'staff-muay', name: 'หมวย' }],
}

export function createPreviewMiniAppConfig(options: { stockEnabled?: boolean; canManageStock?: boolean } = {}): MiniAppConfig {
  return {
    ...PREVIEW_CONFIG,
    stockEnabled: options.stockEnabled === true,
    canManageStock: options.stockEnabled === true && options.canManageStock === true,
  }
}

export function createPreviewMiniAppApi(options: {
  staffAllowed?: boolean
  stockEnabled?: boolean
  canManageStock?: boolean
} = {}): MiniAppBrowserApi {
  let current: BookingDraftProjection | null = null
  let staffAllowed = options.staffAllowed !== false
  const config = createPreviewMiniAppConfig(options)
  const stock = createPreviewStockStore({ canManageStock: config.canManageStock })
  return {
    async initialize() { return 'preview-token' },
    async loadSession() {
      if (!staffAllowed) throw Object.assign(new Error('Staff is not allowed'), { code: 'STAFF_NOT_ALLOWED' })
      return PREVIEW_SESSION
    },
    async loadEnrollmentOptions() { return { staff: [{ id: PREVIEW_SESSION.staffId, name: PREVIEW_SESSION.displayName }] } },
    async enroll(_token, staffId, pin) {
      if (staffId !== PREVIEW_SESSION.staffId || pin !== '123456') {
        throw Object.assign(new Error('Enrollment denied'), { code: 'ENROLLMENT_DENIED', retryAfterSeconds: 0 })
      }
      staffAllowed = true
      return PREVIEW_SESSION
    },
    async loadConfig() { return structuredClone(config) },
    async createDraft() {
      current = {
        draftId: 'draft-preview-1', requestId: 'request-preview-1', state: 'DRAFT', retentionState: '', version: 1,
        input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      }
      return structuredClone(current)
    },
    async loadDraft(_token, draftId) {
      requireDraft(current, draftId)
      return structuredClone(current!)
    },
    async upload(_token, draftId, kind, files) {
      requireDraft(current, draftId)
      const ids = files.map((file, index) => `preview-${kind.toLowerCase()}-${index + 1}-${file.name}`)
      current = {
        ...current!,
        version: current!.version + 1,
        paymentEvidenceIds: kind === 'PAYMENT' ? [...current!.paymentEvidenceIds, ...ids] : current!.paymentEvidenceIds,
        chatEvidenceIds: kind === 'CHAT' ? [...current!.chatEvidenceIds, ...ids] : current!.chatEvidenceIds,
      }
      return structuredClone(current)
    },
    async save(_token, draftId, version, input: BookingDraftInput) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'READY_TO_CONFIRM', version: current!.version + 1, input: structuredClone(input) }
      return structuredClone(current)
    },
    async confirm(_token, draftId, version) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'CONFIRMED', version: current!.version + 1, confirmationStatus: 'CONFIRMED' }
      return { caseId: 'PMC-PREVIEW-0001', status: 'CONFIRMED' }
    },
    async cancel(_token, draftId, version) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: current!.version + 1 }
      return structuredClone(current)
    },
    async loadReport<T>(_token: string, reportType: JeraReportType): Promise<JeraClientEnvelope<T>> { return previewReport<T>(reportType) },
    async refreshReport() { return { accepted: true, correlationId: 'preview-refresh-1' } },
    async loadStockProducts() { return stock.loadProducts() },
    async loadStockHistory(_token: string, cursor?: string) { return stock.loadHistory(cursor) },
    async submitStockCommand(_token: string, command: StockClientCommand) {
      return stock.submit(command)
    },
  }
}

function createPreviewStockStore({ canManageStock }: { canManageStock: boolean }) {
  let mutationSequence = 0
  const documentSequences = new Map<string, number>()
  const products: StockProductProjection[] = [
    {
      productId: 'STK-000001', name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
      minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
      hasLedgerActivity: true, version: 1,
    },
    {
      productId: 'STK-000002', name: 'เซรั่ม', category: 'RETAIL_PRODUCT', unit: 'ขวด',
      minimumQuantityMilli: 3_000, onHandMilli: 12_000, lowStock: false, active: true,
      hasLedgerActivity: true, version: 1,
    },
  ]
  const documents: StockDocumentSummary[] = []
  const requests = new Map<string, { fingerprint: string; result: StockCommandResult }>()

  const nextDocumentId = (prefix: string) => {
    const next = (documentSequences.get(prefix) ?? 0) + 1
    documentSequences.set(prefix, next)
    return `${prefix}-202608-${String(next).padStart(4, '0')}`
  }
  const now = () => `2026-08-28T10:00:${String(++mutationSequence).padStart(2, '0')}+07:00`
  const actor = canManageStock
    ? { id: 'ADMIN_07', name: 'อาย' }
    : { id: 'ADMIN_01', name: 'มัส' }
  const findProduct = (productId: string) => {
    const product = products.find((candidate) => candidate.productId === productId)
    if (!product) throw previewStockError('STOCK_PRODUCT_NOT_FOUND')
    return product
  }
  const rememberDocument = (document: StockDocumentSummary) => {
    documents.unshift(document)
  }

  return {
    loadProducts(): { products: StockProductProjection[] } {
      return { products: structuredClone(products) }
    },
    loadHistory(cursor?: string): StockHistoryPage {
      if (cursor !== undefined) throw previewStockError('STOCK_INVALID_CURSOR')
      return { documents: structuredClone(documents), nextCursor: null }
    },
    submit(command: StockClientCommand): StockCommandResult {
      const fingerprint = JSON.stringify(command)
      const existing = requests.get(command.requestId)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw previewStockError('STOCK_IDEMPOTENCY_CONFLICT')
        return structuredClone(existing.result)
      }
      const createdAt = now()
      let result: StockCommandResult

      if (command.commandType === 'CREATE_PRODUCT') {
        const productId = `STK-${String(products.length + 1).padStart(6, '0')}`
        const product: StockProductProjection = {
          productId,
          name: command.payload.name.trim(),
          category: command.payload.category,
          unit: command.payload.unit.trim(),
          minimumQuantityMilli: command.payload.minimumQuantityMilli,
          onHandMilli: command.payload.openingQuantityMilli,
          lowStock: command.payload.openingQuantityMilli <= command.payload.minimumQuantityMilli,
          active: true,
          hasLedgerActivity: command.payload.openingQuantityMilli > 0,
          version: 1,
        }
        products.push(product)
        const lines = command.payload.openingQuantityMilli > 0
          ? [{ productId, quantityDeltaMilli: command.payload.openingQuantityMilli, balanceAfterMilli: command.payload.openingQuantityMilli }]
          : []
        result = { requestId: command.requestId, documentId: productId, commandType: command.commandType, createdAt, lines }
        if (lines.length > 0) rememberDocument(documentFromResult(result, [product], actor, ''))
      } else if (command.commandType === 'RECEIVE' || command.commandType === 'ISSUE') {
        const isIssue = command.commandType === 'ISSUE'
        const documentId = nextDocumentId(isIssue ? 'ISS' : 'RCV')
        const lineProducts = command.payload.lines.map((line) => findProduct(line.productId))
        const lines = command.payload.lines.map((line, index) => {
          const product = lineProducts[index]!
          const delta = isIssue ? -line.quantityMilli : line.quantityMilli
          const nextBalance = product.onHandMilli + delta
          if (nextBalance < 0) throw previewStockError('STOCK_INSUFFICIENT_BALANCE')
          product.onHandMilli = nextBalance
          product.lowStock = nextBalance <= product.minimumQuantityMilli
          product.hasLedgerActivity = true
          return { productId: product.productId, quantityDeltaMilli: delta, balanceAfterMilli: nextBalance }
        })
        result = { requestId: command.requestId, documentId, commandType: command.commandType, createdAt, lines }
        rememberDocument(documentFromResult(result, lineProducts, actor, ''))
      } else if (command.commandType === 'ADJUST') {
        const product = findProduct(command.payload.productId)
        const before = product.onHandMilli
        const delta = command.payload.countedQuantityMilli - before
        product.onHandMilli = command.payload.countedQuantityMilli
        product.lowStock = product.onHandMilli <= product.minimumQuantityMilli
        product.hasLedgerActivity = product.hasLedgerActivity || delta !== 0
        const lines = delta === 0 ? [] : [{
          productId: product.productId,
          quantityDeltaMilli: delta,
          balanceAfterMilli: product.onHandMilli,
        }]
        result = {
          requestId: command.requestId,
          documentId: nextDocumentId('ADJ'),
          commandType: command.commandType,
          createdAt,
          lines,
        }
        if (lines.length > 0) rememberDocument(documentFromResult(result, [product], actor, command.payload.reason))
      } else {
        if (!('productId' in command.payload)) throw previewStockError('STOCK_UNKNOWN_COMMAND')
        const product = findProduct(command.payload.productId)
        if (command.commandType === 'UPDATE_PRODUCT') {
          product.name = command.payload.name.trim()
          product.category = command.payload.category
          product.unit = command.payload.unit.trim()
          product.minimumQuantityMilli = command.payload.minimumQuantityMilli
          product.lowStock = product.onHandMilli <= product.minimumQuantityMilli
        } else {
          product.active = command.commandType === 'REACTIVATE_PRODUCT'
        }
        product.version += 1
        result = {
          requestId: command.requestId,
          documentId: product.productId,
          commandType: command.commandType,
          createdAt,
          lines: [],
        }
      }

      requests.set(command.requestId, { fingerprint, result: structuredClone(result) })
      return structuredClone(result)
    },
  }
}

function documentFromResult(
  result: StockCommandResult,
  products: StockProductProjection[],
  actor: { id: string; name: string },
  reason: string,
): StockDocumentSummary {
  const transactionType = result.commandType === 'CREATE_PRODUCT' ? 'OPENING' : result.commandType
  if (!['OPENING', 'RECEIVE', 'ISSUE', 'ADJUST'].includes(transactionType)) {
    throw previewStockError('STOCK_UNKNOWN_COMMAND')
  }
  return {
    documentId: result.documentId,
    requestId: result.requestId,
    transactionType: transactionType as StockDocumentSummary['transactionType'],
    actorStaffId: actor.id,
    actorDisplayName: actor.name,
    createdAt: result.createdAt,
    reason,
    lineCount: result.lines.length,
    lines: result.lines.map((line, index) => {
      const product = products[index]!
      return {
        productId: line.productId,
        productName: product.name,
        unit: product.unit,
        quantityDeltaMilli: line.quantityDeltaMilli,
        balanceBeforeMilli: line.balanceAfterMilli - line.quantityDeltaMilli,
        balanceAfterMilli: line.balanceAfterMilli,
      }
    }),
  }
}

function previewStockError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function previewReport<T>(reportType: JeraReportType): JeraClientEnvelope<T> {
  const rows = [{
    sourceUuid: 'preview-row-1', eventDate: '2026-08-27', patientName: 'ลูกค้าทดสอบ',
    paymentCode: 'PAY-PREVIEW-001', itemName: 'เติมไขมัน', itemCode: 'SERVICE-01',
    status: 'PAID', paidAmountSatang: 90_000, refundAmountSatang: 0, remainingValueSatang: 0,
  }]
  const data = reportType === 'TODAY_SUMMARY'
    ? { totals: { receivedSatang: 90_000, depositSatang: 90_000, refundSatang: 0, netCashFlowSatang: 180_000, appointmentCount: 2 } }
    : reportType === 'APPOINTMENT'
      ? { totals: { appointmentCount: 2 }, rows: rows.map((row) => ({ ...row, paidAmountSatang: null, status: 'Confirmed' })) }
      : reportType === 'REFUND'
        ? { totals: { rowCount: 1, refundAmountSatang: 90_000 }, rows: rows.map((row) => ({ ...row, paidAmountSatang: null, refundAmountSatang: 90_000 })) }
        : {
          totals: {
            rowCount: 1, totalSatang: 90_000, paidAmountSatang: 90_000, refundAmountSatang: 0,
            normalPaidSatang: 90_000, depositPaidSatang: 0, cashSatang: 0, transferSatang: 90_000,
            creditCardSatang: 0, eWalletSatang: 0, paymentLinkSatang: 0, otherPaymentSatang: 0,
            netSatang: 90_000, quantity: 1, remainingQuantity: 1, remainingValueSatang: 90_000,
          },
          rows,
        }
  return {
    data: data as unknown as T,
    source: 'CACHE', fetchedAt: '2026-08-27T13:55:00.000Z', lastSuccessAt: '2026-08-27T13:55:00.000Z',
    refreshing: false, stale: false, warningCode: null,
  }
}

function requireDraft(draft: BookingDraftProjection | null, draftId: string, version?: number): void {
  if (!draft || draft.draftId !== draftId) throw new Error('preview draft missing')
  if (version !== undefined && draft.version !== version) throw new Error('preview draft version conflict')
}
