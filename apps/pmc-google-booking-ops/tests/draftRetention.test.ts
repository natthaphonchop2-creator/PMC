import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { MiniAppDraftPrepareMutation, MiniAppDraftStateMutation } from '../../../shared/pmcMiniAppDraftState'
import { createRetentionManifest, parseRetentionManifest } from '../../../shared/pmcMiniAppDraftRetention'
import type { PmcMiniAppTargetRequestRecord } from '../../../shared/pmcBookingRowContracts'
import { retentionQueueMigrationPlan } from '../src/domain/sheetMigration'
import { approveEvidenceDeletion, reconcileAndExpireDraftEvidenceRetention } from '../src/workflows/retention'
import { reconcileDraftRetentionMutation } from '../src/workflows/draftRetention'
import { createTestPorts } from './helpers/fakes'

describe('draft evidence retention lifecycle', () => {
  it('creates one pending batch, replays idempotently, and promotes the same manifest when ready', () => {
    const ports = createTestPorts()
    const current = draft()
    const partial = prepare('PREPARE_PARTIAL', [driveEvidence('PAYMENT', 0), nullEvidence('CHAT', 0)])
    const partialNext = { ...current, retentionState: 'PENDING_APPROVAL' as const, version: 2 }

    reconcileDraftRetentionMutation(current, partialNext, partial, ports)
    reconcileDraftRetentionMutation(current, partialNext, partial, ports)

    expect(ports.retention.list()).toHaveLength(1)
    expect(ports.retention.list()[0]).toMatchObject({ status: 'PENDING', trigger: 'PREPARE_PARTIAL', version: 1 })

    const readyPayload = prepare('PREPARE_READY', [driveEvidence('PAYMENT', 0), driveEvidence('CHAT', 0)])
    const ready = { ...current, state: 'READY_TO_CONFIRM' as const, version: 3, updatedAt: now }
    reconcileDraftRetentionMutation(partialNext, ready, readyPayload, ports)

    const retained = ports.retention.list()[0]!
    expect(retained).toMatchObject({ status: 'ACTIVE', trigger: 'PREPARE_READY', version: 2 })
    expect(parseRetentionManifest(retained.resourceManifestJson, retained.manifestDigest, sha256Hex)).toHaveLength(2)
  })

  it('revokes approval when a partial manifest grows', () => {
    const ports = createTestPorts()
    const current = draft()
    const one = prepare('PREPARE_PARTIAL', [driveEvidence('PAYMENT', 0), nullEvidence('CHAT', 0)])
    reconcileDraftRetentionMutation(current, { ...current, version: 2 }, one, ports)
    const initial = ports.retention.list()[0]!
    ports.retention.setStatus(initial.id, initial.version, 'APPROVED', {
      approvedBy: 'owner@example.com', approvedAt: now, reason: 'approved',
    })

    const grown = prepare('PREPARE_PARTIAL', [driveEvidence('PAYMENT', 0), driveEvidence('CHAT', 0)])
    reconcileDraftRetentionMutation(current, { ...current, version: 3 }, grown, ports)

    expect(ports.retention.list()[0]).toMatchObject({
      status: 'PENDING', approvedBy: '', approvedAt: '', reason: '', cleanupAttemptCount: 0,
    })
  })

  it('moves the same draft batch through cancellation and confirmation without deleting', () => {
    const ports = createTestPorts()
    const current = draft()
    const readyPayload = prepare('PREPARE_READY', [driveEvidence('PAYMENT', 0), driveEvidence('CHAT', 0)])
    const ready = { ...current, state: 'READY_TO_CONFIRM' as const, version: 2 }
    reconcileDraftRetentionMutation(current, ready, readyPayload, ports)
    const cancel: MiniAppDraftStateMutation = {
      operation: 'CANCEL', requestId: current.requestId, draftId: current.draftId,
      expectedVersion: 2, expectedAttempt: 0, nowIso: now,
    }
    const cancelled = { ...ready, state: 'CANCELLED' as const, retentionState: 'PENDING_APPROVAL' as const, version: 3 }
    reconcileDraftRetentionMutation(ready, cancelled, cancel, ports)
    expect(ports.retention.list()[0]).toMatchObject({ status: 'PENDING', trigger: 'DRAFT_CANCELLED' })
    expect(ports.drive.trashedFolderIds()).toEqual([])

    const confirmed = { ...ready, state: 'CONFIRMED' as const, version: 4 }
    const complete: MiniAppDraftStateMutation = {
      operation: 'CONFIRM_COMPLETE', requestId: current.requestId, draftId: current.draftId,
      expectedVersion: 3, expectedAttempt: 0, nowIso: now, payloadHash: 'a'.repeat(43),
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }
    reconcileDraftRetentionMutation(cancelled, confirmed, complete, ports)
    expect(ports.retention.list()[0]).toMatchObject({ status: 'PROMOTED', trigger: 'DRAFT_CONFIRMED' })
  })

  it('expires stale resumable drafts during daily reconciliation but never deletes evidence', () => {
    const ports = createTestPorts({ now: '2026-08-22T10:00:00+07:00' })
    const current = draft({ updatedAt: '2026-08-20T09:00:00+07:00' })
    const readyPayload = prepare('PREPARE_READY', [driveEvidence('PAYMENT', 0), driveEvidence('CHAT', 0)])
    reconcileDraftRetentionMutation(current, { ...current, state: 'READY_TO_CONFIRM', version: 2 }, readyPayload, ports)
    let row: PmcMiniAppTargetRequestRecord = {
      ...current, state: 'READY_TO_CONFIRM', version: 2,
      paymentEvidenceFileIds: ['payment-file-1000'], chatEvidenceFileIds: ['chat-file-1000'], evidenceCount: 2,
    }
    ports.miniAppRequests.list = () => [structuredClone(row)]
    ports.miniAppRequests.getByRequestId = () => structuredClone(row)
    ports.miniAppRequests.updateByRequestId = vi.fn((_requestId, expectedVersion, next) => {
      expect(expectedVersion).toBe(row.version); row = structuredClone(next as PmcMiniAppTargetRequestRecord); return row
    })

    expect(reconcileAndExpireDraftEvidenceRetention(ports)).toEqual({ expired: 1, repaired: 0 })
    expect(row).toMatchObject({ state: 'EXPIRED', retentionState: 'PENDING_APPROVAL', version: 3 })
    expect(ports.retention.list()[0]).toMatchObject({ status: 'PENDING', trigger: 'DRAFT_TTL_EXPIRED' })
    expect(ports.drive.trashedFolderIds()).toEqual([])
  })

  it('approves a case-folder batch without deleting it', () => {
    const ports = createTestPorts({ now: '2026-11-19T09:00:00+07:00' })
    const manifest = createRetentionManifest([{ storage: 'CASE_FOLDER', folderId: 'folder-3' }], sha256Hex)
    ports.retention.upsert({
      id: 'RETENTION-PMC-202608-0001', scope: 'CASE_FOLDER', caseId: 'PMC-202608-0001', draftId: null,
      trigger: 'CASE_TERMINAL', eligibleAt: now, status: 'PENDING', ...manifest,
      approvedBy: '', approvedAt: '', reason: '', cleanupAttemptCount: 0, cleanupClaimId: '',
      cleanupLeaseUntil: '', cleanedAt: '', safeErrorCode: '', version: 1,
    }, 0)
    approveEvidenceDeletion('RETENTION-PMC-202608-0001', 'manager@example.com', 'retention policy', ports)
    expect(ports.retention.get('RETENTION-PMC-202608-0001')).toMatchObject({ status: 'APPROVED' })
    expect(ports.drive.trashedFolderIds()).toEqual([])
  })
})

