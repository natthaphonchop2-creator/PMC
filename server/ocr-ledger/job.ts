import { readOcrLedgerConfig } from './config.js'
import { createGoogleOcrPorts } from './googleClient.js'
import { createGoogleOcrStore } from './googleStore.js'
import { createOcrLineClient } from './lineClient.js'
import { createOpenAiOcrExtractor } from './openAiExtractor.js'
import { createOcrLedgerWorker, type OcrLedgerWorkerResult } from './worker.js'

export async function runOcrLedgerJob(env: NodeJS.ProcessEnv): Promise<OcrLedgerWorkerResult> {
  const configured = readOcrLedgerConfig(env)
  if (!configured.configured) throw new Error('OCR ledger configuration is incomplete')
  const config = configured.config
  const ports = createGoogleOcrPorts({
    googleClientId: config.googleClientId, googleClientSecret: config.googleClientSecret,
    googleRefreshToken: config.googleRefreshToken, driveRootId: config.driveRootId,
  })
  const store = createGoogleOcrStore({ masterSpreadsheetId: config.masterSpreadsheetId, sheets: ports.sheets, drive: ports.drive })
  const line = createOcrLineClient({
    channelAccessToken: config.lineChannelAccessToken, liffChannelId: config.liffChannelId,
    maxImageBytes: config.maxImageBytes,
  })
  const now = () => new Date()
  const extractor = createOpenAiOcrExtractor({
    apiKey: config.openAiApiKey, model: config.openAiOcrModel, maxOutputTokens: config.openAiMaxOutputTokens,
    referenceDate: now().toISOString(),
  })
  return createOcrLedgerWorker({ config, store, line, drive: ports.drive, extractor, now }).runOnce()
}

async function main(): Promise<void> {
  try {
    const result = await runOcrLedgerJob(process.env)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch {
    process.stderr.write('OCR ledger job failed\n')
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('/server/ocr-ledger/job.js')) void main()
