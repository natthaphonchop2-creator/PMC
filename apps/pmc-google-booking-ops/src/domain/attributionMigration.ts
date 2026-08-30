import { MINI_APP_ASYNC_REQUEST_HEADERS_V1 } from '../../../../shared/pmcMiniAppAsyncState'
import { BOOKING_MASTER_COLUMNS, BOOKING_MASTER_COLUMNS_V1 } from '../sheetSchema'

export const LEGACY_MINI_APP_REQUEST_HEADERS = MINI_APP_ASYNC_REQUEST_HEADERS_V1

const legacyAeNameIndex = LEGACY_MINI_APP_REQUEST_HEADERS.indexOf('aeName')
export const TARGET_MINI_APP_REQUEST_HEADERS = [
  ...LEGACY_MINI_APP_REQUEST_HEADERS.slice(0, 2),
  'protocolVersion',
  LEGACY_MINI_APP_REQUEST_HEADERS[2],
  'recorderName',
  'adminId',
  'adminName',
  ...LEGACY_MINI_APP_REQUEST_HEADERS.slice(3, legacyAeNameIndex),
  'aeId',
  ...LEGACY_MINI_APP_REQUEST_HEADERS.slice(legacyAeNameIndex),
] as const

export const LEGACY_BOOKING_MASTER_HEADERS = BOOKING_MASTER_COLUMNS_V1
export const TARGET_BOOKING_MASTER_HEADERS = BOOKING_MASTER_COLUMNS

const TERMINAL_LEGACY_STATES = new Set([
  'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
])
const NO_AE = 'ไม่ระบุ'

export interface AttributionStaffSnapshot {
  id: string
  name: string
  email: string
  active: boolean
  canBeAe: boolean
}

export interface AttributionMigrationTableSnapshot {
  headers: string[]
  rows: unknown[][]
  /** Hash of formats, validations, frozen panes, and filter behavior captured by the adapter. */
  preservationFingerprint: string
}

export interface AttributionMigrationSheetSnapshot {
  request: AttributionMigrationTableSnapshot
  master: AttributionMigrationTableSnapshot
  staff: AttributionStaffSnapshot[]
  queueState: 'PAUSED' | 'RUNNING'
  activeTaskCount: number
  requestRowLimit: number
  masterRowLimit: number
  /** Recomputed by the production adapter with SHA-256 on every read. */
  preflightFingerprint?: string
}

export interface NoBookingAttributionMigrationPlan {
  kind: 'NONE'
  preflightFingerprint: string
  requestRowsMigrated: 0
  bookingRowsMigrated: 0
  requestValueHash: string
  masterValueHash: string
  requestPreservationFingerprint: string
  masterPreservationFingerprint: string
}

export interface ApplyBookingAttributionMigrationPlan {
  kind: 'MIGRATE'
  preflightFingerprint: string
  requestProtocolInsertion: 'protocolVersion'
  requestInsertions: ['recorderName', 'adminId', 'adminName', 'aeId']
  masterInsertions: ['recorderId', 'recorderName', 'recorderSource']
  migrateRequestSchema: boolean
  migrateMasterSchema: boolean
  requestRows: unknown[][]
  masterRows: unknown[][]
  requestRowsMigrated: number
  bookingRowsMigrated: number
  requestValueHash: string
  masterValueHash: string
  requestNonTargetValueHash: string
  masterNonTargetValueHash: string
  requestPreservationFingerprint: string
  masterPreservationFingerprint: string
}

export type BookingAttributionMigrationPlan =
  | NoBookingAttributionMigrationPlan
  | ApplyBookingAttributionMigrationPlan

