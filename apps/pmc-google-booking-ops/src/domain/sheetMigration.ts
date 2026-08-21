import { BOOKING_MASTER_COLUMNS, STAFF_CONFIG_COLUMNS } from '../sheetSchema'

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

export type StaffProfileMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'APPEND_PROFILE_IMAGE_URL'; afterColumn: number; header: 'profileImageUrl' }

export function staffProfileMigrationPlan(existing: string[]): StaffProfileMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const legacy = STAFF_CONFIG_COLUMNS.filter((column) => column !== 'profileImageUrl')
  if (JSON.stringify(existing) === JSON.stringify(legacy)) {
    return {
      kind: 'APPEND_PROFILE_IMAGE_URL',
      afterColumn: legacy.length,
      header: 'profileImageUrl',
    }
  }
  throw new Error('unsupported CONFIG_STAFF header')
}
