import { createHash } from 'node:crypto'
import type { CloudTasksClient } from '@google-cloud/tasks'
import { describe, expect, it, vi } from 'vitest'
import { JeraReadError } from '../../server/jera/client'
import type { JeraNormalizedRow, JeraReadPort } from '../../server/jera/contracts'
import type { JeraAllocationLease, JeraAllocationLeasePort } from '../../server/jera/allocationLeaseStore'
import type { JeraAllocationCoverage, JeraAllocationStore, JeraCachedPaymentDetail } from '../../server/jera/allocationStore'
import { createGoogleJeraAllocationTaskQueue, type JeraAllocationTaskQueuePort } from '../../server/jera/allocationTaskQueue'
import { createJeraAllocationWorker } from '../../server/jera/allocationWorker'
import { jeraCacheKey } from '../../server/jera/cacheKey'
import type { JeraReportStore } from '../../server/jera/store'

const BRANCH = '11111111-2222-4333-8444-555555555555'
const DATE = '2026-08-29'
const START = Date.parse('2026-08-29T10:00:00.000Z')

describe('resumable JERA payment-detail worker', () => {
  it('keeps one request in flight, paces attempts by 3 seconds, caps at 20, then continues from cursor 20', async () => {
    const harness = workerHarness(21)
    let active = 0
    let maxActive = 0
    harness.client.request.mockImplementation(async (_type, filters) => {
      harness.attemptTimes.push(harness.clockMs)
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return [detailPayload(filters.paymentUuid!)]
    })

    const result = await harness.worker.run(task(harness.paymentSetHash, 7))

    expect(result).toEqual({ status: 'CONTINUED', processed: 20, nextCursor: 20 })
    expect(maxActive).toBe(1)
    expect(harness.client.request).toHaveBeenCalledTimes(20)
    expect(harness.attemptTimes).toHaveLength(20)
    expect(harness.attemptTimes.slice(1).every((value, index) => value - harness.attemptTimes[index]! >= 3_000)).toBe(true)
    expect([...new Set(harness.coverageWrites.filter((row) => row.cursor > 0).map((row) => row.cursor))])
      .toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(harness.queue.enqueue).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: DATE, paymentSetHash: harness.paymentSetHash, cursor: 20, attempt: 0,
      scheduleAt: new Date(harness.clockMs + 60_000),
    })
  })

  it('skips an identical detail without a provider call and stores complete source evidence', async () => {
    const harness = workerHarness(1)
    harness.details.push(cachedDetail(harness.payments[0]!))

    await expect(harness.worker.run(task(harness.paymentSetHash))).resolves.toEqual({ status: 'COMPLETE', processed: 0, nextCursor: null })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(harness.coverage).toMatchObject({
      paymentRowCount: 1, successfulDetailCount: 1, paymentSetHash: harness.paymentSetHash,
      metadataSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      paymentLastSuccessAt: '2026-08-29T09:58:00.000Z',
      productSalesLastSuccessAt: '2026-08-29T09:59:00.000Z', status: 'COMPLETE', cursor: 1,
    })
  })

  it('turns final Retry-After into a durable continuation no earlier than 60 seconds', async () => {
    const harness = workerHarness(1)
    harness.client.request.mockRejectedValueOnce(new JeraReadError('JERA_RATE_LIMITED', 95))

    await expect(harness.worker.run(task(harness.paymentSetHash))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    expect(harness.coverage).toMatchObject({ cursor: 0, status: 'INCOMPLETE', safeErrorCode: 'JERA_RATE_LIMITED' })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      cursor: 0, attempt: 1, scheduleAt: new Date(harness.clockMs + 95_000),
    }))
  })

  it('resets changed payment-set coverage and seeds cursor zero without deleting detail evidence', async () => {
    const harness = workerHarness(2)
    const historical = cachedDetail(harness.payments[0]!)
    harness.details.push(historical)
    harness.coverage = coverage({ paymentSetHash: 'f'.repeat(64), cursor: 9, status: 'COMPLETE' })

    await expect(harness.worker.run(task('f'.repeat(64)))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.details).toContainEqual(historical)
    expect(harness.coverage).toMatchObject({ paymentSetHash: harness.paymentSetHash, cursor: 0, status: 'INCOMPLETE' })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ paymentSetHash: harness.paymentSetHash, cursor: 0 }))
  })

  it('makes a complete task replay an idempotent zero-provider skip', async () => {
    const harness = workerHarness(1)
    harness.coverage = coverage({ paymentSetHash: harness.paymentSetHash, paymentRowCount: 1, successfulDetailCount: 1, cursor: 1, status: 'COMPLETE' })

    await expect(harness.worker.run(task(harness.paymentSetHash))).resolves.toEqual({ status: 'SKIPPED', processed: 0, nextCursor: null })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
  })

  it('treats a lease conflict as a no-op and releases only the exact claimed fencing token', async () => {
    const conflict = workerHarness(1, { claim: null })
    await expect(conflict.worker.run(task(conflict.paymentSetHash))).resolves.toEqual({ status: 'SKIPPED', processed: 0, nextCursor: null })
    expect(conflict.client.request).not.toHaveBeenCalled()

    const harness = workerHarness(1)
    await harness.worker.run(task(harness.paymentSetHash))
    expect(harness.lease.release).toHaveBeenCalledOnce()
    expect(harness.lease.release).toHaveBeenCalledWith(harness.claimedLease)
    expect(vi.mocked(harness.lease.release).mock.calls[0]![0].fencingToken).toBe('77')
  })

  it('fails closed when a claimed lease loses its fencing token', async () => {
    const harness = workerHarness(1, { claim: { dayKey: dayKey(), owner: 'worker-1', expiresAt: new Date(START + 300_000).toISOString() } as JeraAllocationLease })

    await expect(harness.worker.run(task(harness.paymentSetHash))).resolves.toEqual({ status: 'SKIPPED', processed: 0, nextCursor: null })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.lease.release).not.toHaveBeenCalled()
  })

  it('persists only a safe JERA code for unexpected provider errors', async () => {
    const harness = workerHarness(1)
    harness.client.request.mockRejectedValueOnce(Object.assign(new Error('private-provider-detail'), { body: { patient: 'private' } }))
    await harness.worker.run(task(harness.paymentSetHash))

    expect(harness.coverage?.safeErrorCode).toBe('JERA_PROVIDER_FAILED')
    expect(JSON.stringify(harness.coverage)).not.toContain('private-provider-detail')
    expect(JSON.stringify(harness.coverage)).not.toContain('patient')
  })

  it('uses a distinct next attempt after failure and allows that successor to complete the same cursor', async () => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com', client: fakeTasksClient(createTask),
    })
    const harness = workerHarness(1, { queue })
    harness.client.request
      .mockRejectedValueOnce(new JeraReadError('JERA_PROVIDER_FAILED'))
      .mockResolvedValueOnce([detailPayload(harness.payments[0]!.sourceUuid)])

    await queue.enqueue({ branchUuid: BRANCH, eventDate: DATE, paymentSetHash: harness.paymentSetHash, cursor: 0, attempt: 0, scheduleAt: new Date(START) })
    await expect(harness.worker.run(task(harness.paymentSetHash, 0))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    const [current, retry] = createTask.mock.calls.map(([request]) => request.task!)
    expect(retry!.name).not.toBe(current!.name)
    expect(JSON.parse(Buffer.from(retry!.httpRequest!.body!).toString('utf8'))).toMatchObject({ cursor: 0, attempt: 1 })
    await expect(harness.worker.run(task(harness.paymentSetHash, 1))).resolves.toEqual({ status: 'COMPLETE', processed: 1, nextCursor: null })
    expect(harness.client.request).toHaveBeenCalledTimes(2)
    expect(harness.coverage).toMatchObject({ cursor: 1, status: 'COMPLETE', safeErrorCode: null })
  })

  it.each(['payment', 'product'] as const)('keeps coverage incomplete when %s source success evidence is missing', async (source) => {
    const harness = workerHarness(1)
    harness.details.push(cachedDetail(harness.payments[0]!))
    if (source === 'payment') harness.paymentState.lastSuccessAt = null
    else harness.productState.lastSuccessAt = null

    await expect(harness.worker.run(task(harness.paymentSetHash, 2))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.coverage).toMatchObject({ status: 'INCOMPLETE', safeErrorCode: 'JERA_ALLOCATION_SOURCE_INCOMPLETE' })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ cursor: 0, attempt: 3 }))
  })

  it('turns a transient source read failure into a distinct durable retry attempt', async () => {
    const harness = workerHarness(1)
    harness.reportStore.readSnapshots.mockRejectedValueOnce(new Error('private-sheets-failure'))

    await expect(harness.worker.run(task(harness.paymentSetHash, 4))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ cursor: 0, attempt: 5 }))
  })

  it('turns a missing source snapshot into a distinct durable retry attempt', async () => {
    const harness = workerHarness(1)
    harness.reportStore.readSnapshots.mockResolvedValueOnce([])

    await expect(harness.worker.run(task(harness.paymentSetHash, 8))).resolves.toEqual({ status: 'CONTINUED', processed: 0, nextCursor: 0 })
    expect(harness.client.request).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ cursor: 0, attempt: 9 }))
  })
})

