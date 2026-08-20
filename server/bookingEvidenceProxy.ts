import type { IncomingMessage, ServerResponse } from 'node:http'
import { google } from 'googleapis'
import type { JWTInput } from 'google-auth-library'
import sharp from 'sharp'
import { verifyBookingEvidenceToken } from './bookingEvidenceToken.js'

export interface BookingEvidenceDrivePort {
  metadata(fileId: string): Promise<{ mimeType: string; size: number; trashed: boolean }>
  download(fileId: string): Promise<Buffer>
}

export interface BookingEvidencePreviewPort {
  jpegPreview(input: Buffer): Promise<Buffer>
}

export interface BookingEvidenceProxyResult {
  status: number
  contentType: string
  body: Buffer | { error: string }
}

export function createBookingEvidenceProxyHandler(config: {
  signingSecret: string
  drive: BookingEvidenceDrivePort
  preview: BookingEvidencePreviewPort
}) {
  return async (token: string): Promise<BookingEvidenceProxyResult> => {
    let payload
    try {
      payload = verifyBookingEvidenceToken(token, config.signingSecret)
    } catch {
      return {
        status: 403,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Forbidden' },
      }
    }

    let metadata
    try {
      metadata = await config.drive.metadata(payload.fileId)
    } catch {
      return {
        status: 404,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Not found' },
      }
    }

    if (metadata.trashed) {
      return {
        status: 404,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Not found' },
      }
    }
    if (!['image/jpeg', 'image/png'].includes(metadata.mimeType)) {
      return {
        status: 415,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Unsupported media' },
      }
    }
    if (metadata.size > 10_000_000) {
      return {
        status: 413,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Media too large' },
      }
    }

    let source
    try {
      source = await config.drive.download(payload.fileId)
    } catch {
      return {
        status: 502,
        contentType: 'application/json; charset=utf-8',
        body: { error: 'Media unavailable' },
      }
    }

    if (payload.variant === 'preview') {
      try {
        return {
          status: 200,
          contentType: 'image/jpeg',
          body: await config.preview.jpegPreview(source),
        }
      } catch {
        return {
          status: 502,
          contentType: 'application/json; charset=utf-8',
          body: { error: 'Media unavailable' },
        }
      }
    }

    return { status: 200, contentType: metadata.mimeType, body: source }
  }
}

interface BookingEvidenceProxyEnv {
  BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON?: string
  BOOKING_MEDIA_SIGNING_SECRET?: string
}

interface BookingEvidenceProxyDependencies {
  drive: BookingEvidenceDrivePort
  preview: BookingEvidencePreviewPort
}

export function createSharpBookingEvidencePreviewPort(): BookingEvidencePreviewPort {
  return {
    async jpegPreview(input) {
      return sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
    },
  }
}

function createRealDependencies(credentialJson: string): BookingEvidenceProxyDependencies {
  const credentials = JSON.parse(credentialJson) as JWTInput
  if (credentials.type !== 'service_account') throw new Error('Invalid Service Account configuration')
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  const api = google.drive({ version: 'v3', auth })
  return {
    drive: {
      async metadata(fileId) {
        const result = await api.files.get({ fileId, fields: 'mimeType,size,trashed' })
        return {
          mimeType: String(result.data.mimeType ?? ''),
          size: Number(result.data.size ?? 0),
          trashed: result.data.trashed === true,
        }
      },
      async download(fileId) {
        const result = await api.files.get(
          { fileId, alt: 'media' },
          { responseType: 'arraybuffer' },
        )
        return Buffer.from(result.data as ArrayBuffer)
      },
    },
    preview: createSharpBookingEvidencePreviewPort(),
  }
}

function jsonResponse(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error }))
}

export function createBookingEvidenceProxyMiddleware(
  env: BookingEvidenceProxyEnv,
  injected?: BookingEvidenceProxyDependencies,
) {
  const signingSecret = env.BOOKING_MEDIA_SIGNING_SECRET?.trim() ?? ''
  const credentialJson = env.BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? ''
  let dependencies: BookingEvidenceProxyDependencies | null = null
  if (signingSecret && credentialJson) {
    try {
      dependencies = injected ?? createRealDependencies(credentialJson)
    } catch {
      dependencies = null
    }
  }
  const handler = dependencies
    ? createBookingEvidenceProxyHandler({ signingSecret, ...dependencies })
    : null

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (!handler) {
      jsonResponse(res, 503, 'Booking evidence proxy is not configured')
      return
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      jsonResponse(res, 405, 'Method not allowed')
      return
    }

    const requestUrl = new URL(req.url ?? '', 'http://localhost')
    const token = requestUrl.searchParams.get('t') ?? ''
    if (!token) {
      jsonResponse(res, 400, 'Missing evidence token')
      return
    }

    const result = await handler(token)
    res.statusCode = result.status
    res.setHeader('content-type', result.contentType)
    if (Buffer.isBuffer(result.body)) {
      res.setHeader('content-disposition', 'inline')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(result.body)
      return
    }
    res.end(JSON.stringify(result.body))
  }
}
