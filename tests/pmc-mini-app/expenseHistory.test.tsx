// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

    await user.click(screen.getByRole('button', { name: 'แทนที่ยอดเดิม' }))

    expect(adapter.replace).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }))
  })

  it('does not offer replacement for bills and renders supplied void rows safely', () => {
    const adapter = { replace: vi.fn(), void: vi.fn(async () => undefined), issueEvidenceToken: vi.fn(), downloadEvidence: vi.fn() }
    render(<ExpenseHistory monthKey="2026-08" canManageExpense page={{
      expenses: [{ ...bookHistoryPage.expenses[0], expenseId: 'EXP-202608-BILL-01', category: 'BILL_DOCUMENT', recordState: 'VOID' }],
      nextCursor: null,
    }} adapter={adapter} />)

    expect(screen.getByText('ยกเลิกแล้ว')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'แทนที่ยอดเดิม' })).toBeNull()
  })
})