function workerHarness(count: number, leasePatch: { claim?: JeraAllocationLease | null; queue?: JeraAllocationTaskQueuePort } = {}) {
  let clockMs = START
  const attemptTimes: number[] = []
  const payments = Array.from({ length: count }, (_, index) => payment(index + 1))
  const paymentSetHash = setHash(payments)
  const details: JeraCachedPaymentDetail[] = []
  let currentCoverage: JeraAllocationCoverage | null = null
  const coverageWrites: JeraAllocationCoverage[] = []
  const claimedLease = leasePatch.claim === undefined
    ? { dayKey: dayKey(), owner: 'worker-1', fencingToken: '77', expiresAt: new Date(START + 300_000).toISOString() }
    : leasePatch.claim
  const lease: JeraAllocationLeasePort = {
    claim: vi.fn(async () => claimedLease),
    release: vi.fn(async () => undefined),
  }
  const client = { request: vi.fn(async (_type, filters) => [detailPayload(filters.paymentUuid!)]) } as unknown as JeraReadPort & { request: ReturnType<typeof vi.fn> }
  const queue = (leasePatch.queue ?? { enqueue: vi.fn(async () => ({ taskName: 'task', alreadyExists: false })) }) as JeraAllocationTaskQueuePort & { enqueue: ReturnType<typeof vi.fn> }
  const allocationStore: JeraAllocationStore = {
    replacePaymentDetail: vi.fn(async (detail) => {
      const index = details.findIndex((stored) => stored.paymentUuid === detail.paymentUuid)
      if (index >= 0) details[index] = structuredClone(detail); else details.push(structuredClone(detail))
    }),
    readDay: vi.fn(async () => ({ coverage: currentCoverage?.paymentSetHash === paymentSetHash ? structuredClone(currentCoverage) : null, details: structuredClone(details) })),
    getCoverage: vi.fn(async () => structuredClone(currentCoverage)),
    saveCoverage: vi.fn(async (value) => { currentCoverage = structuredClone(value); coverageWrites.push(structuredClone(value)) }),
    listIncompleteCoverage: vi.fn(async () => []),
  }
  const paymentState: { lastSuccessAt: string | null } = { lastSuccessAt: '2026-08-29T09:58:00.000Z' }
  const productState: { lastSuccessAt: string | null } = { lastSuccessAt: '2026-08-29T09:59:00.000Z' }
  const reportStore = {
    readSnapshots: vi.fn(async () => [
      { query: {}, rows: structuredClone(payments), state: structuredClone(paymentState) },
      { query: {}, rows: [productSales()], state: structuredClone(productState) },
    ]),
  } as unknown as JeraReportStore & { readSnapshots: ReturnType<typeof vi.fn> }
  const worker = createJeraAllocationWorker({
    client, reportStore, allocationStore, lease, queue, maxDetailsPerRun: 20, continuationDelaySeconds: 60,
    now: () => new Date(clockMs),
    sleep: async (milliseconds) => { clockMs += milliseconds },
  })
  return {
    worker, client, queue, lease, claimedLease, payments, paymentSetHash, details, coverageWrites, attemptTimes, paymentState, productState, reportStore,
    get coverage() { return currentCoverage }, set coverage(value) { currentCoverage = value }, get clockMs() { return clockMs },
  }
}

