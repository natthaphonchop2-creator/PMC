// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MonthlyExpensePanel } from '../../src/apps/pmc-mini-app/expense/MonthlyExpensePanel'

afterEach(cleanup)

describe('MonthlyExpensePanel', () => {
  it('keeps doctor-personal expense separate from clinic balance inputs', () => {
    render(<MonthlyExpensePanel projection={{
      monthKey: '2026-08', clinicCommittedSatang: 120_000,
      doctorPersonalCommittedSatang: 50_000,
      clinicByCategorySatang: { BILL_DOCUMENT: 100_000, BOOK_CLINIC: 20_000 },
      effectiveExpenseCount: 4, unreviewed: true,
    }} />)

    expect(screen.getByText('รายจ่ายคลินิก').closest('div')).toHaveTextContent('1,200.00')
    expect(screen.getByText('รายจ่ายส่วนตัวหมอ').closest('div')).toHaveTextContent('500.00')
    expect(screen.getByText('ยังไม่ผ่านการตรวจสอบ')).toBeInTheDocument()
  })

  it('uses valid definition pairs and exact maximum-safe satang formatting', () => {
    const view = render(<MonthlyExpensePanel projection={{
      monthKey: '2026-08', clinicCommittedSatang: Number.MAX_SAFE_INTEGER,
      doctorPersonalCommittedSatang: 0,
      clinicByCategorySatang: { BILL_DOCUMENT: Number.MAX_SAFE_INTEGER, BOOK_CLINIC: 0 },
      effectiveExpenseCount: 1, unreviewed: true,
    }} />)
    const definitions = [...view.container.querySelectorAll('.pmc-monthly-expense-summary > div')]
    expect(definitions.every((item) => item.querySelectorAll(':scope > dt').length === 1
      && item.querySelectorAll(':scope > dd').length === 1)).toBe(true)
    expect(screen.getAllByText('90,071,992,547,409.91 บาท')).toHaveLength(2)
  })
})
