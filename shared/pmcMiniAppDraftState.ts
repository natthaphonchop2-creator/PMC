export type MiniAppDraftStateOperation = 'PREPARE_READY' | 'PREPARE_PARTIAL' | 'CANCEL'

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

export type MiniAppDraftStateMutation = MiniAppDraftPrepareMutation | MiniAppDraftCancelMutation

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
  state: 'DRAFT' | 'READY_TO_CONFIRM' | 'CANCELLED' | 'EXPIRED'
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
  state: 'DRAFT' | 'READY_TO_CONFIRM' | 'CANCELLED' | 'EXPIRED'
  retentionState: '' | 'PENDING_APPROVAL'
  version: number
  evidenceProjectionHash: string | null
  input: MiniAppNormalizedBookingInputV2 | null
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  evidenceCount: number
}

export function canonicalMiniAppDraftStateIngress(envelope: UnsignedMiniAppDraftStateEnvelope): string {
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: envelope.payload.operation === 'CANCEL' ? {
      operation: envelope.payload.operation,
      requestId: envelope.payload.requestId,
      draftId: envelope.payload.draftId,
      expectedVersion: envelope.payload.expectedVersion,
      expectedAttempt: envelope.payload.expectedAttempt,
      nowIso: envelope.payload.nowIso,
    } : {
      operation: envelope.payload.operation,
      requestId: envelope.payload.requestId,
      draftId: envelope.payload.draftId,
      expectedVersion: envelope.payload.expectedVersion,
      expectedAttempt: envelope.payload.expectedAttempt,
      baseVersion: envelope.payload.baseVersion,
      nowIso: envelope.payload.nowIso,
      prepareBindingHash: envelope.payload.prepareBindingHash,
      input: envelope.payload.input,
      evidence: envelope.payload.evidence,
    },
  })
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
  })
}
