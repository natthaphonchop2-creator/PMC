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
}

const ALLOWED_NAMES = new Set([
  'JERA_REPORTING_ENABLED', 'JERA_API_BASE_URL', 'JERA_DEFAULT_BRANCH_UUID',
  'JERA_SYNC_INTERVAL_MINUTES', 'JERA_API_USERNAME', 'JERA_API_PASSWORD',
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
  if (!baseUrl || !uuid(defaultBranchUuid) || !username || !password
    || syncIntervalMinutes === null || syncIntervalMinutes < 15 || syncIntervalMinutes > 60) return null

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
  }
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
