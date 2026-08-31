export interface UnsignedBookingQueueAttestation {
  version: 1
  environment: string
  queueResourceDigest: string
  state: 'PAUSED' | 'RUNNING'
  activeTaskCount: number
  verifiedAt: string
  checkerVersion: string
  attestationId: string
}

export interface BookingQueueAttestation extends UnsignedBookingQueueAttestation {
  digest: string
}

export interface BookingMigrationExpectedState {
  requestHeaderHash: string
  masterHeaderHash: string
  requestValueHash: string
  masterValueHash: string
  requestNonTargetValueHash: string
  masterNonTargetValueHash: string
  requestPreservationHash: string
  masterPreservationHash: string
}

export type BookingMigrationManifestState = 'PREPARED' | 'COMPLETE' | 'RESTORE_REQUIRED'

export interface BookingMigrationManifestPayload {
  version: 1
  migration: 'PMC_BOOKING_ATTRIBUTION_V2'
  state: BookingMigrationManifestState
  sourceFingerprint: string
  backupFileId: string
  backupMimeType: 'application/vnd.google-apps.spreadsheet'
  backupParentId: string
  backupSourceFingerprint: string
  expected: BookingMigrationExpectedState
  requestRowCount: number
  masterRowCount: number
  queueAttestationDigest: string
  preparedAt: string
  updatedAt: string
  completedAt: string | null
  safeFailureCode: string | null
}

export interface BookingMigrationManifest extends BookingMigrationManifestPayload {
  digest: string
}

const QUEUE_KEYS = [
  'version', 'environment', 'queueResourceDigest', 'state', 'activeTaskCount',
  'verifiedAt', 'checkerVersion', 'attestationId', 'digest',
] as const
const MANIFEST_KEYS = [
  'version', 'migration', 'state', 'sourceFingerprint', 'backupFileId', 'backupMimeType',
  'backupParentId', 'backupSourceFingerprint', 'expected', 'requestRowCount', 'masterRowCount',
  'queueAttestationDigest', 'preparedAt', 'updatedAt', 'completedAt', 'safeFailureCode', 'digest',
] as const
const EXPECTED_KEYS = [
  'requestHeaderHash', 'masterHeaderHash', 'requestValueHash', 'masterValueHash',
  'requestNonTargetValueHash', 'masterNonTargetValueHash', 'requestPreservationHash',
  'masterPreservationHash',
] as const

export function canonicalBookingQueueAttestation(value: UnsignedBookingQueueAttestation): string {
  return JSON.stringify({
    version: value.version,
    environment: value.environment,
    queueResourceDigest: value.queueResourceDigest,
    state: value.state,
    activeTaskCount: value.activeTaskCount,
    verifiedAt: value.verifiedAt,
    checkerVersion: value.checkerVersion,
    attestationId: value.attestationId,
  })
}

export function parseBookingQueueAttestationJson(
  raw: string,
  options: {
    nowMs: number
    maxAgeMs: number
    environment: string
    queueResourceDigest: string
    checkerVersion: string
    sha256(value: string): string
  },
): BookingQueueAttestation {
  let candidate: unknown
  try { candidate = JSON.parse(raw) } catch { throw new Error('QUEUE_ATTESTATION_INVALID') }
  if (!isRecord(candidate) || !hasExactKeys(candidate, QUEUE_KEYS)) {
    throw new Error('QUEUE_ATTESTATION_INVALID')
  }
  if (candidate.version !== 1
    || candidate.environment !== options.environment
    || candidate.queueResourceDigest !== options.queueResourceDigest
    || candidate.checkerVersion !== options.checkerVersion
    || !isSha256(candidate.queueResourceDigest)
    || (candidate.state !== 'PAUSED' && candidate.state !== 'RUNNING')
    || !Number.isSafeInteger(candidate.activeTaskCount) || Number(candidate.activeTaskCount) < 0
    || !isExactIso(candidate.verifiedAt)
    || typeof candidate.attestationId !== 'string'
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(candidate.attestationId)
    || !isSha256(candidate.digest)) {
    throw new Error('QUEUE_ATTESTATION_INVALID')
  }
  const verifiedAt = Date.parse(candidate.verifiedAt)
  if (!Number.isFinite(options.nowMs) || !Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs <= 0) {
    throw new Error('QUEUE_ATTESTATION_INVALID')
  }
  if (verifiedAt > options.nowMs + 60_000 || options.nowMs - verifiedAt > options.maxAgeMs) {
    throw new Error('QUEUE_ATTESTATION_STALE')
  }
  const unsigned: UnsignedBookingQueueAttestation = {
    version: 1,
    environment: candidate.environment,
    queueResourceDigest: candidate.queueResourceDigest,
    state: candidate.state,
    activeTaskCount: Number(candidate.activeTaskCount),
    verifiedAt: candidate.verifiedAt,
    checkerVersion: candidate.checkerVersion,
    attestationId: candidate.attestationId,
  }
  if (options.sha256(canonicalBookingQueueAttestation(unsigned)) !== candidate.digest) {
    throw new Error('QUEUE_ATTESTATION_DIGEST_MISMATCH')
  }
  return { ...unsigned, digest: candidate.digest }
}

