import { describe, expect, it } from 'vitest'
import { bookingMasterMigrationPlan, staffProfileMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS, STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'

describe('booking staff schema migration', () => {
  it('inserts AE columns immediately after adminIdentityStatus', () => {
    const legacy = BOOKING_MASTER_COLUMNS.filter(
      (column) => !['aeId', 'aeName'].includes(column),
    )
    expect(bookingMasterMigrationPlan([...legacy])).toEqual({
      kind: 'INSERT_AE_COLUMNS',
      afterColumn: 8,
      headers: ['aeId', 'aeName'],
    })
  })

  it('does nothing when the canonical header already exists', () => {
    expect(bookingMasterMigrationPlan([...BOOKING_MASTER_COLUMNS])).toEqual({ kind: 'NONE' })
  })

  it('rejects an unknown header instead of shifting customer data', () => {
    expect(() => bookingMasterMigrationPlan(['caseId', 'unexpected'])).toThrow(
      'unsupported BOOKING_MASTER header',
    )
  })
})

describe('staff profile schema migration', () => {
  it('appends profileImageUrl after the original seven staff columns', () => {
    const legacy = STAFF_CONFIG_COLUMNS.filter((column) => !['profileImageUrl', 'canManageStock'].includes(column))
    expect(staffProfileMigrationPlan([...legacy])).toEqual({
      kind: 'APPEND_PROFILE_IMAGE_URL',
      afterColumn: 7,
      header: 'profileImageUrl',
    })
  })

  it('appends canManageStock after a legacy eight-column CONFIG_STAFF header', () => {
    const legacy = STAFF_CONFIG_COLUMNS.filter((column) => column !== 'canManageStock')
    expect(staffProfileMigrationPlan([...legacy])).toEqual({
      kind: 'APPEND_CAN_MANAGE_STOCK',
      afterColumn: 8,
      header: 'canManageStock',
    })
  })

  it('does nothing when CONFIG_STAFF already has the profile column', () => {
    expect(staffProfileMigrationPlan([...STAFF_CONFIG_COLUMNS])).toEqual({ kind: 'NONE' })
  })

  it('rejects an unknown CONFIG_STAFF header', () => {
    expect(() => staffProfileMigrationPlan(['id', 'unexpected'])).toThrow(
      'unsupported CONFIG_STAFF header',
    )
  })
})
