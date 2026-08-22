import { describe, expect, it } from 'vitest'
import { readOcrLedgerConfig } from '../../server/ocr-ledger/config'

describe('OCR ledger configuration', () => {
  it('fails closed for missing required values without exposing values', () => {
    expect(readOcrLedgerConfig({})).toEqual({
      configured: false,
      missing: [
        'OCR_LINE_CHANNEL_SECRET', 'OCR_LINE_CHANNEL_ACCESS_TOKEN', 'OCR_ALLOWED_GROUP_ID',
        'OCR_MASTER_SPREADSHEET_ID', 'OCR_DRIVE_ROOT_ID', 'OCR_LIFF_ID', 'OCR_LIFF_CHANNEL_ID',
        'OCR_REVIEW_SIGNING_SECRET', 'OPENAI_API_KEY', 'OPENAI_OCR_MODEL', 'OCR_GOOGLE_CLIENT_ID',
        'OCR_GOOGLE_CLIENT_SECRET', 'OCR_GOOGLE_REFRESH_TOKEN', 'OCR_DAILY_REPORT_ENABLED',
        'OCR_DAILY_REPORT_TIME', 'OCR_TIMEZONE', 'OCR_WORKER_BATCH_SIZE', 'OCR_MAX_IMAGE_BYTES',
        'OCR_OPENAI_MAX_OUTPUT_TOKENS',
      ],
    })
  })

  it('requires a LINE group ID, Bangkok timezone, and 24-hour report time', () => {
    const base = validEnvironment()
    expect(readOcrLedgerConfig({ ...base, OCR_ALLOWED_GROUP_ID: 'U123' }).configured).toBe(false)
    expect(readOcrLedgerConfig({ ...base, OCR_TIMEZONE: 'UTC' }).configured).toBe(false)
    expect(readOcrLedgerConfig({ ...base, OCR_DAILY_REPORT_TIME: '8pm' }).configured).toBe(false)
  })

  it('rejects positive digit strings outside the JavaScript safe integer range', () => {
    for (const name of ['OCR_WORKER_BATCH_SIZE', 'OCR_MAX_IMAGE_BYTES', 'OCR_OPENAI_MAX_OUTPUT_TOKENS'] as const) {
      expect(readOcrLedgerConfig({
        ...validEnvironment(),
        [name]: '9007199254740992',
      })).toEqual({ configured: false, missing: [name] })
    }
  })
})

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    OCR_LINE_CHANNEL_SECRET: 'secret', OCR_LINE_CHANNEL_ACCESS_TOKEN: 'token', OCR_ALLOWED_GROUP_ID: 'C123',
    OCR_MASTER_SPREADSHEET_ID: 'sheet', OCR_DRIVE_ROOT_ID: 'drive', OCR_LIFF_ID: 'liff', OCR_LIFF_CHANNEL_ID: 'channel',
    OCR_REVIEW_SIGNING_SECRET: 'signing', OPENAI_API_KEY: 'openai', OPENAI_OCR_MODEL: 'model',
    OCR_GOOGLE_CLIENT_ID: 'client', OCR_GOOGLE_CLIENT_SECRET: 'client-secret', OCR_GOOGLE_REFRESH_TOKEN: 'refresh',
    OCR_DAILY_REPORT_ENABLED: 'true', OCR_DAILY_REPORT_TIME: '20:00', OCR_TIMEZONE: 'Asia/Bangkok',
    OCR_WORKER_BATCH_SIZE: '5', OCR_MAX_IMAGE_BYTES: '1000', OCR_OPENAI_MAX_OUTPUT_TOKENS: '1000',
  }
}
