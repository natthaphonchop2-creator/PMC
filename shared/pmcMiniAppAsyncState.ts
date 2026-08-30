export type MiniAppAsyncStateOperation = 'QUEUE' | 'CLAIM' | 'RENEW' | 'PROJECT' | 'RETRY' | 'EXHAUST' | 'COMPLETE'
export type MiniAppAsyncRequestState =
  | 'DRAFT' | 'UPLOADING' | 'READY_TO_CONFIRM' | 'QUEUED' | 'PROCESSING' | 'RETRYING'
  | 'CONFIRMING' | 'CONFIRMED' | 'CONFIRMED_WITH_RETRY' | 'NEEDS_REVIEW'
  | 'FAILED_RETRYABLE' | 'CANCELLED' | 'EXPIRED'
export type MiniAppAsyncConfirmationStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'

import type { BookingProtocolVersion } from './pmcBookingProtocol'

export interface MiniAppAsyncRequestRecordV1 {
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
  evidenceProjectionHash: string | null
  createdAt: string
  confirmedAt: string | null
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
  safeErrorCode: string | null
  updatedAt: string
}

export type MiniAppAsyncRequestRecordV2 = Omit<MiniAppAsyncRequestRecordV1, 'aeName'> & {
  protocolVersion: Extract<BookingProtocolVersion, 2>
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string | null
}

export type MiniAppAsyncRequestRecord = MiniAppAsyncRequestRecordV1

export const MINI_APP_ASYNC_REQUEST_HEADERS_V1 = [
  'requestId', 'draftId', 'staffId', 'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash',
  'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus', 'safeErrorCode', 'updatedAt',
  'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt', 'processingStartedAt',
  'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken', 'evidenceProjectionHash',
] as const

export const MINI_APP_ASYNC_REQUEST_HEADERS = MINI_APP_ASYNC_REQUEST_HEADERS_V1

export const MINI_APP_ASYNC_REQUEST_HEADERS_V2 = [
  'requestId', 'draftId', 'protocolVersion', 'staffId', 'recorderName', 'adminId', 'adminName',
  'lineUserIdHash', 'state', 'retentionState', 'version', 'payloadHash', 'aeId', 'aeName',
  'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId', 'queueType',
  'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId', 'paymentEvidenceFileIdsJson',
  'chatEvidenceFileIdsJson', 'evidenceCount', 'createdAt', 'confirmedAt', 'caseId', 'confirmationStatus',
  'safeErrorCode', 'updatedAt', 'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson',
  'taskName', 'queuedAt', 'processingStartedAt', 'processingLeaseUntil', 'lastProgressAt', 'attemptCount',
  'processingOwnerToken', 'evidenceProjectionHash',
] as const

export interface MiniAppEvidenceProjectionBinding {
  requestId: string
  draftId: string
  payloadHash: string
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  evidenceCount: number
}

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

export function canonicalMiniAppAsyncIdentity(record: Pick<MiniAppAsyncRequestRecordV1,
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

export function canonicalMiniAppEvidenceProjection(binding: MiniAppEvidenceProjectionBinding): string {
  return JSON.stringify({
    requestId: binding.requestId,
    draftId: binding.draftId,
    payloadHash: binding.payloadHash,
    paymentEvidenceObjectKeys: binding.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: binding.chatEvidenceObjectKeys,
    paymentEvidenceFileIds: binding.paymentEvidenceFileIds,
    chatEvidenceFileIds: binding.chatEvidenceFileIds,
    evidenceCount: binding.evidenceCount,
  })
}
