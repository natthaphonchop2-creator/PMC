import { createHmac } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import {
  createExpenseRecoveryIngressClient,
  createExpenseRecoveryWorker,
  ExpenseRecoveryWorkerError,
  type ExpenseRecoveryWorker,
} from '../../server/pmc-mini-app/finance/recovery'
import {
  createPmcMiniAppMiddleware,
  type PmcMiniAppMiddlewareDependencies,
} from '../../server/pmc-mini-app/middleware'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'
import type { WorkerIdentityVerifier } from '../../server/pmc-mini-app/workerAuth'
import { canonicalMiniAppExpenseRecoveryIngress } from '../../shared/pmcMiniAppExpenseIngress'

const route = '/internal/mini-app/recover-expenses'
const worker = {
  email: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
  subject: 'google-subject-1',
}
const counts = { recovered: 2, abandoned: 1, unchanged: 3, failed: 1 }

describe('signed expense recovery worker', () => {
  it('binds the verified worker and correlation ID to the distinct expense HMAC request', async () => {
    let capturedBody: Record<string, unknown> | null = null
    const client = createExpenseRecoveryIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'expense-recovery-secret',
      now: () => 1_788_000_000,
      nonce: () => 'expense-recovery-nonce-1',
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(init.body) as Record<string, unknown>
        return { ok: true, status: 200, async json() { return { ok: true, result: counts } } }
      },
    })

    await expect(client.recover({ correlationId: 'expense-recovery-correlation-1', worker }))
      .resolves.toEqual(counts)
    if (!capturedBody) throw new Error('recovery body not captured')
    const { signature, ...unsigned } = capturedBody
    expect(signature).toBe(createHmac('sha256', 'expense-recovery-secret')
      .update(canonicalMiniAppExpenseRecoveryIngress(unsigned as never))
      .digest('hex'))
    expect(unsigned).toEqual({
      kind: 'MINI_APP_EXPENSE_RECOVERY', version: 1, timestamp: 1_788_000_000,
      nonce: 'expense-recovery-nonce-1', correlationId: 'expense-recovery-correlation-1', worker,
    })
  })

  it('turns malformed/private Apps Script responses into one fixed safe failure', async () => {
    const client = createExpenseRecoveryIngressClient({
      url: 'https://script.google.com/macros/s/private-deployment/exec',
      secret: 'private-expense-secret',
      now: () => 1_788_000_000,
      nonce: () => 'expense-recovery-nonce-2',
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { ok: true, result: { ...counts, privateFolderId: 'private-folder-id' } }
        },
      }),
    })

    await expect(client.recover({ correlationId: 'expense-recovery-correlation-2', worker }))
      .rejects.toMatchObject({ code: 'EXPENSE_RECOVERY_FAILED' })
  })

  it('logs only a correlation ID and safe code on success and failure', async () => {
    const logged: unknown[] = []
    const client = {
      recover: vi.fn()
        .mockResolvedValueOnce(counts)
        .mockRejectedValueOnce(new Error('private provider body and secret')),
    }
    const recovery = createExpenseRecoveryWorker({
      ingress: client,
      correlationId: vi.fn()
        .mockReturnValueOnce('expense-recovery-correlation-3')
        .mockReturnValueOnce('expense-recovery-correlation-4'),
      log: (entry) => { logged.push(entry) },
    })

    await expect(recovery.recover(worker)).resolves.toEqual(counts)
    await expect(recovery.recover(worker)).rejects.toBeInstanceOf(ExpenseRecoveryWorkerError)
    expect(logged).toEqual([
      { correlationId: 'expense-recovery-correlation-3', code: 'EXPENSE_RECOVERY_COMPLETED' },
      { correlationId: 'expense-recovery-correlation-4', code: 'EXPENSE_RECOVERY_FAILED' },
    ])
    expect(JSON.stringify(logged)).not.toContain(worker.email)
    expect(JSON.stringify(logged)).not.toContain(worker.subject)
    expect(JSON.stringify(logged)).not.toContain('private provider')
    expect(JSON.stringify(logged)).not.toContain('secret')
  })
})

