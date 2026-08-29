import { describe, expect, it } from 'vitest'
import type { PaymentRevenueAllocation } from '../../shared/pmcFinance'
import type { JeraCacheEnvelope, JeraNormalizedRow } from '../../server/jera/contracts'
import {
  buildDailyIncomeProjection,
  buildMonthlyIncomeProjection,
  type BuildDailyIncomeInput,
  type FinanceDaySourceSnapshot,
} from '../../server/jera/financeReports'

describe('finance income projections', () => {
  it('uses PAYMENT as received authority and never adds OPD or PRODUCT_SALES totals', () => {
    const report = buildDailyIncomeProjection(fixture({
      paymentPaidSatang: 100_000, refundSatang: 10_000,
      allocation: { serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000 },
      misleadingProductSalesSatang: 400_000, misleadingOpdSatang: 500_000,
    }))

    expect(report.receivedSatang).toBe(100_000)
    expect(report.netReceivedSatang).toBe(90_000)
    expect(report.categories).toMatchObject({ serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000 })
  })

  it('keeps channel mismatch visible without rewriting received', () => {
    const report = buildDailyIncomeProjection(fixture({ paymentPaidSatang: 100_000, transferSatang: 90_000 }))

    expect(report.receivedSatang).toBe(100_000)
    expect(report.channels.differenceSatang).toBe(10_000)
    expect(report.warnings).toContain('PAYMENT_METHOD_TOTAL_MISMATCH')
  })

  it('hides category money when one selected date lacks complete coverage', () => {
    const report = buildDailyIncomeProjection(twoDayFixture({ incompleteDate: '2026-08-28' }))

    expect(report.categories).toEqual({
      state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null,
      incompleteDates: ['2026-08-28'],
    })
  })

  it('counts only the deterministic latest PAYMENT row for duplicate immutable payment UUIDs', () => {
    const input = fixture({ paymentPaidSatang: 100_000 })
    const original = input.days[0]!.payment.data[0]!
    input.days[0]!.payment.data.push({
      ...original,
      paidAmountSatang: 125_000,
      transferSatang: 125_000,
      sourceUpdatedAt: '2026-08-29T11:00:00.000Z',
      sourceHash: 'b'.repeat(64),
    })

    const report = buildDailyIncomeProjection(input)

    expect(report.receivedSatang).toBe(125_000)
    expect(report.payments).toHaveLength(1)
    expect(report.payments[0]).toMatchObject({ paidAmountSatang: 125_000, serviceSatang: null, productSatang: null, unclassifiedSatang: null })
  })

  it('does not present category money as reconciled when category sources are more than 15 minutes from PAYMENT', () => {
    const input = fixture({ paymentPaidSatang: 100_000 })
    input.days[0]!.allocationCoverage = {
      ...input.days[0]!.allocationCoverage!,
      productSalesLastSuccessAt: '2026-08-29T08:00:00.000Z',
    }

    const report = buildDailyIncomeProjection(input)

    expect(report.categories).toMatchObject({ state: 'CHECKING', serviceSatang: null, incompleteDates: ['2026-08-29'] })
    expect(report.warnings).toContain('CATEGORY_SOURCE_SNAPSHOT_MISMATCH')
  })

  it('aggregates daily projections into an ascending monthly trend without inventing expenses', () => {
    const input = twoDayFixture({ incompleteDate: null })
    const report = buildMonthlyIncomeProjection({ monthKey: '2026-08', ...input })

    expect(report).toMatchObject({
      startDate: '2026-08-28', endDate: '2026-08-29', receivedSatang: 200_000, refundSatang: 0, netReceivedSatang: 200_000,
      expense: { state: 'NOT_IMPLEMENTED', clinicExpenseSatang: null, estimatedBalanceSatang: null },
    })
    expect(report.dailyTrend.map(({ date }) => date)).toEqual(['2026-08-28', '2026-08-29'])
  })
})

interface FixtureOptions {
  date?: string
  paymentPaidSatang?: number
  refundSatang?: number
  transferSatang?: number
  allocation?: Pick<PaymentRevenueAllocation, 'serviceSatang' | 'productSatang' | 'unclassifiedSatang'>
  misleadingProductSalesSatang?: number
  misleadingOpdSatang?: number
}

