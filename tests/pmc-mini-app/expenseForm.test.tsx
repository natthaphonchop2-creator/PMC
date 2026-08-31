// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExpenseCards } from '../../src/apps/pmc-mini-app/expense/ExpenseCards'
import { ExpenseForm, type ExpenseFormAdapter } from '../../src/apps/pmc-mini-app/expense/ExpenseForm'
import type { ExpenseReceipt } from '../../shared/pmcExpense'

const objectUrls = new Map<File, string>()

beforeEach(() => {
  objectUrls.clear()
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
    const value = `blob:${(file as File).name}`
    objectUrls.set(file as File, value)
    return value
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('root-request-stable')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('expense capture cards', () => {
  it('shows three active and three inert deferred expense cards only with submit permission', () => {
    const onSelect = vi.fn()
    const view = render(<ExpenseCards canSubmitExpense onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: 'บิลเอกสาร บันทึก' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายภายในคลินิก บันทึก' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายส่วนตัวหมอ บันทึก' })).toBeEnabled()
    expect(screen.getByText('เงินเดือนพนักงาน').closest('div')).toHaveTextContent('เตรียมระบบ')
    expect(screen.queryByRole('button', { name: 'เงินเดือนพนักงาน' })).not.toBeInTheDocument()

    view.rerender(<ExpenseCards canSubmitExpense={false} onSelect={onSelect} />)
    expect(screen.queryByRole('button', { name: 'บิลเอกสาร บันทึก' })).not.toBeInTheDocument()
  })
})

