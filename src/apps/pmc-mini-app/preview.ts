import type { MiniAppBrowserApi } from './api'
import type {
  BookingDraftInput,
  BookingDraftProjection,
  ExpenseSubmitInput,
  MiniAppConfig,
  MiniAppSession,
  StockProductProjection,
} from './contracts'
import type { JeraClientEnvelope, JeraReportType } from './reports'
import type { FinanceDailyFilter, FinanceMonthSelection } from './financeReports'
import type {
  StockClientCommand,
  StockCommandResult,
  StockDocumentSummary,
  StockHistoryPage,
} from '../../../shared/pmcStock'
import type { DailyIncomeProjection, MonthlyIncomeProjection } from '../../../shared/pmcFinance'
import {
  deriveExpenseScope,
  type ExpenseHistoryRow,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense'

export const PREVIEW_SESSION: MiniAppSession = { staffId: 'staff-preview', displayName: 'มัส', active: true }

export const PREVIEW_CONFIG: MiniAppConfig = {
  miniAppId: 'preview-mini-app',
  fallbackFormUrl: 'https://docs.google.com/forms/',
  reportingEnabled: false,
  financeReportsEnabled: false,
  financeUiPreviewEnabled: false,
  financePilotDefaultDate: null,
  financeMonthlyIncomeEnabled: true,
  stockEnabled: false,
  expenseCaptureEnabled: false,
  financeReadsEnabled: false,
  canManageStock: false,
  canSubmitExpense: false,
  canViewFinance: false,
  canManageExpense: false,
  doctors: [{ id: 'doctor-benz', name: 'หมอ Benz' }, { id: 'doctor-jam', name: 'หมอ Jam' }],
  services: [
    { id: 'fat-transfer', name: 'เติมไขมัน', durationMinutes: 60 },
    { id: 'rhinoplasty', name: 'เสริมจมูก', durationMinutes: 60 },
    { id: 'eyelid', name: 'ทำตาสองชั้น', durationMinutes: 60 },
  ],
  channels: [{ id: 'page-tab', name: 'เพจTAB' }, { id: 'page-main', name: 'เพจหลัก' }],
  aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-mus', name: 'มัส' }, { id: 'staff-muay', name: 'หมวย' }],
}

export function createPreviewMiniAppConfig(options: {
  reportingEnabled?: boolean
  financeReportsEnabled?: boolean
  financeUiPreviewEnabled?: boolean
  canViewFinance?: boolean
  stockEnabled?: boolean
  canManageStock?: boolean
  expenseCaptureEnabled?: boolean
  financeReadsEnabled?: boolean
  canSubmitExpense?: boolean
  canManageExpense?: boolean
} = {}): MiniAppConfig {
  return {
    ...PREVIEW_CONFIG,
    reportingEnabled: options.reportingEnabled === true,
    financeReportsEnabled: options.financeReportsEnabled === true,
    financeUiPreviewEnabled: options.financeUiPreviewEnabled === true,
    canViewFinance: (options.financeReportsEnabled === true || options.financeReadsEnabled === true)
      && options.canViewFinance === true,
    stockEnabled: options.stockEnabled === true,
    canManageStock: options.stockEnabled === true && options.canManageStock === true,
    expenseCaptureEnabled: options.expenseCaptureEnabled === true,
    financeReadsEnabled: options.financeReadsEnabled === true,
    canSubmitExpense: options.expenseCaptureEnabled === true && options.canSubmitExpense === true,
    canManageExpense: options.financeReadsEnabled === true && options.expenseCaptureEnabled === true && options.canManageExpense === true,
  }
}

export function createPreviewMiniAppApi(options: {
  staffAllowed?: boolean
  reportingEnabled?: boolean
  financeReportsEnabled?: boolean
  financeUiPreviewEnabled?: boolean
  canViewFinance?: boolean
  stockEnabled?: boolean
  canManageStock?: boolean
  expenseCaptureEnabled?: boolean
  financeReadsEnabled?: boolean
  canSubmitExpense?: boolean
  canManageExpense?: boolean
  expenseScenario?: 'lost-first-submit'
} = {}): MiniAppBrowserApi {
  let current: BookingDraftProjection | null = null
  let staffAllowed = options.staffAllowed !== false
  let reportRefreshSequence = 0
  const config = createPreviewMiniAppConfig(options)
  const stock = createPreviewStockStore({ canManageStock: config.canManageStock })
  let stagedExpense: { rootRequestId: string; tokens: string[]; fileNames: string[] } | null = null
  const expenseLedgerRows: ExpenseHistoryRow[] = [previewBookExpense()]
  const supersededExpenseIds = new Set<string>()
  const effectiveExpenseRows = () => expenseLedgerRows.filter((row) => (
    row.recordState === 'COMMITTED' && !supersededExpenseIds.has(row.expenseId)
  ))
  const auditableExpenseRows = () => expenseLedgerRows.filter((row) => (
    row.recordState === 'VOID'
    || row.recordState === 'COMMITTED' && !supersededExpenseIds.has(row.expenseId)
  ))
  const expenseRequests = new Map<string, { fingerprint: string; receipt: ExpenseReceipt }>()
  const pendingResumeRoots = new Set<string>()
  let previewSubmissionSequence = 0
  let previewReplacementSequence = 0
  const evidenceTokens = new Map<string, { expenseId: string; attachmentId: string }>()
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
    async loadLatestActiveDraft() { return null },
    async createDraft() {
      current = {
        draftId: 'draft-preview-1', requestId: 'request-preview-1', state: 'DRAFT', retentionState: '', version: 1,
        input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
        caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
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
    async uploadEvidenceBatch(_token, draftId, input) {
      requireDraft(current, draftId)
      const paymentEvidenceIds = input.paymentFiles.map((file, index) => `preview-payment-${index + 1}-${file.name}`)
      const chatEvidenceIds = input.chatFiles.map((file, index) => `preview-chat-${index + 1}-${file.name}`)
      current = {
        ...current!, version: current!.version + 1,
        paymentEvidenceIds: [...current!.paymentEvidenceIds, ...paymentEvidenceIds],
        chatEvidenceIds: [...current!.chatEvidenceIds, ...chatEvidenceIds],
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
    async loadReport<T>(_token: string, reportType: JeraReportType): Promise<JeraClientEnvelope<T>> { return previewReport<T>(reportType, reportRefreshSequence) },
    async refreshReport() {
      reportRefreshSequence += 1
      return { accepted: true, correlationId: `preview-refresh-${reportRefreshSequence}` }
    },
    async loadDailyIncome(_token: string, filter: FinanceDailyFilter) { return previewDailyIncomeProjection(filter.startDate, filter.endDate) },
    async refreshDailyIncome() { return { accepted: true as const, allocationQueued: false, retryAfterSeconds: 0 } },
    async loadMonthlyIncome(_token: string, selection: FinanceMonthSelection) {
      const startDate = `${selection.year}-${String(selection.month).padStart(2, '0')}-01`
      const endDate = new Date(Date.UTC(selection.year, selection.month, 0)).toISOString().slice(0, 10)
      const daily = previewDailyIncomeProjection(startDate, endDate)
      return {
        ...daily,
        monthKey: `${selection.year}-${String(selection.month).padStart(2, '0')}`,
        dailyTrend: [...daily.payments].reverse().map((payment) => ({
          date: payment.eventDate,
          receivedSatang: payment.paidAmountSatang,
          refundSatang: 1_001,
          netReceivedSatang: payment.paidAmountSatang - 1_001,
        })),
        expense: { state: 'NOT_IMPLEMENTED' as const, clinicExpenseSatang: null, estimatedBalanceSatang: null },
      } satisfies MonthlyIncomeProjection
    },
    async loadMonthlyExpenses(_token, monthKey) {
      const effective = effectiveExpenseRows().filter((row) => row.expenseDate.startsWith(`${monthKey}-`))
      const clinic = effective.filter((row) => row.scope === 'CLINIC')
      return {
        monthKey,
        clinicCommittedSatang: clinic.reduce((total, row) => total + row.amountSatang, 0),
        doctorPersonalCommittedSatang: effective.filter((row) => row.scope === 'DOCTOR_PERSONAL')
          .reduce((total, row) => total + row.amountSatang, 0),
        clinicByCategorySatang: {
          BILL_DOCUMENT: clinic.filter((row) => row.category === 'BILL_DOCUMENT')
            .reduce((total, row) => total + row.amountSatang, 0),
          BOOK_CLINIC: clinic.filter((row) => row.category === 'BOOK_CLINIC')
            .reduce((total, row) => total + row.amountSatang, 0),
        },
        effectiveExpenseCount: effective.length,
        unreviewed: true as const,
      }
    },
    async loadExpenseHistory(_token, monthKey) {
      return {
        expenses: structuredClone(auditableExpenseRows().filter((row) => row.expenseDate.startsWith(`${monthKey}-`))),
        nextCursor: null,
      }
    },
    async issueExpenseEvidenceToken(_token, expenseId, attachmentId) {
      const row = auditableExpenseRows().find((candidate) => candidate.expenseId === expenseId)
      if (!row?.attachments.some((attachment) => attachment.attachmentId === attachmentId)) throw previewExpenseError('EXPENSE_EVIDENCE_NOT_FOUND')
      const token = `preview-evidence-${expenseId}-${attachmentId}.preview-signature`
      evidenceTokens.set(token, { expenseId, attachmentId })
      return token
    },
    async downloadExpenseEvidence(_token, token) {
      if (!evidenceTokens.has(token)) throw previewExpenseError('EXPENSE_EVIDENCE_NOT_FOUND')
      return previewEvidenceBlob()
    },
    async loadStockProducts() { return stock.loadProducts() },
    async loadStockHistory(_token: string, cursor?: string) { return stock.loadHistory(cursor) },
    async submitStockCommand(_token: string, command: StockClientCommand) {
      return stock.submit(command)
    },
    async stageExpense(_token, rootRequestId, files) {
      const tokens = files.map((_, index) => `preview-expense-stage-${index + 1}.${'a'.repeat(43)}`)
      stagedExpense = { rootRequestId, tokens, fileNames: files.map(({ name }) => name) }
      return { stagingTokens: [...tokens] }
    },
    async submitExpense(_token, input) {
      requirePreviewStaging(stagedExpense, input)
      const fingerprint = previewExpenseFingerprint(input)
      const existing = expenseRequests.get(input.rootRequestId)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw previewExpenseError('EXPENSE_IDEMPOTENCY_CONFLICT')
        return structuredClone(existing.receipt)
      }
      previewSubmissionSequence += 1
      const receipt = previewExpenseReceipt('PREVIEW', previewSubmissionSequence, input)
      expenseRequests.set(input.rootRequestId, {
        fingerprint,
        receipt,
      })
      expenseLedgerRows.unshift(previewHistoryFromReceipt(receipt, stagedExpense!.fileNames))
      if (options.expenseScenario === 'lost-first-submit') {
        pendingResumeRoots.add(input.rootRequestId)
        throw previewExpenseError('EXPENSE_STORAGE_UNAVAILABLE')
      }
      return structuredClone(receipt)
    },
    async resumeExpense(_token, rootRequestId) {
      const existing = expenseRequests.get(rootRequestId)
      if (pendingResumeRoots.has(rootRequestId)) return { status: 'PENDING' as const }
      if (!existing && options.expenseScenario === 'lost-first-submit') {
        return { status: 'COMMITTED' as const, receipt: previewLostResponseReceipt() }
      }
      return existing
        ? { status: 'COMMITTED' as const, receipt: structuredClone(existing.receipt) }
        : { status: 'SAFE_TO_RETRY' as const }
    },
    async replaceExpense(_token, expenseId, input: ExpenseSubmitInput) {
      requirePreviewStaging(stagedExpense, input)
      const currentRow = effectiveExpenseRows().find((row) => row.expenseId === expenseId)
      if (!currentRow
        || currentRow.category !== input.category
        || currentRow.expenseDate !== input.expenseDate
        || currentRow.revision !== input.expectedRevision) throw previewExpenseError('EXPENSE_REVISION_CONFLICT')
      previewReplacementSequence += 1
      const receipt = previewExpenseReceipt('PREVIEW-REPLACEMENT', previewReplacementSequence, input)
      supersededExpenseIds.add(currentRow.expenseId)
      expenseLedgerRows.unshift(previewHistoryFromReceipt(receipt, stagedExpense!.fileNames))
      return structuredClone(receipt)
    },
    async voidExpense(_token, expenseId, input) {
      const row = effectiveExpenseRows().find((candidate) => candidate.expenseId === expenseId)
      if (!row) throw previewExpenseError('EXPENSE_NOT_FOUND')
      const reasonLength = input.reason.trim().length
      if (row.revision !== input.expectedRevision) throw previewExpenseError('EXPENSE_REVISION_CONFLICT')
      if (reasonLength < 3 || reasonLength > 300) throw previewExpenseError('MINI_APP_INVALID_REQUEST')
      row.recordState = 'VOID'
    },
  }
}

function previewLostResponseReceipt(): ExpenseReceipt {
  return {
    expenseId: 'EXP-202608-PREVIEW',
    receiptNumber: 'EXP-202608-PREVIEW',
    expenseDate: '2026-08-30',
    monthKey: '2026-08',
    category: 'BILL_DOCUMENT',
    scope: 'CLINIC',
    amountSatang: 125_050,
    recordState: 'COMMITTED',
    revision: 1,
    committedAt: '2026-08-30T04:00:00.000Z',
    unreviewed: true,
  }
}

function previewBookExpense(): ExpenseHistoryRow {
  return {
    expenseId: 'EXP-202608-BOOK-01',
    expenseDate: '2026-08-29',
    category: 'BOOK_CLINIC',
    scope: 'CLINIC',
    amountSatang: 98_000,
    description: 'ยอดสมุดประจำวัน',
    recordState: 'COMMITTED',
    revision: 1,
    submittedByName: 'มัส',
    submittedAt: '2026-08-29T03:00:00.000Z',
    committedAt: '2026-08-29T03:01:00.000Z',
    attachments: [{
      attachmentId: 'ATT-1', expenseId: 'EXP-202608-BOOK-01', ordinal: 1,
      mediaType: 'image/png', originalFileName: 'proof.png',
    }],
  }
}

function previewExpenseReceipt(
  suffix: 'PREVIEW' | 'PREVIEW-REPLACEMENT',
  sequence: number,
  input: ExpenseSubmitInput,
): ExpenseReceipt {
  const uniqueSuffix = sequence === 1 ? suffix : `${suffix}-${sequence}`
  const expenseId = `EXP-${input.expenseDate.slice(0, 7).replace('-', '')}-${uniqueSuffix}`
  return {
    expenseId,
    receiptNumber: expenseId,
    expenseDate: input.expenseDate,
    monthKey: input.expenseDate.slice(0, 7),
    category: input.category,
    scope: deriveExpenseScope(input.category),
    amountSatang: input.amountSatang,
    recordState: 'COMMITTED',
    revision: input.expectedRevision + 1,
    committedAt: '2026-08-30T04:00:00.000Z',
    unreviewed: true,
  }
}

function previewHistoryFromReceipt(receipt: ExpenseReceipt, fileNames: string[]): ExpenseHistoryRow {
  return {
    expenseId: receipt.expenseId,
    expenseDate: receipt.expenseDate,
    category: receipt.category,
    scope: receipt.scope,
    amountSatang: receipt.amountSatang,
    description: '',
    recordState: 'COMMITTED',
    revision: receipt.revision,
    submittedByName: PREVIEW_SESSION.displayName,
    submittedAt: receipt.committedAt,
    committedAt: receipt.committedAt,
    attachments: fileNames.map((originalFileName, index) => ({
      attachmentId: `ATT-${receipt.expenseId.slice(4)}-${index + 1}`,
      expenseId: receipt.expenseId,
      ordinal: index + 1,
      mediaType: originalFileName.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      originalFileName,
    })),
  }
}

function requirePreviewStaging(
  staged: { rootRequestId: string; tokens: string[] } | null,
  input: ExpenseSubmitInput,
): void {
  if (!staged || staged.rootRequestId !== input.rootRequestId
    || staged.tokens.join('|') !== input.stagingTokens.join('|')) throw previewExpenseError('EXPENSE_STAGING_INVALID')
}

function previewExpenseFingerprint(input: ExpenseSubmitInput): string {
  return JSON.stringify(input)
}

function previewExpenseError(code: string): Error & { code: string; retryable?: boolean } {
  return Object.assign(new Error(code), { code, retryable: code === 'EXPENSE_STORAGE_UNAVAILABLE' })
}

function previewEvidenceBlob(): Blob {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: 'image/png' })
}

function emptyDailyIncomeProjection(startDate: string, endDate: string): DailyIncomeProjection {
  return {
    startDate,
    endDate,
    receivedSatang: 0,
    refundSatang: 0,
    netReceivedSatang: 0,
    channels: { transferSatang: 0, cashSatang: 0, creditSatang: 0, otherSatang: 0, differenceSatang: 0 },
    categories: { state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null, incompleteDates: [startDate] },
    payments: [],
    freshness: {
      payment: { lastSuccessAt: null, stale: true, warningCode: 'PREVIEW' },
      refund: { lastSuccessAt: null, stale: true, warningCode: 'PREVIEW' },
      allocation: { lastSuccessAt: null, stale: true, warningCode: 'PREVIEW' },
    },
    warnings: ['PREVIEW'],
  }
}

function previewDailyIncomeProjection(startDate: string, endDate: string): DailyIncomeProjection {
  const start = Date.parse(`${startDate}T00:00:00.000Z`)
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return emptyDailyIncomeProjection(startDate, endDate)
  const dates = Array.from(
    { length: Math.floor((end - start) / 86_400_000) + 1 },
    (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  )
  const payments = [...dates].reverse().map((eventDate) => {
    const compactDate = eventDate.replaceAll('-', '')
    return {
      paymentUuid: `preview-payment-${compactDate}`,
      paymentCode: `PAY-${compactDate}`,
      eventDate,
      patientName: 'ลูกค้าทดสอบ',
      paidAmountSatang: 100_001,
      transferSatang: 60_000,
      cashSatang: 20_000,
      creditSatang: 10_000,
      otherSatang: 10_001,
      serviceSatang: 66_667,
      productSatang: 33_334,
      unclassifiedSatang: 0,
    }
  })
  const dayCount = dates.length
  return {
    startDate,
    endDate,
    receivedSatang: 100_001 * dayCount,
    refundSatang: 1_001 * dayCount,
    netReceivedSatang: 99_000 * dayCount,
    channels: {
      transferSatang: 60_000 * dayCount,
      cashSatang: 20_000 * dayCount,
      creditSatang: 10_000 * dayCount,
      otherSatang: 10_001 * dayCount,
      differenceSatang: 0,
    },
    categories: {
      state: 'READY',
      serviceSatang: 66_667 * dayCount,
      productSatang: 33_334 * dayCount,
      unclassifiedSatang: 0,
      incompleteDates: [],
    },
    payments,
    freshness: {
      payment: { lastSuccessAt: `${endDate}T10:00:00.000Z`, stale: false, warningCode: null },
      refund: { lastSuccessAt: `${endDate}T10:00:00.000Z`, stale: false, warningCode: null },
      allocation: { lastSuccessAt: `${endDate}T10:00:00.000Z`, stale: false, warningCode: null },
    },
    warnings: [],
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
      if (command.commandType !== 'ISSUE' && !canManageStock) {
        throw previewStockError('STOCK_MANAGER_REQUIRED')
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
        const selectedIds = new Set<string>()
        const lineProducts = command.payload.lines.map((line) => {
          if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) {
            throw previewStockError('STOCK_INVALID_QUANTITY')
          }
          if (selectedIds.has(line.productId)) throw previewStockError('STOCK_DUPLICATE_LINE')
          selectedIds.add(line.productId)
          const product = findProduct(line.productId)
          if (!product.active) throw previewStockError('STOCK_PRODUCT_INACTIVE')
          return product
        })
        const lines = command.payload.lines.map((line, index) => {
          const product = lineProducts[index]!
          const delta = isIssue ? -line.quantityMilli : line.quantityMilli
          const nextBalance = product.onHandMilli + delta
          if (nextBalance < 0) throw previewStockError('STOCK_INSUFFICIENT_BALANCE')
          return { productId: product.productId, quantityDeltaMilli: delta, balanceAfterMilli: nextBalance }
        })
        for (const line of lines) {
          const product = findProduct(line.productId)
          product.onHandMilli = line.balanceAfterMilli
          product.lowStock = product.onHandMilli <= product.minimumQuantityMilli
          product.hasLedgerActivity = true
        }
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

function previewReport<T>(reportType: JeraReportType, refreshSequence: number): JeraClientEnvelope<T> {
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
  const refreshedAt = new Date(Date.parse('2026-08-27T13:55:00.000Z') + refreshSequence * 60_000).toISOString()
  return {
    data: data as unknown as T,
    source: 'CACHE', fetchedAt: refreshedAt, lastSuccessAt: refreshedAt,
    refreshing: false, stale: false, warningCode: null,
  }
}

function requireDraft(draft: BookingDraftProjection | null, draftId: string, version?: number): void {
  if (!draft || draft.draftId !== draftId) throw new Error('preview draft missing')
  if (version !== undefined && draft.version !== version) throw new Error('preview draft version conflict')
}
