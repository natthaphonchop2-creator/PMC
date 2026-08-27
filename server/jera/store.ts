import type { MiniAppSheetsPort } from '../pmc-mini-app/googleClient.js'
import {
  JERA_API_CACHE_HEADERS,
  JERA_SYNC_AUDIT_HEADERS,
  JERA_SYNC_STATE_HEADERS,
} from '../pmc-mini-app/setup.js'
import type { JeraNormalizedRow, JeraSourceReportType } from './contracts.js'

export type JeraSyncStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export interface JeraSyncStateRecord {
  cacheKey: string
  reportType: JeraSourceReportType
  filterHash: string
  lastAttemptAt: string | null
  lastManualAt: string | null
  lastSuccessAt: string | null
  lastSourceDate: string | null
  status: JeraSyncStatus
  recordCount: number
  nextPage: number | null
  safeErrorCode: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
}

export interface JeraSyncAuditRecord {
  syncRunId: string
  actorType: 'MANUAL' | 'SCHEDULED' | 'LOOKBACK' | 'READ'
  actorId: string
  reportType: JeraSourceReportType
  filterHash: string
  startedAt: string
  finishedAt: string
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  recordCount: number
  safeErrorCode: string | null
  correlationId: string
}

export interface JeraCacheReadQuery {
  cacheKey?: string
  branchUuid?: string
  startDate?: string
  endDate?: string
}

export interface JeraStoreWriteResult {
  inserted: number
  updated: number
  unchanged: number
  removed: number
}

export interface JeraReportStore {
  upsertRows(reportType: JeraSourceReportType, rows: JeraNormalizedRow[]): Promise<JeraStoreWriteResult>
  replaceRows(reportType: JeraSourceReportType, cacheKey: string, rows: JeraNormalizedRow[]): Promise<JeraStoreWriteResult>
  readRows(reportType: JeraSourceReportType, query?: JeraCacheReadQuery): Promise<JeraNormalizedRow[]>
  getSyncState(cacheKey: string): Promise<JeraSyncStateRecord | null>
  saveSyncState(state: JeraSyncStateRecord): Promise<void>
  appendSyncAudit(audit: JeraSyncAuditRecord): Promise<void>
  claimLease(input: {
    cacheKey: string
    reportType: JeraSourceReportType
    filterHash: string
    owner: string
    now: string
    ttlMs: number
  }): Promise<boolean>
  releaseLease(cacheKey: string, owner: string): Promise<void>
}

const CACHE_TAB = 'JERA_API_CACHE'
const STATE_TAB = 'JERA_SYNC_STATE'
const AUDIT_TAB = 'JERA_SYNC_AUDIT'
const storeMutexes = new Map<string, Promise<void>>()

export class JeraStoreError extends Error {
  readonly code:
    | 'JERA_STORE_INCOMPATIBLE_HEADER'
    | 'JERA_STORE_CORRUPT_ROW'
    | 'JERA_STORE_INVALID_INPUT'
    | 'JERA_STORE_STATE_CONFLICT'

  constructor(code: JeraStoreError['code']) {
    super(code)
    this.name = 'JeraStoreError'
    this.code = code
  }
}

