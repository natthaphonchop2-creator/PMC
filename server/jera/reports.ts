import { JERA_ENDPOINTS, type JeraNormalizedRow, type JeraSourceReportType } from './contracts.js'

const ADDITIONAL_REPORT_TYPES = [
  'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
  'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE', 'REMAINING_COURSE_BY_DATE',
] as const

const ADDITIONAL_REPORT_LABELS: Record<(typeof ADDITIONAL_REPORT_TYPES)[number], string> = {
  PRODUCT_USE: 'การใช้สินค้าและบริการ', PRODUCT_SALES: 'ยอดขายสินค้าและบริการ',
  CANCELLED_PAYMENT: 'รายการรับชำระที่ยกเลิก', OPD: 'รายงาน OPD',
  CANCELLED_UNPAID: 'รายการค้างชำระที่ยกเลิก', COURSE_SALES: 'ยอดขายคอร์ส',
  REMAINING_COURSE: 'คอร์สคงเหลือ', REMAINING_COURSE_BY_DATE: 'คอร์สคงเหลือตามวันที่',
}

export interface JeraReportDataQuality {
  inputRows: number
  includedRows: number
  duplicateSourceRows: number
  paymentMethodMismatchRows: number
  paymentMethodDifferenceSatang: number
}

export interface JeraMoneyBreakdown {
  key: string
  label: string
  count: number
  totalSatang: number
  paidAmountSatang: number
  refundAmountSatang: number
}

export interface JeraCountBreakdown {
  key: string
  label: string
  count: number
}

export interface JeraPaymentReport {
  rows: JeraNormalizedRow[]
  totals: {
    rowCount: number
    totalSatang: number
    paidAmountSatang: number
    refundAmountSatang: number
    normalPaidSatang: number
    depositPaidSatang: number
    cashSatang: number
    transferSatang: number
    creditCardSatang: number
    eWalletSatang: number
    paymentLinkSatang: number
    otherPaymentSatang: number
    unpaidCount: number
  }
  breakdowns: {
    byBranch: JeraMoneyBreakdown[]
    byDoctor: JeraMoneyBreakdown[]
    bySalesperson: JeraMoneyBreakdown[]
    byStatus: JeraMoneyBreakdown[]
  }
  warnings: string[]
  dataQuality: JeraReportDataQuality
}

export interface JeraDepositReport {
  rows: JeraNormalizedRow[]
  totals: { rowCount: number; totalSatang: number; paidAmountSatang: number; refundAmountSatang: number; netSatang: number }
  breakdowns: { byBranch: JeraMoneyBreakdown[]; byType: JeraMoneyBreakdown[] }
  warnings: string[]
  dataQuality: JeraReportDataQuality
}

export interface JeraRefundReport {
  rows: JeraNormalizedRow[]
  totals: { rowCount: number; refundAmountSatang: number }
  breakdowns: { byBranch: JeraMoneyBreakdown[]; byType: JeraMoneyBreakdown[] }
  warnings: string[]
  dataQuality: JeraReportDataQuality
}

export interface JeraAppointmentReport {
  rows: JeraNormalizedRow[]
  totals: { appointmentCount: number }
  breakdowns: { byBranch: JeraCountBreakdown[]; byDoctor: JeraCountBreakdown[]; byStatus: JeraCountBreakdown[]; byType: JeraCountBreakdown[] }
  warnings: string[]
  dataQuality: JeraReportDataQuality
}

export function listAvailableReports(): Array<{
  type: (typeof ADDITIONAL_REPORT_TYPES)[number]
  label: string
  filters: string[]
}> {
  return ADDITIONAL_REPORT_TYPES.map((type) => ({
    type, label: ADDITIONAL_REPORT_LABELS[type], filters: [...JERA_ENDPOINTS[type].allowedFilters],
  }))
}

export function buildAdditionalReport(reportType: (typeof ADDITIONAL_REPORT_TYPES)[number], inputRows: JeraNormalizedRow[]) {
  const rows = rowsFor(inputRows, reportType)
  return {
    rows,
    totals: {
      rowCount: rows.length, totalSatang: sum(rows.map((row) => row.totalSatang)),
      paidAmountSatang: sum(rows.map((row) => row.paidAmountSatang)),
      refundAmountSatang: sum(rows.map((row) => row.refundAmountSatang)),
      quantity: sumNumbers(rows.map((row) => row.quantity)),
      remainingQuantity: sumNumbers(rows.map((row) => row.remainingQuantity)),
      remainingValueSatang: sum(rows.map((row) => row.remainingValueSatang)),
    },
    breakdowns: {
      byBranch: moneyBreakdown(rows, (row) => row.branchName),
      byType: moneyBreakdown(rows, (row) => row.type),
      byItem: moneyBreakdown(rows, (row) => row.itemName ?? row.itemCode),
    },
    warnings: duplicateWarnings(rows), dataQuality: quality(rows),
  }
}

