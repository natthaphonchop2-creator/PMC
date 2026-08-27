import { describe, expect, it } from 'vitest'
import { filterHash, jeraCacheKey } from '../../server/jera/cacheKey'

describe('canonical JERA cache keys', () => {
  it('produces the same key regardless of filter property order', () => {
    expect(jeraCacheKey('PAYMENT', {
      branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27',
    })).toBe(jeraCacheKey('PAYMENT', {
      endDate: '2026-08-27', branchUuid: BRANCH, startDate: '2026-08-01',
    }))
  })

  it('omits undefined values and canonicalizes set-like course filters', () => {
    expect(filterHash({
      branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27', courseType: ['B', 'A'], status: undefined,
    })).toBe(filterHash({
      branchUuid: BRANCH.toUpperCase(), startDate: '2026-08-01', endDate: '2026-08-27', courseType: ['A', 'B'],
    }))
  })

  it('does not expose patient or payment identifiers in the cache key', () => {
    const patientUuid = '22222222-3333-4444-8555-666666666666'
    const key = jeraCacheKey('APPOINTMENT', {
      branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27', patientUuid,
    })

    expect(key).toMatch(/^APPOINTMENT:[a-f0-9]{64}$/)
    expect(key).not.toContain(patientUuid)
  })

  it('changes when a meaningful filter changes', () => {
    expect(jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27' }))
      .not.toBe(jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: '2026-08-02', endDate: '2026-08-27' }))
  })
})

const BRANCH = '11111111-2222-4333-8444-555555555555'