describe('expense form lifecycle', () => {
  it('shows exact bill fields and omits counterparty and payment fields from book capture', () => {
    const view = renderForm('BILL_DOCUMENT')
    expect(screen.getByLabelText('วันที่รายจ่าย')).toBeVisible()
    expect(screen.getByLabelText('จำนวนเงิน')).toBeVisible()
    expect(screen.getByLabelText('ชื่อร้านหรือผู้รับเงิน')).toBeVisible()
    expect(screen.getByLabelText('วิธีชำระ')).toBeVisible()
    expect(screen.getByLabelText('หมายเหตุ (ไม่บังคับ)')).toBeVisible()
    expect(screen.getByLabelText('รูปหลักฐาน')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.heic,.heif',
    )

    view.rerender(<ExpenseForm category="BOOK_CLINIC" adapter={adapter()} onCommitted={vi.fn()} onStopTrackingPrepared={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByLabelText('ยอดรวมรายวัน')).toBeVisible()
    expect(screen.queryByLabelText('ชื่อร้านหรือผู้รับเงิน')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('วิธีชำระ')).not.toBeInTheDocument()
  })

  it('keeps values and ordered files, then re-stages after authoritative safe-to-retry', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce('root-request-initial')
      .mockReturnValueOnce('root-request-retry')
    const app = adapter()
    vi.mocked(app.submit)
      .mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(receipt())
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg'), imageFile('b.jpg')])

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    expect(screen.getByRole('heading', { name: 'ตรวจสอบข้อมูล' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่พบรายการที่บันทึกค้างอยู่ กรุณาตรวจข้อมูลและยืนยันใหม่')
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
    expect(screen.getByText('เลือกแล้ว 2 รูป')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    await waitFor(() => expect(app.submit).toHaveBeenCalledTimes(2))
    expect(app.stage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(app.stage).mock.calls.map(([rootRequestId]) => rootRequestId))
      .toEqual(['root-request-initial', 'root-request-retry'])
    expect(app.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      rootRequestId: 'root-request-retry', amountSatang: 120_000,
      stagingTokens: [expenseToken('staged-1'), expenseToken('staged-2')],
    }))
  })

  it.each([
    ['expired or missing staging object', 'EXPENSE_INVALID_ATTACHMENTS'],
    ['invalid private attachment', 'EXPENSE_PRIVATE_FILE_INVALID'],
  ])('re-stages unchanged files after %s while preserving the form and rotating the terminal root', async (_label, code) => {
    const user = userEvent.setup()
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce('root-request-initial')
      .mockReturnValueOnce('root-request-retry')
    const app = adapter()
    vi.mocked(app.submit)
      .mockRejectedValueOnce(safeError(code, false))
      .mockResolvedValueOnce(receipt())
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
    expect(screen.getByText('เลือกแล้ว 1 รูป')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    await waitFor(() => expect(app.stage).toHaveBeenCalledTimes(2))
    expect(vi.mocked(app.stage).mock.calls.map(([rootRequestId]) => rootRequestId))
      .toEqual(['root-request-initial', 'root-request-retry'])
    expect(app.submit).toHaveBeenCalledTimes(2)
  })

  it('preserves selected files when staging fails and never persists form data in browser storage', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.stage).mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE'))
    const localSet = vi.spyOn(Storage.prototype, 'setItem')
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg'), imageFile('b.jpg')])

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
    expect(screen.getByText('เลือกแล้ว 2 รูป')).toBeVisible()
    expect(localSet).not.toHaveBeenCalled()
  })

  it('rejects a two-line note before review and makes zero staging calls', async () => {
    const user = userEvent.setup()
    const app = adapter()
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg')])
    const note = screen.getByLabelText('หมายเหตุ (ไม่บังคับ)')
    await user.type(note, 'บรรทัดหนึ่ง{enter}บรรทัดสอง')

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))

    expect(await screen.findByText('หมายเหตุต้องเป็นข้อความบรรทัดเดียวและไม่มีอักขระควบคุม')).toBeVisible()
    expect(note).toHaveValue('บรรทัดหนึ่ง\nบรรทัดสอง')
    expect(app.stage).not.toHaveBeenCalled()
    expect(app.submit).not.toHaveBeenCalled()
  })

  it('focuses the actual file input so its visible label can expose focus-within validation state', async () => {
    const user = userEvent.setup()
    renderForm('BILL_DOCUMENT')
    await user.clear(screen.getByLabelText('วันที่รายจ่าย'))
    await user.type(screen.getByLabelText('วันที่รายจ่าย'), '2026-08-30')
    await user.type(screen.getByLabelText('จำนวนเงิน'), '1200')
    await user.type(screen.getByLabelText('ชื่อร้านหรือผู้รับเงิน'), 'ร้านทดสอบ')
    await user.selectOptions(screen.getByLabelText('วิธีชำระ'), 'TRANSFER')

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))

    const input = screen.getByLabelText('รูปหลักฐาน')
    await waitFor(() => expect(input).toHaveFocus())
    expect(input.closest('label')).toHaveClass('pmc-expense-add-file')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('distinguishes duplicate filenames by image ordinal in every file action name', async () => {
    const user = userEvent.setup()
    renderForm('BILL_DOCUMENT')
    await user.upload(screen.getByLabelText('รูปหลักฐาน'), [
      imageFile('same.jpg'), imageFile('same.jpg'),
    ])

    expect(screen.getByRole('button', { name: 'ลบรูปที่ 1 same.jpg' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'ลบรูปที่ 2 same.jpg' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'เลื่อนรูปที่ 1 same.jpg ลง' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'เลื่อนรูปที่ 2 same.jpg ขึ้น' })).toBeVisible()
  })

  it('shows conversion progress and adds the normalized JPEG instead of the HEIC source', async () => {
    const user = userEvent.setup()
    const conversion = deferred<File[]>()
    const normalizeFiles = vi.fn(() => conversion.promise)
    render(<ExpenseForm
      category="BILL_DOCUMENT"
      adapter={adapter()}
      normalizeFiles={normalizeFiles}
      onCommitted={vi.fn()}
      onStopTrackingPrepared={vi.fn()}
      onBack={vi.fn()}
    />)
    const input = screen.getByLabelText('รูปหลักฐาน')

    await user.upload(input, imageFile('mobile.heic', 'image/heic'))

    expect(normalizeFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'mobile.heic', type: 'image/heic' })])
    expect(screen.getAllByText('กำลังแปลงรูป')).toHaveLength(2)
    expect(input).toBeDisabled()

    conversion.resolve([imageFile('mobile.jpg', 'image/jpeg')])
    expect(await screen.findByText('mobile.jpg')).toBeVisible()
    expect(screen.queryByText('mobile.heic')).not.toBeInTheDocument()
    expect(input).toBeEnabled()
  })

  it('rejects malformed staging tokens at the form boundary before submit', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.stage).mockResolvedValueOnce({ stagingTokens: ['payload bad-signature'] })
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(app.submit).not.toHaveBeenCalled()
  })

  it('invalidates staged tokens after a file change and re-stages the new ordered fingerprint', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.stage)
      .mockResolvedValueOnce({ stagingTokens: [expenseToken('old-token')] })
      .mockResolvedValueOnce({ stagingTokens: [expenseToken('new-a'), expenseToken('new-b')] })
    vi.mocked(app.submit)
      .mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(receipt())
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
    await screen.findByRole('alert')

    await user.upload(screen.getByLabelText('รูปหลักฐาน'), imageFile('b.jpg'))
    await user.click(screen.getByRole('button', { name: 'เลื่อนรูปที่ 1 a.jpg ลง' }))
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    await waitFor(() => expect(app.stage).toHaveBeenCalledTimes(2))
    expect(vi.mocked(app.stage).mock.calls[1]?.[1].map((file) => file.name)).toEqual(['b.jpg', 'a.jpg'])
    expect(app.submit).toHaveBeenLastCalledWith(expect.objectContaining({
      stagingTokens: [expenseToken('new-a'), expenseToken('new-b')],
    }))
  })

  it('revokes removed and remaining object URLs and blocks rapid duplicate confirmation', async () => {
    const user = userEvent.setup()
    const staged = deferred<{ stagingTokens: string[] }>()
    const app = adapter()
    vi.mocked(app.stage).mockReturnValue(staged.promise)
    const view = renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg'), imageFile('b.jpg')])
    await user.click(screen.getByRole('button', { name: 'ลบรูปที่ 1 a.jpg' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.jpg')
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))

    const confirm = screen.getByRole('button', { name: 'ยืนยันบันทึก' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(app.stage).toHaveBeenCalledOnce()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:b.jpg')
  })

  it('renders the submit-only revision conflict copy exactly and does not claim success', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_REVISION_CONFLICT', false))
    const onCommitted = vi.fn()
    render(<ExpenseForm category="BOOK_CLINIC" adapter={app} onCommitted={onCommitted} onStopTrackingPrepared={vi.fn()} onBack={vi.fn()} />)
    await user.clear(screen.getByLabelText('วันที่รายจ่าย'))
    await user.type(screen.getByLabelText('วันที่รายจ่าย'), '2026-08-30')
    await user.type(screen.getByLabelText('ยอดรวมรายวัน'), '1200')
    await user.upload(screen.getByLabelText('รูปหลักฐาน'), imageFile('book.png', 'image/png'))
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('มีรายการของวันนี้แล้ว กรุณาแจ้งผู้ดูแล')
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it.each(['PENDING'] as const)(
    'locks editing and new-root submission while an ambiguous result remains server-%s',
    async (resumeStatus) => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE', true))
    vi.mocked(app.resume)
      .mockResolvedValueOnce({ status: resumeStatus })
      .mockResolvedValueOnce({ status: 'COMMITTED', receipt: receipt() })
    const onCommitted = vi.fn()
    render(<ExpenseForm category="BILL_DOCUMENT" adapter={app} onCommitted={onCommitted} onStopTrackingPrepared={vi.fn()} onBack={vi.fn()} />)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByText('กำลังตรวจสอบสถานะรายการที่บันทึก')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'แก้ไขข้อมูล' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('จำนวนเงิน')).not.toBeInTheDocument()
    expect(app.submit).toHaveBeenCalledTimes(1)
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบสถานะอีกครั้ง' }))
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(receipt()))
    expect(app.submit).toHaveBeenCalledTimes(1)
    },
  )

  it('offers honest local stop-tracking directly for authoritative PREPARED', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE', true))
    vi.mocked(app.resume).mockResolvedValueOnce({ status: 'PREPARED' })
    const onCommitted = vi.fn()
    const onStopTrackingPrepared = vi.fn()
    render(<ExpenseForm
      category="BILL_DOCUMENT"
      adapter={app}
      onCommitted={onCommitted}
      onStopTrackingPrepared={onStopTrackingPrepared}
      onBack={vi.fn()}
    />)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'รายการเดิมยังคงอยู่ฝั่งระบบเพื่อการตรวจสอบ แต่สถานะ PREPARED ยังไม่ถูกนับเป็นรายจ่าย',
    )
    await user.click(screen.getByRole('button', { name: 'หยุดติดตามรายการเดิมและเริ่มใหม่' }))

    expect(onStopTrackingPrepared).toHaveBeenCalledOnce()
    expect(onCommitted).not.toHaveBeenCalled()
    expect(app.submit).toHaveBeenCalledOnce()
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1)
  })

  it('keeps the root protected for a storage-unavailable FAILED resume result', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE', true))
    vi.mocked(app.resume).mockResolvedValueOnce({
      status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    const onStopTrackingPrepared = vi.fn()
    render(<ExpenseForm
      category="BILL_DOCUMENT"
      adapter={app}
      onCommitted={vi.fn()}
      onStopTrackingPrepared={onStopTrackingPrepared}
      onBack={vi.fn()}
    />)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByText('กำลังตรวจสอบสถานะรายการที่บันทึก')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'หยุดติดตามรายการเดิมและเริ่มใหม่' })).not.toBeInTheDocument()
    expect(onStopTrackingPrepared).not.toHaveBeenCalled()
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1)
  })

  it('unlocks and rotates the root after a definite resume rejection', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce('root-request-initial')
      .mockReturnValueOnce('root-request-retry')
    const app = adapter()
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE', true))
    vi.mocked(app.resume).mockRejectedValueOnce(safeError('EXPENSE_RESUME_FORBIDDEN', false))
    const onCommitted = vi.fn()
    render(<ExpenseForm category="BILL_DOCUMENT" adapter={app} onCommitted={onCommitted} onStopTrackingPrepared={vi.fn()} onBack={vi.fn()} />)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
    expect(screen.queryByRole('button', { name: 'ตรวจสอบสถานะอีกครั้ง' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(receipt()))
    expect(vi.mocked(app.stage).mock.calls.map(([rootRequestId]) => rootRequestId))
      .toEqual(['root-request-initial', 'root-request-retry'])
  })
})