function payment(index: number): JeraNormalizedRow {
  return {
    sourceUuid: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, sourceHash: hash(`payment-${index}`),
    branchUuid: BRANCH, eventDate: DATE, reportType: 'PAYMENT', cacheKey: paymentCacheKey(),
    paymentCode: `PAY-${index}`, type: 'PAYMENT', paidAmountSatang: 10_000, fetchedAt: '2026-08-29T09:58:00.000Z',
  } as JeraNormalizedRow
}

function productSales(): JeraNormalizedRow {
  return { reportType: 'PRODUCT_SALES', itemCode: 'ITEM-1', type: 'service', sourceHash: hash('metadata') } as JeraNormalizedRow
}

function detailPayload(paymentUuid: string) {
  return {
    uuid: paymentUuid, code: 'PAY-SYN', branch_name: 'Synthetic Branch', create_date: `${DATE} 10:00:00`,
    total: '100.00', paid_amount: '100.00',
    patient: { patient_uuid: '20000000-0000-4000-8000-000000000001', patient_code: 'PAT-1', fname: 'Synthetic', lname: 'Patient' },
    payment_methods: [], salespersons: [],
    opds: [{ opd_code: 'OPD-1', opd_create_date: `${DATE} 09:00:00`, total: '100.00', paid_amount: '100.00', items: [
      { code: 'ITEM-1', name: 'Service', action: 'service', price: '100.00', disc_price: '0.00', amount: 1 },
    ] }], courses: [],
  }
}

