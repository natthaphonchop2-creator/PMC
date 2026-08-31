export interface PmcFinanceConfig {
  captureEnabled: boolean
  readsEnabled: boolean
  masterSpreadsheetId: string
  folderId: string
  stagingBucketName: string
  expenseIngressUrl: string
  expenseIngressSecret: string
  recoveryAudience: string
  recoveryInvokerEmail: string
}

type FinanceEnvironment = Record<string, string | undefined>

const FINANCE_BINDINGS = [
  'PMC_FINANCE_MASTER_SPREADSHEET_ID',
  'PMC_FINANCE_FOLDER_ID',
  'PMC_FINANCE_STAGING_BUCKET',
  'PMC_EXPENSE_INGRESS_URL',
  'PMC_EXPENSE_INGRESS_SECRET',
  'PMC_EXPENSE_RECOVERY_AUDIENCE',
  'PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL',
] as const

export function readPmcFinanceConfig(env: FinanceEnvironment): PmcFinanceConfig | null {
  const captureEnabled = exactFlag(env.PMC_EXPENSE_CAPTURE_ENABLED)
  const readsEnabled = exactFlag(env.PMC_FINANCE_READS_ENABLED)
  if (captureEnabled === null || readsEnabled === null) return null
  const explicitRecoveryOnly = !captureEnabled
    && !readsEnabled
    && env.PMC_EXPENSE_CAPTURE_ENABLED === 'false'
    && env.PMC_FINANCE_READS_ENABLED === 'false'
  if (!captureEnabled && !readsEnabled && !explicitRecoveryOnly) return null
  if (FINANCE_BINDINGS.some((name) => !boundedValue(env[name]))) return null

  const masterSpreadsheetId = env.PMC_FINANCE_MASTER_SPREADSHEET_ID!.trim()
  const folderId = env.PMC_FINANCE_FOLDER_ID!.trim()
  const stagingBucketName = env.PMC_FINANCE_STAGING_BUCKET!.trim()
  const expenseIngressUrl = env.PMC_EXPENSE_INGRESS_URL!.trim()
  const expenseIngressSecret = env.PMC_EXPENSE_INGRESS_SECRET!.trim()
  const recoveryAudience = env.PMC_EXPENSE_RECOVERY_AUDIENCE!.trim()
  const recoveryInvokerEmail = env.PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL!.trim()
  if (
    !safeGoogleId(masterSpreadsheetId)
    || !safeGoogleId(folderId)
    || !safeBucketName(stagingBucketName)
    || !safeHttpsUrl(expenseIngressUrl)
    || !safeOrigin(recoveryAudience)
    || !serviceAccountEmail(recoveryInvokerEmail)
    || expenseIngressSecret === env.PMC_BOOKING_INGRESS_SECRET?.trim()
    || expenseIngressSecret === env.PMC_MINI_APP_SIGNING_SECRET?.trim()
  ) return null

  return {
    captureEnabled,
    readsEnabled,
    masterSpreadsheetId,
    folderId,
    stagingBucketName,
    expenseIngressUrl,
    expenseIngressSecret,
    recoveryAudience,
    recoveryInvokerEmail,
  }
}

function exactFlag(value: string | undefined): boolean | null {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function boundedValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 && trimmed.length <= 2_048
}

function safeGoogleId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value)
}

function safeBucketName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)
}

function safeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}

function safeOrigin(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (parsed.pathname === '/' || parsed.pathname === '')
  } catch {
    return false
  }
}

function serviceAccountEmail(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value)
}