function fixture(options: FixtureOptions = {}): BuildDailyIncomeInput {
  const date = options.date ?? '2026-08-29'
  const paymentPaidSatang = options.paymentPaidSatang ?? 100_000
  const paymentHash = 'a'.repeat(64)
  const payment = row({
    cacheKey: `PAYMENT:${date}`, reportType: 'PAYMENT', eventDate: date,
    paidAmountSatang: paymentPaidSatang, totalSatang: paymentPaidSatang,
    transferSatang: options.transferSatang ?? paymentPaidSatang, sourceHash: paymentHash,
  })
  const refund = row({
    cacheKey: `REFUND:${date}`, reportType: 'REFUND', eventDate: date,
    sourceUuid: '10000000-0000-4000-8000-000000000099', paidAmountSatang: null, totalSatang: null,
    refundAmountSatang: options.refundSatang ?? 0,
  })
  const productSales = row({
    cacheKey: `PRODUCT_SALES:${date}`, reportType: 'PRODUCT_SALES', eventDate: date,
    sourceUuid: `product-${date}`, paidAmountSatang: options.misleadingProductSalesSatang ?? 0,
    totalSatang: options.misleadingProductSalesSatang ?? 0, itemCode: 'PRD-1', type: 'medicine',
  })
  const misleadingOpd = row({
    cacheKey: `OPD:${date}`, reportType: 'OPD', eventDate: date,
    sourceUuid: `opd-${date}`, paidAmountSatang: options.misleadingOpdSatang ?? 0,
    totalSatang: options.misleadingOpdSatang ?? 0,
  })
  const allocation = options.allocation
    ? [{ paymentUuid: payment.sourceUuid, paymentSourceHash: paymentHash, warningCodes: [], ...options.allocation }]
    : []
  return {
    days: [{
      eventDate: date,
      payment: envelope([payment]), refund: envelope([refund]), productSales: envelope([productSales, misleadingOpd]), allocations: allocation,
      allocationCoverage: {
        status: 'COMPLETE', metadataSnapshotHash: 'm'.repeat(64),
        paymentLastSuccessAt: '2026-08-29T10:00:00.000Z', productSalesLastSuccessAt: '2026-08-29T10:00:00.000Z',
        lastSuccessAt: '2026-08-29T10:00:00.000Z',
      },
    }],
    categoryMoneyEnabled: true,
    now: new Date('2026-08-29T12:00:00.000Z'),
  }
}

function twoDayFixture(input: { incompleteDate: string | null }): BuildDailyIncomeInput {
  const older = fixture({ date: '2026-08-28' })
  const newer = fixture({ date: '2026-08-29' })
  for (const day of [...older.days, ...newer.days]) {
    if (day.eventDate === input.incompleteDate) day.allocationCoverage = { ...day.allocationCoverage!, status: 'INCOMPLETE' }
  }
  return { ...newer, days: [...newer.days, ...older.days] }
}

function envelope(data: JeraNormalizedRow[]): JeraCacheEnvelope<JeraNormalizedRow[]> {
  return {
    data, source: 'CACHE', fetchedAt: '2026-08-29T10:00:00.000Z', lastSuccessAt: '2026-08-29T10:00:00.000Z',
    refreshing: false, stale: false, warningCode: null,
  }
}

function row(patch: Partial<JeraNormalizedRow>): JeraNormalizedRow {
  return {
    cacheKey: 'PAYMENT:synthetic', reportType: 'PAYMENT', sourceUuid: '10000000-0000-4000-8000-000000000001',
    branchUuid: '11111111-2222-4333-8444-555555555555', branchName: 'Synthetic Branch', eventDate: '2026-08-29',
    patientUuid: null, patientCode: 'PAT-1', patientName: 'Synthetic Patient', paymentCode: 'PAY-1', status: 'PAID', type: 'NORMAL',
    totalSatang: 100_000, paidAmountSatang: 100_000, refundAmountSatang: null,
    cashSatang: null, transferSatang: 100_000, creditCardSatang: null, eWalletSatang: null, paymentLinkSatang: null,
    otherPaymentSatang: null, itemCode: null, itemName: null, quantity: null, remainingQuantity: null, remainingValueSatang: null,
    doctorName: null, salespersonName: null, sourceCreatedAt: '2026-08-29T10:00:00.000Z', sourceUpdatedAt: null,
    fetchedAt: '2026-08-29T10:00:00.000Z', sourceHash: 'a'.repeat(64),
    ...patch,
  }
}
