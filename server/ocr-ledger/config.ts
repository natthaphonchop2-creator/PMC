export interface OcrLedgerConfig {
  lineChannelSecret: string
  lineChannelAccessToken: string
  allowedGroupId: string
  masterSpreadsheetId: string
  driveRootId: string
  monthlyLedgersFolderId: string
  liffId: string
  liffChannelId: string
  reviewSigningSecret: string
  openAiApiKey: string
  openAiOcrModel: string
  googleClientId: string
  googleClientSecret: string
  googleRefreshToken: string
  dailyReportEnabled: boolean
  dailyReportTime: string
  timezone: 'Asia/Bangkok'
  workerBatchSize: number
  maxImageBytes: number
  openAiMaxOutputTokens: number
}

export type OcrLedgerConfigResult =
  | { configured: true; config: OcrLedgerConfig }
  | { configured: false; missing: string[] }

const REQUIRED = [
  'OCR_LINE_CHANNEL_SECRET', 'OCR_LINE_CHANNEL_ACCESS_TOKEN', 'OCR_ALLOWED_GROUP_ID',
  'OCR_MASTER_SPREADSHEET_ID', 'OCR_DRIVE_ROOT_ID', 'OCR_MONTHLY_LEDGERS_FOLDER_ID', 'OCR_LIFF_ID', 'OCR_LIFF_CHANNEL_ID',
  'OCR_REVIEW_SIGNING_SECRET', 'OPENAI_API_KEY', 'OPENAI_OCR_MODEL', 'OCR_GOOGLE_CLIENT_ID',
  'OCR_GOOGLE_CLIENT_SECRET', 'OCR_GOOGLE_REFRESH_TOKEN', 'OCR_DAILY_REPORT_ENABLED',
  'OCR_DAILY_REPORT_TIME', 'OCR_TIMEZONE', 'OCR_WORKER_BATCH_SIZE', 'OCR_MAX_IMAGE_BYTES',
  'OCR_OPENAI_MAX_OUTPUT_TOKENS',
] as const

export function readOcrLedgerConfig(env: NodeJS.ProcessEnv): OcrLedgerConfigResult {
  const missing = REQUIRED.filter((name) => !env[name]?.trim())
  if (env.OCR_ALLOWED_GROUP_ID && !env.OCR_ALLOWED_GROUP_ID.startsWith('C')) missing.push('OCR_ALLOWED_GROUP_ID')
  if (env.OCR_TIMEZONE && env.OCR_TIMEZONE !== 'Asia/Bangkok') missing.push('OCR_TIMEZONE')
  if (env.OCR_DAILY_REPORT_TIME && !/^([01]\d|2[0-3]):[0-5]\d$/.test(env.OCR_DAILY_REPORT_TIME)) missing.push('OCR_DAILY_REPORT_TIME')
  for (const name of ['OCR_WORKER_BATCH_SIZE', 'OCR_MAX_IMAGE_BYTES', 'OCR_OPENAI_MAX_OUTPUT_TOKENS'] as const) {
    const value = env[name]
    const parsed = Number(value)
    if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0)) missing.push(name)
  }
  if (env.OCR_DAILY_REPORT_ENABLED && !['true', 'false'].includes(env.OCR_DAILY_REPORT_ENABLED)) missing.push('OCR_DAILY_REPORT_ENABLED')
  if (missing.length > 0) return { configured: false, missing: [...new Set(missing)] }

  return {
    configured: true,
    config: {
      lineChannelSecret: env.OCR_LINE_CHANNEL_SECRET!, lineChannelAccessToken: env.OCR_LINE_CHANNEL_ACCESS_TOKEN!,
      allowedGroupId: env.OCR_ALLOWED_GROUP_ID!, masterSpreadsheetId: env.OCR_MASTER_SPREADSHEET_ID!,
      driveRootId: env.OCR_DRIVE_ROOT_ID!, monthlyLedgersFolderId: env.OCR_MONTHLY_LEDGERS_FOLDER_ID!,
      liffId: env.OCR_LIFF_ID!, liffChannelId: env.OCR_LIFF_CHANNEL_ID!,
      reviewSigningSecret: env.OCR_REVIEW_SIGNING_SECRET!, openAiApiKey: env.OPENAI_API_KEY!, openAiOcrModel: env.OPENAI_OCR_MODEL!,
      googleClientId: env.OCR_GOOGLE_CLIENT_ID!, googleClientSecret: env.OCR_GOOGLE_CLIENT_SECRET!, googleRefreshToken: env.OCR_GOOGLE_REFRESH_TOKEN!,
      dailyReportEnabled: env.OCR_DAILY_REPORT_ENABLED === 'true', dailyReportTime: env.OCR_DAILY_REPORT_TIME!, timezone: 'Asia/Bangkok',
      workerBatchSize: Number(env.OCR_WORKER_BATCH_SIZE), maxImageBytes: Number(env.OCR_MAX_IMAGE_BYTES), openAiMaxOutputTokens: Number(env.OCR_OPENAI_MAX_OUTPUT_TOKENS),
    },
  }
}
