import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createProductionRequestHandler } from './productionApp.js'
import { createMetaApiMiddleware } from './metaApiPlugin.js'
import { createOpenAiMiddleware } from './openAiPlugin.js'
import { createPageAutomationMiddleware } from './pageAutomationPlugin.js'
import { createBookingLineWebhookMiddleware } from './bookingLineWebhook.js'
import { createOcrLedgerRuntime } from './ocr-ledger/runtime.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 4174)
const distDir = resolve(process.cwd(), 'dist')
const metaApi = createMetaApiMiddleware(process.env)
const openAiApi = createOpenAiMiddleware(process.env)
const pageAutomationApi = createPageAutomationMiddleware(process.env)
const bookingLineWebhook = createBookingLineWebhookMiddleware(process.env)
const ocrLedger = createOcrLedgerRuntime(process.env)

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
