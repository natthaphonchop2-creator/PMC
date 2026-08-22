import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OcrReviewApp, type OcrReviewAdapter, type OcrReviewDraft } from '../../src/apps/ocr-ledger/OcrReviewApp'

const draft: OcrReviewDraft = {
  documentId: 'OCR-20260822-abc123', state: 'PENDING_REVIEW', draftVersion: 2,
  imageUrl: '/api/ocr-ledger/image?t=signed-review-token', documentType: 'RECEIPT', direction: 'EXPENSE',
  documentDate: '2026-08-22', documentTime: '10:15', counterpartyName: 'ร้านทดสอบ', currency: 'THB',
  subtotal: 100, discountAmount: 0, taxAmount: 7, serviceCharge: 0, grandTotal: 107,
  referenceNumber: 'REF-001', categoryId: 'office', note: 'เอกสารทดสอบ',
  warnings: [{ code: 'HEADER_TOTAL_MISMATCH', field: 'grandTotal', message: 'ยอดรวมในภาพไม่ตรงกับรายการ' }],
  lineItems: [{ lineNumber: 1, description: 'กระดาษ A4', quantity: 1, unit: 'รีม', unitPrice: 100, discountAmount: 0, taxAmount: 7, lineTotal: 107, categoryId: 'office' }],
}

function adapter(overrides: Partial<OcrReviewAdapter> = {}): OcrReviewAdapter {
  return {
    initialize: vi.fn().mockResolvedValue('raw-line-id-token'),
    loadDraft: vi.fn().mockResolvedValue(draft),
    loadImage: vi.fn().mockResolvedValue('blob:review-image'),
    submitEdit: vi.fn().mockResolvedValue({ accepted: true, jobId: 'job-1' }),
    revokeImage: vi.fn(),
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('OCR LIFF review page', () => {
  it('renders a Thai loading state before LIFF is initialized', () => {
    const html = renderToStaticMarkup(<OcrReviewApp adapter={adapter()} />)
    expect(html).toContain('กำลังเปิดเอกสารเพื่อตรวจสอบ')
    expect(html).toContain('aria-live="polite"')
  })

  it.each([
    ['expired', 'EXPIRED', 'ลิงก์ตรวจสอบหมดอายุแล้ว'],
    ['unauthorized', 'UNAUTHORIZED', 'ไม่มีสิทธิ์เปิดเอกสารนี้'],
    ['failed', 'default', 'เปิดเอกสารไม่สำเร็จ'],
  ])('defines Thai %s failure copy', (_state, code, copy) => {
    const source = readFileSync(new URL('../../src/apps/ocr-ledger/OcrReviewApp.tsx', import.meta.url), 'utf8')
    if (code !== 'default') expect(source).toContain(`code === '${code}'`)
    expect(source).toContain(copy)
  })

  it('renders all editable draft values, source preview, warnings, and line items after loading', async () => {
    const app = adapter()
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(<OcrReviewApp adapter={app} initialDraft={draft} initialImageUrl="blob:review-image" />)

    for (const copy of ['ใบเสร็จ', 'รายจ่าย', '2026-08-22', 'office', '107.00', 'ยอดรวมในภาพไม่ตรงกับรายการ', 'กระดาษ A4']) {
      expect(html).toContain(copy)
    }
    expect(html).toContain('src="blob:review-image"')
    expect(html).toContain('aria-label="เพิ่มรายการ"')
    expect(html).toContain('aria-label="ลบรายการ 1"')
  })

  it('keeps submit enabled when fields are invalid so native validation can focus the first invalid control', () => {
    const html = renderToStaticMarkup(<OcrReviewApp adapter={adapter()} initialDraft={{ ...draft, documentDate: null, grandTotal: null }} />)
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>บันทึกการแก้ไขเข้าคิว<\/button>/)
    expect(html).not.toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled)/)
    expect(html).toContain('required=""')
    expect(html).toContain('inputMode="decimal"')
  })

  it('keeps the LIFF entry point isolated from the main application shell', () => {
    const source = readFileSync(new URL('../../src/apps/ocr-ledger/main.tsx', import.meta.url), 'utf8')
    expect(source).toContain('OcrReviewApp')
    expect(source).not.toMatch(/HomeApp|PageAutomationApp|App\.tsx|Ads/)
  })

  it('uses the raw LIFF ID token for parallel draft/image reads and the queued edit', () => {
    const appSource = readFileSync(new URL('../../src/apps/ocr-ledger/OcrReviewApp.tsx', import.meta.url), 'utf8')
    const apiSource = readFileSync(new URL('../../src/apps/ocr-ledger/api.ts', import.meta.url), 'utf8')

    expect(appSource).toContain('Promise.all([adapter.loadDraft(rawIdToken), adapter.loadImage(rawIdToken)])')
    expect(appSource).toContain('adapter.submitEdit(rawIdToken, editablePatch(draft))')
    expect(apiSource).toContain('liff.getIDToken()')
    expect(apiSource).toContain("fetchPublicJson<{ liffId: string }>('/api/ocr-ledger/client-config')")
    expect(apiSource).toContain("headers.set('authorization', `Bearer ${rawIdToken}`)")
    expect(apiSource).toContain('URL.revokeObjectURL')
    expect(apiSource).not.toContain('getProfile')
    expect(apiSource).not.toContain('localStorage')
  })

  it('states that a successful edit is queued instead of confirmed', () => {
    const source = readFileSync(new URL('../../src/apps/ocr-ledger/OcrReviewApp.tsx', import.meta.url), 'utf8')
    expect(source).toContain('รับการแก้ไขเข้าคิวแล้ว')
    expect(source).toContain('ไม่ได้ยืนยันเอกสารทันที')
  })
})
