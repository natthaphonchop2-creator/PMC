// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpenseHistory } from '../../src/apps/pmc-mini-app/expense/ExpenseHistory'

afterEach(cleanup)

const bookHistoryPage = {
  expenses: [{
    expenseId: 'EXP-202608-BOOK-01', expenseDate: '2026-08-29', category: 'BOOK_CLINIC' as const,
    scope: 'CLINIC' as const, amountSatang: 120_000, description: 'สมุดรายวัน', recordState: 'COMMITTED' as const,
    revision: 2, submittedByName: 'มัส', submittedAt: '2026-08-29T02:00:00.000Z',
    committedAt: '2026-08-29T02:01:00.000Z', attachments: [],
  }], nextCursor: null,
}

describe('ExpenseHistory', () => {
  it('requires an explicit replace action and current expected revision', async () => {
    const user = userEvent.setup()
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={bookHistoryPage} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^แทนที่ยอดเดิม/ }))

    expect(adapter.replace).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }))
  })

  it('does not offer replacement for bills and renders supplied void rows safely', () => {
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={{
      expenses: [{
        ...bookHistoryPage.expenses[0], expenseId: 'EXP-202608-BILL-01', category: 'BILL_DOCUMENT', recordState: 'VOID',
        attachments: [{
          attachmentId: 'ATT-VOID', expenseId: 'EXP-202608-BILL-01', ordinal: 1,
          mediaType: 'image/jpeg', originalFileName: 'proof.jpg',
        }],
      }],
      nextCursor: null,
    }} adapter={adapter} />)

    expect(screen.getByText('ยกเลิกแล้ว')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^แทนที่ยอดเดิม/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^ดูหลักฐาน 1 รายการที่ 1 บิลเอกสาร วันที่ 2026-08-29 revision 2/ })).toBeVisible()
  })

  it('includes safe record context in repeated row action names', () => {
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={{
      expenses: [
        bookHistoryPage.expenses[0],
        {
          ...bookHistoryPage.expenses[0], expenseId: 'EXP-202608-BOOK-02',
          submittedAt: '2026-08-30T02:00:00.000Z', committedAt: '2026-08-30T02:01:00.000Z',
        },
      ],
      nextCursor: null,
    }} adapter={adapter} />)

    expect(screen.getByRole('button', { name: 'แทนที่ยอดเดิม รายการที่ 1 สมุดรายจ่ายภายในคลินิก วันที่ 2026-08-29 revision 2' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'แทนที่ยอดเดิม รายการที่ 2 สมุดรายจ่ายภายในคลินิก วันที่ 2026-08-29 revision 2' })).toBeVisible()
  })

  it('settles pagination when a manager starts a void while the next page is pending', async () => {
    const user = userEvent.setup()
    const more = deferred<typeof bookHistoryPage>()
    const voided = deferred<void>()
    const adapter = { replace: vi.fn(), loadMore: vi.fn(() => more.promise), void: vi.fn(() => voided.promise), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={{ ...bookHistoryPage, nextCursor: 'cursor-1' }} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: 'โหลดเพิ่ม' }))
    await user.click(screen.getByRole('button', { name: /^ยกเลิกรายการ/ }))
    await user.type(screen.getByLabelText('เหตุผลการยกเลิก'), 'ยอดรวมผิด')
    await user.click(screen.getByRole('button', { name: 'ยืนยันยกเลิก' }))
    await act(async () => { voided.resolve(); more.resolve({ expenses: [], nextCursor: null }) })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'โหลดเพิ่ม' })).toBeNull())
    expect(screen.getByText('ยกเลิกแล้ว')).toBeVisible()
  })

  it('settles void controls when pagination starts while a void is pending', async () => {
    const user = userEvent.setup()
    const more = deferred<typeof bookHistoryPage>()
    const voided = deferred<void>()
    const adapter = { replace: vi.fn(), loadMore: vi.fn(() => more.promise), void: vi.fn(() => voided.promise), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={{ ...bookHistoryPage, nextCursor: 'cursor-1' }} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^ยกเลิกรายการ/ }))
    await user.type(screen.getByLabelText('เหตุผลการยกเลิก'), 'ยอดรวมผิด')
    await user.click(screen.getByRole('button', { name: 'ยืนยันยกเลิก' }))
    await user.click(screen.getByRole('button', { name: 'โหลดเพิ่ม' }))
    await act(async () => { voided.resolve(); more.resolve({ expenses: [], nextCursor: null }) })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'ยืนยันยกเลิก' })).toBeNull())
    expect(screen.getByText('ยกเลิกแล้ว')).toBeVisible()
  })

  it('submits an explicit void with the selected row revision and reason', async () => {
    const user = userEvent.setup()
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={bookHistoryPage} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^ยกเลิกรายการ/ }))
    await user.type(screen.getByLabelText('เหตุผลการยกเลิก'), 'ยอดรวมผิด')
    await user.click(screen.getByRole('button', { name: 'ยืนยันยกเลิก' }))

    await waitFor(() => expect(adapter.void).toHaveBeenCalledWith(bookHistoryPage.expenses[0], expect.objectContaining({ expectedRevision: 2, reason: 'ยอดรวมผิด' })))
    expect(screen.getByText('ยกเลิกแล้ว')).toBeVisible()
  })

  it.each([
    [2, false],
    [3, true],
    [300, true],
    [301, false],
  ])('enforces VOID reason length %i at the 3..300 UI boundary', async (length, enabled) => {
    const user = userEvent.setup()
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={bookHistoryPage} adapter={adapter} />)
    await user.click(screen.getByRole('button', { name: /^ยกเลิกรายการ/ }))
    fireEvent.change(screen.getByLabelText('เหตุผลการยกเลิก'), { target: { value: 'ก'.repeat(length) } })

    const confirm = screen.getByRole('button', { name: 'ยืนยันยกเลิก' })
    if (enabled) expect(confirm).toBeEnabled()
    else {
      expect(confirm).toBeDisabled()
      expect(screen.getByText('เหตุผลต้องมี 3–300 ตัวอักษร')).toBeVisible()
    }
  })

  it('counts non-BMP VOID reason characters with the same UTF-16 boundary as the server', async () => {
    const user = userEvent.setup()
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={bookHistoryPage} adapter={adapter} />)
    await user.click(screen.getByRole('button', { name: /^ยกเลิกรายการ/ }))
    fireEvent.change(screen.getByLabelText('เหตุผลการยกเลิก'), { target: { value: '🙂'.repeat(151) } })

    expect(screen.getByRole('button', { name: 'ยืนยันยกเลิก' })).toBeDisabled()
    expect(screen.getByText('เหตุผลต้องมี 3–300 ตัวอักษร')).toBeVisible()
  })

  it('revokes loaded evidence URLs when evidence is replaced or the view unmounts', async () => {
    const user = userEvent.setup()
    const create = vi.fn(() => 'blob:evidence-1')
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const page = { expenses: [{ ...bookHistoryPage.expenses[0], attachments: [{
      attachmentId: 'ATT-1', expenseId: 'EXP-202608-BOOK-01', ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'proof.jpg',
    }] }], nextCursor: null }
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(async () => 'token.signature'), downloadEvidence: vi.fn(async () => new Blob(['image'], { type: 'image/jpeg' })) }
    const view = render(<ExpenseHistory key="before" monthKey="2026-08" canManageExpense page={page} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^ดูหลักฐาน 1/ }))
    await screen.findByRole('img', { name: 'หลักฐาน 1: proof.jpg' })
    view.rerender(<ExpenseHistory key="after" monthKey="2026-08" canManageExpense page={{ expenses: [], nextCursor: null }} adapter={adapter} />)
    expect(revoke).toHaveBeenCalledWith('blob:evidence-1')
    view.unmount()
  })

  it('does not create an object URL when an evidence response resolves after unmount', async () => {
    const user = userEvent.setup()
    const download = deferred<Blob>()
    const create = vi.fn(() => 'blob:late')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    const page = { expenses: [{ ...bookHistoryPage.expenses[0], attachments: [{
      attachmentId: 'ATT-1', expenseId: 'EXP-202608-BOOK-01', ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'proof.jpg',
    }] }], nextCursor: null }
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(async () => 'token.signature'), downloadEvidence: vi.fn(() => download.promise) }
    const view = render(<ExpenseHistory monthKey="2026-08" canManageExpense page={page} adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^ดูหลักฐาน 1/ }))
    await waitFor(() => expect(adapter.downloadEvidence).toHaveBeenCalledWith('token.signature'))
    view.unmount()
    await act(async () => { download.resolve(new Blob(['image'], { type: 'image/jpeg' })) })

    expect(create).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}
