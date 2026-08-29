// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DailyIncomePage, type DailyIncomePageAdapter } from '../../src/apps/pmc-mini-app/DailyIncomePage'
import type { DailyIncomeProjection, FinancePaymentRow } from '../../shared/pmcFinance'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('daily income report', () => {
  it('loads today, yesterday, and a valid custom range of up to 31 days', async () => {
    const user = userEvent.setup()
    const adapter = dailyAdapter()
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)

    await waitFor(() => expect(adapter.load).toHaveBeenLastCalledWith({
      preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29',
    }))
    await user.click(screen.getByRole('radio', { name: 'เมื่อวาน' }))
    await waitFor(() => expect(adapter.load).toHaveBeenLastCalledWith({
      preset: 'YESTERDAY', startDate: '2026-08-28', endDate: '2026-08-28',
    }))

    await user.click(screen.getByRole('radio', { name: 'เลือกช่วงวันที่' }))
    fireEvent.change(screen.getByLabelText('วันเริ่มต้น'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('วันสิ้นสุด'), { target: { value: '2026-08-31' } })
    await waitFor(() => expect(adapter.load).toHaveBeenLastCalledWith({
      preset: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-08-31',
    }))

    fireEvent.change(screen.getByLabelText('วันสิ้นสุด'), { target: { value: '2026-09-01' } })
    expect(await screen.findByText('เลือกช่วงเวลาได้ไม่เกิน 31 วัน')).toBeVisible()
  })

  it('separates authoritative received, refund, and net from non-additive categories and payment channels', async () => {
    const report = dailyProjection()
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={dailyAdapter(report)} onBack={vi.fn()} />)

    const authority = await screen.findByRole('region', { name: 'ยอดรายรับหลัก' })
    expect(within(authority).getByText('ยอดรับชำระ')).toBeVisible()
    expect(within(authority).getByText('1,000 บาท')).toBeVisible()
    expect(within(authority).getByText('คืนเงิน')).toBeVisible()
    expect(within(authority).getByText('100 บาท')).toBeVisible()
    expect(within(authority).getByText('รับสุทธิ')).toBeVisible()
    expect(within(authority).getByText('900 บาท')).toBeVisible()

    const categories = screen.getByRole('region', { name: 'หมวดรายรับ ไม่รวมเพิ่มจากยอดรับชำระ' })
    expect(within(categories).getByText('บริการและคอร์ส')).toBeVisible()
    expect(within(categories).getByText('Product')).toBeVisible()
    expect(within(categories).getByText('ยังไม่จัดหมวด')).toBeVisible()

    const channels = screen.getByRole('region', { name: 'ช่องทางรับชำระ' })
    for (const label of ['โอน', 'สด', 'Credit', 'อื่น ๆ']) expect(within(channels).getByText(label)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('ยอดช่องทางต่างจากยอดรับชำระ 100 บาท')
  })

  it('groups payment details newest first, renders provider HTML as inert text, and contains wide tables', async () => {
    const hostileName = '<img src=x onerror=alert(1)>'
    const report = dailyProjection({
      payments: [paymentRow('2026-08-28', 'PAY-OLD'), paymentRow('2026-08-29', 'PAY-NEW', hostileName)],
    })
    const view = render(<DailyIncomePage bangkokDate="2026-08-29" adapter={dailyAdapter(report)} onBack={vi.fn()} />)

    await screen.findByText(hostileName)
    const dayHeadings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(dayHeadings).toEqual(['2026-08-29', '2026-08-28'])
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(view.container.querySelectorAll('.pmc-finance-table-scroll')).toHaveLength(2)
    for (const scroller of view.container.querySelectorAll('.pmc-finance-table-scroll')) {
      expect(scroller).toHaveAttribute('tabindex', '0')
    }
  })

  it('shows checking state with exact incomplete dates and mixed freshness sync times', async () => {
    const report = dailyProjection({
      categories: {
        state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null,
        incompleteDates: ['2026-08-28', '2026-08-29'],
      },
      freshness: {
        payment: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
        refund: { lastSuccessAt: '2026-08-28T01:00:00.000Z', stale: true, warningCode: 'STALE' },
        allocation: { lastSuccessAt: null, stale: true, warningCode: 'CATEGORY_SOURCE_SNAPSHOT_MISMATCH' },
      },
      warnings: ['CATEGORY_SOURCE_SNAPSHOT_MISMATCH'],
    })
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={dailyAdapter(report)} onBack={vi.fn()} />)

    expect(await screen.findByText('กำลังตรวจสอบหมวด')).toBeVisible()
    expect(screen.getByText('วันที่ยังไม่ครบ: 2026-08-28, 2026-08-29')).toBeVisible()
    expect(screen.queryByText('0 บาท', { selector: '.pmc-finance-category-value' })).not.toBeInTheDocument()
    expect(screen.getByText('ข้อมูลหมวดอาจล่าช้า')).toBeVisible()
    expect(screen.getByText('ข้อมูลรับชำระ')).toBeVisible()
    expect(screen.getAllByText('ล่าช้า')).toHaveLength(2)
    expect(screen.getByText('ยังไม่เคยซิงก์')).toBeVisible()
    expect(screen.getByText('29 ส.ค. 2569 17:00')).toBeVisible()
  })

  it('refreshes one selected day once, reloads once, and does not start polling', async () => {
    const user = userEvent.setup()
    const interval = vi.spyOn(window, 'setInterval')
    const adapter = dailyAdapter()
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)
    await waitFor(() => expect(adapter.load).toHaveBeenCalledOnce())
    adapter.load.mockClear()
    interval.mockClear()

    await user.click(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(adapter.refresh).toHaveBeenCalledOnce()
    expect(adapter.refresh).toHaveBeenCalledWith('2026-08-29')
    expect(adapter.load).toHaveBeenCalledOnce()
    expect(adapter.load).toHaveBeenCalledWith({ preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29' })
    expect(interval).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'เลือกช่วงวันที่' }))
    fireEvent.change(screen.getByLabelText('วันเริ่มต้น'), { target: { value: '2026-08-28' } })
    expect(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' })).toBeDisabled()
  })

  it('does not let a pending older load overwrite the refresh reload', async () => {
    const user = userEvent.setup()
    const initialAdapter = dailyAdapter()
    const view = render(<DailyIncomePage bangkokDate="2026-08-29" adapter={initialAdapter} onBack={vi.fn()} />)
    expect(await screen.findByText('1,000 บาท', { selector: '.pmc-finance-authority strong' })).toBeVisible()

    const olderLoad = deferred<DailyIncomeProjection>()
    const refreshReload = deferred<DailyIncomeProjection>()
    const replacementAdapter = dailyAdapter()
    replacementAdapter.load
      .mockReset()
      .mockReturnValueOnce(olderLoad.promise)
      .mockReturnValueOnce(refreshReload.promise)
    view.rerender(<DailyIncomePage bangkokDate="2026-08-29" adapter={replacementAdapter} onBack={vi.fn()} />)
    await waitFor(() => expect(replacementAdapter.load).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' }))
    await waitFor(() => expect(replacementAdapter.load).toHaveBeenCalledTimes(2))
    refreshReload.resolve(dailyProjection({ receivedSatang: 200_000, netReceivedSatang: 190_000 }))
    expect(await screen.findByText('2,000 บาท')).toBeVisible()

    olderLoad.resolve(dailyProjection({ receivedSatang: 300_000, netReceivedSatang: 290_000 }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('2,000 บาท')).toBeVisible()
    expect(screen.queryByText('3,000 บาท')).not.toBeInTheDocument()
  })

  it('disables refresh while the selected period is loading', async () => {
    const pending = deferred<DailyIncomeProjection>()
    const adapter = dailyAdapter()
    adapter.load.mockReturnValueOnce(pending.promise)
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' })).toBeDisabled()
    expect(screen.getByText('กำลังโหลดรายรับ')).toBeVisible()

    pending.resolve(dailyProjection())
    await waitFor(() => expect(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' })).toBeEnabled())
  })

  it('clears loading and shows validation for an invalid initial filter without requesting data', () => {
    const adapter = dailyAdapter()
    render(<DailyIncomePage
      bangkokDate="2026-08-29"
      adapter={adapter}
      onBack={vi.fn()}
      initialFilter={{ preset: 'CUSTOM', startDate: '2026-07-30', endDate: '2026-08-30' }}
    />)

    expect(screen.getByText('เลือกช่วงเวลาได้ไม่เกิน 31 วัน')).toBeVisible()
    expect(screen.queryByText('กำลังโหลดรายรับ')).not.toBeInTheDocument()
    expect(adapter.load).not.toHaveBeenCalled()
  })

  it('hides old-period totals immediately when the daily filter changes', async () => {
    const user = userEvent.setup()
    const nextPeriod = deferred<DailyIncomeProjection>()
    const adapter = dailyAdapter()
    adapter.load
      .mockResolvedValueOnce(dailyProjection())
      .mockReturnValueOnce(nextPeriod.promise)
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'ยอดรายรับหลัก' })).toBeVisible()

    await user.click(screen.getByRole('radio', { name: 'เมื่อวาน' }))

    expect(screen.queryByRole('region', { name: 'ยอดรายรับหลัก' })).not.toBeInTheDocument()
    expect(screen.getByText('กำลังโหลดรายรับ')).toBeVisible()
  })

  it('does not render old-period totals when a new daily filter load fails', async () => {
    const user = userEvent.setup()
    const nextPeriod = deferred<DailyIncomeProjection>()
    const adapter = dailyAdapter()
    adapter.load
      .mockResolvedValueOnce(dailyProjection())
      .mockReturnValueOnce(nextPeriod.promise)
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'ยอดรายรับหลัก' })).toBeVisible()

    await user.click(screen.getByRole('radio', { name: 'เมื่อวาน' }))
    nextPeriod.reject(new Error('new period failed'))

    expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')).toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('region', { name: 'ยอดรายรับหลัก' })).not.toBeInTheDocument()
  })

  it('retains the last cache and announces a safe error after refresh failure', async () => {
    const user = userEvent.setup()
    const adapter = dailyAdapter()
    adapter.refresh.mockRejectedValueOnce(new Error('<b>provider secret failure</b>'))
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)

    const authority = await screen.findByRole('region', { name: 'ยอดรายรับหลัก' })
    expect(within(authority).getByText('1,000 บาท')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' }))

    const error = await screen.findByText('อัปเดตไม่สำเร็จ ข้อมูลล่าสุดยังแสดงอยู่ กรุณาลองอีกครั้ง')
    expect(error).toHaveAttribute('role', 'alert')
    expect(within(screen.getByRole('region', { name: 'ยอดรายรับหลัก' })).getByText('1,000 บาท')).toBeVisible()
    expect(screen.queryByText(/provider secret/i)).not.toBeInTheDocument()
  })

  it('prevents an older refresh from overwriting a newly selected range', async () => {
    const user = userEvent.setup()
    const refresh = deferred<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>()
    const adapter = dailyAdapter()
    adapter.refresh.mockReturnValueOnce(refresh.promise)
    adapter.load
      .mockResolvedValueOnce(dailyProjection())
      .mockResolvedValueOnce(dailyProjection({ receivedSatang: 200_000, netReceivedSatang: 190_000 }))
    render(<DailyIncomePage bangkokDate="2026-08-29" adapter={adapter} onBack={vi.fn()} />)
    expect(await within(await screen.findByRole('region', { name: 'ยอดรายรับหลัก' })).findByText('1,000 บาท')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'อัปเดตวันที่เลือก' }))
    await user.click(screen.getByRole('radio', { name: 'เมื่อวาน' }))
    expect(await screen.findByText('2,000 บาท')).toBeVisible()
    refresh.resolve({ accepted: true, allocationQueued: true, retryAfterSeconds: 60 })

    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(2))
    expect(screen.getByText('2,000 บาท')).toBeVisible()
  })
})

