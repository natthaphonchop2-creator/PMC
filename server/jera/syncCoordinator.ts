import { randomUUID } from 'node:crypto'
import { filterHash, jeraCacheKey } from './cacheKey.js'
import type {
  JeraCacheEnvelope,
  JeraNormalizationContext,
  JeraNormalizedRow,
  JeraReadPort,
  JeraReportFilters,
  JeraSourceReportType,
} from './contracts.js'
import {
  normalizeAppointmentList,
  normalizeCancelledPaymentReport,
  normalizeCancelledUnpaidReport,
  normalizeCourseSalesReport,
  normalizeDepositReport,
  normalizeOpdReport,
  normalizePaymentList,
  normalizePaymentReport,
  normalizeProductSalesReport,
  normalizeProductUseReport,
  normalizeRefundReport,
  normalizeRemainingCourseByDateReport,
  normalizeRemainingCourseReport,
} from './normalize.js'
import type { JeraReportStore, JeraSyncAuditRecord, JeraSyncStateRecord } from './store.js'

export interface JeraSyncQuery {
  reportType: JeraSourceReportType
  filters: JeraReportFilters
}

export interface JeraManualRefreshResult {
  accepted: boolean
  retryAfterSeconds: number
}

export interface JeraSyncCoordinator {
  readAndRefresh(query: JeraSyncQuery): Promise<JeraCacheEnvelope<JeraNormalizedRow[]>>
  manualRefresh(query: JeraSyncQuery, actorId: string): Promise<JeraManualRefreshResult>
  scheduledRefresh(query: JeraSyncQuery): Promise<JeraCacheEnvelope<JeraNormalizedRow[]>>
  dailyLookback(input: {
    reportTypes: JeraSourceReportType[]
    branchUuid: string
    endDate: string
    days?: number
  }): Promise<Array<JeraCacheEnvelope<JeraNormalizedRow[]>>>
  waitForIdle(): Promise<void>
}

type JeraNormalizer = (payload: unknown, context: JeraNormalizationContext) => JeraNormalizedRow[]

const DEFAULT_NORMALIZERS: Partial<Record<JeraSourceReportType, JeraNormalizer>> = {
  PAYMENT: normalizePaymentReport,
  DEPOSIT: normalizeDepositReport,
  REFUND: normalizeRefundReport,
  APPOINTMENT: normalizeAppointmentList,
  PAYMENT_LIST: normalizePaymentList,
  PRODUCT_USE: normalizeProductUseReport,
  PRODUCT_SALES: normalizeProductSalesReport,
  CANCELLED_PAYMENT: normalizeCancelledPaymentReport,
  OPD: normalizeOpdReport,
  CANCELLED_UNPAID: normalizeCancelledUnpaidReport,
  COURSE_SALES: normalizeCourseSalesReport,
  REMAINING_COURSE: normalizeRemainingCourseReport,
  REMAINING_COURSE_BY_DATE: normalizeRemainingCourseByDateReport,
}

export class JeraSyncError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'JeraSyncError'
    this.code = code
  }
}

