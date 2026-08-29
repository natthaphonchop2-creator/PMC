#!/usr/bin/env node
import { constants } from 'node:fs'
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPROVED_FINANCE_PROJECT, FINANCE_REPORT_DELAY_MS, FINANCE_STATUS_DELAY_MS, assertNoSensitiveFlags,
  createFinanceOperator, safeProject, seedApprovedFinanceDay, strictDate,
} from './seed-finance-report-day.mjs'

const DATE_DELAY_MS = 60_000
const MAX_DAYS = 31

export async function backfillFinanceReportDays(args, options = {}) {
  const parsed = parseArguments(args)
  const io = options.io ?? { stdout: process.stdout }
  if (parsed.help) {
    io.stdout.write('Usage: backfill-finance-report-days --allow-readonly-production --allow-cache-write --project <id> --start-date YYYY-MM-DD --end-date YYYY-MM-DD --resume-file /operator-owned/path/file.json\n')
    return 0
  }
  const resumeStore = options.resumeStore ?? fileResumeStore
  let state = await safeReadResume(resumeStore, parsed.resumeFile, parsed.startDate, parsed.endDate)
  if (!state) {
    state = initialState(parsed.startDate, parsed.endDate)
    await resumeStore.writeAtomic(parsed.resumeFile, state)
  }
  let operator
  try {
    operator = await (options.createOperator ?? createFinanceOperator)({
      project: parsed.project, execute: options.execute, environment: options.environment,
    })
  } catch { throw new Error('FINANCE_OPERATOR_FAILED') }
  const sleep = options.sleep ?? defaultSleep
  const days = dateLabels(parsed.startDate, parsed.endDate)
  const startIndex = state.nextDate === null ? days.length : days.indexOf(state.nextDate)
  if (startIndex < 0) throw new Error('FINANCE_RESUME_INVALID')

  for (let index = startIndex; index < days.length; index += 1) {
    const date = days[index]
    try {
      const seeded = await seedApprovedFinanceDay({
        date, operator, sleep,
        reportDelayMs: options.reportDelayMs ?? FINANCE_REPORT_DELAY_MS,
        statusDelayMs: options.statusDelayMs ?? FINANCE_STATUS_DELAY_MS,
        maxStatusReads: options.maxStatusReads ?? 6,
      })
      if (seeded.allocation.status !== 'COMPLETE') throw new Error('FINANCE_ALLOCATION_INCOMPLETE')
      state = {
        ...state,
        nextDate: days[index + 1] ?? null,
        completedDates: [...new Set([...state.completedDates, date])].sort(),
        safeFailures: state.safeFailures.filter((failure) => failure.date !== date),
      }
      await resumeStore.writeAtomic(parsed.resumeFile, state)
    } catch (error) {
      const failure = safeFailure(date, error)
      state = {
        ...state, nextDate: date,
        safeFailures: [...state.safeFailures.filter((item) => item.date !== date), failure].slice(-MAX_DAYS),
      }
      await resumeStore.writeAtomic(parsed.resumeFile, state)
      io.stdout.write(`${JSON.stringify(resultReport(state))}\n`)
      return 1
    }
    if (index + 1 < days.length) await sleep(minimumDateDelay(options.dateDelayMs))
  }
  io.stdout.write(`${JSON.stringify(resultReport(state))}\n`)
  return 0
}

function parseArguments(args) {
  assertNoSensitiveFlags(args)
  const parsed = {
    help: false, allowReadonlyProduction: false, allowCacheWrite: false,
    project: null, startDate: null, endDate: null, resumeFile: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--help' || value === '-h') parsed.help = true
    else if (value === '--allow-readonly-production') parsed.allowReadonlyProduction = true
    else if (value === '--allow-cache-write') parsed.allowCacheWrite = true
    else if (value === '--project' && parsed.project === null && args[index + 1]) parsed.project = args[++index]
    else if (value === '--start-date' && parsed.startDate === null && args[index + 1]) parsed.startDate = args[++index]
    else if (value === '--end-date' && parsed.endDate === null && args[index + 1]) parsed.endDate = args[++index]
    else if (value === '--resume-file' && parsed.resumeFile === null && args[index + 1]) parsed.resumeFile = args[++index]
    else throw new Error('Unknown finance operator argument')
  }
  if (parsed.help) return parsed
  if (!parsed.allowReadonlyProduction) throw new Error('Explicit read-only production approval is required')
  if (!parsed.allowCacheWrite) throw new Error('Explicit cache-write approval is required')
  if (!parsed.resumeFile) throw new Error('Explicit resume-file path is required')
  parsed.project = safeProject(parsed.project)
  if (parsed.project !== APPROVED_FINANCE_PROJECT) throw new Error('Approved finance project is required')
  parsed.startDate = strictDate(parsed.startDate)
  parsed.endDate = strictDate(parsed.endDate)
  if (!isAbsolute(parsed.resumeFile) || parsed.resumeFile.length > 1_024 || /[\r\n\0]/.test(parsed.resumeFile)) {
    throw new Error('Resume file must be an absolute operator-owned path')
  }
  dateLabels(parsed.startDate, parsed.endDate)
  return parsed
}

