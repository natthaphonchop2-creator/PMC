import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const temporaryDirectories: string[] = []
const NOW = '2026-08-30T05:10:00.000Z'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('read-only expense runtime checker', () => {
  it('verifies health, safe config, disabled flags, permission denial, one-month reads, lifecycle, recovery, and topology', async () => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const report = checker.inspectPmcExpenseRuntime(validSnapshot(), inspectorOptions())

    expect(report).toEqual({
      mode: 'READ_ONLY',
      ready: true,
      provenance: {
        schemaVersion: 1, profile: 'DISABLED_PREFLIGHT', targetMatches: true,
        environmentMatches: true, ageSeconds: 600, maxAgeSeconds: 900,
        sourceCheckCount: 7, requiredSourceCheckCount: 7, ready: true,
      },
      health: { status: 200, ok: true },
      clientConfig: { requiredBooleanCount: 5, booleanCount: 5, forbiddenKeyCount: 0, profileMatch: true, safe: true },
      flags: { captureEnabled: false, financeReadsEnabled: true, explicit: true, profileMatch: true, coherent: true },
      bindings: { requiredCount: 7, presentCount: 7, coherent: true },
      submitOnly: { historyDenied: true, evidenceDenied: true },
      financeRead: { requestCount: 1, oneSelectedMonthOnly: true },
      staging: { deleteAfterDays: 1, lifecycleReady: true },
      recovery: { exactTarget: true, audienceConfigured: true, identityConfigured: true, ready: true },
      topology: { exactMasterHeaderCount: 3, exactMonthHeaderCount: 3, staffHeaderExact: true, ready: true },
    })
  })

  it('fails closed for enabled/incoherent flags, broadened reads, wrong lifecycle, route access, recovery, or headers', async () => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = validSnapshot()
    snapshot.flags.PMC_EXPENSE_CAPTURE_ENABLED = 'true'
    snapshot.bindingNames = snapshot.bindingNames.filter((name) => name !== 'PMC_FINANCE_FOLDER_ID')
    snapshot.submitOnly.history = { status: 200, error: null }
    snapshot.financeRead.requestedMonths = ['2026-08', '2026-07']
    snapshot.staging.deleteAfterDays = 7
    snapshot.recovery.targetPath = '/internal/mini-app/recover-expenses?force=true'
    snapshot.recovery.audienceConfigured = false
    snapshot.topology.master.EXPENSE_AUDIT = ['wrong']

    const report = checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions())

    expect(report.ready).toBe(false)
    expect(report.flags).toMatchObject({ captureEnabled: true, coherent: false })
    expect(report.bindings).toMatchObject({ presentCount: 6, coherent: false })
    expect(report.submitOnly.historyDenied).toBe(false)
    expect(report.financeRead.oneSelectedMonthOnly).toBe(false)
    expect(report.staging.lifecycleReady).toBe(false)
    expect(report.recovery.ready).toBe(false)
    expect(report.topology.ready).toBe(false)
  })

  it('keeps strict preflight false once expense capture is already enabled', async () => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = validSnapshot()
    snapshot.flags.PMC_EXPENSE_CAPTURE_ENABLED = 'true'

    const report = checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions())

    expect(report.ready).toBe(false)
    expect(report.flags).toMatchObject({ captureEnabled: true, coherent: false })
  })

  it.each([
    ['capture surface enabled', 'expenseCaptureEnabled', true],
    ['finance reads hidden', 'financeReadsEnabled', false],
    ['submit permission granted early', 'canSubmitExpense', true],
    ['manager cannot view finance', 'canViewFinance', false],
    ['manager cannot manage expense', 'canManageExpense', false],
  ] as const)('rejects client-config mismatch: %s', async (_label, key, value) => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = validSnapshot()
    snapshot.clientConfig[key] = value

    const report = checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions())

    expect(report.ready).toBe(false)
    expect(report.clientConfig).toMatchObject({ profileMatch: false, safe: false })
  })

  it.each([
    ['capture false / reads true', 'false', 'true', true],
    ['capture false / reads false', 'false', 'false', false],
    ['capture true / reads false', 'true', 'false', false],
    ['capture true / reads true', 'true', 'true', false],
  ])('applies the disabled-preflight profile for %s', async (_label, capture, reads, expected) => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = validSnapshot()
    snapshot.flags.PMC_EXPENSE_CAPTURE_ENABLED = capture
    snapshot.flags.PMC_FINANCE_READS_ENABLED = reads

    const report = checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions())

    expect(report.flags.profileMatch).toBe(expected)
    expect(report.ready).toBe(expected)
  })

  it.each([
    ['missing attestation', (snapshot: ReturnType<typeof validSnapshot>) => { delete (snapshot as Partial<typeof snapshot>).provenance }],
    ['stale collection', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.collectedAt = '2026-08-30T04:54:59.000Z' }],
    ['target mismatch', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.target = 'different-service' }],
    ['environment mismatch', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.environment = 'staging' }],
    ['missing source check', (snapshot: ReturnType<typeof validSnapshot>) => { delete (snapshot.provenance.sourceChecks as Partial<typeof snapshot.provenance.sourceChecks>).topology }],
  ])('rejects %s provenance', async (_label, mutate) => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = validSnapshot()
    mutate(snapshot)

    const report = checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions())

    expect(report.ready).toBe(false)
    expect(report.provenance.ready).toBe(false)
  })

  it('never prints secrets, tokens, URLs, or private resource IDs from an unsafe snapshot', async () => {
    const checker = await import('../../scripts/check-pmc-expense-runtime.mjs')
    const snapshot = {
      ...validSnapshot(),
      clientConfig: {
        ...validSnapshot().clientConfig,
        financeFolderId: 'private-folder-id-sentinel',
      },
      privateProbeMetadata: {
        token: 'private-line-token-sentinel',
        secret: 'private-expense-secret-sentinel',
        ingressUrl: 'https://private.example/sensitive-deployment-id',
      },
    }

    const serialized = JSON.stringify(checker.inspectPmcExpenseRuntime(snapshot, inspectorOptions()))

    expect(serialized).not.toContain('private-folder-id-sentinel')
    expect(serialized).not.toContain('private-line-token-sentinel')
    expect(serialized).not.toContain('private-expense-secret-sentinel')
    expect(serialized).not.toContain('sensitive-deployment-id')
    expect(JSON.parse(serialized).clientConfig).toMatchObject({ forbiddenKeyCount: 1, safe: false })
  })

  it('accepts only an explicit local snapshot file and prints sanitized JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmc-expense-runtime-check-'))
    temporaryDirectories.push(directory)
    const snapshotPath = join(directory, 'snapshot.json')
    await writeFile(snapshotPath, JSON.stringify({
      ...validSnapshot(),
      provenance: { ...validSnapshot().provenance, collectedAt: new Date().toISOString() },
      privateProbeMetadata: { secret: 'must-not-print-secret-sentinel' },
    }))

    const result = await execute(process.execPath, [
      resolve('scripts/check-pmc-expense-runtime.mjs'), '--snapshot-file', snapshotPath,
      '--expected-target', 'pmc-mini-app', '--expected-environment', 'production', '--strict',
    ])
    const report = JSON.parse(result.stdout)

    expect(report).toMatchObject({ mode: 'READ_ONLY', ready: true })
    expect(result.stdout).not.toContain('must-not-print-secret-sentinel')
    expect(result.stderr).toBe('')
  })
})

