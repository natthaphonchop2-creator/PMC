import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { JeraCacheEnvelope, JeraNormalizedRow } from '../../server/jera/contracts'
import {
  createJeraFinanceService,
  JeraFinanceServiceError,
} from '../../server/jera/financeService'
import type { JeraAllocationCoverage, JeraAllocationStore, JeraCachedPaymentDetail } from '../../server/jera/allocationStore'
import type { JeraAllocationTaskQueuePort } from '../../server/jera/allocationTaskQueue'
import type { JeraSyncCoordinator, JeraSyncQuery } from '../../server/jera/syncCoordinator'

describe('JERA finance service', () => {
  it.each([
    ['zero days', '2026-08-30', '2026-08-29'],
    ['32 days', '2026-07-30', '2026-08-30'],
    ['reversed dates', '2026-08-30', '2026-08-28'],
    ['invalid start date', '2026-02-30', '2026-02-30'],
    ['invalid end date', '2026-08-29', '29/08/2026'],
  ])('rejects %s before any cache access', async (_case, startDate, endDate) => {
    const deps = fixture()

    await expect(deps.service.readDaily({ branchUuid: BRANCH, startDate, endDate }))
      .rejects.toMatchObject({ code: 'FINANCE_FILTER_INVALID' })
    expect(deps.coordinator.readCachedBatch).not.toHaveBeenCalled()
    expect(deps.allocationStore.readDays).not.toHaveBeenCalled()
  })

  it.each([
    ['one day', '2026-08-29', '2026-08-29', 3],
    ['31 days', '2026-08-01', '2026-08-31', 93],
  ])('loads %s through one exact-day cache batch and one bounded allocation read', async (_case, startDate, endDate, queryCount) => {
    const deps = fixture()

    await deps.service.readDaily({ branchUuid: BRANCH, startDate, endDate })

    expect(deps.coordinator.readCachedBatch).toHaveBeenCalledOnce()
    const queries = vi.mocked(deps.coordinator.readCachedBatch).mock.calls[0]![0]
    expect(queries).toHaveLength(queryCount)
    expect(queries.every(({ filters }) => filters.startDate === filters.endDate)).toBe(true)
    expect(queries.slice(0, 3)).toEqual([
      exactQuery('PAYMENT', startDate), exactQuery('REFUND', startDate), exactQuery('PRODUCT_SALES', startDate),
    ])
    expect(queries.slice(-3)).toEqual([
      exactQuery('PAYMENT', endDate), exactQuery('REFUND', endDate), exactQuery('PRODUCT_SALES', endDate),
    ])
    expect(deps.allocationStore.readDays).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.allocationStore.readDays).mock.calls[0]![0]).toHaveLength(queryCount / 3)
    expect(deps.coordinator.manualRefresh).not.toHaveBeenCalled()
    expect(deps.queue.enqueue).not.toHaveBeenCalled()
  })

  it('sorts projected payment rows newest date first', async () => {
    const deps = fixture()

    const report = await deps.service.readDaily({ branchUuid: BRANCH, startDate: '2026-08-28', endDate: '2026-08-29' })

    expect(report.payments.map(({ eventDate }) => eventDate)).toEqual(['2026-08-29', '2026-08-28'])
  })

  it('returns FINANCE_CACHE_EMPTY instead of presenting an unseeded cache as confirmed zero', async () => {
    const deps = fixture({ cache: () => envelope([], null) })

    await expect(deps.service.readDaily({ branchUuid: BRANCH, startDate: '2026-08-29', endDate: '2026-08-29' }))
      .rejects.toEqual(expect.objectContaining({ code: 'FINANCE_CACHE_EMPTY' }))
  })

  it.each([
    [2027, 1, '2027-01', '2027-01-01', '2027-01-31'],
    [2028, 2, '2028-02', '2028-02-01', '2028-02-29'],
    [2026, 12, '2026-12', '2026-12-01', '2026-12-31'],
  ])('derives Bangkok month boundaries for %s-%s', async (year, month, monthKey, startDate, endDate) => {
    const deps = fixture()

    const report = await deps.service.readMonthly({ branchUuid: BRANCH, year, month })

    expect(report).toMatchObject({ monthKey, startDate, endDate })
    const queries = vi.mocked(deps.coordinator.readCachedBatch).mock.calls[0]![0]
    expect(queries[0]).toEqual(exactQuery('PAYMENT', startDate))
    expect(queries.at(-1)).toEqual(exactQuery('PRODUCT_SALES', endDate))
  })

  it('surfaces component freshness and fails category reconciliation when sources exceed the 15-minute skew', async () => {
    const deps = fixture({
      now: new Date('2026-08-30T12:00:00.001Z'),
      coverage: (date, paymentSetHash, metadataSnapshotHash) => coverage({
        date, paymentSetHash, metadataSnapshotHash,
        paymentLastSuccessAt: '2026-08-29T10:00:00.000Z',
        productSalesLastSuccessAt: '2026-08-29T10:16:00.000Z',
      }),
    })

    const report = await deps.service.readDaily({ branchUuid: BRANCH, startDate: '2026-08-29', endDate: '2026-08-29' })

    expect(report.freshness.payment).toMatchObject({ stale: true, warningCode: 'COMPONENT_STALE' })
    expect(report.categories).toMatchObject({ state: 'CHECKING', serviceSatang: null, incompleteDates: ['2026-08-29'] })
    expect(report.warnings).toContain('CATEGORY_SOURCE_SNAPSHOT_MISMATCH')
  })

  it('keeps category money null when the server gate is false despite complete matching coverage', async () => {
    const deps = fixture({ categoryMoneyEnabled: false })

    const report = await deps.service.readDaily({ branchUuid: BRANCH, startDate: '2026-08-29', endDate: '2026-08-29' })

    expect(report.categories).toEqual({
      state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null, incompleteDates: [],
    })
  })

  it('refreshes the three exact-day sources sequentially, seeds coverage, and enqueues cursor zero attempt zero', async () => {
    const deps = fixture()
    let active = 0
    let maxActive = 0
    const order: string[] = []
    vi.mocked(deps.coordinator.manualRefresh).mockImplementation(async ({ reportType }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(reportType)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      return { accepted: true, retryAfterSeconds: 300 }
    })

    const result = await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(result).toEqual({ accepted: true, allocationQueued: true, retryAfterSeconds: 300 })
    expect(order).toEqual(['PAYMENT', 'REFUND', 'PRODUCT_SALES'])
    expect(maxActive).toBe(1)
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({
      branchUuid: BRANCH, eventDate: '2026-08-29', cursor: 0, status: 'INCOMPLETE',
      paymentRowCount: 1, successfulDetailCount: 0,
    }))
    const seeded = vi.mocked(deps.allocationStore.saveCoverage).mock.calls[0]![0]
    expect(deps.queue.enqueue).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: seeded.paymentSetHash,
      cursor: 0, attempt: 0, scheduleAt: new Date('2026-08-29T12:00:00.000Z'),
    })
  })

  it('does not seed or enqueue when a source refresh fails, preserving the coordinator cache', async () => {
    const deps = fixture()
    vi.mocked(deps.coordinator.manualRefresh)
      .mockResolvedValueOnce({ accepted: true, retryAfterSeconds: 300 })
      .mockRejectedValueOnce(new Error('private provider response'))

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).rejects.toMatchObject({ code: 'FINANCE_REFRESH_UNAVAILABLE' })
    expect(deps.coordinator.manualRefresh).toHaveBeenCalledTimes(2)
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
    expect(deps.queue.enqueue).not.toHaveBeenCalled()
  })

  it('reports the minimum safe retry after a throttled source without leaking a partial provider response', async () => {
    const deps = fixture()
    vi.mocked(deps.coordinator.manualRefresh)
      .mockResolvedValueOnce({ accepted: true, retryAfterSeconds: 300 })
      .mockResolvedValueOnce({ accepted: false, retryAfterSeconds: 120 })

    let error: unknown
    try {
      await deps.service.refreshDay({
        branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'SCHEDULER', schedulerId: 'finance-daily-seed' },
      })
    } catch (value) { error = value }

    expect(error).toBeInstanceOf(JeraFinanceServiceError)
    expect(error).toMatchObject({ code: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: 300 })
    expect(JSON.stringify(error)).not.toContain('provider')
    expect(deps.coordinator.manualRefresh).toHaveBeenCalledTimes(2)
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
    expect(deps.queue.enqueue).not.toHaveBeenCalled()
  })
})

