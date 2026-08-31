import { describe, expect, it } from 'vitest'
import { bookingMasterMigrationPlan, staffConfigMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS, BOOKING_MASTER_COLUMNS_V1, STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'
import { resolveManagedSheetColumns } from '../src/adapters/googleSheets'

describe('booking staff schema migration', () => {
  it('inserts AE columns immediately after adminIdentityStatus', () => {
    const legacy = BOOKING_MASTER_COLUMNS.filter(
      (column) => !['aeId', 'aeName'].includes(column),
    )
    expect(bookingMasterMigrationPlan([...legacy])).toEqual({
      kind: 'INSERT_AE_COLUMNS',
      afterColumn: 11,
      headers: ['aeId', 'aeName'],
    })
  })

  it('does nothing when the canonical header already exists', () => {
    expect(bookingMasterMigrationPlan([...BOOKING_MASTER_COLUMNS])).toEqual({ kind: 'NONE' })
  })

  it('leaves the exact attribution legacy header to the guarded owner migration', () => {
    expect(bookingMasterMigrationPlan([...BOOKING_MASTER_COLUMNS_V1])).toEqual({ kind: 'NONE' })
  })

  it('lets repository readers and writers use only either exact Booking master schema', () => {
    expect(resolveManagedSheetColumns('BOOKING_MASTER', [...BOOKING_MASTER_COLUMNS_V1]))
      .toEqual(BOOKING_MASTER_COLUMNS_V1)
    expect(resolveManagedSheetColumns('BOOKING_MASTER', [...BOOKING_MASTER_COLUMNS]))
      .toEqual(BOOKING_MASTER_COLUMNS)
    const reordered = [...BOOKING_MASTER_COLUMNS_V1]
    ;[reordered[0], reordered[1]] = [reordered[1], reordered[0]]
    expect(() => resolveManagedSheetColumns('BOOKING_MASTER', reordered)).toThrow('sheet header mismatch')
  })

  it('rejects an unknown header instead of shifting customer data', () => {
    expect(() => bookingMasterMigrationPlan(['caseId', 'unexpected'])).toThrow(
      'unsupported BOOKING_MASTER header',
    )
  })
})

describe('staff config schema migration', () => {
  it('appends profileImageUrl after the original seven staff columns', () => {
    const legacy = ['id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active']
    expect(staffConfigMigrationPlan([...legacy])).toEqual({
      kind: 'APPEND_PROFILE_IMAGE_URL',
      afterColumn: 7,
      header: 'profileImageUrl',
    })
  })

  it('appends canManageStock after a legacy eight-column CONFIG_STAFF header', () => {
    const legacy = [
      'id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active', 'profileImageUrl',
    ]
    expect(staffConfigMigrationPlan([...legacy])).toEqual({
      kind: 'APPEND_CAN_MANAGE_STOCK',
      afterColumn: 8,
      header: 'canManageStock',
    })
  })

  it('appends all finance permissions atomically after the legacy nine-column header', () => {
    const legacy = [
      'id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active',
      'profileImageUrl', 'canManageStock',
    ]

    expect(staffConfigMigrationPlan(legacy)).toEqual({
      kind: 'APPEND_FINANCE_PERMISSIONS',
      afterColumn: 9,
      headers: ['canSubmitExpense', 'canViewFinance', 'canManageExpense'],
    })
  })

  it('does nothing when CONFIG_STAFF already has all twelve canonical columns', () => {
    expect(staffConfigMigrationPlan([...STAFF_CONFIG_COLUMNS])).toEqual({ kind: 'NONE' })
  })

  it.each([
    ['unknown', ['id', 'unexpected']],
    ['reordered', ['name', 'id', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active', 'profileImageUrl', 'canManageStock']],
  ])('rejects an %s CONFIG_STAFF header before migration', (_label, header) => {
    expect(() => staffConfigMigrationPlan(header)).toThrow(
      'unsupported CONFIG_STAFF header',
    )
  })
})
