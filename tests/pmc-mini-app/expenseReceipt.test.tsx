// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpenseReceiptView } from '../../src/apps/pmc-mini-app/expense/ExpenseReceipt'

afterEach(cleanup)

describe('durable expense receipt', () => {
  it('renders committed as recorded but explicitly unreviewed with the durable receipt number', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<ExpenseReceiptView receipt={{
      expenseId: 'EXP-202608-RESULT', receiptNumber: 'EXP-202608-RESULT', expenseDate: '2026-08-30', monthKey: '2026-08',
      category: 'BOOK_DOCTOR_PERSONAL', scope: 'DOCTOR_PERSONAL', amountSatang: 120_005,
      recordState: 'COMMITTED', revision: 1, committedAt: '2026-08-30T04:00:00.000Z', unreviewed: true,
    }} onDone={onDone} />)

    expect(screen.getByRole('heading', { name: 'บันทึกแล้ว — ยังไม่ผ่านการตรวจสอบ' })).toBeVisible()
    expect(screen.getByText('EXP-202608-RESULT')).toBeVisible()
    expect(screen.getByText('1,200.05 บาท')).toBeVisible()
    expect(screen.queryByText(/อนุมัติ|ตรวจสอบแล้ว|ชำระแล้ว/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'กลับหน้ารายงาน' }))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
