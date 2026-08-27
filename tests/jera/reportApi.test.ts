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
})

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
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
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
