// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FinanceReportHome } from '../../src/apps/pmc-mini-app/FinanceReportHome'

afterEach(cleanup)

const EXPENSE_CARDS = [
  'บิลเอกสาร',
  'สมุดรายจ่ายภายในคลินิก',
  'สมุดรายจ่ายส่วนตัวหมอ',
  'เงินเดือนพนักงาน',
  'DF พนักงานตามแพ็กเกจ',
  'DF แพทย์',
]

describe('finance-first report home', () => {
  it('shows daily income and a visibly locked monthly report to ordinary staff without finance figures', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const view = render(<FinanceReportHome canViewFinance={false} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: /รายรับรายวัน/ }))
    expect(onSelect).toHaveBeenCalledWith('DAILY_INCOME')

    const monthly = screen.getByRole('button', { name: /รายงานรายเดือน/ })
    expect(monthly).toHaveAttribute('aria-disabled', 'true')
    expect(monthly).toHaveTextContent('เฉพาะฝ่ายการเงิน')
    await user.click(monthly)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(view.container).not.toHaveTextContent(/(?:\d[\d,]*\s*บาท|฿)/)
  })

  it('lets finance staff open the monthly report', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FinanceReportHome canViewFinance onSelect={onSelect} />)

    const monthly = screen.getByRole('button', { name: /รายงานรายเดือน/ })
    expect(monthly).not.toHaveAttribute('aria-disabled')
    await user.click(monthly)

    expect(onSelect).toHaveBeenCalledWith('MONTHLY_INCOME')
  })

  it('keeps every deferred expense area compact, unavailable, and free of create actions', () => {
    render(<FinanceReportHome canViewFinance onSelect={vi.fn()} />)

    for (const label of EXPENSE_CARDS) {
      const card = screen.getByRole('button', { name: new RegExp(label) })
      expect(card).toHaveAttribute('aria-disabled', 'true')
      expect(card).toHaveTextContent('เตรียมระบบ')
    }
    expect(screen.queryByRole('button', { name: /เพิ่ม|สร้าง|บันทึก/ })).not.toBeInTheDocument()
  })

  it('does not expose legacy report navigation or a provider name', () => {
    const view = render(<FinanceReportHome canViewFinance onSelect={vi.fn()} />)

    for (const legacyLabel of ['สรุปวันนี้', 'มัดจำ', 'นัดหมาย', 'รายงานเพิ่มเติม']) {
      expect(screen.queryByText(legacyLabel)).not.toBeInTheDocument()
    }
    expect(view.container).not.toHaveTextContent(/jera/i)
    expect(view.container.querySelectorAll('[aria-label*="JERA" i]')).toHaveLength(0)
  })
})
