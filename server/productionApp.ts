import { timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

export type ProductionMiddleware = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export interface ProductionAppDependencies {
  distDir?: string
  basicAuthUser?: string
  basicAuthPassword?: string
  allowUnauthenticated?: boolean
  metaApi: ProductionMiddleware
  openAiApi: ProductionMiddleware
  pageAutomationApi: ProductionMiddleware
  bookingLineWebhook: ProductionMiddleware
  ocrLedger?: ProductionMiddleware
  pmcMiniApp?: ProductionMiddleware
}

const OCR_API_PATHS = new Set([
  '/api/ocr-ledger/webhook',
  '/api/ocr-ledger/client-config',
  '/api/ocr-ledger/review',
  '/api/ocr-ledger/image',
])
const ASYNC_WORKER_PATH = '/internal/mini-app/finalize-booking'
const EXPENSE_RECOVERY_PATH = '/internal/mini-app/recover-expenses'
const JERA_ALLOCATION_WORKER_PATH = '/internal/mini-app/jera-allocation-worker'
const FINANCE_DAILY_SEED_PATH = '/internal/mini-app/finance-daily-seed'

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
}

export function createProductionRequestHandler(deps: ProductionAppDependencies) {
  const distDir = resolve(deps.distDir ?? resolve(process.cwd(), 'dist'))
  const indexHtml = join(distDir, 'index.html')
  const ocrReviewDir = join(distDir, 'ocr-review')
  const miniAppDir = join(distDir, 'mini-app')
  const basicAuthUser = deps.basicAuthUser ?? 'pmc'
  const basicAuthPassword = deps.basicAuthPassword ?? ''
  const allowUnauthenticated = deps.allowUnauthenticated ?? false

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.url === '/healthz' || req.url === '/api/healthz') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && req.url === '/api/booking-line/webhook') {
      try {
        await deps.bookingLineWebhook(req, res)
      } catch {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Booking LINE webhook failed' }))
      }
      return
    }

    if (req.url === ASYNC_WORKER_PATH || req.url === EXPENSE_RECOVERY_PATH
      || req.url === JERA_ALLOCATION_WORKER_PATH || req.url === FINANCE_DAILY_SEED_PATH) {
      if (!deps.pmcMiniApp) {
        jsonError(res, 503, 'Mini App is not configured')
        return
      }
      try {
        await deps.pmcMiniApp(req, res)
      } catch {
        jsonError(res, 500, 'Mini App route failed')
      }
      return
    }

    const pathname = requestPathname(req.url)
    if (pathname && OCR_API_PATHS.has(pathname)) {
      if (!deps.ocrLedger) {
        res.statusCode = 503
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'OCR ledger is not configured' }))
        return
      }
      try {
        await deps.ocrLedger(req, res)
      } catch {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'OCR ledger route failed' }))
      }
      return
    }

    if (pathname && isOcrReviewPath(pathname)) {
      await serveOcrReview(req, res, pathname, ocrReviewDir)
      return
    }

    if (pathname && isMiniAppApiPath(pathname)) {
      if (!deps.pmcMiniApp) {
        jsonError(res, 503, 'Mini App is not configured')
        return
      }
      try {
        await deps.pmcMiniApp(req, res)
      } catch {
        jsonError(res, 500, 'Mini App route failed')
      }
      return
    }

    if (pathname && isMiniAppPath(pathname)) {
      await serveMiniApp(req, res, pathname, miniAppDir)
      return
    }

    if (!isBasicAuthAllowed(req.headers.authorization, {
      basicAuthUser, basicAuthPassword, allowUnauthenticated,
    })) {
      res.statusCode = 401
      res.setHeader('www-authenticate', 'Basic realm="PMC Ads Agent", charset="UTF-8"')
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(basicAuthPassword ? 'Authentication required' : 'APP_BASIC_AUTH_PASSWORD required')
      return
    }

    if (req.url?.startsWith('/api/meta/')) {
      await deps.metaApi(req, res)
      return
    }

    if (req.url?.startsWith('/api/ai/')) {
      await deps.openAiApi(req, res)
      return
    }

    if (req.url?.startsWith('/api/page-automation/')) {
      await deps.pageAutomationApi(req, res)
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const decodedPathname = decodeURIComponent(requestUrl.pathname)
      const staticPath = decodedPathname === '/' ? indexHtml : resolve(distDir, `.${decodedPathname}`)

      if (!isWithin(distDir, staticPath)) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }

      const filePath = await resolveStaticFile(staticPath)
      serveStaticFile(req, res, filePath, join(distDir, 'assets'))
    } catch (error) {
      if (isAssetRequest(req.url || '')) {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      try {
        const html = await readFile(indexHtml, 'utf-8')
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-cache')
        res.end(html)
      } catch {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Production server failed' }))
      }
    }
  }
}

