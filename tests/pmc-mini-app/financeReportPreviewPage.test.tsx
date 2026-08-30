// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FinanceReportPreviewPage } from '../../src/apps/pmc-mini-app/FinanceReportPreviewPage'

afterEach(cleanup)

describe('finance report UX preview', () => {
  it.each([
    ['DAILY_INCOME', 'รายรับรายวัน'],
    ['MONTHLY_INCOME', 'รายงานรายเดือน'],
  ] as const)('renders the %s structure without fabricated money', (view, heading) => {
    const rendered = render(<FinanceReportPreviewPage view={view} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    expect(screen.getByText('ตัวอย่าง UX/UI')).toBeVisible()
    expect(screen.getByText('ยังไม่เชื่อมข้อมูลรายรับจริง')).toBeVisible()
    expect(screen.getByText('ช่องทางรับชำระ')).toBeVisible()
    expect(screen.getByText('หมวดรายรับ')).toBeVisible()
    expect(rendered.container).not.toHaveTextContent(/(?:\d[\d,]*\s*บาท|฿)/)
  })

  it('returns to the report home through a native button', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<FinanceReportPreviewPage view="DAILY_INCOME" onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: 'กลับไปรายงาน' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
