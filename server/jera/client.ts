import type { JeraConfig } from './config.js'
import {
  JERA_ENDPOINTS,
  type JeraEndpointDefinition,
  type JeraEndpointKey,
  type JeraReadPort,
  type JeraReportFilters,
} from './contracts.js'
import type { JeraTokenPort } from './tokenClient.js'

interface JeraResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

type JeraFetch = (
  url: string,
  init: { method: 'GET'; headers: { authorization: string; accept: 'application/json' }; signal: AbortSignal },
) => Promise<JeraResponse>

export class JeraReadError extends Error {
  readonly code:
    | 'JERA_READ_ONLY_VIOLATION'
    | 'JERA_FILTER_INVALID'
    | 'JERA_AUTH_FAILED'
    | 'JERA_RATE_LIMITED'
    | 'JERA_TIMEOUT'
    | 'JERA_PROVIDER_FAILED'
    | 'JERA_SCHEMA_INVALID'
  readonly retryAfterSeconds: number | null

  constructor(code: JeraReadError['code'], retryAfterSeconds: number | null = null) {
    super(`JERA read failed: ${code}`)
    this.name = 'JeraReadError'
    this.code = code
    this.retryAfterSeconds = code === 'JERA_RATE_LIMITED' && retryAfterSeconds !== null
      && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1 && retryAfterSeconds <= 120 ? retryAfterSeconds : null
  }
}

export interface JeraReadClient extends JeraReadPort {
  rawRequest(input: { method: string; path: string; query?: Array<[string, string]> }): Promise<unknown>
}

export function createJeraReadClient(
  config: JeraConfig,
  tokens: JeraTokenPort,
  options: {
    fetch?: JeraFetch
    mode?: 'INTERACTIVE' | 'SCHEDULED'
    sleep?: (milliseconds: number) => Promise<void>
    replayUnauthorized?: boolean
  } = {},
): JeraReadClient {
  const request = options.fetch ?? (globalThis.fetch as unknown as JeraFetch)
  const mode = options.mode ?? 'INTERACTIVE'
  const timeoutMs = mode === 'SCHEDULED' ? config.scheduledTimeoutMs : config.interactiveTimeoutMs
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  if (!request) throw new Error('JERA fetch is unavailable')

  async function rawRequest(input: { method: string; path: string; query?: Array<[string, string]> }): Promise<unknown> {
    if (input.method !== 'GET' || !safeRelativePath(input.path) || !registeredEndpoint(input.path)) {
      throw new JeraReadError('JERA_READ_ONLY_VIOLATION')
    }
    validateRawQuery(input.query ?? [])
    const url = new URL(input.path, `${config.baseUrl}/`)
    for (const [key, value] of input.query ?? []) url.searchParams.append(key, value)
    return performGet(url)
  }

  async function performGet(url: URL): Promise<unknown> {
    let authReplayAvailable = options.replayUnauthorized !== false
    let providerRetries = mode === 'SCHEDULED' ? 2 : 0
    while (true) {
      const token = await tokens.getAccessToken()
      const response = await getWithTimeout(url, token)
      if (response.status === 401 && authReplayAvailable) {
        authReplayAvailable = false
        tokens.invalidate()
        continue
      }
      if (response.status === 401) throw new JeraReadError('JERA_AUTH_FAILED')
      if (response.status === 429 && providerRetries > 0) {
        providerRetries -= 1
        await sleep(parseProviderRetryAfter(response.headers.get('retry-after'), Date.now()) ?? 1_000)
        continue
      }
      if (response.status >= 500 && providerRetries > 0) {
        providerRetries -= 1
        await sleep(providerRetries === 1 ? 250 : 500)
        continue
      }
      if (response.status === 429) {
        const retryAfterMs = parseProviderRetryAfter(response.headers.get('retry-after'), Date.now())
        throw new JeraReadError('JERA_RATE_LIMITED', retryAfterMs === null ? null : retryAfterMs / 1_000)
      }
      if (!response.ok) throw new JeraReadError('JERA_PROVIDER_FAILED')
      return boundedJson(response, config.maxResponseBytes)
    }
  }

  async function getWithTimeout(url: URL, token: string): Promise<JeraResponse> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      try {
        return await request(url.toString(), {
          method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal,
        })
      } catch {
        if (timedOut) throw new JeraReadError('JERA_TIMEOUT')
        throw new JeraReadError('JERA_PROVIDER_FAILED')
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    rawRequest,
    async request(reportType, filters) {
      const endpoint = JERA_ENDPOINTS[reportType]
      if (!endpoint || reportType === 'CLINIC' || reportType === 'CLINIC_USERS' || reportType === 'QUEUE_LIST' || reportType === 'PAYMENT_DETAIL') {
        if (!endpoint) throw new JeraReadError('JERA_READ_ONLY_VIOLATION')
      }
      const normalized = validateFilters(reportType, filters, endpoint, config.defaultBranchUuid)
      const variants = providerFilterVariants(reportType, normalized)
      const rows: unknown[] = []
      const seen = new Set<string>()
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const variant = variants[variantIndex]
        const chunks = endpointNeedsDate(endpoint) ? dateChunks(variant.startDate, variant.endDate) : [{ startDate: '', endDate: '' }]
        for (const chunk of chunks) {
          const path = endpointPath(endpoint.path, variant)
          let page = 1
          while (true) {
            const query = endpointQuery(reportType, { ...variant, ...chunk }, endpoint, page)
            const parsed = await rawRequest({ method: 'GET', path, query })
            const pageResult = extractRows(reportType, parsed, endpoint.paginated)
            pageResult.rows.forEach((row, index) => {
              const identity = stableReportIdentity(reportType, row)
                ?? stableIdentity(row)
                ?? `${variantIndex}:${chunk.startDate}:${page}:${index}`
              if (!seen.has(identity)) { seen.add(identity); rows.push(row) }
            })
            if (!endpoint.paginated || !pageResult.hasMore(page, rows.length)) break
            page += 1
            if (page > 1_000) throw new JeraReadError('JERA_SCHEMA_INVALID')
          }
        }
      }
      return rows
    },
  }
}

