import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'
import type { JeraNormalizedRow } from '../../server/jera/contracts'
import { createJeraMiniAppApi } from '../../server/jera/middleware'
import { createJeraRuntime } from '../../server/jera/runtime'
import type { JeraSyncCoordinator } from '../../server/jera/syncCoordinator'
import type { JeraReportStore, JeraSyncStateRecord } from '../../server/jera/store'
import type { JeraAllocationWorker } from '../../server/jera/allocationWorker'

describe('authenticated JERA report API', () => {
  it('does not access report data before LINE staff authorization', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/reports/PAYMENT')

    expect(response.status).toBe(401)
    expect(deps.coordinator.readAndRefresh).not.toHaveBeenCalled()
  })

  it('returns a projected cache-first report to every active staff member', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), reportPath('PAYMENT'), {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      source: 'CACHE', refreshing: true,
      data: { totals: { paidAmountSatang: 90_000, transferSatang: 90_000 } },
    })
    expect(deps.coordinator.readAndRefresh).toHaveBeenCalledWith({
      reportType: 'PAYMENT',
      filters: { branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27' },
    })
    expect(JSON.stringify(body)).not.toContain('production-secret')
  })

  it('reads TODAY_SUMMARY source caches sequentially to avoid a Sheets burst', async () => {
    const deps = dependencies()
    const order: string[] = []
    let active = 0
    let maxActive = 0
    vi.mocked(deps.coordinator.readAndRefresh).mockImplementation(async ({ reportType }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(reportType)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      return { ...envelope(), data: [] }
    })

    const response = await invoke(createPmcMiniAppMiddleware(deps), reportPath('TODAY_SUMMARY'), {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(200)
    expect(order).toEqual(['PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT'])
    expect(maxActive).toBe(1)
  })

  it('rejects a bulk TODAY_SUMMARY refresh before starting source refreshes', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), refreshPath('TODAY_SUMMARY'), {
      method: 'POST', headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'JERA_SUMMARY_REFRESH_UNAVAILABLE' })
    expect(deps.coordinator.manualRefresh).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown report', '/api/mini-app/reports/UNKNOWN', 404],
    ['repeated scalar', reportPath('APPOINTMENT') + '&status=paid&status=unpaid', 400],
    ['invalid UUID', reportPath('PAYMENT').replace(BRANCH, 'not-a-uuid'), 400],
    ['invalid date', reportPath('PAYMENT').replace('2026-08-01', '01/08/2026'), 400],
    ['range over 366 days', `/api/mini-app/reports/PAYMENT?branchUuid=${BRANCH}&startDate=2025-01-01&endDate=2026-08-27`, 400],
    ['unsupported filter', reportPath('PAYMENT') + '&doctorUuid=22222222-3333-4444-8555-666666666666', 400],
  ])('rejects %s before reading cache', async (_name, path, status) => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), path, {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(status)
    expect(deps.coordinator.readAndRefresh).not.toHaveBeenCalled()
  })

  it('returns Retry-After when a manual refresh is throttled', async () => {
    const deps = dependencies({ manualAccepted: false })
    const response = await invoke(createPmcMiniAppMiddleware(deps), refreshPath('PAYMENT'), {
      method: 'POST', headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('240')
    expect(await response.json()).toEqual({ error: 'REFRESH_THROTTLED', retryAfterSeconds: 240 })
  })

  it('accepts a manual refresh without returning rows or patient data', async () => {
    const deps = dependencies({ manualAccepted: true })
    const response = await invoke(createPmcMiniAppMiddleware(deps), refreshPath('PAYMENT'), {
      method: 'POST', headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toEqual({ accepted: true, correlationId: 'corr-synthetic-1' })
    expect(JSON.stringify(body)).not.toContain('Synthetic Patient')
  })

  it('returns health metadata only, without cached rows or credentials', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/integration-health', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      enabled: true,
      reports: [{ reportType: 'PAYMENT', lastSuccessAt: '2026-08-27T09:55:00.000Z', status: 'SUCCESS', recordCount: 1 }],
    })
    expect(JSON.stringify(body)).not.toContain('Synthetic Patient')
    expect(JSON.stringify(body)).not.toContain('production-secret')
  })

  it('constructs the Production adapter only from a complete HTTPS configuration', () => {
    const construct = vi.fn(() => ({ api: {}, coordinator: {}, store: {}, config: {} }))
    const google = { spreadsheetId: 'sheet-1', sheets: {} as never }
    const valid = {
      JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example',
      JERA_DEFAULT_BRANCH_UUID: BRANCH, JERA_SYNC_INTERVAL_MINUTES: '15',
      JERA_API_USERNAME: 'synthetic-user', JERA_API_PASSWORD: 'synthetic-password',
    }

    expect(createJeraRuntime(valid, google, construct as never)).toBeDefined()
    expect(construct).toHaveBeenCalledOnce()
    expect(createJeraRuntime({ ...valid, JERA_API_BASE_URL: 'http://unsafe.example' }, google, construct as never)).toBeUndefined()
    expect(createJeraRuntime({ ...valid, JERA_API_PASSWORD: '' }, google, construct as never)).toBeUndefined()
    expect(createJeraRuntime({ JERA_REPORTING_ENABLED: 'false' }, google, construct as never)).toBeUndefined()
    expect(construct).toHaveBeenCalledOnce()
  })

  it('passes a validated private lease bucket into allocation runtime construction and rejects missing or invalid values', () => {
    const construct = vi.fn(() => ({ api: {}, coordinator: {}, store: {}, config: {}, allocationWorker: null }))
    const google = { spreadsheetId: 'sheet-1', sheets: {} as never }
    const base = {
      JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example', JERA_DEFAULT_BRANCH_UUID: BRANCH,
      JERA_SYNC_INTERVAL_MINUTES: '15', JERA_API_USERNAME: 'synthetic-user', JERA_API_PASSWORD: 'synthetic-password',
      JERA_REVENUE_ALLOCATION_ENABLED: 'true', JERA_ALLOCATION_PROJECT_ID: 'pmc-project',
      JERA_ALLOCATION_LOCATION: 'asia-southeast1', JERA_ALLOCATION_QUEUE: 'pmc-revenue-allocation',
      JERA_ALLOCATION_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker',
      JERA_ALLOCATION_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
      JERA_ALLOCATION_TASK_INVOKER_EMAIL: 'worker@pmc-project.iam.gserviceaccount.com',
      JERA_ALLOCATION_LEASE_BUCKET: 'pmc-private-allocation-leases',
    }

    expect(createJeraRuntime(base, google, construct as never)).toBeDefined()
    expect(construct.mock.calls[0]![0].config.allocation.leaseBucket).toBe('pmc-private-allocation-leases')
    const { JERA_ALLOCATION_LEASE_BUCKET: _missing, ...missing } = base
    expect(createJeraRuntime(missing, google, construct as never)).toBeUndefined()
    expect(createJeraRuntime({ ...base, JERA_ALLOCATION_LEASE_BUCKET: 'gs://not-private' }, google, construct as never)).toBeUndefined()
    expect(construct).toHaveBeenCalledOnce()
  })

  it('runs the exact authenticated allocation worker contract and returns only progress', async () => {
    const deps = dependencies()
    const worker = { run: vi.fn(async () => ({ status: 'CONTINUED' as const, processed: 7, nextCursor: 12 })) } as JeraAllocationWorker
    deps.jera = allocationApi(worker)
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' },
      body: JSON.stringify({ branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 5, attempt: 3 }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'CONTINUED', processed: 7, nextCursor: 12 })
    expect(worker.run).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 5, attempt: 3, workerId: 'worker-route-id',
    })
  })

  it('fails closed on allocation worker auth, body shape, size, and unexpected errors', async () => {
    const deps = dependencies()
    const worker = { run: vi.fn(async () => { throw Object.assign(new Error('private'), { patient: 'private' }) }) } as unknown as JeraAllocationWorker
    deps.jera = allocationApi(worker)
    const middleware = createPmcMiniAppMiddleware(deps)
    const valid = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt: 0 }
    const validBody = JSON.stringify(valid)

    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', { method: 'GET' })).status).toBe(405)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', { method: 'POST', body: validBody })).status).toBe(401)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer wrong-email', 'content-type': 'application/json' }, body: validBody,
    })).status).toBe(403)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(validBody), extra: true }),
    })).status).toBe(400)
    const { attempt: _attempt, ...missingAttempt } = valid
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify(missingAttempt),
    })).status).toBe(400)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify({ ...valid, attempt: 1_000_001 }),
    })).status).toBe(400)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(2_100) }),
    })).status).toBe(413)
    const failed = await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: validBody,
    })
    expect({ status: failed.status, body: await failed.json() }).toEqual({ status: 500, body: { error: 'JERA_ALLOCATION_FAILED' } })
  })
})

