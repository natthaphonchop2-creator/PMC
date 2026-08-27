import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthenticatedMiniAppContext } from '../pmc-mini-app/contracts.js'
import {
  JERA_ENDPOINTS,
  JERA_REPORT_TYPES,
  type JeraCacheEnvelope,
  type JeraNormalizedRow,
  type JeraReportFilters,
  type JeraReportType,
  type JeraSourceReportType,
} from './contracts.js'
import {
  buildAdditionalReport,
  buildAppointmentReport,
  buildDepositReport,
  buildPaymentReport,
  buildRefundReport,
  buildTodaySummary,
} from './reports.js'
import type { JeraSyncCoordinator } from './syncCoordinator.js'
import type { JeraReportStore, JeraSyncStateRecord } from './store.js'

export interface JeraMiniAppApi {
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    authenticated: AuthenticatedMiniAppContext,
  ): Promise<boolean>
}

const ADDITIONAL_TYPES = new Set<JeraSourceReportType>([
  'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
  'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE', 'REMAINING_COURSE_BY_DATE',
])

export function isJeraMiniAppApiPath(pathname: string): boolean {
  return pathname === '/api/mini-app/integration-health' || pathname.startsWith('/api/mini-app/reports/')
}

export function createJeraMiniAppApi(options: {
  coordinator: JeraSyncCoordinator
  store: JeraReportStore
  defaultBranchUuid: string
  now?: () => Date
  id?: () => string
}): JeraMiniAppApi {
  const now = options.now ?? (() => new Date())
  const id = options.id ?? randomUUID
  const defaultBranchUuid = requiredUuid(options.defaultBranchUuid)

  return {
    async handle(req, res, url, authenticated) {
      if (url.pathname === '/api/mini-app/integration-health') {
        if (req.method !== 'GET') return handledMethodNotAllowed(res)
        try {
          const states = await options.store.listSyncStates()
          respond(res, 200, { enabled: true, reports: healthProjection(states) })
        } catch {
          respond(res, 503, { error: 'JERA_REPORT_UNAVAILABLE' })
        }
        return true
      }

      const match = /^\/api\/mini-app\/reports\/([A-Z_]{2,40})(\/refresh)?$/.exec(url.pathname)
      if (!match) return false
      const reportType = parseReportType(match[1]!)
      if (!reportType) {
        respond(res, 404, { error: 'JERA_REPORT_NOT_FOUND' })
        return true
      }
      const refresh = match[2] === '/refresh'
      if ((!refresh && req.method !== 'GET') || (refresh && req.method !== 'POST')) return handledMethodNotAllowed(res)

      let filters: JeraReportFilters
      try {
        filters = parseFilters(reportType, url.searchParams, defaultBranchUuid, bangkokDate(now()))
      } catch {
        respond(res, 400, { error: 'JERA_FILTER_INVALID' })
        return true
      }

      if (refresh) {
        try {
          const result = await manualRefresh(reportType, filters, authenticated.staffId, options.coordinator)
          if (!result.accepted) {
            res.setHeader('retry-after', String(result.retryAfterSeconds))
            respond(res, 429, { error: 'REFRESH_THROTTLED', retryAfterSeconds: result.retryAfterSeconds })
            return true
          }
          respond(res, 202, { accepted: true, correlationId: safeCorrelationId(id()) })
        } catch {
          respond(res, 503, { error: 'JERA_REPORT_UNAVAILABLE' })
        }
        return true
      }

      try {
        const envelope = await readReport(reportType, filters, options.coordinator)
        respond(res, 200, envelope as unknown as Record<string, unknown>)
      } catch {
        respond(res, 503, { error: 'JERA_REPORT_UNAVAILABLE' })
      }
      return true
    },
  }
}

async function readReport(
  reportType: JeraReportType,
  filters: JeraReportFilters,
  coordinator: JeraSyncCoordinator,
): Promise<JeraCacheEnvelope<unknown>> {
  if (reportType !== 'TODAY_SUMMARY') {
    return projectEnvelope(reportType, await coordinator.readAndRefresh({ reportType, filters }))
  }
  const types = ['PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT'] as const
  const envelopes = await Promise.all(types.map((type) => coordinator.readAndRefresh({ reportType: type, filters })))
  return {
    data: buildTodaySummary({
      payments: envelopes[0].data, deposits: envelopes[1].data,
      refunds: envelopes[2].data, appointments: envelopes[3].data,
    }),
    source: envelopes.every(({ source }) => source === 'LIVE') ? 'LIVE' : 'CACHE',
    fetchedAt: latest(envelopes.map(({ fetchedAt }) => fetchedAt)),
    lastSuccessAt: oldest(envelopes.map(({ lastSuccessAt }) => lastSuccessAt)),
    refreshing: envelopes.some(({ refreshing }) => refreshing),
    stale: envelopes.some(({ stale }) => stale),
    warningCode: envelopes.find(({ warningCode }) => warningCode)?.warningCode ?? null,
  }
}

async function manualRefresh(
  reportType: JeraReportType,
  filters: JeraReportFilters,
  actorId: string,
  coordinator: JeraSyncCoordinator,
): Promise<{ accepted: boolean; retryAfterSeconds: number }> {
  if (reportType !== 'TODAY_SUMMARY') {
    const result = await coordinator.manualRefresh({ reportType, filters }, actorId)
    return { accepted: result.accepted, retryAfterSeconds: result.retryAfterSeconds }
  }
  const types = ['PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT'] as const
  const results = await Promise.all(types.map((type) => coordinator.manualRefresh({ reportType: type, filters }, actorId)))
  return {
    accepted: results.some(({ accepted }) => accepted),
    retryAfterSeconds: Math.min(...results.map(({ retryAfterSeconds }) => retryAfterSeconds)),
  }
}

