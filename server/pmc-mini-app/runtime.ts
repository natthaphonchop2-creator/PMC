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

export type PmcMiniAppRuntimeMiddleware = ReturnType<typeof createPmcMiniAppMiddleware>
export type PmcMiniAppRuntimeConstructor = (config: PmcMiniAppServerConfig, env: NodeJS.ProcessEnv) => PmcMiniAppRuntimeMiddleware

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
  const now = () => new Date()
  const asyncTelemetry = createAsyncBookingTelemetry()
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
  return createPmcMiniAppMiddleware({
    config,
    store,
    identity,
    drive: google.drive,
    ingress,
    evidenceIngress,
    asyncTelemetry,
    ...asyncDependencies,
    ...(enrollment ? { enrollment } : {}),
    jera: jera?.api,
    now,
  })
}
