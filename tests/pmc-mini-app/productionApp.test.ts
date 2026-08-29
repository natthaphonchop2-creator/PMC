import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPmcMiniAppRuntime } from '../../server/pmc-mini-app/runtime'
import { createProductionRequestHandler, type ProductionAppDependencies } from '../../server/productionApp'

type Middleware = (req: IncomingMessage, res: ServerResponse) => Promise<void>
let distDir = ''

beforeEach(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'pmc-mini-app-production-'))
  await mkdir(join(distDir, 'assets'), { recursive: true })
  await mkdir(join(distDir, 'mini-app', 'assets'), { recursive: true })
  await mkdir(join(distDir, 'ocr-review', 'assets'), { recursive: true })
  await writeFile(join(distDir, 'index.html'), '<main>private dashboard</main>')
  await writeFile(join(distDir, 'mini-app', 'index.html'), '<main>PMC Mini App shell</main>')
  await writeFile(join(distDir, 'mini-app', 'assets', 'mini-123.js'), 'mini app asset')
  await writeFile(join(distDir, 'ocr-review', 'index.html'), '<main>OCR shell</main>')
})

afterEach(async () => {
  if (distDir) await rm(distDir, { recursive: true, force: true })
})

describe('production PMC Mini App route isolation', () => {
  it('keeps Booking, OCR, health, and legacy routes available when Mini App config is absent', async () => {
    const app = handler({ pmcMiniApp: undefined })

    expect((await invoke(app, '/api/mini-app/session')).status).toBe(503)
    expect((await invoke(app, '/internal/mini-app/jera-allocation-worker', { method: 'POST' })).status).toBe(503)
    expect((await invoke(app, '/internal/mini-app/finance-daily-seed', { method: 'POST' })).status).toBe(503)
    expect((await invoke(app, '/healthz')).status).toBe(200)
    expect((await invoke(app, '/api/healthz')).status).toBe(200)
    expect((await invoke(app, '/api/booking-line/webhook', { method: 'POST' })).status).not.toBe(503)
    expect((await invoke(app, '/api/ocr-ledger/client-config')).status).not.toBe(503)
    expect((await invoke(app, '/')).status).toBe(401)
  })

  it('serves only the Mini App bundle publicly before legacy Basic Auth', async () => {
    const app = handler()
    const page = await invoke(app, '/mini-app/?customerName=private-customer')
    const asset = await invoke(app, '/mini-app/assets/mini-123.js')
    const pageText = await page.text()

    expect(page.status).toBe(200)
    expect(pageText).toBe('<main>PMC Mini App shell</main>')
    expect((await invoke(app, '/mini-app')).status).toBe(200)
    expect(await asset.text()).toBe('mini app asset')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(pageText).not.toContain('private-customer')
    expect((await invoke(app, '/mini-app-private')).status).toBe(401)
  })

  it('delegates Mini App APIs without legacy Basic Auth and isolates middleware failures', async () => {
    const pmcMiniApp: Middleware = async (req, res) => {
      if (req.url?.includes('explode')) throw new Error('private middleware detail')
      res.statusCode = req.headers.authorization === 'Bearer valid-token' ? 200 : 401
      res.end(JSON.stringify({ route: 'mini-app' }))
    }
    const app = handler({ pmcMiniApp })

    const rejected = await invoke(app, '/api/mini-app/session')
    const accepted = await invoke(app, '/api/mini-app/session', { headers: { authorization: 'Bearer valid-token' } })
    const internal = await invoke(app, '/internal/mini-app/jera-sync?mode=current', { method: 'POST', headers: { authorization: 'Bearer valid-token' } })
    const allocation = await invoke(app, '/internal/mini-app/jera-allocation-worker', { method: 'POST', headers: { authorization: 'Bearer valid-token' } })
    const financeSeed = await invoke(app, '/internal/mini-app/finance-daily-seed', { method: 'POST', headers: { authorization: 'Bearer valid-token' } })
    const worker = await invoke(app, '/internal/mini-app/finalize-booking', { method: 'POST', headers: { authorization: 'Bearer valid-token' } })
    const failed = await invoke(app, '/api/mini-app/explode')
    const health = await invoke(app, '/healthz')

    expect(rejected.status).toBe(401)
    expect(accepted.status).toBe(200)
    expect(internal.status).toBe(200)
    expect(allocation.status).toBe(200)
    expect(financeSeed.status).toBe(200)
    expect(worker.status).toBe(200)
    expect({ status: failed.status, body: await failed.json() }).toEqual({ status: 500, body: { error: 'Mini App route failed' } })
    expect(health.status).toBe(200)
  })

  it('keeps only the exact allocation worker route outside Basic Auth and static fallback', async () => {
    const pmcMiniApp = vi.fn<Middleware>(async (_req, res) => { res.statusCode = 204; res.end() })
    const app = handler({ pmcMiniApp })

    const exact = await invokeRaw(app, '/internal/mini-app/jera-allocation-worker', { method: 'POST' })
    const query = await invokeRaw(app, '/internal/mini-app/jera-allocation-worker?cursor=0', { method: 'POST' })
    const suffix = await invokeRaw(app, '/internal/mini-app/jera-allocation-worker/retry', { method: 'POST' })

    expect(exact.status).toBe(204)
    expect(exact.headers.get('www-authenticate')).toBeNull()
    expect(query.status).toBe(401)
    expect(suffix.status).toBe(401)
    expect(pmcMiniApp).toHaveBeenCalledOnce()
  })

  it('keeps only the exact finance daily seed route outside Basic Auth and static fallback', async () => {
    const pmcMiniApp = vi.fn<Middleware>(async (_req, res) => { res.statusCode = 204; res.end() })
    const app = handler({ pmcMiniApp })

    const exact = await invokeRaw(app, '/internal/mini-app/finance-daily-seed', { method: 'POST' })
    const query = await invokeRaw(app, '/internal/mini-app/finance-daily-seed?date=2026-08-29', { method: 'POST' })
    const suffix = await invokeRaw(app, '/internal/mini-app/finance-daily-seed/retry', { method: 'POST' })

    expect(exact.status).toBe(204)
    expect(exact.headers.get('www-authenticate')).toBeNull()
    expect(query.status).toBe(401)
    expect(suffix.status).toBe(401)
    expect(pmcMiniApp).toHaveBeenCalledOnce()
  })

  it.each([
    ['dot segment', '/internal/mini-app/x/../finalize-booking'],
    ['encoded dot segment', '/internal/mini-app/%2e/finalize-booking'],
    ['encoded parent segment', '/internal/mini-app/x/%2e%2e/finalize-booking'],
    ['encoded slash', '/internal/mini-app/finalize-booking%2fretry'],
    ['duplicate slash', '/internal/mini-app//finalize-booking'],
    ['bare query marker', '/internal/mini-app/finalize-booking?'],
    ['query', '/internal/mini-app/finalize-booking?x=1'],
    ['suffix', '/internal/mini-app/finalize-booking/retry'],
    ['prefix', '/prefix/internal/mini-app/finalize-booking'],
    ['absolute-form target', 'http://localhost/internal/mini-app/finalize-booking'],
    ['bare fragment-like marker', '/internal/mini-app/finalize-booking#'],
    ['fragment-like suffix', '/internal/mini-app/finalize-booking#x'],
  ])('keeps a non-exact raw worker target with a %s behind legacy Basic Auth', async (_label, path) => {
    const pmcMiniApp = vi.fn<Middleware>(async (_req, res) => { res.statusCode = 204; res.end() })
    const response = await invokeRaw(handler({ pmcMiniApp }), path, {
      method: 'POST',
      headers: { authorization: 'Bearer valid-worker-token' },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="PMC Ads Agent", charset="UTF-8"')
    expect(pmcMiniApp).not.toHaveBeenCalled()
  })

  it('delegates only the exact raw worker target, including wrong methods, without legacy Basic Auth', async () => {
    const pmcMiniApp = vi.fn<Middleware>(async (req, res) => {
      res.statusCode = req.method === 'POST' ? 401 : 405
      res.end(JSON.stringify({ error: req.method === 'POST' ? 'ASYNC_WORKER_UNAUTHORIZED' : 'MINI_APP_METHOD_NOT_ALLOWED' }))
    })
    const app = handler({ pmcMiniApp })
    const exact = await invokeRaw(app, '/internal/mini-app/finalize-booking', {
      method: 'POST', headers: { authorization: 'Bearer rejected-token' },
    })
    const wrongMethod = await invokeRaw(app, '/internal/mini-app/finalize-booking', { method: 'GET' })

    expect({ status: exact.status, body: await exact.json() }).toEqual({
      status: 401,
      body: { error: 'ASYNC_WORKER_UNAUTHORIZED' },
    })
    expect(exact.headers.get('www-authenticate')).toBeNull()
    expect({ status: wrongMethod.status, body: await wrongMethod.json() }).toEqual({
      status: 405,
      body: { error: 'MINI_APP_METHOD_NOT_ALLOWED' },
    })
    expect(wrongMethod.headers.get('www-authenticate')).toBeNull()
    expect(pmcMiniApp).toHaveBeenCalledTimes(2)
  })

  it('rejects Mini App static mutations and traversal without exposing other bundles', async () => {
    const app = handler()

    expect((await invoke(app, '/mini-app/', { method: 'POST' })).status).toBe(405)
    expect((await invoke(app, '/mini-app/%252e%252e/index.html')).status).toBe(404)
    expect((await invoke(app, '/mini-app/%2e%2e/index.html')).status).toBe(401)
  })

  it('constructs independently and fails closed for disabled, invalid, or throwing runtime setup', () => {
    const middleware: Middleware = async (_req, res) => { res.end('mini') }
    const construct = vi.fn(() => middleware)

    expect(createPmcMiniAppRuntime(validEnvironment(), construct)).toBe(middleware)
    expect(construct).toHaveBeenCalledOnce()
    expect(createPmcMiniAppRuntime({ PMC_MINI_APP_ENABLED: 'false' }, construct)).toBeUndefined()
    expect(createPmcMiniAppRuntime({ ...validEnvironment(), PMC_BOOKING_INGRESS_URL: 'http://unsafe.test' }, construct)).toBeUndefined()
    expect(createPmcMiniAppRuntime(validEnvironment(), () => { throw new Error('constructor detail') })).toBeUndefined()
  })

  it('constructs the Mini App runtime with the live-compatible async owner staff ID', () => {
    const middleware: Middleware = async (_req, res) => { res.end('mini') }
    const construct = vi.fn(() => middleware)

    expect(createPmcMiniAppRuntime({
      ...validEnvironment(),
      ...validAsyncEnvironment(),
    }, construct)).toBe(middleware)
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({
      asyncBooking: expect.objectContaining({
        ownerStaffIds: new Set(['shared-account-test']),
      }),
    }), expect.any(Object))
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
    pmcMiniApp: noContent,
    metaApi: noContent,
    openAiApi: noContent,
    pageAutomationApi: noContent,
    ...overrides,
  })
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    const body = await response.arrayBuffer()
    return new Response(response.status === 204 || response.status === 304 ? null : body, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function invokeRaw(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: { method: string; headers?: Record<string, string> },
): Promise<Response> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    return await new Promise<Response>((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        method: init.method,
        path,
        headers: init.headers,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const status = response.statusCode ?? 500
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), {
            status,
            headers: response.headers as Record<string, string>,
          }))
        })
      })
      request.on('error', reject)
      request.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_MINI_APP_ENABLED: 'true', PMC_MINI_APP_ID: '2001234567-mini-app', PMC_MINI_APP_LIFF_CHANNEL_ID: '2001234567',
    PMC_SPREADSHEET_ID: 'sheet-1', PMC_DRIVE_INTAKE_FOLDER_ID: 'folder-1',
    PMC_BOOKING_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_BOOKING_FALLBACK_FORM_URL: 'https://docs.google.com/forms/d/e/form-id/viewform',
    PMC_BOOKING_INGRESS_SECRET: 'ingress-secret', PMC_MINI_APP_SIGNING_SECRET: 'signing-secret',
  }
}

function validAsyncEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_MINI_APP_ASYNC_ENABLED: 'true',
    PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
    PMC_ASYNC_LOCATION: 'asia-southeast1',
    PMC_ASYNC_BUCKET: 'pmc-mini-app-evidence-staging',
    PMC_ASYNC_QUEUE: 'pmc-booking-finalize',
    PMC_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking',
    PMC_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
    PMC_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
    PMC_ASYNC_OWNER_STAFF_IDS: 'shared-account-test',
  }
}
