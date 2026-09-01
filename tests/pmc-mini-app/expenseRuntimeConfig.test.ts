import { describe, expect, it, vi } from 'vitest'
import { readPmcMiniAppConfig } from '../../server/pmc-mini-app/config'
import { readPmcFinanceConfig } from '../../server/pmc-mini-app/finance/config'
import {
  createPmcFinanceRuntime,
  createPmcMiniAppRuntime,
} from '../../server/pmc-mini-app/runtime'

describe('private finance runtime configuration', () => {
  it('keeps browser finance disabled when flags are absent, invalid, or one private binding is missing', () => {
    expect(readPmcFinanceConfig({})).toBeNull()
    expect(readPmcFinanceConfig({
      PMC_EXPENSE_CAPTURE_ENABLED: 'false',
      PMC_FINANCE_READS_ENABLED: 'false',
    })).toBeNull()
    expect(readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      PMC_EXPENSE_CAPTURE_ENABLED: 'yes',
    })).toBeNull()
    expect(readPmcFinanceConfig({ PMC_EXPENSE_CAPTURE_ENABLED: 'true' })).toBeNull()

    const missingSecret = validFinanceEnvironment()
    delete missingSecret.PMC_EXPENSE_INGRESS_SECRET
    expect(readPmcFinanceConfig(missingSecret)).toBeNull()
  })

  it('retains a recovery-only private runtime when both browser flags are explicitly false', () => {
    expect(readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      PMC_EXPENSE_CAPTURE_ENABLED: 'false',
      PMC_FINANCE_READS_ENABLED: 'false',
    })).toEqual({
      captureEnabled: false,
      readsEnabled: false,
      masterSpreadsheetId: 'finance-master',
      folderId: 'finance-root',
      stagingBucketName: 'pmc-expense-staging',
      expenseIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
      expenseIngressSecret: 'expense-ingress-secret',
      recoveryAudience: 'https://pmc-mini-app.example',
      recoveryInvokerEmail: 'pmc-expense-recovery@example.iam.gserviceaccount.com',
      async: null,
    })
  })

  it('keeps dedicated recovery OIDC configured while both finance flags and async booking are false', () => {
    const environment = {
      ...validMiniAppEnvironment(),
      ...validFinanceEnvironment(),
      PMC_EXPENSE_CAPTURE_ENABLED: 'false',
      PMC_FINANCE_READS_ENABLED: 'false',
      PMC_MINI_APP_ASYNC_ENABLED: 'false',
    }
    const config = readPmcMiniAppConfig(environment)

    expect(config?.asyncBooking).toBeNull()
    expect(config?.finance).toMatchObject({
      captureEnabled: false,
      readsEnabled: false,
      recoveryAudience: 'https://pmc-mini-app.example',
      recoveryInvokerEmail: 'pmc-expense-recovery@example.iam.gserviceaccount.com',
      async: null,
    })
  })

  it('carries a valid async sub-config and disables capture instead of silently falling back when requested async config is incomplete', () => {
    const valid = readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      ...validExpenseAsyncEnvironment(),
    })
    expect(valid).toMatchObject({
      captureEnabled: true,
      async: {
        queueName: 'pmc-expense-finalize',
        jobBucketName: 'pmc-expense-async-jobs',
        pilotStaffIds: new Set(['ADMIN_03']),
      },
    })

    const invalid = readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      PMC_EXPENSE_ASYNC_ENABLED: 'true',
    })
    expect(invalid).toMatchObject({ captureEnabled: false, async: null })
  })

  it('reads exactly the allowlisted private bindings and accepts the existing Apps Script URL with a distinct secret', () => {
    expect(readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      PMC_FINANCE_UNUSED_RESOURCE: 'must-not-be-read',
    })).toEqual({
      captureEnabled: true,
      readsEnabled: false,
      masterSpreadsheetId: 'finance-master',
      folderId: 'finance-root',
      stagingBucketName: 'pmc-expense-staging',
      expenseIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
      expenseIngressSecret: 'expense-ingress-secret',
      recoveryAudience: 'https://pmc-mini-app.example',
      recoveryInvokerEmail: 'pmc-expense-recovery@example.iam.gserviceaccount.com',
      async: null,
    })
  })

  it.each([
    ['booking secret reuse', { PMC_EXPENSE_INGRESS_SECRET: 'booking-ingress-secret' }],
    ['unsafe master ID', { PMC_FINANCE_MASTER_SPREADSHEET_ID: 'finance/master' }],
    ['unsafe folder ID', { PMC_FINANCE_FOLDER_ID: 'finance folder' }],
    ['unsafe staging bucket', { PMC_FINANCE_STAGING_BUCKET: 'PMC EXPENSES' }],
    ['non-HTTPS ingress', { PMC_EXPENSE_INGRESS_URL: 'http://example.test/private' }],
    ['credentialed ingress', { PMC_EXPENSE_INGRESS_URL: 'https://user:pass@example.test/private' }],
    ['recovery audience path', { PMC_EXPENSE_RECOVERY_AUDIENCE: 'https://pmc-mini-app.example/internal/mini-app/recover-expenses' }],
    ['ordinary recovery identity', { PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL: 'ordinary-user@example.test' }],
  ])('fails closed for %s', (_name, patch) => {
    expect(readPmcFinanceConfig({ ...validFinanceEnvironment(), ...patch })).toBeNull()
  })

  it('does not break Booking, Form, or Stock construction when enabled finance bindings are incomplete', () => {
    const environment = {
      ...validMiniAppEnvironment(),
      PMC_STOCK_ENABLED: 'true',
      PMC_EXPENSE_CAPTURE_ENABLED: 'true',
    }
    const config = readPmcMiniAppConfig(environment)
    expect(config).toMatchObject({ enabled: true, stockEnabled: true, finance: null })

    const middleware = vi.fn()
    const construct = vi.fn(() => middleware)
    expect(createPmcMiniAppRuntime(environment, construct)).toBe(middleware)
    expect(construct).toHaveBeenCalledWith(
      expect.objectContaining({ stockEnabled: true, finance: null }),
      environment,
    )
  })

  it('carries a validated finance sub-config without reusing the browser signing secret', () => {
    const environment = { ...validMiniAppEnvironment(), ...validFinanceEnvironment() }
    const config = readPmcMiniAppConfig(environment)

    expect(config?.finance).toEqual(expect.objectContaining({
      captureEnabled: true,
      readsEnabled: false,
      expenseIngressSecret: 'expense-ingress-secret',
    }))
    expect(config?.finance?.expenseIngressSecret).not.toBe(config?.bookingIngressSecret)
    expect(config?.finance?.expenseIngressSecret).not.toBe(config?.signingSecret)
  })

  it.each([
    ['recovery only', false, false, false, false],
    ['reads only', false, true, true, false],
    ['capture only', true, false, false, true],
    ['reads and capture', true, true, true, true],
  ] as const)('constructs separate %s capabilities', (
    _name,
    captureEnabled,
    readsEnabled,
    expectReads,
    expectCapture,
  ) => {
    const environment = {
      ...validFinanceEnvironment(),
      PMC_EXPENSE_CAPTURE_ENABLED: String(captureEnabled),
      PMC_FINANCE_READS_ENABLED: String(readsEnabled),
    }
    const financeConfig = readPmcFinanceConfig(environment)
    const finance = {
      readMaster: vi.fn(), readMonth: vi.fn(), ensureExpenseFolder: vi.fn(),
      uploadExpenseImage: vi.fn(), verifyExpenseFile: vi.fn(), listVerifiedExpenseImages: vi.fn(),
      deleteExpenseFileIfUnregistered: vi.fn(),
      downloadExpenseFile: vi.fn(),
    }
    const staging = {
      put: vi.fn(), get: vi.fn(), deleteVerified: vi.fn(), claimDriveSlot: vi.fn(),
      registerDriveSlotFile: vi.fn(), readDriveSlotClaim: vi.fn(),
      readSubmissionLease: vi.fn(),
      acquireSubmissionLease: vi.fn(), renewSubmissionLease: vi.fn(),
      assertSubmissionLease: vi.fn(), commitSubmissionLease: vi.fn(),
    }
    const ingress = {
      prepare: vi.fn(), commit: vi.fn(), void: vi.fn(), resume: vi.fn(), uploadEvidence: vi.fn(),
    }
    const recovery = { recover: vi.fn() }
    const recoveryIdentity = { verify: vi.fn() }
    const submission = { submit: vi.fn() }
    const factories = {
      createGoogle: vi.fn(() => finance),
      createStaging: vi.fn(() => staging),
      createIngress: vi.fn(() => ingress),
      createRecovery: vi.fn(() => recovery),
      createRecoveryIdentity: vi.fn(() => recoveryIdentity),
      createSubmission: vi.fn(() => submission),
      createAsyncJobs: vi.fn(),
      createAsyncQueue: vi.fn(),
      createAsyncIdentity: vi.fn(),
      createAsyncTelemetry: vi.fn(),
      createAsyncWorker: vi.fn(),
    }

    const runtime = createPmcFinanceRuntime(financeConfig!, factories)
    expect(Boolean(runtime.reads)).toBe(expectReads)
    expect(Boolean(runtime.capture)).toBe(expectCapture)
    expect(runtime.recovery).toBe(recovery)
    expect(runtime.resume).toBe(ingress)
    expect(runtime.staging).toBe(staging)
    expect(runtime.recoveryIdentity).toBe(recoveryIdentity)
    if (runtime.reads) {
      expect(Object.keys(runtime.reads.finance).sort()).toEqual([
        'downloadExpenseFile', 'readMaster', 'readMonth',
      ])
    }
    if (runtime.capture) {
      expect(Object.keys(runtime.capture.finance).sort()).toEqual([
        'deleteExpenseFileIfUnregistered', 'ensureExpenseFolder', 'listVerifiedExpenseImages',
        'uploadExpenseImage', 'verifyExpenseFile',
      ])
      expect(runtime.capture).toMatchObject({ staging, ingress, submission })
    }
    expect(factories.createGoogle).toHaveBeenCalledTimes(expectReads || expectCapture ? 1 : 0)
    if (expectReads || expectCapture) {
      expect(factories.createGoogle).toHaveBeenCalledWith({
        masterSpreadsheetId: 'finance-master', folderId: 'finance-root',
      })
    }
    expect(factories.createStaging).toHaveBeenCalledTimes(1)
    expect(factories.createIngress).toHaveBeenCalledTimes(1)
    expect(factories.createRecovery).toHaveBeenCalledWith({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'expense-ingress-secret',
    })
    expect(factories.createRecoveryIdentity).toHaveBeenCalledWith({
      audience: 'https://pmc-mini-app.example',
      allowedEmail: 'pmc-expense-recovery@example.iam.gserviceaccount.com',
    })
    expect(factories.createSubmission).toHaveBeenCalledTimes(expectCapture ? 1 : 0)
    expect(factories.createAsyncJobs).not.toHaveBeenCalled()
  })

  it('constructs the isolated expense job store, queue, OIDC verifier, telemetry, and worker only for valid async config', () => {
    const financeConfig = readPmcFinanceConfig({
      ...validFinanceEnvironment(),
      ...validExpenseAsyncEnvironment(),
    })!
    const finance = {
      readMaster: vi.fn(), readMonth: vi.fn(), ensureExpenseFolder: vi.fn(),
      uploadExpenseImage: vi.fn(), verifyExpenseFile: vi.fn(), listVerifiedExpenseImages: vi.fn(),
      deleteExpenseFileIfUnregistered: vi.fn(), downloadExpenseFile: vi.fn(),
    }
    const staging = {
      put: vi.fn(), get: vi.fn(), deleteVerified: vi.fn(), claimDriveSlot: vi.fn(),
      registerDriveSlotFile: vi.fn(), readDriveSlotClaim: vi.fn(), readSubmissionLease: vi.fn(),
      acquireSubmissionLease: vi.fn(), renewSubmissionLease: vi.fn(),
      assertSubmissionLease: vi.fn(), commitSubmissionLease: vi.fn(),
    }
    const ingress = { prepare: vi.fn(), commit: vi.fn(), void: vi.fn(), resume: vi.fn(), uploadEvidence: vi.fn() }
    const recovery = { recover: vi.fn() }
    const recoveryIdentity = { verify: vi.fn() }
    const submission = { submit: vi.fn() }
    const jobs = { read: vi.fn() }
    const queue = { enqueue: vi.fn() }
    const identity = { verify: vi.fn() }
    const telemetry = vi.fn()
    const worker = { finalize: vi.fn() }
    const factories = {
      createGoogle: vi.fn(() => finance),
      createStaging: vi.fn(() => staging),
      createIngress: vi.fn(() => ingress),
      createRecovery: vi.fn(() => recovery),
      createRecoveryIdentity: vi.fn(() => recoveryIdentity),
      createSubmission: vi.fn(() => submission),
      createAsyncJobs: vi.fn(() => jobs),
      createAsyncQueue: vi.fn(() => queue),
      createAsyncIdentity: vi.fn(() => identity),
      createAsyncTelemetry: vi.fn(() => telemetry),
      createAsyncWorker: vi.fn(() => worker),
    }

    const runtime = createPmcFinanceRuntime(financeConfig, factories as never)

    expect(runtime.async).toMatchObject({
      config: financeConfig.async, jobs, queue, identity, telemetry, worker,
    })
    expect(factories.createAsyncJobs).toHaveBeenCalledWith({ bucketName: 'pmc-expense-async-jobs' })
    expect(factories.createAsyncQueue).toHaveBeenCalledWith(expect.objectContaining({
      queueName: 'pmc-expense-finalize',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/finalize-expense',
    }))
    expect(factories.createAsyncIdentity).toHaveBeenCalledWith({
      audience: 'https://pmc-mini-app.example',
      allowedEmail: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
    })
    expect(factories.createAsyncWorker).toHaveBeenCalledWith(expect.objectContaining({
      jobs, submission, telemetry, now: expect.any(Function),
    }))
  })
})

function validFinanceEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_EXPENSE_CAPTURE_ENABLED: 'true',
    PMC_FINANCE_READS_ENABLED: 'false',
    PMC_FINANCE_MASTER_SPREADSHEET_ID: 'finance-master',
    PMC_FINANCE_FOLDER_ID: 'finance-root',
    PMC_FINANCE_STAGING_BUCKET: 'pmc-expense-staging',
    PMC_EXPENSE_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_EXPENSE_INGRESS_SECRET: 'expense-ingress-secret',
    PMC_EXPENSE_RECOVERY_AUDIENCE: 'https://pmc-mini-app.example',
    PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL: 'pmc-expense-recovery@example.iam.gserviceaccount.com',
    PMC_BOOKING_INGRESS_SECRET: 'booking-ingress-secret',
    PMC_MINI_APP_SIGNING_SECRET: 'browser-signing-secret',
  }
}

function validMiniAppEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_MINI_APP_ENABLED: 'true',
    PMC_MINI_APP_ID: '2001234567-mini-app',
    PMC_MINI_APP_LIFF_CHANNEL_ID: '2001234567',
    PMC_SPREADSHEET_ID: 'spreadsheet-id',
    PMC_DRIVE_INTAKE_FOLDER_ID: 'intake-folder-id',
    PMC_BOOKING_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_BOOKING_FALLBACK_FORM_URL: 'https://docs.google.com/forms/d/e/form-id/viewform',
    PMC_BOOKING_INGRESS_SECRET: 'booking-ingress-secret',
    PMC_MINI_APP_SIGNING_SECRET: 'browser-signing-secret',
  }
}

function validExpenseAsyncEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_EXPENSE_ASYNC_ENABLED: 'true',
    PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
    PMC_ASYNC_LOCATION: 'asia-southeast1',
    PMC_ASYNC_BUCKET: 'pmc-booking-staging',
    PMC_ASYNC_QUEUE: 'pmc-booking-finalize',
    PMC_EXPENSE_ASYNC_JOB_BUCKET: 'pmc-expense-async-jobs',
    PMC_EXPENSE_ASYNC_QUEUE: 'pmc-expense-finalize',
    PMC_EXPENSE_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-expense',
    PMC_EXPENSE_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
    PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
    PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS: 'ADMIN_03',
  }
}