function projectEnvelope(
  reportType: JeraSourceReportType,
  envelope: JeraCacheEnvelope<JeraNormalizedRow[]>,
): JeraCacheEnvelope<unknown> {
  let data: unknown
  if (reportType === 'PAYMENT') data = buildPaymentReport(envelope.data)
  else if (reportType === 'DEPOSIT') data = buildDepositReport(envelope.data)
  else if (reportType === 'REFUND') data = buildRefundReport(envelope.data)
  else if (reportType === 'APPOINTMENT') data = buildAppointmentReport(envelope.data)
  else if (ADDITIONAL_TYPES.has(reportType)) data = buildAdditionalReport(reportType as Parameters<typeof buildAdditionalReport>[0], envelope.data)
  else data = genericProjection(envelope.data)
  return { ...envelope, data }
}

function genericProjection(rows: JeraNormalizedRow[]) {
  return {
    rows,
    totals: {
      rowCount: rows.length,
      totalSatang: rows.reduce((sum, row) => sum + (row.totalSatang ?? 0), 0),
      paidAmountSatang: rows.reduce((sum, row) => sum + (row.paidAmountSatang ?? 0), 0),
      refundAmountSatang: rows.reduce((sum, row) => sum + (row.refundAmountSatang ?? 0), 0),
    },
  }
}

function parseReportType(value: string): JeraReportType | null {
  return JERA_REPORT_TYPES.includes(value as JeraReportType) ? value as JeraReportType : null
}

function parseFilters(
  reportType: JeraReportType,
  search: URLSearchParams,
  defaultBranchUuid: string,
  today: string,
): JeraReportFilters {
  const allowed = reportType === 'TODAY_SUMMARY'
    ? new Set<keyof JeraReportFilters>(['branchUuid', 'startDate', 'endDate'])
    : new Set(JERA_ENDPOINTS[reportType].allowedFilters)
  const values = new Map<string, string[]>()
  for (const [key, value] of search.entries()) values.set(key, [...(values.get(key) ?? []), value])
  for (const [key, entries] of values) {
    if (!allowed.has(key as keyof JeraReportFilters) || (key !== 'courseType' && entries.length !== 1)) throw new Error('invalid')
  }

  const filters = { branchUuid: defaultBranchUuid, startDate: today, endDate: today } as JeraReportFilters
  for (const [key, entries] of values) {
    const value = entries[0]!
    if (key === 'courseType') {
      if (entries.length < 1 || entries.length > 5 || new Set(entries).size !== entries.length) throw new Error('invalid')
      filters.courseType = entries.map(safeText)
    }
    else if (key === 'branchUuid' || key === 'doctorUuid' || key === 'salespersonUuid' || key === 'patientUuid' || key === 'paymentUuid') {
      filters[key] = requiredUuid(value)
    } else if (key === 'startDate' || key === 'endDate' || key === 'selectDate') {
      filters[key] = requiredDate(value)
    } else if (key === 'delFlag' || key === 'showExpired' || key === 'showDel' || key === 'showFormer') {
      filters[key] = requiredBoolean(value)
    } else {
      filters[key as 'status'] = safeText(value)
    }
  }
  if (allowed.has('branchUuid')) filters.branchUuid = requiredUuid(filters.branchUuid)
  if (allowed.has('startDate') || allowed.has('endDate')) validateRange(filters.startDate, filters.endDate)
  return filters
}

function healthProjection(states: JeraSyncStateRecord[]) {
  const byType = new Map<JeraSourceReportType, JeraSyncStateRecord>()
  for (const state of states) {
    const current = byType.get(state.reportType)
    const stateTime = state.lastAttemptAt ?? state.lastSuccessAt ?? ''
    const currentTime = current?.lastAttemptAt ?? current?.lastSuccessAt ?? ''
    if (!current || stateTime > currentTime) byType.set(state.reportType, state)
  }
  return [...byType.values()]
    .sort((left, right) => JERA_REPORT_TYPES.indexOf(left.reportType) - JERA_REPORT_TYPES.indexOf(right.reportType))
    .map(({ reportType, lastSuccessAt, status, recordCount }) => ({ reportType, lastSuccessAt, status, recordCount }))
}

function validateRange(startDate: string, endDate: string): void {
  const start = requiredDate(startDate)
  const end = requiredDate(endDate)
  const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
  if (days < 1 || days > 366) throw new Error('invalid')
}

function requiredDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('invalid')
  }
  return value
}

function requiredUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('invalid')
  return value.toLowerCase()
}

function requiredBoolean(value: string): boolean {
  if (value !== 'true' && value !== 'false') throw new Error('invalid')
  return value === 'true'
}

function safeText(value: string): string {
  if (!/^[\p{L}\p{N} _.-]{1,80}$/u.test(value)) throw new Error('invalid')
  return value
}

function bangkokDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function latest(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
}

function oldest(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value)).sort()
  return present.length === values.length ? present[0] ?? null : null
}

function safeCorrelationId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('invalid')
  return value
}

function handledMethodNotAllowed(res: ServerResponse): true {
  respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
  return true
}

function respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
