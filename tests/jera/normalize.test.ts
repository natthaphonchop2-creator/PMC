import { describe, expect, it } from 'vitest'
import appointmentFixture from './fixtures/appointment-list.json'
import depositFixture from './fixtures/deposit-report.json'
import paymentDetailFixture from './fixtures/payment-detail.json'
import paymentListFixture from './fixtures/payment-list.json'
import paymentFixture from './fixtures/payment-report.json'
import refundFixture from './fixtures/refund-report.json'
import {
  normalizeAppointmentList,
  normalizeDepositReport,
  normalizePaymentDetail,
  normalizePaymentList,
  normalizePaymentReport,
  normalizeRefundReport,
} from '../../server/jera/normalize'

const context = {
  cacheKey: 'PAYMENT:synthetic-filter-hash',
  branchUuid: '11111111-2222-4333-8444-555555555555',
  fetchedAt: '2026-08-27T10:00:00.000Z',
}

describe('JERA endpoint normalization', () => {
  it('normalizes payment records using integer satang and explicit fields only', () => {
    const [row] = normalizePaymentReport(paymentFixture, context)

    expect(row).toEqual(expect.objectContaining({
      reportType: 'PAYMENT',
      sourceUuid: '10000000-0000-4000-8000-000000000001',
      paymentCode: 'PAY-SYN-0001',
      eventDate: '2026-08-27',
      totalSatang: 125_050,
      paidAmountSatang: 90_000,
      transferSatang: 90_000,
      cashSatang: 0,
      otherPaymentSatang: 0,
      doctorName: 'Doctor Synthetic',
      salespersonName: 'Sales Synthetic',
      sourceCreatedAt: '2026-08-27T10:15:30+07:00',
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(row).not.toHaveProperty('remark')
    expect(row).not.toHaveProperty('summary_data')
  })

  it('normalizes both cash and product deposits without losing their type', () => {
    const rows = normalizeDepositReport(depositFixture, { ...context, cacheKey: 'DEPOSIT:key' })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.type)).toEqual(['CASH_DEPOSIT', 'PRODUCT_DEPOSIT'])
    expect(rows.map((row) => row.paidAmountSatang)).toEqual([90_000, 50_000])
    expect(rows[1]?.refundAmountSatang).toBe(10_000)
  })

  it('normalizes deposit rows after the read client preserves their documented source kinds', () => {
    const rows = normalizeDepositReport([
      { __jeraDepositType: 'CASH_DEPOSIT', data: depositFixture.cash_deposits[0] },
      { __jeraDepositType: 'PRODUCT_DEPOSIT', data: depositFixture.product_deposits[0] },
    ], { ...context, cacheKey: 'DEPOSIT:key' })

    expect(rows.map((row) => row.type)).toEqual(['CASH_DEPOSIT', 'PRODUCT_DEPOSIT'])
  })

  it('treats HTML-looking patient names as plain text data', () => {
    const [row] = normalizeRefundReport(refundFixture, { ...context, cacheKey: 'REFUND:key' })

    expect(row?.patientName).toBe('<img src=x onerror=alert(1)> Ray')
    expect(row?.refundAmountSatang).toBe(10_000)
    expect(row?.sourceUuid).toMatch(/^refund:[a-f0-9]{32}$/)
  })

  it('normalizes appointment dates without shifting the Bangkok calendar day', () => {
    const [row] = normalizeAppointmentList(appointmentFixture, { ...context, cacheKey: 'APPOINTMENT:key' })

    expect(row).toEqual(expect.objectContaining({
      reportType: 'APPOINTMENT',
      eventDate: '2026-08-28',
      branchName: 'Synthetic Branch',
      status: 'Confirmed',
      type: 'Treatment',
      doctorName: 'Doctor Synthetic',
      sourceCreatedAt: '2026-08-27T00:00:00.000Z',
      sourceUpdatedAt: '2026-08-27T00:30:00.000Z',
    }))
  })

  it('normalizes payment-list rows and derives an explicit payment status', () => {
    const [row] = normalizePaymentList(paymentListFixture, { ...context, cacheKey: 'PAYMENT_LIST:key' })

    expect(row).toEqual(expect.objectContaining({
      reportType: 'PAYMENT_LIST',
      paymentCode: 'PAY-SYN-0003',
      status: 'PAID',
      totalSatang: 150_000,
      paidAmountSatang: 150_000,
    }))
  })

  it('normalizes payment detail into a bounded explicit drill-down object', () => {
    const detail = normalizePaymentDetail(paymentDetailFixture, context)

    expect(detail).toEqual(expect.objectContaining({
      sourceUuid: '60000000-0000-4000-8000-000000000001',
      paymentCode: 'PAY-SYN-0004',
      totalSatang: 200_000,
      paidAmountSatang: 180_000,
      patient: expect.objectContaining({
        sourceUuid: '20000000-0000-4000-8000-000000000007',
        patientCode: 'PAT-SYN-0007',
        displayName: 'Synthetic Patient Seven',
      }),
      paymentMethods: [{ method: 'Transfer', amountSatang: 180_000 }],
      salespersons: [{ name: 'Sales Synthetic', feeSatang: 6_000, feeUnit: 'THB' }],
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      truncated: false,
    }))
    expect(JSON.stringify(detail)).not.toContain('citizen_id')
    expect(JSON.stringify(detail)).not.toContain('provider_secret')
    expect(detail.opds[0]?.items[0]).toEqual({
      code: 'ITEM-SYN-01', name: 'Synthetic Service', action: 'service',
      priceSatang: 200_000, discountSatang: 20_000, quantity: 1,
    })
  })

  it('produces a stable source hash and changes it when normalized money changes', () => {
    const original = normalizePaymentReport(paymentFixture, context)[0]!
    const changed = structuredClone(paymentFixture)
    changed.payment_data[0]!.paid_amount = '901.00'

    expect(normalizePaymentReport(paymentFixture, context)[0]!.sourceHash).toBe(original.sourceHash)
    expect(normalizePaymentReport(changed, context)[0]!.sourceHash).not.toBe(original.sourceHash)
  })

  it.each([
    ['missing payment UUID', () => normalizePaymentReport({ payment_data: [{ code: 'PAY-1', create_date: '2026-08-27 10:00:00', total: '1.00', paid_amount: '1.00' }] }, context)],
    ['invalid event date', () => normalizeAppointmentList({ data: [{ uuid: '40000000-0000-4000-8000-000000000001', appoint_date: '27/08/2026' }] }, context)],
    ['invalid money', () => normalizeRefundReport([{ payment_code: 'PAY-1', patient_code: 'PAT-1', refund_date: '2026-08-27 10:00:00', total_refund_cost: '1.001' }], context)],
  ])('fails closed for %s', (_name, run) => {
    expect(run).toThrow('JERA_SCHEMA_INVALID')
  })
})
