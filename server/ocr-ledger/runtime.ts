import { readOcrLedgerConfig, type OcrLedgerConfig } from './config.js'
import { createGoogleOcrPorts } from './googleClient.js'
import { createGoogleOcrStore } from './googleStore.js'
import { createOcrLineClient } from './lineClient.js'
import { createOcrLedgerMiddleware } from './middleware.js'

export type OcrLedgerRuntimeMiddleware = ReturnType<typeof createOcrLedgerMiddleware>
export type OcrLedgerRuntimeConstructor = (config: OcrLedgerConfig) => OcrLedgerRuntimeMiddleware

export function createOcrLedgerRuntime(
  env: NodeJS.ProcessEnv,
  construct: OcrLedgerRuntimeConstructor = constructOcrLedgerRuntime,
): OcrLedgerRuntimeMiddleware | undefined {
  try {
    const configured = readOcrLedgerConfig(env)
    if (!configured.configured) return undefined
    return construct(configured.config)
  } catch {
    return undefined
  }
}

function constructOcrLedgerRuntime(config: OcrLedgerConfig): OcrLedgerRuntimeMiddleware {
  const google = createGoogleOcrPorts({
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    googleRefreshToken: config.googleRefreshToken,
    driveRootId: config.driveRootId,
    monthlyLedgersFolderId: config.monthlyLedgersFolderId,
  })
  const store = createGoogleOcrStore({
    masterSpreadsheetId: config.masterSpreadsheetId,
    monthlyLedgersFolderId: config.monthlyLedgersFolderId,
    sheets: google.sheets,
    drive: google.drive,
  })
  const line = createOcrLineClient({
    channelAccessToken: config.lineChannelAccessToken,
    liffChannelId: config.liffChannelId,
    maxImageBytes: config.maxImageBytes,
  })
  return createOcrLedgerMiddleware({ config, store, line, drive: google.drive, now: () => new Date() })
}
