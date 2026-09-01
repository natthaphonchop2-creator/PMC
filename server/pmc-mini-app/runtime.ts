import { createBookingIngressClient } from './bookingIngressClient.js'
import { createEvidenceIngressClient } from './evidenceIngressClient.js'
import { readPmcMiniAppConfig, type PmcMiniAppServerConfig } from './config.js'
import { createMiniAppGooglePorts } from './googleClient.js'
import { createLineIdentityClient } from './lineIdentity.js'
import { createPmcMiniAppMiddleware } from './middleware.js'
import { createGoogleMiniAppStore } from './store.js'
import { createJeraRuntime } from '../jera/runtime.js'
import { createEnrollmentService } from './enrollment.js'
import { createGoogleEvidenceStagingPort } from './stagingStore.js'
import { createGoogleBookingTaskQueue } from './taskQueue.js'
import { createWorkerIdentityVerifier, type WorkerIdentityVerifier } from './workerAuth.js'
import { createAsyncBookingWorker } from './asyncWorker.js'
import { createAsyncStateIngressClient } from './asyncStateIngressClient.js'
import { createAsyncBookingTelemetry } from './asyncTelemetry.js'
import { createBookingPerformanceTelemetry } from './bookingPerformanceTelemetry.js'
import { createDraftStateIngressClient } from './draftStateIngressClient.js'
import { createStockIngressClient } from './stock/ingressClient.js'
import { createStockReadStore } from './stock/readStore.js'
import type { PmcFinanceConfig } from './finance/config.js'
import {
  createFinanceGooglePorts,
  financeGoogleCaptureCapability,
  financeGoogleReadCapability,
  type FinanceGoogleCapturePorts,
  type FinanceGooglePorts,
  type FinanceGoogleReadPorts,
} from './finance/googleClient.js'
import {
  createExpenseIngressClient,
  type ExpenseIngressClient,
} from './finance/ingressClient.js'
import {
  createGoogleExpenseStagingPort,
  type ExpenseStagingPort,
} from './finance/stagingStore.js'
import {
  createExpenseSubmissionService,
  type ExpenseSubmissionService,
} from './finance/submissionService.js'
import { createFinanceReadStore } from './finance/readStore.js'
import {
  createExpenseRecoveryIngressClient,
  createExpenseRecoveryWorker,
  type ExpenseRecoveryWorker,
} from './finance/recovery.js'
import {
  createGoogleExpenseAsyncJobStore,
  type ExpenseAsyncJobStore,
} from './finance/asyncJobStore.js'
import {
  createGoogleExpenseTaskQueue,
  type ExpenseTaskQueue,
} from './finance/taskQueue.js'
import {
  createExpenseAsyncWorker,
  type ExpenseAsyncWorker,
} from './finance/asyncWorker.js'
import {
  createExpenseAsyncTelemetry,
  type ExpenseAsyncTelemetry,
} from './finance/asyncTelemetry.js'

export interface PmcFinanceRuntime {
  config: PmcFinanceConfig
  resume: ExpenseIngressClient
  staging: ExpenseStagingPort
  recovery: ExpenseRecoveryWorker
  recoveryIdentity: WorkerIdentityVerifier
  reads?: {
    finance: FinanceGoogleReadPorts
  }
  capture?: {
    finance: FinanceGoogleCapturePorts
    staging: ExpenseStagingPort
    ingress: ExpenseIngressClient
    submission: ExpenseSubmissionService
  }
  async?: {
    config: NonNullable<PmcFinanceConfig['async']>
    jobs: ExpenseAsyncJobStore
    queue: ExpenseTaskQueue
    worker: ExpenseAsyncWorker
    identity: WorkerIdentityVerifier
    telemetry: ExpenseAsyncTelemetry
  }
}

export interface PmcFinanceRuntimeFactories {
  createGoogle(input: { masterSpreadsheetId: string; folderId: string }): FinanceGooglePorts
  createStaging(input: { bucketName: string }): ExpenseStagingPort
  createIngress(input: { url: string; secret: string }): ExpenseIngressClient
  createRecovery(input: { url: string; secret: string }): ExpenseRecoveryWorker
  createRecoveryIdentity(input: { audience: string; allowedEmail: string }): WorkerIdentityVerifier
  createSubmission(input: {
    ingress: ExpenseIngressClient
    finance: FinanceGoogleCapturePorts
    staging: ExpenseStagingPort
  }): ExpenseSubmissionService
  createAsyncJobs(input: { bucketName: string }): ExpenseAsyncJobStore
  createAsyncQueue(input: {
    projectId: string
    location: 'asia-southeast1'
    queueName: string
    workerUrl: string
    workerAudience: string
    taskInvokerEmail: string
  }): ExpenseTaskQueue
  createAsyncIdentity(input: { audience: string; allowedEmail: string }): WorkerIdentityVerifier
  createAsyncTelemetry(): ExpenseAsyncTelemetry
  createAsyncWorker(input: {
    jobs: ExpenseAsyncJobStore
    submission: ExpenseSubmissionService
    now: () => Date
    telemetry: ExpenseAsyncTelemetry
  }): ExpenseAsyncWorker
}

