import { createHash } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'
import {
  miniAppEvidenceObjectKeyV2,
  miniAppEvidenceUploadIdV2,
  type MiniAppEvidenceSlotIdentityV2,
} from '../../shared/pmcMiniAppEvidence.js'
import { validateEvidence } from './evidence.js'

const MAX_EVIDENCE_BYTES = 10_000_000
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const CONTENT_SHA256 = /^[a-f0-9]{64}$/
const LEGACY_STAGING_KEY = /^drafts\/([A-Za-z0-9_-]{1,124})\/(PAYMENT|CHAT)\/([a-f0-9]{64})\.(jpg|png)$/
const V2_STAGING_KEY = /^drafts\/v2\/([A-Za-z0-9._:-]{1,124})\/([A-Za-z0-9._:-]{1,124})\/(PAYMENT|CHAT)\/([0-9])\/([a-f0-9]{64})\/([a-f0-9]{64})\.(jpg|png)$/

type EvidenceKind = 'PAYMENT' | 'CHAT'
type EvidenceMime = 'image/jpeg' | 'image/png'

interface EvidenceStagingPutInput {
  requestId?: string
  draftId: string
  kind: EvidenceKind
  ordinal?: number
  mimeType: EvidenceMime
  bytes: Buffer
}

export type EvidenceStagingCleanupDescriptor =
  | {
      version: 1
      objectKey: string
      draftId: string
      kind: EvidenceKind
      contentSha256: string
      mimeType: EvidenceMime
      size: number
      generation: string | number
    }
  | {
      version: 2
      objectKey: string
      requestId: string
      draftId: string
      kind: EvidenceKind
      ordinal: number
      uploadId: string
      contentSha256: string
      mimeType: EvidenceMime
      size: number
      generation: string | number
    }

export interface EvidenceStagingPort {
  put(input: EvidenceStagingPutInput): Promise<{
    objectKey: string
    size: number
    contentSha256: string
    uploadId?: string
  }>
  get(objectKey: string): Promise<{
    bytes: Buffer
    mimeType: EvidenceMime
    cleanupDescriptor: EvidenceStagingCleanupDescriptor
  }>
  describe(objectKey: string): Promise<EvidenceStagingCleanupDescriptor>
  deleteVerified(descriptor: EvidenceStagingCleanupDescriptor): Promise<void>
}

export function evidenceObjectKey(input: {
  requestId?: string
  draftId: string
  kind: EvidenceKind
  ordinal?: number
  contentSha256: string
  mimeType: EvidenceMime
  uploadId?: string
}): string {
  if (!safeId(input.draftId) || !safeKind(input.kind) || !CONTENT_SHA256.test(input.contentSha256)
    || !safeMime(input.mimeType)) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  if (input.requestId === undefined && input.ordinal === undefined && input.uploadId === undefined) {
    if (!/^[A-Za-z0-9_-]{1,124}$/.test(input.draftId)) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
    return `drafts/${input.draftId}/${input.kind}/${input.contentSha256}.${extensionFor(input.mimeType)}`
  }
  if (!safeId(input.requestId) || !safeOrdinal(input.ordinal)) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  const slot = slotIdentity(input.requestId, input.draftId, input.kind, input.ordinal, input.mimeType, input.contentSha256)
  const uploadId = miniAppEvidenceUploadIdV2(slot, sha256Utf8)
  if (input.uploadId !== undefined && input.uploadId !== uploadId) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  return miniAppEvidenceObjectKeyV2(slot, uploadId)
}

