import type {
  DailyIncomeProjection,
  FinanceComponentFreshness,
  FinancePaymentRow,
  MonthlyIncomeProjection,
  PaymentRevenueAllocation,
} from '../../shared/pmcFinance.js'
import type { JeraCacheEnvelope, JeraNormalizedRow } from './contracts.js'

export interface FinanceDaySourceSnapshot {
  eventDate: string
  payment: JeraCacheEnvelope<JeraNormalizedRow[]>
  refund: JeraCacheEnvelope<JeraNormalizedRow[]>
  productSales: JeraCacheEnvelope<JeraNormalizedRow[]>
  allocations: PaymentRevenueAllocation[]
  sourceBinding: {
    paymentCacheKey: string
    productSalesCacheKey: string
    paymentSetHash: string
    paymentRowCount: number
    metadataSnapshotHash: string
    productSalesRowCount: number
  }
  allocationCoverage: null | {
    status: 'INCOMPLETE' | 'COMPLETE'
    paymentCacheKey: string
    productSalesCacheKey: string
    paymentSetHash: string
    paymentRowCount: number
    metadataSnapshotHash: string
    productSalesRowCount: number
    paymentLastSuccessAt: string | null
    productSalesLastSuccessAt: string | null
    lastSuccessAt: string | null
  }
}

export interface BuildDailyIncomeInput {
  days: FinanceDaySourceSnapshot[]
  categoryMoneyEnabled: boolean
  now: Date
}

export function buildDailyIncomeProjection(input: BuildDailyIncomeInput): DailyIncomeProjection {
  const days = [...input.days].sort((left, right) => left.eventDate.localeCompare(right.eventDate))
  const paymentRows = days.flatMap((day) => deduplicatedPaymentsForDay(day))
  const refundRows = days.flatMap((day) => rowsForDay(day.refund.data, day.eventDate, 'REFUND'))
  const allocationByPaymentVersion = new Map<string, PaymentRevenueAllocation>()
  for (const day of days) {
    for (const allocation of day.allocations) {
      allocationByPaymentVersion.set(allocationKey(allocation.paymentUuid, allocation.paymentSourceHash), allocation)
    }
  }

  const receivedSatang = sum(paymentRows.map((row) => row.paidAmountSatang))
  const refundSatang = sum(refundRows.map((row) => row.refundAmountSatang))
  const channels = {
    transferSatang: sum(paymentRows.map((row) => row.transferSatang)),
    cashSatang: sum(paymentRows.map((row) => row.cashSatang)),
    creditSatang: sum(paymentRows.map((row) => row.creditCardSatang)),
    otherSatang: sum(paymentRows.map((row) => sum([row.eWalletSatang, row.paymentLinkSatang, row.otherPaymentSatang]))),
    differenceSatang: 0,
  }
  channels.differenceSatang = receivedSatang - sum([
    channels.transferSatang, channels.cashSatang, channels.creditSatang, channels.otherSatang,
  ])

  const categoryReadiness = categoryReadinessFor(days, input.categoryMoneyEnabled)
  const payments = paymentRows
    .sort(sortPaymentRowsNewestFirst)
    .map((row): FinancePaymentRow => {
      const allocation = categoryReadiness.ready
        ? allocationByPaymentVersion.get(allocationKey(row.sourceUuid, row.sourceHash))
        : undefined
      return {
        paymentUuid: row.sourceUuid,
        paymentCode: row.paymentCode,
        eventDate: row.eventDate,
        patientName: row.patientName,
        paidAmountSatang: money(row.paidAmountSatang),
        transferSatang: money(row.transferSatang),
        cashSatang: money(row.cashSatang),
        creditSatang: money(row.creditCardSatang),
        otherSatang: sum([row.eWalletSatang, row.paymentLinkSatang, row.otherPaymentSatang]),
        serviceSatang: allocation?.serviceSatang ?? null,
        productSatang: allocation?.productSatang ?? null,
        unclassifiedSatang: allocation?.unclassifiedSatang ?? null,
      }
    })

  const paymentFreshness = componentFreshness(days.map((day) => day.payment), input.now)
  const refundFreshness = componentFreshness(days.map((day) => day.refund), input.now)
  const allocationFreshness = coverageFreshness(days, input.now)
  const warnings = new Set<string>()
  if (channels.differenceSatang !== 0) warnings.add('PAYMENT_METHOD_TOTAL_MISMATCH')
  addFreshnessWarning(warnings, 'PAYMENT', paymentFreshness)
  addFreshnessWarning(warnings, 'REFUND', refundFreshness)
  addFreshnessWarning(warnings, 'ALLOCATION', allocationFreshness)
  if (categoryReadiness.sourceSnapshotMismatch) warnings.add('CATEGORY_SOURCE_SNAPSHOT_MISMATCH')
  if (categoryReadiness.sourceBindingMismatch) warnings.add('CATEGORY_SOURCE_BINDING_MISMATCH')
  if (categoryReadiness.allocationIncomplete) warnings.add('CATEGORY_ALLOCATION_INCOMPLETE')

  const categoryAllocations = payments.flatMap((payment) => (
    payment.serviceSatang === null || payment.productSatang === null || payment.unclassifiedSatang === null
      ? []
      : [{ serviceSatang: payment.serviceSatang, productSatang: payment.productSatang, unclassifiedSatang: payment.unclassifiedSatang }]
  ))
  return {
    startDate: days[0]?.eventDate ?? '',
    endDate: days.at(-1)?.eventDate ?? '',
    receivedSatang,
    refundSatang,
    netReceivedSatang: receivedSatang - refundSatang,
    channels,
    categories: categoryReadiness.ready
      ? {
          state: 'READY',
          serviceSatang: sum(categoryAllocations.map((allocation) => allocation.serviceSatang)),
          productSatang: sum(categoryAllocations.map((allocation) => allocation.productSatang)),
          unclassifiedSatang: sum(categoryAllocations.map((allocation) => allocation.unclassifiedSatang)),
          incompleteDates: [],
        }
      : {
          state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null,
          incompleteDates: categoryReadiness.incompleteDates,
        },
    payments,
    freshness: { payment: paymentFreshness, refund: refundFreshness, allocation: allocationFreshness },
    warnings: [...warnings].sort(),
  }
}

