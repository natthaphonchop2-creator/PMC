export type FinanceDailyPreset = 'TODAY' | 'YESTERDAY' | 'CUSTOM'

export interface FinanceDailyFilter {
  preset: FinanceDailyPreset
  startDate: string
  endDate: string
}

export interface FinanceMonthSelection {
  year: number
  month: number
}

export interface FinanceReportFilterPreferences {
  daily: FinanceDailyFilter
  monthly: FinanceMonthSelection
}

export interface FinanceReportFilterStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const FINANCE_REPORT_FILTERS_STORAGE_KEY = 'pmc-finance-report-filters-v1'

export function defaultFinanceDailyFilter(bangkokDate: string): FinanceDailyFilter {
  if (!parseCalendarDate(bangkokDate)) throw new Error('Invalid Bangkok calendar date')
  return { preset: 'TODAY', startDate: bangkokDate, endDate: bangkokDate }
}

export function defaultFinanceMonthSelection(bangkokDate: string): FinanceMonthSelection {
  const date = parseCalendarDate(bangkokDate)
  if (!date) throw new Error('Invalid Bangkok calendar date')
  return { year: date.year, month: date.month }
}

export function applyFinanceDailyPreset(
  filter: FinanceDailyFilter,
  preset: FinanceDailyPreset,
  bangkokDate: string,
): FinanceDailyFilter {
  if (preset === 'CUSTOM') return { ...filter, preset }
  const today = parseCalendarDate(bangkokDate)
  if (!today) throw new Error('Invalid Bangkok calendar date')
  const date = preset === 'TODAY' ? today : calendarDateBefore(today)
  const value = calendarDateToString(date)
  return { preset, startDate: value, endDate: value }
}

export function financeDailyFilterError(filter: FinanceDailyFilter): string | null {
  if (!isFinanceDailyPreset(filter.preset)) return 'กรุณาเลือกช่วงเวลาให้ถูกต้อง'
  const start = parseCalendarDate(filter.startDate)
  const end = parseCalendarDate(filter.endDate)
  if (!start || !end) return 'กรุณาเลือกวันที่ให้ถูกต้อง'
  const duration = Math.floor((calendarDateToMillis(end) - calendarDateToMillis(start)) / DAY_MILLIS) + 1
  if (duration < 1) return 'วันเริ่มต้นต้องไม่เกินวันสิ้นสุด'
  if (duration > 31) return 'เลือกช่วงเวลาได้ไม่เกิน 31 วัน'
  return null
}

export function monthSelectionToSearch(selection: FinanceMonthSelection): URLSearchParams {
  return new URLSearchParams({ year: String(selection.year), month: String(selection.month) })
}

export function financeMonthSelectionError(selection: FinanceMonthSelection): string | null {
  if (!Number.isSafeInteger(selection.year) || selection.year < 2020 || selection.year > 2100
    || !Number.isSafeInteger(selection.month) || selection.month < 1 || selection.month > 12) return 'กรุณาเลือกเดือนให้ถูกต้อง'
  return null
}

export function saveFinanceReportFilterPreferences(
  storage: FinanceReportFilterStorage,
  preferences: FinanceReportFilterPreferences,
): void {
  const daily = preferences.daily.preset === 'CUSTOM' && financeDailyFilterError(preferences.daily) === null
    ? { preset: 'CUSTOM' as const, startDate: preferences.daily.startDate, endDate: preferences.daily.endDate }
    : { preset: preferences.daily.preset === 'YESTERDAY' ? 'YESTERDAY' as const : 'TODAY' as const }
  const monthly = financeMonthSelectionError(preferences.monthly) === null ? preferences.monthly : null
  storage.setItem(FINANCE_REPORT_FILTERS_STORAGE_KEY, JSON.stringify({ daily, monthly }))
}

export function loadFinanceReportFilterPreferences(
  storage: FinanceReportFilterStorage,
  bangkokDate: string,
): FinanceReportFilterPreferences {
  const fallback: FinanceReportFilterPreferences = {
    daily: defaultFinanceDailyFilter(bangkokDate),
    monthly: defaultFinanceMonthSelection(bangkokDate),
  }
  try {
    const saved = parsePreferences(storage.getItem(FINANCE_REPORT_FILTERS_STORAGE_KEY))
    if (!saved) return fallback
    return {
      daily: applyFinanceDailyPreset(saved.daily, saved.daily.preset, bangkokDate),
      monthly: saved.monthly ?? fallback.monthly,
    }
  } catch {
    return fallback
  }
}

interface CalendarDate { year: number; month: number; day: number }

const DAY_MILLIS = 86_400_000

function parsePreferences(value: string | null): { daily: FinanceDailyFilter; monthly: FinanceMonthSelection | null } | null {
  if (!value) return null
  const parsed = JSON.parse(value)
  if (!isRecord(parsed) || !isRecord(parsed.daily)) return null
  const preset = parsed.daily.preset
  if (preset === 'TODAY' || preset === 'YESTERDAY') {
    return { daily: { preset, startDate: '', endDate: '' }, monthly: parseMonthSelection(parsed.monthly) }
  }
  if (preset !== 'CUSTOM' || typeof parsed.daily.startDate !== 'string' || typeof parsed.daily.endDate !== 'string') return null
  const daily: FinanceDailyFilter = { preset, startDate: parsed.daily.startDate, endDate: parsed.daily.endDate }
  if (financeDailyFilterError(daily) !== null) return null
  return { daily, monthly: parseMonthSelection(parsed.monthly) }
}

function parseMonthSelection(value: unknown): FinanceMonthSelection | null {
  if (!isRecord(value) || typeof value.year !== 'number' || typeof value.month !== 'number') return null
  const selection = { year: value.year, month: value.month }
  return financeMonthSelectionError(selection) === null ? selection : null
}

function isFinanceDailyPreset(value: unknown): value is FinanceDailyPreset {
  return value === 'TODAY' || value === 'YESTERDAY' || value === 'CUSTOM'
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null
}

function calendarDateBefore(value: CalendarDate): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day - 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function calendarDateToMillis(value: CalendarDate): number {
  return Date.UTC(value.year, value.month - 1, value.day)
}

function calendarDateToString(value: CalendarDate): string {
  return `${value.year.toString().padStart(4, '0')}-${value.month.toString().padStart(2, '0')}-${value.day.toString().padStart(2, '0')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