export function createJeraSyncCoordinator(options: {
  client: JeraReadPort
  store: JeraReportStore
  now?: () => Date
  id?: () => string
  normalizers?: Partial<Record<JeraSourceReportType, JeraNormalizer>>
  manualRefreshSeconds?: number
  maxPendingRefreshes?: number
  staleAfterMs?: number
  leaseTtlMs?: number
}): JeraSyncCoordinator {
  const now = options.now ?? (() => new Date())
  const id = options.id ?? randomUUID
  const normalizers = { ...DEFAULT_NORMALIZERS, ...options.normalizers }
  const manualRefreshSeconds = positiveInteger(options.manualRefreshSeconds ?? 300, 60, 3_600)
  const maxPendingRefreshes = positiveInteger(options.maxPendingRefreshes ?? 4, 1, 20)
  const staleAfterMs = positiveInteger(options.staleAfterMs ?? 30 * 60_000, 60_000, 24 * 60 * 60_000)
  const leaseTtlMs = positiveInteger(options.leaseTtlMs ?? 60_000, 1_000, 900_000)
  const inFlight = new Map<string, Promise<JeraNormalizedRow[] | null>>()
  let refreshTail: Promise<void> = Promise.resolve()

  function startRefresh(query: JeraSyncQuery, actorType: JeraSyncAuditRecord['actorType'], actorId: string): Promise<JeraNormalizedRow[] | null> {
    const key = jeraCacheKey(query.reportType, query.filters)
    const active = inFlight.get(key)
    if (active) return active
    if (inFlight.size >= maxPendingRefreshes) return Promise.resolve(null)
    const operation = refreshTail.then(() => refresh(query, actorType, actorId))
    refreshTail = operation.then(() => undefined, () => undefined)
    const promise = operation.finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
    inFlight.set(key, promise)
    return promise
  }

  async function refresh(
    query: JeraSyncQuery,
    actorType: JeraSyncAuditRecord['actorType'],
    actorId: string,
  ): Promise<JeraNormalizedRow[] | null> {
    const key = jeraCacheKey(query.reportType, query.filters)
    const hash = filterHash(query.filters)
    const runId = safeId(id())
    const startedAt = now().toISOString()
    const claimed = await options.store.claimLease({
      cacheKey: key, reportType: query.reportType, filterHash: hash, owner: runId, now: startedAt, ttlMs: leaseTtlMs,
    })
    if (!claimed) return null

    let recordCount = 0
    try {
      const current = await options.store.getSyncState(key)
      await options.store.saveSyncState({
        ...baseState(query, key, hash, current), lastAttemptAt: startedAt, status: 'RUNNING', safeErrorCode: null,
        leaseOwner: runId, leaseExpiresAt: new Date(Date.parse(startedAt) + leaseTtlMs).toISOString(),
      })
      const providerRows = await options.client.request(query.reportType, query.filters)
      const fetchedAt = now().toISOString()
      const normalizer = normalizers[query.reportType]
      if (!normalizer) throw new JeraSyncError('JERA_NORMALIZER_UNAVAILABLE')
      const normalizedRows = normalizer(providerRows, {
        cacheKey: key, branchUuid: query.filters.branchUuid, fetchedAt,
        startDate: query.filters.startDate, endDate: query.filters.endDate,
      })
      recordCount = normalizedRows.length
      await options.store.replaceRows(query.reportType, key, normalizedRows)
      const finishedAt = now().toISOString()
      const stateAfterWrite = await options.store.getSyncState(key)
      await options.store.saveSyncState({
        ...baseState(query, key, hash, stateAfterWrite), lastAttemptAt: startedAt, lastSuccessAt: finishedAt,
        lastSourceDate: latestSourceDate(normalizedRows), status: 'SUCCESS', recordCount,
        safeErrorCode: null, leaseOwner: runId, leaseExpiresAt: new Date(Date.parse(startedAt) + leaseTtlMs).toISOString(),
      })
      await options.store.appendSyncAudit(audit({
        runId, actorType, actorId, query, hash, startedAt, finishedAt, status: 'SUCCESS', recordCount, safeErrorCode: null,
      }))
      return normalizedRows
    } catch (error) {
      const safeErrorCode = safeError(error)
      const finishedAt = now().toISOString()
      const stateAfterFailure = await options.store.getSyncState(key)
      await options.store.saveSyncState({
        ...baseState(query, key, hash, stateAfterFailure), lastAttemptAt: startedAt, status: 'FAILED',
        safeErrorCode, leaseOwner: runId, leaseExpiresAt: new Date(Date.parse(startedAt) + leaseTtlMs).toISOString(),
      })
      await options.store.appendSyncAudit(audit({
        runId, actorType, actorId, query, hash, startedAt, finishedAt, status: 'FAILED', recordCount, safeErrorCode,
      }))
      throw new JeraSyncError(safeErrorCode)
    } finally {
      await options.store.releaseLease(key, runId)
    }
  }

  async function cachedSnapshot(query: JeraSyncQuery, refreshing: boolean): Promise<{
    envelope: JeraCacheEnvelope<JeraNormalizedRow[]>
    state: JeraSyncStateRecord | null
  }> {
    const key = jeraCacheKey(query.reportType, query.filters)
    const [data, state] = await Promise.all([
      options.store.readRows(query.reportType, { cacheKey: key }), options.store.getSyncState(key),
    ])
    return { envelope: envelope(data, state, 'CACHE', refreshing, now(), staleAfterMs), state }
  }

  async function cachedEnvelope(query: JeraSyncQuery, refreshing: boolean): Promise<JeraCacheEnvelope<JeraNormalizedRow[]>> {
    return (await cachedSnapshot(query, refreshing)).envelope
  }

  return {
    async readAndRefresh(query) {
      const key = jeraCacheKey(query.reportType, query.filters)
      return cachedEnvelope(query, inFlight.has(key))
    },
    async manualRefresh(query, actorId) {
      const key = jeraCacheKey(query.reportType, query.filters)
      const hash = filterHash(query.filters)
      const currentTime = now().toISOString()
      const current = await options.store.getSyncState(key)
      const elapsedSeconds = current?.lastManualAt
        ? Math.max(0, Math.floor((Date.parse(currentTime) - Date.parse(current.lastManualAt)) / 1_000))
        : Number.POSITIVE_INFINITY
      if (elapsedSeconds < manualRefreshSeconds) {
        return {
          accepted: false,
          retryAfterSeconds: manualRefreshSeconds - elapsedSeconds,
        }
      }
      if (!inFlight.has(key) && inFlight.size >= maxPendingRefreshes) {
        return {
          accepted: false,
          retryAfterSeconds: Math.min(manualRefreshSeconds, 60),
        }
      }
      await options.store.saveSyncState({
        ...baseState(query, key, hash, current), lastManualAt: currentTime,
      })
      const rows = await startRefresh(query, 'MANUAL', safeId(actorId))
      if (rows === null) {
        return {
          accepted: false,
          retryAfterSeconds: Math.min(manualRefreshSeconds, 60),
        }
      }
      return { accepted: true, retryAfterSeconds: manualRefreshSeconds }
    },
    async scheduledRefresh(query) {
      const rows = await startRefresh(query, 'SCHEDULED', 'cloud-scheduler')
      if (rows === null) return cachedEnvelope(query, inFlight.has(jeraCacheKey(query.reportType, query.filters)))
      const state = await options.store.getSyncState(jeraCacheKey(query.reportType, query.filters))
      return envelope(rows, state, 'LIVE', false, now(), staleAfterMs)
    },
    async dailyLookback(input) {
      const days = positiveInteger(input.days ?? 90, 1, 366)
      const end = parseIsoDate(input.endDate)
      const start = new Date(end.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
      const results: Array<JeraCacheEnvelope<JeraNormalizedRow[]>> = []
      for (const reportType of input.reportTypes) {
        const query = { reportType, filters: { branchUuid: input.branchUuid, startDate: start, endDate: input.endDate } }
        const rows = await startRefresh(query, 'LOOKBACK', 'cloud-scheduler-lookback')
        if (rows === null) {
          results.push(await cachedEnvelope(query, inFlight.has(jeraCacheKey(reportType, query.filters))))
        } else {
          const state = await options.store.getSyncState(jeraCacheKey(reportType, query.filters))
          results.push(envelope(rows, state, 'LIVE', false, now(), staleAfterMs))
        }
      }
      return results
    },
    async waitForIdle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()])
    },
  }
}