function validSnapshot() {
  return {
    provenance: {
      schemaVersion: 1,
      profile: 'DISABLED_PREFLIGHT',
      target: 'pmc-mini-app',
      environment: 'production',
      collectedAt: '2026-08-30T05:00:00.000Z',
      sourceChecks: {
        health: true,
        clientConfig: true,
        permissions: true,
        financeRead: true,
        staging: true,
        recovery: true,
        topology: true,
      },
    },
    healthStatus: 200,
    clientConfig: {
      expenseCaptureEnabled: false,
      financeReadsEnabled: true,
      canSubmitExpense: false,
      canViewFinance: true,
      canManageExpense: true,
    },
    flags: {
      PMC_EXPENSE_CAPTURE_ENABLED: 'false',
      PMC_FINANCE_READS_ENABLED: 'true',
    },
    bindingNames: [
      'PMC_FINANCE_MASTER_SPREADSHEET_ID',
      'PMC_FINANCE_FOLDER_ID',
      'PMC_FINANCE_STAGING_BUCKET',
      'PMC_EXPENSE_INGRESS_URL',
      'PMC_EXPENSE_INGRESS_SECRET',
      'PMC_EXPENSE_RECOVERY_AUDIENCE',
      'PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL',
    ],
    submitOnly: {
      history: { status: 403, error: 'EXPENSE_FINANCE_PERMISSION_REQUIRED' },
      evidence: { status: 403, error: 'EXPENSE_FINANCE_PERMISSION_REQUIRED' },
    },
    financeRead: { selectedMonth: '2026-08', requestedMonths: ['2026-08'] },
    staging: { deleteAfterDays: 1 },
    recovery: {
      targetPath: '/internal/mini-app/recover-expenses',
      audienceConfigured: true,
      identityConfigured: true,
    },
    topology: {
      master: {
        EXPENSE_MONTHLY_INDEX: ['monthKey', 'ledgerSpreadsheetId', 'monthFolderId', 'createdAt', 'updatedAt'],
        EXPENSE_REQUESTS: ['commandIdempotencyKey', 'rootRequestId', 'commandType', 'commandFingerprint', 'expenseId', 'monthKey', 'recordState', 'resultJson', 'createdAt', 'updatedAt'],
        EXPENSE_AUDIT: ['eventId', 'expenseId', 'actorStaffId', 'action', 'beforeJson', 'afterJson', 'createdAt', 'correlationId'],
      },
      month: {
        EXPENSE_SUBMISSIONS: ['expenseId', 'expenseDate', 'monthKey', 'category', 'scope', 'amountSatang', 'counterpartyName', 'description', 'paymentMethod', 'recordState', 'bookDailyKey', 'revision', 'supersedesExpenseId', 'submittedByStaffId', 'submittedByName', 'submittedAt', 'committedAt', 'updatedAt', 'version', 'idempotencyKey'],
        EXPENSE_ATTACHMENTS: ['attachmentId', 'expenseId', 'rootRequestId', 'ordinal', 'mediaType', 'originalFileName', 'privateFileId', 'deterministicName', 'sizeBytes', 'driveVersion', 'slotClaimId', 'sha256', 'uploadedByStaffId', 'uploadedAt'],
        MONTHLY_SUMMARY: ['monthKey', 'scope', 'category', 'committedSatang', 'effectiveCount', 'calculatedAt', 'sourceHash'],
      },
      staff: ['id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active', 'profileImageUrl', 'canManageStock', 'canSubmitExpense', 'canViewFinance', 'canManageExpense'],
    },
  }
}

function inspectorOptions() {
  return {
    now: () => new Date(NOW),
    expectedTarget: 'pmc-mini-app',
    expectedEnvironment: 'production',
    maxAgeSeconds: 900,
  }
}
