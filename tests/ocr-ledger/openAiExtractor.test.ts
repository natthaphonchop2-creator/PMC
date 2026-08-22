import { describe, expect, it, vi } from 'vitest'
import { createOpenAiOcrExtractor, OcrExtractorError } from '../../server/ocr-ledger/openAiExtractor'

const preparedImage = {
  originalSha256: 'a'.repeat(64),
  analysisJpeg: Buffer.from('synthetic-jpeg'),
  width: 100,
  height: 100,
}

describe('OpenAI OCR extractor', () => {
  it('sends one strict Responses image request and returns a draft with deterministic warnings', async () => {
    const fetch = vi.fn(async () => fakeResponse(200, { output_text: JSON.stringify(validExtraction()) }))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', fetch, referenceDate: '2026-08-22' })

    const extraction = await extractor.extract(preparedImage)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, request] = fetch.mock.calls[0]!
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      input: [{ role: 'user', content: [
        { type: 'input_text', text: expect.stringContaining('STAFF_CONFIRMED') },
        { type: 'input_image', image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
      ] }],
      text: { format: { type: 'json_schema', name: 'pmc_internal_ocr_document_v1', strict: true } },
    })
    expect(body.text.format.schema.properties.documentType).toMatchObject({ type: ['string', 'null'], enum: ['TRANSFER_SLIP', 'RECEIPT', null] })
    expect(body.text.format.schema.properties.direction).toMatchObject({ type: ['string', 'null'], enum: ['INCOME', 'EXPENSE', null] })
    expect(body.text.format.schema.required).toEqual(expect.arrayContaining(['confidenceByField', 'lineItems']))
    expect(body.instructions).toContain('Do not invent')
    expect(body.instructions).toContain('bank verification')
    expect(extraction.sourceImageSha256).toBe(preparedImage.originalSha256)
    expect(extraction.warnings).toEqual([])
  })

  it.each([
    ['refusal', fakeResponse(200, { output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }), 'OCR_REFUSAL'],
    ['malformed JSON', fakeResponse(200, { output_text: 'not-json' }), 'OCR_INVALID_OUTPUT'],
    ['unsupported enum', fakeResponse(200, { output_text: JSON.stringify(validExtraction({ documentType: 'OTHER' })) }), 'OCR_INVALID_OUTPUT'],
    ['missing required key', fakeResponse(200, { output_text: JSON.stringify(withoutKey(validExtraction(), 'currency')) }), 'OCR_INVALID_OUTPUT'],
    ['rate limit', fakeResponse(429, { error: { message: 'provider body must not escape' } }), 'OCR_RATE_LIMIT'],
    ['provider error', fakeResponse(500, { error: { message: 'provider body must not escape' } }), 'OCR_PROVIDER_ERROR'],
  ])('returns a typed safe error for %s', async (_caseName, response, code) => {
    const fetch = vi.fn(async () => response)
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', fetch, referenceDate: '2026-08-22' })

    const result = extractor.extract(preparedImage)
    await expect(result).rejects.toBeInstanceOf(OcrExtractorError)
    await expect(result).rejects.toMatchObject({ code, message: expect.not.stringContaining('provider body must not escape') })
  })
})

function fakeResponse(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

function validExtraction(overrides: Record<string, unknown> = {}) {
  return {
    documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22', documentTime: null,
    counterpartyName: 'PMC Supplier', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
    serviceCharge: 0, grandTotal: 100, referenceNumber: 'R-1', categoryId: 'office', note: null,
    confidenceByField: {
      documentType: 0.99, direction: 0.99, documentDate: 0.99, documentTime: null,
      counterpartyName: 0.99, currency: 0.99, subtotal: 0.99, discountAmount: 0.99,
      taxAmount: 0.99, serviceCharge: 0.99, grandTotal: 0.99, referenceNumber: 0.99,
      categoryId: 0.99, note: null,
    },
    lineItems: [{ lineNumber: 1, description: 'Paper', quantity: 1, unit: 'pack', unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: 'office', confidence: 0.99 }],
    ...overrides,
  }
}

function withoutKey(input: Record<string, unknown>, key: string) {
  const copy = { ...input }
  delete copy[key]
  return copy
}
