import type { OcrDocumentState, OcrDraft, OcrExtraction, OcrLineItem, OcrWarning } from '../../src/apps/ocr-ledger/contracts.js'

export type OcrDomainEvent = 'STORE' | 'START_OCR' | 'OCR_SUCCEEDED' | 'RETRY' | 'FAIL' | 'CONFIRM' | 'CANCEL'

const FINAL_STATES = new Set<OcrDocumentState>(['CONFIRMED', 'CANCELLED'])
const RECONCILIATION_TOLERANCE = 0.01
const LOW_CONFIDENCE_THRESHOLD = 0.8

export function transitionDocument(state: OcrDocumentState, event: OcrDomainEvent): OcrDocumentState {
  if (FINAL_STATES.has(state)) throw new Error('Final document state is immutable')
  if (event === 'RETRY' && state !== 'PENDING_REVIEW') return 'RETRY_PENDING'
  if (event === 'FAIL' && state !== 'PENDING_REVIEW') return 'FAILED'

  const transition = `${state}:${event}`
  const transitions: Readonly<Record<string, OcrDocumentState>> = {
    'RECEIVED:STORE': 'STORED',
    'STORED:START_OCR': 'OCR_PROCESSING',
    'OCR_PROCESSING:OCR_SUCCEEDED': 'PENDING_REVIEW',
    'RETRY_PENDING:START_OCR': 'OCR_PROCESSING',
    'PENDING_REVIEW:CONFIRM': 'CONFIRMED',
    'PENDING_REVIEW:CANCEL': 'CANCELLED',
  }
  const next = transitions[transition]
  if (!next) throw new Error(`Invalid document transition: ${transition}`)
  return next
}

export function validateExtraction(input: OcrExtraction, referenceDate: string): { normalized: OcrExtraction; warnings: OcrWarning[] } {
  assertFiniteNumbers(input)
  const warnings: OcrWarning[] = []
  const { subtotal, discountAmount, taxAmount, serviceCharge, grandTotal } = input

  if (allPresent(subtotal, discountAmount, taxAmount, serviceCharge, grandTotal)) {
    const calculated = subtotal! - discountAmount! + taxAmount! + serviceCharge!
    if (Math.abs(calculated - grandTotal!) > RECONCILIATION_TOLERANCE) {
      warnings.push(warning('HEADER_TOTAL_MISMATCH', 'grandTotal', 'Header totals do not reconcile'))
    }
  }

  const lineTotals = input.lineItems.map((line) => line.lineTotal)
  if (subtotal !== null && lineTotals.length > 0 && lineTotals.every((value) => value !== null)) {
    const lineSum = lineTotals.reduce((sum, value) => sum + (value ?? 0), 0)
    if (Math.abs(lineSum - subtotal) > RECONCILIATION_TOLERANCE) {
      warnings.push(warning('LINE_SUM_MISMATCH', 'subtotal', 'Line totals do not reconcile with subtotal'))
    }
  }

  if (input.documentDate !== null) {
    if (!isIsoCalendarDate(input.documentDate)) {
      warnings.push(warning('INVALID_DATE', 'documentDate', 'Document date is invalid'))
    } else if (isFutureBangkokDate(input.documentDate, referenceDate)) {
      warnings.push(warning('FUTURE_DATE', 'documentDate', 'Document date is in the future'))
    }
  }
  for (const field of ['documentType', 'direction', 'documentDate', 'categoryId', 'grandTotal']) {
    const confidence = input.confidenceByField?.[field]
    const value = input[field as keyof OcrExtraction]
    if (value === null || confidence === null) {
      warnings.push(warning('UNREADABLE_FIELD', field, `Required field ${field} is unreadable`))
    } else if (confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD) {
      warnings.push(warning('LOW_CONFIDENCE_REQUIRED_FIELD', field, `Required field ${field} has low confidence`))
    }
  }
  for (const [index, line] of input.lineItems.entries()) {
    for (const field of ['quantity', 'unitPrice', 'discountAmount', 'taxAmount', 'lineTotal', 'confidence'] as const) {
      if (line[field] === null) warnings.push(warning('UNREADABLE_FIELD', `lineItems.${index + 1}.${field}`, `Line-item field ${field} is unreadable`))
    }
  }
  if (input.sourceImageSha256 && input.confirmedHashes && exactImageDuplicate(input.sourceImageSha256, input.confirmedHashes)) {
    warnings.push(warning('EXACT_IMAGE_DUPLICATE', 'sourceImageSha256', 'Exact image was already confirmed'))
  }
  if (input.referenceNumber && input.confirmedReferenceNumbers?.has(input.referenceNumber)) {
    warnings.push(warning('REPEATED_REFERENCE_NUMBER', 'referenceNumber', 'Reference number was already confirmed'))
  }
  return { normalized: input, warnings }
}

