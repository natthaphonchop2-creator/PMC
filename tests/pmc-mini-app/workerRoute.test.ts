import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import {
  createPmcMiniAppMiddleware,
  type PmcMiniAppMiddlewareDependencies,
} from '../../server/pmc-mini-app/middleware'
import {
  type MiniAppStore,
} from '../../server/pmc-mini-app/store'
import type { WorkerIdentityVerifier } from '../../server/pmc-mini-app/workerAuth'
import type { AsyncBookingWorker } from '../../server/pmc-mini-app/asyncWorker'

const route = '/internal/mini-app/finalize-booking'
const fixedNow = new Date('2026-08-28T02:01:00.000Z')

describe('PMC async worker route', () => {
  it('authenticates OIDC before validating the task header, parsing the body, or touching the store', async () => {
    const workerIdentity: WorkerIdentityVerifier = {
      verify: vi.fn(async () => { throw new Error('private identity detail') }),
    }
    const finalize = vi.fn()
    const store = inaccessibleStore()
    const response = await invoke(createPmcMiniAppMiddleware(dependencies({ workerIdentity, asyncWorker: { finalize }, store })), route, {
      method: 'POST',
      headers: { authorization: 'Bearer rejected-token', 'content-type': 'text/plain' },
      body: 'not-json',
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401,
      body: { error: 'ASYNC_WORKER_UNAUTHORIZED' },
    })
    expect(finalize).not.toHaveBeenCalled()
    expect(store.getDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['repeated', '0, 1'],
    ['negative', '-1'],
    ['non-integer', '1.5'],
    ['non-numeric', 'first'],
    ['out of range', '8'],
  ])('rejects a %s retry count only after successful OIDC verification', async (_label, retryCount) => {
    const deps = dependencies()
    const headers: Record<string, string> = {
      authorization: 'Bearer valid-worker-token',
      'content-type': 'application/json',
    }
    if (retryCount !== undefined) headers['x-cloudtasks-taskretrycount'] = retryCount

    const response = await invoke(createPmcMiniAppMiddleware(deps), route, {
      method: 'POST', headers, body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1' }),
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { error: 'ASYNC_WORKER_INVALID_RETRY_COUNT' },
    })
    expect(deps.workerIdentity.verify).toHaveBeenCalledWith('valid-worker-token')
    expect(deps.asyncWorker.finalize).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong content type', { headers: { 'content-type': 'text/plain' }, body: '{}' }, 415, 'ASYNC_WORKER_JSON_REQUIRED'],
    ['malformed JSON', { headers: { 'content-type': 'application/json' }, body: '{' }, 400, 'ASYNC_WORKER_INVALID_JSON'],
    ['extra key', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1', customerName: 'private' }) }, 400, 'ASYNC_WORKER_INVALID_BODY'],
    ['unsafe request ID', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: '../request', draftId: 'draft-1' }) }, 400, 'ASYNC_WORKER_INVALID_BODY'],
    ['oversized ID', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `request-${'x'.repeat(125)}`, draftId: 'draft-1' }) }, 400, 'ASYNC_WORKER_INVALID_BODY'],
    ['oversized body', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1', padding: 'x'.repeat(1_100) }) }, 413, 'ASYNC_WORKER_PAYLOAD_TOO_LARGE'],
  ] as const)('rejects a %s task body without calling the worker', async (_label, request, status, error) => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), route, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-worker-token',
        'x-cloudtasks-taskretrycount': '0',
        ...request.headers,
      },
      body: request.body,
    })

    expect({ status: response.status, body: await response.json() }).toEqual({ status, body: { error } })
    expect(deps.asyncWorker.finalize).not.toHaveBeenCalled()
  })

  it.each([
    ['dot segment', '/internal/mini-app/x/../finalize-booking'],
    ['encoded dot segment', '/internal/mini-app/%2e/finalize-booking'],
    ['encoded parent segment', '/internal/mini-app/x/%2e%2e/finalize-booking'],
    ['encoded slash', `${route}%2fretry`],
    ['duplicate slash', '/internal/mini-app//finalize-booking'],
    ['bare query marker', `${route}?`],
    ['query', `${route}?x=1`],
    ['suffix', `${route}/retry`],
    ['prefix', `/prefix${route}`],
    ['absolute-form target', `http://localhost${route}`],
    ['bare fragment-like marker', `${route}#`],
    ['fragment-like suffix', `${route}#x`],
  ])('rejects a non-exact raw worker target with a %s', async (_label, path) => {
    const deps = dependencies()
    const response = await invokeRaw(createPmcMiniAppMiddleware(deps), path, {
      method: 'POST',
      headers: { authorization: 'Bearer valid-worker-token', 'x-cloudtasks-taskretrycount': '0', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1' }),
    })

    expect(response.status).toBe(404)
    expect(deps.workerIdentity.verify).not.toHaveBeenCalled()
    expect(deps.asyncWorker.finalize).not.toHaveBeenCalled()
  })

  it('delegates the exact raw target while rejecting the wrong method before OIDC', async () => {
    const exactDeps = dependencies()
    const exact = await invokeRaw(createPmcMiniAppMiddleware(exactDeps), route, {
      method: 'POST',
      headers: { authorization: 'Bearer rejected-token', 'x-cloudtasks-taskretrycount': '0', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1' }),
    })
    const wrongMethodDeps = dependencies()
    const wrongMethod = await invokeRaw(createPmcMiniAppMiddleware(wrongMethodDeps), route, { method: 'GET' })

    expect({ status: exact.status, body: await exact.json() }).toEqual({
      status: 401,
      body: { error: 'ASYNC_WORKER_UNAUTHORIZED' },
    })
    expect(exactDeps.workerIdentity.verify).toHaveBeenCalledWith('rejected-token')
    expect({ status: wrongMethod.status, body: await wrongMethod.json() }).toEqual({
      status: 405,
      body: { error: 'MINI_APP_METHOD_NOT_ALLOWED' },
    })
    expect(wrongMethodDeps.workerIdentity.verify).not.toHaveBeenCalled()
  })

  it.each(['0', '1', '2', '3', '4', '5', '6'])(
    'returns 503 when worker delivery attempt %s persists RETRYING and throws',
    async (retryCount) => {
      const finalize = vi.fn<AsyncBookingWorker['finalize']>(async () => { throw new Error('safe retry') })
      const deps = dependencies({ asyncWorker: { finalize } })

      const response = await invoke(createPmcMiniAppMiddleware(deps), route, workerRequest(retryCount))

      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 503, body: { error: 'ASYNC_WORKER_FAILED' },
      })
      expect(finalize).toHaveBeenCalledWith({
        requestId: 'request-1', draftId: 'draft-1', attempt: Number(retryCount) + 1,
      })
    },
  )

  it.each([
    [{ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED' as const }],
    [{ requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW' as const }],
  ])('returns 200 only for a resolved terminal worker result', async (terminal) => {
    const finalize = vi.fn<AsyncBookingWorker['finalize']>(async () => terminal)
    const response = await invoke(
      createPmcMiniAppMiddleware(dependencies({ asyncWorker: { finalize } })),
      route,
      workerRequest('7'),
    )

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: terminal })
  })

})