function baseState(
  query: JeraSyncQuery,
  cacheKey: string,
  hash: string,
  current: JeraSyncStateRecord | null,
): JeraSyncStateRecord {
  return {
    cacheKey, reportType: query.reportType, filterHash: hash,
    lastAttemptAt: current?.lastAttemptAt ?? null, lastManualAt: current?.lastManualAt ?? null,
    lastSuccessAt: current?.lastSuccessAt ?? null, lastSourceDate: current?.lastSourceDate ?? null,
    status: current?.status ?? 'IDLE', recordCount: current?.recordCount ?? 0, nextPage: current?.nextPage ?? null,
    safeErrorCode: current?.safeErrorCode ?? null, leaseOwner: current?.leaseOwner ?? null,
    leaseExpiresAt: current?.leaseExpiresAt ?? null,
  }
}

function audit(input: {
  runId: string
  actorType: JeraSyncAuditRecord['actorType']
  actorId: string
  query: JeraSyncQuery
  hash: string
  startedAt: string
  finishedAt: string
  status: JeraSyncAuditRecord['status']
  recordCount: number
  safeErrorCode: string | null
}): JeraSyncAuditRecord {
  return {
    syncRunId: input.runId, actorType: input.actorType, actorId: safeId(input.actorId), reportType: input.query.reportType,
    filterHash: input.hash, startedAt: input.startedAt, finishedAt: input.finishedAt, status: input.status,
    recordCount: input.recordCount, safeErrorCode: input.safeErrorCode, correlationId: `${input.runId}-corr`,
  }
}

function envelope(
  data: JeraNormalizedRow[],
  state: JeraSyncStateRecord | null,
  source: 'CACHE' | 'LIVE',
  refreshing: boolean,
  now: Date,
  staleAfterMs: number,
): JeraCacheEnvelope<JeraNormalizedRow[]> {
  const lastSuccessAt = state?.lastSuccessAt ?? null
  const stale = !lastSuccessAt || now.getTime() - Date.parse(lastSuccessAt) >= staleAfterMs
  const warningCode = state?.status === 'FAILED'
    ? state.safeErrorCode ?? 'JERA_DATA_STALE'
    : stale ? (data.length === 0 ? 'JERA_CACHE_EMPTY' : 'JERA_DATA_STALE') : null
  return {
    data: structuredClone(data), source, fetchedAt: latestFetchedAt(data), lastSuccessAt,
    refreshing, stale, warningCode,
  }
}

function latestFetchedAt(rows: JeraNormalizedRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest, null)
}

function latestSourceDate(rows: JeraNormalizedRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => !latest || row.eventDate > latest ? row.eventDate : latest, null)
}

function safeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code)
    if (/^JERA_[A-Z0-9_]{1,72}$/.test(code)) return code
  }
  if (error instanceof JeraSyncError && /^JERA_[A-Z0-9_]{1,72}$/.test(error.code)) return error.code
  return 'JERA_PROVIDER_FAILED'
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new JeraSyncError('JERA_SYNC_ID_INVALID')
  return value
}

function positiveInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new JeraSyncError('JERA_SYNC_CONFIG_INVALID')
  return value
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new JeraSyncError('JERA_FILTER_INVALID')
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new JeraSyncError('JERA_FILTER_INVALID')
  return date
}

export function isJeraRefreshDue(lastAttemptAt: string | null, now: string, intervalMinutes = 15): boolean {
  const interval = positiveInteger(intervalMinutes, 15, 60) * 60_000
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new JeraSyncError('JERA_SYNC_TIME_INVALID')
  if (lastAttemptAt === null) return true
  const previous = Date.parse(lastAttemptAt)
  if (!Number.isFinite(previous)) throw new JeraSyncError('JERA_SYNC_TIME_INVALID')
  return nowMs - previous >= interval
}