export function canonicalBookingMigrationManifest(value: BookingMigrationManifestPayload): string {
  return JSON.stringify({
    version: value.version,
    migration: value.migration,
    state: value.state,
    sourceFingerprint: value.sourceFingerprint,
    backupFileId: value.backupFileId,
    backupMimeType: value.backupMimeType,
    backupParentId: value.backupParentId,
    backupSourceFingerprint: value.backupSourceFingerprint,
    expected: {
      requestHeaderHash: value.expected.requestHeaderHash,
      masterHeaderHash: value.expected.masterHeaderHash,
      requestValueHash: value.expected.requestValueHash,
      masterValueHash: value.expected.masterValueHash,
      requestNonTargetValueHash: value.expected.requestNonTargetValueHash,
      masterNonTargetValueHash: value.expected.masterNonTargetValueHash,
      requestPreservationHash: value.expected.requestPreservationHash,
      masterPreservationHash: value.expected.masterPreservationHash,
    },
    requestRowCount: value.requestRowCount,
    masterRowCount: value.masterRowCount,
    queueAttestationDigest: value.queueAttestationDigest,
    preparedAt: value.preparedAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
    safeFailureCode: value.safeFailureCode,
  })
}

export function createBookingMigrationManifestEnvelope(
  payload: BookingMigrationManifestPayload,
  sha256: (value: string) => string,
): BookingMigrationManifest {
  validateManifestPayload(payload)
  const digest = sha256(canonicalBookingMigrationManifest(payload))
  if (!isSha256(digest)) throw new Error('MIGRATION_MANIFEST_INVALID')
  return { ...payload, expected: { ...payload.expected }, digest }
}

export function parseBookingMigrationManifestJson(
  raw: string,
  sha256: (value: string) => string,
): BookingMigrationManifest {
  let candidate: unknown
  try { candidate = JSON.parse(raw) } catch { throw new Error('MIGRATION_MANIFEST_INVALID') }
  if (!isRecord(candidate) || !hasExactKeys(candidate, MANIFEST_KEYS) || !isRecord(candidate.expected)
    || !hasExactKeys(candidate.expected, EXPECTED_KEYS) || !isSha256(candidate.digest)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  const payload = candidate as unknown as BookingMigrationManifestPayload
  validateManifestPayload(payload)
  if (sha256(canonicalBookingMigrationManifest(payload)) !== candidate.digest) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  return { ...payload, expected: { ...payload.expected }, digest: candidate.digest }
}

export function validateBookingMigrationManifestTransition(
  current: BookingMigrationManifest,
  next: BookingMigrationManifestPayload,
): void {
  const allowed = current.state === 'PREPARED'
    ? next.state === 'COMPLETE' || next.state === 'RESTORE_REQUIRED'
    : current.state === 'COMPLETE'
      ? next.state === 'RESTORE_REQUIRED'
      : next.state === 'RESTORE_REQUIRED'
  if (!allowed
    || immutableManifestBinding(current) !== immutableManifestBinding(next)
    || Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
    throw new Error('MIGRATION_MANIFEST_CONFLICT')
  }
}

function validateManifestPayload(value: BookingMigrationManifestPayload): void {
  if (value.version !== 1
    || value.migration !== 'PMC_BOOKING_ATTRIBUTION_V2'
    || !['PREPARED', 'COMPLETE', 'RESTORE_REQUIRED'].includes(value.state)
    || !isSha256(value.sourceFingerprint)
    || !/^[A-Za-z0-9_-]{8,256}$/.test(value.backupFileId)
    || value.backupMimeType !== 'application/vnd.google-apps.spreadsheet'
    || !/^[A-Za-z0-9_-]{8,256}$/.test(value.backupParentId)
    || value.backupSourceFingerprint !== value.sourceFingerprint
    || !EXPECTED_KEYS.every((key) => isSha256(value.expected[key]))
    || !Number.isSafeInteger(value.requestRowCount) || value.requestRowCount < 0
    || !Number.isSafeInteger(value.masterRowCount) || value.masterRowCount < 0
    || !isSha256(value.queueAttestationDigest)
    || !isExactIso(value.preparedAt) || !isExactIso(value.updatedAt)
    || value.completedAt !== null && !isExactIso(value.completedAt)
    || value.safeFailureCode !== null && !/^[A-Z0-9_]{1,80}$/.test(value.safeFailureCode)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  if (value.state === 'PREPARED' && (value.completedAt !== null || value.safeFailureCode !== null)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  if (value.state === 'COMPLETE' && (value.completedAt === null || value.safeFailureCode !== null)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  if (value.state === 'RESTORE_REQUIRED' && (value.completedAt !== null || value.safeFailureCode === null)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.preparedAt)
    || value.completedAt !== null && Date.parse(value.completedAt) < Date.parse(value.preparedAt)) {
    throw new Error('MIGRATION_MANIFEST_INVALID')
  }
}

function immutableManifestBinding(value: BookingMigrationManifestPayload): string {
  return JSON.stringify({
    version: value.version,
    migration: value.migration,
    sourceFingerprint: value.sourceFingerprint,
    backupFileId: value.backupFileId,
    backupMimeType: value.backupMimeType,
    backupParentId: value.backupParentId,
    backupSourceFingerprint: value.backupSourceFingerprint,
    expected: value.expected,
    requestRowCount: value.requestRowCount,
    masterRowCount: value.masterRowCount,
    queueAttestationDigest: value.queueAttestationDigest,
    preparedAt: value.preparedAt,
  })
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

function isExactIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
