import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'
import {
  createGoogleExpenseAsyncJobStore,
  type ExpenseAsyncJobInput,
} from '../../server/pmc-mini-app/finance/asyncJobStore'

const ACCEPTED_AT = '2026-09-01T18:00:00.000Z'
const TASK_NAME = 'projects/project-1/locations/asia-southeast1/queues/pmc-expense-finalize/tasks/expense-1'

describe('generation-fenced async expense job store', () => {
  it('creates one canonical job, replays exact input, and rejects a changed fingerprint', async () => {
    const fake = fakeStorage()
    const store = createGoogleExpenseAsyncJobStore({
      bucketName: 'pmc-expense-async-jobs',
      storage: fake.storage,
      now: () => ACCEPTED_AT,
    })

    const first = await store.createOrRead(jobInput())
    const replay = await store.createOrRead(structuredClone(jobInput()))

    expect(first).toMatchObject({
      created: true,
      job: {
        version: 1,
        objectKey: 'expense-async-jobs/v1/expense-async-root-1.json',
        generation: '1',
        rootRequestId: 'expense-async-root-1',
        staffId: 'ADMIN_03',
        state: 'QUEUING',
        taskName: null,
        attemptCount: 0,
        leaseOwnerToken: null,
        leaseExpiresAt: null,
        receipt: null,
        safeErrorCode: null,
      },
    })
    expect(replay.created).toBe(false)
    expect(replay.job).toEqual(first.job)
    await expect(store.createOrRead({
      ...jobInput(),
      submission: { ...jobInput().submission, amountSatang: 12_345 },
    })).rejects.toMatchObject({ code: 'EXPENSE_IDEMPOTENCY_CONFLICT' })
  })

  it('fences queue, live processing lease, expired takeover, renew, and terminal replay', async () => {
    const fake = fakeStorage()
    let now = Date.parse(ACCEPTED_AT)
    const first = createGoogleExpenseAsyncJobStore({
      bucketName: 'pmc-expense-async-jobs', storage: fake.storage,
      now: () => new Date(now).toISOString(),
    })
    const second = createGoogleExpenseAsyncJobStore({
      bucketName: 'pmc-expense-async-jobs', storage: fake.storage,
      now: () => new Date(now).toISOString(),
    })
    const created = (await first.createOrRead(jobInput())).job
    const queued = await first.markQueued(created, TASK_NAME)
    expect(queued).toMatchObject({ state: 'QUEUED', generation: '2' })

    const claimed = await first.claim({
      rootRequestId: created.rootRequestId,
      fingerprint: created.fingerprint,
      ownerToken: 'expense-worker-owner-a',
      leaseExpiresAt: '2026-09-01T18:04:00.000Z',
      taskAttempt: 0,
    })
    expect(claimed).toMatchObject({
      state: 'PROCESSING',
      leaseOwnerToken: 'expense-worker-owner-a', attemptCount: 1, generation: '3',
    })
    await expect(second.claim({
      rootRequestId: created.rootRequestId,
      fingerprint: created.fingerprint,
      ownerToken: 'expense-worker-owner-b',
      leaseExpiresAt: '2026-09-01T18:04:30.000Z',
      taskAttempt: 1,
    })).rejects.toMatchObject({ code: 'EXPENSE_ASYNC_JOB_LEASE_UNAVAILABLE' })

    now = Date.parse(claimed.leaseExpiresAt!)
    const takeover = await second.claim({
      rootRequestId: created.rootRequestId,
      fingerprint: created.fingerprint,
      ownerToken: 'expense-worker-owner-b',
      leaseExpiresAt: '2026-09-01T18:08:00.000Z',
      taskAttempt: 1,
    })
    expect(takeover).toMatchObject({ leaseOwnerToken: 'expense-worker-owner-b', attemptCount: 2, generation: '4' })
    const renewed = await second.renew(takeover, '2026-09-01T18:09:00.000Z')
    expect(renewed).toMatchObject({ state: 'PROCESSING', generation: '5', leaseExpiresAt: '2026-09-01T18:09:00.000Z' })
    const committed = await second.commit(renewed, receipt())
    expect(committed).toMatchObject({ state: 'COMMITTED', generation: '6', receipt: receipt() })
    await expect(second.commit(committed, receipt())).resolves.toEqual(committed)
    await expect(second.fail(committed, 'EXPENSE_STORAGE_UNAVAILABLE'))
      .rejects.toMatchObject({ code: 'EXPENSE_ASYNC_JOB_TERMINAL' })
  })

  it('rejects stale generations and malformed persisted jobs without overwriting them', async () => {
    const fake = fakeStorage()
    const first = createGoogleExpenseAsyncJobStore({ bucketName: 'pmc-expense-async-jobs', storage: fake.storage, now: () => ACCEPTED_AT })
    const second = createGoogleExpenseAsyncJobStore({ bucketName: 'pmc-expense-async-jobs', storage: fake.storage, now: () => ACCEPTED_AT })
    const stale = (await first.createOrRead(jobInput())).job
    await second.markQueued(stale, TASK_NAME)
    await expect(first.markQueued(stale, TASK_NAME))
      .rejects.toMatchObject({ code: 'EXPENSE_ASYNC_JOB_STALE' })

    fake.putRaw('expense-async-jobs/v1/broken-root.json', Buffer.from('{"version":1}'), {
      contentType: 'application/json', cacheControl: 'no-store',
    })
    await expect(first.read('broken-root'))
      .rejects.toMatchObject({ code: 'EXPENSE_ASYNC_JOB_INVALID' })

    const secondInput = jobInput()
    secondInput.submission.rootRequestId = 'expense-async-root-2'
    secondInput.submission.stagingReceipts[0]!.objectKey =
      `expenses/expense-async-root-2/1-${'a'.repeat(64)}.jpg`
    const exact = (await first.createOrRead(secondInput)).job
    fake.addPersistedField(exact.objectKey, 'unexpected', true)
    await expect(first.read('expense-async-root-2'))
      .rejects.toMatchObject({ code: 'EXPENSE_ASYNC_JOB_INVALID' })
  })
})

