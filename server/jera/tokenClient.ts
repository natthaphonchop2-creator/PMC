import type { JeraConfig } from './config.js'

export interface JeraTokenPort {
  getAccessToken(): Promise<string>
  invalidate(): void
}

interface TokenResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

type TokenFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { authorization: string; 'content-type': 'application/x-www-form-urlencoded' }
    body: 'grant_type=client_credentials'
    signal: AbortSignal
  },
) => Promise<TokenResponse>

export class JeraTokenError extends Error {
  readonly code: 'JERA_TOKEN_TIMEOUT' | 'JERA_AUTH_FAILED' | 'JERA_TOKEN_RESPONSE_INVALID'

  constructor(code: JeraTokenError['code']) {
    super(`JERA token request failed: ${code}`)
    this.name = 'JeraTokenError'
    this.code = code
  }
}

export function createJeraTokenClient(config: JeraConfig, options: {
  fetch?: TokenFetch
  now?: () => number
  timeoutMs?: number
} = {}): JeraTokenPort {
  const request = options.fetch ?? (globalThis.fetch as unknown as TokenFetch)
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const timeoutMs = options.timeoutMs ?? config.interactiveTimeoutMs
  if (!request || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Invalid JERA token client configuration')
  }

  let cachedToken: string | null = null
  let expiresAt = 0
  let inFlight: Promise<string> | null = null

  async function requestToken(): Promise<string> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      let response: TokenResponse
      try {
        response = await request(`${config.baseUrl}/openapi/v1/token/`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${config.apiUsername.reveal()}:${config.apiPassword.reveal()}`, 'utf8').toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
          signal: controller.signal,
        })
      } catch {
        if (timedOut) throw new JeraTokenError('JERA_TOKEN_TIMEOUT')
        throw new JeraTokenError('JERA_AUTH_FAILED')
      }
      if (!response.ok) throw new JeraTokenError('JERA_AUTH_FAILED')
      const parsed = await boundedJson(response)
      if (!isTokenPayload(parsed)) throw new JeraTokenError('JERA_TOKEN_RESPONSE_INVALID')
      const lifetime = Math.min(parsed.expires_in, 36_000)
      cachedToken = parsed.access_token
      expiresAt = now() + lifetime - config.tokenSafetySeconds
      return parsed.access_token
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    getAccessToken() {
      if (cachedToken && now() < expiresAt) return Promise.resolve(cachedToken)
      if (inFlight) return inFlight
      inFlight = requestToken().finally(() => { inFlight = null })
      return inFlight
    },
    invalidate() {
      cachedToken = null
      expiresAt = 0
    },
  }
}

async function boundedJson(response: TokenResponse): Promise<unknown> {
  const advertisedLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertisedLength) && advertisedLength > 64 * 1024) throw new JeraTokenError('JERA_TOKEN_RESPONSE_INVALID')
  let bytes: Buffer
  try { bytes = Buffer.from(await response.arrayBuffer()) } catch { throw new JeraTokenError('JERA_TOKEN_RESPONSE_INVALID') }
  if (bytes.length === 0 || bytes.length > 64 * 1024) throw new JeraTokenError('JERA_TOKEN_RESPONSE_INVALID')
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new JeraTokenError('JERA_TOKEN_RESPONSE_INVALID') }
}

function isTokenPayload(value: unknown): value is { access_token: string; expires_in: number; token_type: string; scope?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return typeof payload.access_token === 'string'
    && payload.access_token.length >= 6
    && payload.access_token.length <= 8_192
    && !/\s/.test(payload.access_token)
    && Number.isSafeInteger(payload.expires_in)
    && Number(payload.expires_in) > 0
    && payload.token_type === 'Bearer'
    && (payload.scope === undefined || typeof payload.scope === 'string')
}
