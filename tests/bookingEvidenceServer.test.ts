import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createBookingEvidenceRequestHandler } from '../server/bookingEvidenceServer'

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  url: string,
) {
  let body = ''
  const headers: Record<string, string> = {}
  const req = { method: 'GET', url, headers: {} } as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = String(value) },
    end(value = '') { body = String(value) },
  } as unknown as ServerResponse
  await handler(req, res)
  return { status: res.statusCode, body, headers }
}

describe('dedicated booking evidence server', () => {
  it('serves health without invoking the evidence proxy', async () => {
    let proxyCalls = 0
    const handler = createBookingEvidenceRequestHandler(async () => { proxyCalls += 1 })
    const response = await invoke(handler, '/healthz')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(proxyCalls).toBe(0)
  })

  it('delegates only the evidence path and returns 404 elsewhere', async () => {
    let proxyCalls = 0
    const handler = createBookingEvidenceRequestHandler(async (_req, res) => {
      proxyCalls += 1
      res.statusCode = 403
      res.end('proxy')
    })

    expect((await invoke(handler, '/api/booking-evidence/image?t=test')).status).toBe(403)
    expect(proxyCalls).toBe(1)
    expect((await invoke(handler, '/')).status).toBe(404)
    expect(proxyCalls).toBe(1)
  })
})
