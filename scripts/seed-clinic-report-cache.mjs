#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { JERA_OPERATOR_PROJECT, loadJeraOperatorSecrets } from './jera-operator-secrets.mjs'

export const CLINIC_REPORT_SOURCE_TYPES = [
  'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT', 'PAYMENT_LIST',
  'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
  'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE',
  'REMAINING_COURSE_BY_DATE',
]

const GOOGLE_SHEETS_PACING_MS = 20_000

export async function seedClinicReportCache(args, environment = process.env, dependencies = {}) {
  const { date } = parseArguments(args)
  const coordinator = dependencies.coordinator ?? await createCoordinator(environment, dependencies)
  const filters = {
    branchUuid: requiredEnvironment(environment, 'JERA_DEFAULT_BRANCH_UUID'),
    startDate: date,
    endDate: date,
  }
  const sleep = dependencies.sleep ?? defaultSleep
  if (typeof sleep !== 'function') throw new Error('Clinic report cache seeding configuration is invalid')
  const reports = []

  for (let index = 0; index < CLINIC_REPORT_SOURCE_TYPES.length; index += 1) {
    const reportType = CLINIC_REPORT_SOURCE_TYPES[index]
    const envelope = await coordinator.scheduledRefresh({ reportType, filters })
    reports.push(safeEvidence(reportType, envelope))
    if (index + 1 < CLINIC_REPORT_SOURCE_TYPES.length) await sleep(GOOGLE_SHEETS_PACING_MS)
  }

  return { mode: 'cache-seed', date, sequential: true, reports }
}

function parseArguments(args) {
  let approved = false
  let project = null
  let date = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--allow-readonly-production' && !approved) {
      approved = true
    } else if (argument === '--project' && project === null && typeof args[index + 1] === 'string') {
      project = args[++index]
    } else if (argument === '--date' && date === null && typeof args[index + 1] === 'string') {
      date = args[++index]
    } else {
      throw new Error('Invalid cache seed arguments')
    }
  }
  if (!approved || project !== JERA_OPERATOR_PROJECT) throw new Error('Explicit read-only production approval is required')
  if (!isStrictIsoDate(date)) throw new Error('A strict one-day ISO date is required')
  return { date }
}

function isStrictIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function createCoordinator(environment, dependencies) {
  const spreadsheetId = requiredEnvironment(environment, 'PMC_SPREADSHEET_ID')
  const intakeFolderId = requiredEnvironment(environment, 'PMC_DRIVE_INTAKE_FOLDER_ID')
  const branchUuid = requiredEnvironment(environment, 'JERA_DEFAULT_BRANCH_UUID')
  const interval = requiredEnvironment(environment, 'JERA_SYNC_INTERVAL_MINUTES')
  const secrets = await (dependencies.loadJeraOperatorSecrets ?? loadJeraOperatorSecrets)(
    { project: JERA_OPERATOR_PROJECT }, { secretAccessor: dependencies.secretAccessor },
  )
  const runtime = dependencies.runtime ?? await loadRuntime()
  const config = runtime.readJeraConfig({
    JERA_REPORTING_ENABLED: 'true',
    JERA_API_BASE_URL: secrets.baseUrl,
    JERA_API_USERNAME: secrets.username,
    JERA_API_PASSWORD: secrets.password,
    JERA_DEFAULT_BRANCH_UUID: branchUuid,
    JERA_SYNC_INTERVAL_MINUTES: interval,
  })
  if (!config) throw new Error('Clinic report cache seeding configuration is invalid')

  const ports = runtime.createMiniAppGooglePorts({ spreadsheetId, intakeFolderId })
  const tokens = runtime.createJeraTokenClient(config)
  const client = runtime.createJeraReadClient(config, tokens, { mode: 'SCHEDULED' })
  const store = runtime.createGoogleJeraReportStore({ spreadsheetId, sheets: ports.sheets })
  return runtime.createJeraSyncCoordinator({
    client, store, manualRefreshSeconds: config.manualRefreshSeconds,
    staleAfterMs: config.syncIntervalMinutes * 2 * 60_000,
  })
}

async function loadRuntime() {
  const [
    config, tokenClient, client, store, coordinator, googleClient,
  ] = await Promise.all([
    import('../dist-server/server/jera/config.js'),
    import('../dist-server/server/jera/tokenClient.js'),
    import('../dist-server/server/jera/client.js'),
    import('../dist-server/server/jera/store.js'),
    import('../dist-server/server/jera/syncCoordinator.js'),
    import('../dist-server/server/pmc-mini-app/googleClient.js'),
  ])
  return {
    readJeraConfig: config.readJeraConfig,
    createJeraTokenClient: tokenClient.createJeraTokenClient,
    createJeraReadClient: client.createJeraReadClient,
    createGoogleJeraReportStore: store.createGoogleJeraReportStore,
    createJeraSyncCoordinator: coordinator.createJeraSyncCoordinator,
    createMiniAppGooglePorts: googleClient.createMiniAppGooglePorts,
  }
}

function requiredEnvironment(environment, name) {
  const value = environment?.[name]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Clinic report cache seeding configuration is invalid')
  return value.trim()
}

function safeEvidence(reportType, envelope) {
  const rows = Array.isArray(envelope?.data) ? envelope.data : []
  return {
    reportType,
    count: rows.length,
    totalSatang: sum(rows, 'totalSatang'),
    paidAmountSatang: sum(rows, 'paidAmountSatang'),
    refundAmountSatang: sum(rows, 'refundAmountSatang'),
    warningCode: typeof envelope?.warningCode === 'string' ? envelope.warningCode : null,
    lastSuccessAt: typeof envelope?.lastSuccessAt === 'string' ? envelope.lastSuccessAt : null,
  }
}

function sum(rows, field) {
  let total = 0
  for (const row of rows) {
    const value = row?.[field]
    if (Number.isSafeInteger(value) && value >= 0 && total <= Number.MAX_SAFE_INTEGER - value) total += value
  }
  return total
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedClinicReportCache(process.argv.slice(2))
    .then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`) })
    .catch(() => {
      process.stderr.write('Clinic report cache seeding failed\n')
      process.exitCode = 2
    })
}