function providerFilterVariants(endpointKey: JeraEndpointKey, filters: JeraReportFilters): JeraReportFilters[] {
  if ((endpointKey === 'PRODUCT_USE' || endpointKey === 'PRODUCT_SALES') && !filters.type) {
    return ['medicine', 'service', 'course'].map((type) => ({ ...filters, type }))
  }
  if (endpointKey === 'COURSE_SALES' && !filters.ctype) return [{ ...filters, ctype: '01' }]
  if (endpointKey === 'REMAINING_COURSE') {
    return [{
      ...filters,
      courseType: filters.courseType ?? ['normal', 'private', 'buffet'],
      searchBy: filters.searchBy ?? 'buy_date',
      remainingType: filters.remainingType ?? 'remain',
      showExpired: filters.showExpired ?? false,
      showDel: filters.showDel ?? false,
      showFormer: filters.showFormer ?? false,
    }]
  }
  if (endpointKey === 'REMAINING_COURSE_BY_DATE') {
    return [{
      ...filters,
      courseType: filters.courseType ?? ['normal', 'private', 'buffet'],
      searchBy: filters.searchBy ?? 'buy_date',
      selectDate: filters.selectDate ?? filters.endDate,
      showExpired: filters.showExpired ?? false,
      showDel: filters.showDel ?? false,
      showFormer: filters.showFormer ?? false,
    }]
  }
  return [filters]
}

export function parseProviderRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 120 ? seconds * 1_000 : null
  }
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return null
  const delay = Math.ceil((dateMs - nowMs) / 1_000) * 1_000
  return delay >= 1_000 && delay <= 120_000 ? delay : null
}

