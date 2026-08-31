export type DraftRetentionKind = 'PAYMENT' | 'CHAT'
export type DraftRetentionMime = 'image/jpeg' | 'image/png'
export type RetentionScope = 'CASE_FOLDER' | 'DRAFT_EVIDENCE'
export type RetentionStatus =
  | 'ACTIVE' | 'PENDING' | 'APPROVED' | 'CLEANING' | 'CLEANED' | 'PROMOTED' | 'FAILED_RETRYABLE'

export type DraftRetentionResource =
  | {
      storage: 'STAGED_OBJECT'
      kind: DraftRetentionKind
      ordinal: number
      uploadId: string
      contentSha256: string
      mimeType: DraftRetentionMime
      objectKey: string
    }
  | {
      storage: 'DRIVE_FILE'
      kind: DraftRetentionKind
      ordinal: number
      uploadId: string
      contentSha256: string
      mimeType: DraftRetentionMime
      fileId: string
      fileName: string
    }

export interface CaseFolderRetentionResource {
  storage: 'CASE_FOLDER'
  folderId: string
}

export type RetentionResource = DraftRetentionResource | CaseFolderRetentionResource

export interface RetentionRecordV2 {
  id: string
  scope: RetentionScope
  caseId: string | null
  draftId: string | null
  trigger: string
  eligibleAt: string
  status: RetentionStatus
  resourceManifestJson: string
  manifestDigest: string
  approvedBy: string
  approvedAt: string
  reason: string
  cleanupAttemptCount: number
  cleanupClaimId: string
  cleanupLeaseUntil: string
  cleanedAt: string
  safeErrorCode: string
  version: number
}

export const RETENTION_QUEUE_COLUMNS_V1 = [
  'id', 'caseId', 'eligibleAt', 'status', 'approvedBy', 'approvedAt', 'reason', 'version',
] as const

export const RETENTION_QUEUE_COLUMNS_V2 = [
  'id', 'scope', 'caseId', 'draftId', 'trigger', 'eligibleAt', 'status', 'resourceManifestJson',
  'manifestDigest', 'approvedBy', 'approvedAt', 'reason', 'cleanupAttemptCount', 'cleanupClaimId',
  'cleanupLeaseUntil', 'cleanedAt', 'safeErrorCode', 'version',
] as const

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/
const SAFE_HASH = /^[a-f0-9]{64}$/
const SAFE_UPLOAD = /^[a-f0-9]{64}$/
const SAFE_FILE = /^[A-Za-z0-9_-]{10,256}$/
const SAFE_FOLDER = /^[A-Za-z0-9_-]{1,256}$/
const SAFE_OBJECT = /^(?:drafts\/v2\/[A-Za-z0-9._:-]{1,124}\/[A-Za-z0-9._:-]{1,124}\/(PAYMENT|CHAT)\/[0-9]\/[a-f0-9]{64}\/[a-f0-9]{64}|drafts\/[A-Za-z0-9_-]{1,124}\/(PAYMENT|CHAT)\/[a-f0-9]{64})\.(jpg|png)$/
const MAX_MANIFEST_BYTES = 32_768

export function canonicalRetentionManifest(resources: readonly RetentionResource[]): string {
  const sorted = [...resources].map((resource) => ({ ...resource })).sort(compareResource)
  validateRetentionResources(sorted)
  const canonical = JSON.stringify(sorted)
  if (canonical.length > MAX_MANIFEST_BYTES) throw new Error('RETENTION_MANIFEST_TOO_LARGE')
  return canonical
}

export function createRetentionManifest(
  resources: readonly RetentionResource[],
  sha256Hex: (value: string) => string,
): { resourceManifestJson: string; manifestDigest: string } {
  const resourceManifestJson = canonicalRetentionManifest(resources)
  const manifestDigest = sha256Hex(resourceManifestJson).toLowerCase()
  if (!SAFE_HASH.test(manifestDigest)) throw new Error('RETENTION_MANIFEST_INVALID')
  return { resourceManifestJson, manifestDigest }
}

export function parseRetentionManifest(
  resourceManifestJson: string,
  manifestDigest: string,
  sha256Hex: (value: string) => string,
): RetentionResource[] {
  if (typeof resourceManifestJson !== 'string' || !SAFE_HASH.test(manifestDigest)) {
    throw new Error('RETENTION_MANIFEST_INVALID')
  }
  let parsed: unknown
  try { parsed = JSON.parse(resourceManifestJson) } catch { throw new Error('RETENTION_MANIFEST_INVALID') }
  if (!Array.isArray(parsed)) throw new Error('RETENTION_MANIFEST_INVALID')
  const canonical = canonicalRetentionManifest(parsed as RetentionResource[])
  if (canonical !== resourceManifestJson || sha256Hex(canonical).toLowerCase() !== manifestDigest) {
    throw new Error('RETENTION_MANIFEST_INVALID')
  }
  return parsed.map((resource) => ({ ...resource })) as RetentionResource[]
}