export function planBookingAttributionMigration(
  snapshot: AttributionMigrationSheetSnapshot,
): BookingAttributionMigrationPlan {
  const requestSchema = exactSchema(
    snapshot.request.headers,
    LEGACY_MINI_APP_REQUEST_HEADERS,
    TARGET_MINI_APP_REQUEST_HEADERS,
    'UNKNOWN_REQUEST_HEADERS',
  )
  const masterSchema = exactSchema(
    snapshot.master.headers,
    LEGACY_BOOKING_MASTER_HEADERS,
    TARGET_BOOKING_MASTER_HEADERS,
    'UNKNOWN_MASTER_HEADERS',
  )
  if (requestSchema === 'TARGET') validateTargetRequestVersions(snapshot.request.rows)
  const preflightFingerprint = migrationSnapshotFingerprint(snapshot)

  if (requestSchema === 'TARGET' && masterSchema === 'TARGET') {
    return {
      kind: 'NONE',
      preflightFingerprint,
      requestRowsMigrated: 0,
      bookingRowsMigrated: 0,
      requestValueHash: hashRows(snapshot.request.headers, snapshot.request.rows),
      masterValueHash: hashRows(snapshot.master.headers, snapshot.master.rows),
      requestPreservationFingerprint: snapshot.request.preservationFingerprint,
      masterPreservationFingerprint: snapshot.master.preservationFingerprint,
    }
  }

  requireMigrationPreconditions(snapshot)
  const staffById = uniqueStaffById(snapshot.staff)
  const legacyAeByName = uniqueEligibleAeByName(snapshot.staff)

  const requestRows = requestSchema === 'LEGACY'
    ? migrateLegacyRequestRows(snapshot.request, staffById, legacyAeByName)
    : copyRows(snapshot.request.rows)
  const normalizedRequests = objects(TARGET_MINI_APP_REQUEST_HEADERS, requestRows)
  const masterRows = masterSchema === 'LEGACY'
    ? migrateLegacyMasterRows(snapshot.master, snapshot.staff, normalizedRequests)
    : copyRows(snapshot.master.rows)

  return {
    kind: 'MIGRATE',
    preflightFingerprint,
    requestProtocolInsertion: 'protocolVersion',
    requestInsertions: ['recorderName', 'adminId', 'adminName', 'aeId'],
    masterInsertions: ['recorderId', 'recorderName', 'recorderSource'],
    migrateRequestSchema: requestSchema === 'LEGACY',
    migrateMasterSchema: masterSchema === 'LEGACY',
    requestRows,
    masterRows,
    requestRowsMigrated: requestSchema === 'LEGACY' ? requestRows.length : 0,
    bookingRowsMigrated: masterSchema === 'LEGACY' ? masterRows.length : 0,
    requestValueHash: hashRows(TARGET_MINI_APP_REQUEST_HEADERS, requestRows),
    masterValueHash: hashRows(TARGET_BOOKING_MASTER_HEADERS, masterRows),
    requestNonTargetValueHash: hashRowsExcluding(
      TARGET_MINI_APP_REQUEST_HEADERS,
      requestRows,
      new Set(['protocolVersion', 'recorderName', 'adminId', 'adminName', 'aeId']),
    ),
    masterNonTargetValueHash: hashRowsExcluding(
      TARGET_BOOKING_MASTER_HEADERS,
      masterRows,
      new Set(['recorderId', 'recorderName', 'recorderSource']),
    ),
    requestPreservationFingerprint: snapshot.request.preservationFingerprint,
    masterPreservationFingerprint: snapshot.master.preservationFingerprint,
  }
}

export function migrationSnapshotFingerprint(snapshot: AttributionMigrationSheetSnapshot): string {
  if (snapshot.preflightFingerprint !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(snapshot.preflightFingerprint)) {
      throw new Error('INVALID_MIGRATION_FINGERPRINT')
    }
    return snapshot.preflightFingerprint
  }
  return stableHash(JSON.parse(canonicalAttributionMigrationSnapshot(snapshot)) as unknown)
}

export function canonicalAttributionMigrationSnapshot(snapshot: AttributionMigrationSheetSnapshot): string {
  return JSON.stringify({
    request: {
      headers: snapshot.request.headers,
      rows: snapshot.request.rows,
      preservationFingerprint: snapshot.request.preservationFingerprint,
    },
    master: {
      headers: snapshot.master.headers,
      rows: snapshot.master.rows,
      preservationFingerprint: snapshot.master.preservationFingerprint,
    },
    staff: snapshot.staff,
    requestRowLimit: snapshot.requestRowLimit,
    masterRowLimit: snapshot.masterRowLimit,
  })
}

