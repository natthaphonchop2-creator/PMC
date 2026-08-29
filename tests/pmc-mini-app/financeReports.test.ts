import { describe, expect, it } from 'vitest'
import {
  applyFinanceDailyPreset,
  defaultFinanceDailyFilter,
  defaultFinanceMonthSelection,
  financeDailyFilterError,
  loadFinanceReportFilterPreferences,
  monthSelectionToSearch,
  saveFinanceReportFilterPreferences,
  type FinanceReportFilterStorage,
} from '../../src/apps/pmc-mini-app/financeReports'

describe('PMC Mini App finance report filter state', () => {
  it('defaults daily income to the supplied Bangkok calendar date', () => {
    expect(defaultFinanceDailyFilter('2026-08-29')).toEqual({
      preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29',
    })
    expect(defaultFinanceMonthSelection('2026-08-29')).toEqual({ year: 2026, month: 8 })
    expect(() => defaultFinanceDailyFilter('2026-02-30')).toThrow('Invalid Bangkok calendar date')
  })

  it('recomputes relative daily presets from the current Bangkok date', () => {
    const filter = { preset: 'TODAY' as const, startDate: '2026-08-29', endDate: '2026-08-29' }

    expect(applyFinanceDailyPreset(filter, 'YESTERDAY', '2026-09-01')).toEqual({
      preset: 'YESTERDAY', startDate: '2026-08-31', endDate: '2026-08-31',
    })
  })

  it('validates an exact Bangkok calendar range of one through 31 days', () => {
    const filter = defaultFinanceDailyFilter('2026-08-29')

    expect(financeDailyFilterError({ ...filter, preset: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-09-01' }))
      .toBe('เลือกช่วงเวลาได้ไม่เกิน 31 วัน')
    expect(financeDailyFilterError({ ...filter, preset: 'CUSTOM', startDate: '2026-02-30', endDate: '2026-03-01' }))
      .toBe('กรุณาเลือกวันที่ให้ถูกต้อง')
    expect(financeDailyFilterError({ ...filter, preset: 'CUSTOM', startDate: '2026-08-30', endDate: '2026-08-29' }))
      .toBe('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด')
  })

  it('serializes monthly selections with year and numeric month only', () => {
    expect(monthSelectionToSearch({ year: 2026, month: 8 }).toString()).toBe('year=2026&month=8')
  })

  it('stores only filter preferences and recomputes saved relative presets on load', () => {
    const storage = memoryStorage()
    saveFinanceReportFilterPreferences(storage, {
      daily: { preset: 'YESTERDAY', startDate: '2026-08-28', endDate: '2026-08-28' },
      monthly: { year: 2026, month: 8 },
    })

    expect(JSON.parse(storage.value)).toEqual({
      daily: { preset: 'YESTERDAY' }, monthly: { year: 2026, month: 8 },
    })
    expect(loadFinanceReportFilterPreferences(storage, '2026-09-01')).toEqual({
      daily: { preset: 'YESTERDAY', startDate: '2026-08-31', endDate: '2026-08-31' },
      monthly: { year: 2026, month: 8 },
    })
  })
})

function memoryStorage(): FinanceReportFilterStorage & { value: string } {
  let value = ''
  return {
    get value() { return value },
    getItem() { return value || null },
    setItem(_key, next) { value = next },
  }
}
