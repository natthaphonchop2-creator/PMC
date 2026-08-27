// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdditionalReportMenu, ReportCenter } from '../../src/apps/pmc-mini-app/ReportCenter'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

afterEach(cleanup)

describe('PMC JERA report center', () => {
  it('shows the six approved report choices to every active staff member', () => {
    render(<ReportCenter filters={defaultReportFilters('2026-08-27')} onFiltersChange={() => undefined} onSelect={() => undefined} />)

    for (const label of ['สรุปวันนี้', 'ยอดรับชำระ', 'มัดจำ', 'คืนเงิน', 'นัดหมาย', 'รายงานเพิ่มเติม']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible()
    }
    expect(screen.queryByText(/สิทธิ์/)).not.toBeInTheDocument()
  })

  it('opens the selected report without storing report rows in the browser', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ReportCenter filters={defaultReportFilters('2026-08-27')} onFiltersChange={() => undefined} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'ยอดรับชำระ' }))

    expect(onSelect).toHaveBeenCalledWith('PAYMENT')
    expect(localStorage).toHaveLength(0)
  })

  it('shows all approved additional reports before later role-based separation', () => {
    render(<AdditionalReportMenu onBack={() => undefined} onSelect={() => undefined} />)

    for (const label of [
      'การใช้สินค้าและบริการ', 'ยอดขายสินค้าและบริการ', 'รับชำระที่ยกเลิก', 'รายงาน OPD',
      'ค้างชำระที่ยกเลิก', 'ยอดขายคอร์ส', 'คอร์สคงเหลือ', 'คอร์สคงเหลือตามวันที่',
    ]) expect(screen.getByRole('button', { name: label })).toBeVisible()
  })
})
