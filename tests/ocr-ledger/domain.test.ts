import { describe, expect, it } from 'vitest'
import { bangkokMonthKey, maskAccountIdentifier, transitionDocument, validateExtraction } from '../../server/ocr-ledger/domain'

describe('OCR ledger domain', () => {
  it('requires review before confirmation and makes final states immutable', () => {
    expect(transitionDocument('OCR_PROCESSING', 'OCR_SUCCEEDED')).toBe('PENDING_REVIEW')
    expect(transitionDocument('PENDING_REVIEW', 'CONFIRM')).toBe('CONFIRMED')
    expect(() => transitionDocument('CONFIRMED', 'CANCEL')).toThrow('Final document state')
  })

  it('flags line/header mismatch without replacing the extracted values', () => {
    const result = validateExtraction({
      documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22',
      currency: 'THB', subtotal: 180, discountAmount: 0, taxAmount: 0,
      serviceCharge: 0, grandTotal: 200,
      senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
      receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
      merchantName: null, merchantTaxId: null, branch: null, receiptNumber: null, receiptDate: null, paymentMethod: null,
      lineItems: [
        { lineNumber: 1, description: 'A', quantity: 1, unit: null, unitPrice: 80, discountAmount: 0, taxAmount: 0, lineTotal: 80, categoryId: null, confidence: 0.99 },
        { lineNumber: 2, description: 'B', quantity: 1, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: null, confidence: 0.99 },
      ],
    }, '2026-08-22')
    expect(result.normalized.grandTotal).toBe(200)
    expect(result.warnings.map((item) => item.code)).toContain('HEADER_TOTAL_MISMATCH')
  })

  it('uses the supplied Bangkok date rather than ambient time when checking future dates', () => {
    const input = receiptExtraction({ documentDate: '2026-08-22' })
    expect(validateExtraction(input, '2026-08-22').warnings.map((item) => item.code)).not.toContain('FUTURE_DATE')
    expect(validateExtraction(input, '2026-08-21').warnings.map((item) => item.code)).toContain('FUTURE_DATE')
  })

  it('retains unreadable receipt values as null and creates review warnings', () => {
    const input = receiptExtraction({
      categoryId: null,
      confidenceByField: { grandTotal: null },
      lineItems: [{ lineNumber: 1, description: 'Unreadable', quantity: 1, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: null, categoryId: null, confidence: null }],
    })
    const result = validateExtraction(input, '2026-08-22')
    expect(result.normalized.lineItems[0].lineTotal).toBeNull()
    expect(result.warnings.filter((item) => item.code === 'UNREADABLE_FIELD').map((item) => item.field))
      .toEqual(expect.arrayContaining(['categoryId', 'grandTotal', 'lineItems.1.lineTotal', 'lineItems.1.confidence']))
  })

  it('rejects non-finite line numbers and field confidences', () => {
    expect(() => validateExtraction(receiptExtraction({ lineItems: [{ lineNumber: Number.NaN, description: 'A', quantity: 1, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: null, confidence: 0.9 }] }), '2026-08-22'))
      .toThrow('non-finite')
    expect(() => validateExtraction(receiptExtraction({ confidenceByField: { grandTotal: Number.POSITIVE_INFINITY } }), '2026-08-22'))
      .toThrow('non-finite')
  })

  it('rejects invalid calendar dates instead of deriving invalid ledger keys', () => {
    expect(() => bangkokMonthKey('2026-99-22')).toThrow('Invalid ISO date')
  })

  it('derives masking from account digits even when the input already contains mask characters', () => {
    expect(maskAccountIdentifier('1234567890*')).toBe('123-****-**0')
    expect(maskAccountIdentifier('123-*-***4')).toBe('123-****-**4')
    expect(maskAccountIdentifier('••••')).toBe('****')
  })
})

function receiptExtraction(overrides: Record<string, unknown> = {}) {
  return {
    documentType: 'RECEIPT' as const, direction: 'EXPENSE' as const, documentDate: '2026-08-22',
    currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0, serviceCharge: 0, grandTotal: 100,
    senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
    receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
    merchantName: null, merchantTaxId: null, branch: null, receiptNumber: null, receiptDate: null, paymentMethod: null,
    lineItems: [],
    ...overrides,
  }
}