export function createGoogleJeraReportStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): JeraReportStore {
  const { spreadsheetId, sheets } = input
  const mutexKey = `jera-report-store:${spreadsheetId}`

  async function readTable(tab: string, headers: readonly string[]): Promise<Array<{ rowNumber: number; cells: unknown[] }>> {
    const range = `'${tab}'!A1:${columnName(headers.length)}`
    const values = (await sheets.batchGet(spreadsheetId, [range]))[range] ?? []
    const actualHeader = (values[0] ?? []).map(stringValue)
    if (!sameHeader(actualHeader, headers)) throw new JeraStoreError('JERA_STORE_INCOMPATIBLE_HEADER')
    return values.slice(1).flatMap((cells, index) => cells.every(blank)
      ? []
      : [{ rowNumber: index + 2, cells }])
  }

  async function writeExisting(tab: string, headers: readonly string[], writes: Array<{ rowNumber: number; cells: unknown[] }>): Promise<void> {
    if (writes.length === 0) return
    const end = columnName(headers.length)
    await sheets.batchUpdate(spreadsheetId, writes.map(({ rowNumber, cells }) => ({
      range: `'${tab}'!A${rowNumber}:${end}${rowNumber}`,
      values: [cells],
    })))
  }

  async function mutateCache(
    reportType: JeraSourceReportType,
    incomingRows: JeraNormalizedRow[],
    replaceCacheKey: string | null,
  ): Promise<JeraStoreWriteResult> {
    return withMutex(mutexKey, async () => {
      const incoming = incomingRows.map((row) => validateCacheRow(row, reportType))
      const incomingIdentities = new Set<string>()
      for (const row of incoming) {
        const identity = cacheIdentity(row)
        if (incomingIdentities.has(identity)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
        incomingIdentities.add(identity)
        if (replaceCacheKey !== null && row.cacheKey !== replaceCacheKey) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
      }
      if (replaceCacheKey !== null) safeToken(replaceCacheKey)

      const stored = await readTable(CACHE_TAB, JERA_API_CACHE_HEADERS)
      const parsed = stored.map(({ rowNumber, cells }) => ({ rowNumber, value: cacheRowFromCells(cells) }))
      const byIdentity = new Map(parsed.map((row) => [cacheIdentity(row.value), row]))
      const updates: Array<{ rowNumber: number; cells: unknown[] }> = []
      const additions: unknown[][] = []
      let inserted = 0
      let updated = 0
      let unchanged = 0
      let removed = 0

      for (const row of incoming) {
        const existing = byIdentity.get(cacheIdentity(row))
        if (!existing) {
          additions.push(cacheRowToCells(row))
          inserted += 1
        } else if (existing.value.sourceHash === row.sourceHash) {
          unchanged += 1
        } else {
          updates.push({ rowNumber: existing.rowNumber, cells: cacheRowToCells(row) })
          updated += 1
        }
      }

      if (replaceCacheKey !== null) {
        for (const existing of parsed) {
          if (existing.value.reportType === reportType && existing.value.cacheKey === replaceCacheKey
            && !incomingIdentities.has(cacheIdentity(existing.value))) {
            updates.push({ rowNumber: existing.rowNumber, cells: Array(JERA_API_CACHE_HEADERS.length).fill('') })
            removed += 1
          }
        }
      }

      await writeExisting(CACHE_TAB, JERA_API_CACHE_HEADERS, updates)
      if (additions.length > 0) {
        await sheets.append(spreadsheetId, `'${CACHE_TAB}'!A:${columnName(JERA_API_CACHE_HEADERS.length)}`, additions)
      }
      return { inserted, updated, unchanged, removed }
    })
  }

  async function readStates(): Promise<Array<{ rowNumber: number; value: JeraSyncStateRecord }>> {
    return (await readTable(STATE_TAB, JERA_SYNC_STATE_HEADERS))
      .map(({ rowNumber, cells }) => ({ rowNumber, value: stateFromCells(cells) }))
  }

  async function writeState(state: JeraSyncStateRecord): Promise<void> {
    const normalized = validateState(state)
    const states = await readStates()
    const existing = states.find(({ value }) => value.cacheKey === normalized.cacheKey)
    if (existing && (existing.value.reportType !== normalized.reportType || existing.value.filterHash !== normalized.filterHash)) {
      throw new JeraStoreError('JERA_STORE_STATE_CONFLICT')
    }
    if (existing) {
      await writeExisting(STATE_TAB, JERA_SYNC_STATE_HEADERS, [{ rowNumber: existing.rowNumber, cells: stateToCells(normalized) }])
    } else {
      await sheets.append(spreadsheetId, `'${STATE_TAB}'!A:${columnName(JERA_SYNC_STATE_HEADERS.length)}`, [stateToCells(normalized)])
    }
  }

  return {
    upsertRows(reportType, rows) {
      return mutateCache(reportType, rows, null)
    },
    replaceRows(reportType, cacheKey, rows) {
      return mutateCache(reportType, rows, cacheKey)
    },
    async readRows(reportType, query = {}) {
      validateReportType(reportType)
      const safeQuery = validateReadQuery(query)
      const rows = (await readTable(CACHE_TAB, JERA_API_CACHE_HEADERS)).map(({ cells }) => cacheRowFromCells(cells))
      return rows.filter((row) => row.reportType === reportType
        && (!safeQuery.cacheKey || row.cacheKey === safeQuery.cacheKey)
        && (!safeQuery.branchUuid || row.branchUuid === safeQuery.branchUuid)
        && (!safeQuery.startDate || row.eventDate >= safeQuery.startDate)
        && (!safeQuery.endDate || row.eventDate <= safeQuery.endDate))
    },
    async getSyncState(cacheKey) {
      safeToken(cacheKey)
      return (await readStates()).find(({ value }) => value.cacheKey === cacheKey)?.value ?? null
    },
    async saveSyncState(state) {
      await withMutex(mutexKey, () => writeState(state))
    },
    async appendSyncAudit(audit) {
      const normalized = validateAudit(audit)
      await readTable(AUDIT_TAB, JERA_SYNC_AUDIT_HEADERS)
      await sheets.append(spreadsheetId, `'${AUDIT_TAB}'!A:${columnName(JERA_SYNC_AUDIT_HEADERS.length)}`, [auditToCells(normalized)])
    },
    async claimLease(lease) {
      return withMutex(mutexKey, async () => {
        safeToken(lease.cacheKey); validateReportType(lease.reportType); safeToken(lease.filterHash); safeToken(lease.owner)
        const now = isoInstant(lease.now)
        if (!Number.isSafeInteger(lease.ttlMs) || lease.ttlMs < 1_000 || lease.ttlMs > 900_000) {
          throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
        }
        const existing = (await readStates()).find(({ value }) => value.cacheKey === lease.cacheKey)?.value ?? null
        if (existing && (existing.reportType !== lease.reportType || existing.filterHash !== lease.filterHash)) {
          throw new JeraStoreError('JERA_STORE_STATE_CONFLICT')
        }
        if (existing?.leaseOwner && existing.leaseOwner !== lease.owner && existing.leaseExpiresAt
          && Date.parse(existing.leaseExpiresAt) > Date.parse(now)) return false
        const next: JeraSyncStateRecord = {
          cacheKey: lease.cacheKey, reportType: lease.reportType, filterHash: lease.filterHash,
          lastAttemptAt: existing?.lastAttemptAt ?? null, lastManualAt: existing?.lastManualAt ?? null,
          lastSuccessAt: existing?.lastSuccessAt ?? null,
          lastSourceDate: existing?.lastSourceDate ?? null, status: 'RUNNING', recordCount: existing?.recordCount ?? 0,
          nextPage: existing?.nextPage ?? null, safeErrorCode: null, leaseOwner: lease.owner,
          leaseExpiresAt: new Date(Date.parse(now) + lease.ttlMs).toISOString(),
        }
        await writeState(next)
        const verified = (await readStates()).find(({ value }) => value.cacheKey === lease.cacheKey)?.value
        return verified?.leaseOwner === lease.owner && verified.leaseExpiresAt === next.leaseExpiresAt
      })
    },
    async releaseLease(cacheKey, owner) {
      await withMutex(mutexKey, async () => {
        safeToken(cacheKey); safeToken(owner)
        const existing = (await readStates()).find(({ value }) => value.cacheKey === cacheKey)?.value
        if (!existing || existing.leaseOwner !== owner) return
        await writeState({ ...existing, leaseOwner: null, leaseExpiresAt: null })
      })
    },
  }
}

function cacheRowToCells(row: JeraNormalizedRow): unknown[] {
  return [
    row.cacheKey, row.reportType, row.sourceUuid, row.branchUuid ?? '', row.branchName ?? '', row.eventDate,
    row.patientUuid ?? '', row.patientCode ?? '', row.patientName ?? '', row.paymentCode ?? '', row.status ?? '', row.type ?? '',
    row.totalSatang ?? '', row.paidAmountSatang ?? '', row.refundAmountSatang ?? '', row.doctorName ?? '',
    row.salespersonName ?? '', row.sourceCreatedAt ?? '', row.sourceUpdatedAt ?? '', row.fetchedAt, row.sourceHash,
  ]
}

function cacheRowFromCells(cells: unknown[]): JeraNormalizedRow {
  if (cells.length === 0) throw new JeraStoreError('JERA_STORE_CORRUPT_ROW')
  return validateCacheRow({
    cacheKey: stringValue(cells[0]), reportType: stringValue(cells[1]) as JeraSourceReportType,
    sourceUuid: stringValue(cells[2]), branchUuid: nullableString(cells[3]), branchName: nullableString(cells[4]),
    eventDate: stringValue(cells[5]), patientUuid: nullableString(cells[6]), patientCode: nullableString(cells[7]),
    patientName: nullableString(cells[8]), paymentCode: nullableString(cells[9]), status: nullableString(cells[10]),
    type: nullableString(cells[11]), totalSatang: nullableSatang(cells[12]), paidAmountSatang: nullableSatang(cells[13]),
    refundAmountSatang: nullableSatang(cells[14]), doctorName: nullableString(cells[15]),
    salespersonName: nullableString(cells[16]), sourceCreatedAt: nullableString(cells[17]),
    sourceUpdatedAt: nullableString(cells[18]), fetchedAt: stringValue(cells[19]), sourceHash: stringValue(cells[20]),
  }, stringValue(cells[1]) as JeraSourceReportType)
}

function validateCacheRow(row: JeraNormalizedRow, expectedType: JeraSourceReportType): JeraNormalizedRow {
  validateReportType(expectedType)
  if (!row || typeof row !== 'object' || row.reportType !== expectedType) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  safeToken(row.cacheKey); safeToken(row.sourceUuid); isoDate(row.eventDate); isoInstant(row.fetchedAt)
  if (row.branchUuid !== null) uuid(row.branchUuid)
  if (row.patientUuid !== null) uuid(row.patientUuid)
  if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  for (const value of [row.branchName, row.patientCode, row.patientName, row.paymentCode, row.status, row.type, row.doctorName, row.salespersonName]) {
    if (value !== null && (typeof value !== 'string' || value.length > 256)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
  for (const value of [row.totalSatang, row.paidAmountSatang, row.refundAmountSatang]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
  if (row.sourceCreatedAt !== null) dateTime(row.sourceCreatedAt)
  if (row.sourceUpdatedAt !== null) dateTime(row.sourceUpdatedAt)
  return structuredClone(row)
}

function cacheIdentity(row: JeraNormalizedRow): string {
  return `${row.cacheKey}|${row.reportType}|${row.sourceUuid}`
}

function stateToCells(state: JeraSyncStateRecord): unknown[] {
  return [
    state.cacheKey, state.reportType, state.filterHash, state.lastAttemptAt ?? '', state.lastManualAt ?? '',
    state.lastSuccessAt ?? '', state.lastSourceDate ?? '', state.status, state.recordCount, state.nextPage ?? '', state.safeErrorCode ?? '',
    state.leaseOwner ?? '', state.leaseExpiresAt ?? '',
  ]
}

function stateFromCells(cells: unknown[]): JeraSyncStateRecord {
  return validateState({
    cacheKey: stringValue(cells[0]), reportType: stringValue(cells[1]) as JeraSourceReportType,
    filterHash: stringValue(cells[2]), lastAttemptAt: nullableString(cells[3]), lastManualAt: nullableString(cells[4]),
    lastSuccessAt: nullableString(cells[5]), lastSourceDate: nullableString(cells[6]), status: stringValue(cells[7]) as JeraSyncStatus,
    recordCount: integerValue(cells[8]), nextPage: nullableInteger(cells[9]), safeErrorCode: nullableString(cells[10]),
    leaseOwner: nullableString(cells[11]), leaseExpiresAt: nullableString(cells[12]),
  })
}

function validateState(state: JeraSyncStateRecord): JeraSyncStateRecord {
  if (!state || typeof state !== 'object') throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  safeToken(state.cacheKey); validateReportType(state.reportType); safeToken(state.filterHash)
  if (state.lastAttemptAt !== null) isoInstant(state.lastAttemptAt)
  if (state.lastManualAt !== null) isoInstant(state.lastManualAt)
  if (state.lastSuccessAt !== null) isoInstant(state.lastSuccessAt)
  if (state.lastSourceDate !== null) isoDate(state.lastSourceDate)
  if (!['IDLE', 'RUNNING', 'SUCCESS', 'FAILED'].includes(state.status)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  if (!Number.isSafeInteger(state.recordCount) || state.recordCount < 0) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  if (state.nextPage !== null && (!Number.isSafeInteger(state.nextPage) || state.nextPage < 1 || state.nextPage > 1_000)) {
    throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
  if (state.safeErrorCode !== null) safeError(state.safeErrorCode)
  if (state.leaseOwner !== null) safeToken(state.leaseOwner)
  if (state.leaseExpiresAt !== null) isoInstant(state.leaseExpiresAt)
  if ((state.leaseOwner === null) !== (state.leaseExpiresAt === null)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  return structuredClone(state)
}

function auditToCells(audit: JeraSyncAuditRecord): unknown[] {
  return [
    audit.syncRunId, audit.actorType, audit.actorId, audit.reportType, audit.filterHash, audit.startedAt,
    audit.finishedAt, audit.status, audit.recordCount, audit.safeErrorCode ?? '', audit.correlationId,
  ]
}

function validateAudit(audit: JeraSyncAuditRecord): JeraSyncAuditRecord {
  if (!audit || typeof audit !== 'object') throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  safeToken(audit.syncRunId); safeToken(audit.actorId); validateReportType(audit.reportType); safeToken(audit.filterHash)
  safeToken(audit.correlationId); isoInstant(audit.startedAt); isoInstant(audit.finishedAt)
  if (!['MANUAL', 'SCHEDULED', 'LOOKBACK', 'READ'].includes(audit.actorType)
    || !['SUCCESS', 'FAILED', 'SKIPPED'].includes(audit.status)
    || !Number.isSafeInteger(audit.recordCount) || audit.recordCount < 0) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  if (audit.safeErrorCode !== null) safeError(audit.safeErrorCode)
  return structuredClone({
    syncRunId: audit.syncRunId, actorType: audit.actorType, actorId: audit.actorId, reportType: audit.reportType,
    filterHash: audit.filterHash, startedAt: audit.startedAt, finishedAt: audit.finishedAt, status: audit.status,
    recordCount: audit.recordCount, safeErrorCode: audit.safeErrorCode, correlationId: audit.correlationId,
  })
}

function validateReadQuery(query: JeraCacheReadQuery): JeraCacheReadQuery {
  const normalized = structuredClone(query)
  if (normalized.cacheKey) safeToken(normalized.cacheKey)
  if (normalized.branchUuid) uuid(normalized.branchUuid)
  if (normalized.startDate) isoDate(normalized.startDate)
  if (normalized.endDate) isoDate(normalized.endDate)
  if (normalized.startDate && normalized.endDate && normalized.startDate > normalized.endDate) {
    throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
  return normalized
}

function validateReportType(value: string): asserts value is JeraSourceReportType {
  if (![
    'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT', 'PAYMENT_LIST', 'PRODUCT_USE', 'PRODUCT_SALES',
    'CANCELLED_PAYMENT', 'OPD', 'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE', 'REMAINING_COURSE_BY_DATE',
  ].includes(value)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
}

function sameHeader(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function stringValue(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullableString(value: unknown): string | null { const result = stringValue(value); return result === '' ? null : result }
function blank(value: unknown): boolean { return value === '' || value === null || value === undefined }

function nullableSatang(value: unknown): number | null {
  if (blank(value)) return null
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new JeraStoreError('JERA_STORE_CORRUPT_ROW')
  return result
}

function integerValue(value: unknown): number {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result)) throw new JeraStoreError('JERA_STORE_CORRUPT_ROW')
  return result
}

function nullableInteger(value: unknown): number | null { return blank(value) ? null : integerValue(value) }

function safeToken(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
}

function safeError(value: string): void {
  if (!/^[A-Z0-9_]{1,80}$/.test(value)) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
}

function uuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
}

function isoDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
}

function isoInstant(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
  }
  return new Date(value).toISOString()
}

function dateTime(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new JeraStoreError('JERA_STORE_INVALID_INPUT')
}

function columnName(count: number): string {
  let value = count
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

async function withMutex<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storeMutexes.get(key) ?? Promise.resolve()
  let release = (): void => undefined
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  storeMutexes.set(key, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (storeMutexes.get(key) === queued) storeMutexes.delete(key)
  }
}