export function buildMonthlyIncomeProjection(input: {
  monthKey: string
  days: FinanceDaySourceSnapshot[]
  categoryMoneyEnabled: boolean
  now: Date
}): MonthlyIncomeProjection {
  const aggregate = buildDailyIncomeProjection(input)
  const dailyTrend = input.days
    .map((day) => buildDailyIncomeProjection({ ...input, days: [day] }))
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map((daily) => ({
      date: daily.startDate,
      receivedSatang: daily.receivedSatang,
      refundSatang: daily.refundSatang,
      netReceivedSatang: daily.netReceivedSatang,
    }))
  return {
    monthKey: input.monthKey,
    startDate: aggregate.startDate,
    endDate: aggregate.endDate,
    receivedSatang: aggregate.receivedSatang,
    refundSatang: aggregate.refundSatang,
    netReceivedSatang: aggregate.netReceivedSatang,
    channels: aggregate.channels,
    categories: aggregate.categories,
    dailyTrend,
    expense: { state: 'NOT_IMPLEMENTED', clinicExpenseSatang: null, estimatedBalanceSatang: null },
    freshness: aggregate.freshness,
    warnings: aggregate.warnings,
  }
}

function deduplicatedPaymentsForDay(day: FinanceDaySourceSnapshot): JeraNormalizedRow[] {
  const latestBySourceUuid = new Map<string, JeraNormalizedRow>()
  for (const payment of rowsForDay(day.payment.data, day.eventDate, 'PAYMENT')) {
    const current = latestBySourceUuid.get(payment.sourceUuid)
    if (!current || comparePaymentVersions(payment, current) < 0) latestBySourceUuid.set(payment.sourceUuid, payment)
  }
  return [...latestBySourceUuid.values()]
}

function rowsForDay(
  rows: JeraNormalizedRow[],
  eventDate: string,
  reportType: JeraNormalizedRow['reportType'],
): JeraNormalizedRow[] {
  return rows.filter((row) => row.reportType === reportType && row.eventDate === eventDate)
}

function comparePaymentVersions(left: JeraNormalizedRow, right: JeraNormalizedRow): number {
  const latestFirst = versionTimestamp(right) - versionTimestamp(left)
  return latestFirst || left.sourceHash.localeCompare(right.sourceHash)
}

