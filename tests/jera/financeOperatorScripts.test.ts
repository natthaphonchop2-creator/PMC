import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JERA_OPERATOR_PROJECT } from '../../scripts/jera-operator-secrets.mjs'

const PROJECT = JERA_OPERATOR_PROJECT
const SERVICE = 'pmc-mini-app'
const REGION = 'asia-southeast1'
const APPROVED_DAY = '2026-08-22'
const NOW = '2026-08-30T02:00:00.000Z'
const QUEUE = 'pmc-revenue-allocation'
const AUDIENCE = 'https://private.example'
const INVOKER = 'invoker@example.iam.gserviceaccount.com'
const SEED_URL = `${AUDIENCE}/internal/mini-app/finance-daily-seed`

describe('finance operator script approval gates', () => {
  it('loads the three operator modules with callable entry points', async () => {
    const [check, seed, backfill] = await loadScripts()

    expect(check.runFinanceRuntimeCheck).toBeTypeOf('function')
    expect(seed.seedFinanceReportDay).toBeTypeOf('function')
    expect(seed.seedApprovedFinanceDay).toBeTypeOf('function')
    expect(backfill.backfillFinanceReportDays).toBeTypeOf('function')
  })

  it('rejects before any external access when the exact allow flags are missing', async () => {
    const [check, seed, backfill] = await loadScripts()
    const external = vi.fn(async () => { throw new Error('must not execute') })

    await expect(check.runFinanceRuntimeCheck([
      '--project', PROJECT, '--service', SERVICE, '--region', REGION, '--expected-finance-viewers', '3',
    ], { execute: external })).rejects.toThrow('Explicit read-only production approval is required')
    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--project', PROJECT, '--date', APPROVED_DAY,
    ], { createOperator: external })).rejects.toThrow('Explicit cache-write approval is required')
    await expect(backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02',
    ], { createOperator: external })).rejects.toThrow('Explicit resume-file path is required')

    expect(external).not.toHaveBeenCalled()
  })

  it('rejects unknown, credential, Sheet, and LINE identity CLI flags before external access', async () => {
    const [check, seed, backfill] = await loadScripts()
    const external = vi.fn(async () => { throw new Error('must not execute') })
    const forbidden = ['--username', '--password', '--token', '--sheet-id', '--line-user-id']

    for (const flag of forbidden) {
      await expect(check.runFinanceRuntimeCheck([
        '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
        '--expected-finance-viewers', '3', flag, 'private-value',
      ], { execute: external })).rejects.toThrow('Sensitive command-line arguments are forbidden')
    }
    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
      '--surprise', 'value',
    ], { createOperator: external })).rejects.toThrow('Unknown finance operator argument')
    await expect(backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', '/tmp/operator-resume.json',
      '--password', 'private-value',
    ], { createOperator: external })).rejects.toThrow('Sensitive command-line arguments are forbidden')

    expect(external).not.toHaveBeenCalled()
  })

  it('prints help without external access', async () => {
    const [check, seed, backfill] = await loadScripts()
    for (const run of [check.runFinanceRuntimeCheck, seed.seedFinanceReportDay, backfill.backfillFinanceReportDays]) {
      const stdout = bufferWriter()
      const external = vi.fn(async () => { throw new Error('must not execute') })
      await expect(run(['--help'], { execute: external, createOperator: external, io: { stdout } })).resolves.toBe(0)
      expect(stdout.text()).toContain('Usage:')
      expect(external).not.toHaveBeenCalled()
    }
  })
})

