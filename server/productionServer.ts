import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { extname, join, resolve } from 'node:path'
import { createMetaApiMiddleware } from './metaApiPlugin.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 4174)
const basicAuthUser = process.env.APP_BASIC_AUTH_USER || 'pmc'
const basicAuthPassword = process.env.APP_BASIC_AUTH_PASSWORD || ''
const distDir = resolve(process.cwd(), 'dist')
const indexHtml = join(distDir, 'index.html')
const metaApi = createMetaApiMiddleware(process.env)

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-cache')
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (!isBasicAuthAllowed(req.headers.authorization)) {
    res.statusCode = 401
    res.setHeader('www-authenticate', 'Basic realm="PMC Ads Agent", charset="UTF-8"')
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('Authentication required')
    return
  }

  if (req.url?.startsWith('/api/meta/')) {
    await metaApi(req, res)
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
    const pathname = decodeURIComponent(requestUrl.pathname)
    const staticPath = pathname === '/' ? indexHtml : resolve(distDir, `.${pathname}`)

    if (!staticPath.startsWith(distDir)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    const filePath = await resolveStaticFile(staticPath)
    const extension = extname(filePath)
    res.statusCode = 200
    res.setHeader('content-type', contentTypes[extension] || 'application/octet-stream')
    if (isCacheableAsset(filePath)) {
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    } else {
      res.setHeader('cache-control', 'no-cache')
    }

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
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Production server failed',
        }),
      )
    }
  }
})

server.listen(port, host, () => {
  console.log(`PMC Ads Agent running on http://${host}:${port}`)
})

async function resolveStaticFile(pathname: string) {
  const fileStat = await stat(pathname)
  if (fileStat.isDirectory()) return join(pathname, 'index.html')
  return pathname
}

function isAssetRequest(url: string) {
  return extname(new URL(url, 'http://localhost').pathname) !== ''
}

function isCacheableAsset(pathname: string) {
  return pathname.includes(`${distDir}/assets/`)
}

function isBasicAuthAllowed(authorization: string | undefined) {
  if (!basicAuthPassword) return true
  if (!authorization?.startsWith('Basic ')) return false

  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf-8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex === -1) return false

    const user = decoded.slice(0, separatorIndex)
    const password = decoded.slice(separatorIndex + 1)
    return safeEqual(user, basicAuthUser) && safeEqual(password, basicAuthPassword)
  } catch {
    return false
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