function versionTimestamp(row: JeraNormalizedRow): number {
  const timestamp = Date.parse(row.sourceUpdatedAt ?? row.sourceCreatedAt ?? row.fetchedAt)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function sortPaymentRowsNewestFirst(left: JeraNormalizedRow, right: JeraNormalizedRow): number {
  return right.eventDate.localeCompare(left.eventDate)
    || comparePaymentVersions(left, right)
    || left.sourceUuid.localeCompare(right.sourceUuid)
}

function categoryReadinessFor(days: FinanceDaySourceSnapshot[], enabled: boolean): {
  ready: boolean
  incompleteDates: string[]
  sourceSnapshotMismatch: boolean
  sourceBindingMismatch: boolean
  allocationIncomplete: boolean
} {
  const incompleteDates: string[] = []
  let sourceSnapshotMismatch = false
  let sourceBindingMismatch = false
  let allocationIncomplete = false
  for (const day of days) {
    const coverage = day.allocationCoverage
    const bindingMismatch = !coverage || !coverageMatchesSourceBinding(coverage, day)
    const timestampSkew = !sameSnapshotWithinFifteenMinutes(day.payment.lastSuccessAt, day.productSales.lastSuccessAt)
      || Boolean(coverage && !sameSnapshotWithinFifteenMinutes(coverage.paymentLastSuccessAt, coverage.productSalesLastSuccessAt))
    const incompleteAllocation = !hasCompletePaymentAllocations(day)
    if (coverage?.status !== 'COMPLETE' || bindingMismatch || timestampSkew || incompleteAllocation) incompleteDates.push(day.eventDate)
    if (timestampSkew && coverage?.status === 'COMPLETE') sourceSnapshotMismatch = true
    if (bindingMismatch && coverage?.status === 'COMPLETE') sourceBindingMismatch = true
    if (incompleteAllocation) allocationIncomplete = true
  }
  return { ready: enabled && incompleteDates.length === 0, incompleteDates, sourceSnapshotMismatch, sourceBindingMismatch, allocationIncomplete }
}

function coverageMatchesSourceBinding(
  coverage: NonNullable<FinanceDaySourceSnapshot['allocationCoverage']>,
  day: FinanceDaySourceSnapshot,
): boolean {
  return coverage.paymentCacheKey === day.sourceBinding.paymentCacheKey
    && coverage.productSalesCacheKey === day.sourceBinding.productSalesCacheKey
    && coverage.paymentSetHash === day.sourceBinding.paymentSetHash
    && coverage.paymentRowCount === day.sourceBinding.paymentRowCount
    && coverage.metadataSnapshotHash === day.sourceBinding.metadataSnapshotHash
    && coverage.productSalesRowCount === day.sourceBinding.productSalesRowCount
    && coverage.paymentLastSuccessAt === day.payment.lastSuccessAt
    && coverage.productSalesLastSuccessAt === day.productSales.lastSuccessAt
}

function hasCompletePaymentAllocations(day: FinanceDaySourceSnapshot): boolean {
  const allocationsByPaymentVersion = new Map<string, PaymentRevenueAllocation[]>()
  for (const allocation of day.allocations) {
    const key = allocationKey(allocation.paymentUuid, allocation.paymentSourceHash)
    const matches = allocationsByPaymentVersion.get(key) ?? []
    matches.push(allocation)
    allocationsByPaymentVersion.set(key, matches)
  }
  return deduplicatedPaymentsForDay(day).every((payment) => {
    const matches = allocationsByPaymentVersion.get(allocationKey(payment.sourceUuid, payment.sourceHash)) ?? []
    return matches.length === 1 && partitionsPayment(matches[0]!, payment)
  })
}

function partitionsPayment(allocation: PaymentRevenueAllocation, payment: JeraNormalizedRow): boolean {
  const values = [allocation.serviceSatang, allocation.productSatang, allocation.unclassifiedSatang]
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) return false
  const allocated = values.reduce((total, value) => total + BigInt(value), 0n)
  return allocated === BigInt(money(payment.paidAmountSatang))
}

function sameSnapshotWithinFifteenMinutes(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  const difference = Math.abs(Date.parse(left) - Date.parse(right))
  return Number.isFinite(difference) && difference <= 15 * 60_000
}

function componentFreshness(
  envelopes: Array<JeraCacheEnvelope<unknown>>,
  now: Date,
): FinanceComponentFreshness {
  const lastSuccessAt = latestTimestamp(envelopes.map((envelope) => envelope.lastSuccessAt))
  const stale = envelopes.some((envelope) => envelope.stale || isOlderThan24Hours(envelope.lastSuccessAt, now))
  const warningCode = envelopes.map((envelope) => envelope.warningCode).find((warning): warning is string => warning !== null)
    ?? (stale ? 'COMPONENT_STALE' : null)
  return { lastSuccessAt, stale, warningCode }
}

function coverageFreshness(days: FinanceDaySourceSnapshot[], now: Date): FinanceComponentFreshness {
  const coverages = days.map((day) => day.allocationCoverage)
  const lastSuccessAt = latestTimestamp(coverages.map((coverage) => coverage?.lastSuccessAt ?? null))
  const stale = coverages.some((coverage) => !coverage || isOlderThan24Hours(coverage.lastSuccessAt, now))
  return { lastSuccessAt, stale, warningCode: stale ? 'COMPONENT_STALE' : null }
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value || Number.isNaN(Date.parse(value))) return latest
    return !latest || Date.parse(value) > Date.parse(latest) ? value : latest
  }, null)
}

function isOlderThan24Hours(value: string | null, now: Date): boolean {
  if (!value) return true
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) || now.getTime() - timestamp > 24 * 60 * 60_000
}

function addFreshnessWarning(warnings: Set<string>, component: string, freshness: FinanceComponentFreshness): void {
  if (freshness.stale) warnings.add(`${component}_STALE`)
  if (freshness.warningCode && freshness.warningCode !== 'COMPONENT_STALE') {
    warnings.add(`${component}_${freshness.warningCode}`)
  }
}

function allocationKey(paymentUuid: string, paymentSourceHash: string): string {
  return `${paymentUuid}:${paymentSourceHash}`
}

function money(value: number | null): number {
  return value ?? 0
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + money(value), 0)
}