function dailyAdapter(report = dailyProjection()) {
  return {
    load: vi.fn(async () => structuredClone(report)),
    refresh: vi.fn(async () => ({ accepted: true as const, allocationQueued: true, retryAfterSeconds: 60 })),
  } satisfies DailyIncomePageAdapter as DailyIncomePageAdapter & {
    load: ReturnType<typeof vi.fn<(filter: Parameters<DailyIncomePageAdapter['load']>[0]) => Promise<DailyIncomeProjection>>>
    refresh: ReturnType<typeof vi.fn<(eventDate: string) => ReturnType<DailyIncomePageAdapter['refresh']>>>
  }
}

function dailyProjection(patch: Partial<DailyIncomeProjection> = {}): DailyIncomeProjection {
  return {
    startDate: '2026-08-29', endDate: '2026-08-29',
    receivedSatang: 100_000, refundSatang: 10_000, netReceivedSatang: 90_000,
    channels: { transferSatang: 60_000, cashSatang: 20_000, creditSatang: 5_000, otherSatang: 5_000, differenceSatang: 10_000 },
    categories: { state: 'READY', serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000, incompleteDates: [] },
    payments: [paymentRow('2026-08-29', 'PAY-1')],
    freshness: {
      payment: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      refund: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      allocation: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
    },
    warnings: ['PAYMENT_METHOD_TOTAL_MISMATCH'],
    ...patch,
  }
}

function paymentRow(eventDate: string, paymentCode: string, patientName = 'ลูกค้าทดสอบ'): FinancePaymentRow {
  return {
    paymentUuid: `uuid-${paymentCode}`, paymentCode, eventDate, patientName,
    paidAmountSatang: 100_000, transferSatang: 60_000, cashSatang: 20_000,
    creditSatang: 10_000, otherSatang: 10_000,
    serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}
