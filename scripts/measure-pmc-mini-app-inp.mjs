import { pathToFileURL } from 'node:url'

const CATEGORIES = Object.freeze(['preview', 'confirm'])
const HELP = `PMC Mini App INP and Long Animation Frame measurement

Offline command:
  node scripts/measure-pmc-mini-app-inp.mjs --help

Owner-gated browser command:
  PMC_BOOKING_PERFORMANCE_OWNER_GATE=APPROVED node scripts/measure-pmc-mini-app-inp.mjs \\
    --live --owner-approved --runner <reviewed-runner.mjs>

The runner supplies reviewed browser interactions. Output includes only the
safe interaction category and aggregate duration subparts; no DOM text,
selectors, attributes, screenshots, URLs, identifiers, or user values.
`

export function aggregateMiniAppInteractionTimings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) {
    throw new Error('INVALID_MINI_APP_INTERACTION_TIMING')
  }
  const parsed = value.map(parseInteractionTiming)
  const interactions = CATEGORIES.flatMap((category) => {
    const items = parsed.filter((item) => item.category === category)
    if (items.length === 0) return []
    return [{
      category,
      count: items.length,
      inp: durationSummary(items.map((item) => item.inputDelayMs + item.processingDurationMs + item.presentationDelayMs)),
      inputDelay: durationSummary(items.map((item) => item.inputDelayMs)),
      processing: durationSummary(items.map((item) => item.processingDurationMs)),
      presentation: durationSummary(items.map((item) => item.presentationDelayMs)),
      longestFrame: durationSummary(items.map((item) => item.longestFrameMs)),
      longestScript: durationSummary(items.map((item) => item.longestScriptMs)),
    }]
  })
  const routeSplittingGate = interactions.some((interaction) => interaction.inp.p95Ms > 200
    || interaction.longestScript.maxMs > 50) ? 'REQUIRED' : 'CLEAR'
  return { schemaVersion: 1, interactions, routeSplittingGate }
}

export async function runMiniAppInpCli(argv, dependencies = {}) {
  const write = dependencies.write ?? ((line) => process.stdout.write(`${line}\n`))
  const importBrowser = dependencies.importBrowser ?? (() => import('@playwright/test'))
  const importRunner = dependencies.importRunner ?? ((specifier) => import(pathToFileURL(specifier).href))
  const environment = dependencies.environment ?? process.env

  if (argv.length === 1 && argv[0] === '--help') {
    write(HELP.trimEnd())
    return 0
  }
  if (argv.includes('--live')) {
    const gate = argv.includes('--owner-approved') && environment.PMC_BOOKING_PERFORMANCE_OWNER_GATE === 'APPROVED'
    const runnerPath = optionValue(argv, '--runner')
    if (!gate || !runnerPath || unknownLiveArgument(argv)) {
      write(JSON.stringify({ pass: false, error: 'LIVE_OWNER_GATE_REQUIRED' }))
      return 2
    }
    try {
      const runnerModule = await importRunner(runnerPath)
      if (!runnerModule || typeof runnerModule.createBookingInpFlow !== 'function') throw new Error('invalid runner')
      const flow = await runnerModule.createBookingInpFlow({ environment })
      const measurements = await measureSupportedBrowserFlow(flow, await importBrowser())
      write(JSON.stringify(aggregateMiniAppInteractionTimings(measurements)))
      return 0
    } catch {
      write(JSON.stringify({ pass: false, error: 'LIVE_INP_MEASUREMENT_FAILED' }))
      return 2
    }
  }
  write(JSON.stringify({ pass: false, error: 'INVALID_ARGUMENTS' }))
  return 2
}

