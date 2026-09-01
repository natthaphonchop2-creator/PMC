import { randomUUID } from 'node:crypto'
import { isMiniAppExpenseSafeErrorCode, type MiniAppExpenseSafeErrorCode } from '../../../shared/pmcMiniAppExpenseIngress.js'
import type { ExpenseAsyncTelemetry } from './asyncTelemetry.js'
import type { ExpenseAsyncJob, ExpenseAsyncJobStore } from './asyncJobStore.js'
import type { ExpenseSubmissionService } from './submissionService.js'

const ROOT = /^[A-Za-z0-9._:-]{1,116}$/
const SHA256 = /^[a-f0-9]{64}$/
const LEASE_MS = 240_000
const FINAL_PHASE_CUTOFF_MS = 270_000
const MAX_ATTEMPT_INDEX = 7

export interface ExpenseAsyncWorker {
  finalize(input: {
    rootRequestId: string
    fingerprint: string
    attempt: number
  }): Promise<{
    rootRequestId: string
    state: 'COMMITTED' | 'FAILED' | 'NEEDS_REVIEW'
  }>
}

export type ExpenseAsyncWorkerErrorCode =
  | 'EXPENSE_ASYNC_WORKER_INVALID_INPUT'
  | 'EXPENSE_ASYNC_WORKER_RETRY'
  | 'EXPENSE_ASYNC_WORKER_FENCE_LOST'

export class ExpenseAsyncWorkerError extends Error {
  readonly code: ExpenseAsyncWorkerErrorCode
  constructor(code: ExpenseAsyncWorkerErrorCode) {
    super(code)
    this.name = 'ExpenseAsyncWorkerError'
    this.code = code
  }
}

export function createExpenseAsyncWorker(input: {
  jobs: ExpenseAsyncJobStore
  submission: ExpenseSubmissionService
  now: () => Date
  ownerToken?: () => string
  telemetry?: ExpenseAsyncTelemetry
}): ExpenseAsyncWorker {
  const ownerToken = input.ownerToken ?? randomUUID
  const emit = (name: Parameters<ExpenseAsyncTelemetry>[0], fields: Parameters<ExpenseAsyncTelemetry>[1]): void => {
    try { input.telemetry?.(name, fields) } catch { /* telemetry cannot alter worker execution */ }
  }

  function nowDate(): Date {
    const value = input.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid()
    return new Date(value)
  }

  async function renew(job: ExpenseAsyncJob): Promise<ExpenseAsyncJob> {
    const expiry = new Date(nowDate().getTime() + LEASE_MS).toISOString()
    try { return await input.jobs.renew(job, expiry) } catch { throw fenceLost() }
  }

  return {
    async finalize(task) {
      if (!ROOT.test(task.rootRequestId) || !SHA256.test(task.fingerprint)
        || !Number.isSafeInteger(task.attempt) || task.attempt < 0 || task.attempt > MAX_ATTEMPT_INDEX) throw invalid()
      const startedAt = nowDate().getTime()
      const token = ownerToken()
      let job: ExpenseAsyncJob
      try {
        job = await input.jobs.claim({
          rootRequestId: task.rootRequestId,
          fingerprint: task.fingerprint,
          ownerToken: token,
          leaseExpiresAt: new Date(startedAt + LEASE_MS).toISOString(),
          taskAttempt: task.attempt,
        })
      } catch { throw retry() }

      if (job.state === 'COMMITTED' || job.state === 'FAILED' || job.state === 'NEEDS_REVIEW') {
        return { rootRequestId: task.rootRequestId, state: job.state }
      }
      if (job.state !== 'PROCESSING' || job.leaseOwnerToken !== token) throw fenceLost()
      emit('expense_worker_claimed', {
        route: 'worker', action: 'claim', status: 200,
        attempt: task.attempt, state: job.state,
        elapsedMs: elapsed(startedAt, nowDate()), fileCount: job.submission.stagingReceipts.length,
      })

      job = await renew(job)
      if (nowDate().getTime() - startedAt >= FINAL_PHASE_CUTOFF_MS) {
        await markRetry(job, 'EXPENSE_STORAGE_UNAVAILABLE', task.attempt, startedAt)
        throw retry()
      }

      try {
        const receipt = await input.submission.submit(job.submission)
        job = await renew(job)
        const committed = await input.jobs.commit(job, receipt)
        emit('expense_worker_completed', {
          route: 'worker', action: 'complete', status: 200,
          attempt: task.attempt, state: committed.state,
          elapsedMs: elapsed(startedAt, nowDate()), fileCount: job.submission.stagingReceipts.length,
        })
        return { rootRequestId: task.rootRequestId, state: 'COMMITTED' }
      } catch (error) {
        if (error instanceof ExpenseAsyncWorkerError) throw error
        try { job = await renew(job) } catch { throw fenceLost() }
        const classified = classify(error)
        if (!classified.retryable) {
          const failed = await input.jobs.fail(job, classified.code)
          emit('expense_worker_failed', {
            route: 'worker', action: 'fail', status: 200,
            attempt: task.attempt, state: failed.state, safeErrorCode: classified.code,
            elapsedMs: elapsed(startedAt, nowDate()), fileCount: job.submission.stagingReceipts.length,
          })
          return { rootRequestId: task.rootRequestId, state: 'FAILED' }
        }
        if (task.attempt >= MAX_ATTEMPT_INDEX) {
          const review = await input.jobs.needsReview(job)
          emit('expense_worker_needs_review', {
            route: 'worker', action: 'review', status: 200,
            attempt: task.attempt, state: review.state, safeErrorCode: 'EXPENSE_NEEDS_REVIEW',
            elapsedMs: elapsed(startedAt, nowDate()), fileCount: job.submission.stagingReceipts.length,
          })
          return { rootRequestId: task.rootRequestId, state: 'NEEDS_REVIEW' }
        }
        await markRetry(job, classified.code, task.attempt, startedAt)
        throw retry()
      }
    },
  }

  async function markRetry(
    job: ExpenseAsyncJob,
    code: MiniAppExpenseSafeErrorCode,
    attempt: number,
    startedAt: number,
  ): Promise<void> {
    const retrying = await input.jobs.markRetrying(job, code)
    emit('expense_worker_retrying', {
      route: 'worker', action: 'retry', status: 503,
      attempt, state: retrying.state, safeErrorCode: code,
      elapsedMs: elapsed(startedAt, nowDate()), fileCount: job.submission.stagingReceipts.length,
    })
  }
}

function classify(error: unknown): { code: MiniAppExpenseSafeErrorCode; retryable: boolean } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (isMiniAppExpenseSafeErrorCode(code)) {
    const explicitRetry = 'retryable' in (error as object)
      && (error as { retryable?: unknown }).retryable === true
    return {
      code,
      retryable: explicitRetry || code === 'EXPENSE_STORAGE_UNAVAILABLE',
    }
  }
  return { code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true }
}

function elapsed(startedAt: number, now: Date): number {
  return Math.max(0, Math.round(now.getTime() - startedAt))
}

function invalid(): ExpenseAsyncWorkerError {
  return new ExpenseAsyncWorkerError('EXPENSE_ASYNC_WORKER_INVALID_INPUT')
}

function retry(): ExpenseAsyncWorkerError {
  return new ExpenseAsyncWorkerError('EXPENSE_ASYNC_WORKER_RETRY')
}

function fenceLost(): ExpenseAsyncWorkerError {
  return new ExpenseAsyncWorkerError('EXPENSE_ASYNC_WORKER_FENCE_LOST')
}
