#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

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
    })
  } else if (parsed.report || parsed.startDate || parsed.endDate) {
    throw new Error('Production probe requires --allow-readonly-production')
  }

  io.stdout.write(`${JSON.stringify({ ...report, productionProbe }, null, 2)}\n`)
  return parsed.strict && !report.ready ? 1 : 0
}

async function probeOneDay({ report, date, environment, fetch }) {
  if (!(report in PROBE_REPORTS) || !isoDate(date)) throw new Error('Production probe report or one-day range is invalid')
  if (typeof fetch !== 'function') throw new Error('Fetch is unavailable')
  const baseUrl = safeBaseUrl(environment.JERA_API_BASE_URL)
  const branchUuid = environment.JERA_DEFAULT_BRANCH_UUID
  const username = environment.JERA_API_USERNAME
  const password = environment.JERA_API_PASSWORD
  if (!baseUrl || !uuid(branchUuid) || !boundedSecret(username) || !boundedSecret(password)) throw new Error('JERA runtime bindings are not ready')

  const tokenResponse = await fetch(`${baseUrl}/openapi/v1/token/`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(30_000),
  })
  if (!tokenResponse.ok) throw new Error('JERA token verification failed')
  const tokenBody = await boundedJson(tokenResponse)
  if (!tokenBody || typeof tokenBody !== 'object' || typeof tokenBody.access_token !== 'string'
    || tokenBody.access_token.length < 6 || tokenBody.access_token.length > 8_192 || /\s/.test(tokenBody.access_token)) {
    throw new Error('JERA token verification failed')
  }

  const url = new URL(PROBE_REPORTS[report], `${baseUrl}/`)
  url.searchParams.set('branch_uuid', branchUuid)
  url.searchParams.set('start_date', date)
  url.searchParams.set('end_date', date)
  if (report === 'APPOINTMENT') {
    url.searchParams.set('search_by_date', 'appoint_date')
    url.searchParams.set('page', '1')
    url.searchParams.set('row_per_page', '100')
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${tokenBody.access_token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error('JERA one-day read failed')
  const body = await boundedJson(response)
  const rows = rowsFor(report, body)
  return {
    executed: true,
    report,
    startDate: date,
    endDate: date,
    count: rows.length,
    totalSatang: rows.reduce((sum, row) => sum + moneyFor(report, row), 0),
  }
}

function rowsFor(report, body) {
  if (report === 'PAYMENT') return Array.isArray(body?.payment_data) ? body.payment_data : schemaError()
  if (report === 'DEPOSIT') {
    if (!Array.isArray(body?.cash_deposits) || !Array.isArray(body?.product_deposits)) return schemaError()
    return [...body.cash_deposits, ...body.product_deposits]
  }
  if (report === 'REFUND') return Array.isArray(body) ? body : schemaError()
  if (report === 'APPOINTMENT') return Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : schemaError()
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

async function boundedJson(response) {
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > 2_000_000) throw new Error('JERA response is too large')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > 2_000_000) throw new Error('JERA response is invalid')
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error('JERA response is invalid') }
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
