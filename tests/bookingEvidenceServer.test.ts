import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createBookingEvidenceRequestHandler } from '../server/bookingEvidenceServer'

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  url: string,
  method = 'GET',
) {
  let bodyBuffer = Buffer.alloc(0)
  const headers: Record<string, string> = {}
  const req = { method, url, headers: {} } as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = String(value) },
    end(value: string | Buffer = '') {
      bodyBuffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
    },
  } as unknown as ServerResponse
  await handler(req, res)
  return { status: res.statusCode, body: bodyBuffer.toString(), bodyBuffer, headers }
}

describe('dedicated booking evidence server', () => {
  it('serves health without invoking the evidence proxy', async () => {
    let proxyCalls = 0
    const handler = createBookingEvidenceRequestHandler(async () => { proxyCalls += 1 })
    const response = await invoke(handler, '/health')
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

  it('serves the public PMC logo without invoking the evidence proxy', async () => {
    let proxyCalls = 0
    const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const handler = createBookingEvidenceRequestHandler(
      async () => { proxyCalls += 1 },
      logo,
    )
    const response = await invoke(handler, '/assets/pmc-flex-logo-v1.png')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toContain('public')
    expect(response.bodyBuffer).toEqual(logo)
    expect(proxyCalls).toBe(0)

    const head = await invoke(handler, '/assets/pmc-flex-logo-v1.png', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.bodyBuffer).toHaveLength(0)
  })

  it('serves only allowlisted circular staff profile assets', async () => {
    const mus = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
    const handler = createBookingEvidenceRequestHandler(
      async () => undefined,
      Buffer.alloc(0),
      {
        '/assets/staff-profiles/mus.jpg': { bytes: mus, contentType: 'image/jpeg' },
      },
    )

    const response = await invoke(handler, '/assets/staff-profiles/mus.jpg')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/jpeg')
    expect(response.headers['cache-control']).toContain('immutable')
    expect(response.bodyBuffer).toEqual(mus)

    const head = await invoke(handler, '/assets/staff-profiles/mus.jpg', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.bodyBuffer).toHaveLength(0)

    expect((await invoke(handler, '/assets/staff-profiles/unknown.jpg')).status).toBe(404)
    expect((await invoke(handler, '/assets/staff-profiles/../pmc-flex-logo-v1.png')).status).toBe(404)
  })
})
