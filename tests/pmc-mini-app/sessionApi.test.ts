import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
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

  it('returns only active public booking choices and the explicit no-AE option', async () => {
    const response = await invoke(createPmcMiniAppMiddleware(dependencies()), '/api/mini-app/config', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json()

    expect(body).toEqual({
      fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
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
      canCloseBooking: true, canBeAe: true, active: true as const, profileImageUrl: null,
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
      maxImageBytes: 10_000_000,
      maxFilesPerKind: 10,
    },
    identity,
    store,
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
