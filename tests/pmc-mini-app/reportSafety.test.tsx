// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RefundRows, ReportRows } from '../../src/apps/pmc-mini-app/reportViews'
import { formatBaht } from '../../src/apps/pmc-mini-app/reportFormatting'

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
  })

  it('contains wide patient rows in an explicitly scrollable table region', () => {
    const view = render(<ReportRows rows={[{
      sourceUuid: 'row-1', eventDate: '2026-08-27', patientName: 'Synthetic Patient',
      paymentCode: 'PAY-LONG-CODE', status: 'PAID', paidAmountSatang: 10_000, refundAmountSatang: null,
    }]} />)

    expect(view.container.querySelector('.pmc-report-table-scroll')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table')).toBeVisible()
  })
})
