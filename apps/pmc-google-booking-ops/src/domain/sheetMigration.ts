import { BOOKING_MASTER_COLUMNS, STAFF_CONFIG_COLUMNS } from '../sheetSchema'

export type BookingMasterMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'INSERT_AE_COLUMNS'; afterColumn: number; headers: ['aeId', 'aeName'] }
  | { kind: 'INSERT_FACEBOOK_NAME_COLUMN'; afterColumn: number; headers: ['facebookName'] }
  | {
      kind: 'INSERT_APPOINTMENT_COLUMNS'
      afterColumn: number
      headers: [
        'queueType',
        'appointmentStatus',
        'appointmentProposedAt',
        'appointmentConfirmedAt',
        'appointmentConfirmedBy',
      ]
    }

const APPOINTMENT_COLUMNS = [
  'queueType',
  'appointmentStatus',
  'appointmentProposedAt',
  'appointmentConfirmedAt',
  'appointmentConfirmedBy',
] as const

export function bookingAppointmentMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  const previous = BOOKING_MASTER_COLUMNS.filter(
    (column) => !APPOINTMENT_COLUMNS.includes(column as typeof APPOINTMENT_COLUMNS[number]),
  )
  if (JSON.stringify(existing) !== JSON.stringify(previous)) return { kind: 'NONE' }
  return {
    kind: 'INSERT_APPOINTMENT_COLUMNS',
    afterColumn: BOOKING_MASTER_COLUMNS.indexOf('aeName') + 1,
    headers: [...APPOINTMENT_COLUMNS],
  }
}

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(BOOKING_MASTER_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const appointmentPlan = bookingAppointmentMigrationPlan(existing)
  if (appointmentPlan.kind !== 'NONE') return appointmentPlan
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
  const withoutAppointmentOrFacebook = BOOKING_MASTER_COLUMNS.filter(
    (column) => ![...APPOINTMENT_COLUMNS, 'facebookName'].includes(column as never),
  )
  if (JSON.stringify(existing) === JSON.stringify(withoutAppointmentOrFacebook)) {
    return {
      kind: 'INSERT_APPOINTMENT_COLUMNS',
      afterColumn: BOOKING_MASTER_COLUMNS.indexOf('aeName') + 1,
      headers: [...APPOINTMENT_COLUMNS],
    }
  }
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
  | { kind: 'APPEND_CAN_MANAGE_STOCK'; afterColumn: number; header: 'canManageStock' }

export function staffProfileMigrationPlan(existing: string[]): StaffProfileMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const legacyWithoutProfile = STAFF_CONFIG_COLUMNS.filter(
    (column) => !['profileImageUrl', 'canManageStock'].includes(column),
  )
  if (JSON.stringify(existing) === JSON.stringify(legacyWithoutProfile)) {
    return {
      kind: 'APPEND_PROFILE_IMAGE_URL',
      afterColumn: legacyWithoutProfile.length,
      header: 'profileImageUrl',
    }
  }
  const legacyWithoutStockRole = STAFF_CONFIG_COLUMNS.filter((column) => column !== 'canManageStock')
  if (JSON.stringify(existing) === JSON.stringify(legacyWithoutStockRole)) {
    return {
      kind: 'APPEND_CAN_MANAGE_STOCK',
      afterColumn: legacyWithoutStockRole.length,
      header: 'canManageStock',
    }
  }
  throw new Error('unsupported CONFIG_STAFF header')
}
