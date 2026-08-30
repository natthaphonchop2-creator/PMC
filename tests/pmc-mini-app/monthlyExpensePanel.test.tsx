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

    expect(screen.getByText('รายจ่ายคลินิก')).toHaveTextContent('1,200.00')
    expect(screen.getByText('รายจ่ายส่วนตัวหมอ')).toHaveTextContent('500.00')
    expect(screen.getByText('ยังไม่ผ่านการตรวจสอบ')).toBeInTheDocument()
  })
})
