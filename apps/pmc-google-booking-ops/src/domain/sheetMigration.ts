import { BOOKING_MASTER_COLUMNS } from '../sheetSchema'

export type BookingMasterMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'INSERT_AE_COLUMNS'; afterColumn: number; headers: ['aeId', 'aeName'] }

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(BOOKING_MASTER_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const legacy = BOOKING_MASTER_COLUMNS.filter(
    (column) => !['aeId', 'aeName'].includes(column),
  )
  if (JSON.stringify(existing) === JSON.stringify(legacy)) {
    return { kind: 'INSERT_AE_COLUMNS', afterColumn: 8, headers: ['aeId', 'aeName'] }
  }
  throw new Error('unsupported BOOKING_MASTER header')
}
