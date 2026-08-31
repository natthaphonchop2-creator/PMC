import {
  parseRetentionManifest,
  type DraftRetentionResource,
  type RetentionRecordV2,
  type RetentionResource,
} from '../../../../shared/pmcMiniAppDraftRetention'
import {
  miniAppEvidenceFileMarkerV2,
  miniAppEvidenceFileNameV2,
  miniAppEvidenceObjectKeyV2,
  miniAppEvidenceUploadIdV2,
} from '../../../../shared/pmcMiniAppEvidence'
import type { BookingPorts, MiniAppRequestStateRecord } from '../ports'

const CLEANUP_LEASE_MS = 10 * 60_000
type DriveResource = Extract<DraftRetentionResource, { storage: 'DRIVE_FILE' }>

export interface DraftRetentionPreview {
  scope: RetentionRecordV2['scope']
  status: RetentionRecordV2['status']
  resourceCount: number
  stagedObjectCount: number
  driveResourceCount: number
  eligible: boolean
  version: number
  manifestDigest: string
  approvalDigest: string
}

export function previewDraftEvidenceRetention(
  retentionId: string,
  ports: BookingPorts,
): DraftRetentionPreview {
  const record = requireRetention(retentionId, ports)
  const resources = resourcesFor(record, ports)
  return preview(record, resources, ports)
}

export function approveDraftEvidenceRetention(
  retentionId: string,
  expectedVersion: number,
  approvalDigest: string,
  reason: string,
  actor: string,
  ports: BookingPorts,
): DraftRetentionPreview {
  const owner = ownerEmail(actor)
  if (!reason.trim() || reason.trim().length > 500) throw new Error('RETENTION_APPROVAL_INVALID')
  return ports.locks.withLock(() => {
    const record = requireRetention(retentionId, ports)
    const resources = resourcesFor(record, ports)
    const current = preview(record, resources, ports)
    if (record.version !== expectedVersion || current.approvalDigest !== approvalDigest
      || record.status !== 'PENDING' || !current.eligible) throw new Error('RETENTION_APPROVAL_CONFLICT')
    assertCleanupBinding(record, resources, ports)
    const approved = ports.repositories.retention.setStatus(record.id, record.version, 'APPROVED', {
      approvedBy: owner,
      approvedAt: ports.clock.nowIso(),
      reason: reason.trim(),
      safeErrorCode: '',
    })
    appendCleanupAudit(
      approved,
      'DRAFT_EVIDENCE_CLEANUP_APPROVED',
      record.status,
      approved.status,
      resources.length,
      ports,
    )
    return preview(approved, resources, ports)
  })
}

export function executeDraftEvidenceRetention(
  retentionId: string,
  expectedVersion: number,
  actor: string,
  ports: BookingPorts,
): DraftRetentionPreview {
  const owner = ownerEmail(actor)
  let record = ports.locks.withLock(() => claimCleanup(retentionId, expectedVersion, owner, ports))
  const resources = resourcesFor(record, ports)
  try {
    preflightResources(record, resources, ports)
    const staged = resources.filter((resource): resource is Extract<
      DraftRetentionResource,
      { storage: 'STAGED_OBJECT' }
    > => resource.storage === 'STAGED_OBJECT')
    if (staged.length) {
      if (!ports.draftCleanup) throw new Error('DRAFT_CLEANUP_NOT_CONFIGURED')
      const result = ports.draftCleanup.clean({
        cleanupClaimId: record.cleanupClaimId,
        manifestDigest: record.manifestDigest,
        resources: staged,
      })
      if (result.cleanedCount !== staged.length) throw new Error('DRAFT_CLEANUP_FAILED')
    }
    for (const resource of resources) {
      if (resource.storage === 'DRIVE_FILE') {
        ports.drive.trashEvidenceFile(driveCleanupInput(resource, record, ports))
      }
      if (resource.storage === 'CASE_FOLDER') ports.drive.trashFolder(resource.folderId)
    }
    record = ports.locks.withLock(() => completeCleanup(record, ports))
  } catch (error) {
    ports.locks.withLock(() => recordCleanupFailure(record, error, ports))
    throw Object.assign(new Error('RETENTION_CLEANUP_RETRYABLE'), { cause: error })
  }
  appendCleanupAudit(record, 'DRAFT_EVIDENCE_CLEANED', 'CLEANING', record.status, resources.length, ports)
  return preview(record, resources, ports)
}

export function readbackDraftEvidenceRetention(
  retentionId: string,
  ports: BookingPorts,
): DraftRetentionPreview {
  return previewDraftEvidenceRetention(retentionId, ports)
}