function cachedDetail(row: JeraNormalizedRow): JeraCachedPaymentDetail {
  return {
    detailKey: createHash('sha256').update(JSON.stringify([BRANCH, DATE, row.sourceUuid, row.sourceHash])).digest('hex'),
    branchUuid: BRANCH, eventDate: DATE, paymentUuid: row.sourceUuid, paymentSourceHash: row.sourceHash,
    detailSourceHash: hash('detail'), detailFetchedAt: '2026-08-29T09:59:00.000Z', lineCount: 1, truncated: false,
    lines: [{ lineOrdinal: 0, lineKind: 'OPD', itemCode: 'ITEM-1', netLineSatang: 10_000 }],
  }
}

function coverage(patch: Partial<JeraAllocationCoverage>): JeraAllocationCoverage {
  return {
    dayKey: dayKey(), branchUuid: BRANCH, eventDate: DATE, paymentCacheKey: paymentCacheKey(), productSalesCacheKey: productCacheKey(),
    paymentSetHash: hash('old'), paymentRowCount: 0, successfulDetailCount: 0, metadataSnapshotHash: hash('metadata'),
    paymentLastSuccessAt: null, productSalesLastSuccessAt: null, cursor: 0, status: 'INCOMPLETE', lastAttemptAt: null,
    lastSuccessAt: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null, ...patch,
  }
}

function task(paymentSetHash: string, attempt = 0) { return { branchUuid: BRANCH, eventDate: DATE, paymentSetHash, cursor: 0, attempt, workerId: 'worker-1' } }
function setHash(rows: JeraNormalizedRow[]): string { return createHash('sha256').update(JSON.stringify(rows.map((row) => [row.sourceUuid, row.sourceHash]).sort())).digest('hex') }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function dayKey(): string { return createHash('sha256').update(JSON.stringify([BRANCH, DATE])).digest('hex') }
function paymentCacheKey(): string { return jeraCacheKey('PAYMENT', { branchUuid: BRANCH, startDate: DATE, endDate: DATE }) }
function productCacheKey(): string { return jeraCacheKey('PRODUCT_SALES', { branchUuid: BRANCH, startDate: DATE, endDate: DATE }) }

function fakeTasksClient(createTask: ReturnType<typeof vi.fn>): CloudTasksClient {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    taskPath: (project: string, location: string, queue: string, taskId: string) => `projects/${project}/locations/${location}/queues/${queue}/tasks/${taskId}`,
    createTask,
  } as unknown as CloudTasksClient
}
