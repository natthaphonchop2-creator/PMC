// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthlyFinancePage, type MonthlyIncomePageAdapter } from '../../src/apps/pmc-mini-app/MonthlyFinancePage'
import type { MonthlyIncomeProjection } from '../../shared/pmcFinance'

afterEach(cleanup)

describe('monthly finance report', () => {
  it('renders finance-only month selection, authoritative income, trend, channels, and category money', async () => {
    const adapter = monthlyAdapter()
    render(<MonthlyFinancePage
      canViewFinance bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} onDrillDown={vi.fn()}
    />)

    expect(await screen.findByRole('heading', { name: 'รายงานรายเดือน' })).toBeVisible()
    expect(screen.getByLabelText('เดือนรายงาน')).toHaveValue('2026-08')
    expect(adapter.load).toHaveBeenCalledWith({ year: 2026, month: 8 })

    const authority = screen.getByRole('region', { name: 'ยอดรายรับหลักประจำเดือน' })
    expect(within(authority).getByText('ยอดรับชำระ')).toBeVisible()
    expect(within(authority).getByText('3,000 บาท')).toBeVisible()
    expect(within(authority).getByText('คืนเงิน')).toBeVisible()
    expect(within(authority).getByText('200 บาท')).toBeVisible()
    expect(within(authority).getByText('รับสุทธิ')).toBeVisible()
    expect(within(authority).getByText('2,800 บาท')).toBeVisible()

    const trend = screen.getByRole('table', { name: 'รายรับรายวันในเดือน' })
    expect(within(trend).getByRole('columnheader', { name: 'วันที่' })).toBeVisible()
    expect(within(trend).getByRole('button', { name: 'ดูรายรับวันที่ 2026-08-29' })).toBeVisible()
    for (const label of ['โอน', 'สด', 'Credit', 'อื่น ๆ']) expect(screen.getByText(label)).toBeVisible()
    for (const label of ['บริการและคอร์ส', 'Product', 'ยังไม่จัดหมวด']) expect(screen.getByText(label)).toBeVisible()
  })

  it('shows category checking state and keeps expense and balance explicitly deferred, never zero', async () => {
    const report = monthlyProjection({
      categories: {
        state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null,
        incompleteDates: ['2026-08-28'],
      },
    })
    const view = render(<MonthlyFinancePage
      canViewFinance bangkokDate="2026-08-29" adapter={monthlyAdapter(report)} onBack={vi.fn()} onDrillDown={vi.fn()}
    />)

    expect(await screen.findByText('กำลังตรวจสอบหมวด')).toBeVisible()
    expect(screen.getByText('วันที่ยังไม่ครบ: 2026-08-28')).toBeVisible()
    expect(screen.getByText('รายจ่ายที่บันทึก — เตรียมระบบ')).toBeVisible()
    expect(screen.getByText('คงเหลือโดยประมาณ — เตรียมระบบ')).toBeVisible()
    expect(view.container.querySelector('.pmc-monthly-deferred')).not.toHaveTextContent('0 บาท')
    expect(screen.queryByRole('button', { name: /อัปเดตทั้งหมด|refresh all/i })).not.toBeInTheDocument()
  })

  it('changes month selection and drills into one daily range without another monthly provider call', async () => {
    const user = userEvent.setup()
    const adapter = monthlyAdapter()
    const onDrillDown = vi.fn()
    render(<MonthlyFinancePage
      canViewFinance bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} onDrillDown={onDrillDown}
    />)
    await waitFor(() => expect(adapter.load).toHaveBeenCalledOnce())

    fireEvent.change(screen.getByLabelText('เดือนรายงาน'), { target: { value: '2026-07' } })
    await waitFor(() => expect(adapter.load).toHaveBeenLastCalledWith({ year: 2026, month: 7 }))
    adapter.load.mockClear()
    await user.click(screen.getByRole('button', { name: 'ดูรายรับวันที่ 2026-08-29' }))

    expect(onDrillDown).toHaveBeenCalledWith({ preset: 'CUSTOM', startDate: '2026-08-29', endDate: '2026-08-29' })
    expect(adapter.load).not.toHaveBeenCalled()
  })

  it('fails closed for ordinary staff without rendering financial values or calling the adapter', () => {
    const adapter = monthlyAdapter()
    const view = render(<MonthlyFinancePage
      canViewFinance={false} bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} onDrillDown={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: 'รายงานนี้สำหรับฝ่ายการเงิน' })).toBeVisible()
    expect(adapter.load).not.toHaveBeenCalled()
    expect(view.container).not.toHaveTextContent(/(?:\d[\d,]*\s*บาท|฿)/)
  })
})

function monthlyAdapter(report = monthlyProjection()) {
  return {
    load: vi.fn(async () => structuredClone(report)),
  } satisfies MonthlyIncomePageAdapter as MonthlyIncomePageAdapter & { load: ReturnType<typeof vi.fn> }
}

function monthlyProjection(patch: Partial<MonthlyIncomeProjection> = {}): MonthlyIncomeProjection {
  return {
    monthKey: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31',
    receivedSatang: 300_000, refundSatang: 20_000, netReceivedSatang: 280_000,
    channels: { transferSatang: 180_000, cashSatang: 60_000, creditSatang: 30_000, otherSatang: 30_000, differenceSatang: 0 },
    categories: { state: 'READY', serviceSatang: 180_000, productSatang: 90_000, unclassifiedSatang: 30_000, incompleteDates: [] },
    dailyTrend: [
      { date: '2026-08-28', receivedSatang: 100_000, refundSatang: 0, netReceivedSatang: 100_000 },
      { date: '2026-08-29', receivedSatang: 200_000, refundSatang: 20_000, netReceivedSatang: 180_000 },
    ],
    expense: { state: 'NOT_IMPLEMENTED', clinicExpenseSatang: null, estimatedBalanceSatang: null },
    freshness: {
      payment: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      refund: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      allocation: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
    },
    warnings: [],
    ...patch,
  }
}
