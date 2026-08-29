import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import Busboy from 'busboy'
import sharp from 'sharp'

export const EXPENSE_MAX_FILES = 5
export const EXPENSE_MAX_FILE_BYTES = 10_000_000
export const EXPENSE_MAX_TOTAL_BYTES = 25_000_000
export const EXPENSE_MAX_PIXELS = 20_000_000

export type ExpenseImageMimeType = 'image/jpeg' | 'image/png'

export interface ParsedExpenseFile {
  ordinal: number
  bytes: Buffer
  mimeType: ExpenseImageMimeType
  originalFileName: string
  sha256: string
}

export interface ExpenseMultipartBatch {
  files: ParsedExpenseFile[]
  totalBytes: number
}

export class ExpenseMultipartError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ExpenseMultipartError'
    this.code = code
  }
}

export function consumeExpenseMultipart(req: IncomingMessage): Promise<ExpenseMultipartBatch> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: EXPENSE_MAX_FILES + 1,
          fileSize: EXPENSE_MAX_FILE_BYTES + 1,
          fields: 0,
          parts: EXPENSE_MAX_FILES + 1,
        },
      })
    } catch {
      reject(new ExpenseMultipartError('EXPENSE_INVALID_MULTIPART'))
      return
    }

    const files = new Map<number, { bytes: Buffer; advertisedMime: string; originalFileName: string }>()
    const seenOrdinals = new Set<number>()
    let totalBytes = 0
    let failure: ExpenseMultipartError | null = null
    let settled = false

    const fail = (code: string) => { failure ??= new ExpenseMultipartError(code) }
    const finish = () => {
      if (settled) return
      settled = true
      void validateBatch().then(resolve, reject)
    }
    const validateBatch = async (): Promise<ExpenseMultipartBatch> => {
      if (failure) throw failure
      if (files.size === 0) throw new ExpenseMultipartError('EXPENSE_FILE_REQUIRED')
      const ordered = [...files.entries()].sort(([left], [right]) => left - right)
      if (ordered.some(([ordinal], index) => ordinal !== index + 1)) throw new ExpenseMultipartError('EXPENSE_INVALID_ORDER')
      const parsed = await Promise.all(ordered.map(async ([ordinal, file]) => ({
        ordinal,
        ...await inspectExpenseImage({ ...file }),
      })))
      return { files: parsed, totalBytes }
    }

    parser.on('file', (fieldName, stream, info) => {
      const ordinal = ordinalForField(fieldName)
      if (ordinal === null) {
        fail(fieldName === 'file6' ? 'EXPENSE_FILE_LIMIT' : 'EXPENSE_UNKNOWN_MULTIPART_FIELD')
        stream.resume()
        return
      }
      if (seenOrdinals.has(ordinal)) {
        fail('EXPENSE_DUPLICATE_ORDINAL')
        stream.resume()
        return
      }
      seenOrdinals.add(ordinal)
      const chunks: Buffer[] = []
      let fileBytes = 0
      let limited = false
      stream.on('limit', () => { limited = true })
      stream.on('data', (chunk: Buffer) => {
        const copy = Buffer.from(chunk)
        fileBytes += copy.length
        totalBytes += copy.length
        if (fileBytes > EXPENSE_MAX_FILE_BYTES || limited) fail('EXPENSE_FILE_TOO_LARGE')
        if (totalBytes > EXPENSE_MAX_TOTAL_BYTES) fail('EXPENSE_BATCH_TOO_LARGE')
        if (!failure) chunks.push(copy)
      })
      stream.on('error', () => fail('EXPENSE_INVALID_MULTIPART'))
      stream.on('end', () => {
        if (limited || fileBytes > EXPENSE_MAX_FILE_BYTES) {
          fail('EXPENSE_FILE_TOO_LARGE')
          return
        }
        if (fileBytes === 0) {
          fail('EXPENSE_FILE_EMPTY')
          return
        }
        files.set(ordinal, { bytes: Buffer.concat(chunks), advertisedMime: info.mimeType, originalFileName: info.filename })
      })
    })
    parser.on('field', () => fail('EXPENSE_UNKNOWN_MULTIPART_FIELD'))
    parser.on('fieldsLimit', () => fail('EXPENSE_UNKNOWN_MULTIPART_FIELD'))
    parser.on('filesLimit', () => fail('EXPENSE_FILE_LIMIT'))
    parser.on('partsLimit', () => fail('EXPENSE_FILE_LIMIT'))
    parser.on('error', () => fail('EXPENSE_INVALID_MULTIPART'))
    parser.on('close', finish)
    req.on('aborted', () => { fail('EXPENSE_INVALID_MULTIPART'); finish() })
    req.on('error', () => { fail('EXPENSE_INVALID_MULTIPART'); finish() })
    req.pipe(parser)
  })
}

export async function inspectExpenseImage(input: {
  bytes: Buffer
  advertisedMime: string
  originalFileName: string
}): Promise<Omit<ParsedExpenseFile, 'ordinal'>> {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new ExpenseMultipartError('EXPENSE_FILE_EMPTY')
  if (input.bytes.length > EXPENSE_MAX_FILE_BYTES) throw new ExpenseMultipartError('EXPENSE_FILE_TOO_LARGE')
  if (!safeOriginalFileName(input.originalFileName)) throw new ExpenseMultipartError('EXPENSE_INVALID_FILE_NAME')

  const mimeType = mimeFromMagic(input.bytes)
  if (!mimeType || input.advertisedMime !== mimeType) throw new ExpenseMultipartError('EXPENSE_UNSUPPORTED_IMAGE')

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    metadata = await sharp(input.bytes, { animated: false }).metadata()
  } catch {
    throw new ExpenseMultipartError('EXPENSE_UNSUPPORTED_IMAGE')
  }
  const dimensions = imageDimensions(metadata.width, metadata.height)
  if (
    (mimeType === 'image/jpeg' && metadata.format !== 'jpeg')
    || (mimeType === 'image/png' && metadata.format !== 'png')
    || dimensions === null
    || metadata.pages !== undefined && metadata.pages !== 1
    || metadata.pageHeight !== undefined
    || metadata.orientation !== undefined && (!Number.isSafeInteger(metadata.orientation) || metadata.orientation < 1 || metadata.orientation > 8)
  ) {
    throw new ExpenseMultipartError('EXPENSE_UNSUPPORTED_IMAGE')
  }
  if (dimensions.width > Math.floor(EXPENSE_MAX_PIXELS / dimensions.height)) {
    throw new ExpenseMultipartError('EXPENSE_PIXEL_LIMIT')
  }

  return {
    bytes: input.bytes,
    mimeType,
    originalFileName: input.originalFileName,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
  }
}

function ordinalForField(value: string): number | null {
  const match = /^file([1-6])$/.exec(value)
  return match ? Number(match[1]) : null
}

function mimeFromMagic(bytes: Buffer): ExpenseImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}

function imageDimensions(width: number | undefined, height: number | undefined): { width: number; height: number } | null {
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null
  return { width, height }
}

function safeOriginalFileName(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 180 && ![...value].some((character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 32 || code === 127
  })
}
