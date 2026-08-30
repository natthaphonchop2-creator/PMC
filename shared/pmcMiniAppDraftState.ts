import {
  canonicalMiniAppAsyncIdentity,
  type MiniAppAsyncConfirmationStatus,
  type MiniAppAsyncRequestRecordV1,
} from './pmcMiniAppAsyncState'

export type MiniAppDraftStateOperation =
  | 'PREPARE_BEGIN' | 'PREPARE_READY' | 'PREPARE_PARTIAL' | 'CANCEL'
  | 'CONFIRM_CLAIM' | 'CONFIRM_COMPLETE' | 'CONFIRM_FAIL'

export interface MiniAppNormalizedBookingInputV2 {
  requestId: string
  adminId: string
  aeId: string | null
  customerName: string
  facebookName: string
  phoneNormalized: string
  doctorId: string
  serviceId: string
  queueType: 'NORMAL' | 'AUTO'
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
}

export interface MiniAppDraftEvidenceItem {
  kind: 'PAYMENT' | 'CHAT'
  ordinal: number
  contentSha256: string
  mimeType: 'image/jpeg' | 'image/png'
  storage: 'STAGED_OBJECT' | 'DRIVE_FILE'
  value: string | null
}

export type MiniAppDraftEvidenceManifestItem = Omit<MiniAppDraftEvidenceItem, 'value'>

export interface MiniAppDraftPrepareBeginMutation {
  operation: 'PREPARE_BEGIN'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  baseVersion: number
  nowIso: string
  prepareBindingHash: string
  input: MiniAppNormalizedBookingInputV2
  evidence: MiniAppDraftEvidenceManifestItem[]
}

export interface MiniAppDraftPrepareMutation {
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  baseVersion: number
  nowIso: string
  prepareBindingHash: string
  input: MiniAppNormalizedBookingInputV2
  evidence: MiniAppDraftEvidenceItem[]
}

export interface MiniAppDraftCancelMutation {
  operation: 'CANCEL'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  nowIso: string
}

export interface MiniAppDraftConfirmClaimMutation {
  operation: 'CONFIRM_CLAIM'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  nowIso: string
  payloadHash: string
}

export interface MiniAppDraftConfirmCompleteMutation {
  operation: 'CONFIRM_COMPLETE'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  nowIso: string
  payloadHash: string
  caseId: string
  confirmationStatus: MiniAppAsyncConfirmationStatus
}

export interface MiniAppDraftConfirmFailMutation {
  operation: 'CONFIRM_FAIL'
  requestId: string
  draftId: string
  expectedVersion: number
  expectedAttempt: number
  nowIso: string
  payloadHash: string
  safeErrorCode: string
}

export type MiniAppDraftStateMutation =
  | MiniAppDraftPrepareBeginMutation
  | MiniAppDraftPrepareMutation
  | MiniAppDraftCancelMutation
  | MiniAppDraftConfirmClaimMutation
  | MiniAppDraftConfirmCompleteMutation
  | MiniAppDraftConfirmFailMutation

export interface UnsignedMiniAppDraftStateEnvelope {
  kind: 'MINI_APP_DRAFT_STATE'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppDraftStateMutation
}

export interface MiniAppDraftStateEnvelope extends UnsignedMiniAppDraftStateEnvelope {
  signature: string
}

export interface MiniAppDraftStateResult {
  requestId: string
  draftId: string
  state: 'DRAFT' | 'READY_TO_CONFIRM' | 'CONFIRMING' | 'FAILED_RETRYABLE' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'
  version: number
  outcome: 'APPLIED' | 'IDEMPOTENT' | 'TERMINAL'
  projectionDigest: string
}

export interface MiniAppPrepareBindingProjection {
  requestId: string
  draftId: string
  baseVersion: number
  staffId: string
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string
  input: MiniAppNormalizedBookingInputV2
  evidence: Array<Omit<MiniAppDraftEvidenceItem, 'value'>>
}

export interface MiniAppDraftProjection {
  requestId: string
  draftId: string
  protocolVersion: 2
  staffId: string
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string
  state: MiniAppDraftStateResult['state']
  retentionState: '' | 'PENDING_APPROVAL'
  version: number
  evidenceProjectionHash: string | null
  input: MiniAppNormalizedBookingInputV2 | null
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  evidenceCount: number
  payloadHash: string | null
  attemptCount: number
  confirmedAt: string | null
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
  safeErrorCode: string | null
}

export function canonicalMiniAppDraftStateIngress(envelope: UnsignedMiniAppDraftStateEnvelope): string {
  const payload = envelope.payload
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: canonicalDraftStatePayload(payload),
  })
}

function canonicalDraftStatePayload(payload: MiniAppDraftStateMutation) {
  if (payload.operation === 'CANCEL') return canonicalCancel(payload)
  if (payload.operation === 'PREPARE_BEGIN' || payload.operation === 'PREPARE_READY' || payload.operation === 'PREPARE_PARTIAL') {
    return canonicalPrepare(payload)
  }
  if (payload.operation === 'CONFIRM_CLAIM') return canonicalConfirmClaim(payload)
  if (payload.operation === 'CONFIRM_COMPLETE') return canonicalConfirmComplete(payload)
  if (payload.operation === 'CONFIRM_FAIL') return canonicalConfirmFail(payload)
  throw new Error('unsupported mini app draft-state operation')
}