export function assertRetentionRecord(record: RetentionRecordV2): RetentionRecordV2 {
  if (!SAFE_ID.test(record.id) || !['CASE_FOLDER', 'DRAFT_EVIDENCE'].includes(record.scope)
    || record.caseId !== null && !SAFE_ID.test(record.caseId)
    || record.draftId !== null && !SAFE_ID.test(record.draftId)
    || !/^[A-Z0-9_]{1,80}$/.test(record.trigger)
    || !validIso(record.eligibleAt) || !['ACTIVE', 'PENDING', 'APPROVED', 'CLEANING', 'CLEANED', 'PROMOTED', 'FAILED_RETRYABLE'].includes(record.status)
    || !SAFE_HASH.test(record.manifestDigest) || record.approvedBy.length > 320 || record.reason.length > 500
    || !Number.isSafeInteger(record.cleanupAttemptCount) || record.cleanupAttemptCount < 0
    || record.cleanupClaimId && !SAFE_HASH.test(record.cleanupClaimId)
    || record.cleanupLeaseUntil && !validIso(record.cleanupLeaseUntil)
    || record.cleanedAt && !validIso(record.cleanedAt)
    || record.safeErrorCode && !/^[A-Z0-9_]{1,80}$/.test(record.safeErrorCode)
    || !Number.isSafeInteger(record.version) || record.version < 1) throw new Error('RETENTION_RECORD_INVALID')
  if (record.scope === 'CASE_FOLDER' ? !record.caseId || record.draftId !== null : !record.draftId || record.caseId !== null) {
    throw new Error('RETENTION_RECORD_INVALID')
  }
  return { ...record }
}

export function draftRetentionId(draftId: string, sha256Base64Url: (value: string) => string): string {
  if (!SAFE_ID.test(draftId)) throw new Error('RETENTION_RECORD_INVALID')
  const digest = sha256Base64Url(draftId)
  if (!/^[A-Za-z0-9_-]{43}$/.test(digest)) throw new Error('RETENTION_RECORD_INVALID')
  return `RET-DRAFT-${digest}`
}

function validateRetentionResources(resources: readonly RetentionResource[]): void {
  if (resources.length < 1 || resources.length > 20) throw new Error('RETENTION_MANIFEST_INVALID')
  const slots = new Set<string>()
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') throw new Error('RETENTION_MANIFEST_INVALID')
    if (resource.storage === 'CASE_FOLDER') {
      if (resources.length !== 1 || !SAFE_FOLDER.test(resource.folderId) || Object.keys(resource).length !== 2) {
        throw new Error('RETENTION_MANIFEST_INVALID')
      }
      continue
    }
    const expectedKeys = resource.storage === 'STAGED_OBJECT'
      ? ['storage', 'kind', 'ordinal', 'uploadId', 'contentSha256', 'mimeType', 'objectKey']
      : ['storage', 'kind', 'ordinal', 'uploadId', 'contentSha256', 'mimeType', 'fileId', 'fileName']
    if (!sameKeys(resource, expectedKeys) || !['PAYMENT', 'CHAT'].includes(resource.kind)
      || !Number.isSafeInteger(resource.ordinal) || resource.ordinal < 0 || resource.ordinal > 9
      || !SAFE_UPLOAD.test(resource.uploadId) || !SAFE_HASH.test(resource.contentSha256)
      || !['image/jpeg', 'image/png'].includes(resource.mimeType)) throw new Error('RETENTION_MANIFEST_INVALID')
    if (resource.storage === 'STAGED_OBJECT' && !SAFE_OBJECT.test(resource.objectKey)) throw new Error('RETENTION_MANIFEST_INVALID')
    if (resource.storage === 'DRIVE_FILE' && (!SAFE_FILE.test(resource.fileId)
      || !/^(payment|chat)-\d{2}-[a-f0-9]{64}\.(jpg|png)$/.test(resource.fileName))) {
      throw new Error('RETENTION_MANIFEST_INVALID')
    }
    const slot = `${resource.kind}:${resource.ordinal}`
    if (slots.has(slot)) throw new Error('RETENTION_MANIFEST_INVALID')
    slots.add(slot)
  }
  for (const kind of ['PAYMENT', 'CHAT'] as const) {
    const ordinals = resources.filter((resource): resource is DraftRetentionResource => resource.storage !== 'CASE_FOLDER' && resource.kind === kind)
      .map((resource) => resource.ordinal).sort((a, b) => a - b)
    if (ordinals.length > 0 && ordinals.some((ordinal, index) => ordinal !== index)) throw new Error('RETENTION_MANIFEST_INVALID')
  }
}

function compareResource(left: RetentionResource, right: RetentionResource): number {
  if (left.storage === 'CASE_FOLDER' || right.storage === 'CASE_FOLDER') return left.storage.localeCompare(right.storage)
  return left.kind.localeCompare(right.kind) || left.ordinal - right.ordinal || left.storage.localeCompare(right.storage)
}
function sameKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}
function validIso(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value))
}
