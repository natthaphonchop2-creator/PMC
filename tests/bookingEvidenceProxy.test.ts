import { describe, expect, it } from 'vitest'
import {
  createBookingEvidenceProxyHandler,
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