function allocationApi(worker: JeraAllocationWorker) {
  return createJeraMiniAppApi({
    coordinator: dependencies().coordinator, store: { listSyncStates: vi.fn(async () => []) } as unknown as JeraReportStore,
    defaultBranchUuid: BRANCH, id: () => 'worker-route-id', allocation: {
      worker, audience: 'https://pmc-mini-app.example', serviceAccountEmail: 'worker@pmc-project.iam.gserviceaccount.com',
      identity: {
        verify: vi.fn(async (token: string) => token === 'worker-token'
          ? { email: 'worker@pmc-project.iam.gserviceaccount.com', emailVerified: true }
          : { email: 'other@pmc-project.iam.gserviceaccount.com', emailVerified: true }),
      },
    },
  })
}

function dependencies(options: { manualAccepted?: boolean } = {}) {
  const coordinator = {
    readAndRefresh: vi.fn(async () => envelope()),
    manualRefresh: vi.fn(async () => ({
      accepted: options.manualAccepted ?? true,
      retryAfterSeconds: options.manualAccepted === false ? 240 : 300,
      envelope: envelope(),
    })),
  } as unknown as JeraSyncCoordinator
  const states: JeraSyncStateRecord[] = [{
    cacheKey: 'PAYMENT:key', reportType: 'PAYMENT', filterHash: 'a'.repeat(64),
    lastAttemptAt: '2026-08-27T09:55:00.000Z', lastManualAt: null,
    lastSuccessAt: '2026-08-27T09:55:00.000Z', lastSourceDate: '2026-08-27', status: 'SUCCESS',
    recordCount: 1, nextPage: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
  }]
  const reportStore = { listSyncStates: vi.fn(async () => states) } as unknown as JeraReportStore
  const jera = createJeraMiniAppApi({
    coordinator, store: reportStore, defaultBranchUuid: BRANCH,
    now: () => new Date('2026-08-27T10:00:00.000Z'), id: () => 'corr-synthetic-1',
  })
  const identity: LineIdentityPort = {
    async verify(idToken) {
      if (idToken === 'valid-token') return { lineUserId: 'Uactive' }
      throw new Error('invalid token')
    },
  }
  const store = {
    getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => lineUserId === 'Uactive' ? ({
      id: 'staff-1', name: 'มัส', email: 'private@example.com', lineUserId: 'Uactive',
      canCloseBooking: true, canBeAe: true, active: true as const, profileImageUrl: null,
    }) : null),
  } as unknown as MiniAppStore
  return { config: config(), identity, store, jera, coordinator }
}