describe('read-only finance runtime checker', () => {
  it('reports only safe aggregates while checking flags, bindings, headers, immutable roles, leases, and task payload contracts', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const calls: string[][] = []
    const execute = vi.fn(async (command: string[]) => {
      calls.push(command)
      const joined = command.join(' ')
      if (joined.includes('run services describe')) return JSON.stringify(cloudRunService())
      if (joined.includes('tasks queues describe')) return JSON.stringify(queueDescription())
      if (joined.includes('tasks queues get-iam-policy')) return JSON.stringify({
        bindings: [{ role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }],
      })
      if (joined.includes('run services get-iam-policy')) return JSON.stringify({
        bindings: [{ role: 'roles/run.invoker', members: ['serviceAccount:invoker@example.iam.gserviceaccount.com'] }],
      })
      if (joined.includes('scheduler jobs list')) return JSON.stringify([{
        state: 'ENABLED', httpTarget: { uri: 'https://private.example/internal/unrelated-job' },
      }])
      if (joined.includes('tasks list')) return JSON.stringify([{ httpRequest: { body: Buffer.from(JSON.stringify({
        branchUuid: '11111111-2222-4333-8444-555555555555', eventDate: APPROVED_DAY,
        paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 2,
      })).toString('base64') } }])
      if (joined.includes('storage buckets describe')) return JSON.stringify({ location: REGION })
      if (joined.includes('storage buckets get-iam-policy')) return JSON.stringify({
        bindings: [{ role: 'roles/storage.objectUser', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }],
      })
      throw new Error('token=private-subprocess-error')
    })
    const googleReads = vi.fn(async () => googleState())

    const code = await check.runFinanceRuntimeCheck([
      '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
      '--expected-finance-viewers', '3', '--expected-stage=DISABLED',
    ], { execute, readGoogleState: googleReads, now: () => new Date(NOW), io: { stdout } })

    expect(code).toBe(0)
    expect(googleReads).toHaveBeenCalledOnce()
    expect(calls.every((command) => !command.some((part) => /create|update|delete|set-iam-policy|add-iam-policy-binding|run jobs run/.test(part)))).toBe(true)
    const report = JSON.parse(stdout.text())
    expect(report).toMatchObject({
      mode: 'READ_ONLY',
      expectedStage: 'DISABLED', stageReady: true,
      cloudRun: { servicePresent: true, trafficPercentTotal: 100, trafficTargetCount: 1 },
      flags: { financeReportsEnabled: false, revenueAllocationEnabled: false, categoryMoneyEnabled: false },
      allocationConfig: { requiredNameCount: 7, presentNameCount: 7, leaseBucketPresent: true },
      queue: { present: true, maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.016 },
      bindings: { queueEnqueuerPresent: true, oidcInvokerPresent: true, leaseBucketObjectUserPresent: true },
      scheduler: { matchingJobCount: 0, enabledJobCount: 0, oidcBindingPresent: false },
      tasks: { pendingCount: 1, validMetadataHashCount: 1, validAttemptCount: 1, invalidPayloadCount: 0 },
      tabs: { exactHeaderCount: 3, requiredHeaderCount: 3 },
      financePermissions: { expectedCount: 3, activeViewerCount: 3, nameBasedDerivationCount: 0 },
      leases: { activeCount: 1, olderThan15MinutesCount: 0, oldestActiveAgeSeconds: 300 },
    })
    expect(report.financePermissions.viewers).toEqual([
      { staffId: 'ADMIN_01', name: 'Owner' },
      { staffId: 'DOCTOR_01', name: 'Doctor' },
      { staffId: 'ADMIN_09', name: 'Mus' },
    ])
    expect(stdout.text()).not.toContain('U-secret')
    expect(stdout.text()).not.toContain('private-spreadsheet')
    expect(stdout.text()).not.toContain('private.example')
    expect(stdout.text()).not.toContain('runtime@example')
  })

  it('redacts subprocess failures and returns safe absence/status fields', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const execute = vi.fn(async () => { throw new Error('password=private token=secret') })

    const code = await check.runFinanceRuntimeCheck([
      '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
      '--expected-finance-viewers', '3', '--expected-stage=DISABLED',
    ], { execute, readGoogleState: vi.fn(async () => { throw new Error('sheet private-spreadsheet') }), io: { stdout } })

    expect(code).toBe(1)
    expect(stdout.text()).not.toContain('private')
    expect(stdout.text()).not.toContain('secret')
    expect(JSON.parse(stdout.text())).toMatchObject({ mode: 'READ_ONLY', ready: false, safeCode: 'FINANCE_RUNTIME_INCOMPLETE' })
  })

  it('accepts only the exact DISABLED, ALLOCATION, and READY stage values before external access', async () => {
    const [check] = await loadScripts()
    const execute = vi.fn(async () => { throw new Error('must not execute') })
    for (const stage of ['', 'disabled', 'CANARY', 'READY ']) {
      const stageArg = stage ? [`--expected-stage=${stage}`] : []
      await expect(check.runFinanceRuntimeCheck([
        '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
        '--expected-finance-viewers', '3', ...stageArg,
      ], { execute })).rejects.toThrow('Expected stage must be DISABLED, ALLOCATION, or READY')
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('makes ALLOCATION ready only with exact flags, queue/lease/OIDC, permissions, and a no-traffic latest revision', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: false, allocation: true, category: false },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })
    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({ service, schedulerJobs: [] }), readGoogleState: vi.fn(async () => googleState()),
      now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'ALLOCATION', stageReady: true, ready: true,
      flags: { financeReportsEnabled: false, revenueAllocationEnabled: true, categoryMoneyEnabled: false },
      cloudRun: { latestReadyRevisionPresent: true, latestReadyHasNoTraffic: true },
      scheduler: { enabledJobCount: 0 },
      allocationConfig: { exactExpectedConfig: true },
    })
  })

  it('makes READY fail closed for wrong project, destination, host, method, OIDC audience, or invoker', async () => {
    const [check] = await loadScripts()
    const validService = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })
    const validJob = schedulerJob()
    const mutations = [
      { service: cloudRunService({ flags: { reports: true, allocation: true, category: true }, allocationProject: 'wrong-project', latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision' }), job: validJob },
      { service: cloudRunService({ flags: { reports: true, allocation: true, category: true }, queue: 'wrong-queue', latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision' }), job: validJob },
      { service: cloudRunService({ flags: { reports: true, allocation: true, category: true }, audience: 'https://wrong.example', latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision' }), job: validJob },
      { service: validService, job: schedulerJob({ uri: 'https://wrong.example/internal/mini-app/finance-daily-seed' }) },
      { service: validService, job: schedulerJob({ method: 'GET' }) },
      { service: validService, job: schedulerJob({ oidcAudience: 'https://wrong.example' }) },
      { service: validService, job: schedulerJob({ invoker: 'wrong@example.iam.gserviceaccount.com' }) },
    ]

    for (const mutation of mutations) {
      const stdout = bufferWriter()
      const code = await check.runFinanceRuntimeCheck(checkerArgs('READY'), {
        execute: runtimeExecute({ service: mutation.service, schedulerJobs: [mutation.job] }),
        readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
      })
      expect(code).toBe(1)
      expect(JSON.parse(stdout.text())).toMatchObject({ expectedStage: 'READY', stageReady: false, ready: false })
    }

    const stdout = bufferWriter()
    const code = await check.runFinanceRuntimeCheck(checkerArgs('READY'), {
      execute: runtimeExecute({ service: validService, schedulerJobs: [validJob] }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })
    expect(code).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'READY', stageReady: true,
      scheduler: { exactTarget: true, postMethod: true, oidcAudienceMatches: true, oidcInvokerMatches: true },
    })
  })
})

describe('one-day finance seed', () => {
  it('refreshes only the three source reports sequentially, paces them, and prints allocation-safe aggregates', async () => {
    const [, seed] = await loadScripts()
    const stdout = bufferWriter()
    const sleep = vi.fn(async () => undefined)
    const operator = operatorFixture()

    const code = await seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], {
      createOperator: vi.fn(async () => operator), sleep, io: { stdout }, reportDelayMs: 20_000,
      statusDelayMs: 60_000, maxStatusReads: 3,
    })

    expect(code).toBe(0)
    expect(operator.calls).toEqual([
      `refresh:PAYMENT:${APPROVED_DAY}`,
      `refresh:REFUND:${APPROVED_DAY}`,
      `refresh:PRODUCT_SALES:${APPROVED_DAY}`,
      `seed:${APPROVED_DAY}`,
      `status:${APPROVED_DAY}`,
      `status:${APPROVED_DAY}`,
      `summary:${APPROVED_DAY}`,
    ])
    expect(operator.calls.some((value) => value.includes('PAYMENT_DETAIL'))).toBe(false)
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([20_000, 20_000, 60_000])
    const report = JSON.parse(stdout.text())
    expect(report).toEqual({
      mode: 'FINANCE_DAY_SEED', date: APPROVED_DAY, sequential: true,
      sources: [
        { reportType: 'PAYMENT', count: 2, totalSatang: 300_000, lastSuccessAt: NOW, warningCode: null },
        { reportType: 'REFUND', count: 1, totalSatang: 25_000, lastSuccessAt: NOW, warningCode: null },
        { reportType: 'PRODUCT_SALES', count: 4, totalSatang: 0, lastSuccessAt: NOW, warningCode: null },
      ],
      allocation: { status: 'COMPLETE', paymentCount: 2, coveredPaymentCount: 2, metadataHashPrefix: 'bbbbbbbbbbbb', lastSuccessAt: NOW },
      totals: {
        receivedSatang: 300_000, refundSatang: 25_000,
        channels: { transferSatang: 200_000, cashSatang: 50_000, creditSatang: 25_000, otherSatang: 25_000 },
        categories: { serviceSatang: 225_000, productSatang: 50_000, unclassifiedSatang: 25_000 },
      },
      warnings: [],
    })
    expect(stdout.text()).not.toContain('Patient Private')
    expect(stdout.text()).not.toContain('payment-private-id')
  })

  it('allows only the approved comparison day through the one-day CLI', async () => {
    const [, seed] = await loadScripts()
    const createOperator = vi.fn(async () => operatorFixture())

    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', '2026-08-23',
    ], { createOperator })).rejects.toThrow('The one-day seed is restricted to the approved comparison date')
    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', '2026-02-30',
    ], { createOperator })).rejects.toThrow('A strict Bangkok calendar date is required')
    expect(createOperator).not.toHaveBeenCalled()
  })

  it('redacts configured and operator errors', async () => {
    const [, seed] = await loadScripts()
    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], { createOperator: vi.fn(async () => { throw new Error('token=private spreadsheet=private-spreadsheet') }) }))
      .rejects.toThrow('FINANCE_OPERATOR_FAILED')
  })

  it('rejects a different project before external access and returns nonzero for incomplete coverage', async () => {
    const [, seed] = await loadScripts()
    const createOperator = vi.fn(async () => operatorFixture())
    await expect(seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', 'other-valid-project', '--date', APPROVED_DAY,
    ], { createOperator })).rejects.toThrow('Approved finance project is required')
    expect(createOperator).not.toHaveBeenCalled()

    const stdout = bufferWriter()
    const code = await seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], {
      createOperator: vi.fn(async () => operatorFixture()), sleep: vi.fn(async () => undefined),
      maxStatusReads: 1, io: { stdout },
    })
    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).warnings).toContain('ALLOCATION_INCOMPLETE')
  })

  it.each([
    ['payment hash mismatch', { paymentSetHash: 'c'.repeat(64) }],
    ['metadata hash mismatch', { metadataSnapshotHash: 'c'.repeat(64) }],
    ['count mismatch', { coveredPaymentCount: 1 }],
    ['missing payment timestamp', { paymentLastSuccessAt: null }],
    ['invalid product timestamp', { productSalesLastSuccessAt: 'not-an-instant' }],
    ['missing allocation timestamp', { lastSuccessAt: null }],
    ['stale source identity', { paymentLastSuccessAt: '2026-08-30T01:00:00.000Z' }],
    ['safe allocation error', { safeErrorCode: 'JERA_PROVIDER_FAILED' }],
  ])('treats provider COMPLETE as incomplete for %s', async (_label, patch) => {
    const [, seed] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const readStatus = operator.readAllocationStatus
    operator.readAllocationStatus = vi.fn(async (date: string) => ({ ...await readStatus(date), ...patch }))
    const stdout = bufferWriter()

    const code = await seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined),
      maxStatusReads: 1, io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({
      allocation: { status: 'INCOMPLETE' }, warnings: expect.arrayContaining(['ALLOCATION_INCOMPLETE']),
    })
  })

  it('treats a stale refreshed PAYMENT identity as incomplete even when coverage says COMPLETE', async () => {
    const [, seed] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const refresh = operator.refreshReport
    operator.refreshReport = vi.fn(async (reportType: string, date: string) => ({
      ...await refresh(reportType, date), ...(reportType === 'PAYMENT' ? { stale: true } : {}),
    }))
    const stdout = bufferWriter()

    const code = await seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined),
      maxStatusReads: 1, io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).allocation.status).toBe('INCOMPLETE')
  })

  it('fails closed when a refreshed source omits its stale marker', async () => {
    const [, seed] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const refresh = operator.refreshReport
    operator.refreshReport = vi.fn(async (reportType: string, date: string) => {
      const value = await refresh(reportType, date)
      if (reportType !== 'PAYMENT') return value
      return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'stale'))
    })
    const stdout = bufferWriter()

    const code = await seed.seedFinanceReportDay([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT, '--date', APPROVED_DAY,
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined), maxStatusReads: 1, io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).allocation.status).toBe('INCOMPLETE')
  })

  it('clamps reusable seed pacing to 20 seconds between reports and 60 seconds between status reads', async () => {
    const [, seed] = await loadScripts()
    const sleep = vi.fn(async () => undefined)

    await seed.seedApprovedFinanceDay({
      date: APPROVED_DAY, operator: operatorFixture(), sleep,
      reportDelayMs: 0, statusDelayMs: 1, maxStatusReads: 2,
    })

    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([20_000, 20_000, 60_000])
  })

  it.each([
    ['JERA_AUTH_FAILED', 'FINANCE_AUTH_FAILED'],
    ['JERA_SCHEMA_INVALID', 'FINANCE_SCHEMA_INVALID'],
  ])('maps real %s without exposing provider metadata', async (jeraCode, financeCode) => {
    const [, seed] = await loadScripts()
    const operator = operatorFixture()
    operator.refreshReport = vi.fn(async () => {
      throw Object.assign(new Error('provider token=private'), { code: jeraCode, response: { private: true } })
    })

    let caught: unknown
    try {
      await seed.seedApprovedFinanceDay({ date: APPROVED_DAY, operator, sleep: vi.fn(async () => undefined) })
    } catch (error) { caught = error }
    expect(caught).toMatchObject({ message: financeCode, code: financeCode })
    expect(caught).not.toHaveProperty('cause')
    expect(JSON.stringify(caught)).not.toContain('private')
  })
})

