export type AsyncBookingEventName =
  | 'evidence_stage_started'
  | 'evidence_stage_completed'
  | 'booking_task_enqueued'
  | 'booking_worker_claimed'
  | 'drive_copy_completed'
  | 'booking_ingress_completed'
  | 'booking_completion_mutation_completed'
  | 'booking_worker_retrying'
  | 'booking_worker_completed'
  | 'booking_worker_needs_review'

export type AsyncBookingEventFields = {
  route: 'evidence' | 'confirm' | 'worker'
  action: 'stage' | 'enqueue' | 'claim' | 'evidence_projection' | 'booking_ingress' | 'completion_mutation' | 'retry' | 'complete' | 'review'
  status: number
  attempt?: number
  state?: string
  elapsedMs?: number
  fileCount?: number
}

export type AsyncBookingTelemetry = (name: AsyncBookingEventName, fields: AsyncBookingEventFields) => void

const EVENT_NAMES = new Set<AsyncBookingEventName>([
  'evidence_stage_started', 'evidence_stage_completed', 'booking_task_enqueued', 'booking_worker_claimed',
  'drive_copy_completed', 'booking_ingress_completed', 'booking_worker_retrying', 'booking_worker_completed',
  'booking_worker_needs_review', 'booking_completion_mutation_completed',
])
const EVENT_CONTEXT: Record<AsyncBookingEventName, { route: AsyncBookingEventFields['route']; action: AsyncBookingEventFields['action'] }> = {
  evidence_stage_started: { route: 'evidence', action: 'stage' },
  evidence_stage_completed: { route: 'evidence', action: 'stage' },
  booking_task_enqueued: { route: 'confirm', action: 'enqueue' },
  booking_worker_claimed: { route: 'worker', action: 'claim' },
  drive_copy_completed: { route: 'worker', action: 'evidence_projection' },
  booking_ingress_completed: { route: 'worker', action: 'booking_ingress' },
  booking_completion_mutation_completed: { route: 'worker', action: 'completion_mutation' },
  booking_worker_retrying: { route: 'worker', action: 'retry' },
  booking_worker_completed: { route: 'worker', action: 'complete' },
  booking_worker_needs_review: { route: 'worker', action: 'review' },
}
const FIELD_NAMES = new Set(['route', 'action', 'status', 'attempt', 'state', 'elapsedMs', 'fileCount'])
const ROUTE_ACTIONS = {
  evidence: new Set<string>(['stage']),
  confirm: new Set<string>(['enqueue']),
  worker: new Set<string>(['claim', 'evidence_projection', 'booking_ingress', 'completion_mutation', 'retry', 'complete', 'review']),
} as const
const ASYNC_STATES = new Set([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING',
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])
export function asyncBookingEvent(
  name: AsyncBookingEventName,
  fields: AsyncBookingEventFields,
): Record<string, string | number> {
  if (!EVENT_NAMES.has(name) || !validFields(name, fields)) throw new Error('ASYNC_TELEMETRY_INVALID_FIELDS')
  return { event: name, ...fields }
}

export function createAsyncBookingTelemetry(
  write: (event: Record<string, string | number>) => void = (event) => console.info(JSON.stringify(event)),
): AsyncBookingTelemetry {
  return (name, fields) => {
    try { write(asyncBookingEvent(name, fields)) } catch { /* telemetry cannot alter booking execution */ }
  }
}

function validFields(name: AsyncBookingEventName, fields: AsyncBookingEventFields): boolean {
  if (!plainRecord(fields) || !Object.keys(fields).every((name) => FIELD_NAMES.has(name))) return false
  if (!Object.hasOwn(ROUTE_ACTIONS, fields.route) || !ROUTE_ACTIONS[fields.route].has(fields.action)) return false
  if (fields.route !== EVENT_CONTEXT[name].route || fields.action !== EVENT_CONTEXT[name].action) return false
  if (!safeStatus(fields.status)) return false
  if (fields.attempt !== undefined && !safeInteger(fields.attempt, 0, 8)) return false
  if (fields.state !== undefined && !ASYNC_STATES.has(fields.state)) return false
  if (fields.fileCount !== undefined && !safeInteger(fields.fileCount, 0, 20)) return false
  return fields.elapsedMs === undefined || safeInteger(fields.elapsedMs, 0, 86_400_000)
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function safeStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}
