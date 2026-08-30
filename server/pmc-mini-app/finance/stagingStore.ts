import { createHash } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'
import { inspectExpenseImage, type ExpenseImageMimeType } from './multipart.js'

const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,124}$/
const EXPENSE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const STAGING_KEY = /^expenses\/([A-Za-z0-9._:-]{1,124})\/([1-5])-([a-f0-9]{64})\.(jpg|png)$/
const DRIVE_SLOT_KEY = /^expense-drive-slots\/([A-Za-z0-9._:-]{1,124})\/(00[1-5])\.json$/

export interface ExpenseStagingReceipt {
  objectKey: string
  sizeBytes: number
  mimeType: ExpenseImageMimeType
  sha256: string
  ordinal: number
  originalFileName: string
  createdAt: string
}

export interface ExpenseDriveSlotClaimInput {
  rootRequestId: string
  expenseId: string
  ordinal: number
  sha256: string
  mimeType: ExpenseImageMimeType
  deterministicName: string
}

export interface ExpenseDriveSlotClaim extends ExpenseDriveSlotClaimInput {
  objectKey: string
  claimId: string
  generation: string
  createdAt: string
  created: boolean
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
  claimDriveSlot(input: ExpenseDriveSlotClaimInput): Promise<ExpenseDriveSlotClaim>
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
    async claimDriveSlot(request) {
      try {
        const intent = validDriveSlotIntent(request)
        const objectKey = expenseDriveSlotObjectKey(intent)
        const claimId = expenseDriveSlotClaimId(intent)
        const createdAt = validCreatedAt(now())
        const persisted = { version: 1 as const, claimId, ...intent, createdAt }
        const bytes = Buffer.from(JSON.stringify(persisted), 'utf8')
        const file = bucket.file(objectKey)
        try {
          await file.save(bytes, {
            resumable: false,
            validation: 'crc32c',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
              contentType: 'application/json',
              cacheControl: 'no-store',
              metadata: claimMetadata(persisted),
            },
          })
          const metadata = (await file.getMetadata())[0]
          const generation = normalizedGeneration(metadata.generation)
          return { objectKey, claimId, ...intent, createdAt, generation, created: true }
        } catch (error) {
          if (!isCreateOnlyConflict(error)) throw error
          try {
            const metadata = (await file.getMetadata())[0]
            const generation = normalizedGeneration(metadata.generation)
            const [existingBytes] = await bucket.file(objectKey, { generation }).download({ validation: 'crc32c' })
            const existing = driveSlotClaimFromStorage(objectKey, metadata, existingBytes)
            if (!sameDriveSlotIntent(existing, intent) || existing.claimId !== claimId) {
              throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
            }
            return { ...existing, generation, created: false }
          } catch {
            throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
          }
        }
      } catch (error) {
        throw safeStagingError(error)
      }
    },

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

function validDriveSlotIntent(input: ExpenseDriveSlotClaimInput): ExpenseDriveSlotClaimInput {
  if (
    !isRecord(input)
    || !hasExactKeys(input, ['rootRequestId', 'expenseId', 'ordinal', 'sha256', 'mimeType', 'deterministicName'])
    || !safeRootRequestId(input.rootRequestId)
    || !EXPENSE_ID.test(input.expenseId)
    || !safeOrdinal(input.ordinal)
    || !SHA256.test(input.sha256)
    || !safeMime(input.mimeType)
    || input.deterministicName !== deterministicDriveName(input.ordinal, input.sha256, input.mimeType)
  ) throw new ExpenseStagingError('EXPENSE_STAGING_INPUT_INVALID')
  return { ...input }
}

export function expenseDriveSlotObjectKey(input: ExpenseDriveSlotClaimInput): string {
  return `expense-drive-slots/${input.expenseId}/${String(input.ordinal).padStart(3, '0')}.json`
}

