import { createBookingIngressClient } from './bookingIngressClient.js'
import { readPmcMiniAppConfig, type PmcMiniAppServerConfig } from './config.js'
import { createMiniAppGooglePorts } from './googleClient.js'
import { createLineIdentityClient } from './lineIdentity.js'
import { createPmcMiniAppMiddleware } from './middleware.js'
import { createGoogleMiniAppStore } from './store.js'

export type PmcMiniAppRuntimeMiddleware = ReturnType<typeof createPmcMiniAppMiddleware>
export type PmcMiniAppRuntimeConstructor = (config: PmcMiniAppServerConfig) => PmcMiniAppRuntimeMiddleware

export function createPmcMiniAppRuntime(
  env: NodeJS.ProcessEnv,
  construct: PmcMiniAppRuntimeConstructor = constructPmcMiniAppRuntime,
): PmcMiniAppRuntimeMiddleware | undefined {
  try {
    const config = readPmcMiniAppConfig(env)
    if (!config) return undefined
    return construct(config)
  } catch {
    return undefined
  }
}

function constructPmcMiniAppRuntime(config: PmcMiniAppServerConfig): PmcMiniAppRuntimeMiddleware {
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
  return createPmcMiniAppMiddleware({
    config,
    store,
    identity,
    drive: google.drive,
    ingress,
    now: () => new Date(),
  })
}
