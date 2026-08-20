import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createBookingEvidenceProxyMiddleware } from './bookingEvidenceProxy.js'

type EvidenceMiddleware = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function createBookingEvidenceRequestHandler(evidenceProxy: EvidenceMiddleware) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.url === '/health') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.end(JSON.stringify({ ok: true }))
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
  const server = createServer(createBookingEvidenceRequestHandler(evidenceProxy))
  server.listen(port, host, () => {
    console.log(`PMC Booking Evidence Proxy running on http://${host}:${port}`)
  })
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false
if (isMain) startServer()
