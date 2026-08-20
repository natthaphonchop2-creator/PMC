import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface WebhookInput {
  rawBody: string
  signature: string
}

export interface ForwardPayload {
  timestamp: number
  nonce: string
  sourceType: 'user' | 'group'
  sourceId: string
  signature: string
}

interface HandlerConfig {
  lineChannelSecret: string
  ingressSecret: string
  forward: (payload: ForwardPayload) => Promise<void> | void
  now?: () => number
  nonce?: () => string
}

export function signLineBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64')
}

function signIngress(payload: Omit<ForwardPayload, 'signature'>, secret: string): string {
  const canonical = `${payload.timestamp}.${payload.nonce}.${payload.sourceType}.${payload.sourceId}`
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function signaturesMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sourceIds(rawBody: string): Array<{ sourceType: 'user' | 'group'; sourceId: string }> {
  const parsed = JSON.parse(rawBody) as { events?: unknown[] }
  const result = new Map<string, { sourceType: 'user' | 'group'; sourceId: string }>()
  for (const event of parsed.events ?? []) {
    if (!event || typeof event !== 'object') continue
    const source = (event as { source?: unknown }).source
    if (!source || typeof source !== 'object') continue
    const typed = source as { type?: unknown; groupId?: unknown; userId?: unknown }
    if (typed.type === 'group' && typeof typed.groupId === 'string') {
      result.set(`group:${typed.groupId}`, { sourceType: 'group', sourceId: typed.groupId })
    }
    if (typeof typed.userId === 'string') {
      result.set(`user:${typed.userId}`, { sourceType: 'user', sourceId: typed.userId })
    }
  }
  return [...result.values()]
}

export function createBookingLineWebhookHandler(config: HandlerConfig) {
  return async (input: WebhookInput): Promise<{ status: number; body: string }> => {
    if (!signaturesMatch(input.signature, signLineBody(input.rawBody, config.lineChannelSecret))) {
      return { status: 401, body: JSON.stringify({ error: 'Invalid LINE signature' }) }
    }

    let sources: Array<{ sourceType: 'user' | 'group'; sourceId: string }>
    try {
      sources = sourceIds(input.rawBody)
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'Invalid LINE JSON' }) }
    }

    const timestamp = (config.now ?? (() => Math.floor(Date.now() / 1000)))()
    const nonce = config.nonce ?? randomUUID
    for (const source of sources) {
      const unsigned = { timestamp, nonce: nonce(), ...source }
      await config.forward({ ...unsigned, signature: signIngress(unsigned, config.ingressSecret) })
    }
    return { status: 200, body: JSON.stringify({ ok: true }) }
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new Error('LINE webhook body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createBookingLineWebhookMiddleware(env: NodeJS.ProcessEnv) {
  const lineChannelSecret = env.BOOKING_LINE_CHANNEL_SECRET ?? ''
  const ingressSecret = env.BOOKING_INGRESS_SECRET ?? ''
  const ingressUrl = env.BOOKING_APPS_SCRIPT_INGRESS_URL ?? ''

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!lineChannelSecret || !ingressSecret || !ingressUrl) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'Booking LINE webhook is not configured' }))
      return
    }
    const rawBody = await readRawBody(req)
    const signatureHeader = req.headers['x-line-signature']
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] ?? '' : signatureHeader ?? ''
    const handler = createBookingLineWebhookHandler({
      lineChannelSecret,
      ingressSecret,
      async forward(payload) {
        const response = await fetch(ingressUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error(`Booking ingress failed with status ${response.status}`)
      },
    })
    const result = await handler({ rawBody, signature })
    res.statusCode = result.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(result.body)
  }
}