function validateFilters(
  endpointKey: JeraEndpointKey,
  filters: JeraReportFilters,
  endpoint: JeraEndpointDefinition,
  defaultBranchUuid: string,
): JeraReportFilters {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new JeraReadError('JERA_FILTER_INVALID')
  const allowed = new Set(endpoint.allowedFilters)
  if (Object.keys(filters).some((key) => !allowed.has(key as keyof JeraReportFilters))) throw new JeraReadError('JERA_FILTER_INVALID')
  const normalized = { ...filters, branchUuid: filters.branchUuid || defaultBranchUuid }
  for (const key of ['branchUuid', 'doctorUuid', 'salespersonUuid', 'patientUuid', 'paymentUuid'] as const) {
    const value = normalized[key]
    if (value !== undefined && !uuid(value)) throw new JeraReadError('JERA_FILTER_INVALID')
  }
  if (endpointNeedsDate(endpoint)) validateDateRange(normalized.startDate, normalized.endDate)
  for (const key of ['status', 'type', 'code', 'ctype', 'searchBy', 'remainingType'] as const) {
    const value = normalized[key]
    if (value !== undefined && (typeof value !== 'string' || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(value))) throw new JeraReadError('JERA_FILTER_INVALID')
  }
  if (normalized.selectDate !== undefined && !isoDate(normalized.selectDate)) throw new JeraReadError('JERA_FILTER_INVALID')
  if (normalized.courseType !== undefined && (!Array.isArray(normalized.courseType) || normalized.courseType.length > 5
    || normalized.courseType.some((value) => !/^[A-Za-z0-9_-]{1,40}$/.test(value)))) throw new JeraReadError('JERA_FILTER_INVALID')
  if (endpointKey === 'PAYMENT_DETAIL' && !normalized.paymentUuid) throw new JeraReadError('JERA_FILTER_INVALID')
  return normalized
}

function endpointNeedsDate(endpoint: JeraEndpointDefinition): boolean {
  return endpoint.allowedFilters.includes('startDate') || endpoint.allowedFilters.includes('endDate')
}

function validateDateRange(startDate: string, endDate: string): void {
  if (!isoDate(startDate) || !isoDate(endDate)) throw new JeraReadError('JERA_FILTER_INVALID')
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  const days = Math.floor((end - start) / 86_400_000) + 1
  if (end < start || days > 366) throw new JeraReadError('JERA_FILTER_INVALID')
}

function dateChunks(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
  const chunks: Array<{ startDate: string; endDate: string }> = []
  let cursor = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + 30 * 86_400_000, end)
    chunks.push({ startDate: new Date(cursor).toISOString().slice(0, 10), endDate: new Date(chunkEnd).toISOString().slice(0, 10) })
    cursor = chunkEnd + 86_400_000
  }
  return chunks
}

function endpointPath(template: string, filters: JeraReportFilters): string {
  return template
    .replace('{branchUuid}', encodeURIComponent(filters.branchUuid))
    .replace('{paymentUuid}', encodeURIComponent(filters.paymentUuid ?? ''))
}

function endpointQuery(
  endpointKey: JeraEndpointKey,
  filters: JeraReportFilters,
  endpoint: JeraEndpointDefinition,
  page: number,
): Array<[string, string]> {
  const mapping: Array<[keyof JeraReportFilters, string]> = [
    ['branchUuid', 'branch_uuid'], ['startDate', 'start_date'], ['endDate', 'end_date'], ['doctorUuid', 'doctor_uuid'],
    ['salespersonUuid', 'salesperson_uuid'], ['status', 'status'], ['type', 'type'], ['code', 'code'], ['delFlag', 'del_flag'],
    ['ctype', 'ctype'], ['searchBy', 'search_by'], ['remainingType', 'remaining_type'], ['selectDate', 'select_date'],
    ['showExpired', 'show_expired'], ['showDel', 'show_del'], ['showFormer', 'show_former'], ['patientUuid', 'patient_uuid'],
  ]
  const query: Array<[string, string]> = []
  for (const [key, providerName] of mapping) {
    if (!endpoint.allowedFilters.includes(key)) continue
    const value = filters[key]
    if (value !== undefined && value !== null && value !== '') query.push([providerName, String(value)])
  }
  if (filters.courseType) filters.courseType.forEach((value) => query.push(['course_type', value]))
  if (endpointKey === 'APPOINTMENT') query.push(['search_by_date', 'appoint_date'])
  if (endpoint.paginated) query.push(['page', String(page)], ['row_per_page', '100'])
  return query
}

