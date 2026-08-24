import { BOOKING_MASTER_COLUMNS, STAFF_CONFIG_COLUMNS } from '../sheetSchema'

export type BookingMasterMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'INSERT_AE_COLUMNS'; afterColumn: number; headers: ['aeId', 'aeName'] }
  | { kind: 'INSERT_FACEBOOK_NAME_COLUMN'; afterColumn: number; headers: ['facebookName'] }

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(BOOKING_MASTER_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const withoutFacebook = BOOKING_MASTER_COLUMNS.filter(
    (column) => column !== 'facebookName',
  )
  if (JSON.stringify(existing) === JSON.stringify(withoutFacebook)) {
    return {
      kind: 'INSERT_FACEBOOK_NAME_COLUMN',
      afterColumn: BOOKING_MASTER_COLUMNS.indexOf('customerName') + 1,
      headers: ['facebookName'],
    }
  }
  const withoutAe = BOOKING_MASTER_COLUMNS.filter(
    (column) => !['aeId', 'aeName'].includes(column),
  )
  const withoutAeOrFacebook = BOOKING_MASTER_COLUMNS.filter(
    (column) => !['aeId', 'aeName', 'facebookName'].includes(column),
  )
  if (
    JSON.stringify(existing) === JSON.stringify(withoutAe) ||
    JSON.stringify(existing) === JSON.stringify(withoutAeOrFacebook)
  ) {
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
