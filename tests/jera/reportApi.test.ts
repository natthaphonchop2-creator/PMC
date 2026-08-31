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
import type { JeraFinanceService } from '../../server/jera/financeService'

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
    const missing = { ...base, JERA_ALLOCATION_LEASE_BUCKET: undefined }
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
      body: JSON.stringify({
        branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64),
        metadataSnapshotHash: 'b'.repeat(64), cursor: 5, attempt: 3,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'CONTINUED', processed: 7, nextCursor: 12 })
    expect(worker.run).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64),
      metadataSnapshotHash: 'b'.repeat(64), cursor: 5, attempt: 3, workerId: 'worker-route-id',
    })
  })

  it('fails closed on allocation worker auth, body shape, size, and unexpected errors', async () => {
    const deps = dependencies()
    const worker = { run: vi.fn(async () => { throw Object.assign(new Error('private'), { patient: 'private' }) }) } as unknown as JeraAllocationWorker
    deps.jera = allocationApi(worker)
    const middleware = createPmcMiniAppMiddleware(deps)
    const valid = {
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64),
      metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 0,
    }
    const validBody = JSON.stringify(valid)

    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', { method: 'GET' })).status).toBe(405)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', { method: 'POST', body: validBody })).status).toBe(401)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer wrong-email', 'content-type': 'application/json' }, body: validBody,
    })).status).toBe(403)
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(validBody), extra: true }),
    })).status).toBe(400)
    const missingAttempt = { ...valid, attempt: undefined }
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify(missingAttempt),
    })).status).toBe(400)
    const missingMetadata = { ...valid, metadataSnapshotHash: undefined }
    expect((await invoke(middleware, '/internal/mini-app/jera-allocation-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json' }, body: JSON.stringify(missingMetadata),
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

describe('authenticated finance report API', () => {
  it.each([
    ['daily GET', '/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29', 'GET'],
    ['monthly GET', '/api/mini-app/finance/monthly?year=2026&month=8', 'GET'],
    ['daily refresh', '/api/mini-app/finance/daily/refresh?date=2026-08-29', 'POST'],
  ])('returns 401 for unauthenticated %s before finance access', async (_label, path, method) => {
    const deps = financeDependencies()

    const response = await invoke(createPmcMiniAppMiddleware(deps), path, { method })

    expect(response.status).toBe(401)
    expect(deps.finance.readDaily).not.toHaveBeenCalled()
    expect(deps.finance.readMonthly).not.toHaveBeenCalled()
    expect(deps.finance.refreshDay).not.toHaveBeenCalled()
  })

  it.each([
    ['monthly read', '/api/mini-app/finance/monthly?year=2026&month=8', 'GET'],
    ['manual daily refresh', '/api/mini-app/finance/daily/refresh?date=2026-08-29', 'POST'],
  ])('returns 403 for %s before unavailable finance dependencies are checked', async (_label, path, method) => {
    const deps = financeUnavailableDependencies()

    const response = await invoke(createPmcMiniAppMiddleware(deps), path, {
      method, headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'FINANCE_FORBIDDEN' })
    expect(deps.coordinator.readCachedBatch).not.toHaveBeenCalled()
    expect(deps.coordinator.manualRefresh).not.toHaveBeenCalled()
    expect(deps.reportStore.listSyncStates).not.toHaveBeenCalled()
  })

  it('allows any active linked staff member to read a daily cache projection', async () => {
    const deps = financeDependencies({ canViewFinance: false })

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/finance/daily?startDate=2026-08-28&endDate=2026-08-29', {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(200)
    expect(deps.finance.readDaily).toHaveBeenCalledWith({ branchUuid: BRANCH, startDate: '2026-08-28', endDate: '2026-08-29' })
    expect(deps.coordinator.readAndRefresh).not.toHaveBeenCalled()
    expect(deps.coordinator.manualRefresh).not.toHaveBeenCalled()
  })

  it.each([
    ['monthly read', '/api/mini-app/finance/monthly?year=2026&month=8', 'GET'],
    ['manual daily refresh', '/api/mini-app/finance/daily/refresh?date=2026-08-29', 'POST'],
  ])('returns 403 before finance store or provider access for %s without canViewFinance', async (_label, path, method) => {
    const deps = financeDependencies({ canViewFinance: false })

    const response = await invoke(createPmcMiniAppMiddleware(deps), path, {
      method, headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'FINANCE_FORBIDDEN' })
    expect(deps.finance.readMonthly).not.toHaveBeenCalled()
    expect(deps.finance.refreshDay).not.toHaveBeenCalled()
  })

  it('allows finance viewers to read monthly and manually refresh exactly one day', async () => {
    const deps = financeDependencies({ canViewFinance: true })
    const middleware = createPmcMiniAppMiddleware(deps)

    const monthly = await invoke(middleware, '/api/mini-app/finance/monthly?year=2028&month=2', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const refresh = await invoke(middleware, '/api/mini-app/finance/daily/refresh?date=2026-08-29', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' },
    })

    expect(monthly.status).toBe(200)
    expect(deps.finance.readMonthly).toHaveBeenCalledWith({ branchUuid: BRANCH, year: 2028, month: 2 })
    expect(refresh.status).toBe(202)
    expect(deps.finance.refreshDay).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'STAFF', staffId: 'staff-1' },
    })
  })

  it.each([
    ['daily unknown parameter', '/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29&branchUuid=' + BRANCH, 'GET'],
    ['daily repeated parameter', '/api/mini-app/finance/daily?startDate=2026-08-29&startDate=2026-08-28&endDate=2026-08-29', 'GET'],
    ['daily extra parameter', '/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29&extra=1', 'GET'],
    ['daily over 31 days', '/api/mini-app/finance/daily?startDate=2026-07-30&endDate=2026-08-30', 'GET'],
    ['monthly caller monthKey', '/api/mini-app/finance/monthly?year=2026&month=8&monthKey=2026-08', 'GET'],
    ['monthly caller startDate', '/api/mini-app/finance/monthly?year=2026&month=8&startDate=2026-08-01', 'GET'],
    ['monthly caller endDate', '/api/mini-app/finance/monthly?year=2026&month=8&endDate=2026-08-31', 'GET'],
    ['monthly repeated year', '/api/mini-app/finance/monthly?year=2026&year=2027&month=8', 'GET'],
    ['refresh repeated date', '/api/mini-app/finance/daily/refresh?date=2026-08-29&date=2026-08-28', 'POST'],
    ['refresh extra parameter', '/api/mini-app/finance/daily/refresh?date=2026-08-29&extra=1', 'POST'],
  ])('rejects %s before finance access', async (_label, path, method) => {
    const deps = financeDependencies({ canViewFinance: true })

    const response = await invoke(createPmcMiniAppMiddleware(deps), path, {
      method, headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'FINANCE_FILTER_INVALID' })
    expect(deps.finance.readDaily).not.toHaveBeenCalled()
    expect(deps.finance.readMonthly).not.toHaveBeenCalled()
    expect(deps.finance.refreshDay).not.toHaveBeenCalled()
  })

  it('returns only safe finance fields and preserves null category money from the server gate', async () => {
    const deps = financeDependencies({ canViewFinance: false })

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(body.categories).toEqual({
      state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null, incompleteDates: [],
    })
    for (const privateValue of ['raw detail', '0812345678', 'facebook-private', 'sheet-private', 'provider-secret', 'PAYMENT:private-cache-key']) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('maps cache and refresh failures to the finance-only safe error surface', async () => {
    const deps = financeDependencies({ canViewFinance: true })
    vi.mocked(deps.finance.readDaily).mockRejectedValueOnce(Object.assign(new Error('private cache identity'), { code: 'FINANCE_CACHE_EMPTY' }))
    vi.mocked(deps.finance.refreshDay).mockRejectedValueOnce(Object.assign(new Error('private provider response'), {
      code: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: 120,
    }))
    const middleware = createPmcMiniAppMiddleware(deps)

    const cache = await invoke(middleware, '/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const refresh = await invoke(middleware, '/api/mini-app/finance/daily/refresh?date=2026-08-29', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' },
    })

    expect({ status: cache.status, body: await cache.json() }).toEqual({ status: 503, body: { error: 'FINANCE_CACHE_UNAVAILABLE' } })
    expect(refresh.status).toBe(429)
    expect(refresh.headers.get('retry-after')).toBe('120')
    expect(await refresh.json()).toEqual({ error: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: 120 })
  })

  it('authenticates the exact internal seed route, rejects caller input, and derives the previous Bangkok day', async () => {
    const deps = financeDependencies({ canViewFinance: true, internalSeed: true })
    const middleware = createPmcMiniAppMiddleware(deps)
    const authorization = { authorization: 'Bearer worker-token' }

    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed', { method: 'GET', headers: authorization })).status).toBe(405)
    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed', { method: 'POST' })).status).toBe(401)
    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed', { method: 'POST', headers: { authorization: 'Bearer wrong-email' } })).status).toBe(403)
    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed?date=2026-08-28', { method: 'POST', headers: authorization })).status).toBe(400)
    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed', {
      method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-08-28' }),
    })).status).toBe(400)
    expect((await invoke(middleware, '/internal/mini-app/finance-daily-seed', {
      method: 'POST', headers: { ...authorization, 'content-type': 'text/plain' }, body: 'not-json',
    })).status).toBe(400)

    const accepted = await invoke(middleware, '/internal/mini-app/finance-daily-seed', { method: 'POST', headers: authorization })

    expect(accepted.status).toBe(202)
    expect(deps.finance.refreshDay).toHaveBeenCalledWith({
      branchUuid: BRANCH, eventDate: '2026-08-29', actor: { type: 'SCHEDULER', schedulerId: 'finance-daily-seed' },
    })
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

