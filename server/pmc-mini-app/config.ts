import { readPmcAsyncBookingConfig, type PmcAsyncBookingConfig } from './asyncConfig.js'
import { readPmcFinanceConfig, type PmcFinanceConfig } from './finance/config.js'

export interface PmcMiniAppServerConfig {
  enabled: true
  miniAppId: string
  lineChannelId: string
  spreadsheetId: string
  intakeFolderId: string
  bookingIngressUrl: string
  fallbackFormUrl: string
  bookingIngressSecret: string
  signingSecret: string
  enrollmentPin: string | null
  maxImageBytes: 10_000_000
  maxFilesPerKind: 10
  asyncBooking: PmcAsyncBookingConfig | null
  financeReportsEnabled: boolean
  stockEnabled: boolean
  stockManagerPilotOnly: boolean
  finance: PmcFinanceConfig | null
}

const REQUIRED = [
  'PMC_MINI_APP_ID',
  'PMC_MINI_APP_LIFF_CHANNEL_ID',
  'PMC_SPREADSHEET_ID',
  'PMC_DRIVE_INTAKE_FOLDER_ID',
  'PMC_BOOKING_INGRESS_URL',
  'PMC_BOOKING_FALLBACK_FORM_URL',
] as const

const REQUIRED_SECRETS = [
  'PMC_BOOKING_INGRESS_SECRET',
  'PMC_MINI_APP_SIGNING_SECRET',
] as const

const MAX_IMAGE_BYTES = 10_000_000 as const
const MAX_FILES_PER_KIND = 10 as const

type MiniAppEnvironment = Record<string, string | undefined>

export function readPmcMiniAppConfig(env: MiniAppEnvironment): PmcMiniAppServerConfig | null {
  if (env.PMC_MINI_APP_ENABLED !== 'true') return null

  const requiredNames = [...REQUIRED, ...REQUIRED_SECRETS]
  if (requiredNames.some((name) => !boundedValue(env[name]))) return null
  if (!/^\d+$/.test(env.PMC_MINI_APP_LIFF_CHANNEL_ID!.trim())) return null
  if (!isHttpsUrl(env.PMC_BOOKING_INGRESS_URL!)) return null
  if (!isAllowedFallbackFormUrl(env.PMC_BOOKING_FALLBACK_FORM_URL!)) return null
  if (!matchesFixedLimit(env.PMC_MINI_APP_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES)) return null
  if (!matchesFixedLimit(env.PMC_MINI_APP_MAX_FILES_PER_KIND, MAX_FILES_PER_KIND)) return null
  if (env.PMC_MINI_APP_ENROLLMENT_ENABLED !== undefined
    && env.PMC_MINI_APP_ENROLLMENT_ENABLED !== 'true'
    && env.PMC_MINI_APP_ENROLLMENT_ENABLED !== 'false') return null
  if (!validOptionalFlag(env.PMC_STOCK_ENABLED)) return null
  if (!validOptionalFlag(env.PMC_STOCK_MANAGER_PILOT_ONLY)) return null
  if (!validOptionalFlag(env.PMC_FINANCE_REPORTS_ENABLED)) return null
  const enrollmentPin = env.PMC_MINI_APP_ENROLLMENT_ENABLED === 'true'
    ? env.PMC_MINI_APP_ENROLLMENT_PIN?.trim() ?? ''
    : null
  if (enrollmentPin !== null && !/^\d{6}$/.test(enrollmentPin)) return null

  const asyncBooking = readPmcAsyncBookingConfig(env)
  if (env.PMC_MINI_APP_ASYNC_ENABLED === 'true' && !asyncBooking) return null

  return {
    enabled: true,
    miniAppId: env.PMC_MINI_APP_ID!.trim(),
    lineChannelId: env.PMC_MINI_APP_LIFF_CHANNEL_ID!.trim(),
    spreadsheetId: env.PMC_SPREADSHEET_ID!.trim(),
    intakeFolderId: env.PMC_DRIVE_INTAKE_FOLDER_ID!.trim(),
    bookingIngressUrl: env.PMC_BOOKING_INGRESS_URL!.trim(),
    fallbackFormUrl: env.PMC_BOOKING_FALLBACK_FORM_URL!.trim(),
    bookingIngressSecret: env.PMC_BOOKING_INGRESS_SECRET!.trim(),
    signingSecret: env.PMC_MINI_APP_SIGNING_SECRET!.trim(),
    enrollmentPin,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxFilesPerKind: MAX_FILES_PER_KIND,
    asyncBooking,
    financeReportsEnabled: env.PMC_FINANCE_REPORTS_ENABLED === 'true',
    stockEnabled: env.PMC_STOCK_ENABLED === 'true',
    stockManagerPilotOnly: env.PMC_STOCK_MANAGER_PILOT_ONLY === 'true',
    finance: readPmcFinanceConfig(env),
  }
}

function validOptionalFlag(value: string | undefined): boolean {
  return value === undefined || value === 'true' || value === 'false'
}

function boundedValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 && trimmed.length <= 2_048
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function isAllowedFallbackFormUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'docs.google.com' || parsed.hostname === 'forms.gle')
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}

function matchesFixedLimit(value: string | undefined, expected: number): boolean {
  if (value === undefined || value === '') return true
  return value === String(expected)
}
