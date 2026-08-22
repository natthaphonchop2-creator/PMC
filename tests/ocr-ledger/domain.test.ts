import { describe, expect, it } from 'vitest'
import { transitionDocument, validateExtraction } from '../../server/ocr-ledger/domain'

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
      lineItems: [
        { lineNumber: 1, description: 'A', quantity: 1, unit: null, unitPrice: 80, discountAmount: 0, taxAmount: 0, lineTotal: 80, categoryId: null, confidence: 0.99 },
        { lineNumber: 2, description: 'B', quantity: 1, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: null, confidence: 0.99 },
      ],
    })
    expect(result.normalized.grandTotal).toBe(200)
    expect(result.warnings.map((item) => item.code)).toContain('HEADER_TOTAL_MISMATCH')
  })
})