export function buildPaymentReport(inputRows: JeraNormalizedRow[]): JeraPaymentReport {
  const rows = rowsFor(inputRows, 'PAYMENT')
  const paymentMethods = rows.map((row) => ({ row, values: methodValues(row) }))
  const mismatches = paymentMethods.flatMap(({ row, values }) => {
    if (!values.some((value) => value !== null)) return []
    const difference = Math.abs((row.paidAmountSatang ?? 0) - sum(values))
    return difference > 0 ? [difference] : []
  })
  const depositRows = rows.filter((row) => isDepositType(row.type))
  const normalRows = rows.filter((row) => !isDepositType(row.type))
  const totals = {
    rowCount: rows.length,
    totalSatang: sum(rows.map((row) => row.totalSatang)),
    paidAmountSatang: sum(rows.map((row) => row.paidAmountSatang)),
    refundAmountSatang: sum(rows.map((row) => row.refundAmountSatang)),
    normalPaidSatang: sum(normalRows.map((row) => row.paidAmountSatang)),
    depositPaidSatang: sum(depositRows.map((row) => row.paidAmountSatang)),
    cashSatang: sum(rows.map((row) => row.cashSatang)),
    transferSatang: sum(rows.map((row) => row.transferSatang)),
    creditCardSatang: sum(rows.map((row) => row.creditCardSatang)),
    eWalletSatang: sum(rows.map((row) => row.eWalletSatang)),
    paymentLinkSatang: sum(rows.map((row) => row.paymentLinkSatang)),
    otherPaymentSatang: sum(rows.map((row) => row.otherPaymentSatang)),
    unpaidCount: rows.filter((row) => row.status?.toUpperCase().includes('UNPAID')).length,
  }
  return {
    rows, totals,
    breakdowns: {
      byBranch: moneyBreakdown(rows, (row) => row.branchName),
      byDoctor: moneyBreakdown(rows, (row) => row.doctorName),
      bySalesperson: moneyBreakdown(rows, (row) => row.salespersonName),
      byStatus: moneyBreakdown(rows, (row) => row.status),
    },
    warnings: [...new Set([
      ...(mismatches.length ? ['PAYMENT_METHOD_TOTAL_MISMATCH'] : []),
      ...duplicateWarnings(rows),
    ])],
    dataQuality: quality(rows, mismatches),
  }
}

export function buildDepositReport(inputRows: JeraNormalizedRow[]): JeraDepositReport {
  const rows = rowsFor(inputRows, 'DEPOSIT')
  const paidAmountSatang = sum(rows.map((row) => row.paidAmountSatang))
  const refundAmountSatang = sum(rows.map((row) => row.refundAmountSatang))
  return {
    rows,
    totals: {
      rowCount: rows.length, totalSatang: sum(rows.map((row) => row.totalSatang)), paidAmountSatang,
      refundAmountSatang, netSatang: paidAmountSatang - refundAmountSatang,
    },
    breakdowns: { byBranch: moneyBreakdown(rows, (row) => row.branchName), byType: moneyBreakdown(rows, (row) => row.type) },
    warnings: duplicateWarnings(rows), dataQuality: quality(rows),
  }
}

export function buildRefundReport(inputRows: JeraNormalizedRow[]): JeraRefundReport {
  const rows = rowsFor(inputRows, 'REFUND')
  return {
    rows, totals: { rowCount: rows.length, refundAmountSatang: sum(rows.map((row) => row.refundAmountSatang)) },
    breakdowns: { byBranch: moneyBreakdown(rows, (row) => row.branchName), byType: moneyBreakdown(rows, (row) => row.type) },
    warnings: duplicateWarnings(rows), dataQuality: quality(rows),
  }
}

export function buildAppointmentReport(inputRows: JeraNormalizedRow[]): JeraAppointmentReport {
  const rows = rowsFor(inputRows, 'APPOINTMENT')
  return {
    rows, totals: { appointmentCount: rows.length },
    breakdowns: {
      byBranch: countBreakdown(rows, (row) => row.branchName),
      byDoctor: countBreakdown(rows, (row) => row.doctorName),
      byStatus: countBreakdown(rows, (row) => row.status),
      byType: countBreakdown(rows, (row) => row.type),
    },
    warnings: duplicateWarnings(rows), dataQuality: quality(rows),
  }
}

