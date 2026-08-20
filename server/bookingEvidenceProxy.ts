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