function fixture(options: {
  now?: Date
  cache?: (query: JeraSyncQuery) => JeraCacheEnvelope<JeraNormalizedRow[]>
  coverage?: (date: string, paymentSetHash: string, metadataSnapshotHash: string) => JeraAllocationCoverage | null
  categoryMoneyEnabled?: boolean
} = {}) {
  const now = options.now ?? new Date('2026-08-29T12:00:00.000Z')
  const cache = options.cache ?? ((query: JeraSyncQuery) => {
    const date = query.filters.startDate
    if (query.reportType === 'PAYMENT') return envelope([row({ reportType: 'PAYMENT', eventDate: date })])
    if (query.reportType === 'REFUND') return envelope([row({
      reportType: 'REFUND', eventDate: date, sourceUuid: `refund-${date}`, paidAmountSatang: null, transferSatang: null, refundAmountSatang: 0,
    })])
    return envelope([row({
      reportType: 'PRODUCT_SALES', eventDate: date, sourceUuid: `product-${date}`, paidAmountSatang: null,
      transferSatang: null, itemCode: 'ITEM-1', type: 'service',
    })])
  })
  const coordinator = {
    readCachedBatch: vi.fn(async (queries: JeraSyncQuery[]) => queries.map(cache)),
    manualRefresh: vi.fn(async () => ({ accepted: true, retryAfterSeconds: 300 })),
  } as unknown as JeraSyncCoordinator
  const allocationStore = {
    readDays: vi.fn(async (inputs: Array<{ branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string }>) => inputs.map((input) => ({
      coverage: options.coverage?.(input.eventDate, input.paymentSetHash, input.metadataSnapshotHash)
        ?? coverage({ date: input.eventDate, paymentSetHash: input.paymentSetHash, metadataSnapshotHash: input.metadataSnapshotHash }),
      details: [detail(input.eventDate, input.paymentSetHash)],
    }))),
    saveCoverage: vi.fn(async () => undefined),
  } as unknown as JeraAllocationStore & { readDays: ReturnType<typeof vi.fn> }
  const queue = {
    enqueue: vi.fn(async () => ({ taskName: 'task-1', alreadyExists: false })),
  } as JeraAllocationTaskQueuePort
  const service = createJeraFinanceService({
    coordinator, allocationStore, allocationQueue: queue,
    categoryMoneyEnabled: options.categoryMoneyEnabled ?? true, now: () => new Date(now),
  })
  return { service, coordinator, allocationStore, queue }
}