function extractRows(
  endpointKey: JeraEndpointKey,
  value: unknown,
  paginated: boolean,
): { rows: unknown[]; hasMore(page: number, accumulated: number): boolean } {
  if (Array.isArray(value)) return { rows: value, hasMore: () => false }
  if (!value || typeof value !== 'object') throw new JeraReadError('JERA_SCHEMA_INVALID')
  const body = value as Record<string, unknown>
  if (endpointKey === 'PAYMENT' && Array.isArray(body.payment_data)) {
    return { rows: body.payment_data, hasMore: () => false }
  }
  if (endpointKey === 'DEPOSIT' && Array.isArray(body.cash_deposits) && Array.isArray(body.product_deposits)) {
    return {
      rows: [
        ...body.cash_deposits.map((data) => ({ __jeraDepositType: 'CASH_DEPOSIT', data })),
        ...body.product_deposits.map((data) => ({ __jeraDepositType: 'PRODUCT_DEPOSIT', data })),
      ],
      hasMore: () => false,
    }
  }
  if (endpointKey === 'PAYMENT_DETAIL') return { rows: [body], hasMore: () => false }
  const rows = Array.isArray(body.results) ? body.results : Array.isArray(body.data) ? body.data : null
  if (!rows) throw new JeraReadError('JERA_SCHEMA_INVALID')
  if (!paginated) return { rows, hasMore: () => false }
  const count = typeof body.count === 'number' && Number.isSafeInteger(body.count) && body.count >= 0 ? body.count : null
  const next = body.next
  return {
    rows,
    hasMore(page, accumulated) {
      if (count !== null) return accumulated < count
      return next !== null && next !== undefined && next !== '' && rows.length === 100 && page < 1_000
    },
  }
}

async function boundedJson(response: JeraResponse, maxBytes: number): Promise<unknown> {
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > maxBytes) throw new JeraReadError('JERA_SCHEMA_INVALID')
  let bytes: Buffer
  try { bytes = Buffer.from(await response.arrayBuffer()) } catch { throw new JeraReadError('JERA_SCHEMA_INVALID') }
  if (bytes.length === 0 || bytes.length > maxBytes) throw new JeraReadError('JERA_SCHEMA_INVALID')
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new JeraReadError('JERA_SCHEMA_INVALID') }
}

function validateRawQuery(query: Array<[string, string]>): void {
  const repeated = new Set(['course_type'])
  const seen = new Set<string>()
  for (const [key, value] of query) {
    if (!/^[a-z_]{1,40}$/.test(key) || value.length > 256) throw new JeraReadError('JERA_FILTER_INVALID')
    if (seen.has(key) && !repeated.has(key)) throw new JeraReadError('JERA_FILTER_INVALID')
    seen.add(key)
  }
}

function registeredEndpoint(path: string): boolean {
  return Object.values(JERA_ENDPOINTS).some((endpoint) => templateRegex(endpoint.path).test(path))
}

function templateRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('\\{branchUuid\\}', '[0-9a-fA-F-]{36}')
    .replace('\\{paymentUuid\\}', '[0-9a-fA-F-]{36}')
  return new RegExp(`^${escaped}$`)
}

function safeRelativePath(path: string): boolean {
  return path.startsWith('/openapi/v1/') && !path.includes('..') && !path.includes('://') && !/[?#\r\n]/.test(path)
}

function stableIdentity(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if ((row.__jeraDepositType === 'CASH_DEPOSIT' || row.__jeraDepositType === 'PRODUCT_DEPOSIT') && row.data) {
    const identity = stableIdentity(row.data)
    return identity ? `${row.__jeraDepositType}:${identity}` : null
  }
  for (const key of ['uuid', 'id', 'appointment_uuid', 'payment_uuid', 'code']) {
    if (typeof row[key] === 'string' && row[key]) return `${key}:${row[key]}`
  }
  return null
}

function stableReportIdentity(endpointKey: JeraEndpointKey, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (endpointKey === 'PRODUCT_USE') {
    return boundedIdentity(endpointKey, row, ['opd_code', 'product_code', 'patient_code', 'opd_create_date', 'action'])
  }
  if (endpointKey === 'PRODUCT_SALES') {
    return boundedIdentity(endpointKey, row, ['product_code', 'action', 'type_name', 'cat_name', 'subcat_name'], 2)
  }
  return null
}

function boundedIdentity(
  prefix: string,
  row: Record<string, unknown>,
  keys: string[],
  requiredCount = keys.length,
): string | null {
  const values = keys.map((key) => row[key])
  if (values.slice(0, requiredCount).some((value) => typeof value !== 'string' || value.length === 0 || value.length > 512)) return null
  if (values.slice(requiredCount).some((value) => value !== null && value !== undefined
    && (typeof value !== 'string' || value.length > 512))) return null
  return `${prefix}:${JSON.stringify(values)}`
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
