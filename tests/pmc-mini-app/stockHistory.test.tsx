// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StockDocumentSummary, StockHistoryPage } from '../../shared/pmcStock'
import { PmcMiniApp } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import { createPreviewMiniAppApi, PREVIEW_CONFIG, PREVIEW_SESSION } from '../../src/apps/pmc-mini-app/preview'
import { StockHistory } from '../../src/apps/pmc-mini-app/stock/StockHistory'

afterEach(cleanup)

describe('PMC Stock history', () => {
  it('renders newest documents first with Thai date-time and read-only expandable line details', async () => {
    const user = userEvent.setup()
    render(<StockHistory
      page={{ documents: [olderReceive, newerIssue], nextCursor: null }}
      canManageStock={false}
      onLoadMore={vi.fn()}
    />)

    const disclosureButtons = screen.getAllByRole('button', { name: /ดูรายละเอียด/ })
    expect(disclosureButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'ดูรายละเอียด ISS-202608-0002',
      'ดูรายละเอียด RCV-202608-0001',
    ])
    expect(disclosureButtons[0]).toHaveTextContent('28 ส.ค. 2569 10:00')
    expect(screen.queryByText('ถุงมือ')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'ดูรายละเอียด ISS-202608-0002' }))
    expect(screen.getByText('ถุงมือ')).toBeVisible()
    expect(screen.getByText('เข็ม')).toBeVisible()
    expect(screen.getByText('-2 กล่อง')).toBeVisible()
    expect(screen.queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sheet/i })).not.toBeInTheDocument()
  })

  it('shows adjustment reasons only to Stock managers', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<StockHistory
      page={{ documents: [adjustment], nextCursor: null }}
      canManageStock={false}
      onLoadMore={vi.fn()}
    />)
    await user.click(screen.getByRole('button', { name: 'ดูรายละเอียด ADJ-202608-0003' }))
    expect(screen.queryByText('เหตุผล: ตรวจนับสิ้นวัน')).not.toBeInTheDocument()

    rerender(<StockHistory
      page={{ documents: [adjustment], nextCursor: null }}
      canManageStock
      onLoadMore={vi.fn()}
    />)
    expect(screen.getByText('เหตุผล: ตรวจนับสิ้นวัน')).toBeVisible()
  })

  it('passes the opaque cursor to load more and hides the control on the final page', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    const firstPage: StockHistoryPage = { documents: [newerIssue], nextCursor: 'eyJ2ZXJzaW9uIjoxfQ' }
    const { rerender } = render(<StockHistory
      page={firstPage}
      canManageStock={false}
      onLoadMore={onLoadMore}
    />)

    await user.click(screen.getByRole('button', { name: 'โหลดเพิ่มเติม' }))
    expect(onLoadMore).toHaveBeenCalledWith('eyJ2ZXJzaW9uIjoxfQ')

    rerender(<StockHistory
      page={{ ...firstPage, nextCursor: null }}
      canManageStock={false}
      onLoadMore={onLoadMore}
    />)
    expect(screen.queryByRole('button', { name: 'โหลดเพิ่มเติม' })).not.toBeInTheDocument()
  })

  it('loads history through the real client adapter and appends the next cursor page', async () => {
    const user = userEvent.setup()
    const loadStockHistory = vi.fn()
      .mockResolvedValueOnce({ documents: [newerIssue], nextCursor: 'opaque-next-page' })
      .mockResolvedValueOnce({ documents: [olderReceive], nextCursor: null })
    const api = {
      ...createPreviewMiniAppApi(),
      loadStockProducts: vi.fn(async () => ({ products: [] })),
      loadStockHistory,
    }
    render(<PmcMiniApp
      initialSession={PREVIEW_SESSION}
      initialConfig={{ ...PREVIEW_CONFIG, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(await screen.findByRole('button', { name: 'ประวัติ' }))
    expect(await screen.findByRole('heading', { name: 'ประวัติ Stock' })).toBeVisible()
    expect(screen.getByText('ISS-202608-0002')).toBeVisible()
    expect(loadStockHistory).toHaveBeenNthCalledWith(1, 'preview-token')

    await user.click(screen.getByRole('button', { name: 'โหลดเพิ่มเติม' }))
    expect(await screen.findByText('RCV-202608-0001')).toBeVisible()
    expect(loadStockHistory).toHaveBeenNthCalledWith(2, 'preview-token', 'opaque-next-page')
  })
})

function documentFixture(patch: Partial<StockDocumentSummary> = {}): StockDocumentSummary {
  return {
    documentId: 'RCV-202608-0001',
    requestId: 'receive-1',
    transactionType: 'RECEIVE',
    actorStaffId: 'ADMIN_07',
    actorDisplayName: 'อาย',
    createdAt: '2026-08-28T09:00:00+07:00',
    reason: '',
    lineCount: 1,
    lines: [{
      productId: 'STK-000001',
      productName: 'สำลี',
      unit: 'ถุง',
      quantityDeltaMilli: 1_000,
      balanceBeforeMilli: 2_000,
      balanceAfterMilli: 3_000,
    }],
    ...patch,
  }
}

const olderReceive = documentFixture()

const newerIssue = documentFixture({
  documentId: 'ISS-202608-0002',
  requestId: 'issue-2',
  transactionType: 'ISSUE',
  actorStaffId: 'ADMIN_01',
  actorDisplayName: 'มัส',
  createdAt: '2026-08-28T10:00:00+07:00',
  lineCount: 2,
  lines: [
    {
      productId: 'STK-000001', productName: 'ถุงมือ', unit: 'กล่อง',
      quantityDeltaMilli: -2_000, balanceBeforeMilli: 5_000, balanceAfterMilli: 3_000,
    },
    {
      productId: 'STK-000002', productName: 'เข็ม', unit: 'กล่อง',
      quantityDeltaMilli: -1_000, balanceBeforeMilli: 4_000, balanceAfterMilli: 3_000,
    },
  ],
})

const adjustment = documentFixture({
  documentId: 'ADJ-202608-0003',
  requestId: 'adjust-3',
  transactionType: 'ADJUST',
  reason: 'ตรวจนับสิ้นวัน',
  createdAt: '2026-08-28T11:00:00+07:00',
})
