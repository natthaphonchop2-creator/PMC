import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createRetentionManifest,
  draftRetentionId,
  type DraftRetentionResource,
  type RetentionRecordV2,
} from '../../../shared/pmcMiniAppDraftRetention'
import {
  miniAppEvidenceFileMarkerV2,
  miniAppEvidenceFileNameV2,
  miniAppEvidenceObjectKeyV2,
  miniAppEvidenceUploadIdV2,
  type MiniAppEvidenceSlotIdentityV2,
} from '../../../shared/pmcMiniAppEvidence'
import type { PmcMiniAppTargetRequestRecord } from '../../../shared/pmcBookingRowContracts'
import {
  approveDraftEvidenceRetention,
  executeDraftEvidenceRetention,
  previewDraftEvidenceRetention,
} from '../src/workflows/draftEvidenceCleanup'
import { createTestPorts } from './helpers/fakes'

describe('owner-approved draft evidence cleanup', () => {
  it('requires a terminal draft and approval never deletes storage', () => {
    const fixture = cleanupFixture({ state: 'READY_TO_CONFIRM', retentionState: '' })
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)

    expect(() => approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )).toThrow('RETENTION_DRAFT_NOT_TERMINAL')
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([])
    expect(fixture.cleanup).not.toHaveBeenCalled()
  })

  it('approves without side effects, then cleans exact staged and Drive resources', () => {
    const fixture = cleanupFixture()
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    expect(preview).toMatchObject({
      status: 'PENDING', resourceCount: 2, stagedObjectCount: 1, driveResourceCount: 1,
      eligible: true,
    })

    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )
    expect(approved.status).toBe('APPROVED')
    expect(fixture.cleanup).not.toHaveBeenCalled()
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([])

    const cleaned = executeDraftEvidenceRetention(
      fixture.retentionId,
      approved.version,
      owner,
      fixture.ports,
    )
    expect(cleaned.status).toBe('CLEANED')
    expect(fixture.cleanup).toHaveBeenCalledTimes(1)
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([fixture.driveFileId])
    expect(fixture.ports.retention.get(fixture.retentionId)).toMatchObject({
      status: 'CLEANED', approvedBy: owner, cleanupAttemptCount: 1,
    })
  })

  it('fails closed on a moved or re-marked Drive file before staged cleanup', () => {
    const fixture = cleanupFixture({ wrongDriveMarker: true })
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )

    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      approved.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_RETRYABLE')
    expect(fixture.cleanup).not.toHaveBeenCalled()
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([])
    expect(fixture.ports.retention.get(fixture.retentionId)).toMatchObject({
      status: 'FAILED_RETRYABLE', safeErrorCode: 'RETENTION_CLEANUP_FAILED',
    })
  })

  it('converges after storage response loss and Sheet completion failure', () => {
    const fixture = cleanupFixture()
    let remoteCleaned = false
    fixture.cleanup.mockImplementation(() => {
      if (!remoteCleaned) {
        remoteCleaned = true
        throw new Error('response lost')
      }
      return { cleanedCount: 1 }
    })
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )
    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      approved.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_RETRYABLE')

    const afterLoss = fixture.ports.retention.get(fixture.retentionId)!
    const originalSetStatus = fixture.ports.repositories.retention.setStatus
    let failCompletionOnce = true
    fixture.ports.repositories.retention.setStatus = (id, version, status, patch) => {
      if (status === 'CLEANED' && failCompletionOnce) {
        failCompletionOnce = false
        throw new Error('sheet completion lost')
      }
      return originalSetStatus(id, version, status, patch)
    }
    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      afterLoss.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_RETRYABLE')
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([fixture.driveFileId])

    const retry = fixture.ports.retention.get(fixture.retentionId)!
    const result = executeDraftEvidenceRetention(
      fixture.retentionId,
      retry.version,
      owner,
      fixture.ports,
    )
    expect(result.status).toBe('CLEANED')
    expect(fixture.ports.drive.trashedEvidenceFileIds()).toEqual([fixture.driveFileId])
    const cleanupCalls = fixture.cleanup.mock.calls.length

    const replay = executeDraftEvidenceRetention(
      fixture.retentionId,
      result.version,
      owner,
      fixture.ports,
    )
    expect(replay).toMatchObject({ status: 'CLEANED', version: result.version })
    expect(fixture.cleanup).toHaveBeenCalledTimes(cleanupCalls)
  })

  it('fences a second executor while the first cleanup lease is active', () => {
    const fixture = cleanupFixture()
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )
    const cleaning = fixture.ports.retention.setStatus(
      fixture.retentionId,
      approved.version,
      'CLEANING',
      {
        cleanupAttemptCount: 1,
        cleanupClaimId: 'a'.repeat(64),
        cleanupLeaseUntil: '2026-08-20T09:10:00+07:00',
      },
    )

    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      cleaning.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_CONFLICT')
    expect(fixture.cleanup).not.toHaveBeenCalled()
  })

  it('requires the same effective owner who approved cleanup', () => {
    const fixture = cleanupFixture()
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )
    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      approved.version,
      'other-owner@example.com',
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_OWNER_MISMATCH')
  })

  it('rejects an already-trashed Drive file whose exact parent or marker changed before retry', () => {
    const fixture = cleanupFixture()
    const preview = previewDraftEvidenceRetention(fixture.retentionId, fixture.ports)
    const approved = approveDraftEvidenceRetention(
      fixture.retentionId,
      preview.version,
      preview.approvalDigest,
      'owner cleanup',
      owner,
      fixture.ports,
    )
    const originalSetStatus = fixture.ports.repositories.retention.setStatus
    let failCompletionOnce = true
    fixture.ports.repositories.retention.setStatus = (id, version, status, patch) => {
      if (status === 'CLEANED' && failCompletionOnce) {
        failCompletionOnce = false
        throw new Error('sheet completion lost')
      }
      return originalSetStatus(id, version, status, patch)
    }
    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      approved.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_RETRYABLE')
    fixture.ports.drive.seedEvidenceFile({
      id: fixture.driveFileId,
      folderId: 'moved-folder',
      name: fixture.driveFileName,
      mimeType: 'image/jpeg',
      marker: 'changed-marker',
    })
    const failed = fixture.ports.retention.get(fixture.retentionId)!

    expect(() => executeDraftEvidenceRetention(
      fixture.retentionId,
      failed.version,
      owner,
      fixture.ports,
    )).toThrow('RETENTION_CLEANUP_RETRYABLE')
  })
})