export type PmcMiniAppRuntimeMiddleware = ReturnType<typeof createPmcMiniAppMiddleware> & {
  expenseFinance?: PmcFinanceRuntime
}
export type PmcMiniAppRuntimeConstructor = (config: PmcMiniAppServerConfig, env: NodeJS.ProcessEnv) => PmcMiniAppRuntimeMiddleware

const realFinanceFactories: PmcFinanceRuntimeFactories = {
  createGoogle: createFinanceGooglePorts,
  createStaging: createGoogleExpenseStagingPort,
  createIngress: createExpenseIngressClient,
  createRecovery: (input) => createExpenseRecoveryWorker({
    ingress: createExpenseRecoveryIngressClient(input),
  }),
  createRecoveryIdentity: createWorkerIdentityVerifier,
  createSubmission: createExpenseSubmissionService,
  createAsyncJobs: ({ bucketName }) => createGoogleExpenseAsyncJobStore({ bucketName }),
  createAsyncQueue: createGoogleExpenseTaskQueue,
  createAsyncIdentity: createWorkerIdentityVerifier,
  createAsyncTelemetry: createExpenseAsyncTelemetry,
  createAsyncWorker: createExpenseAsyncWorker,
}

export function createPmcFinanceRuntime(
  config: PmcFinanceConfig,
  factories: PmcFinanceRuntimeFactories = realFinanceFactories,
): PmcFinanceRuntime {
  const recovery = factories.createRecovery({
    url: config.expenseIngressUrl,
    secret: config.expenseIngressSecret,
  })
  const recoveryIdentity = factories.createRecoveryIdentity({
    audience: config.recoveryAudience,
    allowedEmail: config.recoveryInvokerEmail,
  })
  const resume = factories.createIngress({
    url: config.expenseIngressUrl,
    secret: config.expenseIngressSecret,
  })
  const staging = factories.createStaging({ bucketName: config.stagingBucketName })
  if (!config.readsEnabled && !config.captureEnabled) {
    return { config, resume, staging, recovery, recoveryIdentity }
  }
  const finance = factories.createGoogle({
    masterSpreadsheetId: config.masterSpreadsheetId,
    folderId: config.folderId,
  })
  const reads = config.readsEnabled
    ? { finance: financeGoogleReadCapability(finance) }
    : undefined
  if (!config.captureEnabled) {
    return { config, resume, staging, recovery, recoveryIdentity, ...(reads ? { reads } : {}) }
  }
  const captureFinance = financeGoogleCaptureCapability(finance)
  const ingress = resume
  const submission = factories.createSubmission({ ingress, finance: captureFinance, staging })
  const capture = { finance: captureFinance, staging, ingress, submission }
  const async = config.async ? (() => {
    const jobs = factories.createAsyncJobs({ bucketName: config.async!.jobBucketName })
    const queue = factories.createAsyncQueue({
      projectId: config.async!.projectId,
      location: config.async!.location,
      queueName: config.async!.queueName,
      workerUrl: config.async!.workerUrl,
      workerAudience: config.async!.workerAudience,
      taskInvokerEmail: config.async!.taskInvokerEmail,
    })
    const identity = factories.createAsyncIdentity({
      audience: config.async!.workerAudience,
      allowedEmail: config.async!.taskInvokerEmail,
    })
    const telemetry = factories.createAsyncTelemetry()
    const worker = factories.createAsyncWorker({
      jobs, submission, now: () => new Date(), telemetry,
    })
    return { config: config.async!, jobs, queue, worker, identity, telemetry }
  })() : undefined
  return {
    config, resume, staging, recovery, recoveryIdentity,
    ...(reads ? { reads } : {}), capture, ...(async ? { async } : {}),
  }
}

export function createPmcMiniAppRuntime(
  env: NodeJS.ProcessEnv,
  construct: PmcMiniAppRuntimeConstructor = constructPmcMiniAppRuntime,
): PmcMiniAppRuntimeMiddleware | undefined {
  try {
    const config = readPmcMiniAppConfig(env)
    if (!config) return undefined
    return construct(config, env)
  } catch {
    return undefined
  }
}