describe('bounded finance backfill', () => {
  it('processes 1-31 exact days oldest-first, sleeps between dates, and atomically stores only the safe resume schema', async () => {
    const [, , backfill] = await loadScripts()
    const stdout = bufferWriter()
    const sleep = vi.fn(async () => undefined)
    const operator = operatorFixture({ completeImmediately: true })
    const resumeStore = resumeStoreFixture()

    const code = await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-03', '--resume-file', '/tmp/operator-resume.json',
    ], {
      createOperator: vi.fn(async () => operator), sleep, resumeStore, io: { stdout },
      reportDelayMs: 20_000, statusDelayMs: 60_000, dateDelayMs: 60_000, maxStatusReads: 2,
    })

    expect(code).toBe(0)
    expect(operator.calls.filter((value) => value.startsWith('refresh:PAYMENT:'))).toEqual([
      'refresh:PAYMENT:2026-08-01', 'refresh:PAYMENT:2026-08-02', 'refresh:PAYMENT:2026-08-03',
    ])
    expect(operator.calls.some((value) => value.includes('PAYMENT_DETAIL'))).toBe(false)
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      20_000, 20_000, 60_000,
      20_000, 20_000, 60_000,
      20_000, 20_000,
    ])
    expect(resumeStore.writeAtomic).toHaveBeenCalledTimes(4)
    for (const [path, state] of resumeStore.writeAtomic.mock.calls) {
      expect(path).toBe('/tmp/operator-resume.json')
      expect(Object.keys(state)).toEqual(['version', 'startDate', 'endDate', 'nextDate', 'completedDates', 'safeFailures'])
      expect(JSON.stringify(state)).not.toContain('Patient Private')
      expect(JSON.stringify(state)).not.toContain('private-id')
    }
    expect(resumeStore.writeAtomic.mock.calls.at(-1)?.[1]).toEqual({
      version: 1, startDate: '2026-08-01', endDate: '2026-08-03', nextDate: null,
      completedDates: ['2026-08-01', '2026-08-02', '2026-08-03'], safeFailures: [],
    })
    expect(JSON.parse(stdout.text())).toEqual({
      mode: 'FINANCE_BACKFILL', startDate: '2026-08-01', endDate: '2026-08-03',
      completedCount: 3, nextDate: null, safeFailureCount: 0,
    })
  })

  it('resumes from nextDate and retains only bounded throttling status', async () => {
    const [, , backfill] = await loadScripts()
    const resumeStore = resumeStoreFixture({
      version: 1, startDate: '2026-08-01', endDate: '2026-08-03', nextDate: '2026-08-02',
      completedDates: ['2026-08-01'], safeFailures: [{ date: '2026-08-02', safeCode: 'FINANCE_RATE_LIMITED', retryAfterSeconds: 120 }],
    })
    const operator = operatorFixture({ completeImmediately: true })

    await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-03', '--resume-file', '/tmp/operator-resume.json',
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined), resumeStore,
      io: { stdout: bufferWriter() },
    })

    expect(operator.calls.find((value) => value.includes('2026-08-01'))).toBeUndefined()
    expect(operator.calls).toContain('refresh:PAYMENT:2026-08-02')
  })

  it('rejects invalid, reversed, over-31-day, and non-absolute resume ranges before external access', async () => {
    const [, , backfill] = await loadScripts()
    const createOperator = vi.fn(async () => operatorFixture())
    const base = ['--allow-readonly-production', '--allow-cache-write', '--project', PROJECT]
    const invalidRanges = [
      [...base, '--start-date', '2026-08-03', '--end-date', '2026-08-01', '--resume-file', '/tmp/resume.json'],
      [...base, '--start-date', '2026-07-30', '--end-date', '2026-08-30', '--resume-file', '/tmp/resume.json'],
      [...base, '--start-date', '2026-02-30', '--end-date', '2026-03-01', '--resume-file', '/tmp/resume.json'],
      [...base, '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', 'relative/resume.json'],
    ]

    for (const args of invalidRanges) await expect(backfill.backfillFinanceReportDays(args, { createOperator })).rejects.toThrow()
    expect(createOperator).not.toHaveBeenCalled()
  })

  it('does not mark incomplete coverage complete and rejects a different project before external access', async () => {
    const [, , backfill] = await loadScripts()
    const createOperator = vi.fn(async () => operatorFixture())
    await expect(backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', 'other-valid-project',
      '--start-date', '2026-08-01', '--end-date', '2026-08-01', '--resume-file', '/tmp/resume.json',
    ], { createOperator, resumeStore: resumeStoreFixture(), io: { stdout: bufferWriter() } }))
      .rejects.toThrow('Approved finance project is required')
    expect(createOperator).not.toHaveBeenCalled()

    const resumeStore = resumeStoreFixture()
    const code = await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-01', '--resume-file', '/tmp/resume.json',
    ], {
      createOperator: vi.fn(async () => operatorFixture()), sleep: vi.fn(async () => undefined),
      maxStatusReads: 1, resumeStore, io: { stdout: bufferWriter() },
    })
    expect(code).toBe(1)
    expect(resumeStore.writeAtomic.mock.calls.at(-1)?.[1]).toMatchObject({
      nextDate: '2026-08-01', completedDates: [],
      safeFailures: [{ date: '2026-08-01', safeCode: 'FINANCE_ALLOCATION_INCOMPLETE', retryAfterSeconds: null }],
    })
  })

  it('creates a new operator-owned resume file atomically with only the safe schema', async () => {
    const [, , backfill] = await loadScripts()
    const directory = await mkdtemp(join(tmpdir(), 'pmc-finance-resume-'))
    const resumeFile = join(directory, 'resume.json')
    try {
      await backfill.backfillFinanceReportDays([
        '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
        '--start-date', '2026-08-01', '--end-date', '2026-08-01', '--resume-file', resumeFile,
      ], {
        createOperator: vi.fn(async () => operatorFixture({ completeImmediately: true })),
        sleep: vi.fn(async () => undefined), io: { stdout: bufferWriter() },
      })
      const saved = JSON.parse(await readFile(resumeFile, 'utf8'))
      expect(Object.keys(saved)).toEqual(['version', 'startDate', 'endDate', 'nextDate', 'completedDates', 'safeFailures'])
      expect(saved).toMatchObject({ nextDate: null, completedDates: ['2026-08-01'], safeFailures: [] })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stores only bounded throttling retry status and stops at the current date', async () => {
    const [, , backfill] = await loadScripts()
    const resumeStore = resumeStoreFixture()
    const operator = operatorFixture()
    operator.refreshReport = vi.fn(async () => {
      const error = Object.assign(new Error('provider token=private'), {
        code: 'JERA_RATE_LIMITED', retryAfterSeconds: 120,
      })
      throw error
    })
    const stdout = bufferWriter()

    const code = await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', '/tmp/resume.json',
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined), resumeStore, io: { stdout },
    })

    expect(code).toBe(1)
    expect(resumeStore.writeAtomic.mock.calls.at(-1)?.[1]).toMatchObject({
      nextDate: '2026-08-01', completedDates: [],
      safeFailures: [{ date: '2026-08-01', safeCode: 'FINANCE_RATE_LIMITED', retryAfterSeconds: 120 }],
    })
    expect(JSON.stringify(resumeStore.writeAtomic.mock.calls)).not.toContain('private')
  })

  it.each([
    ['JERA_AUTH_FAILED', 'FINANCE_AUTH_STOPPED'],
    ['JERA_SCHEMA_INVALID', 'FINANCE_SCHEMA_STOPPED'],
  ])('stops backfill safely for real %s', async (jeraCode, safeCode) => {
    const [, , backfill] = await loadScripts()
    const operator = operatorFixture()
    operator.refreshReport = vi.fn(async () => {
      throw Object.assign(new Error('provider metadata private'), { code: jeraCode, response: { private: true } })
    })
    const resumeStore = resumeStoreFixture()

    const code = await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', '/tmp/resume.json',
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined),
      resumeStore, io: { stdout: bufferWriter() },
    })

    expect(code).toBe(1)
    expect(resumeStore.writeAtomic.mock.calls.at(-1)?.[1]).toMatchObject({
      nextDate: '2026-08-01', completedDates: [],
      safeFailures: [{ date: '2026-08-01', safeCode, retryAfterSeconds: null }],
    })
    expect(JSON.stringify(resumeStore.writeAtomic.mock.calls)).not.toContain('private')
  })

  it('clamps reusable backfill pacing to 20 seconds between reports and 60 seconds between dates', async () => {
    const [, , backfill] = await loadScripts()
    const sleep = vi.fn(async () => undefined)

    await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', '/tmp/resume.json',
    ], {
      createOperator: vi.fn(async () => operatorFixture({ completeImmediately: true })),
      sleep, resumeStore: resumeStoreFixture(), io: { stdout: bufferWriter() },
      reportDelayMs: 0, statusDelayMs: 0, dateDelayMs: 0,
    })

    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([20_000, 20_000, 60_000, 20_000, 20_000])
  })

  it('does not advance the resume cursor for a mismatched COMPLETE coverage identity', async () => {
    const [, , backfill] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const readStatus = operator.readAllocationStatus
    operator.readAllocationStatus = vi.fn(async (date: string) => ({
      ...await readStatus(date), metadataSnapshotHash: 'c'.repeat(64),
    }))
    const resumeStore = resumeStoreFixture()

    const code = await backfill.backfillFinanceReportDays([
      '--allow-readonly-production', '--allow-cache-write', '--project', PROJECT,
      '--start-date', '2026-08-01', '--end-date', '2026-08-02', '--resume-file', '/tmp/resume.json',
    ], {
      createOperator: vi.fn(async () => operator), sleep: vi.fn(async () => undefined),
      resumeStore, io: { stdout: bufferWriter() }, maxStatusReads: 1,
    })

    expect(code).toBe(1)
    expect(resumeStore.writeAtomic.mock.calls.at(-1)?.[1]).toMatchObject({
      nextDate: '2026-08-01', completedDates: [],
    })
  })
})

