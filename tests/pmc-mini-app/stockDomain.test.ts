import { describe, expect, it } from 'vitest'
import {
  aggregateStockBalances,
  formatQuantityMilli,
  normalizeStockProductName,
  parseNonNegativeQuantityToMilli,
  parseQuantityToMilli,
} from '../../shared/pmcStock'

describe('PMC Stock shared domain', () => {
  it.each([
    ['1', 1000],
    ['1.25', 1250],
    ['0.001', 1],
  ])('converts %s to integer milli-units', (input, expected) => {
    expect(parseQuantityToMilli(input)).toBe(expected)
  })

  it('allows an exact zero only for physical-count reconciliation', () => {
    expect(parseNonNegativeQuantityToMilli('0')).toBe(0)
  })

  it('uses one canonical whitespace and case normalization for product names', () => {
    expect(normalizeStockProductName('  ถุงมือ   NITRILE  ')).toBe('ถุงมือ nitrile')
  })

  it.each(['0', '-1', '1.0001', 'NaN', ''])('rejects unsafe quantity %s', (input) => {
    expect(() => parseQuantityToMilli(input)).toThrow('STOCK_INVALID_QUANTITY')
  })

  it('aggregates immutable deltas without floating point drift', () => {
    expect(aggregateStockBalances([
      { productId: 'STK-000001', quantityDeltaMilli: 10_000 },
      { productId: 'STK-000001', quantityDeltaMilli: -1_250 },
      { productId: 'STK-000002', quantityDeltaMilli: 500 },
    ])).toEqual(new Map([['STK-000001', 8_750], ['STK-000002', 500]]))
    expect(formatQuantityMilli(8_750)).toBe('8.75')
  })
})
