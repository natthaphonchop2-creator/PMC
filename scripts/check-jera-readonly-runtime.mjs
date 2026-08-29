#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { requestOperatorToken, requestScheduledProviderJson } from './jera-operator-transport.mjs'

export const JERA_NON_SECRET_NAMES = [
  'JERA_REPORTING_ENABLED',
  'JERA_API_BASE_URL',
  'JERA_DEFAULT_BRANCH_UUID',
  'JERA_SYNC_INTERVAL_MINUTES',
]

export const JERA_SECRET_BINDING_NAMES = ['JERA_API_USERNAME', 'JERA_API_PASSWORD']
export const JERA_SCHEDULER_NAMES = ['JERA_SCHEDULER_AUDIENCE', 'JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL']

const PROBE_REPORTS = {
  PAYMENT: '/openapi/v1/report/payment/',
  DEPOSIT: '/openapi/v1/report/deposit/',
  REFUND: '/openapi/v1/report/refund/',
  APPOINTMENT: '/openapi/v1/appointment/',
}

const APPOINTMENT_PAGE_SIZE = 100
const MAX_APPOINTMENT_PAGES = 1_000

export function inspectJeraRuntime(environment) {
  const nonSecret = presence(JERA_NON_SECRET_NAMES, environment)
  const secretBindings = presence(JERA_SECRET_BINDING_NAMES, environment)
  const schedulerBindings = presence(JERA_SCHEDULER_NAMES, environment)
  const reportingEnabled = environment.JERA_REPORTING_ENABLED === 'true'
  const validBaseUrl = safeBaseUrl(environment.JERA_API_BASE_URL) !== null
  const validBranchUuid = uuid(environment.JERA_DEFAULT_BRANCH_UUID)
  const syncMinutes = Number(environment.JERA_SYNC_INTERVAL_MINUTES)
  const validSyncInterval = Number.isSafeInteger(syncMinutes) && syncMinutes >= 15 && syncMinutes <= 60
  const schedulerPairReady = schedulerBindings.present.length === 0 || schedulerBindings.missing.length === 0
  return {
    mode: 'READ_ONLY',
    ready: reportingEnabled && nonSecret.missing.length === 0 && secretBindings.missing.length === 0
      && validBaseUrl && validBranchUuid && validSyncInterval && schedulerPairReady,
    reportingEnabled,
    nonSecret,
    secretBindings,
    schedulerBindings,
    validation: { validBaseUrl, validBranchUuid, validSyncInterval, schedulerPairReady },
  }
}

export async function runJeraRuntimeCheck(args, options = {}) {
  const environment = options.environment ?? process.env
  const request = options.fetch ?? globalThis.fetch
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr }
  const parsed = parseArguments(args)
  const fileEnvironment = parsed.envFile ? parseEnvFile(await readFile(parsed.envFile, 'utf8')) : {}
  const effectiveEnvironment = { ...environment, ...fileEnvironment }
  const report = inspectJeraRuntime(effectiveEnvironment)

  let productionProbe = { executed: false }
  if (parsed.allowReadonlyProduction) {
    if (!parsed.report || !parsed.startDate || !parsed.endDate || parsed.startDate !== parsed.endDate) {
      throw new Error('Production probe requires an explicit one-day start/end range and report')
    }
    if (!report.ready) throw new Error('JERA runtime bindings are not ready')
    productionProbe = await probeOneDay({
      report: parsed.report,
      date: parsed.startDate,
      environment: effectiveEnvironment,
      fetch: request,
      sleep: options.sleep,
    })
  } else if (parsed.report || parsed.startDate || parsed.endDate) {
    throw new Error('Production probe requires --allow-readonly-production')
  }

  io.stdout.write(`${JSON.stringify({ ...report, productionProbe }, null, 2)}\n`)
  return parsed.strict && !report.ready ? 1 : 0
}

async function probeOneDay({ report, date, environment, fetch, sleep }) {
  if (!(report in PROBE_REPORTS) || !isoDate(date)) throw new Error('Production probe report or one-day range is invalid')
  if (typeof fetch !== 'function') throw new Error('Fetch is unavailable')
  const baseUrl = safeBaseUrl(environment.JERA_API_BASE_URL)
  const branchUuid = environment.JERA_DEFAULT_BRANCH_UUID
  const username = environment.JERA_API_USERNAME
  const password = environment.JERA_API_PASSWORD
  if (!baseUrl || !uuid(branchUuid) || !boundedSecret(username) || !boundedSecret(password)) throw new Error('JERA runtime bindings are not ready')

  try {
    const token = await requestOperatorToken({ fetch, baseUrl, username, password })
    const appointment = report === 'APPOINTMENT'
      ? await readAppointments({ baseUrl, branchUuid, date, fetch, token, sleep })
      : rowsFor(report, await readOneDayReport({ report, baseUrl, branchUuid, date, fetch, token, sleep }))
    return {
      executed: true,
      report,
      startDate: date,
      endDate: date,
      count: report === 'APPOINTMENT' ? appointment.count : appointment.length,
      totalSatang: report === 'APPOINTMENT' ? 0 : appointment.reduce((sum, row) => sum + moneyFor(report, row), 0),
    }
  } catch {
    throw new Error('JERA runtime probe failed')
  }
}

async function readOneDayReport({ report, baseUrl, branchUuid, date, fetch, token, sleep }) {
  const url = new URL(PROBE_REPORTS[report], `${baseUrl}/`)
  url.searchParams.set('branch_uuid', branchUuid)
  url.searchParams.set('start_date', date)
  url.searchParams.set('end_date', date)
  return requestScheduledProviderJson({ fetch, url: url.toString(), accessToken: token, sleep })
}

