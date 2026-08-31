import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { JeraCacheEnvelope, JeraNormalizedRow } from '../../server/jera/contracts'
import {
  createJeraFinanceService,
  JeraFinanceServiceError,
} from '../../server/jera/financeService'
import type { JeraAllocationCoverage, JeraAllocationStore, JeraCachedPaymentDetail } from '../../server/jera/allocationStore'
import {
  MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS,
  type JeraAllocationTaskQueuePort,
} from '../../server/jera/allocationTaskQueue'
import type { JeraSyncCoordinator, JeraSyncQuery } from '../../server/jera/syncCoordinator'
import { jeraCacheKey } from '../../server/jera/cacheKey'

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
      paymentRowCount: 1, successfulDetailCount: 0, taskAttempt: 0,
    }))
    const seeded = vi.mocked(deps.allocationStore.saveCoverage).mock.calls[0]![0]
    expect(deps.queue.enqueue).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: seeded.paymentSetHash,
      metadataSnapshotHash: seeded.metadataSnapshotHash,
      cursor: 0, attempt: 0, scheduleAt: new Date('2026-08-29T12:01:35.000Z'),
    })
    expect(deps.lease.claim).toHaveBeenCalledWith(expect.objectContaining({
      dayKey: createHash('sha256').update('JERA_ALLOCATION_STORE_V1').digest('hex'),
    }))
    expect(deps.lease.release).toHaveBeenCalledOnce()
    expect(seeded).toMatchObject({ leaseFencingToken: '77' })
  })

  it('uses scheduled refresh semantics without consuming the staff manual-refresh cooldown', async () => {
    const deps = fixture()

    const result = await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'SCHEDULER', schedulerId: 'finance-current-seed' },
    })

    expect(result).toEqual({ accepted: true, allocationQueued: true, retryAfterSeconds: 300 })
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledTimes(3)
    expect(deps.coordinator.scheduledRefresh).toHaveBeenNthCalledWith(1, exactQuery('PAYMENT', '2026-08-29'))
    expect(deps.coordinator.scheduledRefresh).toHaveBeenNthCalledWith(2, exactQuery('REFUND', '2026-08-29'))
    expect(deps.coordinator.scheduledRefresh).toHaveBeenNthCalledWith(3, exactQuery('PRODUCT_SALES', '2026-08-29'))
    expect(deps.coordinator.manualRefresh).not.toHaveBeenCalled()
  })

  it('keeps same-hash COMPLETE coverage as a task no-op', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'),
      metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    const deps = fixture({ existingCoverage: existing })

    const result = await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(result).toEqual({ accepted: true, allocationQueued: false, retryAfterSeconds: 300 })
    expect(deps.allocationStore.getCoverage).toHaveBeenCalledWith(existing.dayKey)
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
    expect(deps.queue.enqueue).not.toHaveBeenCalled()
  })

  it('rebinds same-hash COMPLETE coverage to refreshed source timestamps without requesting payment detail again', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'),
      metadataSnapshotHash: currentMetadataSnapshotHash(),
      paymentLastSuccessAt: '2026-08-29T10:00:00.000Z',
      productSalesLastSuccessAt: '2026-08-29T10:00:00.000Z',
    })
    const refreshedAt = '2026-08-29T11:00:00.000Z'
    const deps = fixture({
      existingCoverage: existing,
      cache: (query) => {
        const date = query.filters.startDate
        if (query.reportType === 'PAYMENT') return envelope([row({ reportType: 'PAYMENT', eventDate: date })], refreshedAt)
        if (query.reportType === 'REFUND') return envelope([row({
          reportType: 'REFUND', eventDate: date, sourceUuid: `refund-${date}`, paidAmountSatang: null,
          transferSatang: null, refundAmountSatang: 0,
        })], refreshedAt)
        return envelope([row({
          reportType: 'PRODUCT_SALES', eventDate: date, sourceUuid: `product-${date}`,
          paidAmountSatang: null, transferSatang: null, itemCode: 'ITEM-1', type: 'service',
        })], refreshedAt)
      },
    })

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).resolves.toEqual({ accepted: true, allocationQueued: false, retryAfterSeconds: 300 })

    expect(deps.queue.enqueue).not.toHaveBeenCalled()
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledOnce()
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'COMPLETE', cursor: 1, successfulDetailCount: 1,
      paymentLastSuccessAt: refreshedAt, productSalesLastSuccessAt: refreshedAt,
      leaseFencingToken: '77',
    }))
  })

  it('fails closed before queue or Sheet mutation when the global allocation lease is no longer current', async () => {
    const deps = fixture()
    vi.mocked(deps.lease.assertCurrent).mockResolvedValue(false)

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).rejects.toMatchObject({ code: 'FINANCE_REFRESH_UNAVAILABLE' })

    expect(deps.queue.enqueue).not.toHaveBeenCalled()
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
    expect(deps.lease.release).toHaveBeenCalledOnce()
  })

  it('resumes same-hash INCOMPLETE coverage from its saved cursor with a new durable task generation', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'),
      metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    Object.assign(existing, {
      status: 'INCOMPLETE', cursor: 1, successfulDetailCount: 1, lastSuccessAt: null,
      lastAttemptAt: '2026-08-29T10:05:00.000Z', taskAttempt: 4,
    })
    const deps = fixture({ existingCoverage: existing })

    const result = await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(result).toEqual({ accepted: true, allocationQueued: true, retryAfterSeconds: 300 })
    expect(deps.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1, attempt: 5 }))
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({
      cursor: 1, successfulDetailCount: 1, status: 'INCOMPLETE', taskAttempt: 5,
    }))
    expect(vi.mocked(deps.queue.enqueue).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.allocationStore.saveCoverage).mock.invocationCallOrder[0]!)
  })

  it('skips a tombstoned manual-resume generation and persists only the replacement task', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'),
      metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    Object.assign(existing, { status: 'INCOMPLETE', cursor: 1, taskAttempt: 4 })
    const deps = fixture({ existingCoverage: existing })
    vi.mocked(deps.queue.enqueue)
      .mockResolvedValueOnce({ taskName: 'tombstoned-5', alreadyExists: true, live: false })
      .mockResolvedValueOnce({ taskName: 'created-6', alreadyExists: false, live: true })

    await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(vi.mocked(deps.queue.enqueue).mock.calls.map(([input]) => input.attempt)).toEqual([5, 6])
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledOnce()
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({ taskAttempt: 6, cursor: 1 }))
  })

  it('leaves coverage untouched when every bounded resume generation is tombstoned', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'),
      metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    Object.assign(existing, { status: 'INCOMPLETE', cursor: 1, taskAttempt: 4 })
    const deps = fixture({ existingCoverage: existing })
    vi.mocked(deps.queue.enqueue).mockResolvedValue({ taskName: 'tombstone', alreadyExists: true, live: false })

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).rejects.toMatchObject({ code: 'FINANCE_REFRESH_UNAVAILABLE' })
    expect(deps.queue.enqueue).toHaveBeenCalledTimes(MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS)
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
  })

  it('creates a distinct cursor-zero task for a metadata-only change before resetting coverage', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: currentPaymentSetHash('2026-08-29'), metadataSnapshotHash: 'f'.repeat(64),
    })
    const deps = fixture({ existingCoverage: existing })

    await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(deps.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      paymentSetHash: existing.paymentSetHash, metadataSnapshotHash: currentMetadataSnapshotHash(), cursor: 0, attempt: 0,
    }))
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({
      paymentSetHash: existing.paymentSetHash, metadataSnapshotHash: currentMetadataSnapshotHash(), status: 'INCOMPLETE', cursor: 0,
    }))
    expect(vi.mocked(deps.queue.enqueue).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.allocationStore.saveCoverage).mock.invocationCallOrder[0]!)
  })

  it('creates a cursor-zero task for a changed payment set before resetting coverage', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: 'f'.repeat(64), metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    const deps = fixture({ existingCoverage: existing })

    await deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })

    expect(deps.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      paymentSetHash: currentPaymentSetHash('2026-08-29'), metadataSnapshotHash: existing.metadataSnapshotHash,
      cursor: 0, attempt: 0,
    }))
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({
      paymentSetHash: currentPaymentSetHash('2026-08-29'), metadataSnapshotHash: existing.metadataSnapshotHash,
      status: 'INCOMPLETE', cursor: 0,
    }))
    expect(vi.mocked(deps.queue.enqueue).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.allocationStore.saveCoverage).mock.invocationCallOrder[0]!)
  })

  it('does not overwrite working coverage when changed-hash enqueue fails', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: 'f'.repeat(64), metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    const deps = fixture({ existingCoverage: existing })
    vi.mocked(deps.queue.enqueue).mockRejectedValueOnce(new Error('task unavailable'))

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).rejects.toMatchObject({ code: 'FINANCE_REFRESH_UNAVAILABLE' })
    expect(deps.allocationStore.saveCoverage).not.toHaveBeenCalled()
  })

  it('binds changed-hash coverage only after confirming the existing task is live', async () => {
    const existing = coverage({
      date: '2026-08-29', paymentSetHash: 'f'.repeat(64), metadataSnapshotHash: currentMetadataSnapshotHash(),
    })
    const deps = fixture({ existingCoverage: existing })
    vi.mocked(deps.queue.enqueue).mockResolvedValueOnce({ taskName: 'existing-task', alreadyExists: true, live: true })

    await expect(deps.service.refreshDay({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })).resolves.toEqual({ accepted: true, allocationQueued: false, retryAfterSeconds: 300 })
    expect(deps.allocationStore.saveCoverage).toHaveBeenCalledWith(expect.objectContaining({ taskAttempt: 0, cursor: 0 }))
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
        branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
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
  existingCoverage?: JeraAllocationCoverage | null
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
    scheduledRefresh: vi.fn(async (query: JeraSyncQuery) => cache(query)),
  } as unknown as JeraSyncCoordinator
  const allocationStore = {
    readDays: vi.fn(async (inputs: Array<{ branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string }>) => inputs.map((input) => ({
      coverage: options.coverage?.(input.eventDate, input.paymentSetHash, input.metadataSnapshotHash)
        ?? coverage({ date: input.eventDate, paymentSetHash: input.paymentSetHash, metadataSnapshotHash: input.metadataSnapshotHash }),
      details: [detail(input.eventDate, input.paymentSetHash)],
    }))),
    getCoverage: vi.fn(async () => structuredClone(options.existingCoverage ?? null)),
    saveCoverage: vi.fn(async () => undefined),
  } as unknown as JeraAllocationStore & { readDays: ReturnType<typeof vi.fn>; getCoverage: ReturnType<typeof vi.fn>; saveCoverage: ReturnType<typeof vi.fn> }
  const queue = {
    enqueue: vi.fn(async () => ({ taskName: 'task-1', alreadyExists: false, live: true })),
  } as JeraAllocationTaskQueuePort
  const lease = {
    claim: vi.fn(async (input: { dayKey: string; owner: string; now: string; ttlMs: number }) => ({
      dayKey: input.dayKey,
      owner: input.owner,
      fencingToken: '77',
      expiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString(),
    })),
    renew: vi.fn(),
    assertCurrent: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
  }
  const service = createJeraFinanceService({
    coordinator, allocationStore, allocationQueue: queue, lease,
    categoryMoneyEnabled: options.categoryMoneyEnabled ?? true, now: () => new Date(now),
  })
  return { service, coordinator, allocationStore, queue, lease }
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
    branchUuid: BRANCH, eventDate: input.date,
    paymentCacheKey: jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: input.date, endDate: input.date }),
    productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', { branchUuid: BRANCH, startDate: input.date, endDate: input.date }),
    paymentSetHash: input.paymentSetHash,
    paymentRowCount: 1, successfulDetailCount: 1, metadataSnapshotHash: input.metadataSnapshotHash,
    paymentLastSuccessAt: input.paymentLastSuccessAt ?? '2026-08-29T10:00:00.000Z',
    productSalesLastSuccessAt: input.productSalesLastSuccessAt ?? '2026-08-29T10:00:00.000Z',
    cursor: 1, status: 'COMPLETE', lastAttemptAt: '2026-08-29T10:00:00.000Z',
    lastSuccessAt: '2026-08-29T10:00:00.000Z', safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
    taskAttempt: 0, productSalesRowCount: 1, leaseFencingToken: null,
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

function currentPaymentSetHash(eventDate: string): string {
  const paymentSourceHash = createHash('sha256').update(`payment:${eventDate}`).digest('hex')
  return createHash('sha256').update(JSON.stringify([[PAYMENT_UUID, paymentSourceHash]])).digest('hex')
}

function currentMetadataSnapshotHash(): string {
  return createHash('sha256').update(JSON.stringify([['ITEM-1', 'SERVICE']])).digest('hex')
}

const BRANCH = '11111111-2222-4333-8444-555555555555'
const PAYMENT_UUID = '10000000-0000-4000-8000-000000000001'