export function expenseDriveSlotClaimId(input: ExpenseDriveSlotClaimInput): string {
  const canonical = JSON.stringify({
    rootRequestId: input.rootRequestId,
    expenseId: input.expenseId,
    ordinal: input.ordinal,
    sha256: input.sha256,
    mimeType: input.mimeType,
    deterministicName: input.deterministicName,
  })
  return `SLOT-${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

function deterministicDriveName(
  ordinal: number,
  sha256: string,
  mimeType: ExpenseImageMimeType,
): string {
  return `${String(ordinal).padStart(3, '0')}-${sha256}.${extensionFor(mimeType)}`
}

function claimMetadata(input: {
  claimId: string
  rootRequestId: string
  expenseId: string
  ordinal: number
  sha256: string
  mimeType: ExpenseImageMimeType
  deterministicName: string
  createdAt: string
}): Record<string, string> {
  return {
    claimId: input.claimId,
    rootRequestId: input.rootRequestId,
    expenseId: input.expenseId,
    ordinal: String(input.ordinal),
    sha256: input.sha256,
    mimeType: input.mimeType,
    deterministicName: input.deterministicName,
    createdAt: input.createdAt,
  }
}

function driveSlotClaimFromStorage(
  objectKey: string,
  metadata: FileMetadata,
  bytes: Buffer,
): Omit<ExpenseDriveSlotClaim, 'generation' | 'created'> {
  const key = DRIVE_SLOT_KEY.exec(objectKey)
  const sizeBytes = Number(metadata.size)
  const custom = metadata.metadata
  let parsed: unknown
  try { parsed = JSON.parse(bytes.toString('utf8')) } catch { parsed = null }
  if (
    !key
    || metadata.name !== undefined && metadata.name !== objectKey
    || metadata.contentType !== 'application/json'
    || metadata.cacheControl !== 'no-store'
    || metadata.contentEncoding !== undefined && metadata.contentEncoding !== ''
    || !Number.isSafeInteger(sizeBytes) || sizeBytes !== bytes.length || sizeBytes < 1 || sizeBytes > 4_096
    || !isRecord(custom)
    || !hasExactKeys(custom, ['claimId', 'rootRequestId', 'expenseId', 'ordinal', 'sha256', 'mimeType', 'deterministicName', 'createdAt'])
    || !isRecord(parsed)
    || !hasExactKeys(parsed, ['version', 'claimId', 'rootRequestId', 'expenseId', 'ordinal', 'sha256', 'mimeType', 'deterministicName', 'createdAt'])
    || parsed.version !== 1
  ) throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
  const intent = validDriveSlotIntent({
    rootRequestId: String(parsed.rootRequestId ?? ''),
    expenseId: String(parsed.expenseId ?? ''),
    ordinal: Number(parsed.ordinal),
    sha256: String(parsed.sha256 ?? ''),
    mimeType: String(parsed.mimeType ?? '') as ExpenseImageMimeType,
    deterministicName: String(parsed.deterministicName ?? ''),
  })
  const claimId = String(parsed.claimId ?? '')
  const createdAt = String(parsed.createdAt ?? '')
  const expectedMetadata = claimMetadata({ claimId, ...intent, createdAt })
  if (
    key[1] !== intent.expenseId
    || Number(key[2]) !== intent.ordinal
    || claimId !== expenseDriveSlotClaimId(intent)
    || !safeCreatedAt(createdAt)
    || Object.keys(expectedMetadata).some((name) => custom[name] !== expectedMetadata[name])
    || JSON.stringify(parsed) !== JSON.stringify({ version: 1, claimId, ...intent, createdAt })
  ) throw new ExpenseStagingError('EXPENSE_DRIVE_SLOT_CONFLICT')
  return { objectKey, claimId, ...intent, createdAt }
}

function sameDriveSlotIntent(
  left: ExpenseDriveSlotClaimInput,
  right: ExpenseDriveSlotClaimInput,
): boolean {
  return left.rootRequestId === right.rootRequestId
    && left.expenseId === right.expenseId
    && left.ordinal === right.ordinal
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.deterministicName === right.deterministicName
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
function normalizedGeneration(value: string | number | undefined): string {
  if (!safeGeneration(value)) throw new ExpenseStagingError('EXPENSE_STAGING_METADATA_INVALID')
  return String(value)
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