function dateLabels(start, end) {
  const startMs = Date.parse(`${strictDate(start)}T00:00:00.000Z`)
  const endMs = Date.parse(`${strictDate(end)}T00:00:00.000Z`)
  const count = Math.floor((endMs - startMs) / 86_400_000) + 1
  if (count < 1 || count > MAX_DAYS) throw new Error('Backfill range must contain 1-31 exact Bangkok dates')
  return Array.from({ length: count }, (_, index) => new Date(startMs + index * 86_400_000).toISOString().slice(0, 10))
}

function initialState(startDate, endDate) {
  return { version: 1, startDate, endDate, nextDate: startDate, completedDates: [], safeFailures: [] }
}
function resultReport(state) {
  return {
    mode: 'FINANCE_BACKFILL', startDate: state.startDate, endDate: state.endDate,
    completedCount: state.completedDates.length, nextDate: state.nextDate,
    safeFailureCount: state.safeFailures.length,
  }
}
function safeFailure(date, error) {
  const safeInputCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : error?.message
  const code = safeInputCode === 'FINANCE_RATE_LIMITED' ? 'FINANCE_RATE_LIMITED'
    : safeInputCode === 'FINANCE_ALLOCATION_INCOMPLETE' ? 'FINANCE_ALLOCATION_INCOMPLETE'
      : safeInputCode === 'FINANCE_AUTH_FAILED' ? 'FINANCE_AUTH_STOPPED'
        : safeInputCode === 'FINANCE_SCHEMA_INVALID' ? 'FINANCE_SCHEMA_STOPPED' : 'FINANCE_BACKFILL_STOPPED'
  const retryAfterSeconds = code === 'FINANCE_RATE_LIMITED'
    && Number.isSafeInteger(error?.retryAfterSeconds) && error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 3_600
    ? error.retryAfterSeconds : null
  return { date, safeCode: code, retryAfterSeconds }
}

async function safeReadResume(store, path, startDate, endDate) {
  let value
  try { value = await store.read(path) } catch { throw new Error('FINANCE_RESUME_INVALID') }
  if (value === null) return null
  if (!validResume(value, startDate, endDate)) throw new Error('FINANCE_RESUME_INVALID')
  return structuredClone(value)
}
function validResume(value, startDate, endDate) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value)) !== JSON.stringify(['version', 'startDate', 'endDate', 'nextDate', 'completedDates', 'safeFailures'])
    || value.version !== 1 || value.startDate !== startDate || value.endDate !== endDate) return false
  const days = dateLabels(startDate, endDate)
  if (value.nextDate !== null && !days.includes(value.nextDate)
    || !Array.isArray(value.completedDates) || value.completedDates.some((date) => !days.includes(date))
    || new Set(value.completedDates).size !== value.completedDates.length
    || !Array.isArray(value.safeFailures) || value.safeFailures.length > MAX_DAYS) return false
  const nextIndex = value.nextDate === null ? days.length : days.indexOf(value.nextDate)
  if (JSON.stringify(value.completedDates) !== JSON.stringify(days.slice(0, nextIndex))) return false
  return value.safeFailures.every((failure) => failure && typeof failure === 'object'
    && JSON.stringify(Object.keys(failure)) === JSON.stringify(['date', 'safeCode', 'retryAfterSeconds'])
    && days.includes(failure.date) && /^FINANCE_[A-Z0-9_]{1,70}$/.test(failure.safeCode)
    && (failure.retryAfterSeconds === null || Number.isSafeInteger(failure.retryAfterSeconds) && failure.retryAfterSeconds >= 1 && failure.retryAfterSeconds <= 3_600))
}

const fileResumeStore = {
  async read(path) {
    await assertOperatorOwnedTarget(path, true)
    try { return JSON.parse(await readFile(path, 'utf8')) }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  },
  async writeAtomic(path, state) {
    await assertOperatorOwnedTarget(path, true)
    const parent = dirname(path)
    const temporary = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
    let handle
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8')
      await handle.sync()
      await handle.close(); handle = null
      await rename(temporary, path)
      const directory = await open(parent, constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  },
}

async function assertOperatorOwnedTarget(path, allowMissing) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || uid !== null && parent.uid !== uid) throw new Error('resume path is not operator owned')
  try {
    const target = await lstat(path)
    if (!target.isFile() || target.isSymbolicLink() || uid !== null && target.uid !== uid || (target.mode & 0o077) !== 0) throw new Error('resume path is not operator owned')
  } catch (error) {
    if (error?.code !== 'ENOENT' || !allowMissing) throw error
  }
}
function defaultSleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
function minimumDateDelay(value) { return Number.isSafeInteger(value) && value >= DATE_DELAY_MS && value <= 600_000 ? value : DATE_DELAY_MS }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillFinanceReportDays(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    const message = error instanceof Error && /^(Explicit|Unknown|Sensitive|A strict|Backfill|Resume file)/.test(error.message)
      ? error.message : 'Finance backfill failed'
    process.stderr.write(`${message}\n`); process.exitCode = 2
  })
}