export function createGoogleEvidenceStagingPort(input: {
  bucketName: string
  storage?: Storage
}): EvidenceStagingPort {
  if (!safeBucketName(input.bucketName)) throw new Error('INVALID_EVIDENCE_STAGING_BUCKET')
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)

  const describe = async (objectKey: string): Promise<EvidenceStagingCleanupDescriptor> => {
    const parsed = parseStagingKey(objectKey)
    const file = bucket.file(parsed.objectKey)
    const metadata = verifiedObjectMetadata(parsed, (await file.getMetadata())[0])
    return cleanupDescriptor(parsed, metadata)
  }

  return {
    async put(request) {
      validatePut(request)
      const verifiedMime = validateEvidence(request.bytes, request.mimeType)
      if (verifiedMime !== request.mimeType) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')

      const contentSha256 = createHash('sha256').update(request.bytes).digest('hex')
      const v2 = request.requestId !== undefined && request.ordinal !== undefined
      const slot = v2
        ? slotIdentity(request.requestId!, request.draftId, request.kind, request.ordinal!, request.mimeType, contentSha256)
        : null
      const uploadId = slot ? miniAppEvidenceUploadIdV2(slot, sha256Utf8) : undefined
      const objectKey = evidenceObjectKey({ ...request, contentSha256, uploadId })
      const file = bucket.file(objectKey)
      const customMetadata = slot && uploadId ? v2CustomMetadata(slot, uploadId) : undefined
      try {
        await file.save(request.bytes, {
          resumable: false,
          validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: request.mimeType,
            cacheControl: 'no-store',
            ...(customMetadata ? { metadata: customMetadata } : {}),
          },
        })
      } catch (error) {
        if (!isCreateOnlyConflict(error)) throw error
        const parsed = parseStagingKey(objectKey)
        const existing = verifiedObjectMetadata(parsed, (await file.getMetadata())[0])
        if (existing.size !== request.bytes.length || existing.mimeType !== request.mimeType) {
          throw new Error('EVIDENCE_STAGING_CONFLICT', { cause: error })
        }
      }
      return { objectKey, size: request.bytes.length, contentSha256, ...(uploadId ? { uploadId } : {}) }
    },

    async get(objectKey) {
      const parsed = parseStagingKey(objectKey)
      const file = bucket.file(parsed.objectKey)
      const metadata = verifiedObjectMetadata(parsed, (await file.getMetadata())[0])
      const [bytes] = await bucket.file(parsed.objectKey, { generation: metadata.generation })
        .download({ validation: 'crc32c' })
      if (bytes.length !== metadata.size || validateEvidence(bytes, metadata.mimeType) !== metadata.mimeType
        || createHash('sha256').update(bytes).digest('hex') !== parsed.contentSha256) {
        throw new Error('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
      }
      return { bytes, mimeType: metadata.mimeType, cleanupDescriptor: cleanupDescriptor(parsed, metadata) }
    },

    describe,

    async deleteVerified(descriptor) {
      const parsed = parseStagingKey(descriptor.objectKey)
      assertDescriptorMatchesParsed(descriptor, parsed)
      const file = bucket.file(parsed.objectKey)
      let metadata: VerifiedMetadata
      try {
        metadata = verifiedObjectMetadata(parsed, (await file.getMetadata())[0])
      } catch (error) {
        if (isExactNotFound(error)) return
        throw error
      }
      if (metadata.size !== descriptor.size || String(metadata.generation) !== String(descriptor.generation)
        || metadata.mimeType !== descriptor.mimeType) throw new Error('EVIDENCE_STAGING_DESCRIPTOR_MISMATCH')
      try {
        await file.delete({ ifGenerationMatch: descriptor.generation })
      } catch (error) {
        if (isExactNotFound(error)) return
        throw error
      }
    },
  }
}

type ParsedStagingKey =
  | { version: 1; objectKey: string; draftId: string; kind: EvidenceKind; contentSha256: string; mimeType: EvidenceMime }
  | { version: 2; objectKey: string; requestId: string; draftId: string; kind: EvidenceKind; ordinal: number; uploadId: string; contentSha256: string; mimeType: EvidenceMime }

interface VerifiedMetadata {
  mimeType: EvidenceMime
  size: number
  generation: string | number
}

function parseStagingKey(objectKey: string): ParsedStagingKey {
  const legacy = LEGACY_STAGING_KEY.exec(objectKey)
  if (legacy) {
    return {
      version: 1, objectKey, draftId: legacy[1]!, kind: legacy[2] as EvidenceKind,
      contentSha256: legacy[3]!, mimeType: mimeForExtension(legacy[4]!),
    }
  }
  const v2 = V2_STAGING_KEY.exec(objectKey)
  if (!v2) throw new Error('INVALID_EVIDENCE_STAGING_KEY')
  const parsed: ParsedStagingKey = {
    version: 2, objectKey, requestId: v2[1]!, draftId: v2[2]!, kind: v2[3] as EvidenceKind,
    ordinal: Number(v2[4]), uploadId: v2[5]!, contentSha256: v2[6]!, mimeType: mimeForExtension(v2[7]!),
  }
  const slot = slotIdentity(parsed.requestId, parsed.draftId, parsed.kind, parsed.ordinal, parsed.mimeType, parsed.contentSha256)
  if (miniAppEvidenceUploadIdV2(slot, sha256Utf8) !== parsed.uploadId) throw new Error('INVALID_EVIDENCE_STAGING_KEY')
  return parsed
}

