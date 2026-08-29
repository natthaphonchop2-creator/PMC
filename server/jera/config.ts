export class OpaqueSecret {
  readonly #secret: string

  constructor(value: string) {
    this.#secret = value
    Object.freeze(this)
  }

  reveal(): string { return this.#secret }
  toString(): string { return '[REDACTED]' }
  toJSON(): string { return '[REDACTED]' }
  [Symbol.toPrimitive](): string { return '[REDACTED]' }
}

export interface JeraConfig {
  enabled: true
  baseUrl: string
  defaultBranchUuid: string
  apiUsername: OpaqueSecret
  apiPassword: OpaqueSecret
  syncIntervalMinutes: number
  manualRefreshSeconds: 300
  tokenSafetySeconds: 300
  interactiveTimeoutMs: 8_000
  scheduledTimeoutMs: 30_000
  maxResponseBytes: 2_000_000
  scheduler: { audience: string; serviceAccountEmail: string } | null
  allocation: null | {
    projectId: string
    location: 'asia-southeast1'
    queueName: string
    workerUrl: string
    workerAudience: string
    taskInvokerEmail: string
    leaseBucket: string
    maxDetailsPerRun: 20
    continuationDelaySeconds: 60
  }
  financeCategoryMoneyEnabled: boolean
}

const ALLOWED_NAMES = new Set([
  'JERA_REPORTING_ENABLED', 'JERA_API_BASE_URL', 'JERA_DEFAULT_BRANCH_UUID',
  'JERA_SYNC_INTERVAL_MINUTES', 'JERA_API_USERNAME', 'JERA_API_PASSWORD',
  'JERA_SCHEDULER_AUDIENCE', 'JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL',
  'JERA_REVENUE_ALLOCATION_ENABLED', 'JERA_ALLOCATION_PROJECT_ID', 'JERA_ALLOCATION_LOCATION',
  'JERA_ALLOCATION_QUEUE', 'JERA_ALLOCATION_WORKER_URL', 'JERA_ALLOCATION_WORKER_AUDIENCE',
  'JERA_ALLOCATION_TASK_INVOKER_EMAIL', 'JERA_ALLOCATION_LEASE_BUCKET',
  'JERA_FINANCE_CATEGORY_MONEY_ENABLED',
])

type JeraEnvironment = Record<string, string | undefined>

export function readJeraConfig(environment: JeraEnvironment): JeraConfig | null {
  if (environment.JERA_REPORTING_ENABLED !== 'true') return null
  if (Object.keys(environment).some((name) => name.startsWith('JERA_') && !ALLOWED_NAMES.has(name))) return null

  const baseUrl = safeBaseUrl(environment.JERA_API_BASE_URL)
  const defaultBranchUuid = environment.JERA_DEFAULT_BRANCH_UUID?.trim() ?? ''
  const username = boundedSecret(environment.JERA_API_USERNAME)
  const password = boundedSecret(environment.JERA_API_PASSWORD)
  const syncIntervalMinutes = positiveInteger(environment.JERA_SYNC_INTERVAL_MINUTES)
  const scheduler = schedulerConfig(environment)
  const allocation = allocationConfig(environment)
  const financeCategoryMoneyEnabled = strictBoolean(environment.JERA_FINANCE_CATEGORY_MONEY_ENABLED)
  if (!baseUrl || !uuid(defaultBranchUuid) || !username || !password
    || syncIntervalMinutes === null || syncIntervalMinutes < 15 || syncIntervalMinutes > 60 || scheduler === undefined
    || allocation === undefined || financeCategoryMoneyEnabled === null
    || financeCategoryMoneyEnabled && allocation === null) return null

  return {
    enabled: true,
    baseUrl,
    defaultBranchUuid,
    apiUsername: new OpaqueSecret(username),
    apiPassword: new OpaqueSecret(password),
    syncIntervalMinutes,
    manualRefreshSeconds: 300,
    tokenSafetySeconds: 300,
    interactiveTimeoutMs: 8_000,
    scheduledTimeoutMs: 30_000,
    maxResponseBytes: 2_000_000,
    scheduler,
    allocation,
    financeCategoryMoneyEnabled,
  }
}

function allocationConfig(environment: JeraEnvironment): JeraConfig['allocation'] | undefined {
  const enabled = strictBoolean(environment.JERA_REVENUE_ALLOCATION_ENABLED)
  if (enabled === null) return undefined
  const names = [
    'JERA_ALLOCATION_PROJECT_ID', 'JERA_ALLOCATION_LOCATION', 'JERA_ALLOCATION_QUEUE',
    'JERA_ALLOCATION_WORKER_URL', 'JERA_ALLOCATION_WORKER_AUDIENCE',
    'JERA_ALLOCATION_TASK_INVOKER_EMAIL', 'JERA_ALLOCATION_LEASE_BUCKET',
  ] as const
  if (!enabled) return names.some((name) => Boolean(environment[name]?.trim())) ? undefined : null

  const projectId = environment.JERA_ALLOCATION_PROJECT_ID?.trim() ?? ''
  const location = environment.JERA_ALLOCATION_LOCATION?.trim() ?? ''
  const queueName = environment.JERA_ALLOCATION_QUEUE?.trim() ?? ''
  const workerUrl = safeHttpsUrl(environment.JERA_ALLOCATION_WORKER_URL, false)
  const workerAudience = safeHttpsUrl(environment.JERA_ALLOCATION_WORKER_AUDIENCE, true)
  const taskInvokerEmail = environment.JERA_ALLOCATION_TASK_INVOKER_EMAIL?.trim() ?? ''
  const leaseBucket = environment.JERA_ALLOCATION_LEASE_BUCKET?.trim() ?? ''
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || location !== 'asia-southeast1'
    || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(queueName) || !workerUrl || !workerAudience
    || !serviceAccountEmail(taskInvokerEmail) || !gcsBucketName(leaseBucket)) return undefined
  return {
    projectId, location, queueName, workerUrl, workerAudience, taskInvokerEmail, leaseBucket,
    maxDetailsPerRun: 20, continuationDelaySeconds: 60,
  }
}