function jobInput(): ExpenseAsyncJobInput {
  return {
    kind: 'CREATE',
    replacementOfExpenseId: null,
    expectedVersion: null,
    acceptedAt: ACCEPTED_AT,
    submission: {
      rootRequestId: 'expense-async-root-1',
      staffId: 'ADMIN_03',
      expenseDate: '2026-09-01',
      category: 'BILL_DOCUMENT',
      amountSatang: 12_000,
      counterpartyName: 'ร้านทดสอบ',
      description: 'อุปกรณ์สำนักงาน',
      paymentMethod: 'TRANSFER',
      expectedRevision: 0,
      stagingReceipts: [{
        objectKey: `expenses/expense-async-root-1/1-${'a'.repeat(64)}.jpg`,
        sizeBytes: 123,
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        ordinal: 1,
        originalFileName: 'receipt.jpg',
        createdAt: ACCEPTED_AT,
      }],
    },
  }
}

function receipt() {
  return {
    expenseId: 'EXP-202609-0001',
    receiptNumber: 'EXP-202609-0001',
    expenseDate: '2026-09-01',
    monthKey: '2026-09',
    category: 'BILL_DOCUMENT' as const,
    scope: 'CLINIC' as const,
    amountSatang: 12_000,
    recordState: 'COMMITTED' as const,
    revision: 1,
    committedAt: '2026-09-01T18:02:00.000Z',
    unreviewed: true as const,
  }
}

function fakeStorage() {
  type Stored = { bytes: Buffer; metadata: Record<string, unknown>; generation: number }
  type SaveOptions = {
    preconditionOpts?: { ifGenerationMatch?: string | number }
    metadata?: Record<string, unknown>
  }
  const objects = new Map<string, Stored>()
  const file = (objectKey: string) => ({
    async save(bytes: Buffer, options: SaveOptions) {
      const expected = String(options.preconditionOpts?.ifGenerationMatch ?? '')
      const current = objects.get(objectKey)
      if ((expected === '0' && current) || (expected !== '0' && (!current || String(current.generation) !== expected))) {
        throw Object.assign(new Error('precondition'), { code: 412 })
      }
      const generation = (current?.generation ?? 0) + 1
      objects.set(objectKey, {
        bytes: Buffer.from(bytes),
        generation,
        metadata: {
          ...options.metadata,
          name: objectKey,
          size: String(bytes.length),
          generation: String(generation),
        },
      })
    },
    async getMetadata() {
      const current = objects.get(objectKey)
      if (!current) throw Object.assign(new Error('missing'), { code: 404 })
      return [{ ...current.metadata }]
    },
    async download() {
      const current = objects.get(objectKey)
      if (!current) throw Object.assign(new Error('missing'), { code: 404 })
      return [Buffer.from(current.bytes)]
    },
  })
  return {
    storage: {
      bucket: () => ({ file }),
    } as unknown as Storage,
    putRaw(objectKey: string, bytes: Buffer, metadata: Record<string, unknown>) {
      objects.set(objectKey, {
        bytes: Buffer.from(bytes),
        generation: 1,
        metadata: { ...metadata, name: objectKey, size: String(bytes.length), generation: '1' },
      })
    },
    addPersistedField(objectKey: string, key: string, value: unknown) {
      const current = objects.get(objectKey)
      if (!current) throw new Error('missing fake object')
      const parsed = JSON.parse(current.bytes.toString('utf8')) as Record<string, unknown>
      parsed[key] = value
      const bytes = Buffer.from(JSON.stringify(parsed), 'utf8')
      current.bytes = bytes
      current.metadata = { ...current.metadata, size: String(bytes.length) }
    },
  }
}