describe('RETENTION_QUEUE V1 to V2 plan', () => {
  it('backfills one exact case-folder manifest and maps an old approval to CLEANED', () => {
    const plan = retentionQueueMigrationPlan(
      ['id', 'caseId', 'eligibleAt', 'status', 'approvedBy', 'approvedAt', 'reason', 'version'],
      [{
        id: 'RETENTION-PMC-202608-0001', caseId: 'PMC-202608-0001', eligibleAt: now,
        status: 'APPROVED', approvedBy: 'owner@example.com', approvedAt: now, reason: 'done', version: 2,
      }],
      [{ caseId: 'PMC-202608-0001', driveFolderId: 'folder-3' }],
      sha256Hex,
    )
    expect(plan).toMatchObject({ kind: 'REPLACE_RETENTION_QUEUE_V2' })
    if (plan.kind !== 'REPLACE_RETENTION_QUEUE_V2') throw new Error('unexpected plan')
    expect(plan.rows[0]).toMatchObject({ scope: 'CASE_FOLDER', status: 'CLEANED', cleanedAt: now })
    expect(parseRetentionManifest(plan.rows[0]!.resourceManifestJson, plan.rows[0]!.manifestDigest, sha256Hex))
      .toEqual([{ storage: 'CASE_FOLDER', folderId: 'folder-3' }])
  })

  it('fails closed when a case folder cannot be resolved exactly', () => {
    expect(() => retentionQueueMigrationPlan(
      ['id', 'caseId', 'eligibleAt', 'status', 'approvedBy', 'approvedAt', 'reason', 'version'],
      [{ id: 'RETENTION-X', caseId: 'PMC-202608-0001', eligibleAt: now, status: 'PENDING', version: 1 }],
      [{ caseId: 'PMC-202608-0001', driveFolderId: null }], sha256Hex,
    )).toThrow('RETENTION_CASE_FOLDER_UNRESOLVED')
  })
})

