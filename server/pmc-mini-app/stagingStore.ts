import { createHash } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'
import { validateEvidence } from './evidence.js'

const MAX_EVIDENCE_BYTES = 10_000_000
const DRAFT_ID = /^[A-Za-z0-9_-]{1,124}$/
const CONTENT_SHA256 = /^[a-f0-9]{64}$/
const STAGING_KEY = /^drafts\/([A-Za-z0-9_-]{1,124})\/(PAYMENT|CHAT)\/([a-f0-9]{64})\.(jpg|png)$/

type EvidenceKind = 'PAYMENT' | 'CHAT'
type EvidenceMime = 'image/jpeg' | 'image/png'

export interface EvidenceStagingPort {
  put(input: {
    draftId: string
    kind: EvidenceKind
    mimeType: EvidenceMime
    bytes: Buffer
  }): Promise<{ objectKey: string; size: number; contentSha256: string }>
  get(objectKey: string): Promise<{ bytes: Buffer; mimeType: EvidenceMime }>
  deleteVerified(objectKey: string): Promise<void>
}

export function evidenceObjectKey(input: {
  draftId: string
  kind: EvidenceKind
  contentSha256: string
  mimeType: EvidenceMime
}): string {
  if (!safeDraftId(input.draftId) || !safeKind(input.kind) || !CONTENT_SHA256.test(input.contentSha256)
    || !safeMime(input.mimeType)) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  return `drafts/${input.draftId}/${input.kind}/${input.contentSha256}.${extensionFor(input.mimeType)}`
}

export function createGoogleEvidenceStagingPort(input: {
  bucketName: string
  storage?: Storage
}): EvidenceStagingPort {
  if (!safeBucketName(input.bucketName)) throw new Error('INVALID_EVIDENCE_STAGING_BUCKET')
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)

  return {
    async put(request) {
      validatePut(request)
      const verifiedMime = validateEvidence(request.bytes, request.mimeType)
      if (verifiedMime !== request.mimeType) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')

      const contentSha256 = createHash('sha256').update(request.bytes).digest('hex')
      const objectKey = evidenceObjectKey({ ...request, contentSha256 })
      const file = bucket.file(objectKey)
      try {
        await file.save(request.bytes, {
          resumable: false,
          validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: request.mimeType, cacheControl: 'no-store' },
        })
      } catch (error) {
        if (!isCreateOnlyConflict(error)) throw error
        const existing = verifiedObjectMetadata(objectKey, (await file.getMetadata())[0])
        if (existing.size !== request.bytes.length || existing.mimeType !== request.mimeType) {
          throw new Error('EVIDENCE_STAGING_CONFLICT', { cause: error })
        }
      }
      return { objectKey, size: request.bytes.length, contentSha256 }
    },

    async get(objectKey) {
      const file = bucket.file(assertStagingKey(objectKey))
      const metadata = verifiedObjectMetadata(objectKey, (await file.getMetadata())[0])
      const [bytes] = await bucket.file(objectKey, { generation: metadata.generation }).download({ validation: 'crc32c' })
      if (bytes.length !== metadata.size || validateEvidence(bytes, metadata.mimeType) !== metadata.mimeType) {
        throw new Error('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
      }
      return { bytes, mimeType: metadata.mimeType }
    },

    async deleteVerified(objectKey) {
      const file = bucket.file(assertStagingKey(objectKey))
      const metadata = verifiedObjectMetadata(objectKey, (await file.getMetadata())[0])
      await file.delete({ ifGenerationMatch: metadata.generation })
    },
  }
}

function validatePut(input: Parameters<EvidenceStagingPort['put']>[0]): void {
  if (!safeDraftId(input.draftId) || !safeKind(input.kind) || !safeMime(input.mimeType)
    || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  if (input.bytes.length > MAX_EVIDENCE_BYTES) throw new Error('EVIDENCE_TOO_LARGE')
}

function verifiedObjectMetadata(
  objectKey: string,
  metadata: FileMetadata,
): { mimeType: EvidenceMime; size: number; generation: string | number } {
  const key = assertStagingKey(objectKey)
  const mimeType = metadata.contentType
  const size = Number(metadata.size)
  if (metadata.name !== undefined && metadata.name !== key
    || !safeMime(mimeType) || extensionFor(mimeType) !== key.slice(key.lastIndexOf('.') + 1)
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_EVIDENCE_BYTES
    || metadata.cacheControl !== 'no-store' || metadata.contentEncoding !== undefined && metadata.contentEncoding !== ''
    || !emptyCustomMetadata(metadata.metadata) || !safeGeneration(metadata.generation)) {
    throw new Error('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  }
  return { mimeType, size, generation: metadata.generation }
}

function assertStagingKey(objectKey: string): string {
  if (!STAGING_KEY.test(objectKey)) throw new Error('INVALID_EVIDENCE_STAGING_KEY')
  return objectKey
}

function safeDraftId(value: string): boolean { return DRAFT_ID.test(value) }
function safeKind(value: string): value is EvidenceKind { return value === 'PAYMENT' || value === 'CHAT' }
function safeMime(value: string | undefined): value is EvidenceMime { return value === 'image/jpeg' || value === 'image/png' }
function extensionFor(mimeType: EvidenceMime): 'jpg' | 'png' { return mimeType === 'image/jpeg' ? 'jpg' : 'png' }
function safeGeneration(value: string | number | undefined): value is string | number {
  return typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && /^[1-9]\d*$/.test(value)
}
function emptyCustomMetadata(value: FileMetadata['metadata']): boolean {
  return value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
}
function safeBucketName(value: string): boolean { return /^[a-z0-9][a-z0-9._-]{1,220}$/.test(value) }
function isCreateOnlyConflict(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error.code === 412 || error.code === '412')
}
