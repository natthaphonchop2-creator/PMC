import { isCanonicalExpenseTimestamp } from './pmcExpense.js'

const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,116}$/
const SHA256 = /^[a-f0-9]{64}$/

export const EXPENSE_ASYNC_JOB_STATES = [
  'QUEUING',
  'QUEUED',
  'PROCESSING',
  'RETRYING',
  'COMMITTED',
  'FAILED',
  'NEEDS_REVIEW',
] as const

export type ExpenseAsyncJobState = typeof EXPENSE_ASYNC_JOB_STATES[number]

export type ExpenseAsyncOperation =
  | { kind: 'CREATE'; replacementOfExpenseId: null; expectedVersion: null }
  | { kind: 'REPLACE'; replacementOfExpenseId: string; expectedVersion: number }

export interface ExpenseAsyncAck {
  rootRequestId: string
  status: 'PENDING'
  acceptedAt: string
}

export interface ExpenseAsyncTaskPayload {
  rootRequestId: string
  fingerprint: string
}

export function parseExpenseAsyncAck(value: unknown): ExpenseAsyncAck {
  if (
    !hasExactKeys(value, ['rootRequestId', 'status', 'acceptedAt'])
    || typeof value.rootRequestId !== 'string'
    || !ROOT_REQUEST_ID.test(value.rootRequestId)
    || value.status !== 'PENDING'
    || !isCanonicalExpenseTimestamp(value.acceptedAt)
  ) throw new Error('EXPENSE_ASYNC_INVALID_ACK')
  return {
    rootRequestId: value.rootRequestId,
    status: 'PENDING',
    acceptedAt: value.acceptedAt,
  }
}

export function parseExpenseAsyncTaskPayload(value: unknown): ExpenseAsyncTaskPayload {
  if (
    !hasExactKeys(value, ['rootRequestId', 'fingerprint'])
    || typeof value.rootRequestId !== 'string'
    || !ROOT_REQUEST_ID.test(value.rootRequestId)
    || typeof value.fingerprint !== 'string'
    || !SHA256.test(value.fingerprint)
  ) throw new Error('EXPENSE_ASYNC_INVALID_TASK')
  return { rootRequestId: value.rootRequestId, fingerprint: value.fingerprint }
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}
