// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StockHome } from '../../src/apps/pmc-mini-app/stock/StockHome'
import type { StockProductProjection } from '../../src/apps/pmc-mini-app/contracts'

afterEach(cleanup)

describe('PMC Stock home', () => {
  it('shows staff actions, quantities, low-stock text, search, and exactly four filters', async () => {
    const user = userEvent.setup()
    const onIssue = vi.fn()
    const onHistory = vi.fn()
    render(<StockHome
      products={products}
      canManageStock={false}
      onIssue={onIssue}
      onManagerAction={vi.fn()}
      onHistory={onHistory}
    />)

    expect(screen.getByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.getByText('4 กล่อง')).toBeVisible()
    expect(within(screen.getByText('ถุงมือ').closest('article')!).getByText('ใกล้หมด')).toBeVisible()
    expect(screen.getByRole('button', { name: 'เบิกสินค้า' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'ประวัติ' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'รับเข้า' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'จัดการสินค้า' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Sheet/i)).not.toBeInTheDocument()

    const filters = within(screen.getByRole('group', { name: 'กรองสินค้า' })).getAllByRole('button')
    expect(filters.map((button) => button.textContent)).toEqual(['ทั้งหมด', 'ของใช้คลินิก', 'สินค้าขาย', 'ใกล้หมด'])

    await user.type(screen.getByRole('searchbox', { name: 'ค้นหาสินค้า' }), 'ถุงมือ')
    expect(screen.getByText('ถุงมือ')).toBeVisible()
    expect(screen.queryByText('เซรั่ม')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'เบิกสินค้า' }))
    await user.click(screen.getByRole('button', { name: 'ประวัติ' }))
    expect(onIssue).toHaveBeenCalledOnce()
    expect(onHistory).toHaveBeenCalledOnce()
  })

  it('filters by category and low-stock state and exposes manager entry actions only to managers', async () => {
    const user = userEvent.setup()
    const onManagerAction = vi.fn()
    render(<StockHome
      products={products}
      canManageStock
      onIssue={vi.fn()}
      onManagerAction={onManagerAction}
      onHistory={vi.fn()}
    />)

    await user.click(screen.getByRole('button', { name: 'สินค้าขาย' }))
    expect(screen.getByText('เซรั่ม')).toBeVisible()
    expect(screen.queryByText('ถุงมือ')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ใกล้หมด' }))
    expect(screen.getByText('ถุงมือ')).toBeVisible()
    expect(screen.queryByText('เซรั่ม')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'รับเข้า' }))
    await user.click(screen.getByRole('button', { name: 'จัดการสินค้า' }))
    expect(onManagerAction).toHaveBeenNthCalledWith(1, 'RECEIVE')
    expect(onManagerAction).toHaveBeenNthCalledWith(2, 'MANAGE')
  })
})

const products: StockProductProjection[] = [
  {
    productId: 'STK-000001', name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
    minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
    hasLedgerActivity: true, version: 2,
  },
  {
    productId: 'STK-000002', name: 'เซรั่ม', category: 'RETAIL_PRODUCT', unit: 'ขวด',
    minimumQuantityMilli: 3_000, onHandMilli: 12_000, lowStock: false, active: true,
    hasLedgerActivity: true, version: 1,
  },
]
