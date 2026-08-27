import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProductionMiddleware } from '../productionApp.js'
import type { PmcMiniAppServerConfig } from './config.js'
import type { AuthenticatedMiniAppContext, LineIdentityPort } from './contracts.js'
import type { MiniAppStore } from './store.js'

export interface PmcMiniAppMiddlewareDependencies {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
}

export function createPmcMiniAppMiddleware(deps: PmcMiniAppMiddlewareDependencies): ProductionMiddleware {
  return async (req, res) => {
    applySecurityHeaders(res)
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      respond(res, 400, { error: 'MINI_APP_INVALID_REQUEST' })
      return
    }

    if (pathname === '/api/mini-app/client-config') {
      if (!requireGet(req, res)) return
      respond(res, 200, { miniAppId: deps.config.miniAppId })
      return
    }

    if (pathname !== '/api/mini-app/session' && pathname !== '/api/mini-app/config') {
      respond(res, 404, { error: 'MINI_APP_ROUTE_NOT_FOUND' })
      return
    }
    if (!requireGet(req, res)) return

    const authenticated = await authenticate(req, res, deps)
    if (!authenticated) return

    if (pathname === '/api/mini-app/session') {
      respond(res, 200, {
        staffId: authenticated.staffId,
        displayName: authenticated.displayName,
        active: true,
      })
      return
    }

    try {
      const bookingConfig = await deps.store.getActiveBookingConfig()
      respond(res, 200, {
        fallbackFormUrl: deps.config.fallbackFormUrl,
        doctors: bookingConfig.doctors,
        services: bookingConfig.services,
        channels: bookingConfig.channels,
        aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, ...bookingConfig.aes.filter(({ id }) => id !== 'NONE')],
      })
    } catch {
      respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    }
  }
}

async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PmcMiniAppMiddlewareDependencies,
): Promise<AuthenticatedMiniAppContext | null> {
  const idToken = bearerToken(req.headers.authorization)
  if (!idToken) {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
    return null
  }

  let lineUserId: string
  try {
    lineUserId = (await deps.identity.verify(idToken)).lineUserId
  } catch {
    respond(res, 401, { error: 'MINI_APP_UNAUTHORIZED' })
    return null
  }

  try {
    const staff = await deps.store.getActiveStaffByLineUserId(lineUserId)
    if (!staff) {
      respond(res, 403, { error: 'STAFF_NOT_ALLOWED' })
      return null
    }
    return { staffId: staff.id, displayName: staff.name, lineUserId }
  } catch {
    respond(res, 503, { error: 'MINI_APP_STORAGE_UNAVAILABLE' })
    return null
  }
}

function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length)
  return token.length > 0 && token.length <= 8_192 && !/\s/.test(token) ? token : null
}

function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  respond(res, 405, { error: 'MINI_APP_METHOD_NOT_ALLOWED' })
  return false
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
}

function respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