function dependencies(overrides: Partial<PmcMiniAppMiddlewareDependencies> = {}) {
  const workerIdentity: WorkerIdentityVerifier = {
    verify: vi.fn(async (token: string) => {
      if (token !== 'valid-worker-token') throw new Error('unauthorized')
      return { email: asyncConfig.taskInvokerEmail, subject: 'google-subject-1' }
    }),
  }
  const asyncWorker: AsyncBookingWorker = {
    finalize: vi.fn(async ({ requestId }) => ({ requestId, caseId: null, state: 'NEEDS_REVIEW' as const })),
  }
  return {
    config,
    identity: { verify: vi.fn(async () => { throw new Error('LINE identity must not run') }) },
    store: inaccessibleStore(),
    workerIdentity,
    asyncWorker,
    now: () => fixedNow,
    ...overrides,
  }
}

function workerRequest(retryCount: string, body: Record<string, unknown> = { requestId: 'request-1', draftId: 'draft-1' }): RequestInit {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-worker-token',
      'content-type': 'application/json',
      'x-cloudtasks-taskretrycount': retryCount,
    },
    body: JSON.stringify(body),
  }
}

function inaccessibleStore(): MiniAppStore {
  const unavailable = vi.fn(async () => { throw new Error('store must not be touched') })
  return {
    getActiveStaffByLineUserId: unavailable,
    getActiveBookingConfig: unavailable,
    getLatestActiveDraftByStaff: unavailable,
    createDraft: unavailable,
    getDraft: unavailable,
    updateDraft: unavailable,
    markRetentionPending: unavailable,
    claimConfirmation: unavailable,
    completeConfirmation: unavailable,
    failConfirmation: unavailable,
  } as unknown as MiniAppStore
}

const asyncConfig = {
  enabled: true as const,
  projectId: 'project-1',
  location: 'asia-southeast1' as const,
  bucketName: 'pmc-mini-app-evidence-staging',
  queueName: 'pmc-booking-finalize',
  workerUrl: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking',
  workerAudience: 'https://pmc-mini-app.example',
  taskInvokerEmail: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
  ownerStaffIds: new Set(['staff-active']),
  maxBatchBytes: 25_000_000 as const,
}

const config: PmcMiniAppServerConfig = {
  enabled: true,
  miniAppId: '2001234567-mini-app',
  lineChannelId: '2001234567',
  spreadsheetId: 'sheet-1',
  intakeFolderId: 'folder-1',
  bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
  fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
  bookingIngressSecret: 'ingress-secret',
  signingSecret: 'signing-secret',
  enrollmentPin: null,
  maxImageBytes: 10_000_000,
  maxFilesPerKind: 10,
  asyncBooking: asyncConfig,
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
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function invokeRaw(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
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
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode,
          headers: response.headers as Record<string, string>,
        })))
      })
      request.on('error', reject)
      request.end(init.body)
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
