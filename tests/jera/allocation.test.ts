import { describe, expect, it } from 'vitest'
import { allocatePaymentRevenue, buildItemTypeMetadata } from '../../server/jera/allocation'

describe('payment-level revenue allocation', () => {
  it('uses deterministic largest remainders and preserves every satang', () => {
    const allocation = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000001',
      paymentSourceHash: 'a'.repeat(64),
      paidAmountSatang: 10_001,
      paymentType: 'NORMAL',
      detail: {
        truncated: false,
        lines: [
          { kind: 'OPD', itemCode: 'SVC-1', netLineSatang: 2 },
          { kind: 'OPD', itemCode: 'PRD-1', netLineSatang: 1 },
        ],
      },
      metadata: buildItemTypeMetadata([
        { itemCode: 'SVC-1', type: 'service', sourceHash: 'b'.repeat(64) },
        { itemCode: 'PRD-1', type: 'medicine', sourceHash: 'c'.repeat(64) },
      ]),
    })

    expect(allocation).toMatchObject({ serviceSatang: 6_667, productSatang: 3_334, unclassifiedSatang: 0 })
    expect(allocation.serviceSatang + allocation.productSatang + allocation.unclassifiedSatang).toBe(10_001)
  })

  it.each(['CASH_DEPOSIT', 'PRODUCT_DEPOSIT'])('allocates %s entirely to unclassified', (paymentType) => {
    const result = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000002', paymentSourceHash: 'd'.repeat(64),
      paidAmountSatang: 90_000, paymentType, detail: null,
      metadata: buildItemTypeMetadata([]),
    })
    expect(result).toMatchObject({ serviceSatang: 0, productSatang: 0, unclassifiedSatang: 90_000 })
  })

  it('marks conflicting item types and missing detail as unclassified without changing paid amount', () => {
    const metadata = buildItemTypeMetadata([
      { itemCode: 'X-1', type: 'service', sourceHash: 'e'.repeat(64) },
      { itemCode: 'X-1', type: 'medicine', sourceHash: 'f'.repeat(64) },
    ])
    const result = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000003', paymentSourceHash: '1'.repeat(64),
      paidAmountSatang: 25_000, paymentType: 'NORMAL', detail: null, metadata,
    })
    expect(metadata.ambiguousItemCodes).toEqual(['X-1'])
    expect(result.unclassifiedSatang).toBe(25_000)
  })

  it('hashes normalized non-ambiguous metadata independently of source row order', () => {
    const first = buildItemTypeMetadata([
      { itemCode: 'PRD-1', type: 'product', sourceHash: '1'.repeat(64) },
      { itemCode: 'SVC-1', type: 'course', sourceHash: '2'.repeat(64) },
    ])
    const second = buildItemTypeMetadata([
      { itemCode: 'SVC-1', type: 'COURSE', sourceHash: '3'.repeat(64) },
      { itemCode: 'PRD-1', type: 'MEDICINE', sourceHash: '4'.repeat(64) },
    ])

    expect(first.byItemCode.get('PRD-1')).toBe('PRODUCT')
    expect(first.byItemCode.get('SVC-1')).toBe('SERVICE')
    expect(first.snapshotHash).toBe(second.snapshotHash)
  })

  it('fails closed for truncated and zero-weight details', () => {
    const metadata = buildItemTypeMetadata([])
    const truncated = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000004', paymentSourceHash: '2'.repeat(64),
      paidAmountSatang: 125, paymentType: 'NORMAL', metadata,
      detail: { truncated: true, lines: [{ kind: 'COURSE', itemCode: null, netLineSatang: 125 }] },
    })
    const zeroWeight = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000005', paymentSourceHash: '3'.repeat(64),
      paidAmountSatang: 125, paymentType: 'NORMAL', metadata,
      detail: { truncated: false, lines: [{ kind: 'OPD', itemCode: null, netLineSatang: 0 }] },
    })

    expect(truncated).toMatchObject({ unclassifiedSatang: 125, warningCodes: ['DETAIL_TRUNCATED'] })
    expect(zeroWeight).toMatchObject({ unclassifiedSatang: 125, warningCodes: ['ZERO_ALLOCATION_WEIGHT'] })
  })

  it('rejects unsafe allocation money', () => {
    expect(() => allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000006', paymentSourceHash: '4'.repeat(64),
      paidAmountSatang: -1, paymentType: 'NORMAL', detail: null, metadata: buildItemTypeMetadata([]),
    })).toThrow('JERA_ALLOCATION_INVALID_MONEY')
  })
})
