import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProductionRequestHandler, type ProductionAppDependencies } from '../../server/productionApp'
import { createOcrLedgerRuntime } from '../../server/ocr-ledger/runtime'

type Middleware = (req: IncomingMessage, res: ServerResponse) => Promise<void>

let distDir = ''

beforeEach(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'pmc-production-app-'))
  await mkdir(join(distDir, 'assets'), { recursive: true })
  await mkdir(join(distDir, 'ocr-review', 'assets'), { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>private main app</main>')
  await writeFile(join(distDir, 'assets', 'main-123.js'), 'private main asset')
  await writeFile(join(distDir, 'ocr-review', 'index.html'), '<main>static OCR review shell</main>')
  await writeFile(join(distDir, 'ocr-review', 'assets', 'review-123.js'), 'static review asset')
})

afterEach(async () => {
  if (distDir) await rm(distDir, { recursive: true, force: true })
})

describe('production OCR ledger route isolation', () => {
  it('keeps health public', async () => {
    const response = await invoke(handler())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('delegates the existing booking webhook independently of OCR failures', async () => {
    const booking: Middleware = async (_req, res) => {
      res.statusCode = 202
      res.end('booking unchanged')
    }
    const ocrLedger: Middleware = async () => { throw new Error('OCR failed') }
    const requestHandler = handler({ bookingLineWebhook: booking, ocrLedger })

    const before = await invoke(requestHandler, '/api/booking-line/webhook', { method: 'POST' })
    const ocrFailure = await invoke(requestHandler, '/api/ocr-ledger/webhook', { method: 'POST' })
    const after = await invoke(requestHandler, '/api/booking-line/webhook', { method: 'POST' })

    expect({ status: before.status, body: await before.text() }).toEqual({ status: 202, body: 'booking unchanged' })
    expect(ocrFailure.status).toBe(500)
    expect({ status: after.status, body: await after.text() }).toEqual({ status: 202, body: 'booking unchanged' })
  })

  it('exposes the OCR webhook only through its LINE-signature-protected middleware', async () => {
    const ocrLedger: Middleware = async (req, res) => {
      if (req.headers['x-line-signature'] !== 'valid-line-hmac') {
        res.statusCode = 401
        res.end('invalid signature')
        return
      }
      res.statusCode = 200
      res.end('accepted')
    }
    const requestHandler = handler({ ocrLedger })

    const rejected = await invoke(requestHandler, '/api/ocr-ledger/webhook', { method: 'POST' })
    const accepted = await invoke(requestHandler, '/api/ocr-ledger/webhook', {
      method: 'POST', headers: { 'x-line-signature': 'valid-line-hmac' },
    })

    expect({ status: rejected.status, body: await rejected.text() }).toEqual({ status: 401, body: 'invalid signature' })
    expect({ status: accepted.status, body: await accepted.text() }).toEqual({ status: 200, body: 'accepted' })
  })

  it('delegates review, image, and client config to the LIFF middleware before Basic Auth', async () => {
    const ocrLedger: Middleware = async (req, res) => {
      if (req.url?.startsWith('/api/ocr-ledger/client-config')) {
        res.end(JSON.stringify({ liffId: 'test-liff' }))
        return
      }
      if (req.headers.authorization !== 'Bearer valid-id-token') {
        res.statusCode = 401
        res.end('LINE identity required')
        return
      }
      res.end(req.url?.startsWith('/api/ocr-ledger/image') ? 'private image' : 'review projection')
    }
    const requestHandler = handler({ ocrLedger })

    const rejectedReview = await invoke(requestHandler, '/api/ocr-ledger/review?t=signed')
    const acceptedReview = await invoke(requestHandler, '/api/ocr-ledger/review?t=signed', {
      headers: { authorization: 'Bearer valid-id-token' },
    })
    const acceptedImage = await invoke(requestHandler, '/api/ocr-ledger/image?t=signed', {
      headers: { authorization: 'Bearer valid-id-token' },
    })
    const clientConfig = await invoke(requestHandler, '/api/ocr-ledger/client-config')

    expect(rejectedReview.status).toBe(401)
    expect(await acceptedReview.text()).toBe('review projection')
    expect(await acceptedImage.text()).toBe('private image')
    expect(await clientConfig.json()).toEqual({ liffId: 'test-liff' })
  })

  it('serves only the OCR review bundle publicly and never injects request document data', async () => {
    const requestHandler = handler()

    const page = await invoke(requestHandler, '/ocr-review/?documentId=private-document-1')
    const asset = await invoke(requestHandler, '/ocr-review/assets/review-123.js')
    const mainPage = await invoke(requestHandler, '/')
    const mainAsset = await invoke(requestHandler, '/assets/main-123.js')
    const similarPrefix = await invoke(requestHandler, '/ocr-review-private')

    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<main>static OCR review shell</main>')
    expect((await invoke(requestHandler, '/ocr-review')).status).toBe(200)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await asset.text()).toBe('static review asset')
    expect(mainPage.status).toBe(401)
    expect(mainAsset.status).toBe(401)
    expect(similarPrefix.status).toBe(401)
  })

  it('keeps unrelated app and API routes behind the existing Basic Auth boundary', async () => {
    const metaApi: Middleware = async (_req, res) => { res.end('meta') }
    const requestHandler = handler({ metaApi })

    const unauthorizedApi = await invoke(requestHandler, '/api/meta/status')
    const authorizedApi = await invoke(requestHandler, '/api/meta/status', {
      headers: { authorization: basicAuth('pmc', 'legacy-secret') },
    })
    const authorizedApp = await invoke(requestHandler, '/', {
      headers: { authorization: basicAuth('pmc', 'legacy-secret') },
    })

    expect(unauthorizedApi.status).toBe(401)
    expect(unauthorizedApi.headers.get('www-authenticate')).toContain('PMC Ads Agent')
    expect(await authorizedApi.text()).toBe('meta')
    expect(await authorizedApp.text()).toBe('<main>private main app</main>')
  })

  it('returns 503 only for OCR routes when OCR configuration is absent and blocks traversal', async () => {
    const requestHandler = handler({ ocrLedger: undefined })

    const missingOcr = await invoke(requestHandler, '/api/ocr-ledger/review?t=signed')
    const unrelated = await invoke(requestHandler, '/api/meta/status')
    const normalizedTraversal = await invoke(requestHandler, '/ocr-review/%2e%2e/index.html')
    const encodedTraversal = await invoke(requestHandler, '/ocr-review/%252e%252e/index.html')

    expect({ status: missingOcr.status, body: await missingOcr.json() }).toEqual({
      status: 503, body: { error: 'OCR ledger is not configured' },
    })
    expect(unrelated.status).toBe(401)
    expect(normalizedTraversal.status).toBe(401)
    expect(encodedTraversal.status).toBe(404)
    expect(await encodedTraversal.text()).toBe('Not found')
  })

  it('keeps health, Booking, and legacy routes available when OCR numeric config is unsafe', async () => {
    const ocrLedger = createOcrLedgerRuntime({
      ...validOcrEnvironment(),
      OCR_MAX_IMAGE_BYTES: '9007199254740992',
    })
    const booking: Middleware = async (_req, res) => { res.statusCode = 202; res.end('booking available') }
    const metaApi: Middleware = async (_req, res) => { res.end('meta available') }
    const requestHandler = handler({ ocrLedger, bookingLineWebhook: booking, metaApi })

    const health = await invoke(requestHandler)
    const bookingResponse = await invoke(requestHandler, '/api/booking-line/webhook', { method: 'POST' })
    const ocrResponse = await invoke(requestHandler, '/api/ocr-ledger/webhook', { method: 'POST' })
    const main = await invoke(requestHandler, '/', {
      headers: { authorization: basicAuth('pmc', 'legacy-secret') },
    })
    const unrelated = await invoke(requestHandler, '/api/meta/status', {
      headers: { authorization: basicAuth('pmc', 'legacy-secret') },
    })

    expect({ status: health.status, body: await health.json() }).toEqual({ status: 200, body: { ok: true } })
    expect({ status: bookingResponse.status, body: await bookingResponse.text() }).toEqual({
      status: 202, body: 'booking available',
    })
    expect({ status: ocrResponse.status, body: await ocrResponse.json() }).toEqual({
      status: 503, body: { error: 'OCR ledger is not configured' },
    })
    expect({ status: main.status, body: await main.text() }).toEqual({
      status: 200, body: '<main>private main app</main>',
    })
    expect({ status: unrelated.status, body: await unrelated.text() }).toEqual({
      status: 200, body: 'meta available',
    })
  })

  it('fails closed when an OCR dependency constructor throws', () => {
    const ocrLedger = createOcrLedgerRuntime(validOcrEnvironment(), () => {
      throw new Error('constructor failed')
    })

    expect(ocrLedger).toBeUndefined()
  })
})

function handler(overrides: Partial<ProductionAppDependencies> = {}) {
  const noContent: Middleware = async (_req, res) => { res.statusCode = 204; res.end('') }
  return createProductionRequestHandler({
    distDir,
    basicAuthUser: 'pmc',
    basicAuthPassword: 'legacy-secret',
    allowUnauthenticated: false,
    bookingLineWebhook: noContent,
    ocrLedger: noContent,
    metaApi: noContent,
    openAiApi: noContent,
    pageAutomationApi: noContent,
    ...overrides,
  })
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path = '/healthz',
  init: RequestInit = {},
): Promise<Response> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

function validOcrEnvironment(): NodeJS.ProcessEnv {
  return {
    OCR_LINE_CHANNEL_SECRET: 'test-secret', OCR_LINE_CHANNEL_ACCESS_TOKEN: 'test-token', OCR_ALLOWED_GROUP_ID: 'Ctest',
    OCR_MASTER_SPREADSHEET_ID: 'test-sheet', OCR_DRIVE_ROOT_ID: 'test-drive', OCR_MONTHLY_LEDGERS_FOLDER_ID: 'test-monthly-folder', OCR_LIFF_ID: 'test-liff', OCR_LIFF_CHANNEL_ID: 'test-channel',
    OCR_REVIEW_SIGNING_SECRET: 'test-signing', OPENAI_API_KEY: 'test-openai', OPENAI_OCR_MODEL: 'test-model',
    OCR_GOOGLE_CLIENT_ID: 'test-client', OCR_GOOGLE_CLIENT_SECRET: 'test-client-secret', OCR_GOOGLE_REFRESH_TOKEN: 'test-refresh',
    OCR_DAILY_REPORT_ENABLED: 'false', OCR_DAILY_REPORT_TIME: '20:00', OCR_TIMEZONE: 'Asia/Bangkok',
    OCR_WORKER_BATCH_SIZE: '1', OCR_MAX_IMAGE_BYTES: '1000', OCR_OPENAI_MAX_OUTPUT_TOKENS: '1000',
  }
}