export async function readAppointments({ baseUrl, branchUuid, date, fetch, token, sleep }) {
  let acceptedCount = 0
  const seenUuids = new Set()
  let expectedCount = null
  let rawRows = 0

  for (let page = 1; page <= MAX_APPOINTMENT_PAGES; page += 1) {
    const url = new URL(PROBE_REPORTS.APPOINTMENT, `${baseUrl}/`)
    url.searchParams.set('branch_uuid', branchUuid)
    url.searchParams.set('start_date', date)
    url.searchParams.set('end_date', date)
    url.searchParams.set('search_by_date', 'appoint_date')
    url.searchParams.set('page', String(page))
    url.searchParams.set('row_per_page', String(APPOINTMENT_PAGE_SIZE))
    const body = await requestScheduledProviderJson({ fetch, url: url.toString(), accessToken: token, sleep })
    const pageResult = appointmentPage(body)
    if (pageResult.rows.length > APPOINTMENT_PAGE_SIZE) throw new Error('JERA appointment pagination is inconsistent')
    if (pageResult.count !== null) {
      if (expectedCount === null) expectedCount = pageResult.count
      else if (expectedCount !== pageResult.count) throw new Error('JERA appointment pagination is inconsistent')
    }

    rawRows += pageResult.rows.length
    if (expectedCount !== null && rawRows > expectedCount) throw new Error('JERA appointment pagination is inconsistent')
    let addedRows = 0
    for (const row of pageResult.rows) {
      const stableUuid = providerUuid(row)
      if (stableUuid) {
        if (seenUuids.has(stableUuid)) continue
        seenUuids.add(stableUuid)
      }
      acceptedCount += 1
      addedRows += 1
    }

    if (expectedCount !== null) {
      if (rawRows === expectedCount) {
        if (acceptedCount !== expectedCount) throw new Error('JERA appointment pagination is inconsistent')
        return { count: acceptedCount }
      }
      if (pageResult.rows.length === 0 || addedRows === 0 || page === MAX_APPOINTMENT_PAGES) {
        throw new Error('JERA appointment pagination is inconsistent')
      }
      continue
    }

    const hasNext = typeof pageResult.next === 'string' && pageResult.next.length > 0 && pageResult.next.length <= 2_048
    if (!hasNext || pageResult.rows.length < APPOINTMENT_PAGE_SIZE) return { count: acceptedCount }
    if (addedRows === 0 || page === MAX_APPOINTMENT_PAGES) throw new Error('JERA appointment pagination is inconsistent')
  }
  throw new Error('JERA appointment pagination is inconsistent')
}

function appointmentPage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JERA one-day schema is invalid')
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.results) ? body.results : null
  if (!rows) throw new Error('JERA one-day schema is invalid')
  const count = body.count === undefined || body.count === null
    ? null
    : Number.isSafeInteger(body.count) && body.count >= 0 ? body.count : schemaError()
  return { rows, count, next: body.next }
}

function providerUuid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of ['uuid', 'appointment_uuid']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
      return candidate.toLowerCase()
    }
  }
  return null
}

function rowsFor(report, body) {
  if (report === 'PAYMENT') return Array.isArray(body?.payment_data) ? body.payment_data : schemaError()
  if (report === 'DEPOSIT') {
    if (!Array.isArray(body?.cash_deposits) || !Array.isArray(body?.product_deposits)) return schemaError()
    return [...body.cash_deposits, ...body.product_deposits]
  }
  if (report === 'REFUND') return Array.isArray(body) ? body : schemaError()
  return schemaError()
}

function moneyFor(report, value) {
  if (!value || typeof value !== 'object') throw new Error('JERA one-day schema is invalid')
  if (report === 'PAYMENT' || report === 'DEPOSIT') return moneyToSatang(value.paid_amount)
  if (report === 'REFUND') return moneyToSatang(value.total_refund_cost)
  return 0
}

function moneyToSatang(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('JERA one-day schema is invalid')
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new Error('JERA one-day schema is invalid')
  const satang = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  if (satang > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('JERA one-day total is unsafe')
  return Number(satang)
}

function parseArguments(args) {
  const parsed = {
    envFile: null,
    strict: false,
    allowReadonlyProduction: false,
    report: null,
    startDate: null,
    endDate: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--env-file' && args[index + 1]) parsed.envFile = args[++index]
    else if (argument === '--strict') parsed.strict = true
    else if (argument === '--allow-readonly-production') parsed.allowReadonlyProduction = true
    else if (argument === '--report' && args[index + 1]) parsed.report = args[++index]
    else if (argument === '--start-date' && args[index + 1]) parsed.startDate = args[++index]
    else if (argument === '--end-date' && args[index + 1]) parsed.endDate = args[++index]
    else throw new Error(`Unknown JERA runtime-check argument: ${argument}`)
  }
  return parsed
}

function presence(names, environment) {
  const present = names.filter((name) => Boolean(environment[name]?.trim()))
  return { present, missing: names.filter((name) => !present.includes(name)) }
}

function safeBaseUrl(value) {
  try {
    const url = new URL(value ?? '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || (url.pathname !== '/' && url.pathname !== '')) return null
    return url.origin
  } catch {
    return null
  }
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function boundedSecret(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_024
}

function schemaError() { throw new Error('JERA one-day schema is invalid') }

function parseEnvFile(contents) {
  const environment = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice('export '.length) : line
    const separator = normalized.indexOf('=')
    if (separator < 1) continue
    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) environment[key] = value
  }
  return environment
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runJeraRuntimeCheck(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'JERA runtime check failed'}\n`)
      process.exitCode = 2
    })
}
