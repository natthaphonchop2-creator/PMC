import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import { bookingPayloadHash } from '../../server/pmc-mini-app/bookingDraft'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  createPmcMiniAppMiddleware,
  type PmcMiniAppMiddlewareDependencies,
} from '../../server/pmc-mini-app/middleware'
import {
  createGoogleMiniAppStore,
  type MiniAppRequestRecord,
  type MiniAppStore,
} from '../../server/pmc-mini-app/store'
import type { WorkerIdentityVerifier } from '../../server/pmc-mini-app/workerAuth'

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
    ['wrong method', route, 'GET', 405],
    ['query-bearing route', `${route}?debug=1`, 'POST', 404],
    ['route suffix', `${route}/retry`, 'POST', 404],
    ['route prefix', '/internal/mini-app/finalize', 'POST', 404],
  ])('fails closed for a %s', async (_label, path, method, status) => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), path, {
      method,
      headers: { authorization: 'Bearer valid-worker-token', 'x-cloudtasks-taskretrycount': '0', 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ requestId: 'request-1', draftId: 'draft-1' }) } : {}),
    })

    expect(response.status).toBe(status)
    expect(deps.asyncWorker.finalize).not.toHaveBeenCalled()
  })

  it('passes retry count plus one to the worker and claims the first queued lease through the real store', async () => {
    const draft = validDraft()
    const fixture = await leaseFixture(draft)
    await fixture.store.queueDraft(
      'request-1',
      bookingPayloadHash(draft),
      'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1',
      '2026-08-28T02:00:00.000Z',
    )

    const response = await invoke(createPmcMiniAppMiddleware(fixture.deps), route, workerRequest('2'))

    expect(response.status).toBe(200)
    expect(fixture.finalize).toHaveBeenCalledWith({ requestId: 'request-1', draftId: 'draft-1', attempt: 3 })
    await expect(fixture.store.getDraft('draft-1')).resolves.toMatchObject({
      state: 'PROCESSING', processingStartedAt: fixedNow.toISOString(),
      processingLeaseUntil: '2026-08-28T02:06:00.000Z', attemptCount: 1,
    })
  })

  it('claims only the exact matching READY_TO_CONFIRM identity when task delivery wins the queue-write race', async () => {
    const fixture = await leaseFixture(validDraft())
    const mismatch = await invoke(createPmcMiniAppMiddleware(fixture.deps), route, workerRequest('0', {
      requestId: 'request-1', draftId: 'draft-other',
    }))

    expect({ status: mismatch.status, body: await mismatch.json() }).toEqual({
      status: 503,
      body: { error: 'ASYNC_WORKER_FAILED' },
    })
    await expect(fixture.store.getDraft('draft-1')).resolves.toMatchObject({ state: 'READY_TO_CONFIRM', attemptCount: 0 })

    const matched = await invoke(createPmcMiniAppMiddleware(fixture.deps), route, workerRequest('1'))
    expect(matched.status).toBe(200)
    await expect(fixture.store.getDraft('draft-1')).resolves.toMatchObject({
      requestId: 'request-1', draftId: 'draft-1', state: 'PROCESSING', attemptCount: 1,
    })
  })

  it('leaves a live lease untouched and reclaims it only at expiry through the real store', async () => {
    const fixture = await leaseFixture(validDraft({
      state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:01:01.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    }))

    const live = await invoke(createPmcMiniAppMiddleware(fixture.deps), route, workerRequest('1'))
    expect(live.status).toBe(200)
    await expect(fixture.store.getDraft('draft-1')).resolves.toMatchObject({
      processingLeaseUntil: '2026-08-28T02:01:01.000Z', attemptCount: 1, version: 1,
    })

    fixture.clock.setTime('2026-08-28T02:01:01.000Z')
    const reclaimed = await invoke(createPmcMiniAppMiddleware(fixture.deps), route, workerRequest('2'))
    expect(reclaimed.status).toBe(200)
    await expect(fixture.store.getDraft('draft-1')).resolves.toMatchObject({
      processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:01.000Z', attemptCount: 2, version: 2,
    })
  })
})

function dependencies(overrides: Partial<PmcMiniAppMiddlewareDependencies> = {}) {
  const workerIdentity: WorkerIdentityVerifier = {
    verify: vi.fn(async (token: string) => {
      if (token !== 'valid-worker-token') throw new Error('unauthorized')
      return { email: asyncConfig.taskInvokerEmail, subject: 'google-subject-1' }
    }),
  }
  const asyncWorker = { finalize: vi.fn(async ({ requestId }: { requestId: string }) => ({ requestId, caseId: null, state: 'RETRYING' as const })) }
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

async function leaseFixture(draft: MiniAppRequestRecord) {
  const sheets = new MemorySheets()
  const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
  await store.createDraft(draft)
  const clock = { now: new Date(fixedNow), setTime(value: string) { this.now = new Date(value) } }
  const finalize = vi.fn(async (input: { requestId: string; draftId: string; attempt: number }) => {
    const now = clock.now
    const result = await store.claimProcessing({
      requestId: input.requestId,
      draftId: input.draftId,
      nowIso: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 5 * 60_000).toISOString(),
    })
    return { requestId: input.requestId, caseId: null, state: result.claimed ? 'RETRYING' as const : 'RETRYING' as const }
  })
  return {
    store,
    finalize,
    clock,
    deps: dependencies({ store, asyncWorker: { finalize }, now: () => clock.now }),
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

function validDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-active', lineUserIdHash: 'line-user-hash',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'ไม่ระบุ',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    return Object.fromEntries(ranges.map((range) => [range, structuredClone(this.tabs.get(tabName(range)) ?? [])]))
  }

  async append(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    const rowNumber = Number(range.match(/!(?:[A-Z]+)(\d+)/)?.[1] ?? 2)
    const index = Math.max(0, rowNumber - 2)
    const current = [...(this.tabs.get(tab) ?? [])]
    current[index] = structuredClone(rows[0] ?? [])
    this.tabs.set(tab, current)
  }

  async batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    for (const item of data) await this.update(spreadsheetId, item.range, item.values)
  }

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { return [] }
  async applyWorkbookRequests(): Promise<void> { return undefined }
}

function tabName(range: string): string {
  return range.split('!', 1)[0]!.replaceAll("'", '')
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
