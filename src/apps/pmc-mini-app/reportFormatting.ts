export function formatBaht(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return '—'
  if (!Number.isSafeInteger(satang)) return '—'
  return formatSatang(satang, false)
}

export function formatBahtFixed(satang: number | null | undefined): string {
  if (satang === null || satang === undefined || !Number.isSafeInteger(satang)) return '—'
  return formatSatang(satang, true)
}

function formatSatang(value: number, fixed: boolean): string {
  const signed = BigInt(value)
  const negative = signed < 0n
  const absolute = negative ? -signed : signed
  const whole = absolute / 100n
  const remainder = Number(absolute % 100n)
  const fraction = fixed
    ? `.${String(remainder).padStart(2, '0')}`
    : remainder === 0
      ? ''
      : remainder % 10 === 0
        ? `.${remainder / 10}`
        : `.${String(remainder).padStart(2, '0')}`
  return `${negative ? '-' : ''}${new Intl.NumberFormat('th-TH').format(whole)}${fraction} บาท`
}
