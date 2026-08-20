import { describe, expect, it } from 'vitest'
import { bookingMasterMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS } from '../src/sheetSchema'

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
