import { describe, expect, it } from 'vitest'
import type { OcrDocument } from '../../src/apps/ocr-ledger/contracts'
import { aggregateOcrReport, reportWindow, shouldSendDailyReport } from '../../server/ocr-ledger/reports'

describe('OCR ledger reports', () => {
  it('aggregates only confirmed financial values while retaining operational state and duplicate counts', () => {
    const report = aggregateOcrReport([
      document({ documentId: 'income', state: 'CONFIRMED', direction: 'INCOME', grandTotal: 1000, taxAmount: 70, categoryId: 'sales' }),
      document({ documentId: 'expense', state: 'CONFIRMED', direction: 'EXPENSE', grandTotal: 300, taxAmount: 21, categoryId: 'office' }),
      document({ documentId: 'pending', state: 'PENDING_REVIEW', direction: 'EXPENSE', grandTotal: 9000, categoryId: 'ignored' }),
      document({ documentId: 'failed', state: 'FAILED', direction: 'INCOME', grandTotal: 8000, categoryId: 'ignored' }),
      document({ documentId: 'cancelled', state: 'CANCELLED', direction: 'INCOME', grandTotal: 7000, categoryId: 'ignored' }),
      document({ documentId: 'warning', state: 'PENDING_REVIEW', warnings: [{ code: 'EXACT_IMAGE_DUPLICATE', field: 'sourceImageSha256', message: 'duplicate' }] }),
    ])

    expect(report).toMatchObject({ income: 1000, expense: 300, net: 700, tax: 91 })
    expect(report.operational).toMatchObject({ confirmed: 2, pending: 2, failed: 1, cancelled: 1, duplicateWarnings: 1 })
    expect(report.categories).toEqual([
      { categoryId: 'sales', amount: 1000, income: 1000, expense: 0 },
      { categoryId: 'office', amount: -300, income: 0, expense: 300 },
    ])
  })

  it('uses Bangkok calendar windows across month and year boundaries', () => {
    expect(reportWindow('TODAY', new Date('2026-12-31T18:00:00.000Z'))).toMatchObject({ start: '2027-01-01', endExclusive: '2027-01-02' })
    expect(reportWindow('YESTERDAY', new Date('2026-12-31T18:00:00.000Z'))).toMatchObject({ start: '2026-12-31', endExclusive: '2027-01-01' })
    expect(reportWindow('MONTH', new Date('2026-12-31T18:00:00.000Z'))).toMatchObject({ start: '2027-01-01', endExclusive: '2027-02-01' })
  })

  it('sends a daily report at 20:00 Bangkok, catches up later, and skips after its key is recorded', () => {
    const groupId = 'Cgroup1'
    const before = new Date('2026-08-22T12:59:00.000Z')
    const due = new Date('2026-08-22T13:00:00.000Z')
    const catchUp = new Date('2026-08-22T16:00:00.000Z')
    const key = 'report:Cgroup1:2026-08-22:daily'

    expect(shouldSendDailyReport({ enabled: true, groupId, now: before, sentKeys: new Set() })).toBe(false)
    expect(shouldSendDailyReport({ enabled: true, groupId, now: due, sentKeys: new Set() })).toBe(true)
    expect(shouldSendDailyReport({ enabled: true, groupId, now: catchUp, sentKeys: new Set() })).toBe(true)
    expect(shouldSendDailyReport({ enabled: true, groupId, now: catchUp, sentKeys: new Set([key]) })).toBe(false)
  })

  it('ranks categories by absolute amount then category ID for deterministic ties', () => {
    const report = aggregateOcrReport([
      document({ documentId: 'a', state: 'CONFIRMED', direction: 'EXPENSE', grandTotal: 500, categoryId: 'zebra' }),
      document({ documentId: 'b', state: 'CONFIRMED', direction: 'INCOME', grandTotal: 500, categoryId: 'alpha' }),
      document({ documentId: 'c', state: 'CONFIRMED', direction: 'EXPENSE', grandTotal: 600, categoryId: 'office' }),
    ])

    expect(report.categories.map((category) => category.categoryId)).toEqual(['office', 'alpha', 'zebra'])
  })
})

function document(overrides: Partial<OcrDocument> = {}): OcrDocument {
  return {
    documentId: 'OCR-20260822-abc123', documentType: 'RECEIPT', direction: 'EXPENSE', state: 'PENDING_REVIEW',
    documentDate: '2026-08-22', documentTime: null, counterpartyName: null, currency: 'THB', subtotal: 0,
    discountAmount: 0, taxAmount: 0, serviceCharge: 0, grandTotal: 0, referenceNumber: null, categoryId: null, note: null,
    sourceImageFileId: null, sourceImageSha256: null, sourceLineMessageId: null, sourceLineUserId: null, confidenceByField: {},
    senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null, receiverAccountMasked: null,
    transferDate: null, transferTime: null, amount: null, merchantName: null, merchantTaxId: null, branch: null, receiptNumber: null,
    receiptDate: null, paymentMethod: null, draftVersion: 1, confirmedBy: null, confirmedAt: null, verificationStatus: null, warnings: [],
    ...overrides,
  }
}