export function buildTodaySummary(input: {
  payments: JeraNormalizedRow[]
  deposits: JeraNormalizedRow[]
  refunds: JeraNormalizedRow[]
  appointments: JeraNormalizedRow[]
}) {
  const payments = buildPaymentReport(input.payments)
  const deposits = buildDepositReport(input.deposits)
  const refunds = buildRefundReport(input.refunds)
  const appointments = buildAppointmentReport(input.appointments)
  const receivedSatang = payments.totals.normalPaidSatang
  const depositSatang = deposits.totals.paidAmountSatang
  const refundSatang = refunds.totals.refundAmountSatang
  return {
    totals: {
      receivedSatang, depositSatang, refundSatang,
      netCashFlowSatang: receivedSatang + depositSatang - refundSatang,
      appointmentCount: appointments.totals.appointmentCount,
    },
    warnings: [...new Set([...payments.warnings, ...deposits.warnings, ...refunds.warnings, ...appointments.warnings])],
    dataQuality: {
      inputRows: payments.dataQuality.inputRows + deposits.dataQuality.inputRows
        + refunds.dataQuality.inputRows + appointments.dataQuality.inputRows,
      includedRows: payments.dataQuality.includedRows + deposits.dataQuality.includedRows
        + refunds.dataQuality.includedRows + appointments.dataQuality.includedRows,
      duplicateSourceRows: payments.dataQuality.duplicateSourceRows + deposits.dataQuality.duplicateSourceRows
        + refunds.dataQuality.duplicateSourceRows + appointments.dataQuality.duplicateSourceRows,
    },
  }
}

function rowsFor(rows: JeraNormalizedRow[], reportType: JeraSourceReportType): JeraNormalizedRow[] {
  if (rows.some((row) => row.reportType !== reportType)) throw new Error('JERA_REPORT_TYPE_MISMATCH')
  return [...rows].sort((left, right) => right.eventDate.localeCompare(left.eventDate) || left.sourceUuid.localeCompare(right.sourceUuid))
}

function methodValues(row: JeraNormalizedRow): Array<number | null> {
  return [row.cashSatang, row.transferSatang, row.creditCardSatang, row.eWalletSatang, row.paymentLinkSatang, row.otherPaymentSatang]
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function sumNumbers(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function isDepositType(type: string | null): boolean {
  return type?.toUpperCase().includes('DEPOSIT') ?? false
}

function moneyBreakdown(rows: JeraNormalizedRow[], selector: (row: JeraNormalizedRow) => string | null): JeraMoneyBreakdown[] {
  const groups = new Map<string, JeraMoneyBreakdown>()
  for (const row of rows) {
    const value = selector(row)
    const key = value ?? '__UNSPECIFIED__'
    const current = groups.get(key) ?? {
      key, label: value ?? 'ไม่ระบุ', count: 0, totalSatang: 0, paidAmountSatang: 0, refundAmountSatang: 0,
    }
    current.count += 1
    current.totalSatang += row.totalSatang ?? 0
    current.paidAmountSatang += row.paidAmountSatang ?? 0
    current.refundAmountSatang += row.refundAmountSatang ?? 0
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => right.paidAmountSatang - left.paidAmountSatang
    || right.refundAmountSatang - left.refundAmountSatang || left.label.localeCompare(right.label, 'th'))
}

function countBreakdown(rows: JeraNormalizedRow[], selector: (row: JeraNormalizedRow) => string | null): JeraCountBreakdown[] {
  const groups = new Map<string, JeraCountBreakdown>()
  for (const row of rows) {
    const value = selector(row)
    const key = value ?? '__UNSPECIFIED__'
    const current = groups.get(key) ?? { key, label: value ?? 'ไม่ระบุ', count: 0 }
    current.count += 1
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'th'))
}

function duplicateCount(rows: JeraNormalizedRow[]): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const row of rows) {
    const key = `${row.reportType}:${row.sourceUuid}`
    if (seen.has(key)) duplicates += 1
    seen.add(key)
  }
  return duplicates
}

function duplicateWarnings(rows: JeraNormalizedRow[]): string[] {
  return duplicateCount(rows) ? ['DUPLICATE_SOURCE_ROWS'] : []
}

function quality(rows: JeraNormalizedRow[], mismatches: number[] = []): JeraReportDataQuality {
  return {
    inputRows: rows.length, includedRows: rows.length, duplicateSourceRows: duplicateCount(rows),
    paymentMethodMismatchRows: mismatches.length, paymentMethodDifferenceSatang: sum(mismatches),
  }
}
