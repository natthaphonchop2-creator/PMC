import { createHash } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'
import { inspectExpenseImage, type ExpenseImageMimeType } from './multipart.js'

const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const STAGING_KEY = /^expenses\/([A-Za-z0-9._:-]{1,124})\/([1-5])-([a-f0-9]{64})\.(jpg|png)$/

export interface ExpenseStagingReceipt {
  objectKey: string
  sizeBytes: number
  mimeType: ExpenseImageMimeType
  sha256: string
  ordinal: number
  originalFileName: string
  createdAt: string
}

export interface ExpenseStagingPort {
  put(input: {
    rootRequestId: string
    ordinal: number
    originalFileName: string
    mimeType: ExpenseImageMimeType
    bytes: Buffer
  }): Promise<ExpenseStagingReceipt>
  get(objectKey: string): Promise<ExpenseStagingReceipt & { bytes: Buffer }>
  deleteVerified(objectKey: string): Promise<void>
}

export class ExpenseStagingError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ExpenseStagingError'
    this.code = code
  }
}

export function expenseStagingObjectKey(input: {
  rootRequestId: string
  ordinal: number
  sha256: string
  mimeType: ExpenseImageMimeType
}): string {
  if (!safeRootRequestId(input.rootRequestId) || !safeOrdinal(input.ordinal) || !SHA256.test(input.sha256) || !safeMime(input.mimeType)) {
    throw new ExpenseStagingError('EXPENSE_STAGING_INPUT_INVALID')
  }
  return `expenses/${input.rootRequestId}/${input.ordinal}-${input.sha256}.${extensionFor(input.mimeType)}`
}

export function parseExpenseStagingObjectKey(objectKey: string): {
  rootRequestId: string
  ordinal: number
  sha256: string
  mimeType: ExpenseImageMimeType
} {
  const match = STAGING_KEY.exec(objectKey)
  if (!match) throw new ExpenseStagingError('EXPENSE_STAGING_KEY_INVALID')
  const mimeType = match[4] === 'jpg' ? 'image/jpeg' : 'image/png'
  return { rootRequestId: match[1]!, ordinal: Number(match[2]), sha256: match[3]!, mimeType }
}

export function createGoogleExpenseStagingPort(input: {
  bucketName: string
  storage?: Storage
  now?: () => string
}): ExpenseStagingPort {
  if (!safeBucketName(input.bucketName)) throw new ExpenseStagingError('EXPENSE_STAGING_CONFIG_INVALID')
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)
  const now = input.now ?? (() => new Date().toISOString())

  return {
    async put(request) {
      try {
        if (!safeRootRequestId(request.rootRequestId) || !safeOrdinal(request.ordinal) || !safeMime(request.mimeType)) {
          throw new ExpenseStagingError('EXPENSE_STAGING_INPUT_INVALID')
        }
        const inspected = await inspectExpenseImage({
          bytes: request.bytes, advertisedMime: request.mimeType, originalFileName: request.originalFileName,
        })
        if (inspected.mimeType !== request.mimeType) throw new ExpenseStagingError('EXPENSE_STAGING_INPUT_INVALID')
        const sha256 = createHash('sha256').update(request.bytes).digest('hex')
        const objectKey = expenseStagingObjectKey({ ...request, sha256 })
        const createdAt = validCreatedAt(now())
        const expected = {
          objectKey,
          sizeBytes: request.bytes.length,
          mimeType: request.mimeType,
          sha256,
          ordinal: request.ordinal,
          originalFileName: request.originalFileName,
          createdAt,
        }
        const file = bucket.file(objectKey)
        try {
          await file.save(request.bytes, {
            resumable: false,
            validation: 'crc32c',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
              contentType: request.mimeType,
              cacheControl: 'no-store',
              metadata: metadataFor(expected),
            },
          })
        } catch (error) {
          if (!isCreateOnlyConflict(error)) throw error
          try {
            const metadata = (await file.getMetadata())[0]
            const existing = receiptFromMetadata(objectKey, metadata)
            const [existingBytes] = await bucket.file(objectKey, { generation: metadata.generation }).download({ validation: 'crc32c' })
            if (
              existingBytes.length !== existing.sizeBytes
              || !existingBytes.equals(request.bytes)
              || createHash('sha256').update(existingBytes).digest('hex') !== existing.sha256
            ) throw new ExpenseStagingError('EXPENSE_STAGING_CONFLICT')
            const inspected = await inspectExpenseImage({
              bytes: existingBytes, advertisedMime: existing.mimeType, originalFileName: existing.originalFileName,
            })
            if (inspected.mimeType !== existing.mimeType || !sameReceipt(existing, expected)) {
              throw new ExpenseStagingError('EXPENSE_STAGING_CONFLICT')
            }
            return existing
          } catch {
            throw new ExpenseStagingError('EXPENSE_STAGING_CONFLICT')
          }
        }
        return expected
      } catch (error) {
        throw safeStagingError(error)
      }
    },

    async get(objectKey) {
      try {
        const file = bucket.file(assertStagingObjectKey(objectKey))
        const metadata = (await file.getMetadata())[0]
        const receipt = receiptFromMetadata(objectKey, metadata)
        const [bytes] = await bucket.file(objectKey, { generation: metadata.generation }).download({ validation: 'crc32c' })
        if (bytes.length !== receipt.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) {
          throw new ExpenseStagingError('EXPENSE_STAGING_METADATA_INVALID')
        }
        const inspected = await inspectExpenseImage({ bytes, advertisedMime: receipt.mimeType, originalFileName: receipt.originalFileName })
        if (inspected.mimeType !== receipt.mimeType) throw new ExpenseStagingError('EXPENSE_STAGING_METADATA_INVALID')
        return { ...receipt, bytes }
      } catch (error) {
        throw safeStagingError(error)
      }
    },

    async deleteVerified(objectKey) {
      try {
        const file = bucket.file(assertStagingObjectKey(objectKey))
        const metadata = (await file.getMetadata())[0]
        receiptFromMetadata(objectKey, metadata)
        await file.delete({ ifGenerationMatch: metadata.generation })
      } catch (error) {
        throw safeStagingError(error)
      }
    },
  }
}