describe('authenticated expense recovery route', () => {
  it.each([
    ['missing bearer', undefined],
    ['invalid OIDC bearer', 'Bearer invalid-worker-token'],
    ['public LINE bearer', 'Bearer preview-line-token'],
  ])('returns 401 for %s before recovery or LINE identity', async (_label, authorization) => {
    const deps = dependencies()
    const headers: Record<string, string> = {}
    if (authorization) headers.authorization = authorization

    const response = await invoke(createPmcMiniAppMiddleware(deps), route, { method: 'POST', headers })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 401, body: { error: 'EXPENSE_RECOVERY_UNAUTHORIZED' },
    })
    expect(deps.finance.recovery.recover).not.toHaveBeenCalled()
    expect(deps.identity.verify).not.toHaveBeenCalled()
  })

  it('lets the configured task invoker reach recovery and returns safe counts only', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), route, {
      method: 'POST', headers: { authorization: 'Bearer valid-worker-token' },
    })
    const body = await response.json()

    expect({ status: response.status, body }).toEqual({ status: 200, body: counts })
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(['abandoned', 'failed', 'recovered', 'unchanged'])
    expect(deps.expenseRecoveryIdentity.verify).toHaveBeenCalledWith('valid-worker-token')
    expect(deps.workerIdentity.verify).not.toHaveBeenCalled()
    expect(deps.finance.recovery.recover).toHaveBeenCalledWith(worker)
  })

  it('fails closed with one safe code and rejects non-exact or public aliases', async () => {
    const failedDeps = dependencies({
      finance: {
        signingSecret: 'browser-signing-secret',
        recovery: { recover: vi.fn(async () => { throw new Error('private Apps Script response') }) },
      },
    })
    const failed = await invoke(createPmcMiniAppMiddleware(failedDeps), route, {
      method: 'POST', headers: { authorization: 'Bearer valid-worker-token' },
    })
    expect({ status: failed.status, body: await failed.json() }).toEqual({
      status: 503, body: { error: 'EXPENSE_RECOVERY_FAILED' },
    })

    for (const path of [`${route}?force=true`, `${route}/retry`, '/api/mini-app/recover-expenses']) {
      const deps = dependencies()
      const response = await invokeRaw(createPmcMiniAppMiddleware(deps), path, {
        method: 'POST', headers: { authorization: 'Bearer valid-worker-token' },
      })
      expect(response.status).toBe(404)
      expect(deps.expenseRecoveryIdentity.verify).not.toHaveBeenCalled()
      expect(deps.finance.recovery.recover).not.toHaveBeenCalled()
    }
  })

  it('rejects the wrong method before OIDC and validates framed bodies only after OIDC', async () => {
    const methodDeps = dependencies()
    const wrongMethod = await invoke(createPmcMiniAppMiddleware(methodDeps), route, { method: 'GET' })
    expect({ status: wrongMethod.status, body: await wrongMethod.json() }).toEqual({
      status: 405, body: { error: 'MINI_APP_METHOD_NOT_ALLOWED' },
    })
    expect(methodDeps.expenseRecoveryIdentity.verify).not.toHaveBeenCalled()

    const rejectedBodyDeps = dependencies()
    const rejectedFramed = await invoke(createPmcMiniAppMiddleware(rejectedBodyDeps), route, {
      method: 'POST',
      headers: { authorization: 'Bearer rejected-token', 'content-type': 'application/json' },
      body: '{}',
    })
    expect({ status: rejectedFramed.status, body: await rejectedFramed.json() }).toEqual({
      status: 401, body: { error: 'EXPENSE_RECOVERY_UNAUTHORIZED' },
    })
    expect(rejectedBodyDeps.expenseRecoveryIdentity.verify).toHaveBeenCalledWith('rejected-token')
    expect(rejectedBodyDeps.finance.recovery.recover).not.toHaveBeenCalled()

    const validBodyDeps = dependencies()
    const framed = await invoke(createPmcMiniAppMiddleware(validBodyDeps), route, {
      method: 'POST',
      headers: { authorization: 'Bearer valid-worker-token', 'content-type': 'application/json' },
      body: '{}',
    })
    expect({ status: framed.status, body: await framed.json() }).toEqual({
      status: 400, body: { error: 'EXPENSE_RECOVERY_INVALID_REQUEST' },
    })
    expect(framed.headers.get('connection')).toBe('close')
    expect(validBodyDeps.expenseRecoveryIdentity.verify).toHaveBeenCalledWith('valid-worker-token')
    expect(validBodyDeps.finance.recovery.recover).not.toHaveBeenCalled()
  })
})

