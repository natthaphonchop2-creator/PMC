export type AsyncBookingEventName =
  | 'evidence_stage_started'
  | 'evidence_stage_completed'
  | 'booking_task_enqueued'
  | 'booking_worker_claimed'
  | 'drive_copy_completed'
  | 'booking_ingress_completed'
  | 'booking_worker_retrying'
  | 'booking_worker_completed'
  | 'booking_worker_needs_review'

export type AsyncBookingEventFields = {
  requestId: string
  draftId: string
  caseId?: string
  attempt?: number
  state?: string
  safeErrorCode?: string
  elapsedMs?: number
  fileCount?: number
}

export type AsyncBookingTelemetry = (name: AsyncBookingEventName, fields: AsyncBookingEventFields) => void

const EVENT_NAMES = new Set<AsyncBookingEventName>([
  'evidence_stage_started', 'evidence_stage_completed', 'booking_task_enqueued', 'booking_worker_claimed',
  'drive_copy_completed', 'booking_ingress_completed', 'booking_worker_retrying', 'booking_worker_completed',
  'booking_worker_needs_review',
])
const FIELD_NAMES = new Set(['requestId', 'draftId', 'caseId', 'attempt', 'state', 'safeErrorCode', 'elapsedMs', 'fileCount'])
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SAFE_CASE_ID = /^PMC-\d{4}(?:0[1-9]|1[0-2])-(?:000[1-9]|00[1-9]\d|0[1-9]\d{2}|[1-9]\d{3})$/
const ASYNC_STATES = new Set([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING',
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])
const SAFE_ERROR_CODES = new Set(['EVIDENCE_COPY_RETRY', 'BOOKING_INGRESS_RETRY', 'BOOKING_COMPLETION_RETRY', 'RETRY_EXHAUSTED'])

export function asyncBookingEvent(
  name: AsyncBookingEventName,
  fields: AsyncBookingEventFields,
): Record<string, string | number> {
  if (!EVENT_NAMES.has(name) || !validFields(fields)) throw new Error('ASYNC_TELEMETRY_INVALID_FIELDS')
  return { event: name, ...fields }
}

export function createAsyncBookingTelemetry(
  write: (event: Record<string, string | number>) => void = (event) => console.info(JSON.stringify(event)),
): AsyncBookingTelemetry {
  return (name, fields) => {
    try { write(asyncBookingEvent(name, fields)) } catch { /* telemetry cannot alter booking execution */ }
  }
}

function validFields(fields: AsyncBookingEventFields): boolean {
  if (!fields || typeof fields !== 'object' || !Object.keys(fields).every((name) => FIELD_NAMES.has(name))) return false
  if (!safeRequestId(fields.requestId) || !safeDraftId(fields.draftId)) return false
  if (fields.caseId !== undefined && (typeof fields.caseId !== 'string' || !SAFE_CASE_ID.test(fields.caseId))) return false
  if (fields.attempt !== undefined && !safeCount(fields.attempt)) return false
  if (fields.state !== undefined && !ASYNC_STATES.has(fields.state)) return false
  if (fields.safeErrorCode !== undefined && !SAFE_ERROR_CODES.has(fields.safeErrorCode)) return false
  return [fields.elapsedMs, fields.fileCount].every((value) => value === undefined || safeCount(value))
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

function safeRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('request-') && safeId(value.slice('request-'.length))
}

function safeDraftId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('draft-') && safeId(value.slice('draft-'.length))
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000
}
