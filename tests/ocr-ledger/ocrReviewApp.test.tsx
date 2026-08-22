// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OcrReviewApp, type OcrReviewAdapter, type OcrReviewDraft } from '../../src/apps/ocr-ledger/OcrReviewApp'
import { submitOcrEdit } from '../../src/apps/ocr-ledger/api'

const draft: OcrReviewDraft = {
  documentId: 'OCR-20260822-abc123', state: 'PENDING_REVIEW', draftVersion: 2,
  imageUrl: '/api/ocr-ledger/image?t=signed-review-token', documentType: 'RECEIPT', direction: 'EXPENSE',
  documentDate: '2026-08-22', documentTime: '10:15', counterpartyName: 'ร้านทดสอบ', currency: 'THB',
  subtotal: 100, discountAmount: 0, taxAmount: 7, serviceCharge: 3, grandTotal: 110,
  referenceNumber: 'REF-001', categoryId: 'office', note: 'เอกสารทดสอบ',
  senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
  receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
  merchantName: 'ร้านทดสอบ', merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่', receiptNumber: 'RCPT-001',
  receiptDate: '2026-08-22', paymentMethod: 'เงินสด',
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OCR LIFF review page', () => {
  it('renders every review API header and line field with values editable', async () => {
    render(<OcrReviewApp adapter={adapter()} />)
    await screen.findByRole('heading', { name: /ใบเสร็จ/ })

    for (const label of ['เวลาเอกสาร', 'สกุลเงิน', 'ยอดก่อนลด', 'ส่วนลด', 'ภาษี', 'ค่าบริการ', 'ชื่อร้านค้า', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'เลขที่ใบเสร็จ', 'วันที่ใบเสร็จ', 'วิธีชำระเงิน', 'หน่วย', 'ราคาต่อหน่วย', 'หมวดหมู่รายการ']) {
      expect(screen.getByLabelText(label)).toBeVisible()
    }
    expect(screen.getByLabelText('เวลาเอกสาร')).toHaveValue('10:15')
    expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('THB')
    expect(screen.getByLabelText('ราคาต่อหน่วย')).toHaveAttribute('inputmode', 'decimal')
  })

  it('renders and submits every transfer-slip field through the same authenticated editor', async () => {
    const user = userEvent.setup()
    const transferDraft: OcrReviewDraft = {
      ...draft, documentType: 'TRANSFER_SLIP', lineItems: [], merchantName: null, merchantTaxId: null, branch: null,
      receiptNumber: null, receiptDate: null, paymentMethod: null,
      senderName: 'ผู้โอน', senderBank: 'BANK A', senderAccountMasked: '123-****-**0',
      receiverName: 'ผู้รับ', receiverBank: 'BANK B', receiverAccountMasked: '987-****-**0',
      transferDate: '2026-08-22', transferTime: '10:15', amount: 110,
    }
    const app = adapter({ loadDraft: vi.fn().mockResolvedValue(transferDraft) })
    render(<OcrReviewApp adapter={app} />)

    for (const label of ['ชื่อผู้โอน', 'ธนาคารผู้โอน', 'บัญชีผู้โอน', 'ชื่อผู้รับ', 'ธนาคารผู้รับ', 'บัญชีผู้รับ', 'วันที่โอน', 'เวลาโอน', 'ยอดโอน']) {
      expect(await screen.findByLabelText(label)).toBeVisible()
    }
    await user.clear(screen.getByLabelText('ธนาคารผู้รับ'))
    await user.type(screen.getByLabelText('ธนาคารผู้รับ'), 'BANK C')
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))

    await waitFor(() => expect(app.submitEdit).toHaveBeenCalledOnce())
    expect(app.submitEdit).toHaveBeenCalledWith('raw-line-id-token', expect.objectContaining({
      senderName: 'ผู้โอน', receiverBank: 'BANK C', transferDate: '2026-08-22', transferTime: '10:15', amount: 110,
    }))
  })

  it('starts draft and image reads in parallel with the raw LINE ID token', async () => {
    const nextDraft = deferred<OcrReviewDraft>()
    const nextImage = deferred<string>()
    const app = adapter({ loadDraft: vi.fn(() => nextDraft.promise), loadImage: vi.fn(() => nextImage.promise) })
    render(<OcrReviewApp adapter={app} />)

    await waitFor(() => expect(app.loadDraft).toHaveBeenCalledWith('raw-line-id-token'))
    expect(app.loadImage).toHaveBeenCalledWith('raw-line-id-token')
    nextDraft.resolve(draft)
    nextImage.resolve('blob:review-image')
    await screen.findByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' })
  })

  it('revokes an image URL when draft loading fails after image success', async () => {
    const nextDraft = deferred<OcrReviewDraft>()
    const nextImage = deferred<string>()
    const app = adapter({ loadDraft: vi.fn(() => nextDraft.promise), loadImage: vi.fn(() => nextImage.promise) })
    render(<OcrReviewApp adapter={app} />)

    nextImage.resolve('blob:orphaned')
    nextDraft.reject(new Error('draft unavailable'))
    await screen.findByText('เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    expect(app.revokeImage).toHaveBeenCalledWith('blob:orphaned')
  })

  it('revokes an image URL that resolves after unmount', async () => {
    const nextDraft = deferred<OcrReviewDraft>()
    const nextImage = deferred<string>()
    const app = adapter({ loadDraft: vi.fn(() => nextDraft.promise), loadImage: vi.fn(() => nextImage.promise) })
    const view = render(<OcrReviewApp adapter={app} />)
    await waitFor(() => expect(app.loadImage).toHaveBeenCalledOnce())
    view.unmount()
    nextImage.resolve('blob:late')
    nextDraft.resolve(draft)
    await waitFor(() => expect(app.revokeImage).toHaveBeenCalledWith('blob:late'))
  })

  it('keeps invalid submit enabled, surfaces native validation, and preserves a partial decimal while editing', async () => {
    const user = userEvent.setup()
    render(<OcrReviewApp adapter={adapter()} />)
    const total = await screen.findByLabelText(/^ยอดรวม/)
    await user.clear(total)
    await user.type(total, '10.')
    expect(total).toHaveValue('10.')
    expect(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' })).toBeEnabled()
    await user.clear(screen.getByLabelText(/^วันที่เอกสาร/))
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))
    expect(screen.getByLabelText(/^วันที่เอกสาร/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('submits edited headers and full line items through the mounted form using the raw token', async () => {
    const user = userEvent.setup()
    const app = adapter()
    render(<OcrReviewApp adapter={app} />)
    await screen.findByLabelText(/^ยอดรวม/)
    await user.clear(screen.getByLabelText('สกุลเงิน'))
    await user.type(screen.getByLabelText('สกุลเงิน'), 'USD')
    await user.clear(screen.getByLabelText('หน่วย'))
    await user.type(screen.getByLabelText('หน่วย'), 'box')
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))

    await waitFor(() => expect(app.submitEdit).toHaveBeenCalledOnce())
    expect(app.submitEdit).toHaveBeenCalledWith('raw-line-id-token', expect.objectContaining({ currency: 'USD', lineItems: [expect.objectContaining({ unit: 'box' })] }))
    expect(await screen.findByText('รับการแก้ไขเข้าคิวแล้ว ระบบจะตรวจเอกสารต่อ ไม่ได้ยืนยันเอกสารทันที')).toBeVisible()
  })

  it('preserves add/remove controls and sends sequential line numbers', async () => {
    const user = userEvent.setup()
    const app = adapter({ loadDraft: vi.fn().mockResolvedValue({ ...draft, lineItems: [...draft.lineItems, { ...draft.lineItems[0], lineNumber: 2, description: 'ปากกา' }] }) })
    render(<OcrReviewApp adapter={app} />)
    await screen.findByRole('button', { name: 'ลบรายการ 1' })
    await user.click(screen.getByRole('button', { name: 'ลบรายการ 1' }))
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }))
    expect(screen.getByRole('button', { name: 'ลบรายการ 2' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))

    await waitFor(() => expect(app.submitEdit).toHaveBeenCalledOnce())
    const patch = (app.submitEdit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(patch.lineItems.map((line: { lineNumber: number }) => line.lineNumber)).toEqual([1, 2])
  })

  it('keeps numeric edits with their row while pruning removed-row state before adding a new row', async () => {
    const user = userEvent.setup()
    const app = adapter({ loadDraft: vi.fn().mockResolvedValue({ ...draft, lineItems: [
      { ...draft.lineItems[0], lineNumber: 1, description: 'รายการที่ลบ', unitPrice: 100 },
      { ...draft.lineItems[0], lineNumber: 2, description: 'รายการที่เก็บ', unitPrice: 200 },
    ] }) })
    render(<OcrReviewApp adapter={app} />)
    await screen.findByRole('button', { name: 'ลบรายการ 1' })
    const unitPrices = screen.getAllByLabelText('ราคาต่อหน่วย')
    await user.clear(unitPrices[0]!)
    await user.type(unitPrices[0]!, '999')
    await user.clear(unitPrices[1]!)
    await user.type(unitPrices[1]!, '222')
    await user.click(screen.getByRole('button', { name: 'ลบรายการ 1' }))
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }))
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))

    await waitFor(() => expect(app.submitEdit).toHaveBeenCalledOnce())
    const patch = (app.submitEdit as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(patch.lineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'รายการที่เก็บ', lineNumber: 1, unitPrice: 222 }),
      expect.objectContaining({ lineNumber: 2, unitPrice: null }),
    ]))
  })

  it('keeps the editor visible and offers an in-place retry after a queued-edit failure', async () => {
    const user = userEvent.setup()
    const app = adapter({ submitEdit: vi.fn().mockRejectedValue(new Error('offline')) })
    render(<OcrReviewApp adapter={app} />)
    const currency = await screen.findByLabelText('สกุลเงิน')
    await user.clear(currency)
    await user.type(currency, 'USD')
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' }))

    expect(await screen.findByText('บันทึกการแก้ไขไม่สำเร็จ กรุณาลองส่งอีกครั้ง')).toBeVisible()
    expect(screen.getByLabelText('สกุลเงิน')).toHaveValue('USD')
    expect(screen.getByRole('button', { name: 'บันทึกการแก้ไขเข้าคิว' })).toBeEnabled()
  })

  it('sends an actual POST edit request with the raw ID token', async () => {
    window.history.replaceState({}, '', '/ocr-review/?t=signed-review-token')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true, jobId: 'job-1' }), { status: 202 }))
    vi.stubGlobal('fetch', fetch)

    await submitOcrEdit('raw-line-id-token', { ...draft, lineItems: draft.lineItems } as OcrReviewDraft)

    expect(fetch).toHaveBeenCalledWith('/api/ocr-ledger/review?t=signed-review-token', expect.objectContaining({ method: 'POST' }))
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer raw-line-id-token')
  })

  it('keeps the LIFF entry point isolated from the main application shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/apps/ocr-ledger/main.tsx'), 'utf8')
    expect(source).toContain('OcrReviewApp')
    expect(source).not.toMatch(/HomeApp|PageAutomationApp|App\.tsx|Ads/)
  })
})
