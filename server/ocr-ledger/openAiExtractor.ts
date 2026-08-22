import type { OcrExtraction, OcrLineItem, OcrWarning } from '../../src/apps/ocr-ledger/contracts.js'
import { validateExtraction } from './domain.js'
import type { PreparedOcrImage } from './imageProcessing.js'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

type OcrExtractorErrorCode = 'OCR_REFUSAL' | 'OCR_INVALID_OUTPUT' | 'OCR_RATE_LIMIT' | 'OCR_PROVIDER_ERROR'

export class OcrExtractorError extends Error {
  code: OcrExtractorErrorCode

  constructor(code: OcrExtractorErrorCode) {
    super(code)
    this.name = 'OcrExtractorError'
    this.code = code
  }
}

export interface OcrExtractionResult extends OcrExtraction {
  warnings: OcrWarning[]
}

export interface OcrExtractorPort {
  extract(image: PreparedOcrImage): Promise<OcrExtractionResult>
}

export type OcrFetch = (input: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export function createOpenAiOcrExtractor(input: {
  apiKey: string
  model: string
  maxOutputTokens: number
  referenceDate: string
  fetch?: OcrFetch
}): OcrExtractorPort {
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0) throw new RangeError('maxOutputTokens must be a positive integer')
  const fetchImpl = input.fetch ?? fetch

  return {
    async extract(image: PreparedOcrImage): Promise<OcrExtractionResult> {
      const response = await callResponsesApi(fetchImpl, input, image).catch((error: unknown) => {
        if (error instanceof OcrExtractorError) throw error
        throw new OcrExtractorError('OCR_PROVIDER_ERROR')
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        throw new OcrExtractorError(response.status === 429 ? 'OCR_RATE_LIMIT' : 'OCR_PROVIDER_ERROR')
      }
      if (!isRecord(body) || body.status !== 'completed') throw new OcrExtractorError('OCR_INVALID_OUTPUT')
      if (hasRefusal(body)) throw new OcrExtractorError('OCR_REFUSAL')

      const outputText = outputTextFrom(body)
      if (!outputText) throw new OcrExtractorError('OCR_INVALID_OUTPUT')

      let parsed: unknown
      try {
        parsed = JSON.parse(outputText)
      } catch {
        throw new OcrExtractorError('OCR_INVALID_OUTPUT')
      }

      const extraction = parseExtraction(parsed, image.originalSha256)
      try {
        const { normalized, warnings } = validateExtraction(extraction, input.referenceDate)
        return { ...normalized, warnings }
      } catch {
        throw new OcrExtractorError('OCR_INVALID_OUTPUT')
      }
    },
  }
}

async function callResponsesApi(
  fetchImpl: OcrFetch,
  input: { apiKey: string; model: string; maxOutputTokens: number },
  image: PreparedOcrImage,
) {
  return fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      max_output_tokens: input.maxOutputTokens,
      instructions: SYSTEM_PROMPT,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: USER_PROMPT },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${image.analysisJpeg.toString('base64')}` },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'pmc_internal_ocr_document_v1',
          schema: OCR_DOCUMENT_SCHEMA,
          strict: true,
        },
      },
    }),
  })
}

function parseExtraction(value: unknown, sourceImageSha256: string): OcrExtraction {
  if (!isRecord(value) || !hasOnlyKeys(value, ROOT_KEYS) || !hasKeys(value, ROOT_KEYS)) throw new OcrExtractorError('OCR_INVALID_OUTPUT')
  if (!isNullableEnum(value.documentType, ['TRANSFER_SLIP', 'RECEIPT']) || !isNullableEnum(value.direction, ['INCOME', 'EXPENSE'])) {
    throw new OcrExtractorError('OCR_INVALID_OUTPUT')
  }
  if (!isNullableString(value.documentDate) || !isNullableString(value.documentTime) || !isNullableString(value.counterpartyName)
    || !isNullableString(value.currency) || !isNullableString(value.referenceNumber) || !isNullableString(value.categoryId) || !isNullableString(value.note)) {
    throw new OcrExtractorError('OCR_INVALID_OUTPUT')
  }
  if (!isNullableFiniteNumber(value.subtotal) || !isNullableFiniteNumber(value.discountAmount)
    || !isNullableFiniteNumber(value.taxAmount) || !isNullableFiniteNumber(value.serviceCharge)
    || !isNullableFiniteNumber(value.grandTotal)) {
    throw new OcrExtractorError('OCR_INVALID_OUTPUT')
  }
  if (!isConfidenceMap(value.confidenceByField) || !Array.isArray(value.lineItems) || !value.lineItems.every(isLineItem)
    || !hasSequentialLineNumbers(value.lineItems)) {
    throw new OcrExtractorError('OCR_INVALID_OUTPUT')
  }

  return {
    documentType: value.documentType,
    direction: value.direction,
    documentDate: value.documentDate,
    documentTime: value.documentTime,
    counterpartyName: value.counterpartyName,
    currency: value.currency,
    subtotal: value.subtotal,
    discountAmount: value.discountAmount,
    taxAmount: value.taxAmount,
    serviceCharge: value.serviceCharge,
    grandTotal: value.grandTotal,
    referenceNumber: value.referenceNumber,
    categoryId: value.categoryId,
    note: value.note,
    sourceImageSha256,
    confidenceByField: value.confidenceByField,
    lineItems: value.lineItems,
  }
}

function isLineItem(value: unknown): value is OcrLineItem {
  if (!isRecord(value) || !hasOnlyKeys(value, LINE_ITEM_KEYS) || !hasKeys(value, LINE_ITEM_KEYS)) return false
  return typeof value.lineNumber === 'number' && Number.isSafeInteger(value.lineNumber) && value.lineNumber > 0
    && [value.description, value.unit, value.categoryId].every(isNullableString)
    && [value.quantity, value.unitPrice, value.discountAmount, value.taxAmount, value.lineTotal].every(isNullableFiniteNumber)
    && isNullableConfidence(value.confidence)
}

function isConfidenceMap(value: unknown): value is Record<string, number | null> {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIDENCE_KEYS) || !hasKeys(value, CONFIDENCE_KEYS)) return false
  return Object.values(value).every(isNullableConfidence)
}

function hasSequentialLineNumbers(items: readonly OcrLineItem[]): boolean {
  return items.every((item, index) => item.lineNumber === index + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key))
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isNullableEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T | null {
  return value === null || allowed.some((candidate) => candidate === value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isNullableConfidence(value: unknown): value is number | null {
  return isNullableFiniteNumber(value) && (value === null || (value >= 0 && value <= 1))
}

function outputTextFrom(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.output_text === 'string') return value.output_text
  const texts: string[] = []
  if (!Array.isArray(value.output)) return null
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string') texts.push(content.text)
    }
  }
  return texts.length > 0 ? texts.join('\n') : null
}

function hasRefusal(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.output)) return false
  return value.output.some((item) => isRecord(item) && Array.isArray(item.content)
    && item.content.some((content) => isRecord(content) && (content.type === 'refusal' || typeof content.refusal === 'string')))
}

const ROOT_KEYS = [
  'documentType', 'direction', 'documentDate', 'documentTime', 'counterpartyName', 'currency',
  'subtotal', 'discountAmount', 'taxAmount', 'serviceCharge', 'grandTotal', 'referenceNumber',
  'categoryId', 'note', 'confidenceByField', 'lineItems',
] as const

const CONFIDENCE_KEYS = [
  'documentType', 'direction', 'documentDate', 'documentTime', 'counterpartyName', 'currency',
  'subtotal', 'discountAmount', 'taxAmount', 'serviceCharge', 'grandTotal', 'referenceNumber',
  'categoryId', 'note',
] as const

const LINE_ITEM_KEYS = [
  'lineNumber', 'description', 'quantity', 'unit', 'unitPrice', 'discountAmount', 'taxAmount',
  'lineTotal', 'categoryId', 'confidence',
] as const

const nullableString = { type: ['string', 'null'] }
const nullableNumber = { type: ['number', 'null'] }
const nullableConfidence = { type: ['number', 'null'], minimum: 0, maximum: 1 }

const OCR_DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ROOT_KEYS,
  properties: {
    documentType: { type: ['string', 'null'], enum: ['TRANSFER_SLIP', 'RECEIPT', null] },
    direction: { type: ['string', 'null'], enum: ['INCOME', 'EXPENSE', null] },
    documentDate: nullableString,
    documentTime: nullableString,
    counterpartyName: nullableString,
    currency: nullableString,
    subtotal: nullableNumber,
    discountAmount: nullableNumber,
    taxAmount: nullableNumber,
    serviceCharge: nullableNumber,
    grandTotal: nullableNumber,
    referenceNumber: nullableString,
    categoryId: nullableString,
    note: nullableString,
    confidenceByField: {
      type: 'object',
      additionalProperties: false,
      required: CONFIDENCE_KEYS,
      properties: Object.fromEntries(CONFIDENCE_KEYS.map((key) => [key, nullableConfidence])),
    },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: LINE_ITEM_KEYS,
        properties: {
          lineNumber: { type: 'number', minimum: 1, multipleOf: 1 },
          description: nullableString,
          quantity: nullableNumber,
          unit: nullableString,
          unitPrice: nullableNumber,
          discountAmount: nullableNumber,
          taxAmount: nullableNumber,
          lineTotal: nullableNumber,
          categoryId: nullableString,
          confidence: nullableConfidence,
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = [
  'You extract a draft from one internal accounting document image.',
  'Return only the required JSON schema.',
  'Do not invent missing amounts, account digits, tax IDs, descriptions, names, dates, or any other values.',
  'Use null for every unreadable value and its confidence.',
  'Do not claim bank verification. The workflow can only be STAFF_CONFIRMED by a human after review.',
  'For a receipt, include every visible line item in document order; for a transfer slip use an empty lineItems array.',
].join(' ')

const USER_PROMPT = 'Extract this document as a review-only draft. Its only possible verification status is STAFF_CONFIRMED after human review; do not confirm it.'