function envelope() {
  return {
    data: [paymentRow()], source: 'CACHE' as const, fetchedAt: '2026-08-27T09:55:00.000Z',
    lastSuccessAt: '2026-08-27T09:55:00.000Z', refreshing: true, stale: false, warningCode: null,
  }
}

function paymentRow(): JeraNormalizedRow {
  return {
    cacheKey: 'PAYMENT:key', reportType: 'PAYMENT', sourceUuid: '10000000-0000-4000-8000-000000000001',
    branchUuid: BRANCH, branchName: 'Synthetic Branch', eventDate: '2026-08-27', patientUuid: null,
    patientCode: 'PAT-SYN-1', patientName: 'Synthetic Patient', paymentCode: 'PAY-SYN-1', status: 'PAID', type: 'normal',
    totalSatang: 90_000, paidAmountSatang: 90_000, refundAmountSatang: null,
    cashSatang: 0, transferSatang: 90_000, creditCardSatang: 0, eWalletSatang: 0,
    paymentLinkSatang: 0, otherPaymentSatang: 0, itemCode: null, itemName: null, quantity: null,
    remainingQuantity: null, remainingValueSatang: null, doctorName: 'Doctor Synthetic', salespersonName: null,
    sourceCreatedAt: '2026-08-27T10:00:00+07:00', sourceUpdatedAt: null,
    fetchedAt: '2026-08-27T09:55:00.000Z', sourceHash: 'a'.repeat(64),
  }
}

function config(): PmcMiniAppServerConfig {
  return {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'production-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10, asyncBooking: null,
  }
}

function reportPath(type: string): string {
  return `/api/mini-app/reports/${type}?branchUuid=${BRANCH}&startDate=2026-08-01&endDate=2026-08-27`
}

function refreshPath(type: string): string {
  return `/api/mini-app/reports/${type}/refresh?branchUuid=${BRANCH}&startDate=2026-08-01&endDate=2026-08-27`
}

async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const server = createServer(middleware)
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

const BRANCH = '11111111-2222-4333-8444-555555555555'
