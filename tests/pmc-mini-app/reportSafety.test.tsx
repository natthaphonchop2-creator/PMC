// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RefundRows, ReportRows } from '../../src/apps/pmc-mini-app/reportViews'
import { formatBaht } from '../../src/apps/pmc-mini-app/reportFormatting'
import { MonthlyFinancePage } from '../../src/apps/pmc-mini-app/MonthlyFinancePage'

afterEach(cleanup)

describe('safe JERA report rendering', () => {
  it('renders provider HTML as inert text', () => {
    render(<RefundRows rows={[{
      sourceUuid: 'refund-1', eventDate: '2026-08-27', patientName: '<img src=x onerror=alert(1)>',
      paymentCode: 'PAY-1', status: 'REFUNDED', refundAmountSatang: 10_000, paidAmountSatang: null,
    }]} />)

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('distinguishes zero, missing, and explicit negative satang', () => {
    expect(formatBaht(0)).toBe('0 บาท')
    expect(formatBaht(null)).toBe('—')
    expect(formatBaht(-100)).toBe('-1 บาท')
    expect(formatBaht(1_000_000)).toBe('10,000 บาท')
    expect(formatBaht(Number.MAX_SAFE_INTEGER)).toBe('90,071,992,547,409.91 บาท')
  })

  it('contains wide patient rows in an explicitly scrollable table region', () => {
    const view = render(<ReportRows rows={[{
      sourceUuid: 'row-1', eventDate: '2026-08-27', patientName: 'Synthetic Patient',
      paymentCode: 'PAY-LONG-CODE', status: 'PAID', paidAmountSatang: 10_000, refundAmountSatang: null,
    }]} />)

    expect(view.container.querySelector('.pmc-report-table-scroll')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table')).toBeVisible()
  })

  it('subtracts clinic expense but never doctor-personal expense from the estimated balance', async () => {
    render(<MonthlyFinancePage
      canViewFinance
      bangkokDate="2026-08-30"
      adapter={{ load: async () => monthlyIncomeProjection() }}
      expenseAdapter={{ load: async () => ({
        monthKey: '2026-08', clinicCommittedSatang: 120_000, doctorPersonalCommittedSatang: 50_000,
        clinicByCategorySatang: { BILL_DOCUMENT: 100_000, BOOK_CLINIC: 20_000 }, effectiveExpenseCount: 2, unreviewed: true,
      }) }}
      onBack={() => undefined}
      onDrillDown={() => undefined}
    />)

    expect(await screen.findByText('ยอดคงเหลือโดยประมาณ')).toHaveTextContent('8,800.00')
    expect(screen.getByText('รายจ่ายส่วนตัวหมอ').closest('div')).toHaveTextContent('500.00')
  })
})

function monthlyIncomeProjection() {
  return {
    monthKey: '2026-08', receivedSatang: 1_000_000, refundSatang: 0, netReceivedSatang: 1_000_000,
    dailyTrend: [], channels: { transferSatang: 0, cashSatang: 0, creditSatang: 0, otherSatang: 0, differenceSatang: 0 },
    categories: { state: 'READY' as const, serviceSatang: 0, productSatang: 0, unclassifiedSatang: 0, incompleteDates: [] },
    warnings: [], freshness: {
      payment: { stale: false, lastSuccessAt: null }, refund: { stale: false, lastSuccessAt: null }, allocation: { stale: false, lastSuccessAt: null },
    },
  }
}
