import { isMiniAppExpenseSafeErrorCode } from '../../../shared/pmcMiniAppExpenseIngress.js'

export type ExpenseAsyncEventName =
  | 'expense_job_accepted'
  | 'expense_task_enqueued'
  | 'expense_worker_claimed'
  | 'expense_prepare_completed'
  | 'expense_evidence_completed'
  | 'expense_commit_completed'
  | 'expense_worker_retrying'
  | 'expense_worker_completed'
  | 'expense_worker_failed'
  | 'expense_worker_needs_review'

export type ExpenseAsyncEventFields = {
  route: 'submit' | 'worker'
  action: 'accept' | 'enqueue' | 'claim' | 'prepare' | 'evidence' | 'commit' | 'retry' | 'complete' | 'fail' | 'review'
  status: number
  attempt?: number
  state?: string
  safeErrorCode?: string
  elapsedMs?: number
  fileCount?: number
}

export type ExpenseAsyncTelemetry = (
  name: ExpenseAsyncEventName,
  fields: ExpenseAsyncEventFields,
) => void

const CONTEXT: Record<ExpenseAsyncEventName, {
  route: ExpenseAsyncEventFields['route']
  action: ExpenseAsyncEventFields['action']
}> = {
  expense_job_accepted: { route: 'submit', action: 'accept' },
  expense_task_enqueued: { route: 'submit', action: 'enqueue' },
  expense_worker_claimed: { route: 'worker', action: 'claim' },
  expense_prepare_completed: { route: 'worker', action: 'prepare' },
  expense_evidence_completed: { route: 'worker', action: 'evidence' },
  expense_commit_completed: { route: 'worker', action: 'commit' },
  expense_worker_retrying: { route: 'worker', action: 'retry' },
  expense_worker_completed: { route: 'worker', action: 'complete' },
  expense_worker_failed: { route: 'worker', action: 'fail' },
  expense_worker_needs_review: { route: 'worker', action: 'review' },
}
const FIELDS = new Set([
  'route', 'action', 'status', 'attempt', 'state', 'safeErrorCode', 'elapsedMs', 'fileCount',
])
const STATES = new Set([
  'QUEUING', 'QUEUED', 'PROCESSING', 'RETRYING', 'COMMITTED', 'FAILED', 'NEEDS_REVIEW',
])

export function expenseAsyncEvent(
  name: ExpenseAsyncEventName,
  fields: ExpenseAsyncEventFields,
): Record<string, string | number> {
  if (!validFields(name, fields)) throw new Error('EXPENSE_ASYNC_TELEMETRY_INVALID')
  return { event: name, ...fields }
}

export function createExpenseAsyncTelemetry(
  write: (event: Record<string, string | number>) => void = (event) => console.info(JSON.stringify(event)),
): ExpenseAsyncTelemetry {
  return (name, fields) => {
    try { write(expenseAsyncEvent(name, fields)) } catch { /* telemetry cannot alter expense execution */ }
  }
}

function validFields(name: ExpenseAsyncEventName, fields: ExpenseAsyncEventFields): boolean {
  if (!plainRecord(fields) || !Object.keys(fields).every((field) => FIELDS.has(field))) return false
  const context = CONTEXT[name]
  if (!context || fields.route !== context.route || fields.action !== context.action) return false
  if (!integer(fields.status, 100, 599)) return false
  if (fields.attempt !== undefined && !integer(fields.attempt, 0, 8)) return false
  if (fields.state !== undefined && !STATES.has(fields.state)) return false
  if (fields.safeErrorCode !== undefined && !isMiniAppExpenseSafeErrorCode(fields.safeErrorCode)) return false
  if (fields.elapsedMs !== undefined && !integer(fields.elapsedMs, 0, 86_400_000)) return false
  return fields.fileCount === undefined || integer(fields.fileCount, 0, 5)
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
}
