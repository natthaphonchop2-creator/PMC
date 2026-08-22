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
    const fetch = vi.fn(async () => completedResponse(validExtraction()))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

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
    expect(body.text.format.schema.properties.confidenceByField.properties.currency).toMatchObject({ minimum: 0, maximum: 1 })
    expect(body.text.format.schema.properties.confidenceByField.required).toEqual(expect.arrayContaining([
      'senderName', 'senderBank', 'senderAccountMasked', 'receiverName', 'receiverBank', 'receiverAccountMasked',
      'transferDate', 'transferTime', 'amount', 'merchantName', 'merchantTaxId', 'branch', 'receiptNumber',
      'receiptDate', 'paymentMethod',
    ]))
    expect(body.text.format.schema.required).toEqual(expect.arrayContaining(['senderName', 'amount', 'merchantName', 'paymentMethod']))
    expect(body.text.format.schema.properties.lineItems.items.properties.lineNumber).toMatchObject({ minimum: 1, multipleOf: 1 })
    expect(body.text.format.schema.required).toEqual(expect.arrayContaining(['confidenceByField', 'lineItems']))
    expect(body.max_output_tokens).toBe(512)
    expect(body.instructions).toContain('Do not invent')
    expect(body.instructions).toContain('bank verification')
    expect(extraction.sourceImageSha256).toBe(preparedImage.originalSha256)
    expect(extraction.warnings).toEqual([])
    expect(extraction).toMatchObject({
      merchantName: 'PMC Supplier', merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่',
      receiptNumber: 'R-1', receiptDate: '2026-08-22', paymentMethod: 'CASH',
    })
  })

  it('preserves visibly masked transfer accounts and masks an unmasked account before returning it', async () => {
    const fetch = vi.fn(async () => completedResponse(validExtraction({
      documentType: 'TRANSFER_SLIP', lineItems: [], merchantName: null, merchantTaxId: null, branch: null,
      receiptNumber: null, receiptDate: null, paymentMethod: null,
      senderName: 'ผู้โอน', senderBank: 'BANK A', senderAccountMasked: '123-*-***4',
      receiverName: 'ผู้รับ', receiverBank: 'BANK B', receiverAccountMasked: '9876543210',
      transferDate: '2026-08-22', transferTime: '10:15', amount: 100,
    })))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    const extraction = await extractor.extract(preparedImage)

    expect(extraction.senderAccountMasked).toBe('123-*-***4')
    expect(extraction.receiverAccountMasked).toContain('****')
    expect(extraction.receiverAccountMasked).not.toContain('9876543210')
  })

  it('preserves an unreadable currency as null', async () => {
    const fetch = vi.fn(async () => completedResponse(validExtraction({ currency: null, confidenceByField: { ...validExtraction().confidenceByField, currency: null } })))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    const extraction = await extractor.extract(preparedImage)

    expect(extraction.currency).toBeNull()
  })

  it.each([
    ['negative header confidence', validExtraction({ confidenceByField: { ...validExtraction().confidenceByField, grandTotal: -0.01 } })],
    ['header confidence over one', validExtraction({ confidenceByField: { ...validExtraction().confidenceByField, grandTotal: 1.01 } })],
    ['negative line confidence', validExtraction({ lineItems: [{ ...validExtraction().lineItems[0], confidence: -0.01 }] })],
    ['line confidence over one', validExtraction({ lineItems: [{ ...validExtraction().lineItems[0], confidence: 1.01 }] })],
  ])('rejects %s', async (_caseName, extraction) => {
    const fetch = vi.fn(async () => completedResponse(extraction))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    await expect(extractor.extract(preparedImage)).rejects.toMatchObject({ code: 'OCR_INVALID_OUTPUT' })
  })

  it.each([
    ['zero', [{ ...validExtraction().lineItems[0], lineNumber: 0 }]],
    ['fractional', [{ ...validExtraction().lineItems[0], lineNumber: 1.5 }]],
    ['duplicate', [{ ...validExtraction().lineItems[0], lineNumber: 1 }, { ...validExtraction().lineItems[0], lineNumber: 1 }]],
    ['gap', [{ ...validExtraction().lineItems[0], lineNumber: 1 }, { ...validExtraction().lineItems[0], lineNumber: 3 }]],
    ['out of order', [{ ...validExtraction().lineItems[0], lineNumber: 2 }, { ...validExtraction().lineItems[0], lineNumber: 1 }]],
  ])('rejects %s receipt line numbers', async (_caseName, lineItems) => {
    const fetch = vi.fn(async () => completedResponse(validExtraction({ lineItems })))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    await expect(extractor.extract(preparedImage)).rejects.toMatchObject({ code: 'OCR_INVALID_OUTPUT' })
  })

  it.each(['incomplete', 'failed'])('rejects an HTTP-200 response with provider status %s', async (status) => {
    const fetch = vi.fn(async () => fakeResponse(200, { status, output_text: JSON.stringify(validExtraction()) }))
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    await expect(extractor.extract(preparedImage)).rejects.toMatchObject({ code: 'OCR_INVALID_OUTPUT' })
  })

  it.each([
    ['refusal', fakeResponse(200, { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }), 'OCR_REFUSAL'],
    ['malformed JSON', fakeResponse(200, { status: 'completed', output_text: 'not-json' }), 'OCR_INVALID_OUTPUT'],
    ['unsupported enum', fakeResponse(200, { status: 'completed', output_text: JSON.stringify(validExtraction({ documentType: 'OTHER' })) }), 'OCR_INVALID_OUTPUT'],
    ['missing required key', fakeResponse(200, { status: 'completed', output_text: JSON.stringify(withoutKey(validExtraction(), 'currency')) }), 'OCR_INVALID_OUTPUT'],
    ['rate limit', fakeResponse(429, { error: { message: 'provider body must not escape' } }), 'OCR_RATE_LIMIT'],
    ['provider error', fakeResponse(500, { error: { message: 'provider body must not escape' } }), 'OCR_PROVIDER_ERROR'],
  ])('returns a typed safe error for %s', async (_caseName, response, code) => {
    const fetch = vi.fn(async () => response)
    const extractor = createOpenAiOcrExtractor({ apiKey: 'test-key', model: 'gpt-5.5', maxOutputTokens: 512, fetch, referenceDate: '2026-08-22' })

    const result = extractor.extract(preparedImage)
    await expect(result).rejects.toBeInstanceOf(OcrExtractorError)
    await expect(result).rejects.toMatchObject({ code, message: expect.not.stringContaining('provider body must not escape') })
  })
})