async function loadScripts() {
  return Promise.all([
    import('../../scripts/check-finance-report-runtime.mjs'),
    import('../../scripts/seed-finance-report-day.mjs'),
    import('../../scripts/backfill-finance-report-days.mjs'),
  ])
}

function checkerArgs(stage: 'DISABLED' | 'ALLOCATION' | 'READY') {
  const args = [
    '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
    '--expected-finance-viewers', '3', `--expected-stage=${stage}`,
  ]
  if (stage !== 'DISABLED') args.push(
    '--expected-queue', QUEUE, '--expected-worker-audience', AUDIENCE, '--expected-invoker', INVOKER,
  )
  if (stage === 'READY') args.push(
    '--expected-finance-seed-url', SEED_URL, '--expected-oidc-audience', AUDIENCE,
  )
  return args
}

function runtimeExecute({ service, schedulerJobs }: { service: unknown; schedulerJobs: unknown[] }) {
  return vi.fn(async (command: string[]) => {
    const joined = command.join(' ')
    if (joined.includes('run services describe')) return JSON.stringify(service)
    if (joined.includes('tasks queues describe')) return JSON.stringify(queueDescription())
    if (joined.includes('tasks queues get-iam-policy')) return JSON.stringify({
      bindings: [{ role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }],
    })
    if (joined.includes('run services get-iam-policy')) return JSON.stringify({
      bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${INVOKER}`] }],
    })
    if (joined.includes('scheduler jobs list')) return JSON.stringify(schedulerJobs)
    if (joined.includes('tasks list')) return JSON.stringify([{ httpRequest: { body: Buffer.from(JSON.stringify({
      branchUuid: '11111111-2222-4333-8444-555555555555', eventDate: APPROVED_DAY,
      paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 2,
    })).toString('base64') } }])
    if (joined.includes('storage buckets describe')) return JSON.stringify({ location: REGION })
    if (joined.includes('storage buckets get-iam-policy')) return JSON.stringify({
      bindings: [{ role: 'roles/storage.objectUser', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }],
    })
    throw new Error('unexpected read-only command')
  })
}

function schedulerJob({
  uri = SEED_URL, method = 'POST', oidcAudience = AUDIENCE, invoker = INVOKER,
} = {}) {
  return {
    state: 'ENABLED', schedule: '15 2 * * *', timeZone: 'Asia/Bangkok',
    httpTarget: { uri, httpMethod: method, oidcToken: { audience: oidcAudience, serviceAccountEmail: invoker } },
  }
}

function cloudRunService({
  flags = { reports: false, allocation: false, category: false },
  allocationProject = PROJECT, queue = QUEUE, audience = AUDIENCE,
  latestReadyRevisionName = 'private-revision', trafficRevisionName = 'private-revision',
} = {}) {
  const env = [
    ['PMC_FINANCE_REPORTS_ENABLED', String(flags.reports)],
    ['JERA_REVENUE_ALLOCATION_ENABLED', String(flags.allocation)],
    ['JERA_FINANCE_CATEGORY_MONEY_ENABLED', String(flags.category)],
    ['JERA_ALLOCATION_PROJECT_ID', allocationProject],
    ['JERA_ALLOCATION_LOCATION', REGION],
    ['JERA_ALLOCATION_QUEUE', queue],
    ['JERA_ALLOCATION_WORKER_URL', 'https://private.example/internal/mini-app/jera-allocation-worker'],
    ['JERA_ALLOCATION_WORKER_AUDIENCE', audience],
    ['JERA_ALLOCATION_TASK_INVOKER_EMAIL', INVOKER],
    ['JERA_ALLOCATION_LEASE_BUCKET', 'private-lease-bucket'],
    ['PMC_SPREADSHEET_ID', 'private-spreadsheet'],
  ].map(([name, value]) => ({ name, value }))
  return {
    spec: { template: { metadata: { name: latestReadyRevisionName }, spec: { serviceAccountName: 'runtime@example.iam.gserviceaccount.com', containers: [{ env }] } } },
    status: { latestReadyRevisionName, traffic: [{ revisionName: trafficRevisionName, percent: 100 }] },
  }
}

function queueDescription() {
  return { state: 'RUNNING', rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.016 } }
}

function googleState() {
  return {
    tabHeaders: {
      JERA_PAYMENT_DETAIL_CACHE: ['detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash', 'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated'],
      JERA_PAYMENT_DETAIL_LINES: ['detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang'],
      JERA_ALLOCATION_COVERAGE: [
        'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
        'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
        'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
        'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
      ],
    },
    staffRows: [
      { id: 'ADMIN_01', name: 'Owner', lineUserId: 'U-secret-owner', canViewFinance: true, active: true },
      { id: 'DOCTOR_01', name: 'Doctor', lineUserId: 'U-secret-doctor', canViewFinance: true, active: true },
      { id: 'ADMIN_09', name: 'Mus', lineUserId: 'U-secret-mus', canViewFinance: true, active: true },
      { id: 'ADMIN_10', name: 'Staff', lineUserId: 'U-secret-staff', canViewFinance: false, active: true },
    ],
    coverageRows: [{ leaseOwner: 'lease-private', leaseExpiresAt: '2026-08-30T02:10:00.000Z', lastAttemptAt: '2026-08-30T01:55:00.000Z' }],
  }
}

function operatorFixture({ completeImmediately = false } = {}) {
  const calls: string[] = []
  let statusReads = 0
  return {
    calls,
    async refreshReport(reportType: string, date: string) {
      calls.push(`refresh:${reportType}:${date}`)
      if (reportType === 'PAYMENT') return {
        reportType, count: 2, totalSatang: 300_000, lastSuccessAt: NOW, warningCode: null,
        stale: false, paymentSetHash: 'a'.repeat(64),
      }
      if (reportType === 'REFUND') return { reportType, count: 1, totalSatang: 25_000, lastSuccessAt: NOW, warningCode: null, stale: false }
      return {
        reportType, count: 4, totalSatang: 0, lastSuccessAt: NOW, warningCode: null,
        stale: false, metadataSnapshotHash: 'b'.repeat(64),
      }
    },
    async seedAllocation(date: string) {
      calls.push(`seed:${date}`)
      return { accepted: true, allocationQueued: true, retryAfterSeconds: 60 }
    },
    async readAllocationStatus(date: string) {
      calls.push(`status:${date}`)
      statusReads += 1
      const complete = completeImmediately || statusReads >= 2
      return {
        status: complete ? 'COMPLETE' : 'INCOMPLETE', paymentCount: 2,
        coveredPaymentCount: complete ? 2 : 1,
        paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64),
        paymentLastSuccessAt: NOW, productSalesLastSuccessAt: NOW,
        lastSuccessAt: complete ? NOW : null, safeErrorCode: null,
      }
    },
    async readSummary(date: string) {
      calls.push(`summary:${date}`)
      return {
        receivedSatang: 300_000, refundSatang: 25_000,
        channels: { transferSatang: 200_000, cashSatang: 50_000, creditSatang: 25_000, otherSatang: 25_000 },
        categories: { serviceSatang: 225_000, productSatang: 50_000, unclassifiedSatang: 25_000 },
        warnings: [], patientName: 'Patient Private', paymentUuid: 'payment-private-id',
      }
    },
  }
}

function resumeStoreFixture(initial: unknown = null) {
  return {
    read: vi.fn(async () => structuredClone(initial)),
    writeAtomic: vi.fn(async () => undefined),
  }
}

function bufferWriter() {
  let value = ''
  return { write(chunk: string) { value += chunk }, text() { return value } }
}
