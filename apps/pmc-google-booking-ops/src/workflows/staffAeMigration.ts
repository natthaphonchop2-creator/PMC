import type { SheetRow } from '../repositories'

function enabled(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

export function seedStaffRowsFromLegacy(rows: SheetRow[]): SheetRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: '',
    lineUserId: String(row.lineUserId ?? ''),
    canCloseBooking: true,
    canBeAe: true,
    active: enabled(row.active),
  }))
}
