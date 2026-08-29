import { describe, expect, it, vi } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  JERA_API_CACHE_HEADERS,
  JERA_SYNC_AUDIT_HEADERS,
  JERA_SYNC_STATE_HEADERS,
} from '../../server/pmc-mini-app/setup'
import type { JeraNormalizedRow } from '../../server/jera/contracts'
import { jeraCacheKey } from '../../server/jera/cacheKey'
import { createGoogleJeraReportStore, type JeraCachedSnapshotQuery, type JeraSyncAuditRecord } from '../../server/jera/store'

describe('Google Sheets JERA report store', () => {
  it('reuses a short-lived single-flight snapshot and invalidates it after a write', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })

    await Promise.all([
      store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' }),
      store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' }),
      store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' }),
    ])
    expect(sheets.readCount).toBe(1)

    await store.getSyncState('PAYMENT:key')
    await store.getSyncState('PAYMENT:key')
    expect(sheets.readCount).toBe(3)

    await store.upsertRows('PAYMENT', [paymentRow()])
    await store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' })
    expect(sheets.readCount).toBe(4)
  })

  it('upserts the same source without duplicate rows', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })

    await store.upsertRows('PAYMENT', [paymentRow({ paidAmountSatang: 10_000, sourceHash: hash('a') })])
    await store.upsertRows('PAYMENT', [paymentRow({ paidAmountSatang: 12_000, sourceHash: hash('b') })])

    expect(await store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' })).toMatchObject([
      { sourceUuid: PAYMENT_UUID, paidAmountSatang: 12_000 },
    ])
    expect(sheets.tab('JERA_API_CACHE')).toHaveLength(2)
  })

  it('does not write when the source hash is unchanged', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    const row = paymentRow({ sourceHash: hash('a') })
    await store.upsertRows('PAYMENT', [row])
    const writesAfterInsert = sheets.writeCount

    await expect(store.upsertRows('PAYMENT', [row])).resolves.toEqual({ inserted: 0, updated: 0, unchanged: 1, removed: 0 })
    expect(sheets.writeCount).toBe(writesAfterInsert)
  })

  it('clears nullable cells with a real blank value when a source changes', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    await store.upsertRows('PAYMENT', [paymentRow({ patientName: 'Synthetic Patient', sourceHash: hash('a') })])
    await store.upsertRows('PAYMENT', [paymentRow({ patientName: null, sourceHash: hash('b') })])

    const patientNameIndex = JERA_API_CACHE_HEADERS.indexOf('patientName')
    expect(sheets.tab('JERA_API_CACHE')[1]?.[patientNameIndex]).toBe('')
    expect((await store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' }))[0]?.patientName).toBeNull()
  })

  it('round-trips bounded item quantities and remaining-course value', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    await store.upsertRows('PAYMENT', [paymentRow({
      itemCode: 'ITEM-SYN-1', itemName: 'Synthetic Item', quantity: 2.5,
      remainingQuantity: 3, remainingValueSatang: 300_000,
    })])

    expect((await store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' }))[0]).toMatchObject({
      itemCode: 'ITEM-SYN-1', itemName: 'Synthetic Item', quantity: 2.5,
      remainingQuantity: 3, remainingValueSatang: 300_000,
    })
  })

  it('replaces one cache key and clears rows no longer returned by a valid provider response', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    await store.upsertRows('PAYMENT', [
      paymentRow(),
      paymentRow({ sourceUuid: '10000000-0000-4000-8000-000000000002', paymentCode: 'PAY-2', sourceHash: hash('b') }),
    ])

    await expect(store.replaceRows('PAYMENT', 'PAYMENT:key', [paymentRow()]))
      .resolves.toEqual({ inserted: 0, updated: 0, unchanged: 1, removed: 1 })
    expect(await store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' })).toHaveLength(1)
  })

  it('persists sync state and enforces lease ownership until expiry', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    const first = {
      cacheKey: 'PAYMENT:key', reportType: 'PAYMENT' as const, filterHash: hash('f'),
      owner: 'worker-a', now: '2026-08-27T10:00:00.000Z', ttlMs: 60_000,
    }

    await expect(store.claimLease(first)).resolves.toBe(true)
    await expect(store.claimLease({ ...first, owner: 'worker-b', now: '2026-08-27T10:00:30.000Z' })).resolves.toBe(false)
    await expect(store.claimLease({ ...first, owner: 'worker-b', now: '2026-08-27T10:01:01.000Z' })).resolves.toBe(true)
    await store.releaseLease('PAYMENT:key', 'worker-a')
    expect((await store.getSyncState('PAYMENT:key'))?.leaseOwner).toBe('worker-b')
    await store.releaseLease('PAYMENT:key', 'worker-b')
    expect((await store.getSyncState('PAYMENT:key'))?.leaseOwner).toBeNull()
  })

  it('round-trips distinct attempt, manual, and success timestamps in their exact columns', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    await store.saveSyncState({
      cacheKey: 'PAYMENT:key', reportType: 'PAYMENT', filterHash: hash('f'),
      lastAttemptAt: '2026-08-27T10:00:00.000Z', lastManualAt: '2026-08-27T10:01:00.000Z',
      lastSuccessAt: '2026-08-27T10:02:00.000Z', lastSourceDate: '2026-08-27', status: 'SUCCESS',
      recordCount: 1, nextPage: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
    })

    expect(await store.getSyncState('PAYMENT:key')).toMatchObject({
      lastAttemptAt: '2026-08-27T10:00:00.000Z',
      lastManualAt: '2026-08-27T10:01:00.000Z',
      lastSuccessAt: '2026-08-27T10:02:00.000Z',
    })
  })

  it('writes only the bounded audit contract and ignores injected provider data', async () => {
    const sheets = sheetsFixture()
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    const audit = {
      syncRunId: 'run-1', actorType: 'SCHEDULED', actorId: 'scheduler', reportType: 'PAYMENT', filterHash: hash('f'),
      startedAt: '2026-08-27T10:00:00.000Z', finishedAt: '2026-08-27T10:00:01.000Z', status: 'SUCCESS',
      recordCount: 1, safeErrorCode: null, correlationId: 'corr-1',
      providerBody: { bearer: 'secret-token', patientName: 'must-not-persist' },
    } as JeraSyncAuditRecord & { providerBody: unknown }

    await store.appendSyncAudit(audit)

    const persisted = JSON.stringify(sheets.tab('JERA_SYNC_AUDIT'))
    expect(persisted).not.toContain('secret-token')
    expect(persisted).not.toContain('must-not-persist')
    expect(sheets.tab('JERA_SYNC_AUDIT')[1]).toHaveLength(JERA_SYNC_AUDIT_HEADERS.length)
  })

  it('fails closed when a managed header is incompatible', async () => {
    const sheets = sheetsFixture()
    sheets.setTab('JERA_API_CACHE', [['wrong', 'header']])
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.readRows('PAYMENT', { cacheKey: 'PAYMENT:key' })).rejects.toThrow('JERA_STORE_INCOMPATIBLE_HEADER')
  })

  it('loads cache and state once for 93 exact-day source snapshots without including a month cache row', async () => {
    const sheets = sheetsFixture()
    const writer = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    const days = Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`)
    const queries: JeraCachedSnapshotQuery[] = days.flatMap((day) => ['PAYMENT', 'REFUND', 'PRODUCT_SALES'].map((reportType) => ({
      reportType: reportType as JeraCachedSnapshotQuery['reportType'],
      filters: { branchUuid: '11111111-2222-4333-8444-555555555555', startDate: day, endDate: day },
    })))
    const exactPayment = queries[0]!
    const monthFilters = { branchUuid: exactPayment.filters.branchUuid, startDate: '2026-08-01', endDate: '2026-08-31' }
    await writer.replaceRows('PAYMENT', jeraCacheKey('PAYMENT', exactPayment.filters), [paymentRow({
      cacheKey: jeraCacheKey('PAYMENT', exactPayment.filters), eventDate: '2026-08-01',
    })])
    await writer.replaceRows('PAYMENT', jeraCacheKey('PAYMENT', monthFilters), [paymentRow({
      cacheKey: jeraCacheKey('PAYMENT', monthFilters), eventDate: '2026-08-01', sourceHash: hash('e'),
    })])
    await writer.saveSyncState({
      cacheKey: jeraCacheKey('REFUND', queries[1]!.filters), reportType: 'REFUND', filterHash: jeraCacheKey('REFUND', queries[1]!.filters).split(':')[1]!,
      lastAttemptAt: '2026-08-01T10:00:00.000Z', lastManualAt: null, lastSuccessAt: '2026-08-01T10:00:00.000Z', lastSourceDate: '2026-08-01',
      status: 'SUCCESS', recordCount: 0, nextPage: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
    })

    sheets.readCount = 0
    const store = createGoogleJeraReportStore({ spreadsheetId: 'sheet-1', sheets })
    const timer = vi.spyOn(globalThis, 'setTimeout')
    try {
      const snapshots = await store.readSnapshots(queries)
      expect(sheets.readCount).toBe(2)
      expect(timer).not.toHaveBeenCalled()
      expect(snapshots).toHaveLength(93)
      expect(snapshots[0]?.rows).toHaveLength(1)
      expect(snapshots[1]).toMatchObject({ rows: [], state: { status: 'SUCCESS', recordCount: 0 } })
      expect(snapshots[2]?.rows).toEqual([])
      expect(snapshots[0]?.rows.map((row) => row.cacheKey)).not.toContain(jeraCacheKey('PAYMENT', monthFilters))
    } finally {
      timer.mockRestore()
    }
  })
})

const PAYMENT_UUID = '10000000-0000-4000-8000-000000000001'

function paymentRow(patch: Partial<JeraNormalizedRow> = {}): JeraNormalizedRow {
  return {
    cacheKey: 'PAYMENT:key', reportType: 'PAYMENT', sourceUuid: PAYMENT_UUID,
    branchUuid: '11111111-2222-4333-8444-555555555555', branchName: 'Synthetic Branch',
    eventDate: '2026-08-27', patientUuid: '20000000-0000-4000-8000-000000000001',
    patientCode: 'PAT-1', patientName: 'Synthetic Patient', paymentCode: 'PAY-1', status: 'PAID', type: 'normal',
    totalSatang: 10_000, paidAmountSatang: 10_000, refundAmountSatang: null,
    cashSatang: null, transferSatang: null, creditCardSatang: null, eWalletSatang: null,
    paymentLinkSatang: null, otherPaymentSatang: null,
    itemCode: null, itemName: null, quantity: null, remainingQuantity: null, remainingValueSatang: null,
    doctorName: 'Doctor Synthetic', salespersonName: 'Sales Synthetic',
    sourceCreatedAt: '2026-08-27T10:00:00+07:00', sourceUpdatedAt: null,
    fetchedAt: '2026-08-27T03:01:00.000Z', sourceHash: hash('a'),
    ...patch,
  }
}

function sheetsFixture(): MemorySheets {
  const sheets = new MemorySheets()
  sheets.setTab('JERA_API_CACHE', [[...JERA_API_CACHE_HEADERS]])
  sheets.setTab('JERA_SYNC_STATE', [[...JERA_SYNC_STATE_HEADERS]])
  sheets.setTab('JERA_SYNC_AUDIT', [[...JERA_SYNC_AUDIT_HEADERS]])
  return sheets
}

function hash(character: string): string { return character.repeat(64) }

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()
  writeCount = 0
  readCount = 0

  setTab(tab: string, rows: unknown[][]): void { this.tabs.set(tab, structuredClone(rows)) }
  tab(tab: string): unknown[][] { return structuredClone(this.tabs.get(tab) ?? []) }

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    this.readCount += 1
    return Object.fromEntries(ranges.map((range) => [range, this.tab(tabName(range))]))
  }

  async append(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    this.writeCount += 1
    const tab = tabName(range)
    this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    this.writeCount += 1
    const tab = tabName(range)
    const rowNumber = Number(range.match(/![A-Z]+(\d+)/)?.[1] ?? 1)
    const current = [...(this.tabs.get(tab) ?? [])]
    rows.forEach((row, offset) => { current[rowNumber - 1 + offset] = structuredClone(row) })
    this.tabs.set(tab, current)
  }

  async batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    for (const item of data) await this.update(spreadsheetId, item.range, item.values)
  }

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { return [] }
  async applyWorkbookRequests(): Promise<void> { return undefined }
}

function tabName(range: string): string {
  return range.split('!', 1)[0]!.replaceAll("'", '')
}