function schedulerConfig(environment: JeraEnvironment): JeraConfig['scheduler'] | undefined {
  const audienceValue = environment.JERA_SCHEDULER_AUDIENCE?.trim() ?? ''
  const email = environment.JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL?.trim() ?? ''
  if (!audienceValue && !email) return null
  if (!audienceValue || !email || !/^[a-z0-9][a-z0-9._-]{2,62}@[a-z0-9-]{3,63}\.iam\.gserviceaccount\.com$/i.test(email)) return undefined
  try {
    const audience = new URL(audienceValue)
    if (audience.protocol !== 'https:' || audience.username || audience.password || audience.search || audience.hash) return undefined
    return { audience: audience.toString().replace(/\/$/, ''), serviceAccountEmail: email }
  } catch {
    return undefined
  }
}

function strictBoolean(value: string | undefined): boolean | null {
  if (value === undefined || value === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function safeHttpsUrl(value: string | undefined, originOnly: boolean): string | null {
  try {
    const parsed = new URL(value?.trim() ?? '')
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
      || originOnly && parsed.pathname !== '/' && parsed.pathname !== '') return null
    return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, '')
  } catch { return null }
}

function serviceAccountEmail(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,62}@[a-z0-9-]{3,63}\.iam\.gserviceaccount\.com$/i.test(value)
}

function gcsBucketName(value: string): boolean {
  return value.length >= 3 && value.length <= 63
    && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)
    && !/\.\./.test(value) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
    && !/^goog/i.test(value) && !/google/i.test(value)
}

function safeBaseUrl(value: string | undefined): string | null {
  try {
    const parsed = new URL(value?.trim() ?? '')
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
      || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) return null
    return parsed.origin
  } catch {
    return null
  }
}

function boundedSecret(value: string | undefined): string | null {
  const result = value?.trim() ?? ''
  return result.length > 0 && result.length <= 1_024 ? result : null
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const result = Number(value)
  return Number.isSafeInteger(result) && result > 0 ? result : null
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