async function serveMiniApp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  miniAppDir: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    jsonError(res, 405, 'Method not allowed')
    return
  }

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    res.statusCode = 400
    res.end('Invalid path')
    return
  }

  const relativePath = decodedPathname === '/mini-app' || decodedPathname === '/mini-app/'
    ? 'index.html'
    : decodedPathname.slice('/mini-app/'.length)
  const staticPath = resolve(miniAppDir, relativePath)
  if (!isWithin(miniAppDir, staticPath)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    const filePath = await resolveStaticFile(staticPath)
    serveStaticFile(req, res, filePath, join(miniAppDir, 'assets'))
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

async function serveOcrReview(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  ocrReviewDir: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    res.statusCode = 400
    res.end('Invalid path')
    return
  }

  const relativePath = decodedPathname === '/ocr-review' || decodedPathname === '/ocr-review/'
    ? 'index.html'
    : decodedPathname.slice('/ocr-review/'.length)
  const staticPath = resolve(ocrReviewDir, relativePath)
  if (!isWithin(ocrReviewDir, staticPath)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    const filePath = await resolveStaticFile(staticPath)
    serveStaticFile(req, res, filePath, join(ocrReviewDir, 'assets'))
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  cacheableAssetDir: string,
): void {
  const extension = extname(filePath)
  res.statusCode = 200
  res.setHeader('content-type', contentTypes[extension] || 'application/octet-stream')
  res.setHeader('cache-control', isWithin(cacheableAssetDir, filePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache')

  if (req.method === 'HEAD') {
    res.end('')
    return
  }

  createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) res.statusCode = 500
      res.end('Static file read failed')
    })
    .pipe(res)
}

async function resolveStaticFile(pathname: string): Promise<string> {
  const fileStat = await stat(pathname)
  return fileStat.isDirectory() ? join(pathname, 'index.html') : pathname
}

function requestPathname(url: string | undefined): string | null {
  try {
    return new URL(url || '/', 'http://localhost').pathname
  } catch {
    return null
  }
}

function isOcrReviewPath(pathname: string): boolean {
  return pathname === '/ocr-review' || pathname === '/ocr-review/' || pathname.startsWith('/ocr-review/')
}

function isMiniAppApiPath(pathname: string): boolean {
  return pathname === '/api/mini-app' || pathname.startsWith('/api/mini-app/')
    || pathname === '/internal/mini-app/jera-sync'
}

function isMiniAppPath(pathname: string): boolean {
  return pathname === '/mini-app' || pathname === '/mini-app/' || pathname.startsWith('/mini-app/')
}

function isWithin(root: string, pathname: string): boolean {
  return pathname === root || pathname.startsWith(`${root}${sep}`)
}

function isAssetRequest(url: string): boolean {
  return extname(new URL(url, 'http://localhost').pathname) !== ''
}

function jsonError(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error }))
}

function isBasicAuthAllowed(
  authorization: string | undefined,
  config: { basicAuthUser: string; basicAuthPassword: string; allowUnauthenticated: boolean },
): boolean {
  if (!config.basicAuthPassword) return config.allowUnauthenticated
  if (!authorization?.startsWith('Basic ')) return false

  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf-8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex === -1) return false

    const user = decoded.slice(0, separatorIndex)
    const password = decoded.slice(separatorIndex + 1)
    return safeEqual(user, config.basicAuthUser) && safeEqual(password, config.basicAuthPassword)
  } catch {
    return false
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
