// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportPage, type ReportPageAdapter } from '../../src/apps/pmc-mini-app/ReportPage'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

afterEach(cleanup)

describe('cache-first JERA report page', () => {
  it('keeps polling until a queued refresh finishes', async () => {
    const adapter = adapterWith([
      () => Promise.resolve(paymentEnvelope({ refreshing: true })),
      () => Promise.resolve(paymentEnvelope({ refreshing: true })),
      () => Promise.resolve(paymentEnvelope({ refreshing: false, lastSuccessAt: '2026-08-27T03:05:00.000Z' })),
    ])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={() => undefined}
      pollDelayMs={0}
    />)

    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(3))
    expect(screen.getByText('อัปเดตล่าสุดเมื่อ 10:05')).toBeVisible()
    expect(document.querySelector('.spinning')).toBeNull()
  })

  it('stops bounded polling and marks cache stale when refresh stays queued', async () => {
    const adapter = adapterWith([() => Promise.resolve(paymentEnvelope({ refreshing: true }))])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={() => undefined}
      pollDelayMs={0}
      maxPollAttempts={2}
    />)

    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(3))
    expect(screen.getByText('ข้อมูลอาจล่าช้า')).toBeVisible()
    expect(document.querySelector('.spinning')).toBeNull()
  })

  it('renders cache immediately, polls once, and discloses a stale refresh failure', async () => {
    const adapter = adapterWith([
      () => Promise.resolve(paymentEnvelope({ refreshing: true })),
      () => Promise.reject(Object.assign(new Error('private provider detail'), { code: 'JERA_TIMEOUT' })),
    ])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={() => undefined}
      pollDelayMs={0}
    />)

    expect((await screen.findAllByText('10,000 บาท')).length).toBeGreaterThan(0)
    expect(screen.getByText('อัปเดตล่าสุดเมื่อ 10:00')).toBeVisible()
    expect(await screen.findByText('ข้อมูลอาจล่าช้า')).toBeVisible()
    expect(screen.getAllByText('10,000 บาท').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('private provider detail')
  })

  it('requests a manual refresh and reloads the current report', async () => {
    const user = userEvent.setup()
    const adapter = adapterWith([
      () => Promise.resolve(paymentEnvelope()),
      () => Promise.resolve(paymentEnvelope({ source: 'LIVE', refreshing: false })),
    ])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={() => undefined}
      pollDelayMs={0}
    />)
    await screen.findAllByText('10,000 บาท')

    await user.click(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' }))

    await waitFor(() => expect(adapter.refresh).toHaveBeenCalledOnce())
    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(2))
  })

  it('keeps bounded polling after a manual refresh until queued work finishes', async () => {
    const user = userEvent.setup()
    const adapter = adapterWith([
      () => Promise.resolve(paymentEnvelope()),
      () => Promise.resolve(paymentEnvelope({ refreshing: true })),
      () => Promise.resolve(paymentEnvelope({ refreshing: true })),
      () => Promise.resolve(paymentEnvelope({ refreshing: false, lastSuccessAt: '2026-08-27T03:06:00.000Z' })),
    ])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={() => undefined}
      pollDelayMs={0}
    />)
    await screen.findAllByText('10,000 บาท')

    await user.click(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' }))

    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(4))
    expect(screen.getByText('อัปเดตล่าสุดเมื่อ 10:06')).toBeVisible()
    expect(document.querySelector('.spinning')).toBeNull()
  })

  it('does not let an older manual refresh overwrite a newly selected date', async () => {
    const user = userEvent.setup()
    let releaseRefresh = (): void => undefined
    const refreshWait = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const adapter: ReportPageAdapter = {
      load: vi.fn(async (_reportType, filters) => paymentEnvelope({
        lastSuccessAt: filters.startDate === '2026-08-27'
          ? '2026-08-27T03:00:00.000Z'
          : '2026-08-28T03:08:00.000Z',
      })),
      refresh: vi.fn(async () => { await refreshWait; return { accepted: true, correlationId: 'refresh-deferred' } }),
    }
    const firstFilters = defaultReportFilters('2026-08-27')
    const secondFilters = defaultReportFilters('2026-08-28')
    const view = render(<ReportPage
      reportType="PAYMENT" filters={firstFilters} onFiltersChange={() => undefined}
      adapter={adapter} onBack={() => undefined} pollDelayMs={0}
    />)
    await screen.findByText('อัปเดตล่าสุดเมื่อ 10:00')
    await user.click(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' }))

    view.rerender(<ReportPage
      reportType="PAYMENT" filters={secondFilters} onFiltersChange={() => undefined}
      adapter={adapter} onBack={() => undefined} pollDelayMs={0}
    />)
    expect(await screen.findByText('อัปเดตล่าสุดเมื่อ 10:08')).toBeVisible()

    releaseRefresh()
    await waitFor(() => expect(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' })).toBeEnabled())
    expect(adapter.load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('อัปเดตล่าสุดเมื่อ 10:08')).toBeVisible()
  })

  it('keeps navigation explicit and reports an empty cache without claiming zero live data', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    const adapter = adapterWith([() => Promise.resolve({
      data: { totals: { rowCount: 0, paidAmountSatang: 0 }, rows: [] },
      source: 'CACHE' as const, fetchedAt: null, lastSuccessAt: null,
      refreshing: true, stale: true, warningCode: 'JERA_CACHE_EMPTY',
    })])
    render(<ReportPage
      reportType="PAYMENT"
      filters={defaultReportFilters('2026-08-27')}
      onFiltersChange={() => undefined}
      adapter={adapter}
      onBack={onBack}
      pollDelayMs={60_000}
    />)

    expect(await screen.findByText('ยังไม่มีข้อมูลที่ยืนยันแล้ว')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'กลับไปรายงาน' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

function adapterWith(loads: Array<() => Promise<unknown>>): ReportPageAdapter {
  let index = 0
  return {
    load: vi.fn(async () => loads[Math.min(index++, loads.length - 1)]!()),
    refresh: vi.fn(async () => ({ accepted: true, correlationId: 'refresh-1' })),
  } as unknown as ReportPageAdapter
}

function paymentEnvelope(patch: Record<string, unknown> = {}) {
  return {
    data: {
      totals: {
        rowCount: 1, totalSatang: 1_000_000, paidAmountSatang: 1_000_000,
        normalPaidSatang: 1_000_000, depositPaidSatang: 0, cashSatang: 0,
        transferSatang: 1_000_000, creditCardSatang: 0, eWalletSatang: 0,
        paymentLinkSatang: 0, otherPaymentSatang: 0, refundAmountSatang: 0, unpaidCount: 0,
      },
      rows: [{
        sourceUuid: 'payment-1', eventDate: '2026-08-27', patientName: 'Synthetic Patient',
        paymentCode: 'PAY-1', status: 'PAID', paidAmountSatang: 1_000_000, refundAmountSatang: null,
      }],
      breakdowns: {}, warnings: [], dataQuality: { inputRows: 1, includedRows: 1 },
    },
    source: 'CACHE' as const, fetchedAt: '2026-08-27T03:00:00.000Z',
    lastSuccessAt: '2026-08-27T03:00:00.000Z', refreshing: false, stale: false, warningCode: null,
    ...patch,
  }
}