function dependencies(options: { manualAccepted?: boolean; canViewFinance?: boolean } = {}) {
  const coordinator = {
    readAndRefresh: vi.fn(async () => envelope()),
    readCachedBatch: vi.fn(async () => []),
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
      canViewFinance: options.canViewFinance ?? false,
    }) : null),
  } as unknown as MiniAppStore
  return { config: config(), identity, store, jera, coordinator }
}

function financeDependencies(options: { canViewFinance?: boolean; internalSeed?: boolean } = {}) {
  const deps = dependencies({ canViewFinance: options.canViewFinance })
  const finance = {
    readDaily: vi.fn(async () => dailyProjection()),
    readMonthly: vi.fn(async () => ({
      ...dailyProjection(), monthKey: '2028-02', dailyTrend: [],
      expense: { state: 'NOT_IMPLEMENTED' as const, clinicExpenseSatang: null, estimatedBalanceSatang: null },
    })),
    refreshDay: vi.fn(async () => ({ accepted: true as const, allocationQueued: true, retryAfterSeconds: 300 })),
  } satisfies JeraFinanceService
  deps.jera = createJeraMiniAppApi({
    coordinator: deps.coordinator,
    store: { listSyncStates: vi.fn(async () => []) } as unknown as JeraReportStore,
    defaultBranchUuid: BRANCH,
    now: () => new Date('2026-08-29T17:30:00.000Z'),
    finance: {
      service: finance,
      ...(options.internalSeed ? {
        seed: {
          schedulerId: 'finance-daily-seed', audience: 'https://pmc-mini-app.example',
          serviceAccountEmail: 'worker@pmc-project.iam.gserviceaccount.com',
          identity: {
            verify: vi.fn(async (token: string) => token === 'worker-token'
              ? { email: 'worker@pmc-project.iam.gserviceaccount.com', emailVerified: true }
              : { email: 'other@pmc-project.iam.gserviceaccount.com', emailVerified: true }),
          },
        },
      } : {}),
    },
  } as never)
  return { ...deps, finance }
}

