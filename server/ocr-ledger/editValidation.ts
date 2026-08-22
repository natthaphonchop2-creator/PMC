import type { OcrDraft, OcrLineItem } from '../../src/apps/ocr-ledger/contracts.js'

export type OcrEditablePatch = Pick<OcrDraft,
  | 'documentType' | 'direction' | 'documentDate' | 'documentTime' | 'counterpartyName' | 'currency'
  | 'subtotal' | 'discountAmount' | 'taxAmount' | 'serviceCharge' | 'grandTotal' | 'referenceNumber'
  | 'categoryId' | 'note' | 'lineItems'
>

const PATCH_KEYS = [
  'documentType', 'direction', 'documentDate', 'documentTime', 'counterpartyName', 'currency', 'subtotal',
  'discountAmount', 'taxAmount', 'serviceCharge', 'grandTotal', 'referenceNumber', 'categoryId', 'note', 'lineItems',
] as const
const REQUIRED_KEYS = ['documentType', 'direction', 'documentDate', 'categoryId', 'grandTotal', 'lineItems'] as const
const NULLABLE_STRING_KEYS = ['documentTime', 'counterpartyName', 'currency', 'referenceNumber', 'note'] as const
const NULLABLE_NUMBER_KEYS = ['subtotal', 'discountAmount', 'taxAmount', 'serviceCharge'] as const
const LINE_KEYS = [
  'lineNumber', 'description', 'quantity', 'unit', 'unitPrice', 'discountAmount', 'taxAmount',
  'lineTotal', 'categoryId', 'confidence',
] as const

export function parseOcrEditablePatch(value: unknown): OcrEditablePatch | null {
  if (!isRecord(value) || !hasExactAllowedKeys(value, PATCH_KEYS) || REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))) return null
  if (value.documentType !== 'TRANSFER_SLIP' && value.documentType !== 'RECEIPT') return null
  if (value.direction !== 'INCOME' && value.direction !== 'EXPENSE') return null
  if (typeof value.documentDate !== 'string' || !isIsoCalendarDate(value.documentDate)) return null
  if (typeof value.categoryId !== 'string' || value.categoryId.trim().length === 0) return null
  if (!isFiniteNumber(value.grandTotal)) return null
  if (NULLABLE_STRING_KEYS.some((key) => Object.hasOwn(value, key) && !isNullableString(value[key]))) return null
  if (NULLABLE_NUMBER_KEYS.some((key) => Object.hasOwn(value, key) && !isNullableFiniteNumber(value[key]))) return null
  if (!Array.isArray(value.lineItems) || !value.lineItems.every((line, index) => isEditableLine(line, index + 1))) return null
  return structuredClone(value) as OcrEditablePatch
}

function isEditableLine(value: unknown, expectedLineNumber: number): value is OcrLineItem {
  if (!isRecord(value) || !hasExactAllowedKeys(value, LINE_KEYS) || LINE_KEYS.some((key) => !Object.hasOwn(value, key))) return false
  return value.lineNumber === expectedLineNumber
    && Number.isSafeInteger(value.lineNumber)
    && isNullableString(value.description)
    && isNullableFiniteNumber(value.quantity)
    && isNullableString(value.unit)
    && isNullableFiniteNumber(value.unitPrice)
    && isNullableFiniteNumber(value.discountAmount)
    && isNullableFiniteNumber(value.taxAmount)
    && isNullableFiniteNumber(value.lineTotal)
    && isNullableString(value.categoryId)
    && isNullableConfidence(value.confidence)
}

function hasExactAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isNullableConfidence(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value >= 0 && value <= 1)
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
