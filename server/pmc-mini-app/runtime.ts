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
import { createWorkerIdentityVerifier } from './workerAuth.js'
import { createAsyncBookingWorker } from './asyncWorker.js'
import { createAsyncStateIngressClient } from './asyncStateIngressClient.js'
import { createAsyncBookingTelemetry } from './asyncTelemetry.js'
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

export interface PmcFinanceRuntime {
  config: PmcFinanceConfig
  reads?: {
    finance: FinanceGoogleReadPorts
  }
  capture?: {
    finance: FinanceGoogleCapturePorts
    staging: ExpenseStagingPort
    ingress: ExpenseIngressClient
    submission: ExpenseSubmissionService
  }
}

export interface PmcFinanceRuntimeFactories {
  createGoogle(input: { masterSpreadsheetId: string; folderId: string }): FinanceGooglePorts
  createStaging(input: { bucketName: string }): ExpenseStagingPort
  createIngress(input: { url: string; secret: string }): ExpenseIngressClient
  createSubmission(input: {
    ingress: ExpenseIngressClient
    finance: FinanceGoogleCapturePorts
    staging: ExpenseStagingPort
  }): ExpenseSubmissionService
}

export type PmcMiniAppRuntimeMiddleware = ReturnType<typeof createPmcMiniAppMiddleware> & {
  expenseFinance?: PmcFinanceRuntime
}
export type PmcMiniAppRuntimeConstructor = (config: PmcMiniAppServerConfig, env: NodeJS.ProcessEnv) => PmcMiniAppRuntimeMiddleware

const realFinanceFactories: PmcFinanceRuntimeFactories = {
  createGoogle: createFinanceGooglePorts,
  createStaging: createGoogleExpenseStagingPort,
  createIngress: createExpenseIngressClient,
  createSubmission: createExpenseSubmissionService,
}

export function createPmcFinanceRuntime(
  config: PmcFinanceConfig,
  factories: PmcFinanceRuntimeFactories = realFinanceFactories,
): PmcFinanceRuntime {
  const finance = factories.createGoogle({
    masterSpreadsheetId: config.masterSpreadsheetId,
    folderId: config.folderId,
  })
  const reads = config.readsEnabled
    ? { finance: financeGoogleReadCapability(finance) }
    : undefined
  if (!config.captureEnabled) {
    return { config, ...(reads ? { reads } : {}) }
  }
  const captureFinance = financeGoogleCaptureCapability(finance)
  const staging = factories.createStaging({ bucketName: config.stagingBucketName })
  const ingress = factories.createIngress({
    url: config.expenseIngressUrl,
    secret: config.expenseIngressSecret,
  })
  const submission = factories.createSubmission({ ingress, finance: captureFinance, staging })
  const capture = { finance: captureFinance, staging, ingress, submission }
  return { config, ...(reads ? { reads } : {}), capture }
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
    ...(expenseFinance.reads ? {
      reads: { readStore: createFinanceReadStore({ finance: expenseFinance.reads.finance }) },
    } : {}),
    ...(expenseFinance.capture ? { capture: {
      staging: expenseFinance.capture.staging,
      submission: expenseFinance.capture.submission,
      ingress: expenseFinance.capture.ingress,
    } } : {}),
  } : undefined
  const asyncTelemetry = createAsyncBookingTelemetry()
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
      workerIdentity: createWorkerIdentityVerifier({
        audience: config.asyncBooking.workerAudience,
        allowedEmail: config.asyncBooking.taskInvokerEmail,
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
    ...asyncDependencies,
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