function financeUnavailableDependencies() {
  const deps = dependencies({ canViewFinance: false })
  const reportStore = { listSyncStates: vi.fn(async () => []) } as unknown as JeraReportStore & { listSyncStates: ReturnType<typeof vi.fn> }
  deps.jera = createJeraMiniAppApi({
    coordinator: deps.coordinator, store: reportStore, defaultBranchUuid: BRANCH,
  })
  return { ...deps, reportStore }
}

function dailyProjection() {
  return {
    startDate: '2026-08-29', endDate: '2026-08-29', receivedSatang: 100_000, refundSatang: 0, netReceivedSatang: 100_000,
    channels: { transferSatang: 100_000, cashSatang: 0, creditSatang: 0, otherSatang: 0, differenceSatang: 0 },
    categories: { state: 'CHECKING' as const, serviceSatang: null, productSatang: null, unclassifiedSatang: null, incompleteDates: [] },
    payments: [{
      paymentUuid: PAYMENT_UUID, paymentCode: 'PAY-1', eventDate: '2026-08-29', patientName: 'Synthetic Patient',
      paidAmountSatang: 100_000, transferSatang: 100_000, cashSatang: 0, creditSatang: 0, otherSatang: 0,
      serviceSatang: null, productSatang: null, unclassifiedSatang: null,
    }],
    freshness: {
      payment: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      refund: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      allocation: { lastSuccessAt: null, stale: true, warningCode: 'COMPONENT_STALE' },
    },
    warnings: ['ALLOCATION_STALE'],
  }
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
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: 1, prepare: false }, asyncBooking: null,
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
const PAYMENT_UUID = '10000000-0000-4000-8000-000000000001'
