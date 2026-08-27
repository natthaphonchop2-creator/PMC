export class JeraMoneyError extends Error {
  readonly code = 'JERA_MONEY_INVALID' as const

  constructor() {
    super('JERA_MONEY_INVALID')
    this.name = 'JeraMoneyError'
  }
}

export function parseThaiMoneyToSatang(
  value: unknown,
  options: { allowNegative?: boolean } = {},
): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new JeraMoneyError()
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new JeraMoneyError()
  }

  const raw = typeof value === 'string' ? value.trim() : String(value)
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match || (match[1] === '-' && !options.allowNegative)) throw new JeraMoneyError()

  try {
    const whole = BigInt(match[2]!)
    const fraction = BigInt((match[3] ?? '').padEnd(2, '0') || '0')
    const sign = match[1] === '-' ? -1n : 1n
    const satang = sign * ((whole * 100n) + fraction)
    if (satang > BigInt(Number.MAX_SAFE_INTEGER) || satang < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new JeraMoneyError()
    }
    return Number(satang)
  } catch (error) {
    if (error instanceof JeraMoneyError) throw error
    throw new JeraMoneyError()
  }
}