export function exactImageDuplicate(hash: string, confirmedHashes: ReadonlySet<string>): boolean {
  return confirmedHashes.has(hash)
}

export function assertConfirmableDraft(draft: OcrDraft): void {
  if (draft.documentType !== 'TRANSFER_SLIP' && draft.documentType !== 'RECEIPT') throw new Error('Draft requires review')
  if (draft.direction !== 'INCOME' && draft.direction !== 'EXPENSE') throw new Error('Draft requires review')
  if (typeof draft.documentDate !== 'string' || !isIsoCalendarDate(draft.documentDate)) throw new Error('Draft requires review')
  if (typeof draft.categoryId !== 'string' || draft.categoryId.trim().length === 0) throw new Error('Draft requires review')
  if (typeof draft.grandTotal !== 'number' || !Number.isFinite(draft.grandTotal)) throw new Error('Draft requires review')
  if (!Array.isArray(draft.lineItems)) throw new Error('Draft requires review')
  if (draft.documentType === 'RECEIPT' && !draft.lineItems.every((line, index) => isConfirmableReceiptLine(line, index + 1, draft.documentId))) {
    throw new Error('Draft requires review')
  }
}

export function bangkokMonthKey(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    if (!isIsoCalendarDate(isoDate)) throw new Error('Invalid ISO date')
    return isoDate.slice(0, 7)
  }
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO date')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(date)
    .reduce((result, part) => (part.type === 'year' || part.type === 'month' ? { ...result, [part.type]: part.value } : result), {} as Record<string, string>)
  return `${parts.year}-${parts.month}`
}

function assertFiniteNumbers(input: OcrExtraction): void {
  const fields = [input.subtotal, input.discountAmount, input.taxAmount, input.serviceCharge, input.grandTotal]
  const fieldConfidences = input.confidenceByField ? Object.values(input.confidenceByField) : []
  for (const value of [...fields, ...fieldConfidences, ...input.lineItems.flatMap((line) => [line.lineNumber, line.quantity, line.unitPrice, line.discountAmount, line.taxAmount, line.lineTotal, line.confidence])]) {
    if (value !== null && !Number.isFinite(value)) throw new TypeError('Extraction contains a non-finite number')
  }
}

function allPresent(...values: Array<number | null>): boolean {
  return values.every((value) => value !== null)
}

function warning(code: OcrWarning['code'], field: string, message: string): OcrWarning {
  return { code, field, message }
}

function isFutureBangkokDate(date: string, referenceDate: string): boolean {
  return date > bangkokDateKey(referenceDate)
}

function bangkokDateKey(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    if (!isIsoCalendarDate(isoDate)) throw new Error('Invalid ISO date')
    return isoDate
  }
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO date')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce((result, part) => (part.type === 'year' || part.type === 'month' || part.type === 'day' ? { ...result, [part.type]: part.value } : result), {} as Record<string, string>)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isConfirmableReceiptLine(line: OcrLineItem, expectedLineNumber: number, documentId: string): boolean {
  return Boolean(line) && typeof line === 'object'
    && line.lineNumber === expectedLineNumber
    && Number.isSafeInteger(line.lineNumber)
    && (line.documentId === undefined || line.documentId === null || line.documentId === documentId)
    && isNullableString(line.description)
    && isNullableFiniteNumber(line.quantity)
    && isNullableString(line.unit)
    && isNullableFiniteNumber(line.unitPrice)
    && isNullableFiniteNumber(line.discountAmount)
    && isNullableFiniteNumber(line.taxAmount)
    && isNullableFiniteNumber(line.lineTotal)
    && isNullableString(line.categoryId)
    && (line.confidence === null || (typeof line.confidence === 'number' && Number.isFinite(line.confidence) && line.confidence >= 0 && line.confidence <= 1))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
