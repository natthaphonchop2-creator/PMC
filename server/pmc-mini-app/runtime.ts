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
  const enrollment = config.enrollmentPin ? createEnrollmentService({
    pin: config.enrollmentPin,
    signingSecret: config.signingSecret,
    store,
  }) : undefined
  const jera = createJeraRuntime(env, { spreadsheetId: config.spreadsheetId, sheets: google.sheets })
  return createPmcMiniAppMiddleware({
    config,
    store,
    identity,
    drive: google.drive,
    ingress,
    evidenceIngress,
    ...(config.asyncBooking ? {
      evidenceStaging: createGoogleEvidenceStagingPort({ bucketName: config.asyncBooking.bucketName }),
    } : {}),
    ...(enrollment ? { enrollment } : {}),
    jera: jera?.api,
    now: () => new Date(),
  })
}
