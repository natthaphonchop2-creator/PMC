import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createProductionRequestHandler } from './productionApp.js'
import { createMetaApiMiddleware } from './metaApiPlugin.js'
import { createOpenAiMiddleware } from './openAiPlugin.js'
import { createPageAutomationMiddleware } from './pageAutomationPlugin.js'
import { createBookingLineWebhookMiddleware } from './bookingLineWebhook.js'
import { readOcrLedgerConfig } from './ocr-ledger/config.js'
import { createGoogleOcrPorts } from './ocr-ledger/googleClient.js'
import { createGoogleOcrStore } from './ocr-ledger/googleStore.js'
import { createOcrLineClient } from './ocr-ledger/lineClient.js'
import { createOcrLedgerMiddleware } from './ocr-ledger/middleware.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 4174)
const distDir = resolve(process.cwd(), 'dist')
const metaApi = createMetaApiMiddleware(process.env)
const openAiApi = createOpenAiMiddleware(process.env)
const pageAutomationApi = createPageAutomationMiddleware(process.env)
const bookingLineWebhook = createBookingLineWebhookMiddleware(process.env)
const ocrConfig = readOcrLedgerConfig(process.env)
const ocrLedger = ocrConfig.configured
  ? (() => {
      const config = ocrConfig.config
      const google = createGoogleOcrPorts({
        googleClientId: config.googleClientId,
        googleClientSecret: config.googleClientSecret,
        googleRefreshToken: config.googleRefreshToken,
        driveRootId: config.driveRootId,
      })
      const store = createGoogleOcrStore({
        masterSpreadsheetId: config.masterSpreadsheetId,
        sheets: google.sheets,
        drive: google.drive,
      })
      const line = createOcrLineClient({
        channelAccessToken: config.lineChannelAccessToken,
        liffChannelId: config.liffChannelId,
        maxImageBytes: config.maxImageBytes,
      })
      return createOcrLedgerMiddleware({ config, store, line, drive: google.drive, now: () => new Date() })
    })()
  : undefined

const server = createServer(createProductionRequestHandler({
  distDir,
  basicAuthUser: process.env.APP_BASIC_AUTH_USER || 'pmc',
  basicAuthPassword: process.env.APP_BASIC_AUTH_PASSWORD || '',
  allowUnauthenticated: process.env.APP_ALLOW_UNAUTHENTICATED === 'true',
  metaApi,
  openAiApi,
  pageAutomationApi,
  bookingLineWebhook,
  ocrLedger,
}))

server.listen(port, host, () => {
  console.log(`PMC Ads Agent running on http://${host}:${port}`)
})
