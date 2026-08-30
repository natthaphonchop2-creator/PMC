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

    expect(screen.getByRole('button', { name: 'บิลเอกสาร' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายภายในคลินิก' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายส่วนตัวหมอ' })).toBeEnabled()
    expect(screen.getByText('เงินเดือนพนักงาน').closest('div')).toHaveTextContent('เตรียมระบบ')
    expect(screen.queryByRole('button', { name: 'เงินเดือนพนักงาน' })).not.toBeInTheDocument()

    view.rerender(<ExpenseCards canSubmitExpense={false} onSelect={onSelect} />)
    expect(screen.queryByRole('button', { name: 'บิลเอกสาร' })).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('รูปหลักฐาน')).toHaveAttribute('accept', 'image/jpeg,image/png,.jpg,.jpeg,.png')

    view.rerender(<ExpenseForm category="BOOK_CLINIC" adapter={adapter()} onCommitted={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByLabelText('ยอดรวมรายวัน')).toBeVisible()
    expect(screen.queryByLabelText('ชื่อร้านหรือผู้รับเงิน')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('วิธีชำระ')).not.toBeInTheDocument()
  })

  it('keeps values, ordered files, and staged tokens through retryable failures', async () => {
    const user = userEvent.setup()
    const app = adapter()
    vi.mocked(app.submit)
      .mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(receipt())
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg'), imageFile('b.jpg')])

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    expect(screen.getByRole('heading', { name: 'ตรวจสอบข้อมูล' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกรายจ่ายไม่สำเร็จ กรุณาลองอีกครั้ง')
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
    expect(screen.getByText('เลือกแล้ว 2 รูป')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    await waitFor(() => expect(app.submit).toHaveBeenCalledTimes(2))
    expect(app.stage).toHaveBeenCalledOnce()
    expect(app.stage).toHaveBeenCalledWith('root-request-stable', [expect.objectContaining({ name: 'a.jpg' }), expect.objectContaining({ name: 'b.jpg' })])
    expect(app.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      rootRequestId: 'root-request-stable', amountSatang: 120_000,
      stagingTokens: ['staged-a.signature-a', 'staged-b.signature-b'],
    }))
  })

  it.each([
    ['expired or missing staging object', 'EXPENSE_INVALID_ATTACHMENTS'],
    ['invalid private attachment', 'EXPENSE_PRIVATE_FILE_INVALID'],
  ])('re-stages unchanged files after %s while preserving the form and root request', async (_label, code) => {
    const user = userEvent.setup()
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
      .toEqual(['root-request-stable', 'root-request-stable'])
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
      .mockResolvedValueOnce({ stagingTokens: ['old-token.old-signature'] })
      .mockResolvedValueOnce({ stagingTokens: ['new-a.new-signature-a', 'new-b.new-signature-b'] })
    vi.mocked(app.submit)
      .mockRejectedValueOnce(safeError('EXPENSE_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(receipt())
    renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg')])
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
    await screen.findByRole('alert')

    await user.upload(screen.getByLabelText('รูปหลักฐาน'), imageFile('b.jpg'))
    await user.click(screen.getByRole('button', { name: 'เลื่อน a.jpg ลง' }))
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    await waitFor(() => expect(app.stage).toHaveBeenCalledTimes(2))
    expect(vi.mocked(app.stage).mock.calls[1]?.[1].map((file) => file.name)).toEqual(['b.jpg', 'a.jpg'])
    expect(app.submit).toHaveBeenLastCalledWith(expect.objectContaining({
      stagingTokens: ['new-a.new-signature-a', 'new-b.new-signature-b'],
    }))
  })

  it('revokes removed and remaining object URLs and blocks rapid duplicate confirmation', async () => {
    const user = userEvent.setup()
    const staged = deferred<{ stagingTokens: string[] }>()
    const app = adapter()
    vi.mocked(app.stage).mockReturnValue(staged.promise)
    const view = renderForm('BILL_DOCUMENT', app)
    await completeBill(user, [imageFile('a.jpg'), imageFile('b.jpg')])
    await user.click(screen.getByRole('button', { name: 'ลบ a.jpg' }))
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
    vi.mocked(app.submit).mockRejectedValueOnce(safeError('EXPENSE_REVISION_CONFLICT'))
    const onCommitted = vi.fn()
    render(<ExpenseForm category="BOOK_CLINIC" adapter={app} onCommitted={onCommitted} onBack={vi.fn()} />)
    await user.clear(screen.getByLabelText('วันที่รายจ่าย'))
    await user.type(screen.getByLabelText('วันที่รายจ่าย'), '2026-08-30')
    await user.type(screen.getByLabelText('ยอดรวมรายวัน'), '1200')
    await user.upload(screen.getByLabelText('รูปหลักฐาน'), imageFile('book.png', 'image/png'))
    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('มีรายการของวันนี้แล้ว กรุณาแจ้งผู้ดูแล')
    expect(onCommitted).not.toHaveBeenCalled()
  })
})

function renderForm(category: 'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL', app = adapter()) {
  return render(<ExpenseForm category={category} adapter={app} onCommitted={vi.fn()} onBack={vi.fn()} />)
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
      stagingTokens: files.map((_, index) => index === 0
        ? 'staged-a.signature-a'
        : index === 1 ? 'staged-b.signature-b' : `staged-${index + 1}.signature-${index + 1}`),
    })),
    submit: vi.fn(async () => receipt()),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}
