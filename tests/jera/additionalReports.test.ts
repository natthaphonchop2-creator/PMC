import { describe, expect, it } from 'vitest'
import fixture from './fixtures/additional-reports.json'
import type { JeraNormalizationContext, JeraNormalizedRow, JeraSourceReportType } from '../../server/jera/contracts'
import {
  normalizeCancelledPaymentReport,
  normalizeCancelledUnpaidReport,
  normalizeCourseSalesReport,
  normalizeOpdReport,
  normalizeProductSalesReport,
  normalizeProductUseReport,
  normalizeRemainingCourseByDateReport,
  normalizeRemainingCourseReport,
} from '../../server/jera/normalize'
import { buildAdditionalReport, listAvailableReports } from '../../server/jera/reports'

const TYPES = [
  'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
  'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE', 'REMAINING_COURSE_BY_DATE',
] as const

const normalizers: Record<(typeof TYPES)[number], (payload: unknown, context: JeraNormalizationContext) => JeraNormalizedRow[]> = {
  PRODUCT_USE: normalizeProductUseReport,
  PRODUCT_SALES: normalizeProductSalesReport,
  CANCELLED_PAYMENT: normalizeCancelledPaymentReport,
  OPD: normalizeOpdReport,
  CANCELLED_UNPAID: normalizeCancelledUnpaidReport,
  COURSE_SALES: normalizeCourseSalesReport,
  REMAINING_COURSE: normalizeRemainingCourseReport,
  REMAINING_COURSE_BY_DATE: normalizeRemainingCourseByDateReport,
}

describe('JERA additional reports', () => {
  it('exposes every approved report with the exact documented filters and no mutation', () => {
    const reports = listAvailableReports()
    expect(reports.map(({ type }) => type)).toEqual(TYPES)
    expect(reports.find(({ type }) => type === 'PRODUCT_USE')?.filters).toEqual(['branchUuid', 'startDate', 'endDate', 'type'])
    expect(reports.find(({ type }) => type === 'REMAINING_COURSE_BY_DATE')?.filters).toContain('selectDate')
    expect(JSON.stringify(reports)).not.toMatch(/POST|PATCH|PUT|DELETE/)
  })

  it.each(TYPES)('normalizes valid and optional-null %s rows', (type) => {
    const normalize = normalizers[type]
    const valid = normalize(payload(type, 0), context(type))[0]
    const optional = normalize(payload(type, 1), context(type))[0]

    expect(valid).toEqual(expect.objectContaining({
      reportType: type, sourceUuid: expect.any(String), eventDate: expect.stringMatching(/^2026-/),
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(optional?.reportType).toBe(type)
  })

  it.each(TYPES)('fails closed for malformed %s provider rows', (type) => {
    expect(() => normalizers[type](payload(type, 2), context(type))).toThrow('JERA_SCHEMA_INVALID')
  })

  it.each(TYPES)('keeps HTML-looking %s strings as inert text values', (type) => {
    const [row] = normalizers[type](payload(type, 3), context(type))
    expect(JSON.stringify(row)).toContain('<b onclick=alert(1)>')
    expect(JSON.stringify(row)).toContain('</b>')
  })

  it('projects quantities and remaining value without exposing provider objects', () => {
    const productRows = normalizeProductUseReport(payload('PRODUCT_USE', 0), context('PRODUCT_USE'))
    const remainingRows = normalizeRemainingCourseReport(payload('REMAINING_COURSE', 0), context('REMAINING_COURSE'))

    expect(buildAdditionalReport('PRODUCT_USE', productRows).totals).toMatchObject({ quantity: 2, paidAmountSatang: 20_000 })
    expect(buildAdditionalReport('REMAINING_COURSE', remainingRows).totals).toMatchObject({
      remainingQuantity: 3, remainingValueSatang: 300_000,
    })
  })
})

function payload(type: (typeof TYPES)[number], index: number): unknown {
  const row = structuredClone(fixture[type][index])
  return type === 'PRODUCT_SALES' ? { data: [row], summary: {} } : [row]
}

function context(type: JeraSourceReportType): JeraNormalizationContext {
  return {
    cacheKey: `${type}:` + 'a'.repeat(64), branchUuid: '11111111-2222-4333-8444-555555555555',
    startDate: '2026-08-01', endDate: '2026-08-27', fetchedAt: '2026-08-27T10:00:00.000Z',
  }
}
