import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'
import { createJeraMiniAppApi, type JeraSchedulerIdentityPort } from '../../server/jera/middleware'
import type { JeraSyncCoordinator } from '../../server/jera/syncCoordinator'
import type { JeraReportStore } from '../../server/jera/store'

describe('Cloud Scheduler JERA sync API', () => {
  it('rejects public and LINE staff tokens before scheduling work', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const publicResponse = await invoke(middleware, '/internal/mini-app/jera-sync?mode=current', { method: 'POST' })
    const lineResponse = await invoke(middleware, '/internal/mini-app/jera-sync?mode=current', {
      method: 'POST', headers: { authorization: 'Bearer line-id-token' },
    })

    expect(publicResponse.status).toBe(401)
    expect(lineResponse.status).toBe(401)
    expect(deps.coordinator.scheduledRefresh).not.toHaveBeenCalled()
    expect(deps.lineIdentity.verify).not.toHaveBeenCalled()
  })

  it('rejects a valid Google identity from the wrong service account', async () => {
    const deps = dependencies({ schedulerEmail: 'wrong-runtime@synthetic-project.iam.gserviceaccount.com' })
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/internal/mini-app/jera-sync?mode=current', {
      method: 'POST', headers: { authorization: 'Bearer oidc-token' },
    })

    expect(response.status).toBe(403)
    expect(deps.coordinator.scheduledRefresh).not.toHaveBeenCalled()
  })

  it('refreshes current-day and month-to-date keys with verified scheduler OIDC', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/internal/mini-app/jera-sync?mode=current', {
      method: 'POST', headers: { authorization: 'Bearer oidc-token' },
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toEqual({ accepted: true, syncRunId: 'sync-synthetic-1' })
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledTimes(10)
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'PAYMENT', filters: { branchUuid: BRANCH, startDate: '2026-08-27', endDate: '2026-08-27' },
    }))
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'PAYMENT', filters: { branchUuid: BRANCH, startDate: '2026-08-01', endDate: '2026-08-27' },
    }))
    expect(JSON.stringify(body)).not.toContain('patient')
  })

  it('refreshes prior day and previous calendar month in daily mode', async () => {
    const deps = dependencies()
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/internal/mini-app/jera-sync?mode=daily', {
      method: 'POST', headers: { authorization: 'Bearer oidc-token' },
    })

    expect(response.status).toBe(202)
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'PAYMENT', filters: { branchUuid: BRANCH, startDate: '2026-08-26', endDate: '2026-08-26' },
    }))
    expect(deps.coordinator.scheduledRefresh).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'PAYMENT', filters: { branchUuid: BRANCH, startDate: '2026-07-01', endDate: '2026-07-31' },
    }))
  })
})

function dependencies(options: { schedulerEmail?: string } = {}) {
  const coordinator = {
    scheduledRefresh: vi.fn(async () => ({
      data: [], source: 'LIVE', fetchedAt: null, lastSuccessAt: null, refreshing: false, stale: false, warningCode: null,
    })),
  } as unknown as JeraSyncCoordinator
  const schedulerIdentity: JeraSchedulerIdentityPort = {
    verify: vi.fn(async (token, audience) => {
      if (token !== 'oidc-token' || audience !== 'https://pmc-mini-app.example') throw new Error('invalid')
      return { email: options.schedulerEmail ?? SCHEDULER_EMAIL, emailVerified: true }
    }),
  }
  const jera = createJeraMiniAppApi({
    coordinator, store: {} as JeraReportStore, defaultBranchUuid: BRANCH,
    now: () => new Date('2026-08-27T10:00:00.000Z'), id: () => 'sync-synthetic-1',
    scheduler: { identity: schedulerIdentity, audience: 'https://pmc-mini-app.example', serviceAccountEmail: SCHEDULER_EMAIL },
  })
  const lineIdentity = { verify: vi.fn(async () => ({ lineUserId: 'Uactive' })) } as LineIdentityPort & { verify: ReturnType<typeof vi.fn> }
  return {
    config: config(), identity: lineIdentity, lineIdentity,
    store: {} as MiniAppStore, jera, coordinator,
  }
}

function config(): PmcMiniAppServerConfig {
  return {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'booking-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
  }
}

async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit,
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
const SCHEDULER_EMAIL = 'pmc-scheduler@synthetic-project.iam.gserviceaccount.com'
