import { BOOKING_MASTER_COLUMNS, BOOKING_MASTER_COLUMNS_V1, STAFF_CONFIG_COLUMNS } from '../sheetSchema'

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
  for (const canonical of [BOOKING_MASTER_COLUMNS, BOOKING_MASTER_COLUMNS_V1] as const) {
    const previous = canonical.filter(
      (column) => !APPOINTMENT_COLUMNS.includes(column as typeof APPOINTMENT_COLUMNS[number]),
    )
    if (same(existing, previous)) {
      return {
        kind: 'INSERT_APPOINTMENT_COLUMNS',
        afterColumn: canonical.indexOf('aeName') + 1,
        headers: [...APPOINTMENT_COLUMNS],
      }
    }
  }
  return { kind: 'NONE' }
}

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  if (same(existing, BOOKING_MASTER_COLUMNS) || same(existing, BOOKING_MASTER_COLUMNS_V1)) {
    return { kind: 'NONE' }
  }
  const appointmentPlan = bookingAppointmentMigrationPlan(existing)
  if (appointmentPlan.kind !== 'NONE') return appointmentPlan
  for (const canonical of [BOOKING_MASTER_COLUMNS, BOOKING_MASTER_COLUMNS_V1] as const) {
    const withoutFacebook = canonical.filter((column) => column !== 'facebookName')
    if (same(existing, withoutFacebook)) {
      return {
        kind: 'INSERT_FACEBOOK_NAME_COLUMN',
        afterColumn: canonical.indexOf('customerName') + 1,
        headers: ['facebookName'],
      }
    }
    const withoutAe = canonical.filter((column) => !['aeId', 'aeName'].includes(column))
    const withoutAeOrFacebook = canonical.filter(
      (column) => !['aeId', 'aeName', 'facebookName'].includes(column),
    )
    const withoutAppointmentOrFacebook = canonical.filter(
      (column) => ![...APPOINTMENT_COLUMNS, 'facebookName'].includes(column as never),
    )
    if (same(existing, withoutAppointmentOrFacebook)) {
      return {
        kind: 'INSERT_APPOINTMENT_COLUMNS',
        afterColumn: canonical.indexOf('aeName') + 1,
        headers: [...APPOINTMENT_COLUMNS],
      }
    }
    if (same(existing, withoutAe) || same(existing, withoutAeOrFacebook)) {
      return {
        kind: 'INSERT_AE_COLUMNS',
        afterColumn: canonical.indexOf('adminIdentityStatus') + 1,
        headers: ['aeId', 'aeName'],
      }
    }
  }
  throw new Error('unsupported BOOKING_MASTER header')
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
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
