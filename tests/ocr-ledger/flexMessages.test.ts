import { describe, expect, it } from 'vitest'
import type { OcrDraft } from '../../src/apps/ocr-ledger/contracts'
import { verifyReviewToken } from '../../server/ocr-ledger/security'
import { buildDraftFlex, buildFinalFlex, buildReportMessage } from '../../server/ocr-ledger/flexMessages'

describe('OCR LINE Flex messages', () => {
  it('makes a compact privacy-safe draft card with five items, warnings, and signed review actions', () => {
    const message = buildDraftFlex(draft({
      warnings: [{ code: 'LOW_CONFIDENCE_REQUIRED_FIELD', field: 'grandTotal', message: 'ต้องตรวจสอบยอดรวม' }],
      senderAccountMasked: '123-4-56789-0', receiverAccountMasked: '987-6-54321-0',
      lineItems: Array.from({ length: 7 }, (_, index) => line(index + 1)),
      sourceImageFileId: 'driveFileId',
      fullAccountNumber: '123456789012345' as never,
    } as Partial<OcrDraft>), {
      groupId: 'Cgroup1', reviewSigningSecret: 'review-secret', liffUrl: 'https://liff.line.me/2001234567-review', now: 1_800_000_000,
    })

    expect(visibleFlexText(message)).toContain('+2 รายการ')
    expect(visibleFlexText(message)).toContain('ต้องตรวจสอบ')
    expect(JSON.stringify(message)).not.toContain('driveFileId')
    expect(JSON.stringify(message)).not.toContain('fullAccountNumber')
    expect(message.altText).not.toContain('https://')
    expect(visibleFlexText(message)).not.toContain('123-4-56789-0')
    expect(visibleFlexText(message)).toContain('123-****-**0')

    const actions = actionValues(message)
    expect(actions).toHaveLength(4)
    const review = actions.find((action) => action.label === 'แก้ไขข้อมูล')!
    expect(review).toMatchObject({ type: 'uri', uri: expect.stringMatching(/^https:\/\/liff\.line\.me\/2001234567-review\?token=/) })
    const reviewToken = new URL(review.uri).searchParams.get('token')!
    expect(verifyReviewToken(reviewToken, 'review-secret', 1_800_000_000).action).toBe('REVIEW')
    for (const action of actions.filter((action) => action.type === 'postback')) {
      expect(verifyReviewToken(action.data, 'review-secret', 1_800_000_000).action).toBe(action.label === 'ยืนยัน' ? 'CONFIRM' : action.label === 'ยกเลิก' ? 'CANCEL' : 'RETRY')
    }
  })

  it('omits empty values and renders final and report cards without mutable buttons', () => {
    const final = buildFinalFlex(draft({ state: 'CONFIRMED', counterpartyName: null, receiptNumber: null, senderAccountMasked: null, warnings: [] }))
    const report = buildReportMessage({ title: 'สรุปวันนี้', entries: [{ label: 'ยืนยันแล้ว 3 รายการ', value: '฿1,200' }] })

    expect(JSON.stringify(final)).not.toContain('null')
    expect(actionValues(final)).toEqual([])
    expect(actionValues(report)).toEqual([])
    expect(report.altText).not.toContain('https://')
  })
})

function draft(overrides: Partial<OcrDraft> = {}): OcrDraft {
  return {
    documentId: 'OCR-20260822-abc123', documentType: 'RECEIPT', direction: 'EXPENSE', state: 'PENDING_REVIEW',
    documentDate: '2026-08-22', documentTime: null, counterpartyName: 'ร้าน PMC', currency: 'THB', subtotal: 700,
    discountAmount: 0, taxAmount: 0, serviceCharge: 0, grandTotal: 700, referenceNumber: 'R-1', categoryId: 'office', note: null,
    sourceImageFileId: null, sourceImageSha256: null, sourceLineMessageId: null, sourceLineUserId: null,
    confidenceByField: {}, senderName: 'สมชาย', senderBank: 'PMC Bank', senderAccountMasked: null,
    receiverName: null, receiverBank: null, receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
    merchantName: 'ร้าน PMC', merchantTaxId: null, branch: null, receiptNumber: 'R-1', receiptDate: '2026-08-22', paymentMethod: null,
    draftVersion: 2, confirmedBy: null, confirmedAt: null, verificationStatus: null, warnings: [], lineItems: [line(1)],
    ...overrides,
  }
}

function line(lineNumber: number) {
  return { lineNumber, description: `สินค้า ${lineNumber}`, quantity: 1, unit: 'ชิ้น', unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: null, confidence: 0.99 }
}

function visibleFlexText(message: unknown): string {
  const values: string[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) key === 'text' && typeof entry === 'string' ? values.push(entry) : visit(entry)
    }
  }
  visit(message)
  return values.join('\n')
}

function actionValues(message: unknown): Array<Record<string, string>> {
  const actions: Array<Record<string, string>> = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>
      if ((item.type === 'postback' || item.type === 'uri') && typeof item.label === 'string') actions.push(item as Record<string, string>)
      Object.values(value).forEach(visit)
    }
  }
  visit(message)
  return actions
}
