import { describe, expect, it, vi } from 'vitest'
import {
  bookingBrowserTimingEvent,
  createMiniAppApi,
  type MiniAppLiffPort,
} from '../../src/apps/pmc-mini-app/api'
import {
  bookingTimingEvent,
  emitBookingTiming,
} from '../../server/pmc-mini-app/bookingPerformanceTelemetry'
import {
  BOOKING_PERFORMANCE_FIXTURES,
  BOOKING_PERFORMANCE_FIXTURE_SPECS,
  evaluateBookingPerformanceBudget,
  measureBookingPerformance,
  runBookingPerformanceCli,
} from '../../scripts/measure-pmc-booking-performance.mjs'
import {
  aggregateMiniAppInteractionTimings,
  runMiniAppInpCli,
} from '../../scripts/measure-pmc-mini-app-inp.mjs'

describe('Booking performance telemetry', () => {
  it('emits one exact allowlisted server timing projection', () => {
    const write = vi.fn()
    expect(() => emitBookingTiming('prepare_completed', {
      route: 'prepare', action: 'draft_write', status: 200, state: 'READY_TO_CONFIRM',
      fileCount: 2, attempt: 1, elapsedMs: 812,
    }, write)).not.toThrow()
    expect(write).toHaveBeenCalledWith({
      event: 'prepare_completed', route: 'prepare', action: 'draft_write', status: 200,
      state: 'READY_TO_CONFIRM', fileCount: 2, attempt: 1, elapsedMs: 812,
    })
  })

  it.each([
    ['byte size', { totalBytes: 1 }],
    ['request ID', { requestId: 'request-private' }],
    ['draft ID', { draftId: 'draft-private' }],
    ['URL', { url: 'https://private.example' }],
    ['file name', { filename: 'customer.png' }],
    ['customer field', { customerName: 'private' }],
    ['nested data', { detail: { phone: '0812345678' } }],
    ['NaN duration', { elapsedMs: Number.NaN }],
    ['negative duration', { elapsedMs: -1 }],
    ['unbounded file count', { fileCount: 21 }],
    ['unknown route', { route: 'https://private.example' }],
    ['unknown action', { action: 'customer-private' }],
  ])('rejects unsafe server timing %s', (_label, patch) => {
    const allowed = {
      route: 'prepare', action: 'draft_write', status: 200, state: 'READY_TO_CONFIRM',
      fileCount: 2, attempt: 1, elapsedMs: 812,
    }
    expect(() => bookingTimingEvent('prepare_completed', { ...allowed, ...patch } as never))
      .toThrow('UNSAFE_BOOKING_TIMING_FIELD')
  })

  it('accepts browser request/navigation timings without content or identifiers', () => {
    expect(bookingBrowserTimingEvent('prepare_request_completed', {
      action: 'prepare', status: 200, elapsedMs: 721.5,
    })).toEqual({ event: 'prepare_request_completed', action: 'prepare', status: 200, elapsedMs: 721.5 })
    expect(bookingBrowserTimingEvent('navigation_to_home', {
      action: 'home', status: 202, elapsedMs: 94,
    })).toEqual({ event: 'navigation_to_home', action: 'home', status: 202, elapsedMs: 94 })
    expect(bookingBrowserTimingEvent('confirm_terminal_error', {
      action: 'error', status: 503, elapsedMs: 180,
    })).toEqual({ event: 'confirm_terminal_error', action: 'error', status: 503, elapsedMs: 180 })
  })

  it.each([
    ['DOM text', { text: 'ชื่อลูกค้า' }],
    ['input value', { value: 'private' }],
    ['selector', { target: '#customer' }],
    ['ID', { draftId: 'draft-private' }],
    ['file metadata', { fileCount: 2 }],
    ['URL', { url: 'https://private.example' }],
    ['nested field', { detail: { name: 'private' } }],
    ['invalid duration', { elapsedMs: Number.POSITIVE_INFINITY }],
  ])('rejects unsafe browser timing %s', (_label, patch) => {
    expect(() => bookingBrowserTimingEvent('prepare_request_completed', {
      action: 'prepare', status: 200, elapsedMs: 721, ...patch,
    } as never)).toThrow('UNSAFE_BROWSER_BOOKING_TIMING_FIELD')
  })

  it('measures prepare and confirm requests passively without changing their responses', async () => {
    const timings = vi.fn()
    const nowValues = [100, 820, 1_000, 1_180]
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        draftId: 'draft-1', requestId: 'request-1', state: 'READY_TO_CONFIRM', retentionState: '', version: 2,
        input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1,
        confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
      }))
      .mockResolvedValueOnce(response({
        requestId: 'request-1', status: 'QUEUED', projection: {
          draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', retentionState: '', version: 3,
          input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1,
          confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
        },
      }, 202))
    const api = createMiniAppApi({
      fetch, liff: inertLiff(), bookingTiming: timings, performanceNow: () => nowValues.shift()!,
    })

    const input = {
      requestId: 'request-1', adminId: 'admin-1', aeId: null, customerName: 'Customer', facebookName: 'Facebook',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
      appointmentDate: '2026-09-01', appointmentTime: '10:30', depositAmount: 900, channelId: 'channel-1',
    }
    await api.prepare('token', 'draft-1', 1, {
      input,
      paymentFiles: [new File(['png'], 'payment.png', { type: 'image/png' })],
      chatFiles: [new File(['png'], 'chat.png', { type: 'image/png' })],
    })
    await api.confirm('token', 'draft-1', 2, 2)

    expect(timings.mock.calls).toEqual([
      ['prepare_request_completed', { action: 'prepare', status: 200, elapsedMs: 720 }],
      ['confirm_request_completed', { action: 'confirm', status: 202, elapsedMs: 180 }],
    ])
  })

  it('keeps a successful API response when the composed browser timing sink throws', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      draftId: 'draft-1', requestId: 'request-1', state: 'READY_TO_CONFIRM', retentionState: '', version: 2,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1,
      confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    const api = createMiniAppApi({
      fetch,
      liff: inertLiff(),
      bookingTiming: () => { throw new Error('private telemetry failure') },
      performanceNow: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(120),
    })

    await expect(api.prepare('token', 'draft-1', 1, {
      input: {
        requestId: 'request-1', adminId: 'admin-1', aeId: null, customerName: 'Customer', facebookName: 'Facebook',
        phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
        appointmentDate: '2026-09-01', appointmentTime: '10:30', depositAmount: 900, channelId: 'channel-1',
      },
      paymentFiles: [new File(['png'], 'payment.png', { type: 'image/png' })],
      chatFiles: [new File(['png'], 'chat.png', { type: 'image/png' })],
    })).resolves.toMatchObject({ state: 'READY_TO_CONFIRM' })
  })
})

