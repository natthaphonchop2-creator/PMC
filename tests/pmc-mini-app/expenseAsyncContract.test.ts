import { describe, expect, it } from 'vitest'
import {
  EXPENSE_ASYNC_JOB_STATES,
  parseExpenseAsyncAck,
  parseExpenseAsyncTaskPayload,
} from '../../shared/pmcExpenseAsync'

describe('async expense shared contract', () => {
  it('accepts the exact pending acknowledgement and rejects terminal or extra fields', () => {
    expect(parseExpenseAsyncAck({
      rootRequestId: 'expense-root-1',
      status: 'PENDING',
      acceptedAt: '2026-09-01T18:00:00.000Z',
    })).toEqual({
      rootRequestId: 'expense-root-1',
      status: 'PENDING',
      acceptedAt: '2026-09-01T18:00:00.000Z',
    })
    expect(() => parseExpenseAsyncAck({
      rootRequestId: 'expense-root-1',
      status: 'COMMITTED',
      acceptedAt: '2026-09-01T18:00:00.000Z',
    })).toThrow('EXPENSE_ASYNC_INVALID_ACK')
    expect(() => parseExpenseAsyncAck({
      rootRequestId: 'expense-root-1',
      status: 'PENDING',
      acceptedAt: '2026-09-01T18:00:00.000Z',
      receipt: {},
    })).toThrow('EXPENSE_ASYNC_INVALID_ACK')
  })

  it('accepts only a root and sha256 fingerprint in the private task payload', () => {
    const valid = {
      rootRequestId: 'expense-root-1',
      fingerprint: 'a'.repeat(64),
    }
    expect(parseExpenseAsyncTaskPayload(valid)).toEqual(valid)
    expect(() => parseExpenseAsyncTaskPayload({ ...valid, amountSatang: 100 }))
      .toThrow('EXPENSE_ASYNC_INVALID_TASK')
    expect(() => parseExpenseAsyncTaskPayload({ ...valid, fingerprint: 'short' }))
      .toThrow('EXPENSE_ASYNC_INVALID_TASK')
  })

  it('publishes the exact persisted state vocabulary', () => {
    expect(EXPENSE_ASYNC_JOB_STATES).toEqual([
      'QUEUING', 'QUEUED', 'PROCESSING', 'RETRYING',
      'COMMITTED', 'FAILED', 'NEEDS_REVIEW',
    ])
  })
})
