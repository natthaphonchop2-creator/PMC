import type { IncomingMessage } from 'node:http'
import Busboy from 'busboy'
import { MiniAppEvidenceError, type ParsedEvidenceFile, validateEvidence } from './evidence.js'

export interface EvidenceBatch {
  paymentFiles: ParsedEvidenceFile[]
  chatFiles: ParsedEvidenceFile[]
  totalBytes: number
}

export function consumeEvidenceBatchMultipart(
  req: IncomingMessage,
  limits: {
    maxFilesPerKind: 10
    maxFileBytes: 10_000_000
    maxTotalBytes: 25_000_000
  },
): Promise<EvidenceBatch> {
  return new Promise((resolve, reject) => {
    if (limits.maxFilesPerKind !== 10 || limits.maxFileBytes !== 10_000_000 || limits.maxTotalBytes !== 25_000_000) {
      reject(new MiniAppEvidenceError('INVALID_EVIDENCE_LIMIT'))
      return
    }

    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: limits.maxFilesPerKind * 2,
          fileSize: limits.maxFileBytes + 1,
          fields: 0,
          parts: limits.maxFilesPerKind * 2,
        },
      })
    } catch {
      reject(new MiniAppEvidenceError('INVALID_MULTIPART'))
      return
    }

    const paymentFiles: ParsedEvidenceFile[] = []
    const chatFiles: ParsedEvidenceFile[] = []
    let paymentFileCount = 0
    let chatFileCount = 0
    let totalBytes = 0
    let failure: MiniAppEvidenceError | null = null
    let finished = false

    const fail = (code: string) => { failure ??= new MiniAppEvidenceError(code) }
    const finish = () => {
      if (finished) return
      finished = true
      if (failure) reject(failure)
      else if (paymentFiles.length === 0) reject(new MiniAppEvidenceError('PAYMENT_EVIDENCE_REQUIRED'))
      else if (chatFiles.length === 0) reject(new MiniAppEvidenceError('CHAT_EVIDENCE_REQUIRED'))
      else resolve({ paymentFiles, chatFiles, totalBytes })
    }

    parser.on('file', (fieldName, stream, info) => {
      const target = fieldName === 'paymentFiles' ? paymentFiles : fieldName === 'chatFiles' ? chatFiles : null
      const kind = fieldName === 'paymentFiles' ? 'PAYMENT' : fieldName === 'chatFiles' ? 'CHAT' : null
      if (!target || !kind) {
        fail('UNKNOWN_MULTIPART_FIELD')
        stream.resume()
        return
      }
      const count = kind === 'PAYMENT' ? paymentFileCount : chatFileCount
      if (count >= limits.maxFilesPerKind) {
        fail(`${kind}_EVIDENCE_LIMIT`)
        stream.resume()
        return
      }

      const index = count
      if (kind === 'PAYMENT') paymentFileCount += 1
      else chatFileCount += 1
      const chunks: Buffer[] = []
      let limited = false
      let fileBytes = 0
      stream.on('limit', () => { limited = true })
      stream.on('data', (chunk: Buffer) => {
        const bytes = Buffer.from(chunk)
        fileBytes += bytes.length
        totalBytes += bytes.length
        if (totalBytes > limits.maxTotalBytes) fail('EVIDENCE_BATCH_TOO_LARGE')
        if (!failure || failure.code !== 'EVIDENCE_BATCH_TOO_LARGE') chunks.push(bytes)
      })
      stream.on('error', () => fail('INVALID_MULTIPART'))
      stream.on('end', () => {
        if (limited || fileBytes > limits.maxFileBytes) {
          fail('EVIDENCE_TOO_LARGE')
          return
        }
        if (failure) return
        const parsed: ParsedEvidenceFile = {
          bytes: Buffer.concat(chunks),
          advertisedMime: info.mimeType,
          originalName: info.filename,
        }
        try {
          validateEvidence(parsed.bytes, parsed.advertisedMime)
          target[index] = parsed
        } catch (error) {
          failure = error instanceof MiniAppEvidenceError ? error : new MiniAppEvidenceError('UNSUPPORTED_EVIDENCE')
        }
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
