import { describe, expect, it, vi } from 'vitest'
import type { ExpenseReceipt } from '../../shared/pmcExpense'
import type { ExpenseAsyncJob, ExpenseAsyncJobStore } from '../../server/pmc-mini-app/finance/asyncJobStore'
import {
  createExpenseAsyncWorker,
  ExpenseAsyncWorkerError,
} from '../../server/pmc-mini-app/finance/asyncWorker'

describe('leased async expense worker', () => {
  it('commits one submission and replays the terminal job without submitting twice', async () => {
    const jobs = fakeJobs()
    const submission = { submit: vi.fn(async () => receipt()) }
    const worker = createExpenseAsyncWorker({
      jobs: jobs.port,
      submission,
      now: tickingClock(),
      ownerToken: () => 'expense-worker-owner-a',
    })

    await expect(worker.finalize({ rootRequestId: root(), fingerprint: jobs.job.fingerprint, attempt: 0 }))
      .resolves.toEqual({ rootRequestId: root(), state: 'COMMITTED' })
    expect(jobs.job.state).toBe('COMMITTED')
    expect(jobs.job.receipt).toEqual(receipt())

    await expect(worker.finalize({ rootRequestId: root(), fingerprint: jobs.job.fingerprint, attempt: 1 }))
      .resolves.toEqual({ rootRequestId: root(), state: 'COMMITTED' })
    expect(submission.submit).toHaveBeenCalledTimes(1)
  })

  it('persists retryable uncertainty and stops at NEEDS_REVIEW on the eighth delivery', async () => {
    const retry = Object.assign(new Error('storage'), {
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    const firstJobs = fakeJobs()
    const firstWorker = createExpenseAsyncWorker({
      jobs: firstJobs.port,
      submission: { submit: vi.fn(async () => { throw retry }) },
      now: tickingClock(),
      ownerToken: () => 'expense-worker-owner-a',
    })
    await expect(firstWorker.finalize({
      rootRequestId: root(), fingerprint: firstJobs.job.fingerprint, attempt: 0,
    })).rejects.toBeInstanceOf(ExpenseAsyncWorkerError)
    expect(firstJobs.job).toMatchObject({ state: 'RETRYING', safeErrorCode: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const finalJobs = fakeJobs()
    const finalWorker = createExpenseAsyncWorker({
      jobs: finalJobs.port,
      submission: { submit: vi.fn(async () => { throw retry }) },
      now: tickingClock(),
      ownerToken: () => 'expense-worker-owner-b',
    })
    await expect(finalWorker.finalize({
      rootRequestId: root(), fingerprint: finalJobs.job.fingerprint, attempt: 7,
    })).resolves.toEqual({ rootRequestId: root(), state: 'NEEDS_REVIEW' })
    expect(finalJobs.job).toMatchObject({ state: 'NEEDS_REVIEW', safeErrorCode: 'EXPENSE_NEEDS_REVIEW' })
  })

  it('records deterministic financial conflicts as terminal FAILED without task retry', async () => {
    const jobs = fakeJobs()
    const conflict = Object.assign(new Error('conflict'), {
      code: 'EXPENSE_REVISION_CONFLICT', retryable: false,
    })
    const worker = createExpenseAsyncWorker({
      jobs: jobs.port,
      submission: { submit: vi.fn(async () => { throw conflict }) },
      now: tickingClock(),
      ownerToken: () => 'expense-worker-owner-a',
    })

    await expect(worker.finalize({ rootRequestId: root(), fingerprint: jobs.job.fingerprint, attempt: 0 }))
      .resolves.toEqual({ rootRequestId: root(), state: 'FAILED' })
    expect(jobs.job).toMatchObject({ state: 'FAILED', safeErrorCode: 'EXPENSE_REVISION_CONFLICT' })
  })

  it('fails retryably when lease ownership is lost after the financial operation', async () => {
    const jobs = fakeJobs()
    const originalRenew = jobs.port.renew
    let renews = 0
    jobs.port.renew = vi.fn(async (job, expiresAt) => {
      renews += 1
      if (renews === 2) throw Object.assign(new Error('stale'), { code: 'EXPENSE_ASYNC_JOB_STALE' })
      return originalRenew(job, expiresAt)
    })
    const worker = createExpenseAsyncWorker({
      jobs: jobs.port,
      submission: { submit: vi.fn(async () => receipt()) },
      now: tickingClock(),
      ownerToken: () => 'expense-worker-owner-a',
    })

    await expect(worker.finalize({ rootRequestId: root(), fingerprint: jobs.job.fingerprint, attempt: 0 }))
      .rejects.toBeInstanceOf(ExpenseAsyncWorkerError)
    expect(jobs.job.state).toBe('PROCESSING')
  })
})

function fakeJobs() {
  let job = queuedJob()
  const port: ExpenseAsyncJobStore = {
    createOrRead: vi.fn(),
    markQueued: vi.fn(),
    read: vi.fn(async () => structuredClone(job)),
    claim: vi.fn(async (input) => {
      if (['COMMITTED', 'FAILED', 'NEEDS_REVIEW'].includes(job.state)) return structuredClone(job)
      job = {
        ...job,
        state: 'PROCESSING',
        attemptCount: input.taskAttempt + 1,
        leaseOwnerToken: input.ownerToken,
        leaseExpiresAt: input.leaseExpiresAt,
        generation: String(Number(job.generation) + 1),
      }
      return structuredClone(job)
    }),
    renew: vi.fn(async (current, leaseExpiresAt) => {
      job = { ...current, leaseExpiresAt, generation: String(Number(current.generation) + 1) }
      return structuredClone(job)
    }),
    markRetrying: vi.fn(async (current, safeErrorCode) => {
      job = {
        ...current, state: 'RETRYING', safeErrorCode,
        leaseOwnerToken: null, leaseExpiresAt: null,
        generation: String(Number(current.generation) + 1),
      }
      return structuredClone(job)
    }),
    commit: vi.fn(async (current, committed) => {
      job = {
        ...current, state: 'COMMITTED', receipt: committed, safeErrorCode: null,
        leaseOwnerToken: null, leaseExpiresAt: null,
        generation: String(Number(current.generation) + 1),
      }
      return structuredClone(job)
    }),
    fail: vi.fn(async (current, safeErrorCode) => {
      job = {
        ...current, state: 'FAILED', safeErrorCode,
        leaseOwnerToken: null, leaseExpiresAt: null,
        generation: String(Number(current.generation) + 1),
      }
      return structuredClone(job)
    }),
    needsReview: vi.fn(async (current) => {
      job = {
        ...current, state: 'NEEDS_REVIEW', safeErrorCode: 'EXPENSE_NEEDS_REVIEW',
        leaseOwnerToken: null, leaseExpiresAt: null,
        generation: String(Number(current.generation) + 1),
      }
      return structuredClone(job)
    }),
  }
  return { port, get job() { return job } }
}

function queuedJob(): ExpenseAsyncJob {
  return {
    version: 1,
    objectKey: `expense-async-jobs/v1/${root()}.json`,
    generation: '2',
    rootRequestId: root(),
    staffId: 'ADMIN_03',
    fingerprint: 'a'.repeat(64),
    kind: 'CREATE',
    replacementOfExpenseId: null,
    expectedVersion: null,
    acceptedAt: '2026-09-01T18:00:00.000Z',
    submission: {
      rootRequestId: root(), staffId: 'ADMIN_03', expenseDate: '2026-09-01',
      category: 'BILL_DOCUMENT', amountSatang: 12_000, counterpartyName: 'ร้านทดสอบ',
      description: '', paymentMethod: 'TRANSFER', expectedRevision: 0,
      stagingReceipts: [{
        objectKey: `expenses/${root()}/1-${'a'.repeat(64)}.jpg`, sizeBytes: 10,
        mimeType: 'image/jpeg', sha256: 'a'.repeat(64), ordinal: 1,
        originalFileName: 'receipt.jpg', createdAt: '2026-09-01T18:00:00.000Z',
      }],
    },
    state: 'QUEUED',
    taskName: 'projects/project-1/locations/asia-southeast1/queues/pmc-expense-finalize/tasks/expense-1',
    createdAt: '2026-09-01T18:00:00.000Z',
    updatedAt: '2026-09-01T18:00:00.000Z',
    attemptCount: 0,
    leaseOwnerToken: null,
    leaseExpiresAt: null,
    receipt: null,
    safeErrorCode: null,
  }
}

function receipt(): ExpenseReceipt {
  return {
    expenseId: 'EXP-202609-0001', receiptNumber: 'EXP-202609-0001',
    expenseDate: '2026-09-01', monthKey: '2026-09', category: 'BILL_DOCUMENT',
    scope: 'CLINIC', amountSatang: 12_000, recordState: 'COMMITTED', revision: 1,
    committedAt: '2026-09-01T18:02:00.000Z', unreviewed: true,
  }
}

function tickingClock(): () => Date {
  let now = Date.parse('2026-09-01T18:00:00.000Z')
  return () => new Date(now += 1_000)
}

function root(): string {
  return 'expense-async-root-1'
}