function constructPmcMiniAppRuntime(config: PmcMiniAppServerConfig, env: NodeJS.ProcessEnv): PmcMiniAppRuntimeMiddleware {
  const expenseFinance = config.finance ? safeFinanceRuntime(config.finance) : undefined
  const google = createMiniAppGooglePorts({
    spreadsheetId: config.spreadsheetId,
    intakeFolderId: config.intakeFolderId,
  })
  const store = createGoogleMiniAppStore({ spreadsheetId: config.spreadsheetId, sheets: google.sheets })
  const identity = createLineIdentityClient({ channelId: config.lineChannelId })
  const ingress = createBookingIngressClient({
    url: config.bookingIngressUrl,
    secret: config.bookingIngressSecret,
  })
  const evidenceIngress = createEvidenceIngressClient({
    url: config.bookingIngressUrl,
    secret: config.bookingIngressSecret,
  })
  const draftStateIngress = createDraftStateIngressClient({
    url: config.bookingIngressUrl,
    secret: config.bookingIngressSecret,
  })
  const now = () => new Date()
  const finance = expenseFinance ? {
    signingSecret: config.signingSecret,
    now: () => now().getTime(),
    recovery: expenseFinance.recovery,
    resume: { ingress: expenseFinance.resume, staging: expenseFinance.staging },
    ...(expenseFinance.reads ? {
      reads: { readStore: createFinanceReadStore({ finance: expenseFinance.reads.finance }) },
    } : {}),
    ...(expenseFinance.capture ? { capture: {
      staging: expenseFinance.capture.staging,
      submission: expenseFinance.capture.submission,
      ingress: expenseFinance.capture.ingress,
    } } : {}),
    ...(expenseFinance.async ? { async: expenseFinance.async } : {}),
  } : undefined
  const asyncTelemetry = createAsyncBookingTelemetry()
  const bookingPerformanceTelemetry = createBookingPerformanceTelemetry()
  const stock = {
    enabled: config.stockEnabled,
    managerPilotOnly: config.stockManagerPilotOnly,
    readStore: createStockReadStore({ spreadsheetId: config.spreadsheetId, sheets: google.sheets }),
    ingress: createStockIngressClient({
      url: config.bookingIngressUrl,
      secret: config.bookingIngressSecret,
    }),
  }
  const enrollment = config.enrollmentPin ? createEnrollmentService({
    pin: config.enrollmentPin,
    signingSecret: config.signingSecret,
    store,
  }) : undefined
  const jera = createJeraRuntime(env, { spreadsheetId: config.spreadsheetId, sheets: google.sheets })
  const workerIdentity = config.asyncBooking ? createWorkerIdentityVerifier({
    audience: config.asyncBooking.workerAudience,
    allowedEmail: config.asyncBooking.taskInvokerEmail,
  }) : undefined
  const asyncDependencies = config.asyncBooking ? (() => {
    const evidenceStaging = createGoogleEvidenceStagingPort({ bucketName: config.asyncBooking.bucketName })
    const stateIngress = createAsyncStateIngressClient({
      url: config.bookingIngressUrl,
      secret: config.bookingIngressSecret,
    })
    return {
      evidenceStaging,
      stateIngress,
      taskQueue: createGoogleBookingTaskQueue({
        projectId: config.asyncBooking.projectId,
        location: config.asyncBooking.location,
        queueName: config.asyncBooking.queueName,
        workerUrl: config.asyncBooking.workerUrl,
        workerAudience: config.asyncBooking.workerAudience,
        taskInvokerEmail: config.asyncBooking.taskInvokerEmail,
      }),
      asyncWorker: createAsyncBookingWorker({
        store,
        staging: evidenceStaging,
        evidenceIngress,
        bookingIngress: ingress,
        stateIngress,
        telemetry: asyncTelemetry,
        now,
        wait: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      }),
    }
  })() : {}
  const middleware = createPmcMiniAppMiddleware({
    config,
    store,
    identity,
    drive: google.drive,
    ingress,
    evidenceIngress,
    draftStateIngress,
    asyncTelemetry,
    bookingPerformanceTelemetry,
    ...asyncDependencies,
    ...(workerIdentity ? { workerIdentity } : {}),
    ...(expenseFinance ? { expenseRecoveryIdentity: expenseFinance.recoveryIdentity } : {}),
    ...(enrollment ? { enrollment } : {}),
    jera: jera?.api,
    stock,
    ...(finance ? { finance } : {}),
    now,
  })
  return Object.assign(middleware, expenseFinance ? { expenseFinance } : {})
}

function safeFinanceRuntime(config: PmcFinanceConfig): PmcFinanceRuntime | undefined {
  try {
    return createPmcFinanceRuntime(config)
  } catch {
    return undefined
  }
}
