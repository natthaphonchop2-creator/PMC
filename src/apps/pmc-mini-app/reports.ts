export type JeraReportType =
  | 'TODAY_SUMMARY' | 'PAYMENT' | 'DEPOSIT' | 'REFUND' | 'APPOINTMENT'
  | 'PAYMENT_LIST' | 'PRODUCT_USE' | 'PRODUCT_SALES' | 'CANCELLED_PAYMENT'
  | 'OPD' | 'CANCELLED_UNPAID' | 'COURSE_SALES' | 'REMAINING_COURSE'
  | 'REMAINING_COURSE_BY_DATE'

export type ReportSelection = JeraReportType | 'ADDITIONAL'
export type ReportDatePreset = 'TODAY' | 'YESTERDAY' | 'MONTH' | 'CUSTOM'

export interface ReportFilterState {
  preset: ReportDatePreset
  startDate: string
  endDate: string
  branchUuid: string
  doctorUuid: string
  salespersonUuid: string
  status: string
}

export interface ReportFilterOptions {
  branches: Array<{ id: string; name: string }>
  doctors: Array<{ id: string; name: string }>
  salespersons: Array<{ id: string; name: string }>
}

export interface ReportFilterSupport {
  branchUuid: boolean
  doctorUuid: boolean
  salespersonUuid: boolean
  status: boolean
}

export interface JeraClientEnvelope<T> {
  data: T
  source: 'CACHE' | 'LIVE'
  fetchedAt: string | null
  lastSuccessAt: string | null
  refreshing: boolean
  stale: boolean
  warningCode: string | null
}

const STATUS_REPORTS = new Set<JeraReportType>(['APPOINTMENT', 'PAYMENT_LIST'])
const FILTER_STORAGE_KEY = 'pmc-jera-report-filters-v1'

export function defaultReportFilters(today = currentBangkokDate()): ReportFilterState {
  return {
    preset: 'TODAY', startDate: today, endDate: today,
    branchUuid: '', doctorUuid: '', salespersonUuid: '', status: '',
  }
}

export function reportFilterSupport(reportType: JeraReportType): ReportFilterSupport {
  return {
    branchUuid: true,
    doctorUuid: false,
    salespersonUuid: false,
    status: STATUS_REPORTS.has(reportType),
  }
}

export function applyReportPreset(
  value: ReportFilterState,
  preset: ReportDatePreset,
  today: string,
): ReportFilterState {
  const current = parseDate(today)
  if (preset === 'CUSTOM') return { ...value, preset }
  if (preset === 'YESTERDAY') {
    const yesterday = new Date(current.getTime() - 86_400_000).toISOString().slice(0, 10)
    return { ...value, preset, startDate: yesterday, endDate: yesterday }
  }
  if (preset === 'MONTH') return { ...value, preset, startDate: `${today.slice(0, 7)}-01`, endDate: today }
  return { ...value, preset, startDate: today, endDate: today }
}

export function reportFilterError(value: ReportFilterState): string | null {
  let start: Date
  let end: Date
  try {
    start = parseDate(value.startDate)
    end = parseDate(value.endDate)
  } catch {
    return 'รูปแบบวันที่ไม่ถูกต้อง'
  }
  if (start > end) return 'วันเริ่มต้นต้องไม่เกินวันสิ้นสุด'
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days > 366) return 'เลือกช่วงเวลาได้ไม่เกิน 366 วัน'
  return null
}

export function buildReportSearchParams(reportType: JeraReportType, filters: ReportFilterState): URLSearchParams {
  const error = reportFilterError(filters)
  if (error) throw new Error('JERA_FILTER_INVALID')
  const support = reportFilterSupport(reportType)
  const params = new URLSearchParams()
  if (support.branchUuid && filters.branchUuid) params.set('branchUuid', filters.branchUuid)
  params.set('startDate', filters.startDate)
  params.set('endDate', filters.endDate)
  if (support.doctorUuid && filters.doctorUuid) params.set('doctorUuid', filters.doctorUuid)
  if (support.salespersonUuid && filters.salespersonUuid) params.set('salespersonUuid', filters.salespersonUuid)
  if (support.status && filters.status) params.set('status', filters.status)
  return params
}

export function loadReportFilterPreferences(today = currentBangkokDate()): ReportFilterState {
  if (typeof sessionStorage === 'undefined') return defaultReportFilters(today)
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return defaultReportFilters(today)
    const value = JSON.parse(raw) as Partial<ReportFilterState>
    const candidate: ReportFilterState = {
      ...defaultReportFilters(today),
      ...value,
    }
    return reportFilterError(candidate) ? defaultReportFilters(today) : candidate
  } catch {
    return defaultReportFilters(today)
  }
}

export function saveReportFilterPreferences(value: ReportFilterState): void {
  if (typeof sessionStorage === 'undefined' || reportFilterError(value)) return
  sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(value))
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('invalid date')
  }
  return date
}

function currentBangkokDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
