import { describe, expect, it } from 'vitest'
import type { JeraNormalizedRow } from '../../server/jera/contracts'
import {
  buildAppointmentReport,
  buildDepositReport,
  buildPaymentReport,
  buildRefundReport,
  buildTodaySummary,
} from '../../server/jera/reports'

describe('JERA management report projections', () => {
  it('reconciles payment methods and separates normal versus deposit payments', () => {
    const report = buildPaymentReport([
      row({ sourceUuid: uuid(1), paidAmountSatang: 55_000, totalSatang: 55_000, transferSatang: 55_000 }),
      row({ sourceUuid: uuid(2), paymentCode: 'PAY-2', status: 'UNPAID', totalSatang: 10_000, paidAmountSatang: 0 }),
      row({
        sourceUuid: uuid(3), paymentCode: 'PAY-3', type: 'CASH_DEPOSIT', totalSatang: 90_000,
        paidAmountSatang: 90_000, cashSatang: 90_000, doctorName: 'Doctor B', salespersonName: 'Sales B',
      }),
    ])

    expect(report.totals).toMatchObject({
      rowCount: 3, totalSatang: 155_000, paidAmountSatang: 145_000,
      normalPaidSatang: 55_000, depositPaidSatang: 90_000,
      cashSatang: 90_000, transferSatang: 55_000, unpaidCount: 1,
    })
    expect(report.warnings).toEqual([])
    expect(report.breakdowns.byDoctor.map(({ label }) => label)).toEqual(['Doctor B', 'Doctor A'])
    expect(report.dataQuality).toMatchObject({ inputRows: 3, includedRows: 3, paymentMethodMismatchRows: 0 })
  })

  it('flags payment-method disagreement without silently changing the paid total', () => {
    const report = buildPaymentReport([
      row({ paidAmountSatang: 10_000, transferSatang: 9_000 }),
    ])

    expect(report.totals.paidAmountSatang).toBe(10_000)
    expect(report.dataQuality).toMatchObject({ paymentMethodMismatchRows: 1, paymentMethodDifferenceSatang: 1_000 })
    expect(report.warnings).toContain('PAYMENT_METHOD_TOTAL_MISMATCH')
  })

  it('summarizes deposits, refunds, and appointments with stable breakdowns', () => {
    const deposits = buildDepositReport([
      row({ reportType: 'DEPOSIT', sourceUuid: uuid(4), type: 'CASH_DEPOSIT', totalSatang: 90_000, paidAmountSatang: 90_000 }),
      row({ reportType: 'DEPOSIT', sourceUuid: uuid(5), type: 'PRODUCT_DEPOSIT', totalSatang: 50_000, paidAmountSatang: 50_000, refundAmountSatang: 10_000 }),
    ])
    const refunds = buildRefundReport([
      row({ reportType: 'REFUND', sourceUuid: 'refund:' + 'a'.repeat(32), type: 'course', paidAmountSatang: null, refundAmountSatang: 20_000 }),
    ])
    const appointments = buildAppointmentReport([
      row({ reportType: 'APPOINTMENT', sourceUuid: uuid(6), status: 'Confirmed', type: 'Treatment', totalSatang: null, paidAmountSatang: null }),
      row({ reportType: 'APPOINTMENT', sourceUuid: uuid(7), status: 'Waiting', type: 'Consult', totalSatang: null, paidAmountSatang: null }),
      row({ reportType: 'APPOINTMENT', sourceUuid: uuid(8), status: 'Confirmed', type: 'Treatment', totalSatang: null, paidAmountSatang: null }),
    ])

    expect(deposits.totals).toMatchObject({ paidAmountSatang: 140_000, refundAmountSatang: 10_000, netSatang: 130_000 })
    expect(refunds.totals).toMatchObject({ refundAmountSatang: 20_000 })
    expect(appointments.totals).toMatchObject({ appointmentCount: 3 })
    expect(appointments.breakdowns.byStatus).toEqual([
      expect.objectContaining({ label: 'Confirmed', count: 2 }),
      expect.objectContaining({ label: 'Waiting', count: 1 }),
    ])
  })

  it('builds today cash flow without double-counting deposit payment rows', () => {
    const summary = buildTodaySummary({
      payments: [
        row({ paidAmountSatang: 55_000, transferSatang: 55_000 }),
        row({ sourceUuid: uuid(2), type: 'CASH_DEPOSIT', paidAmountSatang: 90_000, cashSatang: 90_000 }),
      ],
      deposits: [row({ reportType: 'DEPOSIT', sourceUuid: uuid(3), type: 'CASH_DEPOSIT', paidAmountSatang: 90_000 })],
      refunds: [row({ reportType: 'REFUND', sourceUuid: 'refund:' + 'b'.repeat(32), paidAmountSatang: null, refundAmountSatang: 10_000 })],
      appointments: [row({ reportType: 'APPOINTMENT', sourceUuid: uuid(4), totalSatang: null, paidAmountSatang: null })],
    })

    expect(summary.totals).toEqual({
      receivedSatang: 55_000, depositSatang: 90_000, refundSatang: 10_000,
      netCashFlowSatang: 135_000, appointmentCount: 1,
    })
  })

  it('rejects mixed report rows instead of hiding them', () => {
    expect(() => buildPaymentReport([row({ reportType: 'REFUND' })])).toThrow('JERA_REPORT_TYPE_MISMATCH')
  })
})

type ReportRow = JeraNormalizedRow & {
  cashSatang: number | null
  transferSatang: number | null
  creditCardSatang: number | null
  eWalletSatang: number | null
  paymentLinkSatang: number | null
  otherPaymentSatang: number | null
}

function row(patch: Partial<ReportRow> = {}): ReportRow {
  return {
    cacheKey: 'PAYMENT:key', reportType: 'PAYMENT', sourceUuid: uuid(1), branchUuid: BRANCH,
    branchName: 'Synthetic Branch', eventDate: '2026-08-27', patientUuid: null, patientCode: 'PAT-1',
    patientName: 'Synthetic Patient', paymentCode: 'PAY-1', status: 'PAID', type: 'normal',
    totalSatang: 55_000, paidAmountSatang: 55_000, refundAmountSatang: null,
    cashSatang: null, transferSatang: null, creditCardSatang: null, eWalletSatang: null,
    paymentLinkSatang: null, otherPaymentSatang: null,
    doctorName: 'Doctor A', salespersonName: 'Sales A', sourceCreatedAt: '2026-08-27T10:00:00+07:00',
    sourceUpdatedAt: null, fetchedAt: '2026-08-27T03:00:00.000Z', sourceHash: 'a'.repeat(64),
    ...patch,
  }
}

const BRANCH = '11111111-2222-4333-8444-555555555555'
function uuid(index: number): string { return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}` }
