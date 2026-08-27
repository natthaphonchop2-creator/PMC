// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportFilters } from '../../src/apps/pmc-mini-app/ReportFilters'
import {
  buildReportSearchParams,
  defaultReportFilters,
  reportFilterError,
  type ReportFilterState,
} from '../../src/apps/pmc-mini-app/reports'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
})

describe('shared JERA report filters', () => {
  it('applies today, yesterday, current month, and custom date presets', async () => {
    const user = userEvent.setup()
    let value = defaultReportFilters('2026-08-27')
    const onChange = vi.fn((next: ReportFilterState) => { value = next })
    const view = render(<ReportFilters reportType="PAYMENT" value={value} onChange={onChange} today="2026-08-27" />)

    await user.click(screen.getByRole('radio', { name: 'เมื่อวาน' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'YESTERDAY', startDate: '2026-08-26', endDate: '2026-08-26' }))

    view.rerender(<ReportFilters reportType="PAYMENT" value={value} onChange={onChange} today="2026-08-27" />)
    await user.click(screen.getByRole('radio', { name: 'เดือนนี้' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'MONTH', startDate: '2026-08-01', endDate: '2026-08-27' }))

    view.rerender(<ReportFilters reportType="PAYMENT" value={value} onChange={onChange} today="2026-08-27" />)
    await user.click(screen.getByRole('radio', { name: 'กำหนดเอง' }))
    view.rerender(<ReportFilters reportType="PAYMENT" value={value} onChange={onChange} today="2026-08-27" />)
    expect(screen.getByLabelText('วันเริ่มต้น')).toBeVisible()
    expect(screen.getByLabelText('วันสิ้นสุด')).toBeVisible()
  })

  it('shows all shared dimensions and disables unsupported combinations', () => {
    render(<ReportFilters
      reportType="PAYMENT"
      value={defaultReportFilters('2026-08-27')}
      onChange={() => undefined}
      today="2026-08-27"
      options={{
        branches: [{ id: BRANCH, name: 'สาขาหลัก' }],
        doctors: [{ id: DOCTOR, name: 'หมอทดสอบ' }],
        salespersons: [{ id: SALES, name: 'ผู้ขายทดสอบ' }],
      }}
    />)

    expect(screen.getByLabelText('สาขา')).toBeEnabled()
    expect(screen.getByLabelText('แพทย์')).toBeDisabled()
    expect(screen.getByLabelText('ผู้ขาย')).toBeDisabled()
    expect(screen.getByLabelText('สถานะชำระ')).toBeDisabled()
  })

  it('validates custom ranges and serializes each scalar exactly once', () => {
    const invalid = { ...defaultReportFilters('2026-08-27'), preset: 'CUSTOM' as const, startDate: '2026-08-28', endDate: '2026-08-27' }
    expect(reportFilterError(invalid)).toBe('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด')

    const params = buildReportSearchParams('APPOINTMENT', {
      ...defaultReportFilters('2026-08-27'), branchUuid: BRANCH, status: 'Confirmed', doctorUuid: DOCTOR,
    })
    expect(params.getAll('branchUuid')).toEqual([BRANCH])
    expect(params.getAll('startDate')).toEqual(['2026-08-27'])
    expect(params.getAll('endDate')).toEqual(['2026-08-27'])
    expect(params.getAll('status')).toEqual(['Confirmed'])
    expect(params.has('doctorUuid')).toBe(false)
  })
})

const BRANCH = '11111111-2222-4333-8444-555555555555'
const DOCTOR = '22222222-3333-4444-8555-666666666666'
const SALES = '33333333-4444-4555-8666-777777777777'
