import type { IncomingMessage } from 'node:http'
import Busboy from 'busboy'
import type { MiniAppEvidenceKind, MiniAppEvidenceMime } from './googleClient.js'

export interface ParsedEvidenceFile {
  bytes: Buffer
  advertisedMime: string
  originalName: string
}

export class MiniAppEvidenceError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'MiniAppEvidenceError'
    this.code = code
  }
}

export function validateEvidence(bytes: Buffer, advertisedMime: string): MiniAppEvidenceMime {
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (advertisedMime === 'image/jpeg' && isJpeg) return 'image/jpeg'
  if (advertisedMime === 'image/png' && isPng) return 'image/png'
  throw new MiniAppEvidenceError('UNSUPPORTED_EVIDENCE')
}

export function serverEvidenceName(kind: MiniAppEvidenceKind, mimeType: MiniAppEvidenceMime, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new MiniAppEvidenceError('INVALID_EVIDENCE_ID')
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  return `${kind.toLowerCase()}-${id}.${extension}`
}

export function consumeEvidenceMultipart(
  req: IncomingMessage,
  limits: { maxFiles: number; maxFileBytes: number },
  onFile: (file: ParsedEvidenceFile) => Promise<void>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(limits.maxFiles) || limits.maxFiles < 1 || limits.maxFiles > 10
      || !Number.isSafeInteger(limits.maxFileBytes) || limits.maxFileBytes < 1 || limits.maxFileBytes > 10_000_000) {
      reject(new MiniAppEvidenceError('INVALID_EVIDENCE_LIMIT'))
      return
    }

    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: limits.maxFiles, fileSize: limits.maxFileBytes, fields: 0, parts: limits.maxFiles },
      })
    } catch {
      reject(new MiniAppEvidenceError('INVALID_MULTIPART'))
      return
    }

    let fileCount = 0
    let failure: MiniAppEvidenceError | null = null
    let processing = Promise.resolve()
    let finished = false

    const fail = (code: string) => { failure ??= new MiniAppEvidenceError(code) }
    const finish = () => {
      if (finished) return
      finished = true
      void processing.then(() => {
        if (failure) reject(failure)
        else if (fileCount === 0) reject(new MiniAppEvidenceError('EVIDENCE_REQUIRED'))
        else resolve(fileCount)
      })
    }

    parser.on('file', (fieldName, stream, info) => {
      fileCount += 1
      if (fieldName !== 'files') {
        fail('UNKNOWN_MULTIPART_FIELD')
        stream.resume()
        return
      }
      const chunks: Buffer[] = []
      let limited = false
      stream.on('limit', () => { limited = true })
      stream.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
      stream.on('error', () => fail('INVALID_MULTIPART'))
      stream.on('end', () => {
        if (limited) {
          fail('EVIDENCE_TOO_LARGE')
          return
        }
        const parsed: ParsedEvidenceFile = {
          bytes: Buffer.concat(chunks),
          advertisedMime: info.mimeType,
          originalName: info.filename,
        }
        processing = processing.then(async () => {
          if (failure) return
          try {
            await onFile(parsed)
          } catch (error) {
            failure = error instanceof MiniAppEvidenceError
              ? error
              : new MiniAppEvidenceError('EVIDENCE_UPLOAD_FAILED')
          }
        })
      })
    })
    parser.on('field', () => fail('UNKNOWN_MULTIPART_FIELD'))
    parser.on('fieldsLimit', () => fail('UNKNOWN_MULTIPART_FIELD'))
    parser.on('filesLimit', () => fail('EVIDENCE_FILE_LIMIT'))
    parser.on('partsLimit', () => fail('EVIDENCE_FILE_LIMIT'))
    parser.on('error', () => fail('INVALID_MULTIPART'))
    parser.on('close', finish)
    req.on('aborted', () => { fail('INVALID_MULTIPART'); finish() })
    req.on('error', () => { fail('INVALID_MULTIPART'); finish() })
    req.pipe(parser)
  })
}
