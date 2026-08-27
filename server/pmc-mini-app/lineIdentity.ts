import type { LineIdentityPort, MiniAppSafeErrorCode } from './contracts.js'

interface LineVerifyResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type LineVerifyFetch = (
  url: string,
  init: { method: 'POST'; headers: { 'content-type': string }; body: string },
) => Promise<LineVerifyResponse>

export interface LineIdentityClientOptions {
  channelId: string
  now?: () => number
  fetch?: LineVerifyFetch
}

export class MiniAppIdentityError extends Error {
  readonly code: Extract<MiniAppSafeErrorCode, 'MINI_APP_UNAUTHORIZED' | 'MINI_APP_ID_TOKEN_EXPIRED'>

  constructor(code: MiniAppIdentityError['code']) {
    super(`Mini App identity failed: ${code}`)
    this.name = 'MiniAppIdentityError'
    this.code = code
  }
}

const LINE_ID_TOKEN_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify'

export function createLineIdentityClient(options: LineIdentityClientOptions): LineIdentityPort {
  const channelId = options.channelId.trim()
  const request = options.fetch ?? (globalThis.fetch as unknown as LineVerifyFetch)
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))

  if (!/^\d+$/.test(channelId) || !request) throw new Error('Invalid Mini App LINE identity configuration')

  return {
    async verify(idToken) {
      if (!idToken || idToken.length > 8_192) throw new MiniAppIdentityError('MINI_APP_UNAUTHORIZED')

      let response: LineVerifyResponse
      try {
        response = await request(LINE_ID_TOKEN_VERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
        })
      } catch {
        throw new MiniAppIdentityError('MINI_APP_UNAUTHORIZED')
      }

      if (!response.ok) throw new MiniAppIdentityError('MINI_APP_UNAUTHORIZED')

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new MiniAppIdentityError('MINI_APP_UNAUTHORIZED')
      }

      if (!isVerifiedIdentity(body, channelId)) throw new MiniAppIdentityError('MINI_APP_UNAUTHORIZED')
      if (body.exp <= now()) throw new MiniAppIdentityError('MINI_APP_ID_TOKEN_EXPIRED')

      return { lineUserId: body.sub }
    },
  }
}

function isVerifiedIdentity(value: unknown, audience: string): value is { sub: string; aud: string; exp: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  return typeof body.sub === 'string'
    && /^[A-Za-z0-9_-]{2,128}$/.test(body.sub)
    && body.aud === audience
    && Number.isSafeInteger(body.exp)
}