async function measureSupportedBrowserFlow(flow, browserModule) {
  if (!plainRecord(flow) || typeof flow.url !== 'string' || !/^https:\/\//.test(flow.url)
    || !Array.isArray(flow.interactions) || flow.interactions.length < 1 || flow.interactions.length > 20) {
    throw new Error('INVALID_MINI_APP_INP_FLOW')
  }
  const chromium = browserModule?.chromium
  if (!chromium || typeof chromium.launch !== 'function') throw new Error('INVALID_MINI_APP_INP_BROWSER')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(flow.url, { waitUntil: 'networkidle' })
    const measurements = []
    for (const interaction of flow.interactions) {
      if (!plainRecord(interaction) || !CATEGORIES.includes(interaction.category) || typeof interaction.run !== 'function'
        || Object.keys(interaction).some((key) => key !== 'category' && key !== 'run')) {
        throw new Error('INVALID_MINI_APP_INP_FLOW')
      }
      await beginBrowserMeasurement(page)
      await interaction.run(page)
      measurements.push({ category: interaction.category, ...await finishBrowserMeasurement(page) })
    }
    return measurements
  } finally {
    await browser.close()
  }
}

async function beginBrowserMeasurement(page) {
  await page.evaluate(() => {
    const bucket = { events: [], frames: [] }
    globalThis.__pmcBookingPerformanceBucket = bucket
    const eventObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 0 && 'processingStart' in entry && 'processingEnd' in entry) {
          bucket.events.push({
            duration: entry.duration,
            startTime: entry.startTime,
            processingStart: entry.processingStart,
            processingEnd: entry.processingEnd,
          })
        }
      }
    })
    try { eventObserver.observe({ type: 'event', durationThreshold: 0 }) } catch { /* unsupported browser */ }
    const frameObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        bucket.frames.push({
          duration: entry.duration,
          longestScript: Array.isArray(entry.scripts)
            ? entry.scripts.reduce((maximum, script) => Math.max(maximum, Number(script.duration) || 0), 0)
            : 0,
        })
      }
    })
    try { frameObserver.observe({ type: 'long-animation-frame' }) } catch { /* optional API */ }
    globalThis.__pmcBookingPerformanceObservers = [eventObserver, frameObserver]
  })
}

async function finishBrowserMeasurement(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => {
    const bucket = globalThis.__pmcBookingPerformanceBucket ?? { events: [], frames: [] }
    const observers = globalThis.__pmcBookingPerformanceObservers ?? []
    for (const observer of observers) observer.disconnect()
    const event = [...bucket.events].sort((left, right) => right.duration - left.duration)[0]
    const inputDelayMs = event ? Math.max(0, event.processingStart - event.startTime) : 0
    const processingDurationMs = event ? Math.max(0, event.processingEnd - event.processingStart) : 0
    const presentationDelayMs = event ? Math.max(0, event.duration - (event.processingEnd - event.startTime)) : 0
    const longestFrameMs = bucket.frames.reduce((maximum, frame) => Math.max(maximum, frame.duration), 0)
    const longestScriptMs = bucket.frames.reduce((maximum, frame) => Math.max(maximum, frame.longestScript), 0)
    delete globalThis.__pmcBookingPerformanceBucket
    delete globalThis.__pmcBookingPerformanceObservers
    return { inputDelayMs, processingDurationMs, presentationDelayMs, longestFrameMs, longestScriptMs }
  })
}

function parseInteractionTiming(value) {
  if (!plainRecord(value)
    || Object.keys(value).sort().join(',') !== 'category,inputDelayMs,longestFrameMs,longestScriptMs,presentationDelayMs,processingDurationMs'
    || !CATEGORIES.includes(value.category)
    || !safeDuration(value.inputDelayMs)
    || !safeDuration(value.processingDurationMs)
    || !safeDuration(value.presentationDelayMs)
    || !safeDuration(value.longestFrameMs)
    || !safeDuration(value.longestScriptMs)) {
    throw new Error('INVALID_MINI_APP_INTERACTION_TIMING')
  }
  return {
    category: value.category,
    inputDelayMs: value.inputDelayMs,
    processingDurationMs: value.processingDurationMs,
    presentationDelayMs: value.presentationDelayMs,
    longestFrameMs: value.longestFrameMs,
    longestScriptMs: value.longestScriptMs,
  }
}

function durationSummary(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  }
}

function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

function safeDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function optionValue(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--') ? argv[index + 1] : null
}

function unknownLiveArgument(argv) {
  const runner = optionValue(argv, '--runner')
  const consumed = new Set(['--live', '--owner-approved', '--runner', ...(runner ? [runner] : [])])
  return argv.some((argument) => !consumed.has(argument))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMiniAppInpCli(process.argv.slice(2))
}
