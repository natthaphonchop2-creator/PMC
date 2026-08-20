export function normalizeThaiPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('66') && digits.length >= 11) digits = `0${digits.slice(2)}`
  if (!/^0\d{8,9}$/.test(digits)) throw new Error('invalid Thai phone')
  return digits
}

export function maskThaiPhone(value: string): string {
  const digits = normalizeThaiPhone(value)
  if (digits.length === 10) return `${digits.slice(0, 3)}-xxx-${digits.slice(-4)}`
  return `${digits.slice(0, 2)}-xxx-${digits.slice(-4)}`
}

export function normalizeCustomerName(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]/gu, '')
  if (!normalized) throw new Error('customer name is required')
  return normalized.toLocaleLowerCase('th-TH')
}
