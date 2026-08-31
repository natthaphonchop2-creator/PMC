import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JERA_OPERATOR_PROJECT } from '../../scripts/jera-operator-secrets.mjs'

const PROJECT = JERA_OPERATOR_PROJECT
const SERVICE = 'pmc-mini-app'
const WORKER_SERVICE = 'pmc-finance-worker'
const REGION = 'asia-southeast1'
const APPROVED_DAY = '2026-08-22'
const NOW = '2026-08-30T02:00:00.000Z'
const QUEUE = 'pmc-revenue-allocation'
const AUDIENCE = 'https://private.example'
const INVOKER = 'invoker@example.iam.gserviceaccount.com'
const OPERATOR_ACCOUNT = 'operator@example.com'
const SEED_URL = `${AUDIENCE}/internal/mini-app/finance-daily-seed`
const APPROVED_FINANCE_STAFF_IDS = ['ADMIN_01', 'DOCTOR_01', 'ADMIN_09'] as const
const APPROVED_FINANCE_STAFF_ARGS = APPROVED_FINANCE_STAFF_IDS.flatMap((id) => ['--approved-finance-staff-id', id])
const DISABLED_FINANCE_CONTROL_ARGS = [
  '--expected-finance-pilot-only', 'false',
  '--expected-finance-ui-preview-enabled', 'false',
  '--expected-finance-pilot-default-date', 'UNSET',
  '--expected-finance-monthly-income-enabled', 'false',
] as const
const PILOT_FINANCE_CONTROL_ARGS = [
  '--expected-finance-pilot-only', 'true',
  '--expected-finance-ui-preview-enabled', 'false',
  '--expected-finance-pilot-default-date', APPROVED_DAY,
  '--expected-finance-monthly-income-enabled', 'false',
] as const
const FULL_FINANCE_CONTROL_ARGS = [
  '--expected-finance-pilot-only', 'false',
  '--expected-finance-ui-preview-enabled', 'false',
  '--expected-finance-pilot-default-date', 'UNSET',
  '--expected-finance-monthly-income-enabled', 'true',
] as const

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
      if (joined.includes('projects get-iam-policy')) return JSON.stringify({
        bindings: [{ role: 'roles/viewer', members: ['user:owner@example.com'] }],
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
      '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, '--expected-stage=DISABLED',
      ...DISABLED_FINANCE_CONTROL_ARGS,
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
      bindings: {
        queueEnqueuerPresent: true, oidcInvokerPresent: false, leaseBucketObjectUserPresent: false,
        queuePolicyExact: true, runPolicyExact: false, leaseBucketPolicyExact: false,
        publicMemberCount: 0, broadRoleCount: 0, unexpectedRoleCount: 0, extraPrincipalCount: 1,
      },
      scheduler: { matchingJobCount: 0, enabledJobCount: 0, oidcBindingPresent: false },
      tasks: { pendingCount: 1, validMetadataHashCount: 1, validAttemptCount: 1, invalidPayloadCount: 0 },
      tabs: { exactHeaderCount: 3, requiredHeaderCount: 3, exactGridCapacityCount: 3, requiredGridCapacityCount: 3 },
      financePermissions: {
        expectedCount: 3, approvedViewerCount: 3, activeViewerCount: 3, exactApprovedSet: true,
        missingApprovedCount: 0, unlinkedApprovedCount: 0, extraViewerCount: 0, invalidStaffRowCount: 0,
      },
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
      '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, '--expected-stage=DISABLED',
      ...DISABLED_FINANCE_CONTROL_ARGS,
    ], { execute, readGoogleState: vi.fn(async () => { throw new Error('sheet private-spreadsheet') }), io: { stdout } })

    expect(code).toBe(1)
    expect(stdout.text()).not.toContain('private')
    expect(stdout.text()).not.toContain('secret')
    expect(JSON.parse(stdout.text())).toMatchObject({ mode: 'READ_ONLY', ready: false, safeCode: 'FINANCE_RUNTIME_INCOMPLETE' })
  })

  it('accepts only the exact DISABLED, ALLOCATION, PILOT, and READY stage values before external access', async () => {
    const [check] = await loadScripts()
    const execute = vi.fn(async () => { throw new Error('must not execute') })
    for (const stage of ['', 'disabled', 'CANARY', 'READY ']) {
      const stageArg = stage ? [`--expected-stage=${stage}`] : []
      await expect(check.runFinanceRuntimeCheck([
        '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
        '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, ...stageArg,
      ], { execute })).rejects.toThrow('Expected stage must be DISABLED, ALLOCATION, PILOT, or READY')
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires all four exact finance rollout expectations together before external access', async () => {
    const [check] = await loadScripts()
    const execute = vi.fn(async () => { throw new Error('must not execute') })
    const controls = [...DISABLED_FINANCE_CONTROL_ARGS]

    for (let omitted = 0; omitted < controls.length; omitted += 2) {
      const args = controls.filter((_value, index) => index !== omitted && index !== omitted + 1)
      await expect(check.runFinanceRuntimeCheck([
        '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
        '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, '--expected-stage=DISABLED',
        ...args,
      ], { execute })).rejects.toThrow('All expected finance rollout controls are required')
    }

    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['pilot-only boolean', ['--expected-finance-pilot-only', 'yes']],
    ['preview boolean', ['--expected-finance-ui-preview-enabled', '0']],
    ['pilot date', ['--expected-finance-pilot-default-date', '2026-02-30']],
    ['pilot date sentinel', ['--expected-finance-pilot-default-date', 'unset']],
    ['monthly boolean', ['--expected-finance-monthly-income-enabled', 'FALSE']],
  ])('rejects malformed expected %s before external access', async (_label, replacement) => {
    const [check] = await loadScripts()
    const execute = vi.fn(async () => { throw new Error('must not execute') })
    const controls = [...DISABLED_FINANCE_CONTROL_ARGS]
    const index = controls.indexOf(replacement[0]!)
    controls[index + 1] = replacement[1]!

    await expect(check.runFinanceRuntimeCheck([
      '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
      '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, '--expected-stage=DISABLED',
      ...controls,
    ], { execute })).rejects.toThrow(/^Expected finance rollout controls must use exact values/)
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
      pilotControls: {
        financeReportsPilotOnly: false,
        financeUiPreviewEnabled: false,
        pilotDefaultDatePresent: false,
        pilotDefaultDateCanonical: false,
        pilotDefaultDateMatches: true,
        financeMonthlyIncomeEnabled: false,
        exactExpectedControls: true,
      },
      cloudRun: { latestReadyRevisionPresent: true, latestReadyHasNoTraffic: true },
      scheduler: { enabledJobCount: 0 },
      allocationConfig: { exactExpectedConfig: true },
    })
  })

  it('makes PILOT ready with exact true flags, pinned controls, zero Scheduler, and a no-traffic latest revision', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      financeControls: { pilotOnly: true, preview: false, pilotDate: APPROVED_DAY, monthly: false },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('PILOT'), {
      execute: runtimeExecute({ service, schedulerJobs: [] }), readGoogleState: vi.fn(async () => googleState()),
      now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'PILOT', stageReady: true, ready: true,
      flags: { financeReportsEnabled: true, revenueAllocationEnabled: true, categoryMoneyEnabled: true },
      pilotControls: {
        financeReportsPilotOnly: true,
        financeUiPreviewEnabled: false,
        pilotDefaultDatePresent: true,
        pilotDefaultDateCanonical: true,
        pilotDefaultDateMatches: true,
        financeMonthlyIncomeEnabled: false,
        exactExpectedControls: true,
      },
      cloudRun: { latestReadyRevisionPresent: true, latestReadyHasNoTraffic: true },
      scheduler: { enabledJobCount: 0 },
    })
    expect(stdout.text()).not.toContain(APPROVED_DAY)
  })

  it('fails PILOT when any finance seed Scheduler is enabled', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      financeControls: { pilotOnly: true, preview: false, pilotDate: APPROVED_DAY, monthly: false },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('PILOT'), {
      execute: runtimeExecute({ service, schedulerJobs: [schedulerJob()] }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'PILOT', stageReady: false,
      scheduler: { enabledFinanceSeedCandidateCount: 1 },
    })
  })

  it('requires an explicit private worker service instead of applying worker IAM rules to the public LIFF service', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: false, allocation: true, category: false },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({ service, schedulerJobs: [] }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(0)
    expect(JSON.parse(stdout.text())).toMatchObject({
      workerCloudRun: { servicePresent: true, ready: true, invokerPolicyExact: true },
    })
  })

  it.each([
    ['wrong approved recipient', (state: ReturnType<typeof googleState>) => {
      state.staffRows[0]!.canViewFinance = false
      state.staffRows[3]!.canViewFinance = true
    }, { missingApprovedCount: 1, extraViewerCount: 1 }],
    ['unlinked approved recipient', (state: ReturnType<typeof googleState>) => {
      state.staffRows[1]!.lineLinked = false
    }, { unlinkedApprovedCount: 1 }],
    ['extra finance viewer', (state: ReturnType<typeof googleState>) => {
      state.staffRows[3]!.canViewFinance = true
    }, { extraViewerCount: 1 }],
  ])('rejects %s against the exact operator-provided staff ID set', async (_case, mutate, expected) => {
    const [check] = await loadScripts()
    const state = googleState()
    mutate(state)
    const stdout = bufferWriter()

    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({ service: cloudRunService({
        flags: { reports: false, allocation: true, category: false },
        latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
      }), schedulerJobs: [] }),
      readGoogleState: vi.fn(async () => state), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).financePermissions).toMatchObject({ exactApprovedSet: false, ...expected })
  })

  it.each([
    ['runtime Editor at project scope', { bindings: [{ role: 'roles/editor', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }] }, { projectBroadRoleCount: 1 }],
    ['invoker Owner at project scope', { bindings: [{ role: 'roles/owner', members: [`serviceAccount:${INVOKER}`] }] }, { projectBroadRoleCount: 1 }],
    ['public project binding', { bindings: [{ role: 'roles/viewer', members: ['allAuthenticatedUsers'] }] }, { projectPublicMemberCount: 1 }],
  ])('rejects %s even when resource-level IAM is exact', async (_case, projectIam, expected) => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()

    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({
        service: cloudRunService({
          flags: { reports: false, allocation: true, category: false },
          latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
        }),
        schedulerJobs: [],
        projectIam,
      }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).bindings).toMatchObject({ projectPolicySafe: false, ...expected })
  })

  it('rejects allocation readiness when a managed allocation tab has less than its bounded grid capacity', async () => {
    const [check] = await loadScripts()
    const state = googleState()
    state.tabGridRows.JERA_PAYMENT_DETAIL_LINES = 1_000
    const stdout = bufferWriter()

    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({
        service: cloudRunService({
          flags: { reports: false, allocation: true, category: false },
          latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
        }),
        schedulerJobs: [],
      }),
      readGoogleState: vi.fn(async () => state), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).tabs).toMatchObject({ exactGridCapacityCount: 2, requiredGridCapacityCount: 3 })
  })

  it.each([
    ['public member', { runIam: { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${INVOKER}`, 'allUsers'] }] } }, { publicMemberCount: 1 }],
    ['broad role', { queueIam: { bindings: [
      { role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] },
      { role: 'roles/owner', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] },
    ] } }, { broadRoleCount: 1 }],
    ['extra principal', { bucketIam: { bindings: [{ role: 'roles/storage.objectUser', members: [
      'serviceAccount:runtime@example.iam.gserviceaccount.com', 'serviceAccount:extra@example.iam.gserviceaccount.com',
    ] }] } }, { extraPrincipalCount: 1 }],
  ])('rejects %s in least-privilege resource policies', async (_case, iam, expected) => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const code = await check.runFinanceRuntimeCheck(checkerArgs('ALLOCATION'), {
      execute: runtimeExecute({
        service: cloudRunService({ flags: { reports: false, allocation: true, category: false }, latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision' }),
        schedulerJobs: [], ...iam,
      }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text()).bindings).toMatchObject(expected)
  })

  it('makes READY fail closed for wrong project, destination, host, method, OIDC audience, or invoker', async () => {
    const [check] = await loadScripts()
    const validService = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      financeControls: { pilotOnly: false, preview: false, pilotDate: undefined, monthly: true },
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
      pilotControls: {
        financeReportsPilotOnly: false,
        financeUiPreviewEnabled: false,
        pilotDefaultDatePresent: false,
        pilotDefaultDateCanonical: false,
        pilotDefaultDateMatches: true,
        financeMonthlyIncomeEnabled: true,
        exactExpectedControls: true,
      },
      scheduler: { exactTarget: true, postMethod: true, oidcAudienceMatches: true, oidcInvokerMatches: true },
    })
    expect(stdout.text()).not.toContain(APPROVED_DAY)
  })

  it.each([
    ['missing pilot-only flag', { pilotOnly: undefined }, { financeReportsPilotOnly: null }],
    ['wider non-pilot rollout', { pilotOnly: false }, { financeReportsPilotOnly: false }],
    ['missing preview flag', { preview: undefined }, { financeUiPreviewEnabled: null }],
    ['enabled preview UI', { preview: true }, { financeUiPreviewEnabled: true }],
    ['missing pilot date', { pilotDate: undefined }, { pilotDefaultDatePresent: false, pilotDefaultDateMatches: false }],
    ['malformed pilot date', { pilotDate: '2026-8-22' }, { pilotDefaultDatePresent: true, pilotDefaultDateCanonical: false, pilotDefaultDateMatches: false }],
    ['missing monthly flag', { monthly: undefined }, { financeMonthlyIncomeEnabled: null }],
    ['enabled monthly report', { monthly: true }, { financeMonthlyIncomeEnabled: true }],
  ])('fails PILOT for %s without exposing the configured date', async (_label, financeControls, expected) => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      financeControls,
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('PILOT'), {
      execute: runtimeExecute({ service, schedulerJobs: [] }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'PILOT', stageReady: false,
      pilotControls: { exactExpectedControls: false, ...expected },
    })
    expect(stdout.text()).not.toContain(APPROVED_DAY)
  })

  it.each([
    ['missing reports flag', { reports: undefined, allocation: false, category: false }],
    ['missing allocation flag', { reports: false, allocation: undefined, category: false }],
    ['missing category flag', { reports: false, allocation: false, category: undefined }],
    ['malformed reports flag', { reports: 'FALSE', allocation: false, category: false }],
    ['malformed allocation flag', { reports: false, allocation: '0', category: false }],
    ['malformed category flag', { reports: false, allocation: false, category: 'yes' }],
  ])('fails DISABLED for %s instead of coercing it to false', async (_label, flags) => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({ flags })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('DISABLED'), {
      execute: runtimeExecute({ service, schedulerJobs: [] }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({ expectedStage: 'DISABLED', stageReady: false, ready: false })
  })

  it('fails READY when a correct Scheduler has a second enabled finance-seed candidate on the wrong host', async () => {
    const [check] = await loadScripts()
    const stdout = bufferWriter()
    const service = cloudRunService({
      flags: { reports: true, allocation: true, category: true },
      financeControls: { pilotOnly: false, preview: false, pilotDate: undefined, monthly: true },
      latestReadyRevisionName: 'private-no-traffic-revision', trafficRevisionName: 'private-live-revision',
    })

    const code = await check.runFinanceRuntimeCheck(checkerArgs('READY'), {
      execute: runtimeExecute({
        service,
        schedulerJobs: [schedulerJob(), schedulerJob({ uri: 'https://wrong.example/internal/mini-app/finance-daily-seed' })],
      }),
      readGoogleState: vi.fn(async () => googleState()), now: () => new Date(NOW), io: { stdout },
    })

    expect(code).toBe(1)
    expect(JSON.parse(stdout.text())).toMatchObject({
      expectedStage: 'READY', stageReady: false,
      scheduler: { enabledJobCount: 2, enabledFinanceSeedCandidateCount: 2 },
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
    ['coverage counts smaller than refreshed PAYMENT', { paymentCount: 1, coveredPaymentCount: 1 }],
    ['missing payment timestamp', { paymentLastSuccessAt: null }],
    ['invalid product timestamp', { productSalesLastSuccessAt: 'not-an-instant' }],
    ['missing allocation timestamp', { lastSuccessAt: null }],
    ['stale source identity', { paymentLastSuccessAt: '2026-08-30T01:00:00.000Z' }],
    ['safe allocation error', { safeErrorCode: 'JERA_PROVIDER_FAILED' }],
    ['missing allocation stale marker', { stale: undefined }],
    ['malformed allocation stale marker', { stale: 'false' }],
    ['stale allocation', { stale: true }],
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

  it.each([null, 'false', 0, {}])('fails closed for malformed refreshed source stale value %j', async (stale) => {
    const [, seed] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const refresh = operator.refreshReport
    operator.refreshReport = vi.fn(async (reportType: string, date: string) => ({
      ...await refresh(reportType, date), ...(reportType === 'PAYMENT' ? { stale } : {}),
    }))
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

  it('does not advance the resume cursor when coverage 1/1 disagrees with refreshed PAYMENT count 2', async () => {
    const [, , backfill] = await loadScripts()
    const operator = operatorFixture({ completeImmediately: true })
    const readStatus = operator.readAllocationStatus
    operator.readAllocationStatus = vi.fn(async (date: string) => ({
      ...await readStatus(date), paymentCount: 1, coveredPaymentCount: 1,
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

function checkerArgs(stage: 'DISABLED' | 'ALLOCATION' | 'PILOT' | 'READY') {
  const financeControls = stage === 'PILOT'
    ? PILOT_FINANCE_CONTROL_ARGS
    : stage === 'READY'
      ? FULL_FINANCE_CONTROL_ARGS
      : DISABLED_FINANCE_CONTROL_ARGS
  const args = [
    '--allow-readonly-production', '--project', PROJECT, '--service', SERVICE, '--region', REGION,
    '--expected-finance-viewers', '3', ...APPROVED_FINANCE_STAFF_ARGS, `--expected-stage=${stage}`,
    ...financeControls,
  ]
  if (stage !== 'DISABLED') args.push(
    '--expected-worker-service', WORKER_SERVICE,
    '--expected-queue', QUEUE, '--expected-worker-audience', AUDIENCE, '--expected-invoker', INVOKER,
  )
  if (stage === 'READY') args.push(
    '--expected-finance-seed-url', SEED_URL, '--expected-oidc-audience', AUDIENCE,
  )
  return args
}

function runtimeExecute({
  service,
  workerService = cloudRunWorkerService(),
  schedulerJobs,
  queueIam = { bindings: [{ role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] }] },
  runIam = { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${INVOKER}`] }] },
  bucketIam = { bindings: [
    { role: 'roles/storage.objectUser', members: ['serviceAccount:runtime@example.iam.gserviceaccount.com'] },
    { role: 'roles/storage.legacyBucketOwner', members: [`user:${OPERATOR_ACCOUNT}`] },
  ] },
  projectIam = { bindings: [{ role: 'roles/viewer', members: ['user:owner@example.com'] }] },
}: {
  service: unknown
  workerService?: unknown
  schedulerJobs: unknown[]
  queueIam?: unknown
  runIam?: unknown
  bucketIam?: unknown
  projectIam?: unknown
}) {
  return vi.fn(async (command: string[]) => {
    const joined = command.join(' ')
    if (joined.includes(`run services describe ${WORKER_SERVICE}`)) return JSON.stringify(workerService)
    if (joined.includes('auth list')) return JSON.stringify([{ account: OPERATOR_ACCOUNT, status: 'ACTIVE' }])
    if (joined.includes('run services describe')) return JSON.stringify(service)
    if (joined.includes('tasks queues describe')) return JSON.stringify(queueDescription())
    if (joined.includes('tasks queues get-iam-policy')) return JSON.stringify(queueIam)
    if (joined.includes(`run services get-iam-policy ${WORKER_SERVICE}`)) return JSON.stringify(runIam)
    if (joined.includes('projects get-iam-policy')) return JSON.stringify(projectIam)
    if (joined.includes('scheduler jobs list')) return JSON.stringify(schedulerJobs)
    if (joined.includes('tasks list')) return JSON.stringify([{ httpRequest: { body: Buffer.from(JSON.stringify({
      branchUuid: '11111111-2222-4333-8444-555555555555', eventDate: APPROVED_DAY,
      paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 2,
    })).toString('base64') } }])
    if (joined.includes('storage buckets describe')) return JSON.stringify({ location: REGION })
    if (joined.includes('storage buckets get-iam-policy')) return JSON.stringify(bucketIam)
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
  financeControls = flags.reports === true
    ? { pilotOnly: false, preview: false, pilotDate: undefined, monthly: true }
    : { pilotOnly: false, preview: false, pilotDate: undefined, monthly: false },
  allocationProject = PROJECT, queue = QUEUE, audience = AUDIENCE,
  latestReadyRevisionName = 'private-revision', trafficRevisionName = 'private-revision',
} = {}) {
  const flagEntries = [
    ['PMC_FINANCE_REPORTS_ENABLED', flags.reports],
    ['JERA_REVENUE_ALLOCATION_ENABLED', flags.allocation],
    ['JERA_FINANCE_CATEGORY_MONEY_ENABLED', flags.category],
  ].flatMap(([name, value]) => value === undefined ? [] : [[name, String(value)]])
  const env = [
    ...flagEntries,
    ...[
      ['PMC_FINANCE_REPORTS_PILOT_ONLY', financeControls.pilotOnly],
      ['PMC_FINANCE_UI_PREVIEW_ENABLED', financeControls.preview],
      ['PMC_FINANCE_PILOT_DEFAULT_DATE', financeControls.pilotDate],
      ['PMC_FINANCE_MONTHLY_INCOME_ENABLED', financeControls.monthly],
    ].flatMap(([name, value]) => value === undefined ? [] : [[name, String(value)]]),
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

function cloudRunWorkerService() {
  return {
    spec: { template: { spec: { serviceAccountName: 'runtime@example.iam.gserviceaccount.com', containers: [{ env: [] }] } } },
    status: {
      latestReadyRevisionName: 'private-worker-revision',
      traffic: [{ revisionName: 'private-worker-revision', percent: 100 }],
      conditions: [{ type: 'Ready', status: 'True' }],
    },
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
        'safeErrorCode', 'leaseOwner', 'leaseExpiresAt', 'taskAttempt', 'productSalesRowCount', 'leaseFencingToken',
      ],
    },
    tabGridRows: {
      JERA_PAYMENT_DETAIL_CACHE: 50_002,
      JERA_PAYMENT_DETAIL_LINES: 200_002,
      JERA_ALLOCATION_COVERAGE: 10_002,
    },
    staffRows: [
      { id: 'ADMIN_01', name: 'Owner', lineLinked: true, canViewFinance: true, active: true },
      { id: 'DOCTOR_01', name: 'Doctor', lineLinked: true, canViewFinance: true, active: true },
      { id: 'ADMIN_09', name: 'Mus', lineLinked: true, canViewFinance: true, active: true },
      { id: 'ADMIN_10', name: 'Staff', lineLinked: true, canViewFinance: false, active: true },
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
        lastSuccessAt: complete ? NOW : null, safeErrorCode: null, stale: false,
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
