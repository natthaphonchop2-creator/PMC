import { describe, expect, it } from 'vitest'
import type { OcrDraft } from '../../src/apps/ocr-ledger/contracts'
import { verifyReviewToken } from '../../server/ocr-ledger/security'
import { buildDraftFlex, buildFinalFlex, buildPendingReportMessage, buildReportMessage } from '../../server/ocr-ledger/flexMessages'

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

  it('includes present review fields and the final document number', () => {
    const review = buildDraftFlex(draft({
      documentType: 'RECEIPT', direction: 'EXPENSE', categoryId: 'office', discountAmount: 25, taxAmount: 49,
      merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่', paymentMethod: 'เงินสด',
    }), reviewOptions())
    const final = buildFinalFlex(draft({ state: 'CONFIRMED', receiptNumber: 'REC-2026-001' }))

    expect(visibleFlexText(review)).toContain('ประเภทเอกสาร: ใบเสร็จ')
    expect(visibleFlexText(review)).toContain('ทิศทาง: รายจ่าย')
    expect(visibleFlexText(review)).toContain('หมวดหมู่: office')
    expect(visibleFlexText(review)).toContain('ส่วนลด: ฿25')
    expect(visibleFlexText(review)).toContain('ภาษี: ฿49')
    expect(visibleFlexText(review)).toContain('เลขผู้เสียภาษี: 0105555000001')
    expect(visibleFlexText(review)).toContain('สาขา: สำนักงานใหญ่')
    expect(visibleFlexText(review)).toContain('วิธีชำระเงิน: เงินสด')
    expect(visibleFlexText(final)).toContain('เลขที่เอกสาร: REC-2026-001')
  })

  it('shows useful transfer attribution without exposing an unmasked account', () => {
    const review = buildDraftFlex(draft({
      documentType: 'TRANSFER_SLIP', merchantName: null, receiptNumber: null, receiptDate: null,
      senderName: 'ผู้โอน', senderBank: 'BANK A', senderAccountMasked: '1234567890',
      receiverName: 'ผู้รับ', receiverBank: 'BANK B', receiverAccountMasked: '987-*-***0',
      transferDate: '2026-08-22', transferTime: '10:15', amount: 700,
    }), reviewOptions())
    const visible = visibleFlexText(review)

    expect(visible).toContain('ผู้โอน: ผู้โอน')
    expect(visible).toContain('ผู้รับ: ผู้รับ')
    expect(visible).toContain('วันที่โอน: 2026-08-22')
    expect(visible).toContain('เวลาโอน: 10:15')
    expect(visible).toContain('ยอดโอน: ฿700')
    expect(visible).not.toContain('1234567890')
  })

  it('rejects a non-final document and gives reports a fixed safe alt text', () => {
    expect(() => buildFinalFlex(draft({ state: 'PENDING_REVIEW' }))).toThrow('Final Flex requires final document state')

    const report = buildReportMessage({ title: 'https://private.example/secret-token '.repeat(20), entries: [] })
    expect(report.altText).toBe('รายงานบัญชี')
    expect(report.altText).not.toContain('https://')
  })

  it('adds the authorized master Dashboard URL to report messages without source Drive IDs', () => {
    const dashboardUrl = 'https://docs.google.com/spreadsheets/d/master-sheet/edit#gid=0'
    const report = buildReportMessage({ title: 'สรุปวันนี้', entries: [{ label: 'รายรับ', value: '฿100' }], dashboardUrl })
    const pending = buildPendingReportMessage({ title: 'รายการรอตรวจสอบ', totalPending: 0, entries: [], dashboardUrl })

    expect(actionValues(report)).toContainEqual(expect.objectContaining({ type: 'uri', label: 'เปิด Dashboard', uri: dashboardUrl }))
    expect(actionValues(pending)).toContainEqual(expect.objectContaining({ type: 'uri', label: 'เปิด Dashboard', uri: dashboardUrl }))
    expect(JSON.stringify([report, pending])).not.toContain('drive-file')
  })

  it('omits null item descriptions and truncates OCR-derived visible strings deterministically', () => {
    const longDescription = 'ก'.repeat(161)
    const message = buildDraftFlex(draft({
      counterpartyName: 'ข'.repeat(161),
      lineItems: [{ ...line(1), description: null }, { ...line(2), description: longDescription }],
    }), reviewOptions())
    const text = visibleFlexText(message)

    expect(text).not.toContain('ไม่ระบุรายการ')
    expect(text).toContain(`• ×1 ฿100`)
    expect(text).toContain('…')
    expect(text).not.toContain(longDescription)
  })

  it('bounds each rendered text node after labels and line-item metadata are added', () => {
    const message = buildDraftFlex(draft({
      counterpartyName: 'x'.repeat(500),
      lineItems: [{ ...line(1), description: 'y'.repeat(500) }],
    }), reviewOptions())

    expect(textNodes(message).every((value) => [...value].length <= 160)).toBe(true)
    expect(textNodes(message).find((value) => value.startsWith('คู่ค้า: '))).toMatch(/…$/)
    expect(textNodes(message).find((value) => value.startsWith('• '))).toMatch(/…$/)
  })

  it('truncates emoji by Unicode code point without leaving unpaired surrogates', () => {
    const message = buildDraftFlex(draft({
      lineItems: [{ ...line(1), description: '🙂'.repeat(500) }],
    }), reviewOptions())
    const item = textNodes(message).find((value) => value.startsWith('• '))!

    expect([...item]).toHaveLength(160)
    expect(hasUnpairedSurrogate(item)).toBe(false)
    expect(item).toMatch(/…$/)
  })

  it('keeps pending report review links actionable while bounding each visible value', () => {
    const message = buildPendingReportMessage({
      title: 'รายการรอตรวจสอบ', totalPending: 11,
      entries: [{ label: 'OCR-20260822-abc123', value: 'ร้านค้าที่มีชื่อยาวมาก'.repeat(20), reviewUri: 'https://liff.line.me/2001234567-review?token=fresh-review-token' }],
    })

    expect(message.altText).toBe('รายงานบัญชี')
    expect(actionValues(message)).toContainEqual(expect.objectContaining({ type: 'uri', label: 'เปิดตรวจสอบ' }))
    expect(JSON.stringify(message)).toContain('fresh-review-token')
    expect(textNodes(message).every((value) => [...value].length <= 160)).toBe(true)
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

function reviewOptions() {
  return { groupId: 'Cgroup1', reviewSigningSecret: 'review-secret', liffUrl: 'https://liff.line.me/2001234567-review', now: 1_800_000_000 }
}

function visibleFlexText(message: unknown): string {
  return textNodes(message).join('\n')
}

function textNodes(message: unknown): string[] {
  const values: string[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'text' && typeof entry === 'string') values.push(entry)
        else visit(entry)
      }
    }
  }
  visit(message)
  return values
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xdc00 || value.charCodeAt(index + 1) > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
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
