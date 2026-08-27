export function formatBaht(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return '—'
  if (!Number.isSafeInteger(satang)) return '—'
  const baht = satang / 100
  return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(baht)} บาท`
}
