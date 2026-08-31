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
  it('groups report, recording, and compensation actions with explicit action labels', () => {
    const view = render(<FinanceReportHome
      canViewFinance
      financeReportsEnabled
      financeReadsEnabled
      expenseCaptureEnabled
      canSubmitExpense
      onSelect={vi.fn()}
      onSelectExpense={vi.fn()}
    />)

    const reportHeading = screen.getByRole('heading', { name: 'ดูรายงาน' })
    const recordHeading = screen.getByRole('heading', { name: 'บันทึกรายจ่าย' })
    const compensationHeading = screen.getByRole('heading', { name: 'ค่าตอบแทน' })
    expect(reportHeading.compareDocumentPosition(recordHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(recordHeading.compareDocumentPosition(compensationHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getByRole('button', { name: /รายรับรายวัน/ })).toHaveTextContent('ดูรายงาน')
    expect(screen.getByRole('button', { name: 'บิลเอกสาร บันทึก' })).toHaveTextContent('บันทึก')
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายภายในคลินิก บันทึก' })).toHaveTextContent('บันทึก')
    expect(screen.getByRole('button', { name: 'สมุดรายจ่ายส่วนตัวหมอ บันทึก' })).toHaveTextContent('บันทึก')
    expect(screen.getByText('เงินเดือนพนักงาน').closest('.pmc-expense-card-deferred')).toHaveTextContent('เตรียมระบบ')
    expect(view.container.querySelectorAll('.pmc-finance-menu-section')).toHaveLength(3)
  })

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

  it('keeps monthly income visibly unavailable during the one-day pilot', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FinanceReportHome
      canViewFinance
      financeReportsEnabled
      monthlyReportsEnabled={false}
      onSelect={onSelect}
    />)

    const monthly = screen.getByRole('button', { name: /รายงานรายเดือน/ })
    expect(monthly).toHaveAttribute('aria-disabled', 'true')
    expect(monthly).toHaveTextContent('ยังไม่เปิดข้อมูลย้อนหลัง')
    await user.click(monthly)
    expect(onSelect).not.toHaveBeenCalledWith('MONTHLY_INCOME')
  })

  it('hides every revenue action in expense-only mode while leaving permitted capture active', () => {
    render(<FinanceReportHome
      financeReportsEnabled={false}
      canViewFinance={false}
      expenseCaptureEnabled
      canSubmitExpense
      onSelect={vi.fn()}
      onSelectExpense={vi.fn()}
    />)

    expect(screen.queryByRole('button', { name: /รายรับรายวัน/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /รายงานรายเดือน/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'บิลเอกสาร บันทึก' })).toBeEnabled()
  })

  it('shows a monthly expense entry in reads-only mode without exposing revenue actions', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FinanceReportHome
      financeReportsEnabled={false}
      financeReadsEnabled
      canViewFinance
      expenseCaptureEnabled={false}
      onSelect={onSelect}
    />)

    expect(screen.queryByRole('button', { name: /รายรับรายวัน/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /รายจ่ายรายเดือน/ }))
    expect(onSelect).toHaveBeenCalledWith('MONTHLY_INCOME')
  })

  it('shows both revenue structure entries with an explicit preview label while live revenue stays off', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FinanceReportHome
      financeReportsEnabled={false}
      financeUiPreviewEnabled
      canViewFinance
      expenseCaptureEnabled
      canSubmitExpense
      onSelect={onSelect}
    />)

    expect(screen.getByText('ตัวอย่าง UX/UI — ยังไม่เชื่อมข้อมูลรายรับจริง')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /รายรับรายวัน/ }))
    await user.click(screen.getByRole('button', { name: /รายงานรายเดือน/ }))
    expect(onSelect).toHaveBeenNthCalledWith(1, 'DAILY_INCOME')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'MONTHLY_INCOME')
  })

  it('keeps every deferred expense area compact, unavailable, and free of create actions', () => {
    render(<FinanceReportHome canViewFinance onSelect={vi.fn()} />)

    for (const label of EXPENSE_CARDS.slice(0, 3)) {
      expect(screen.queryByRole('button', { name: `${label} บันทึก` })).not.toBeInTheDocument()
      expect(screen.getByText(label).closest('.pmc-expense-card-deferred')).toHaveTextContent('ยังไม่เปิดใช้')
    }
    for (const label of EXPENSE_CARDS.slice(3)) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
      expect(screen.getByText(label).closest('.pmc-expense-card-deferred')).toHaveTextContent('เตรียมระบบ')
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