const now = '2026-08-20T09:00:00+07:00'
function sha256Hex(value: string): string { return createHash('sha256').update(value).digest('hex') }
function draft(patch: Partial<PmcMiniAppTargetRequestRecord> = {}): PmcMiniAppTargetRequestRecord & { protocolVersion: 2 } {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'admin-1', recorderName: 'Admin A',
    adminId: 'admin-1', adminName: 'Admin A', lineUserIdHash: 'line-hash', state: 'DRAFT', retentionState: '',
    version: 1, payloadHash: null, aeId: null, aeName: 'ไม่ระบุ', customerName: '', facebookName: '',
    phoneNormalized: '', doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null,
    appointmentTime: null, depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [],
    evidenceCount: 0, createdAt: now, confirmedAt: null, caseId: null, confirmationStatus: null,
    safeErrorCode: null, updatedAt: now, paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
    taskName: null, queuedAt: null, processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null,
    attemptCount: 0, processingOwnerToken: null, evidenceProjectionHash: null, ...patch, protocolVersion: 2,
  }
}

function prepare(
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
  evidence: MiniAppDraftPrepareMutation['evidence'],
): MiniAppDraftPrepareMutation {
  return {
    operation, requestId: 'request-1', draftId: 'draft-1', expectedVersion: 1, expectedAttempt: 0,
    baseVersion: 1, nowIso: now, prepareBindingHash: 'a'.repeat(43), input: {
      requestId: 'request-1', adminId: 'admin-1', aeId: null, customerName: 'Customer', facebookName: 'FB',
      phoneNormalized: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'เพจหลัก',
    }, evidence,
  }
}

function driveEvidence(kind: 'PAYMENT' | 'CHAT', ordinal: number) {
  const contentSha256 = sha256Hex(`${kind}:${ordinal}`)
  const slot = { requestId: 'request-1', draftId: 'draft-1', evidenceKind: kind, ordinal,
    mimeType: 'image/jpeg' as const, contentSha256 }
  return { kind, ordinal, contentSha256, mimeType: slot.mimeType,
    storage: 'DRIVE_FILE' as const, value: `${kind.toLowerCase()}-file-${ordinal + 1000}` }
}
function nullEvidence(kind: 'PAYMENT' | 'CHAT', ordinal: number) {
  const item = driveEvidence(kind, ordinal)
  return { kind: item.kind, ordinal, contentSha256: item.contentSha256, mimeType: item.mimeType,
    storage: item.storage, value: null }
}
