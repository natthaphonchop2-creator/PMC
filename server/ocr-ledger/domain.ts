import type { OcrDocumentState, OcrExtraction, OcrWarning } from '../../src/apps/ocr-ledger/contracts'

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

export function validateExtraction(input: OcrExtraction): { normalized: OcrExtraction; warnings: OcrWarning[] } {
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

  if (input.documentDate !== null && isFutureBangkokDate(input.documentDate)) {
    warnings.push(warning('FUTURE_DATE', 'documentDate', 'Document date is in the future'))
  }
  for (const field of ['documentType', 'direction', 'documentDate', 'categoryId', 'grandTotal']) {
    const confidence = input.confidenceByField?.[field]
    if (confidence !== undefined && confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD) {
      warnings.push(warning('LOW_CONFIDENCE_REQUIRED_FIELD', field, `Required field ${field} has low confidence`))
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

export function bangkokMonthKey(isoDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate.slice(0, 7)
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO date')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(date)
    .reduce((result, part) => (part.type === 'year' || part.type === 'month' ? { ...result, [part.type]: part.value } : result), {} as Record<string, string>)
  return `${parts.year}-${parts.month}`
}

function assertFiniteNumbers(input: OcrExtraction): void {
  const fields = [input.subtotal, input.discountAmount, input.taxAmount, input.serviceCharge, input.grandTotal]
  for (const value of [...fields, ...input.lineItems.flatMap((line) => [line.quantity, line.unitPrice, line.discountAmount, line.taxAmount, line.lineTotal, line.confidence])]) {
    if (value !== null && !Number.isFinite(value)) throw new TypeError('Extraction contains a non-finite number')
  }
}

function allPresent(...values: Array<number | null>): boolean {
  return values.every((value) => value !== null)
}

function warning(code: OcrWarning['code'], field: string, message: string): OcrWarning {
  return { code, field, message }
}

function isFutureBangkokDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value)
    .join('-')
  return date > today
}
