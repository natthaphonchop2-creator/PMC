import {
  createRetentionManifest,
  draftRetentionId,
  type DraftRetentionResource,
  type RetentionRecordV2,
  type RetentionStatus,
} from '../../../../shared/pmcMiniAppDraftRetention'
import {
  miniAppEvidenceFileNameV2,
  miniAppEvidenceObjectKeyV2,
  miniAppEvidenceUploadIdV2,
} from '../../../../shared/pmcMiniAppEvidence'
import type { MiniAppDraftPrepareMutation, MiniAppDraftStateMutation } from '../../../../shared/pmcMiniAppDraftState'
import type { PmcMiniAppTargetRequestRecord } from '../../../../shared/pmcBookingRowContracts'
import type { BookingPorts } from '../ports'

type P2Record = PmcMiniAppTargetRequestRecord & { protocolVersion: 2 }

export function reconcileDraftRetentionMutation(
  current: P2Record,
  next: P2Record,
  payload: MiniAppDraftStateMutation,
  ports: BookingPorts,
): void {
  if (payload.operation === 'PREPARE_READY' || payload.operation === 'PREPARE_PARTIAL') {
    const resources = resourcesFromPrepare(payload, next, ports)
    if (resources.length > 0) upsertDraftRetention(next, resources,
      next.state === 'CANCELLED' || next.state === 'EXPIRED' || payload.operation === 'PREPARE_PARTIAL' ? 'PENDING' : 'ACTIVE',
      payload.operation, ports)
    return
  }
  if (payload.operation === 'CANCEL') {
    transitionExistingDraftRetention(next.draftId, 'PENDING', 'DRAFT_CANCELLED', ports)
    return
  }
  if (payload.operation === 'CONFIRM_COMPLETE'
    && (next.state === 'CONFIRMED' || next.state === 'CONFIRMED_WITH_RETRY')) {
    transitionExistingDraftRetention(next.draftId, 'PROMOTED', 'DRAFT_CONFIRMED', ports)
    return
  }
  if (payload.operation === 'CONFIRM_FAIL' && current.state === 'CONFIRMING') {
    transitionExistingDraftRetention(next.draftId, 'ACTIVE', 'CONFIRM_RETRYABLE', ports)
  }
}

export function transitionExistingDraftRetention(
  draftId: string,
  status: RetentionStatus,
  trigger: string,
  ports: BookingPorts,
): RetentionRecordV2 | null {
  const existing = ports.repositories.retention.getByDraftId(draftId)
  if (!existing || existing.status === status && existing.trigger === trigger) return existing
  return ports.repositories.retention.upsert({
    ...existing,
    trigger,
    status,
    approvedBy: '', approvedAt: '', reason: '', cleanupClaimId: '', cleanupLeaseUntil: '',
    cleanedAt: '', safeErrorCode: '', version: existing.version + 1,
  }, existing.version)
}

export function upsertDraftRetention(
  draft: P2Record,
  resources: readonly DraftRetentionResource[],
  status: 'ACTIVE' | 'PENDING',
  trigger: string,
  ports: BookingPorts,
): RetentionRecordV2 {
  const manifest = createRetentionManifest(resources, ports.crypto.sha256Hex)
  const id = draftRetentionId(draft.draftId, ports.crypto.sha256Base64Url)
  const existing = ports.repositories.retention.get(id)
  if (existing && existing.scope !== 'DRAFT_EVIDENCE') throw new Error('retention identity conflict')
  const manifestChanged = existing?.manifestDigest !== manifest.manifestDigest
  const next: RetentionRecordV2 = {
    id, scope: 'DRAFT_EVIDENCE', caseId: null, draftId: draft.draftId,
    trigger, eligibleAt: draft.updatedAt, status,
    ...manifest,
    approvedBy: manifestChanged ? '' : existing?.approvedBy ?? '',
    approvedAt: manifestChanged ? '' : existing?.approvedAt ?? '',
    reason: manifestChanged ? '' : existing?.reason ?? '',
    cleanupAttemptCount: manifestChanged ? 0 : existing?.cleanupAttemptCount ?? 0,
    cleanupClaimId: '', cleanupLeaseUntil: '', cleanedAt: '', safeErrorCode: '',
    version: existing ? existing.version + 1 : 1,
  }
  if (existing && equivalentRetention(existing, next)) return existing
  return ports.repositories.retention.upsert(next, existing?.version ?? 0)
}

function resourcesFromPrepare(
  payload: MiniAppDraftPrepareMutation,
  persisted: P2Record,
  ports: BookingPorts,
): DraftRetentionResource[] {
  const resources: DraftRetentionResource[] = []
  for (const item of payload.evidence) {
    const values = item.storage === 'STAGED_OBJECT'
      ? item.kind === 'PAYMENT' ? persisted.paymentEvidenceObjectKeys : persisted.chatEvidenceObjectKeys
      : item.kind === 'PAYMENT' ? persisted.paymentEvidenceFileIds : persisted.chatEvidenceFileIds
    const value = item.value ?? values[item.ordinal] ?? null
    if (value === null) continue
    const slot = {
      requestId: payload.requestId, draftId: payload.draftId, evidenceKind: item.kind,
      ordinal: item.ordinal, mimeType: item.mimeType, contentSha256: item.contentSha256,
    }
    const uploadId = miniAppEvidenceUploadIdV2(slot, ports.crypto.sha256Hex)
    if (item.storage === 'STAGED_OBJECT') {
      const objectKey = miniAppEvidenceObjectKeyV2(slot, uploadId)
      const extension = item.mimeType === 'image/jpeg' ? 'jpg' : 'png'
      const legacyObjectKey = `drafts/${payload.draftId}/${item.kind}/${item.contentSha256}.${extension}`
      if (value !== objectKey && value !== legacyObjectKey) throw new Error('retention evidence binding conflict')
      resources.push({
        storage: 'STAGED_OBJECT' as const, kind: item.kind, ordinal: item.ordinal, uploadId,
        contentSha256: item.contentSha256, mimeType: item.mimeType, objectKey: value,
      })
      continue
    }
    const fileName = miniAppEvidenceFileNameV2(slot, uploadId)
    resources.push({
      storage: 'DRIVE_FILE' as const, kind: item.kind, ordinal: item.ordinal, uploadId,
      contentSha256: item.contentSha256, mimeType: item.mimeType, fileId: value, fileName,
    })
  }
  return resources
}

function equivalentRetention(left: RetentionRecordV2, right: RetentionRecordV2): boolean {
  const fields: Array<keyof RetentionRecordV2> = [
    'scope', 'caseId', 'draftId', 'trigger', 'eligibleAt', 'status', 'resourceManifestJson', 'manifestDigest',
    'approvedBy', 'approvedAt', 'reason', 'cleanupAttemptCount', 'cleanupClaimId', 'cleanupLeaseUntil',
    'cleanedAt', 'safeErrorCode',
  ]
  return fields.every((field) => left[field] === right[field])
}