export function verifyBookingAttributionMigrationReadback(
  plan: ApplyBookingAttributionMigrationPlan,
  snapshot: AttributionMigrationSheetSnapshot,
): void {
  if (!sameHeader(snapshot.request.headers, TARGET_MINI_APP_REQUEST_HEADERS)
    || !sameHeader(snapshot.master.headers, TARGET_BOOKING_MASTER_HEADERS)
    || hashRows(snapshot.request.headers, snapshot.request.rows) !== plan.requestValueHash
    || hashRows(snapshot.master.headers, snapshot.master.rows) !== plan.masterValueHash
    || hashRowsExcluding(
      snapshot.request.headers,
      snapshot.request.rows,
      new Set(['protocolVersion', 'recorderName', 'adminId', 'adminName', 'aeId']),
    ) !== plan.requestNonTargetValueHash
    || hashRowsExcluding(
      snapshot.master.headers,
      snapshot.master.rows,
      new Set(['recorderId', 'recorderName', 'recorderSource']),
    ) !== plan.masterNonTargetValueHash
    || snapshot.request.preservationFingerprint !== plan.requestPreservationFingerprint
    || snapshot.master.preservationFingerprint !== plan.masterPreservationFingerprint) {
    throw new Error('MIGRATION_READBACK_MISMATCH')
  }
}

function requireMigrationPreconditions(snapshot: AttributionMigrationSheetSnapshot): void {
  if (snapshot.queueState !== 'PAUSED') throw new Error('QUEUE_NOT_PAUSED')
  if (!Number.isSafeInteger(snapshot.activeTaskCount) || snapshot.activeTaskCount !== 0) {
    throw new Error('ACTIVE_BOOKING_TASKS')
  }
  if (!validBound(snapshot.requestRowLimit) || snapshot.request.rows.length > snapshot.requestRowLimit) {
    throw new Error('REQUEST_ROW_LIMIT_EXCEEDED')
  }
  if (!validBound(snapshot.masterRowLimit) || snapshot.master.rows.length > snapshot.masterRowLimit) {
    throw new Error('MASTER_ROW_LIMIT_EXCEEDED')
  }
  if (sameHeader(snapshot.request.headers, LEGACY_MINI_APP_REQUEST_HEADERS)) {
    const legacy = objects(LEGACY_MINI_APP_REQUEST_HEADERS, snapshot.request.rows)
    if (legacy.some((record) => !TERMINAL_LEGACY_STATES.has(text(record.state)))) {
      throw new Error('NONTERMINAL_LEGACY_DRAFTS')
    }
  } else {
    const target = objects(TARGET_MINI_APP_REQUEST_HEADERS, snapshot.request.rows)
    for (const record of target) {
      const protocolVersion = Number(record.protocolVersion)
      if (protocolVersion === 1 && !TERMINAL_LEGACY_STATES.has(text(record.state))) {
        throw new Error('NONTERMINAL_LEGACY_DRAFTS')
      }
    }
  }
}

function validateTargetRequestVersions(rows: readonly unknown[][]): void {
  for (const record of objects(TARGET_MINI_APP_REQUEST_HEADERS, rows)) {
    const protocolVersion = Number(record.protocolVersion)
    if (protocolVersion !== 1 && protocolVersion !== 2) {
      throw new Error('UNKNOWN_REQUEST_PROTOCOL_VERSION')
    }
  }
}

function migrateLegacyRequestRows(
  table: AttributionMigrationTableSnapshot,
  staffById: Map<string, AttributionStaffSnapshot>,
  legacyAeByName: Map<string, AttributionStaffSnapshot>,
): unknown[][] {
  return objects(LEGACY_MINI_APP_REQUEST_HEADERS, table.rows).map((record) => {
    const staffId = text(record.staffId)
    const recorder = staffById.get(staffId)
    if (!recorder) throw new Error('LEGACY_REQUEST_STAFF_UNRESOLVED')
    const oldAeName = text(record.aeName).trim()
    const ae = oldAeName && oldAeName !== NO_AE ? legacyAeByName.get(oldAeName) : null
    if (oldAeName && oldAeName !== NO_AE && !ae) throw new Error('LEGACY_REQUEST_AE_UNRESOLVED')
    return TARGET_MINI_APP_REQUEST_HEADERS.map((header) => {
      if (header === 'protocolVersion') return 1
      if (header === 'recorderName' || header === 'adminName') return recorder.name
      if (header === 'adminId') return recorder.id
      if (header === 'aeId') return ae?.id ?? ''
      return record[header] ?? ''
    })
  })
}

