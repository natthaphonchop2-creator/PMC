import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  JERA_ALLOCATION_COVERAGE_HEADERS,
  JERA_PAYMENT_DETAIL_CACHE_HEADERS,
  JERA_PAYMENT_DETAIL_LINES_HEADERS,
} from '../../server/pmc-mini-app/setup'
import {
  createGoogleJeraAllocationStore,
  jeraAllocationDayKey,
  jeraPaymentDetailKey,
  type JeraAllocationCoverage,
  type JeraCachedPaymentDetail,
} from '../../server/jera/allocationStore'
import { jeraCacheKey } from '../../server/jera/cacheKey'

const BRANCH = '11111111-2222-4333-8444-555555555555'
const PAYMENT = '10000000-0000-4000-8000-000000000001'
const DATE = '2026-08-29'
const PAYMENT_HASH = 'a'.repeat(64)

describe('Google Sheets JERA allocation store', () => {
  it('replaces a detail atomically as a header plus ordered allocation-only lines', async () => {
    const sheets = fixture()
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    const detail = paymentDetail()

    await store.replacePaymentDetail(detail)

    expect(sheets.batchWrites).toHaveLength(1)
    expect(await store.readDay({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p') })).toEqual({
      coverage: null,
      details: [detail],
    })
    expect(sheets.serialized()).not.toMatch(/patient|facebook|mobile|salesperson/i)
  })

  it('accepts an empty successful detail and does not duplicate an identical write', async () => {
    const sheets = fixture()
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    const detail = paymentDetail({ lineCount: 0, lines: [] })

    await store.replacePaymentDetail(detail)
    const writes = sheets.batchWrites.length
    await store.replacePaymentDetail(detail)

    expect((await store.readDay({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p') })).details).toEqual([detail])
    expect(sheets.batchWrites).toHaveLength(writes)
  })

  it('rejects inconsistent or unsafe detail rows', async () => {
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets: fixture() })
    const detail = paymentDetail()

    await expect(store.replacePaymentDetail({ ...detail, lineCount: 1 })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.replacePaymentDetail({ ...detail, lines: [{ ...detail.lines[0]!, netLineSatang: -1 }] })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.replacePaymentDetail({ ...detail, paymentSourceHash: 'bad' })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.replacePaymentDetail({ ...detail, lines: [detail.lines[0]!, { ...detail.lines[0]! }] })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.replacePaymentDetail({ ...detail, eventDate: '2026-08-30' })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
  })

  it('uses SHA-256 of branch, day, payment, and PAYMENT source hash as the detail identity', () => {
    expect(jeraPaymentDetailKey(BRANCH, DATE, PAYMENT, PAYMENT_HASH)).toBe(createHash('sha256')
      .update(JSON.stringify([BRANCH, DATE, PAYMENT, PAYMENT_HASH])).digest('hex'))
  })

  it('replaces an obsolete PAYMENT version with its new detail identity', async () => {
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets: fixture() })
    await store.replacePaymentDetail(paymentDetail())
    const next = paymentDetail({ paymentSourceHash: hash('b'), detailKey: jeraPaymentDetailKey(BRANCH, DATE, PAYMENT, hash('b')) })
    await store.replacePaymentDetail(next)

    expect((await store.readDay({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p') })).details).toEqual([next])
  })

  it('persists coverage cursor and counts across recreation', async () => {
    const sheets = fixture()
    const first = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    const coverage = coverageRow({ cursor: 7, paymentRowCount: 9, successfulDetailCount: 7 })
    await first.saveCoverage(coverage)

    const second = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    expect(await second.getCoverage(coverage.dayKey)).toMatchObject({ cursor: 7, paymentRowCount: 9, successfulDetailCount: 7 })
  })

  it('returns at most twenty oldest incomplete coverage rows', async () => {
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets: fixture() })
    for (let index = 0; index < 22; index += 1) {
      const eventDate = `2026-08-${String(index + 1).padStart(2, '0')}`
      await store.saveCoverage(coverageRow({
        eventDate, dayKey: jeraAllocationDayKey(BRANCH, eventDate),
        paymentCacheKey: jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: eventDate, endDate: eventDate }),
        productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', { branchUuid: BRANCH, startDate: eventDate, endDate: eventDate }),
        lastAttemptAt: `${eventDate}T10:00:00.000Z`,
      }))
    }
    await store.saveCoverage(coverageRow({
      dayKey: jeraAllocationDayKey(BRANCH, '2026-08-31'), eventDate: '2026-08-31', status: 'COMPLETE',
      paymentCacheKey: jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: '2026-08-31', endDate: '2026-08-31' }),
      productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', { branchUuid: BRANCH, startDate: '2026-08-31', endDate: '2026-08-31' }),
    }))

    const rows = await store.listIncompleteCoverage(99)
    expect(rows).toHaveLength(20)
    expect(rows.map((row) => row.lastAttemptAt)).toEqual([...rows.map((row) => row.lastAttemptAt)].sort())
  })

  it('accepts only canonical exact-day source cache keys for coverage', async () => {
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets: fixture() })
    const coverage = coverageRow()
    await expect(store.saveCoverage({ ...coverage, paymentCacheKey: 'PAYMENT:anything' })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.saveCoverage({ ...coverage, productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', {
      branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-31',
    }) })).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
    await expect(store.saveCoverage(coverage)).resolves.toBeUndefined()
  })

  it('reads all allocation tables in one snapshot and rejects torn line corruption', async () => {
    const sheets = fixture()
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    await store.replacePaymentDetail(paymentDetail())
    sheets.batchGets.length = 0
    await expect(store.readDay({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p') })).resolves.toMatchObject({ details: [paymentDetail()] })
    expect(sheets.batchGets).toEqual([["'JERA_PAYMENT_DETAIL_CACHE'!A1:I", "'JERA_PAYMENT_DETAIL_LINES'!A1:E", "'JERA_ALLOCATION_COVERAGE'!A1:R"]])
    const lines = sheets.tab('JERA_PAYMENT_DETAIL_LINES')
    lines[2]![1] = 3
    sheets.setTab('JERA_PAYMENT_DETAIL_LINES', lines)
    await expect(store.readDay({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p') })).rejects.toThrow('JERA_ALLOCATION_STORE_CORRUPT_ROW')
  })

  it('reads up to 31 exact days through one allocation snapshot and matches both source hashes', async () => {
    const sheets = fixture()
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    await store.replacePaymentDetail(paymentDetail())
    await store.saveCoverage(coverageRow())
    sheets.batchGets.length = 0

    const result = await store.readDays([
      { branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p'), metadataSnapshotHash: hash('m') },
      { branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p'), metadataSnapshotHash: hash('changed-metadata') },
    ])

    expect(sheets.batchGets).toHaveLength(1)
    expect(result[0]).toMatchObject({ coverage: coverageRow(), details: [paymentDetail()] })
    expect(result[1]).toMatchObject({ coverage: null, details: [paymentDetail()] })
    await expect(store.readDays(Array.from({ length: 32 }, () => ({
      branchUuid: BRANCH, eventDate: DATE, paymentSetHash: hash('p'), metadataSnapshotHash: hash('m'),
    })))).rejects.toThrow('JERA_ALLOCATION_STORE_INVALID_INPUT')
  })

  it('reuses line slots for changed detail versions without growing the used line range', async () => {
    const sheets = fixture()
    const store = createGoogleJeraAllocationStore({ spreadsheetId: 'sheet-1', sheets })
    await store.replacePaymentDetail(paymentDetail())
    const firstUsed = sheets.usedRows('JERA_PAYMENT_DETAIL_LINES')
    const next = paymentDetail({ paymentSourceHash: hash('b'), detailKey: jeraPaymentDetailKey(BRANCH, DATE, PAYMENT, hash('b')) })
    await store.replacePaymentDetail(next)
    await store.replacePaymentDetail({ ...next, paymentSourceHash: hash('c'), detailKey: jeraPaymentDetailKey(BRANCH, DATE, PAYMENT, hash('c')) })

    expect(sheets.usedRows('JERA_PAYMENT_DETAIL_LINES')).toBe(firstUsed)
  })
})

function paymentDetail(patch: Partial<JeraCachedPaymentDetail> = {}): JeraCachedPaymentDetail {
  return {
    detailKey: jeraPaymentDetailKey(BRANCH, DATE, PAYMENT, PAYMENT_HASH), branchUuid: BRANCH, eventDate: DATE,
    paymentUuid: PAYMENT, paymentSourceHash: PAYMENT_HASH, detailSourceHash: hash('d'), detailFetchedAt: '2026-08-29T10:00:00.000Z',
    lineCount: 2, truncated: false,
    lines: [
      { lineOrdinal: 0, lineKind: 'OPD', itemCode: 'ITEM-1', netLineSatang: 12_000 },
      { lineOrdinal: 1, lineKind: 'COURSE', itemCode: null, netLineSatang: 8_000 },
    ],
    ...patch,
  }
}

function coverageRow(patch: Partial<JeraAllocationCoverage> = {}): JeraAllocationCoverage {
  return {
    dayKey: jeraAllocationDayKey(BRANCH, DATE), branchUuid: BRANCH, eventDate: DATE,
    paymentCacheKey: jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: DATE, endDate: DATE }),
    productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', { branchUuid: BRANCH, startDate: DATE, endDate: DATE }), paymentSetHash: hash('p'),
    paymentRowCount: 1, successfulDetailCount: 0, metadataSnapshotHash: hash('m'),
    paymentLastSuccessAt: '2026-08-29T10:00:00.000Z', productSalesLastSuccessAt: '2026-08-29T10:00:00.000Z',
    cursor: 0, status: 'INCOMPLETE', lastAttemptAt: null, lastSuccessAt: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
    ...patch,
  }
}

function fixture(): MemorySheets {
  const sheets = new MemorySheets()
  sheets.setTab('JERA_PAYMENT_DETAIL_CACHE', [[...JERA_PAYMENT_DETAIL_CACHE_HEADERS]])
  sheets.setTab('JERA_PAYMENT_DETAIL_LINES', [[...JERA_PAYMENT_DETAIL_LINES_HEADERS]])
  sheets.setTab('JERA_ALLOCATION_COVERAGE', [[...JERA_ALLOCATION_COVERAGE_HEADERS]])
  return sheets
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()
  readonly batchWrites: Array<Array<{ range: string; values: unknown[][] }>> = []
  readonly batchGets: string[][] = []

  setTab(tab: string, rows: unknown[][]): void { this.tabs.set(tab, structuredClone(rows)) }
  tab(tab: string): unknown[][] { return structuredClone(this.tabs.get(tab) ?? []) }
  serialized(): string { return JSON.stringify([...this.tabs.entries()]) }
  usedRows(tab: string): number { return this.tab(tab).filter((row) => row.some((cell) => cell !== '')).length }
  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    this.batchGets.push([...ranges])
    return Object.fromEntries(ranges.map((range) => [range, this.tab(tabName(range))]))
  }
  async append(): Promise<void> { throw new Error('unexpected append') }
  async update(): Promise<void> { throw new Error('unexpected update') }
  async batchUpdate(_spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    this.batchWrites.push(structuredClone(data))
    for (const item of data) {
      const tab = tabName(item.range)
      const row = Number(item.range.match(/![A-Z]+(\d+)/)?.[1] ?? '1')
      const rows = this.tabs.get(tab) ?? []
      item.values.forEach((value, index) => { rows[row - 1 + index] = structuredClone(value) })
      this.tabs.set(tab, rows)
    }
  }
  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { return [] }
  async applyWorkbookRequests(): Promise<void> { return undefined }
}

function tabName(range: string): string { return range.split('!', 1)[0]!.replaceAll("'", '') }