function exactQuery(reportType: 'PAYMENT' | 'REFUND' | 'PRODUCT_SALES', date: string): JeraSyncQuery {
  return { reportType, filters: { branchUuid: BRANCH, startDate: date, endDate: date } }
}

function envelope(data: JeraNormalizedRow[], lastSuccessAt: string | null = '2026-08-29T10:00:00.000Z'): JeraCacheEnvelope<JeraNormalizedRow[]> {
  return {
    data, source: 'CACHE', fetchedAt: lastSuccessAt, lastSuccessAt,
    refreshing: false, stale: false, warningCode: null,
  }
}

function row(patch: Partial<JeraNormalizedRow>): JeraNormalizedRow {
  const eventDate = patch.eventDate ?? '2026-08-29'
  return {
    cacheKey: `PAYMENT:${eventDate}`, reportType: 'PAYMENT', sourceUuid: PAYMENT_UUID,
    branchUuid: BRANCH, branchName: 'Synthetic Branch', eventDate,
    patientUuid: null, patientCode: 'PAT-1', patientName: 'Synthetic Patient', paymentCode: `PAY-${eventDate}`,
    status: 'PAID', type: 'NORMAL', totalSatang: 100_000, paidAmountSatang: 100_000, refundAmountSatang: null,
    cashSatang: 0, transferSatang: 100_000, creditCardSatang: 0, eWalletSatang: 0, paymentLinkSatang: 0,
    otherPaymentSatang: 0, itemCode: null, itemName: null, quantity: null, remainingQuantity: null,
    remainingValueSatang: null, doctorName: null, salespersonName: null,
    sourceCreatedAt: `${eventDate}T10:00:00.000Z`, sourceUpdatedAt: null,
    fetchedAt: `${eventDate}T10:00:00.000Z`, sourceHash: createHash('sha256').update(`payment:${eventDate}`).digest('hex'),
    ...patch,
  }
}

function coverage(input: {
  date: string
  paymentSetHash: string
  metadataSnapshotHash: string
  paymentLastSuccessAt?: string
  productSalesLastSuccessAt?: string
}): JeraAllocationCoverage {
  return {
    dayKey: createHash('sha256').update(JSON.stringify([BRANCH, input.date])).digest('hex'),
    branchUuid: BRANCH, eventDate: input.date, paymentCacheKey: `PAYMENT:${input.date}`,
    productSalesCacheKey: `PRODUCT_SALES:${input.date}`, paymentSetHash: input.paymentSetHash,
    paymentRowCount: 1, successfulDetailCount: 1, metadataSnapshotHash: input.metadataSnapshotHash,
    paymentLastSuccessAt: input.paymentLastSuccessAt ?? '2026-08-29T10:00:00.000Z',
    productSalesLastSuccessAt: input.productSalesLastSuccessAt ?? '2026-08-29T10:00:00.000Z',
    cursor: 1, status: 'COMPLETE', lastAttemptAt: '2026-08-29T10:00:00.000Z',
    lastSuccessAt: '2026-08-29T10:00:00.000Z', safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
  }
}

function detail(eventDate: string, paymentSourceHash: string): JeraCachedPaymentDetail {
  return {
    detailKey: createHash('sha256').update(`detail:${eventDate}`).digest('hex'), branchUuid: BRANCH,
    eventDate, paymentUuid: PAYMENT_UUID, paymentSourceHash,
    detailSourceHash: createHash('sha256').update(`detail-source:${eventDate}`).digest('hex'),
    detailFetchedAt: '2026-08-29T10:00:00.000Z', lineCount: 1, truncated: false,
    lines: [{ lineOrdinal: 0, lineKind: 'OPD', itemCode: 'ITEM-1', netLineSatang: 100_000 }],
  }
}

const BRANCH = '11111111-2222-4333-8444-555555555555'
const PAYMENT_UUID = '10000000-0000-4000-8000-000000000001'