function migrateLegacyMasterRows(
  table: AttributionMigrationTableSnapshot,
  staff: readonly AttributionStaffSnapshot[],
  requests: Array<Record<string, unknown>>,
): unknown[][] {
  const staffById = uniqueStaffById(staff)
  return objects(LEGACY_BOOKING_MASTER_HEADERS, table.rows).map((record) => {
    const formResponseId = text(record.formResponseId)
    const miniApp = formResponseId.startsWith('mini:')
    let recorderId = ''
    let recorderName = 'Google Form'
    let recorderSource = 'FORM_UNRESOLVED'

    if (miniApp) {
      const matches = correlateMiniAppRequest(record, requests)
      if (matches.length > 1) throw new Error('AMBIGUOUS_MINI_APP_CORRELATION')
      const request = matches[0]
      if (request) {
        const exactStaff = staffById.get(text(request.staffId))
        if (!exactStaff) throw new Error('MINI_APP_RECORDER_UNRESOLVED')
        recorderId = exactStaff.id
        recorderName = exactStaff.name
        recorderSource = 'VERIFIED_LINE'
      } else {
        recorderId = text(record.adminId)
        recorderName = text(record.adminName)
        recorderSource = 'LEGACY_ASSUMED_ADMIN'
      }
    } else {
      const normalizedEmail = text(record.submitterEmail).trim().toLowerCase()
      const matches = staff.filter((item) => item.active && item.email.trim().toLowerCase() === normalizedEmail)
      if (normalizedEmail && matches.length === 1) {
        recorderId = matches[0].id
        recorderName = matches[0].name
        recorderSource = 'FORM_EMAIL_MATCH'
      }
    }

    return TARGET_BOOKING_MASTER_HEADERS.map((header) => {
      if (header === 'recorderId') return recorderId
      if (header === 'recorderName') return recorderName
      if (header === 'recorderSource') return recorderSource
      return record[header] ?? ''
    })
  })
}

function correlateMiniAppRequest(
  master: Record<string, unknown>,
  requests: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const caseId = text(master.caseId)
  const formResponseId = text(master.formResponseId)
  return requests.filter((request) => {
    const requestId = text(request.requestId)
    const requestCaseId = text(request.caseId)
    return Boolean(caseId && requestCaseId === caseId) || formResponseId === `mini:${requestId}`
  })
}

function uniqueStaffById(staff: readonly AttributionStaffSnapshot[]): Map<string, AttributionStaffSnapshot> {
  const result = new Map<string, AttributionStaffSnapshot>()
  for (const item of staff) {
    const id = item.id.trim()
    if (!id || result.has(id)) throw new Error('DUPLICATE_STAFF_ID')
    result.set(id, item)
  }
  return result
}

function uniqueEligibleAeByName(
  staff: readonly AttributionStaffSnapshot[],
): Map<string, AttributionStaffSnapshot> {
  const result = new Map<string, AttributionStaffSnapshot>()
  for (const item of staff) {
    if (!item.active || !item.canBeAe) continue
    const name = item.name.trim()
    if (!name || name === NO_AE || result.has(name)) throw new Error('DUPLICATE_LEGACY_AE_NAME')
    result.set(name, item)
  }
  return result
}

function exactSchema(
  actual: readonly string[],
  legacy: readonly string[],
  target: readonly string[],
  error: string,
): 'LEGACY' | 'TARGET' {
  if (sameHeader(actual, legacy)) return 'LEGACY'
  if (sameHeader(actual, target)) return 'TARGET'
  throw new Error(error)
}

function validBound(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function sameHeader(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function objects(headers: readonly string[], rows: readonly unknown[][]): Array<Record<string, unknown>> {
  return rows.map((values) => {
    if (values.length > headers.length) throw new Error('MIGRATION_ROW_WIDTH_MISMATCH')
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function copyRows(rows: readonly unknown[][]): unknown[][] {
  return rows.map((values) => [...values])
}

function hashRows(headers: readonly string[], rows: readonly unknown[][]): string {
  return stableHash({ headers, rows })
}

function hashRowsExcluding(headers: readonly string[], rows: readonly unknown[][], excluded: Set<string>): string {
  const indexes = headers.flatMap((header, index) => excluded.has(header) ? [] : [index])
  return stableHash({
    headers: indexes.map((index) => headers[index]),
    rows: rows.map((values) => indexes.map((index) => values[index] ?? '')),
  })
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}
