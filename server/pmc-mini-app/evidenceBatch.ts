import type { IncomingMessage } from 'node:http'
import Busboy from 'busboy'
import type { BookingDraftInputV2 } from '../../src/apps/pmc-mini-app/contracts.js'
import { MiniAppEvidenceError, type ParsedEvidenceFile, validateEvidence } from './evidence.js'

export interface EvidenceBatch {
  paymentFiles: ParsedEvidenceFile[]
  chatFiles: ParsedEvidenceFile[]
  totalBytes: number
}

export type EvidenceBatchFile = ParsedEvidenceFile

export interface BookingPrepareLimits {
  maxFilesPerKind: 10
  maxFileBytes: 10_000_000
  maxDecodedBytes: 25_000_000
  maxRawBytes: 26_000_000
}

export interface ParsedBookingPrepare {
  protocolVersion: 2
  version: number
  input: BookingDraftInputV2
  paymentFiles: EvidenceBatchFile[]
  chatFiles: EvidenceBatchFile[]
}

export const BOOKING_PREPARE_LIMITS: BookingPrepareLimits = {
  maxFilesPerKind: 10,
  maxFileBytes: 10_000_000,
  maxDecodedBytes: 25_000_000,
  maxRawBytes: 26_000_000,
}

export function consumeBookingPrepareMultipart(
  req: IncomingMessage,
  limits: BookingPrepareLimits,
): Promise<ParsedBookingPrepare> {
  return new Promise((resolve, reject) => {
    const invalidLimit = invalidBookingPrepareLimit(limits)
    if (invalidLimit) {
      reject(new MiniAppEvidenceError(invalidLimit))
      return
    }

    const declaredLength = req.headers['content-length']
    if (declaredLength !== undefined) {
      const text = Array.isArray(declaredLength) ? '' : declaredLength
      const numeric = /^\d+$/.test(text) ? Number(text) : NaN
      if (!Number.isSafeInteger(numeric) || numeric < 0) {
        reject(new MiniAppEvidenceError('BOOKING_PREPARE_JSON_REQUIRED'))
        return
      }
      if (numeric > limits.maxRawBytes) {
        reject(new MiniAppEvidenceError('EVIDENCE_BATCH_TOO_LARGE'))
        return
      }
    }

    let parser: ReturnType<typeof Busboy> | null = null
    let settled = false
    let rawBytes = 0
    let totalBytes = 0
    let totalFileCount = 0
    let paymentFileCount = 0
    let chatFileCount = 0
    let inputSeen = false
    let parsedInput: ParsedBookingPrepare | null = null
    const paymentFiles: EvidenceBatchFile[] = []
    const chatFiles: EvidenceBatchFile[] = []

    const removeRequestListeners = () => {
      req.off('data', countRawChunk)
      req.off('aborted', onAborted)
      req.off('error', onRequestError)
    }
    const stop = () => {
      removeRequestListeners()
      if (parser) {
        const activeParser = parser
        req.unpipe(activeParser)
        queueMicrotask(() => {
          try {
            if (!activeParser.destroyed) activeParser.destroy()
          } catch {
            // The safe error has already settled the parser result.
          }
          if (!req.destroyed) req.resume()
        })
        return
      }
      if (!req.destroyed) req.resume()
    }
    const hardFail = (code: BookingPrepareErrorCode) => {
      if (settled) return
      settled = true
      stop()
      reject(new MiniAppEvidenceError(code))
    }
    const countRawChunk = (chunk: Buffer | string) => {
      if (settled) return
      rawBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (!Number.isSafeInteger(rawBytes) || rawBytes > limits.maxRawBytes) hardFail('EVIDENCE_BATCH_TOO_LARGE')
    }
    const onAborted = () => hardFail('BOOKING_PREPARE_JSON_REQUIRED')
    const onRequestError = () => hardFail('BOOKING_PREPARE_JSON_REQUIRED')

    req.on('data', countRawChunk)
    req.on('aborted', onAborted)
    req.on('error', onRequestError)

    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: limits.maxFilesPerKind * 2 + 1,
          fileSize: limits.maxFileBytes + 1,
          fields: 2,
          parts: limits.maxFilesPerKind * 2 + 3,
        },
      })
    } catch {
      hardFail('BOOKING_PREPARE_JSON_REQUIRED')
      return
    }

    parser.on('field', (fieldName, value, info) => {
      if (settled) return
      if (fieldName !== 'input' || inputSeen || info.nameTruncated || info.valueTruncated) {
        hardFail('BOOKING_PREPARE_JSON_REQUIRED')
        return
      }
      inputSeen = true
      parsedInput = parseBookingPrepareJson(value)
      if (!parsedInput) hardFail('BOOKING_PREPARE_JSON_REQUIRED')
    })
    parser.on('file', (fieldName, stream, info) => {
      stream.on('error', () => {
        if (!settled) hardFail('UNSUPPORTED_EVIDENCE')
      })
      if (settled) {
        stream.resume()
        return
      }
      const target = fieldName === 'paymentFiles' ? paymentFiles : fieldName === 'chatFiles' ? chatFiles : null
      if (!target) {
        hardFail('UNSUPPORTED_EVIDENCE')
        stream.resume()
        return
      }
      if (info.mimeType !== 'image/jpeg' && info.mimeType !== 'image/png') {
        hardFail('UNSUPPORTED_EVIDENCE')
        stream.resume()
        return
      }

      totalFileCount += 1
      if (fieldName === 'paymentFiles') paymentFileCount += 1
      else chatFileCount += 1
      if (totalFileCount > limits.maxFilesPerKind * 2
        || paymentFileCount > limits.maxFilesPerKind
        || chatFileCount > limits.maxFilesPerKind) {
        hardFail('EVIDENCE_FILE_LIMIT')
        stream.resume()
        return
      }

      const index = fieldName === 'paymentFiles' ? paymentFileCount - 1 : chatFileCount - 1
      const chunks: Buffer[] = []
      let fileBytes = 0
      let limited = false
      stream.on('limit', () => {
        limited = true
        hardFail('EVIDENCE_TOO_LARGE')
      })
      stream.on('data', (chunk: Buffer) => {
        if (settled) return
        const copy = Buffer.from(chunk)
        fileBytes += copy.length
        totalBytes += copy.length
        if (!Number.isSafeInteger(fileBytes) || fileBytes > limits.maxFileBytes || limited) {
          hardFail('EVIDENCE_TOO_LARGE')
          return
        }
        if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxDecodedBytes) {
          hardFail('EVIDENCE_BATCH_TOO_LARGE')
          return
        }
        chunks.push(copy)
      })
      stream.on('end', () => {
        if (settled) return
        if (limited || fileBytes > limits.maxFileBytes) {
          hardFail('EVIDENCE_TOO_LARGE')
          return
        }
        if (fileBytes === 0) {
          hardFail('UNSUPPORTED_EVIDENCE')
          return
        }
        const file: EvidenceBatchFile = {
          bytes: Buffer.concat(chunks),
          advertisedMime: info.mimeType,
          originalName: info.filename,
        }
        try {
          if (validateEvidence(file.bytes, file.advertisedMime) !== file.advertisedMime) {
            hardFail('UNSUPPORTED_EVIDENCE')
            return
          }
        } catch {
          hardFail('UNSUPPORTED_EVIDENCE')
          return
        }
        target[index] = file
      })
    })
    parser.on('fieldsLimit', () => hardFail('BOOKING_PREPARE_JSON_REQUIRED'))
    parser.on('filesLimit', () => hardFail('EVIDENCE_FILE_LIMIT'))
    parser.on('partsLimit', () => hardFail('EVIDENCE_FILE_LIMIT'))
    parser.on('error', () => hardFail('BOOKING_PREPARE_JSON_REQUIRED'))
    parser.on('close', () => {
      if (settled) return
      settled = true
      removeRequestListeners()
      if (!inputSeen || !parsedInput) {
        reject(new MiniAppEvidenceError('BOOKING_PREPARE_JSON_REQUIRED'))
        return
      }
      if (paymentFileCount < 1 || chatFileCount < 1
        || paymentFiles.length !== paymentFileCount
        || chatFiles.length !== chatFileCount) {
        reject(new MiniAppEvidenceError('EVIDENCE_FILE_LIMIT'))
        return
      }
      resolve({ ...parsedInput, paymentFiles, chatFiles })
    })
    req.pipe(parser)
  })
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