const now = '2026-08-20T09:00:00+07:00'
const owner = 'owner@example.com'

function cleanupFixture(options: {
  state?: PmcMiniAppTargetRequestRecord['state']
  retentionState?: PmcMiniAppTargetRequestRecord['retentionState']
  wrongDriveMarker?: boolean
} = {}) {
  const ports = createTestPorts()
  const payment = stagedResource('PAYMENT', 0)
  const chat = driveResource('CHAT', 0)
  const intake = ports.drive.ensureChildFolder('drive-root', '_MINI_APP_INTAKE', 'mini-app-intake:v1')
  ports.drive.seedEvidenceFile({
    id: chat.fileId,
    folderId: intake.id,
    name: chat.fileName,
    mimeType: chat.mimeType,
    marker: options.wrongDriveMarker
      ? 'wrong-marker'
      : miniAppEvidenceFileMarkerV2(slot('CHAT', 0), chat.uploadId),
  })
  const request = draft({
    state: options.state ?? 'CANCELLED',
    retentionState: options.retentionState ?? 'PENDING_APPROVAL',
    paymentEvidenceObjectKeys: [payment.objectKey],
    chatEvidenceFileIds: [chat.fileId],
    evidenceCount: 2,
  })
  ports.miniAppRequests.list = () => [structuredClone(request)]
  ports.miniAppRequests.getByRequestId = () => structuredClone(request)
  const manifest = createRetentionManifest([payment, chat], ports.crypto.sha256Hex)
  const retentionId = draftRetentionId(request.draftId, ports.crypto.sha256Base64Url)
  const record: RetentionRecordV2 = {
    id: retentionId,
    scope: 'DRAFT_EVIDENCE',
    caseId: null,
    draftId: request.draftId,
    trigger: 'DRAFT_CANCELLED',
    eligibleAt: now,
    status: 'PENDING',
    ...manifest,
    approvedBy: '',
    approvedAt: '',
    reason: '',
    cleanupAttemptCount: 0,
    cleanupClaimId: '',
    cleanupLeaseUntil: '',
    cleanedAt: '',
    safeErrorCode: '',
    version: 1,
  }
  ports.retention.upsert(record, 0)
  const cleanup = vi.fn(() => ({ cleanedCount: 1 }))
  ports.draftCleanup = { clean: cleanup }
  return { ports, retentionId, driveFileId: chat.fileId, driveFileName: chat.fileName, cleanup }
}

