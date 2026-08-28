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
  totalBytes?: number
}

export type AsyncBookingTelemetry = (name: AsyncBookingEventName, fields: AsyncBookingEventFields) => void

const EVENT_NAMES = new Set<AsyncBookingEventName>([
  'evidence_stage_started', 'evidence_stage_completed', 'booking_task_enqueued', 'booking_worker_claimed',
  'drive_copy_completed', 'booking_ingress_completed', 'booking_worker_retrying', 'booking_worker_completed',
  'booking_worker_needs_review',
])
const FIELD_NAMES = new Set(['requestId', 'draftId', 'caseId', 'attempt', 'state', 'safeErrorCode', 'elapsedMs', 'fileCount', 'totalBytes'])
const SAFE_ID = /^(?=.*[A-Za-z])[A-Za-z0-9._:-]{1,124}$/
const SAFE_REQUEST_ID = /^request-[0-9a-f-]{1,116}$/
const SAFE_DRAFT_ID = /^draft-[0-9a-f-]{1,118}$/
const SAFE_CASE_ID = /^PMC-\d{6}-\d{4,}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/
const THAI_PHONE = /(?:^|\D)(?:0\d{8,9}|\+66\d{8,9})(?:$|\D)/
const FORBIDDEN_VALUE = /(?:https?:\/\/|\b(?:bearer|token|authorization)\b|data:(?:image|application)\/|base64[,;])/i

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
  if (fields.caseId !== undefined && !SAFE_CASE_ID.test(fields.caseId)) return false
  if (fields.attempt !== undefined && !safeCount(fields.attempt)) return false
  if (fields.state !== undefined && !SAFE_CODE.test(fields.state)) return false
  if (fields.safeErrorCode !== undefined && !SAFE_CODE.test(fields.safeErrorCode)) return false
  return [fields.elapsedMs, fields.fileCount, fields.totalBytes].every((value) => value === undefined || safeCount(value))
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !THAI_PHONE.test(value) && !FORBIDDEN_VALUE.test(value)
}

function safeRequestId(value: unknown): value is string {
  return safeId(value) && SAFE_REQUEST_ID.test(value)
}

function safeDraftId(value: unknown): value is string {
  return safeId(value) && SAFE_DRAFT_ID.test(value)
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000
}
