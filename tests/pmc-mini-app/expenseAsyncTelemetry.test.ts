import { describe, expect, it, vi } from 'vitest'
import {
  createExpenseAsyncTelemetry,
  expenseAsyncEvent,
} from '../../server/pmc-mini-app/finance/asyncTelemetry'

describe('async expense telemetry', () => {
  it('emits only the strict aggregate lifecycle projection', () => {
    expect(expenseAsyncEvent('expense_worker_completed', {
      route: 'worker', action: 'complete', status: 200,
      attempt: 2, state: 'COMMITTED', elapsedMs: 1_204, fileCount: 1,
    })).toEqual({
      event: 'expense_worker_completed',
      route: 'worker', action: 'complete', status: 200,
      attempt: 2, state: 'COMMITTED', elapsedMs: 1_204, fileCount: 1,
    })
  })

  it.each([
    ['amount', { route: 'worker', action: 'retry', status: 503, amountSatang: 100 }],
    ['merchant', { route: 'worker', action: 'retry', status: 503, counterpartyName: 'private' }],
    ['root ID', { route: 'worker', action: 'retry', status: 503, rootRequestId: 'private' }],
    ['file ID', { route: 'worker', action: 'retry', status: 503, fileId: 'private' }],
    ['nested detail', { route: 'worker', action: 'retry', status: 503, detail: { note: 'private' } }],
    ['bad state', { route: 'worker', action: 'retry', status: 503, state: 'UNKNOWN' }],
    ['bad action', { route: 'worker', action: 'complete', status: 503 }],
    ['negative timing', { route: 'worker', action: 'retry', status: 503, elapsedMs: -1 }],
  ])('rejects %s', (_name, fields) => {
    expect(() => expenseAsyncEvent('expense_worker_retrying', fields as never))
      .toThrow('EXPENSE_ASYNC_TELEMETRY_INVALID')
  })

  it('never lets telemetry failure alter the worker path', () => {
    const write = vi.fn(() => { throw new Error('log unavailable') })
    const telemetry = createExpenseAsyncTelemetry(write)
    expect(() => telemetry('expense_job_accepted', {
      route: 'submit', action: 'accept', status: 202, state: 'QUEUED', elapsedMs: 20,
    })).not.toThrow()
  })
})
