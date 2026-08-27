import { createHash } from 'node:crypto'
import type { JeraReportFilters, JeraSourceReportType } from './contracts.js'

const FILTER_KEYS = new Set<keyof JeraReportFilters>([
  'branchUuid', 'startDate', 'endDate', 'doctorUuid', 'salespersonUuid', 'status', 'type', 'code', 'delFlag',
  'ctype', 'courseType', 'searchBy', 'remainingType', 'selectDate', 'showExpired', 'showDel', 'showFormer',
  'patientUuid', 'paymentUuid',
])
const UUID_KEYS = new Set<keyof JeraReportFilters>([
  'branchUuid', 'doctorUuid', 'salespersonUuid', 'patientUuid', 'paymentUuid',
])

export class JeraCacheKeyError extends Error {
  readonly code = 'JERA_CACHE_FILTER_INVALID' as const

  constructor() {
    super('JERA_CACHE_FILTER_INVALID')
    this.name = 'JeraCacheKeyError'
  }
}

export function jeraCacheKey(reportType: JeraSourceReportType, filters: JeraReportFilters): string {
  if (!/^[A-Z_]{2,40}$/.test(reportType)) throw new JeraCacheKeyError()
  return `${reportType}:${filterHash(filters)}`
}

export function filterHash(filters: JeraReportFilters): string {
  const canonical = canonicalFilters(filters)
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function canonicalFilters(filters: JeraReportFilters): Record<string, unknown> {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new JeraCacheKeyError()
  const result: Record<string, unknown> = {}
  const keys = Object.keys(filters).sort()
  for (const rawKey of keys) {
    const key = rawKey as keyof JeraReportFilters
    if (!FILTER_KEYS.has(key)) throw new JeraCacheKeyError()
    const value = filters[key]
    if (value === undefined) continue
    if (key === 'courseType') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new JeraCacheKeyError()
      result[key] = [...new Set(value)].sort()
      continue
    }
    if (UUID_KEYS.has(key)) {
      if (typeof value !== 'string') throw new JeraCacheKeyError()
      result[key] = value.toLowerCase()
      continue
    }
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new JeraCacheKeyError()
    result[key] = value
  }
  return result
}