function fakeResponse(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

function completedResponse(extraction: Record<string, unknown>) {
  return fakeResponse(200, { status: 'completed', output_text: JSON.stringify(extraction) })
}

function validExtraction(overrides: Record<string, unknown> = {}) {
  return {
    documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22', documentTime: null,
    counterpartyName: 'PMC Supplier', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
    serviceCharge: 0, grandTotal: 100, referenceNumber: 'R-1', categoryId: 'office', note: null,
    senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
    receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
    merchantName: 'PMC Supplier', merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่', receiptNumber: 'R-1',
    receiptDate: '2026-08-22', paymentMethod: 'CASH',
    confidenceByField: {
      documentType: 0.99, direction: 0.99, documentDate: 0.99, documentTime: null,
      counterpartyName: 0.99, currency: 0.99, subtotal: 0.99, discountAmount: 0.99,
      taxAmount: 0.99, serviceCharge: 0.99, grandTotal: 0.99, referenceNumber: 0.99,
      categoryId: 0.99, note: null, senderName: null, senderBank: null, senderAccountMasked: null,
      receiverName: null, receiverBank: null, receiverAccountMasked: null, transferDate: null, transferTime: null,
      amount: null, merchantName: 0.99, merchantTaxId: 0.99, branch: 0.99, receiptNumber: 0.99,
      receiptDate: 0.99, paymentMethod: 0.99,
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
