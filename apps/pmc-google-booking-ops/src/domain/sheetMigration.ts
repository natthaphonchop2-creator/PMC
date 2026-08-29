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

export type StaffConfigMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'APPEND_PROFILE_IMAGE_URL'; afterColumn: number; header: 'profileImageUrl' }
  | { kind: 'APPEND_CAN_MANAGE_STOCK'; afterColumn: number; header: 'canManageStock' }
  | {
      kind: 'APPEND_FINANCE_PERMISSIONS'
      afterColumn: number
      headers: ['canSubmitExpense', 'canViewFinance', 'canManageExpense']
    }

export function staffConfigMigrationPlan(existing: string[]): StaffConfigMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    return { kind: 'NONE' }
  }
  const legacyWithoutProfile = STAFF_CONFIG_COLUMNS.slice(0, 7)
  if (JSON.stringify(existing) === JSON.stringify(legacyWithoutProfile)) {
    return {
      kind: 'APPEND_PROFILE_IMAGE_URL',
      afterColumn: legacyWithoutProfile.length,
      header: 'profileImageUrl',
    }
  }
  const legacyWithoutStockRole = STAFF_CONFIG_COLUMNS.slice(0, 8)
  if (JSON.stringify(existing) === JSON.stringify(legacyWithoutStockRole)) {
    return {
      kind: 'APPEND_CAN_MANAGE_STOCK',
      afterColumn: legacyWithoutStockRole.length,
      header: 'canManageStock',
    }
  }
  const legacyWithoutFinancePermissions = STAFF_CONFIG_COLUMNS.slice(0, 9)
  if (JSON.stringify(existing) === JSON.stringify(legacyWithoutFinancePermissions)) {
    return {
      kind: 'APPEND_FINANCE_PERMISSIONS',
      afterColumn: legacyWithoutFinancePermissions.length,
      headers: ['canSubmitExpense', 'canViewFinance', 'canManageExpense'],
    }
  }
  throw new Error('unsupported CONFIG_STAFF header')
}