function verifiedObjectMetadata(parsed: ParsedStagingKey, metadata: FileMetadata): VerifiedMetadata {
  const mimeType = metadata.contentType
  const size = Number(metadata.size)
  const exactCustomMetadata = parsed.version === 1
    ? emptyCustomMetadata(metadata.metadata)
    : sameStringRecord(metadata.metadata, v2CustomMetadata(slotIdentity(
      parsed.requestId, parsed.draftId, parsed.kind, parsed.ordinal, parsed.mimeType, parsed.contentSha256,
    ), parsed.uploadId))
  if (metadata.name !== undefined && metadata.name !== parsed.objectKey
    || !safeMime(mimeType) || mimeType !== parsed.mimeType
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_EVIDENCE_BYTES
    || metadata.cacheControl !== 'no-store' || metadata.contentEncoding !== undefined && metadata.contentEncoding !== ''
    || !exactCustomMetadata || !safeGeneration(metadata.generation)) {
    throw new Error('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  }
  return { mimeType, size, generation: metadata.generation }
}

function cleanupDescriptor(parsed: ParsedStagingKey, metadata: VerifiedMetadata): EvidenceStagingCleanupDescriptor {
  return { ...parsed, size: metadata.size, generation: metadata.generation }
}

function assertDescriptorMatchesParsed(
  descriptor: EvidenceStagingCleanupDescriptor,
  parsed: ParsedStagingKey,
): void {
  const common = descriptor.version === parsed.version && descriptor.objectKey === parsed.objectKey
    && descriptor.draftId === parsed.draftId && descriptor.kind === parsed.kind
    && descriptor.contentSha256 === parsed.contentSha256 && descriptor.mimeType === parsed.mimeType
    && Number.isSafeInteger(descriptor.size) && descriptor.size > 0 && descriptor.size <= MAX_EVIDENCE_BYTES
    && safeGeneration(descriptor.generation)
  if (!common || descriptor.version === 2 && parsed.version === 2
    && (descriptor.requestId !== parsed.requestId || descriptor.ordinal !== parsed.ordinal || descriptor.uploadId !== parsed.uploadId)) {
    throw new Error('EVIDENCE_STAGING_DESCRIPTOR_MISMATCH')
  }
}

function validatePut(input: EvidenceStagingPutInput): void {
  const legacy = input.requestId === undefined && input.ordinal === undefined
  const v2 = safeId(input.requestId) && safeOrdinal(input.ordinal)
  if (!safeId(input.draftId) || !safeKind(input.kind) || !safeMime(input.mimeType)
    || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0 || !legacy && !v2) {
    throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  }
  if (legacy && !/^[A-Za-z0-9_-]{1,124}$/.test(input.draftId)) throw new Error('INVALID_EVIDENCE_STAGING_INPUT')
  if (input.bytes.length > MAX_EVIDENCE_BYTES) throw new Error('EVIDENCE_TOO_LARGE')
}

function slotIdentity(
  requestId: string,
  draftId: string,
  kind: EvidenceKind,
  ordinal: number,
  mimeType: EvidenceMime,
  contentSha256: string,
): MiniAppEvidenceSlotIdentityV2 {
  return { requestId, draftId, evidenceKind: kind, ordinal, mimeType, contentSha256 }
}

function v2CustomMetadata(slot: MiniAppEvidenceSlotIdentityV2, uploadId: string): Record<string, string> {
  return {
    pmcEvidenceVersion: '2', requestId: slot.requestId, draftId: slot.draftId,
    evidenceKind: slot.evidenceKind, ordinal: String(slot.ordinal), uploadId,
    contentSha256: slot.contentSha256, mimeType: slot.mimeType,
  }
}

function sameStringRecord(actual: FileMetadata['metadata'], expected: Record<string, string>): boolean {
  if (!actual || typeof actual !== 'object') return false
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
}

function safeId(value: unknown): value is string { return typeof value === 'string' && SAFE_ID.test(value) }
function safeOrdinal(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 9 }
function safeKind(value: string): value is EvidenceKind { return value === 'PAYMENT' || value === 'CHAT' }
function safeMime(value: string | undefined): value is EvidenceMime { return value === 'image/jpeg' || value === 'image/png' }
function extensionFor(mimeType: EvidenceMime): 'jpg' | 'png' { return mimeType === 'image/jpeg' ? 'jpg' : 'png' }
function mimeForExtension(extension: string): EvidenceMime { return extension === 'jpg' ? 'image/jpeg' : 'image/png' }
function sha256Utf8(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
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
function isExactNotFound(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error.code === 404 || error.code === '404')
}