function receiptFromMetadata(objectKey: string, metadata: FileMetadata): ExpenseStagingReceipt {
  const key = parseExpenseStagingObjectKey(objectKey)
  const sizeBytes = Number(metadata.size)
  const custom = metadata.metadata
  const sha256 = custom?.sha256
  const ordinal = custom?.ordinal
  const rootRequestId = custom?.rootRequestId
  const originalFileName = custom?.originalFileName
  const createdAt = custom?.createdAt
  if (
    metadata.name !== undefined && metadata.name !== objectKey
    || !safeMime(metadata.contentType)
    || key.mimeType !== metadata.contentType
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10_000_000
    || metadata.cacheControl !== 'no-store'
    || metadata.contentEncoding !== undefined && metadata.contentEncoding !== ''
    || !safeGeneration(metadata.generation)
    || !isRecord(custom) || !hasExactKeys(custom, ['sha256', 'ordinal', 'rootRequestId', 'originalFileName', 'createdAt'])
    || typeof sha256 !== 'string' || typeof ordinal !== 'string' || typeof rootRequestId !== 'string'
    || typeof originalFileName !== 'string' || typeof createdAt !== 'string'
    || sha256 !== key.sha256 || ordinal !== String(key.ordinal) || rootRequestId !== key.rootRequestId
    || !safeOriginalFileName(originalFileName) || !safeCreatedAt(createdAt)
  ) {
    throw new ExpenseStagingError('EXPENSE_STAGING_METADATA_INVALID')
  }
  return { objectKey, sizeBytes, mimeType: key.mimeType, sha256: key.sha256, ordinal: key.ordinal, originalFileName, createdAt }
}

function metadataFor(receipt: ExpenseStagingReceipt): Record<string, string> {
  return {
    sha256: receipt.sha256,
    ordinal: String(receipt.ordinal),
    rootRequestId: parseExpenseStagingObjectKey(receipt.objectKey).rootRequestId,
    originalFileName: receipt.originalFileName,
    createdAt: receipt.createdAt,
  }
}

function sameReceipt(left: ExpenseStagingReceipt, right: ExpenseStagingReceipt): boolean {
  return left.objectKey === right.objectKey && left.sizeBytes === right.sizeBytes && left.mimeType === right.mimeType
    && left.sha256 === right.sha256 && left.ordinal === right.ordinal && left.originalFileName === right.originalFileName
}

function assertStagingObjectKey(value: string): string { parseExpenseStagingObjectKey(value); return value }
function safeRootRequestId(value: string): boolean { return ROOT_REQUEST_ID.test(value) }
function safeOrdinal(value: number): boolean { return Number.isSafeInteger(value) && value >= 1 && value <= 5 }
function safeMime(value: string | undefined): value is ExpenseImageMimeType { return value === 'image/jpeg' || value === 'image/png' }
function extensionFor(value: ExpenseImageMimeType): 'jpg' | 'png' { return value === 'image/jpeg' ? 'jpg' : 'png' }
function safeBucketName(value: string): boolean { return /^[a-z0-9][a-z0-9._-]{1,220}$/.test(value) }
function safeGeneration(value: string | number | undefined): value is string | number {
  return typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && /^[1-9]\d*$/.test(value)
}
function safeOriginalFileName(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 180 && ![...value].some((character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 32 || code === 127
  })
}
function safeCreatedAt(value: string): boolean { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) }
function validCreatedAt(value: string): string {
  if (!safeCreatedAt(value)) throw new ExpenseStagingError('EXPENSE_STAGING_CONFIG_INVALID')
  return value
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
function isCreateOnlyConflict(error: unknown): boolean { return isRecord(error) && (error.code === 412 || error.code === '412') }
function safeStagingError(error: unknown): ExpenseStagingError {
  return error instanceof ExpenseStagingError ? error : new ExpenseStagingError('EXPENSE_STAGING_UNAVAILABLE')
}
