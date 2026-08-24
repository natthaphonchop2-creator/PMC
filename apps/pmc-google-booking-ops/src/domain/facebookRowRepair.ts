import { BOOKING_MASTER_COLUMNS } from '../sheetSchema'

type CellValue = string | number | boolean | Date | null

export function repairShiftedFacebookBookingRow(
  headers: string[],
  row: CellValue[],
  facebookNameInput: string,
  authoritativeValues: Record<string, CellValue> = {},
): CellValue[] {
  if (JSON.stringify(headers) !== JSON.stringify(BOOKING_MASTER_COLUMNS)) {
    throw new Error('BOOKING_MASTER header mismatch')
  }
  if (row.length !== headers.length) throw new Error('booking row width mismatch')

  const facebookName = facebookNameInput.trim()
  if (!facebookName) throw new Error('Facebook name is required for repair')
  const facebookIndex = headers.indexOf('facebookName')
  if (String(row[facebookIndex] ?? '').trim() === facebookName) {
    throw new Error('booking row is not Facebook-shifted')
  }

  const repaired = [...row]
  for (let index = repaired.length - 1; index > facebookIndex; index -= 1) {
    repaired[index] = row[index - 1]
  }
  repaired[facebookIndex] = facebookName
  for (const [field, value] of Object.entries(authoritativeValues)) {
    const fieldIndex = headers.indexOf(field)
    if (fieldIndex === -1) throw new Error(`unknown repair field: ${field}`)
    repaired[fieldIndex] = value
  }
  return repaired
}