type BookingPrepareErrorCode =
  | 'BOOKING_PREPARE_JSON_REQUIRED'
  | 'EVIDENCE_FILE_LIMIT'
  | 'EVIDENCE_TOO_LARGE'
  | 'EVIDENCE_BATCH_TOO_LARGE'
  | 'UNSUPPORTED_EVIDENCE'

const BOOKING_PREPARE_ENVELOPE_KEYS = [
  'input',
  'protocolVersion',
  'version',
] as const

const BOOKING_DRAFT_INPUT_V2_KEYS = [
  'adminId',
  'aeId',
  'appointmentDate',
  'appointmentTime',
  'channelId',
  'customerName',
  'depositAmount',
  'doctorId',
  'facebookName',
  'phone',
  'queueType',
  'requestId',
  'serviceId',
] as const

function invalidBookingPrepareLimit(limits: BookingPrepareLimits): BookingPrepareErrorCode | null {
  if (limits.maxFilesPerKind !== BOOKING_PREPARE_LIMITS.maxFilesPerKind) return 'EVIDENCE_FILE_LIMIT'
  if (limits.maxFileBytes !== BOOKING_PREPARE_LIMITS.maxFileBytes) return 'EVIDENCE_TOO_LARGE'
  if (limits.maxDecodedBytes !== BOOKING_PREPARE_LIMITS.maxDecodedBytes
    || limits.maxRawBytes !== BOOKING_PREPARE_LIMITS.maxRawBytes) return 'EVIDENCE_BATCH_TOO_LARGE'
  return null
}