function canonicalCancel(payload: MiniAppDraftCancelMutation) {
  return {
    operation: payload.operation, requestId: payload.requestId, draftId: payload.draftId,
    expectedVersion: payload.expectedVersion, expectedAttempt: payload.expectedAttempt, nowIso: payload.nowIso,
  }
}

function canonicalPrepare(payload: MiniAppDraftPrepareBeginMutation | MiniAppDraftPrepareMutation) {
  return {
    operation: payload.operation, requestId: payload.requestId, draftId: payload.draftId,
    expectedVersion: payload.expectedVersion, expectedAttempt: payload.expectedAttempt, baseVersion: payload.baseVersion,
    nowIso: payload.nowIso, prepareBindingHash: payload.prepareBindingHash, input: payload.input, evidence: payload.evidence,
  }
}

function canonicalConfirmClaim(payload: MiniAppDraftConfirmClaimMutation) {
  return {
    operation: payload.operation, requestId: payload.requestId, draftId: payload.draftId,
    expectedVersion: payload.expectedVersion, expectedAttempt: payload.expectedAttempt,
    nowIso: payload.nowIso, payloadHash: payload.payloadHash,
  }
}

function canonicalConfirmComplete(payload: MiniAppDraftConfirmCompleteMutation) {
  return {
    operation: payload.operation, requestId: payload.requestId, draftId: payload.draftId,
    expectedVersion: payload.expectedVersion, expectedAttempt: payload.expectedAttempt,
    nowIso: payload.nowIso, payloadHash: payload.payloadHash,
    caseId: payload.caseId, confirmationStatus: payload.confirmationStatus,
  }
}

function canonicalConfirmFail(payload: MiniAppDraftConfirmFailMutation) {
  return {
    operation: payload.operation, requestId: payload.requestId, draftId: payload.draftId,
    expectedVersion: payload.expectedVersion, expectedAttempt: payload.expectedAttempt,
    nowIso: payload.nowIso, payloadHash: payload.payloadHash, safeErrorCode: payload.safeErrorCode,
  }
}

export function canonicalMiniAppPrepareBinding(binding: MiniAppPrepareBindingProjection): string {
  return JSON.stringify({
    requestId: binding.requestId,
    draftId: binding.draftId,
    baseVersion: binding.baseVersion,
    staffId: binding.staffId,
    recorderName: binding.recorderName,
    adminId: binding.adminId,
    adminName: binding.adminName,
    aeId: binding.aeId,
    aeName: binding.aeName,
    input: binding.input,
    evidence: binding.evidence,
  })
}

export function canonicalMiniAppDraftProjection(projection: MiniAppDraftProjection): string {
  return JSON.stringify({
    requestId: projection.requestId,
    draftId: projection.draftId,
    protocolVersion: projection.protocolVersion,
    staffId: projection.staffId,
    recorderName: projection.recorderName,
    adminId: projection.adminId,
    adminName: projection.adminName,
    aeId: projection.aeId,
    aeName: projection.aeName,
    state: projection.state,
    retentionState: projection.retentionState,
    version: projection.version,
    evidenceProjectionHash: projection.evidenceProjectionHash,
    input: projection.input,
    paymentEvidenceFileIds: projection.paymentEvidenceFileIds,
    chatEvidenceFileIds: projection.chatEvidenceFileIds,
    paymentEvidenceObjectKeys: projection.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: projection.chatEvidenceObjectKeys,
    evidenceCount: projection.evidenceCount,
    payloadHash: projection.payloadHash,
    attemptCount: projection.attemptCount,
    confirmedAt: projection.confirmedAt,
    caseId: projection.caseId,
    confirmationStatus: projection.confirmationStatus,
    safeErrorCode: projection.safeErrorCode,
  })
}

export type MiniAppP2BookingIdentityRecord = Pick<MiniAppAsyncRequestRecordV1,
  | 'requestId' | 'staffId' | 'aeName' | 'customerName' | 'facebookName' | 'phoneNormalized'
  | 'doctorId' | 'serviceId' | 'queueType' | 'appointmentDate' | 'appointmentTime'
  | 'depositAmount' | 'channelId' | 'paymentEvidenceFileIds' | 'chatEvidenceFileIds'
  | 'paymentEvidenceObjectKeys' | 'chatEvidenceObjectKeys'
> & {
  protocolVersion: 2
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
}

export function canonicalMiniAppP2BookingIdentity(record: MiniAppP2BookingIdentityRecord): string {
  return JSON.stringify({
    protocolVersion: record.protocolVersion,
    staffId: record.staffId,
    recorderName: record.recorderName,
    adminId: record.adminId,
    adminName: record.adminName,
    aeId: record.aeId,
    aeName: record.aeName,
    booking: JSON.parse(canonicalMiniAppAsyncIdentity(record)) as unknown,
  })
}
