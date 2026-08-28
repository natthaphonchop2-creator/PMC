#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const MINI_APP_NON_SECRET_NAMES = [
  'PMC_MINI_APP_ENABLED',
  'PMC_MINI_APP_ID',
  'PMC_MINI_APP_LIFF_CHANNEL_ID',
  'PMC_SPREADSHEET_ID',
  'PMC_DRIVE_INTAKE_FOLDER_ID',
  'PMC_BOOKING_INGRESS_URL',
  'PMC_BOOKING_FALLBACK_FORM_URL',
  'PMC_MINI_APP_ENROLLMENT_ENABLED',
]

export const MINI_APP_SECRET_BINDING_NAMES = [
  'PMC_BOOKING_INGRESS_SECRET',
  'PMC_MINI_APP_SIGNING_SECRET',
]

export const MINI_APP_ASYNC_BINDING_NAMES = [
  'PMC_GCP_PROJECT_ID',
  'PMC_ASYNC_LOCATION',
  'PMC_ASYNC_BUCKET',
  'PMC_ASYNC_QUEUE',
  'PMC_ASYNC_WORKER_URL',
  'PMC_ASYNC_WORKER_AUDIENCE',
  'PMC_ASYNC_TASK_INVOKER_EMAIL',
  'PMC_ASYNC_OWNER_STAFF_IDS',
]

export const FUTURE_JERA_BINDING_NAMES = [
  'JERA_REPORTING_ENABLED',
  'JERA_API_BASE_URL',
  'JERA_DEFAULT_BRANCH_UUID',
  'JERA_SYNC_INTERVAL_MINUTES',
  'JERA_API_USERNAME',
  'JERA_API_PASSWORD',
  'JERA_SCHEDULER_AUDIENCE',
  'JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL',
]

export function inspectMiniAppRuntime(environment) {
  const nonSecret = presence(MINI_APP_NON_SECRET_NAMES, environment)
  const enrollmentEnabled = environment.PMC_MINI_APP_ENROLLMENT_ENABLED === 'true'
  const enrollmentFlagValid = environment.PMC_MINI_APP_ENROLLMENT_ENABLED === 'true'
    || environment.PMC_MINI_APP_ENROLLMENT_ENABLED === 'false'
  const secretBindings = presence([
    ...MINI_APP_SECRET_BINDING_NAMES,
    ...(enrollmentEnabled ? ['PMC_MINI_APP_ENROLLMENT_PIN'] : []),
  ], environment)
  const futureJeraBindings = presence(FUTURE_JERA_BINDING_NAMES, environment)
  const featureEnabled = environment.PMC_MINI_APP_ENABLED === 'true'
  const asyncBookingEnabled = environment.PMC_MINI_APP_ASYNC_ENABLED === 'true'
  const asyncBooking = presence(MINI_APP_ASYNC_BINDING_NAMES, environment)
  return {
    mode: 'READ_ONLY',
    ready: featureEnabled && enrollmentFlagValid && nonSecret.missing.length === 0 && secretBindings.missing.length === 0,
    featureEnabled,
    enrollmentEnabled,
    asyncBookingEnabled,
    asyncBooking,
    nonSecret,
    secretBindings,
    futureJeraBindings,
  }
}

export async function runRuntimeCheck(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  let envFile = null
  let strict = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--env-file' && args[index + 1]) envFile = args[++index]
    else if (argument === '--strict') strict = true
    else throw new Error(`Unknown runtime-check argument: ${argument}`)
  }
  const fileEnvironment = envFile ? parseEnvFile(await readFile(envFile, 'utf8')) : {}
  const report = inspectMiniAppRuntime({ ...process.env, ...fileEnvironment })
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return strict && !report.ready ? 1 : 0
}

function presence(names, environment) {
  const present = names.filter((name) => Boolean(environment[name]?.trim()))
  return { present, missing: names.filter((name) => !present.includes(name)) }
}

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
  runRuntimeCheck(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Runtime check failed'}\n`)
      process.exitCode = 2
    })
}
