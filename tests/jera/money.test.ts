import { describe, expect, it } from 'vitest'
import { parseThaiMoneyToSatang } from '../../server/jera/money'

describe('JERA money parsing', () => {
  it.each([
    ['550.00', 55_000],
    ['0', 0],
    [400, 40_000],
    ['1.05', 105],
    [0.29, 29],
  ])('parses %p to integer satang', (raw, expected) => {
    expect(parseThaiMoneyToSatang(raw)).toBe(expected)
  })

  it.each([
    '1e3',
    1e21,
    '1.005',
    -1,
    '-0.01',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1,000.00',
    '',
    null,
    undefined,
  ])('rejects unsafe or malformed money %p', (raw) => {
    expect(() => parseThaiMoneyToSatang(raw)).toThrow('JERA_MONEY_INVALID')
  })

  it('rejects totals that cannot remain safe integer satang', () => {
    expect(() => parseThaiMoneyToSatang('90071992547409.92')).toThrow('JERA_MONEY_INVALID')
  })

  it('allows an explicit negative refund adjustment only when requested', () => {
    expect(parseThaiMoneyToSatang('-1.25', { allowNegative: true })).toBe(-125)
  })
})