function parseBookingPrepareJson(value: string): ParsedBookingPrepare | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!isExactRecord(parsed, BOOKING_PREPARE_ENVELOPE_KEYS)
    || parsed.protocolVersion !== 2
    || typeof parsed.version !== 'number'
    || !Number.isSafeInteger(parsed.version)
    || parsed.version < 1) return null
  const input = parseCanonicalBookingDraftInputV2(parsed.input)
  if (!input) return null
  return { protocolVersion: 2, version: parsed.version, input, paymentFiles: [], chatFiles: [] }
}

function parseCanonicalBookingDraftInputV2(value: unknown): BookingDraftInputV2 | null {
  if (!isExactRecord(value, BOOKING_DRAFT_INPUT_V2_KEYS)
    || typeof value.requestId !== 'string'
    || typeof value.adminId !== 'string'
    || !(typeof value.aeId === 'string' || value.aeId === null)
    || typeof value.customerName !== 'string'
    || typeof value.facebookName !== 'string'
    || typeof value.phone !== 'string'
    || typeof value.doctorId !== 'string'
    || typeof value.serviceId !== 'string'
    || !(value.queueType === 'NORMAL' || value.queueType === 'AUTO')
    || !(typeof value.appointmentDate === 'string' || value.appointmentDate === null)
    || !(typeof value.appointmentTime === 'string' || value.appointmentTime === null)
    || typeof value.depositAmount !== 'number'
    || !Number.isFinite(value.depositAmount)
    || typeof value.channelId !== 'string') return null
  return {
    requestId: value.requestId,
    adminId: value.adminId,
    aeId: value.aeId,
    customerName: value.customerName,
    facebookName: value.facebookName,
    phone: value.phone,
    doctorId: value.doctorId,
    serviceId: value.serviceId,
    queueType: value.queueType,
    appointmentDate: value.appointmentDate,
    appointmentTime: value.appointmentTime,
    depositAmount: value.depositAmount,
    channelId: value.channelId,
  }
}

function isExactRecord<const Keys extends readonly string[]>(value: unknown, keys: Keys): value is Record<Keys[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Object.keys(value as Record<string, unknown>).sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}
