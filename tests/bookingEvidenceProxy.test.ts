import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import sharp from 'sharp'
import {
  createBookingEvidenceProxyHandler,
  createBookingEvidenceProxyMiddleware,
  createSharpBookingEvidencePreviewPort,
  type BookingEvidenceDrivePort,
  type BookingEvidencePreviewPort,
} from '../server/bookingEvidenceProxy'
import {
  signBookingEvidenceToken,
  type BookingEvidenceTokenPayload,
} from '../server/bookingEvidenceToken'

const secret = 'unit-test-secret'
const basePayload: BookingEvidenceTokenPayload = {
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}
const previewToken = signBookingEvidenceToken(basePayload, secret)

async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  url: string,
  method = 'GET',
) {
  const headers: Record<string, string> = {}
  let body = Buffer.alloc(0)
  const req = { method, url, headers: {} } as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value)
    },
    end(value: string | Buffer = '') {
      body = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
    },
  } as unknown as ServerResponse
  await middleware(req, res)
  return { status: res.statusCode, headers, body }
}

function dependencies(options: {
  metadata?: Partial<Awaited<ReturnType<BookingEvidenceDrivePort['metadata']>>>
  metadataError?: Error
  downloadError?: Error
  previewError?: Error
} = {}) {
  let downloads = 0
  const drive: BookingEvidenceDrivePort = {
    async metadata() {
      if (options.metadataError) throw options.metadataError
      return {
        mimeType: 'image/png',
        size: 100,
        trashed: false,
        ...options.metadata,
      }
    },
    async download() {
      downloads += 1
      if (options.downloadError) throw options.downloadError
      return Buffer.from('private-image')
    },
  }
  const preview: BookingEvidencePreviewPort = {
    async jpegPreview() {
      if (options.previewError) throw options.previewError
      return Buffer.from('preview-jpeg')
    },
  }
  return { drive, preview, downloads: () => downloads }
}

describe('booking evidence proxy handler', () => {
  it('returns a JPEG preview only after signature verification', async () => {
    const deps = dependencies()
    const handler = createBookingEvidenceProxyHandler({ signingSecret: secret, ...deps })

    expect(await handler(previewToken)).toEqual({
      status: 200,
      contentType: 'image/jpeg',
      body: Buffer.from('preview-jpeg'),
    })
    expect(deps.downloads()).toBe(1)
  })

  it('returns the full allowed source image without preview conversion', async () => {
    const deps = dependencies()
    let previews = 0
    deps.preview.jpegPreview = async () => {
      previews += 1
      return Buffer.alloc(0)
    }
    const handler = createBookingEvidenceProxyHandler({ signingSecret: secret, ...deps })
    const token = signBookingEvidenceToken({ ...basePayload, variant: 'full' }, secret)

    expect(await handler(token)).toEqual({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('private-image'),
    })
    expect(previews).toBe(0)
  })

  it('rejects invalid signature before a Drive call', async () => {
    const deps = dependencies()
    const handler = createBookingEvidenceProxyHandler({ signingSecret: secret, ...deps })
    const result = await handler(`${previewToken.slice(0, -1)}0`)

    expect(result).toEqual({
      status: 403,
      contentType: 'application/json; charset=utf-8',
      body: { error: 'Forbidden' },
    })
    expect(deps.downloads()).toBe(0)
  })

  it('returns 404 for missing or trashed Drive files', async () => {
    const missing = dependencies({ metadataError: new Error('provider file id secret') })
    const trashed = dependencies({ metadata: { trashed: true } })

    expect((await createBookingEvidenceProxyHandler({ signingSecret: secret, ...missing })(previewToken)).status).toBe(404)
    expect((await createBookingEvidenceProxyHandler({ signingSecret: secret, ...trashed })(previewToken)).status).toBe(404)
    expect(missing.downloads()).toBe(0)
    expect(trashed.downloads()).toBe(0)
  })

  it('rejects unsupported MIME and oversized files before download', async () => {
    const unsupported = dependencies({ metadata: { mimeType: 'application/pdf' } })
    const oversized = dependencies({ metadata: { size: 10_000_001 } })

    expect((await createBookingEvidenceProxyHandler({ signingSecret: secret, ...unsupported })(previewToken)).status).toBe(415)
    expect((await createBookingEvidenceProxyHandler({ signingSecret: secret, ...oversized })(previewToken)).status).toBe(413)
    expect(unsupported.downloads()).toBe(0)
    expect(oversized.downloads()).toBe(0)
  })

  it('returns generic 502 errors without token, file ID, or provider detail', async () => {
    const downloadFailure = dependencies({ downloadError: new Error('file_ABC123xyz provider detail') })
    const previewFailure = dependencies({ previewError: new Error('file_ABC123xyz decoder detail') })

    for (const deps of [downloadFailure, previewFailure]) {
      const result = await createBookingEvidenceProxyHandler({ signingSecret: secret, ...deps })(previewToken)
      const serialized = JSON.stringify(result)
      expect(result.status).toBe(502)
      expect(serialized).not.toContain(previewToken)
      expect(serialized).not.toContain('file_ABC123xyz')
      expect(serialized).not.toContain('provider detail')
      expect(serialized).not.toContain('decoder detail')
    }
  })
})

describe('booking evidence proxy middleware', () => {
  const fakeDependencies = dependencies()

  it('stays safely unavailable before both server secrets are configured', async () => {
    const middleware = createBookingEvidenceProxyMiddleware({}, fakeDependencies)
    const response = await invoke(middleware, `/api/booking-evidence/image?t=${previewToken}`)

    expect(response.status).toBe(503)
    expect(response.body.toString()).toContain('not configured')
    expect(response.body.toString()).not.toContain(previewToken)
  })

  it('serves a valid signed preview with hardened headers', async () => {
    const middleware = createBookingEvidenceProxyMiddleware(
      {
        BOOKING_MEDIA_SIGNING_SECRET: secret,
        BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
      },
      fakeDependencies,
    )
    const response = await invoke(middleware, `/api/booking-evidence/image?t=${previewToken}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(Buffer.from('preview-jpeg'))
    expect(response.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    })
  })

  it('supports HEAD and rejects missing tokens or unsupported methods', async () => {
    const middleware = createBookingEvidenceProxyMiddleware(
      {
        BOOKING_MEDIA_SIGNING_SECRET: secret,
        BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
      },
      fakeDependencies,
    )

    expect((await invoke(middleware, '/api/booking-evidence/image')).status).toBe(400)
    expect((await invoke(middleware, `/api/booking-evidence/image?t=${previewToken}`, 'POST')).status).toBe(405)
    const head = await invoke(middleware, `/api/booking-evidence/image?t=${previewToken}`, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toEqual(Buffer.alloc(0))
    expect(head.headers['content-type']).toBe('image/jpeg')
  })
})

describe('booking evidence Sharp preview', () => {
  it('returns a mobile-safe JPEG inside 1024x1024 and below 1 MB', async () => {
    const source = await sharp({
      create: {
        width: 1_600,
        height: 1_200,
        channels: 3,
        background: { r: 240, g: 210, b: 210 },
      },
    })
      .png()
      .toBuffer()

    const output = await createSharpBookingEvidencePreviewPort().jpegPreview(source)
    const metadata = await sharp(output).metadata()

    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBeLessThanOrEqual(1_024)
    expect(metadata.height).toBeLessThanOrEqual(1_024)
    expect(output.byteLength).toBeLessThan(1_000_000)
  })
})
