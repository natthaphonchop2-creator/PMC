export type MiniAppAsyncStateOperation = 'QUEUE' | 'CLAIM' | 'RENEW' | 'PROJECT' | 'RETRY' | 'EXHAUST' | 'COMPLETE'
export type MiniAppAsyncRequestState =
  | 'DRAFT' | 'UPLOADING' | 'READY_TO_CONFIRM' | 'QUEUED' | 'PROCESSING' | 'RETRYING'
  | 'CONFIRMING' | 'CONFIRMED' | 'CONFIRMED_WITH_RETRY' | 'NEEDS_REVIEW'
  | 'FAILED_RETRYABLE' | 'CANCELLED' | 'EXPIRED'
export type MiniAppAsyncConfirmationStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'

export interface MiniAppAsyncRequestRecord {
  requestId: string
  draftId: string
  staffId: string
  lineUserIdHash: string
  state: MiniAppAsyncRequestState
  retentionState: '' | 'PENDING_APPROVAL'
  version: number
  payloadHash: string | null
  aeName: string
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
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  evidenceCount: number
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  taskName: string | null
  queuedAt: string | null
  processingStartedAt: string | null
  processingLeaseUntil: string | null
  lastProgressAt: string | null
  attemptCount: number
  processingOwnerToken: string | null
  createdAt: string
  confirmedAt: string | null
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
  safeErrorCode: string | null
  updatedAt: string
}

export const MINI_APP_ASYNC_REQUEST_HEADERS = [
  'requestId', 'draftId', 'staffId', 'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash',
  'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus', 'safeErrorCode', 'updatedAt',
  'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt', 'processingStartedAt',
  'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken',
] as const

export interface MiniAppAsyncStateMutation {
  operation: MiniAppAsyncStateOperation
  requestId: string
  draftId: string
  payloadHash: string
  expectedVersion: number
  expectedAttempt: number
  taskAttempt: number
  leaseOwnerToken: string | null
  nowIso: string
  leaseUntil: string | null
  taskName: string | null
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  evidenceCount: number
  safeErrorCode: string | null
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
}

export interface UnsignedMiniAppAsyncStateIngressEnvelope {
  kind: 'MINI_APP_ASYNC_STATE'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppAsyncStateMutation
}

export interface MiniAppAsyncStateIngressEnvelope extends UnsignedMiniAppAsyncStateIngressEnvelope {
  signature: string
}

export interface MiniAppAsyncStateIngressResult {
  requestId: string
  draftId: string
  state: MiniAppAsyncRequestState
  version: number
  attemptCount: number
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
  outcome: 'APPLIED' | 'IDEMPOTENT' | 'BUSY' | 'TERMINAL'
}

export function canonicalMiniAppAsyncStateIngress(envelope: UnsignedMiniAppAsyncStateIngressEnvelope): string {
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: {
      operation: envelope.payload.operation,
      requestId: envelope.payload.requestId,
      draftId: envelope.payload.draftId,
      payloadHash: envelope.payload.payloadHash,
      expectedVersion: envelope.payload.expectedVersion,
      expectedAttempt: envelope.payload.expectedAttempt,
      taskAttempt: envelope.payload.taskAttempt,
      leaseOwnerToken: envelope.payload.leaseOwnerToken,
      nowIso: envelope.payload.nowIso,
      leaseUntil: envelope.payload.leaseUntil,
      taskName: envelope.payload.taskName,
      paymentEvidenceObjectKeys: envelope.payload.paymentEvidenceObjectKeys,
      chatEvidenceObjectKeys: envelope.payload.chatEvidenceObjectKeys,
      paymentEvidenceFileIds: envelope.payload.paymentEvidenceFileIds,
      chatEvidenceFileIds: envelope.payload.chatEvidenceFileIds,
      evidenceCount: envelope.payload.evidenceCount,
      safeErrorCode: envelope.payload.safeErrorCode,
      caseId: envelope.payload.caseId,
      confirmationStatus: envelope.payload.confirmationStatus,
    },
  })
}

export function canonicalMiniAppAsyncIdentity(record: Pick<MiniAppAsyncRequestRecord,
  | 'requestId' | 'staffId' | 'aeName' | 'customerName' | 'facebookName' | 'phoneNormalized'
  | 'doctorId' | 'serviceId' | 'queueType' | 'appointmentDate' | 'appointmentTime'
  | 'depositAmount' | 'channelId' | 'paymentEvidenceFileIds' | 'chatEvidenceFileIds'
  | 'paymentEvidenceObjectKeys' | 'chatEvidenceObjectKeys'
>): string {
  const stagedEvidence = record.paymentEvidenceObjectKeys.length > 0 || record.chatEvidenceObjectKeys.length > 0
  return JSON.stringify({
    requestId: record.requestId,
    staffId: record.staffId,
    aeName: record.aeName,
    customerName: record.customerName,
    facebookName: record.facebookName,
    phoneNormalized: record.phoneNormalized,
    doctorId: record.doctorId,
    serviceId: record.serviceId,
    queueType: record.queueType,
    appointmentDate: record.appointmentDate,
    appointmentTime: record.appointmentTime,
    depositAmount: record.depositAmount,
    channelId: record.channelId,
    paymentEvidenceFileIds: stagedEvidence ? [] : record.paymentEvidenceFileIds,
    chatEvidenceFileIds: stagedEvidence ? [] : record.chatEvidenceFileIds,
    paymentEvidenceObjectKeys: record.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: record.chatEvidenceObjectKeys,
  })
}