function claimCleanup(
  retentionId: string,
  expectedVersion: number,
  owner: string,
  ports: BookingPorts,
): RetentionRecordV2 {
  const record = requireRetention(retentionId, ports)
  if (record.approvedBy !== owner) throw new Error('RETENTION_CLEANUP_OWNER_MISMATCH')
  assertCleanupBinding(record, resourcesFor(record, ports), ports)
  const now = Date.parse(ports.clock.nowIso())
  if (record.status === 'CLEANED') {
    if (record.version !== expectedVersion) throw new Error('RETENTION_CLEANUP_CONFLICT')
    return record
  }
  if (record.status === 'CLEANING' && record.cleanupClaimId
    && Date.parse(record.cleanupLeaseUntil) > now) {
    if (record.version !== expectedVersion) throw new Error('RETENTION_CLEANUP_CONFLICT')
    return record
  }
  if (record.version !== expectedVersion
    || !['APPROVED', 'FAILED_RETRYABLE', 'CLEANING'].includes(record.status)) {
    throw new Error('RETENTION_CLEANUP_CONFLICT')
  }
  const cleanupClaimId = ports.crypto.sha256Hex(`${record.id}:${record.manifestDigest}`)
  return ports.repositories.retention.setStatus(record.id, record.version, 'CLEANING', {
    cleanupAttemptCount: record.cleanupAttemptCount + 1,
    cleanupClaimId,
    cleanupLeaseUntil: new Date(now + CLEANUP_LEASE_MS).toISOString(),
    safeErrorCode: '',
  })
}

function completeCleanup(claimed: RetentionRecordV2, ports: BookingPorts): RetentionRecordV2 {
  const current = requireRetention(claimed.id, ports)
  if (current.status === 'CLEANED' && current.manifestDigest === claimed.manifestDigest) return current
  if (current.status !== 'CLEANING' || current.cleanupClaimId !== claimed.cleanupClaimId
    || current.manifestDigest !== claimed.manifestDigest) throw new Error('RETENTION_CLEANUP_CONFLICT')
  return ports.repositories.retention.setStatus(current.id, current.version, 'CLEANED', {
    cleanedAt: ports.clock.nowIso(),
    cleanupLeaseUntil: '',
    safeErrorCode: '',
  })
}

function recordCleanupFailure(claimed: RetentionRecordV2, error: unknown, ports: BookingPorts): void {
  const current = ports.repositories.retention.get(claimed.id)
  if (!current || current.status !== 'CLEANING' || current.cleanupClaimId !== claimed.cleanupClaimId) return
  ports.repositories.retention.setStatus(current.id, current.version, 'FAILED_RETRYABLE', {
    cleanupLeaseUntil: '',
    safeErrorCode: safeCleanupError(error),
  })
}

function preflightResources(
  record: RetentionRecordV2,
  resources: readonly RetentionResource[],
  ports: BookingPorts,
): void {
  assertCleanupBinding(record, resources, ports)
  for (const resource of resources) {
    if (resource.storage === 'DRIVE_FILE') {
      ports.drive.verifyEvidenceFile(driveCleanupInput(resource, record, ports))
    }
    if (resource.storage === 'CASE_FOLDER') ports.drive.verifyFolder(resource.folderId)
  }
}

function driveCleanupInput(resource: DriveResource, record: RetentionRecordV2, ports: BookingPorts) {
  const request = requestForRetention(record, ports)
  const slot = {
    requestId: request.requestId,
    draftId: request.draftId,
    evidenceKind: resource.kind,
    ordinal: resource.ordinal,
    mimeType: resource.mimeType,
    contentSha256: resource.contentSha256,
  }
  return {
    fileId: resource.fileId,
    parentFolderId: ports.drive.evidenceIntakeFolderId(),
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    marker: miniAppEvidenceFileMarkerV2(slot, resource.uploadId),
  }
}

function assertCleanupBinding(
  record: RetentionRecordV2,
  resources: readonly RetentionResource[],
  ports: BookingPorts,
): void {
  if (record.scope === 'CASE_FOLDER') {
    const booking = record.caseId ? ports.repositories.bookings.getByCaseId(record.caseId) : null
    const folder = resources.length === 1 && resources[0]?.storage === 'CASE_FOLDER'
      ? resources[0]
      : null
    if (!booking || !folder || booking.driveFolderId !== folder.folderId
      || !['CLOSED_JERA', 'REFUNDED', 'EXPIRED_6M'].includes(booking.status)) {
      throw new Error('RETENTION_CASE_NOT_TERMINAL')
    }
    return
  }
  const request = requestForRetention(record, ports)
  if (!['CANCELLED', 'EXPIRED'].includes(request.state)
    || request.retentionState !== 'PENDING_APPROVAL') {
    throw new Error('RETENTION_DRAFT_NOT_TERMINAL')
  }
  for (const resource of resources) {
    if (resource.storage === 'CASE_FOLDER') throw new Error('RETENTION_MANIFEST_INVALID')
    const values = evidenceValues(request, resource)
    if (values[resource.ordinal] !== resourceValue(resource)) {
      throw new Error('RETENTION_MANIFEST_REQUEST_MISMATCH')
    }
    const slot = {
      requestId: request.requestId,
      draftId: request.draftId,
      evidenceKind: resource.kind,
      ordinal: resource.ordinal,
      mimeType: resource.mimeType,
      contentSha256: resource.contentSha256,
    }
    const expectedUploadId = miniAppEvidenceUploadIdV2(slot, ports.crypto.sha256Hex)
    if (resource.uploadId !== expectedUploadId) throw new Error('RETENTION_MANIFEST_REQUEST_MISMATCH')
    if (resource.storage === 'DRIVE_FILE'
      && resource.fileName !== miniAppEvidenceFileNameV2(slot, expectedUploadId)) {
      throw new Error('RETENTION_MANIFEST_REQUEST_MISMATCH')
    }
    if (resource.storage === 'STAGED_OBJECT') {
      const extension = resource.mimeType === 'image/jpeg' ? 'jpg' : 'png'
      const legacy = `drafts/${request.draftId}/${resource.kind}/${resource.contentSha256}.${extension}`
      if (resource.objectKey !== legacy
        && resource.objectKey !== miniAppEvidenceObjectKeyV2(slot, expectedUploadId)) {
        throw new Error('RETENTION_MANIFEST_REQUEST_MISMATCH')
      }
    }
  }
}

