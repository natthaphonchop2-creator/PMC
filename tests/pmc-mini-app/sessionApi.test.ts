import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { createEnrollmentService, type EnrollmentStore } from '../../server/pmc-mini-app/enrollment'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'

describe('PMC Mini App session and configuration API', () => {
  it('returns only the Mini App ID publicly and protects operational configuration', async () => {
    const middleware = createPmcMiniAppMiddleware(dependencies())

    const clientConfig = await invoke(middleware, '/api/mini-app/client-config')
    const protectedConfig = await invoke(middleware, '/api/mini-app/config')

    expect({ status: clientConfig.status, body: await clientConfig.json() }).toEqual({
      status: 200, body: { miniAppId: '2001234567-mini-app' },
    })
    expect({ status: protectedConfig.status, body: await protectedConfig.json() }).toEqual({
      status: 401, body: { error: 'MINI_APP_UNAUTHORIZED' },
    })
  })

  it('returns the verified active staff session without email or LINE ID', async () => {
    const response = await invoke(createPmcMiniAppMiddleware(dependencies()), '/api/mini-app/session', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect({ status: response.status, body }).toEqual({
      status: 200,
      body: { staffId: 'staff-1', displayName: 'มัส', active: true },
    })
    expect(JSON.stringify(body)).not.toContain('private@example.com')
    expect(JSON.stringify(body)).not.toContain('Uactive')
  })

  it('rejects a valid LINE user without an active staff mapping', async () => {
    const response = await invoke(createPmcMiniAppMiddleware(dependencies()), '/api/mini-app/session', {
      headers: { authorization: 'Bearer unknown-staff-token' },
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 403, body: { error: 'STAFF_NOT_ALLOWED' },
    })
  })

  it('links an unknown LINE account once with a valid company PIN', async () => {
    const middleware = createPmcMiniAppMiddleware(enrollmentDependencies())
    const options = await invoke(middleware, '/api/mini-app/enrollment-options', {
      headers: { authorization: 'Bearer unknown-staff-token' },
    })
    const denied = await invoke(middleware, '/api/mini-app/enroll', {
      method: 'POST',
      headers: { authorization: 'Bearer unknown-staff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: 'staff-open', pin: '000000' }),
    })
    const linked = await invoke(middleware, '/api/mini-app/enroll', {
      method: 'POST',
      headers: { authorization: 'Bearer unknown-staff-token', 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: 'staff-open', pin: '482731' }),
    })
    const session = await invoke(middleware, '/api/mini-app/session', {
      headers: { authorization: 'Bearer unknown-staff-token' },
    })

    expect({ status: options.status, body: await options.json() }).toEqual({
      status: 200, body: { staff: [{ id: 'staff-open', name: 'หมวย' }] },
    })
    expect({ status: denied.status, body: await denied.json() }).toEqual({
      status: 403, body: { error: 'ENROLLMENT_DENIED' },
    })
    expect({ status: linked.status, body: await linked.json() }).toEqual({
      status: 200, body: { staffId: 'staff-open', displayName: 'หมวย', active: true },
    })
    expect({ status: session.status, body: await session.json() }).toEqual({
      status: 200, body: { staffId: 'staff-open', displayName: 'หมวย', active: true },
    })
  })

  it('returns only active public booking choices and the explicit no-AE option', async () => {
    const response = await invoke(createPmcMiniAppMiddleware(dependencies()), '/api/mini-app/config', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect(body).toEqual({
      fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
      reportingEnabled: false,
      financeReportsEnabled: false,
      stockEnabled: false,
      expenseCaptureEnabled: false,
      financeReadsEnabled: false,
      canManageStock: false,
      canSubmitExpense: true,
      canViewFinance: false,
      canManageExpense: true,
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-1', name: 'มัส' }],
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('Uactive')
    expect(serialized).not.toContain('private-calendar')
  })

  it.each([
    ['flag off, no JERA', false, null, false, false],
    ['flag on, no JERA', true, null, false, false],
    ['flag off, legacy JERA only', false, false, true, false],
    ['flag on, legacy JERA only', true, false, true, false],
    ['flag off, finance service ready', false, true, true, false],
    ['flag on, finance service ready', true, true, true, true],
  ] as const)('uses the complete finance flag/capability truth table: %s', async (_case, flag, financeReady, reportingEnabled, financeReportsEnabled) => {
    const response = await invoke(createPmcMiniAppMiddleware({
      ...dependencies(),
      config: { ...dependencies().config, financeReportsEnabled: flag },
      ...(financeReady === null ? {} : { jera: {
        handle: vi.fn(), handleInternal: vi.fn(), financeServiceReady: financeReady,
      } }),
    }), '/api/mini-app/config', { headers: { authorization: 'Bearer valid-token' } })

    expect(await response.json()).toMatchObject({ reportingEnabled, financeReportsEnabled })
  })
})

function dependencies(): {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
} {
  const identity: LineIdentityPort = {
    async verify(idToken) {
      if (idToken === 'valid-token') return { lineUserId: 'Uactive' }
      if (idToken === 'unknown-staff-token') return { lineUserId: 'Uunknown' }
      throw new Error('invalid token')
    },
  }
  const store = {
    getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => lineUserId === 'Uactive' ? ({
      id: 'staff-1', name: 'มัส', email: 'private@example.com', lineUserId: 'Uactive',
      canCloseBooking: true, canBeAe: true, canManageStock: false,
      canSubmitExpense: true, canViewFinance: false, canManageExpense: true,
      active: true as const, profileImageUrl: null,
    }) : null),
    getActiveBookingConfig: vi.fn(async () => ({
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      aes: [{ id: 'staff-1', name: 'มัส' }],
    })),
  } as unknown as MiniAppStore
  return {
    config: {
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
      financeReportsEnabled: false,
    },
    identity,
    store,
  }
}

function enrollmentDependencies() {
  const deps = dependencies()
  let linked = false
  const enrollmentStore: EnrollmentStore = {
    async listUnlinkedBookingStaff() { return linked ? [] : [{ id: 'staff-open', name: 'หมวย' }] },
    async consumeEnrollmentAttempt(_lineUserIdHash, pinAccepted) {
      return { allowed: pinAccepted, retryAfterSeconds: 0 }
    },
    async linkLineUserToStaff(staffId, lineUserId) {
      if (linked) throw new Error('STAFF_ALREADY_LINKED')
      linked = true
      return {
        id: staffId, name: 'หมวย', email: '', lineUserId, canCloseBooking: true, canBeAe: true,
        canManageStock: false, canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
        active: true as const, profileImageUrl: null,
      }
    },
  }
  const originalLookup = deps.store.getActiveStaffByLineUserId.bind(deps.store)
  deps.store.getActiveStaffByLineUserId = async (lineUserId) => {
    if (linked && lineUserId === 'Uunknown') return {
      id: 'staff-open', name: 'หมวย', email: '', lineUserId, canCloseBooking: true, canBeAe: true,
      canManageStock: false, canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
      active: true, profileImageUrl: null,
    }
    return originalLookup(lineUserId)
  }
  return {
    ...deps,
    enrollment: createEnrollmentService({ pin: '482731', signingSecret: 'signing-secret', store: enrollmentStore }),
  }
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