function dependencies(overrides: Partial<PmcMiniAppMiddlewareDependencies> = {}) {
  const expenseRecoveryIdentity: WorkerIdentityVerifier = {
    verify: vi.fn(async (token: string) => {
      if (token !== 'valid-worker-token') throw new Error('unauthorized')
      return worker
    }),
  }
  const workerIdentity: WorkerIdentityVerifier = {
    verify: vi.fn(async () => { throw new Error('async Booking verifier must not run') }),
  }
  const recovery: ExpenseRecoveryWorker = { recover: vi.fn(async () => counts) }
  return {
    config,
    identity: { verify: vi.fn(async () => { throw new Error('LINE identity must not run') }) },
    store: inaccessibleStore(),
    expenseRecoveryIdentity,
    workerIdentity,
    finance: { signingSecret: 'browser-signing-secret', recovery },
    ...overrides,
  } as PmcMiniAppMiddlewareDependencies & {
    expenseRecoveryIdentity: WorkerIdentityVerifier & { verify: ReturnType<typeof vi.fn> }
    workerIdentity: WorkerIdentityVerifier & { verify: ReturnType<typeof vi.fn> }
    finance: NonNullable<PmcMiniAppMiddlewareDependencies['finance']> & { recovery: ExpenseRecoveryWorker & { recover: ReturnType<typeof vi.fn> } }
  }
}

function inaccessibleStore(): MiniAppStore {
  const unavailable = vi.fn(async () => { throw new Error('store must not be touched') })
  return {
    getActiveStaffByLineUserId: unavailable,
    getActiveBookingConfig: unavailable,
  } as unknown as MiniAppStore
}

const config: PmcMiniAppServerConfig = {
  enabled: true,
  miniAppId: '2001234567-mini-app',
  lineChannelId: '2001234567',
  spreadsheetId: 'sheet-1',
  intakeFolderId: 'folder-1',
  bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
  fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
  bookingIngressSecret: 'booking-secret',
  signingSecret: 'browser-signing-secret',
  enrollmentPin: null,
  maxImageBytes: 10_000_000,
  maxFilesPerKind: 10,
  asyncBooking: {
    enabled: true,
    projectId: 'project-1',
    location: 'asia-southeast1',
    bucketName: 'pmc-mini-app-evidence-staging',
    queueName: 'pmc-booking-finalize',
    workerUrl: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking',
    workerAudience: 'https://pmc-mini-app.example',
    taskInvokerEmail: worker.email,
    ownerStaffIds: new Set(['staff-owner']),
    maxBatchBytes: 25_000_000,
  },
  financeReportsEnabled: false,
  stockEnabled: false,
  stockManagerPilotOnly: false,
  finance: null,
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
    return new Response(body, { status: response.status, headers: response.headers })
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
      const request = httpRequest({ host: '127.0.0.1', port: address.port, method: init.method, path, headers: init.headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode,
          headers: response.headers as Record<string, string>,
        })))
      })
      request.on('error', reject)
      request.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