function requestForRetention(
  record: RetentionRecordV2,
  ports: BookingPorts,
): MiniAppRequestStateRecord {
  if (!record.draftId || !ports.miniAppRequests.list) {
    throw new Error('MINI_APP_REQUEST_LIST_UNAVAILABLE')
  }
  const matches = ports.miniAppRequests.list().filter((item) => item.draftId === record.draftId)
  if (matches.length !== 1) throw new Error('RETENTION_DRAFT_NOT_TERMINAL')
  return matches[0]!
}

function evidenceValues(
  request: MiniAppRequestStateRecord,
  resource: DraftRetentionResource,
): string[] {
  if (resource.storage === 'STAGED_OBJECT') {
    return resource.kind === 'PAYMENT'
      ? request.paymentEvidenceObjectKeys
      : request.chatEvidenceObjectKeys
  }
  return resource.kind === 'PAYMENT'
    ? request.paymentEvidenceFileIds
    : request.chatEvidenceFileIds
}

function resourceValue(resource: DraftRetentionResource): string {
  return resource.storage === 'STAGED_OBJECT' ? resource.objectKey : resource.fileId
}

function resourcesFor(record: RetentionRecordV2, ports: BookingPorts): RetentionResource[] {
  return parseRetentionManifest(
    record.resourceManifestJson,
    record.manifestDigest,
    ports.crypto.sha256Hex,
  )
}

function requireRetention(id: string, ports: BookingPorts): RetentionRecordV2 {
  const record = ports.repositories.retention.get(id)
  if (!record) throw new Error('RETENTION_NOT_FOUND')
  return record
}

function preview(
  record: RetentionRecordV2,
  resources: readonly RetentionResource[],
  ports: BookingPorts,
): DraftRetentionPreview {
  const binding = JSON.stringify({
    id: record.id,
    scope: record.scope,
    status: record.status,
    eligibleAt: record.eligibleAt,
    version: record.version,
    manifestDigest: record.manifestDigest,
  })
  return {
    scope: record.scope,
    status: record.status,
    resourceCount: resources.length,
    stagedObjectCount: resources.filter((resource) => resource.storage === 'STAGED_OBJECT').length,
    driveResourceCount: resources.filter((resource) => resource.storage !== 'STAGED_OBJECT').length,
    eligible: Date.parse(record.eligibleAt) <= Date.parse(ports.clock.nowIso()),
    version: record.version,
    manifestDigest: record.manifestDigest,
    approvalDigest: ports.crypto.sha256Hex(binding),
  }
}

function appendCleanupAudit(
  record: RetentionRecordV2,
  action: 'DRAFT_EVIDENCE_CLEANUP_APPROVED' | 'DRAFT_EVIDENCE_CLEANED',
  beforeStatus: string,
  afterStatus: string,
  resourceCount: number,
  ports: BookingPorts,
): void {
  const eventId = `AUDIT-RETENTION-${action}-${ports.clock.nowIso()}-${record.version}`
  if (ports.repositories.audit.listByEventId(eventId).length > 0) return
  ports.repositories.audit.append({
    eventId,
    caseId: '',
    actor: 'OWNER',
    action,
    target: 'RETENTION_BATCH',
    before: { status: beforeStatus, resourceCount },
    after: { status: afterStatus, resourceCount },
    reason: action === 'DRAFT_EVIDENCE_CLEANUP_APPROVED' ? 'OWNER_APPROVED' : 'OWNER_EXECUTED',
    timestamp: ports.clock.nowIso(),
    correlationId: 'RETENTION_CLEANUP',
  })
}

function ownerEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new Error('RETENTION_OWNER_IDENTITY_REQUIRED')
  }
  return normalized
}

function safeCleanupError(error: unknown): string {
  const value = error instanceof Error ? error.message : ''
  return /^[A-Z0-9_]{1,80}$/.test(value) ? value : 'RETENTION_CLEANUP_FAILED'
}
