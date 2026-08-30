export type BookingTimingEventName = 'prepare_completed' | 'confirm_completed'

export type BookingTimingRoute = 'prepare' | 'confirm'

export type BookingTimingAction =
  | 'line_verify'
  | 'staff_snapshot'
  | 'draft_read'
  | 'config_snapshot'
  | 'multipart_parse'
  | 'persist'
  | 'task_enqueue'
  | 'state_ingress'
  | 'recovery_reread'
  | 'request'

export interface BookingTimingFields {
  route: BookingTimingRoute
  action: BookingTimingAction
  status: number
  state?: string
  fileCount?: number
  attempt?: number
  elapsedMs: number
}

export type BookingPerformanceTelemetry = (name: BookingTimingEventName, fields: BookingTimingFields) => void

const EVENT_ROUTES: Record<BookingTimingEventName, BookingTimingRoute> = {
  prepare_completed: 'prepare',
  confirm_completed: 'confirm',
}

const ROUTE_ACTIONS: Record<BookingTimingRoute, ReadonlySet<BookingTimingAction>> = {
  prepare: new Set(['line_verify', 'staff_snapshot', 'draft_read', 'config_snapshot', 'multipart_parse', 'persist', 'request']),
  confirm: new Set(['line_verify', 'staff_snapshot', 'draft_read', 'task_enqueue', 'state_ingress', 'recovery_reread', 'request']),
}

const FIELD_NAMES = new Set(['route', 'action', 'status', 'state', 'fileCount', 'attempt', 'elapsedMs'])
const SAFE_STATES = new Set([
  'DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING',
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED',
])

export function bookingTimingEvent(
  name: BookingTimingEventName,
  fields: BookingTimingFields,
): Record<string, string | number> {
  if (!validBookingTiming(name, fields)) throw new Error('UNSAFE_BOOKING_TIMING_FIELD')
  return { event: name, ...fields }
}

export function emitBookingTiming(
  name: BookingTimingEventName,
  fields: BookingTimingFields,
  write: (event: Record<string, string | number>) => void = (event) => console.info(JSON.stringify(event)),
): void {
  write(bookingTimingEvent(name, fields))
}

export function createBookingPerformanceTelemetry(
  write: (event: Record<string, string | number>) => void = (event) => console.info(JSON.stringify(event)),
): BookingPerformanceTelemetry {
  return (name, fields) => {
    try { emitBookingTiming(name, fields, write) } catch { /* telemetry cannot alter Booking execution */ }
  }
}

function validBookingTiming(name: BookingTimingEventName, fields: BookingTimingFields): boolean {
  if (!Object.hasOwn(EVENT_ROUTES, name) || !plainRecord(fields)) return false
  if (!Object.keys(fields).every((field) => FIELD_NAMES.has(field))) return false
  if (fields.route !== EVENT_ROUTES[name] || !ROUTE_ACTIONS[fields.route]?.has(fields.action)) return false
  if (!safeStatus(fields.status) || !safeDuration(fields.elapsedMs)) return false
  if (fields.state !== undefined && !SAFE_STATES.has(fields.state)) return false
  if (fields.fileCount !== undefined && !safeInteger(fields.fileCount, 0, 20)) return false
  if (fields.attempt !== undefined && !safeInteger(fields.attempt, 0, 8)) return false
  return true
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function safeStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599
}

function safeDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}