function renderForm(category: 'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL', app = adapter()) {
  return render(<ExpenseForm category={category} adapter={app} onCommitted={vi.fn()} onStopTrackingPrepared={vi.fn()} onBack={vi.fn()} />)
}

async function completeBill(user: ReturnType<typeof userEvent.setup>, files: File[]) {
  await user.clear(screen.getByLabelText('วันที่รายจ่าย'))
  await user.type(screen.getByLabelText('วันที่รายจ่าย'), '2026-08-30')
  await user.type(screen.getByLabelText('จำนวนเงิน'), '1200')
  await user.type(screen.getByLabelText('ชื่อร้านหรือผู้รับเงิน'), 'ร้านทดสอบ')
  await user.selectOptions(screen.getByLabelText('วิธีชำระ'), 'TRANSFER')
  await user.upload(screen.getByLabelText('รูปหลักฐาน'), files)
}

function adapter(): ExpenseFormAdapter {
  return {
    stage: vi.fn(async (_rootRequestId, files) => ({
      stagingTokens: files.map((_, index) => expenseToken(`staged-${index + 1}`)),
    })),
    submit: vi.fn(async () => receipt()),
    resume: vi.fn(async () => ({ status: 'SAFE_TO_RETRY' as const })),
  }
}

function receipt(): ExpenseReceipt {
  return {
    expenseId: 'EXP-202608-RESULT', receiptNumber: 'EXP-202608-RESULT', expenseDate: '2026-08-30', monthKey: '2026-08',
    category: 'BILL_DOCUMENT', scope: 'CLINIC', amountSatang: 120_000, recordState: 'COMMITTED', revision: 1,
    committedAt: '2026-08-30T04:00:00.000Z', unreviewed: true,
  }
}

function imageFile(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: 1 })
}

function safeError(code: string, retryable: boolean | null = null) {
  return Object.assign(new Error(code), { code, retryable })
}

function expenseToken(label: string): string {
  return `${label}.${'a'.repeat(43)}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}