function draft(patch: Partial<PmcMiniAppTargetRequestRecord>): PmcMiniAppTargetRequestRecord {
  return {
    protocolVersion: 2,
    requestId: 'request-1',
    draftId: 'draft-1',
    staffId: 'admin-1',
    recorderName: 'Admin A',
    adminId: 'admin-1',
    adminName: 'Admin A',
    lineUserIdHash: 'line-hash',
    state: 'DRAFT',
    retentionState: '',
    version: 1,
    payloadHash: null,
    aeId: null,
    aeName: 'ไม่ระบุ',
    customerName: '',
    facebookName: '',
    phoneNormalized: '',
    doctorId: '',
    serviceId: '',
    queueType: 'NORMAL',
    appointmentDate: null,
    appointmentTime: null,
    depositAmount: 0,
    channelId: '',
    paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [],
    evidenceCount: 0,
    createdAt: now,
    confirmedAt: null,
    caseId: null,
    confirmationStatus: null,
    safeErrorCode: null,
    updatedAt: now,
    paymentEvidenceObjectKeys: [],
    chatEvidenceObjectKeys: [],
    taskName: null,
    queuedAt: null,
    processingStartedAt: null,
    processingLeaseUntil: null,
    lastProgressAt: null,
    attemptCount: 0,
    processingOwnerToken: null,
    evidenceProjectionHash: null,
    ...patch,
  }
}

function stagedResource(kind: 'PAYMENT' | 'CHAT', ordinal: number): DraftRetentionResource & { storage: 'STAGED_OBJECT' } {
  const identity = slot(kind, ordinal)
  const uploadId = miniAppEvidenceUploadIdV2(identity, sha256Hex)
  return {
    storage: 'STAGED_OBJECT',
    kind,
    ordinal,
    uploadId,
    contentSha256: identity.contentSha256,
    mimeType: identity.mimeType,
    objectKey: miniAppEvidenceObjectKeyV2(identity, uploadId),
  }
}

function driveResource(kind: 'PAYMENT' | 'CHAT', ordinal: number): DraftRetentionResource & { storage: 'DRIVE_FILE' } {
  const identity = slot(kind, ordinal)
  const uploadId = miniAppEvidenceUploadIdV2(identity, sha256Hex)
  return {
    storage: 'DRIVE_FILE',
    kind,
    ordinal,
    uploadId,
    contentSha256: identity.contentSha256,
    mimeType: identity.mimeType,
    fileId: `${kind.toLowerCase()}-cleanup-file-1000`,
    fileName: miniAppEvidenceFileNameV2(identity, uploadId),
  }
}

function slot(kind: 'PAYMENT' | 'CHAT', ordinal: number): MiniAppEvidenceSlotIdentityV2 {
  return {
    requestId: 'request-1',
    draftId: 'draft-1',
    evidenceKind: kind,
    ordinal,
    mimeType: 'image/jpeg',
    contentSha256: sha256Hex(`${kind}:${ordinal}`),
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
