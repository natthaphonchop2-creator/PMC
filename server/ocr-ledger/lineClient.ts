export interface OcrLinePort {
  downloadImage(messageId: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
  reply(replyToken: string, messages: unknown[]): Promise<void>
  push(to: string, messages: unknown[]): Promise<void>
  verifyLiffIdToken(idToken: string): Promise<{ userId: string }>
  assertGroupMember(groupId: string, userId: string): Promise<{ displayName: string }>
  validatePush(messages: unknown[]): Promise<void>
}

interface LineResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

type LineFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<LineResponse>

export interface OcrLineClientOptions {
  channelAccessToken: string
  liffChannelId: string
  maxImageBytes: number
  now?: () => number
  fetch?: LineFetch
}

export class OcrLineClientError extends Error {
  readonly code: string

  constructor(code: string) {
    super(safeMessage(code))
    this.name = 'OcrLineClientError'
    this.code = code
  }
}

const DATA_API = 'https://api-data.line.me/v2/bot'
const MESSAGING_API = 'https://api.line.me/v2/bot'
const LIFF_VERIFY_API = 'https://api.line.me/oauth2/v2.1/verify'

export function createOcrLineClient(options: OcrLineClientOptions): OcrLinePort {
  const fetch = options.fetch ?? (globalThis.fetch as unknown as LineFetch)
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  if (!fetch || !options.channelAccessToken || !options.liffChannelId || !Number.isSafeInteger(options.maxImageBytes) || options.maxImageBytes <= 0) {
    throw new Error('Invalid OCR LINE client configuration')
  }
  const bearerHeaders = { authorization: `Bearer ${options.channelAccessToken}` }

  async function assertGroupMember(groupId: string, userId: string): Promise<{ displayName: string }> {
    const response = await request(fetch, `${MESSAGING_API}/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, { headers: bearerHeaders }, 'LINE_GROUP_MEMBER_FAILED')
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) throw new OcrLineClientError('LINE_GROUP_MEMBERSHIP_REQUIRED')
      throw new OcrLineClientError('LINE_GROUP_MEMBER_FAILED')
    }
    const body = await safeJson(response, 'LINE_GROUP_MEMBER_FAILED')
    if (!isRecord(body) || typeof body.displayName !== 'string' || !body.displayName.trim()) throw new OcrLineClientError('LINE_GROUP_MEMBER_FAILED')
    return { displayName: body.displayName }
  }

  return {
    async downloadImage(messageId) {
      const response = await request(fetch, `${DATA_API}/message/${encodeURIComponent(messageId)}/content`, { headers: bearerHeaders }, 'LINE_DOWNLOAD_FAILED')
      if (!response.ok) throw new OcrLineClientError('LINE_DOWNLOAD_FAILED')
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase()
      if (contentType !== 'image/jpeg' && contentType !== 'image/png') throw new OcrLineClientError('LINE_IMAGE_CONTENT_TYPE')
      const advertisedLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(advertisedLength) && advertisedLength > options.maxImageBytes) throw new OcrLineClientError('LINE_IMAGE_TOO_LARGE')
      let bytes: Buffer
      try {
        bytes = Buffer.from(await response.arrayBuffer())
      } catch {
        throw new OcrLineClientError('LINE_DOWNLOAD_FAILED')
      }
      if (bytes.byteLength > options.maxImageBytes) throw new OcrLineClientError('LINE_IMAGE_TOO_LARGE')
      return { bytes, mimeType: contentType }
    },

    async reply(replyToken, messages) {
      await postJson(fetch, `${MESSAGING_API}/message/reply`, { replyToken, messages }, bearerHeaders, 'LINE_REPLY_FAILED')
    },

    async push(to, messages) {
      await postJson(fetch, `${MESSAGING_API}/message/push`, { to, messages }, bearerHeaders, 'LINE_PUSH_FAILED')
    },

    async verifyLiffIdToken(idToken) {
      const body = new URLSearchParams({ id_token: idToken, client_id: options.liffChannelId }).toString()
      const response = await request(fetch, LIFF_VERIFY_API, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, 'LINE_LIFF_ID_TOKEN_INVALID')
      if (!response.ok) throw new OcrLineClientError('LINE_LIFF_ID_TOKEN_INVALID')
      const verified = await safeJson(response, 'LINE_LIFF_ID_TOKEN_INVALID')
      if (!isVerifiedLiffToken(verified, options.liffChannelId)) {
        throw new OcrLineClientError('LINE_LIFF_ID_TOKEN_INVALID')
      }
      if (verified.exp <= now()) throw new OcrLineClientError('LINE_LIFF_ID_TOKEN_EXPIRED')
      return { userId: verified.sub }
    },

    assertGroupMember,

    async validatePush(messages) {
      await postJson(fetch, `${MESSAGING_API}/message/validate/push`, { messages }, bearerHeaders, 'LINE_PUSH_VALIDATION_FAILED')
    },
  }

}

async function postJson(fetch: LineFetch, url: string, body: unknown, headers: Record<string, string>, code: string): Promise<void> {
  const response = await request(fetch, url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, code)
  if (!response.ok) throw new OcrLineClientError(code)
}

async function request(fetch: LineFetch, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, code: string): Promise<LineResponse> {
  try {
    return await fetch(url, init)
  } catch {
    throw new OcrLineClientError(code)
  }
}

async function safeJson(response: LineResponse, code: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new OcrLineClientError(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVerifiedLiffToken(value: unknown, audience: string): value is { sub: string; aud: string; exp: number } {
  return isRecord(value)
    && typeof value.sub === 'string' && value.sub.length > 0
    && value.aud === audience
    && Number.isSafeInteger(value.exp)
}

function safeMessage(code: string): string {
  return `LINE request failed: ${code}`
}
