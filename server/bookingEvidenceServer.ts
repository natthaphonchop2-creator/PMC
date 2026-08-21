import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createBookingEvidenceProxyMiddleware } from './bookingEvidenceProxy.js'

type EvidenceMiddleware = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export interface StaticAsset {
  bytes: Buffer
  contentType: string
}

export type StaticAssetMap = Record<string, StaticAsset>

export function createBookingEvidenceRequestHandler(
  evidenceProxy: EvidenceMiddleware,
  logoPng: Buffer = Buffer.alloc(0),
  staticAssets: StaticAssetMap = {},
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.url === '/health') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const staticAsset = req.url ? staticAssets[req.url] : undefined
    if (staticAsset && ['GET', 'HEAD'].includes(req.method ?? '')) {
      res.statusCode = 200
      res.setHeader('content-type', staticAsset.contentType)
      res.setHeader('cache-control', 'public, max-age=86400, immutable')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(req.method === 'HEAD' ? undefined : staticAsset.bytes)
      return
    }
    if (
      req.url === '/assets/pmc-flex-logo-v1.png' &&
      ['GET', 'HEAD'].includes(req.method ?? '')
    ) {
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=86400, immutable')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(req.method === 'HEAD' ? undefined : logoPng)
      return
    }
    if (req.url?.startsWith('/api/booking-evidence/image')) {
      try {
        await evidenceProxy(req, res)
      } catch {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Booking evidence proxy failed' }))
      }
      return
    }
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}

function startServer() {
  const host = process.env.HOST || '0.0.0.0'
  const port = Number(process.env.PORT || 8080)
  const evidenceProxy = createBookingEvidenceProxyMiddleware(process.env)
  const logoPng = readFileSync(resolve('assets/pmc-flex-logo-v1.png'))
  const staffProfileNames = ['cat', 'mus', 'mint', 'waew', 'muay', 'eye'] as const
  const staffProfileAssets = Object.fromEntries(
    staffProfileNames.map((name) => [
      `/assets/staff-profiles/${name}.jpg`,
      {
        bytes: readFileSync(resolve(`assets/staff-profiles/${name}.jpg`)),
        contentType: 'image/jpeg',
      },
    ]),
  )
  const server = createServer(createBookingEvidenceRequestHandler(
    evidenceProxy,
    logoPng,
    staffProfileAssets,
  ))
  server.listen(port, host, () => {
    console.log(`PMC Booking Evidence Proxy running on http://${host}:${port}`)
  })
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false
if (isMain) startServer()