describe('Booking performance budget harness', () => {
  it('defines the exact bounded payload and recovery fixtures without customer data', () => {
    expect(BOOKING_PERFORMANCE_FIXTURE_SPECS).toEqual([
      fixtureSpec('payment-chat-2x500kb', [fileProfile('PAYMENT', 1, 500_000, 'image/jpeg', 'JPEG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), noFault(), 200, 'SUCCESS'),
      fixtureSpec('five-files-2mb', [fileProfile('PAYMENT', 3, 2_000_000, 'image/jpeg', 'JPEG'), fileProfile('CHAT', 2, 2_000_000, 'image/jpeg', 'JPEG')], fixedTransfer(), noFault(), 200, 'SUCCESS'),
      fixtureSpec('twenty-files-max25mb', [fileProfile('PAYMENT', 10, 1_250_000, 'image/png', 'PNG'), fileProfile('CHAT', 10, 1_250_000, 'image/jpeg', 'JPEG')], fixedTransfer(), noFault(), 200, 'SUCCESS'),
      fixtureSpec('chunk-overflow', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], { mode: 'CHUNKED', contentLength: 'OMITTED', rawMultipartBytes: 26_000_001 }, noFault(), 413, 'EVIDENCE_BATCH_TOO_LARGE'),
      fixtureSpec('invalid-mime', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'JPEG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), noFault(), 415, 'UNSUPPORTED_EVIDENCE'),
      fixtureSpec('partial-failure', [fileProfile('PAYMENT', 2, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 2, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'REMOTE_FAILURE_AFTER_PERSISTED_FILES', afterPersistedFiles: 2 }, 503, 'BOOKING_PREPARE_RETRY'),
      fixtureSpec('response-loss', [fileProfile('PAYMENT', 1, 500_000, 'image/png', 'PNG'), fileProfile('CHAT', 1, 500_000, 'image/jpeg', 'JPEG')], fixedTransfer(), { type: 'RESPONSE_LOSS_AFTER_APPLY' }, 200, 'IDEMPOTENT_RECOVERY'),
    ])
  })

  it('passes the exact accepted aggregate and returns all exact failure enums independently', () => {
    const passing = passingAggregate()
    expect(evaluateBookingPerformanceBudget(passing)).toEqual({ pass: true, failures: [] })

    const cases = [
      ['INSUFFICIENT_SUCCESS_RUNS', { paths: { ...passing.paths, asyncConfirm: { ...passing.paths.asyncConfirm, count: 29 } } }],
      ['ASYNC_PREPARE_P95', { paths: { ...passing.paths, asyncPreparePostParse: { ...passing.paths.asyncPreparePostParse, p95Ms: 3_001, maxMs: 3_001 } } }],
      ['SYNC_PREPARE_MEDIAN_REDUCTION', { paths: { ...passing.paths, syncPrepare: { ...passing.paths.syncPrepare, p50Ms: 7_001 } } }],
      ['ASYNC_CONFIRM_P95', { paths: { ...passing.paths, asyncConfirm: { ...passing.paths.asyncConfirm, p95Ms: 6_001, maxMs: 6_001 } } }],
      ['UNAVAILABLE_ROUTE_PROBE', { checks: { ...passing.checks, unavailableRouteProbeCount: 1 } }],
      ['MAX_FIXTURE_FAILURE', { checks: { ...passing.checks, maximumFixtureFailures: 1 } }],
      ['CONCURRENCY_DUPLICATE', { checks: { ...passing.checks, concurrencyDuplicateCount: 1 } }],
    ] as const

    for (const [failure, patch] of cases) {
      const aggregate = { ...passing, ...patch }
      expect(evaluateBookingPerformanceBudget(aggregate)).toEqual({ pass: false, failures: [failure] })
    }
  })

  it.each([
    { ...passingAggregate(), privateUrl: 'https://private.example' },
    { ...passingAggregate(), paths: { ...passingAggregate().paths, asyncConfirm: { ...passingAggregate().paths.asyncConfirm, rawSamples: [1] } } },
    { ...passingAggregate(), revision: 'private/revision' },
    { ...passingAggregate(), measuredAtUtc: 'not-a-date' },
    { ...passingAggregate(), paths: { ...passingAggregate().paths, asyncConfirm: { ...passingAggregate().paths.asyncConfirm, p50Ms: 7_000, p95Ms: 6_000 } } },
  ])('fails closed for malformed or unsafe aggregate input', (aggregate) => {
    expect(() => evaluateBookingPerformanceBudget(aggregate)).toThrow('INVALID_BOOKING_PERFORMANCE_AGGREGATE')
  })

  it('runs one discarded warm-up, 30 retained runs per path, all exact fixtures, and five concurrent clients', async () => {
    const calls: Array<Record<string, unknown>> = []
    const runner = {
      async runPath(path: string, iteration: number, warmup: boolean) {
        calls.push({ kind: 'path', path, iteration, warmup })
        return { status: path === 'asyncConfirm' ? 202 : 200, elapsedMs: path === 'legacySyncPrepare' ? 10_000 : 1_000 }
      },
      async runFixture(fixture: ReturnType<typeof fixtureSpec>) {
        calls.push({ kind: 'fixture', fixtureLabel: fixture.label })
        return fixtureAttestation(fixture)
      },
      async runConcurrent(client: number) {
        calls.push({ kind: 'concurrent', client })
        return { status: 202, duplicateCount: 0 }
      },
    }

    const aggregate = await measureBookingPerformance(runner, {
      revision: 'test-revision', now: () => new Date('2026-08-31T02:00:00.000Z'),
    })

    expect(calls.filter((call) => call.kind === 'path')).toHaveLength(4 * 31)
    expect(calls.filter((call) => call.kind === 'path' && call.warmup === true)).toHaveLength(4)
    expect(calls.filter((call) => call.kind === 'fixture').map((call) => call.fixtureLabel))
      .toEqual(BOOKING_PERFORMANCE_FIXTURES)
    expect(calls.filter((call) => call.kind === 'concurrent')).toHaveLength(5)
    expect(aggregate.paths.asyncPreparePostParse).toEqual({
      route: 'prepare', status: 200, count: 30, p50Ms: 1_000, p95Ms: 1_000, maxMs: 1_000,
    })
    expect(aggregate.measuredAtBangkok).toBe('2026-08-31T09:00:00+07:00')
    expect(evaluateBookingPerformanceBudget(aggregate)).toEqual({ pass: true, failures: [] })
  })

  it('fails the fixture gate when a reviewed runner attests a different transfer or MIME/magic profile', async () => {
    const runner = passingRunner()
    runner.runFixture = vi.fn(async (fixture: ReturnType<typeof fixtureSpec>) => ({
      ...fixtureAttestation(fixture),
      fixture: {
        ...fixture,
        transfer: fixture.transfer.mode === 'CHUNKED'
          ? { mode: 'CONTENT_LENGTH', contentLength: 'PRESENT_EXACT', rawMultipartBytes: null }
          : { mode: 'CHUNKED', contentLength: 'OMITTED', rawMultipartBytes: 26_000_001 },
      },
    }))

    const aggregate = await measureBookingPerformance(runner, {
      revision: 'test-revision', now: () => new Date('2026-08-31T02:00:00.000Z'),
    })

    expect(aggregate.checks.maximumFixtureFailures).toBe(7)
    expect(evaluateBookingPerformanceBudget(aggregate)).toEqual({ pass: false, failures: ['MAX_FIXTURE_FAILURE'] })
  })

  it('keeps help/evaluate offline and gates live mode before importing a runner', async () => {
    const write = vi.fn()
    const readFile = vi.fn(async () => JSON.stringify(passingAggregate()))
    const importRunner = vi.fn()
    expect(await runBookingPerformanceCli(['--help'], { write, readFile, importRunner, environment: {} })).toBe(0)
    expect(readFile).not.toHaveBeenCalled()
    expect(importRunner).not.toHaveBeenCalled()

    expect(await runBookingPerformanceCli(['--evaluate', 'aggregate.json'], { write, readFile, importRunner, environment: {} })).toBe(0)
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(importRunner).not.toHaveBeenCalled()

    expect(await runBookingPerformanceCli(['--live', '--runner', 'private-runner.mjs'], {
      write, readFile, importRunner, environment: {},
    })).toBe(2)
    expect(importRunner).not.toHaveBeenCalled()
  })
})

describe('Mini App interaction timing harness', () => {
  it('aggregates only safe categories and duration subparts and sets the route-splitting gate', () => {
    expect(aggregateMiniAppInteractionTimings([
      { category: 'preview', eventCount: 1, inputDelayMs: 20, processingDurationMs: 60, presentationDelayMs: 30, longestFrameMs: 75, longestScriptMs: 55 },
      { category: 'preview', eventCount: 1, inputDelayMs: 10, processingDurationMs: 30, presentationDelayMs: 20, longestFrameMs: 45, longestScriptMs: 20 },
      { category: 'confirm', eventCount: 1, inputDelayMs: 10, processingDurationMs: 100, presentationDelayMs: 120, longestFrameMs: 140, longestScriptMs: 40 },
    ])).toEqual({
      schemaVersion: 1,
      interactions: [
        { category: 'preview', count: 2, observedEventCount: 2, inp: { p50Ms: 60, p95Ms: 110, maxMs: 110 }, inputDelay: { p50Ms: 10, p95Ms: 20, maxMs: 20 }, processing: { p50Ms: 30, p95Ms: 60, maxMs: 60 }, presentation: { p50Ms: 20, p95Ms: 30, maxMs: 30 }, longestFrame: { p50Ms: 45, p95Ms: 75, maxMs: 75 }, longestScript: { p50Ms: 20, p95Ms: 55, maxMs: 55 } },
        { category: 'confirm', count: 1, observedEventCount: 1, inp: { p50Ms: 230, p95Ms: 230, maxMs: 230 }, inputDelay: { p50Ms: 10, p95Ms: 10, maxMs: 10 }, processing: { p50Ms: 100, p95Ms: 100, maxMs: 100 }, presentation: { p50Ms: 120, p95Ms: 120, maxMs: 120 }, longestFrame: { p50Ms: 140, p95Ms: 140, maxMs: 140 }, longestScript: { p50Ms: 40, p95Ms: 40, maxMs: 40 } },
      ],
      routeSplittingGate: 'REQUIRED',
    })
  })

  it.each([
    [{ category: 'customer-name', eventCount: 1, inputDelayMs: 1, processingDurationMs: 1, presentationDelayMs: 1, longestFrameMs: 1, longestScriptMs: 1 }],
    [{ category: 'preview', eventCount: 1, inputDelayMs: 1, processingDurationMs: 1, presentationDelayMs: 1, longestFrameMs: 1, longestScriptMs: 1, text: 'private' }],
    [{ category: 'preview', eventCount: 1, inputDelayMs: -1, processingDurationMs: 1, presentationDelayMs: 1, longestFrameMs: 1, longestScriptMs: 1 }],
  ])('rejects unsafe INP input without DOM or user data', (value) => {
    expect(() => aggregateMiniAppInteractionTimings(value as never)).toThrow('INVALID_MINI_APP_INTERACTION_TIMING')
  })

  it.each([
    [[
      { category: 'preview', eventCount: 0, inputDelayMs: 0, processingDurationMs: 0, presentationDelayMs: 0, longestFrameMs: 60, longestScriptMs: 0 },
      { category: 'confirm', eventCount: 1, inputDelayMs: 1, processingDurationMs: 1, presentationDelayMs: 1, longestFrameMs: 0, longestScriptMs: 0 },
    ]],
    [[
      { category: 'preview', eventCount: 1, inputDelayMs: 1, processingDurationMs: 1, presentationDelayMs: 1, longestFrameMs: 0, longestScriptMs: 0 },
    ]],
  ])('fails closed when either controlled interaction has no Event Timing evidence', (value) => {
    expect(() => aggregateMiniAppInteractionTimings(value)).toThrow('INSUFFICIENT_DATA')
  })

  it('keeps INP help offline and gates live mode before browser import', async () => {
    const write = vi.fn()
    const importBrowser = vi.fn()
    const importRunner = vi.fn()
    expect(await runMiniAppInpCli(['--help'], { write, importBrowser, importRunner, environment: {} })).toBe(0)
    expect(importBrowser).not.toHaveBeenCalled()
    expect(importRunner).not.toHaveBeenCalled()

    expect(await runMiniAppInpCli(['--live', '--runner', 'private-runner.mjs'], {
      write, importBrowser, importRunner, environment: {},
    })).toBe(2)
    expect(importBrowser).not.toHaveBeenCalled()
    expect(importRunner).not.toHaveBeenCalled()
  })

  it('returns the safe INSUFFICIENT_DATA code when controlled browser interactions produce no Event Timing entries', async () => {
    const zeroMeasurement = {
      eventCount: 0,
      inputDelayMs: 0,
      processingDurationMs: 0,
      presentationDelayMs: 0,
      longestFrameMs: 75,
      longestScriptMs: 0,
    }
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(zeroMeasurement)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(zeroMeasurement),
    }
    const close = vi.fn()
    const write = vi.fn()
    const code = await runMiniAppInpCli([
      '--live', '--owner-approved', '--runner', 'reviewed-runner.mjs',
    ], {
      write,
      environment: { PMC_BOOKING_PERFORMANCE_OWNER_GATE: 'APPROVED' },
      importRunner: async () => ({
        createBookingInpFlow: async () => ({
          url: 'https://safe.invalid/mini-app',
          interactions: [
            { category: 'preview', run: vi.fn() },
            { category: 'confirm', run: vi.fn() },
          ],
        }),
      }),
      importBrowser: async () => ({ chromium: { launch: async () => ({ newPage: async () => page, close }) } }),
    })

    expect(code).toBe(2)
    expect(write).toHaveBeenLastCalledWith(JSON.stringify({ pass: false, error: 'INSUFFICIENT_DATA' }))
    expect(close).toHaveBeenCalledOnce()
  })
})

function passingAggregate() {
  return {
    schemaVersion: 1,
    revision: 'test-revision',
    measuredAtUtc: '2026-08-31T02:00:00.000Z',
    measuredAtBangkok: '2026-08-31T09:00:00+07:00',
    fixtureLabel: 'booking-performance-v1',
    paths: {
      asyncPreparePostParse: { route: 'prepare', status: 200, count: 30, p50Ms: 1_200, p95Ms: 2_500, maxMs: 2_800 },
      syncPrepare: { route: 'prepare', status: 200, count: 30, p50Ms: 7_000, p95Ms: 8_000, maxMs: 9_000 },
      legacySyncPrepare: { route: 'prepare', status: 200, count: 30, p50Ms: 10_000, p95Ms: 12_000, maxMs: 13_000 },
      asyncConfirm: { route: 'confirm', status: 202, count: 30, p50Ms: 3_000, p95Ms: 5_000, maxMs: 5_500 },
    },
    checks: {
      unavailableRouteProbeCount: 0,
      maximumFixtureFailures: 0,
      concurrencyClients: 5,
      concurrencyDuplicateCount: 0,
    },
  }
}

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response
}

function inertLiff(): MiniAppLiffPort {
  return { init: vi.fn(), isLoggedIn: vi.fn(() => true), login: vi.fn(), getIDToken: vi.fn(() => 'token') }
}

function fileProfile(
  kind: 'PAYMENT' | 'CHAT',
  count: number,
  decodedBytesEach: number,
  advertisedMime: 'image/png' | 'image/jpeg',
  magicProfile: 'PNG' | 'JPEG',
) {
  return { kind, count, decodedBytesEach, advertisedMime, magicProfile }
}

function fixedTransfer() {
  return { mode: 'CONTENT_LENGTH', contentLength: 'PRESENT_EXACT', rawMultipartBytes: null }
}

function noFault() { return { type: 'NONE' } }

function fixtureSpec(
  label: string,
  files: ReturnType<typeof fileProfile>[],
  transfer: ReturnType<typeof fixedTransfer> | { mode: string; contentLength: string; rawMultipartBytes: number },
  fault: Record<string, unknown>,
  status: number,
  outcome: string,
) {
  return { label, files, transfer, fault, expected: { status, outcome } }
}

function fixtureAttestation(fixture: ReturnType<typeof fixtureSpec>) {
  return {
    fixture: structuredClone(fixture),
    status: fixture.expected.status,
    outcome: fixture.expected.outcome,
    unavailableRouteProbeCount: 0,
    duplicateCount: 0,
  }
}

function passingRunner() {
  return {
    async runPath(path: string) {
      return { status: path === 'asyncConfirm' ? 202 : 200, elapsedMs: path === 'legacySyncPrepare' ? 10_000 : 1_000 }
    },
    async runFixture(fixture: ReturnType<typeof fixtureSpec>) { return fixtureAttestation(fixture) },
    async runConcurrent() { return { status: 202, duplicateCount: 0 } },
  }
}
