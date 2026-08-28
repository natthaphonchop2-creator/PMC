import type { MiniAppBookingIngressResult } from '../../shared/pmcMiniAppBooking.js'
import type { BookingIngressPort } from './bookingIngressClient.js'
import type { EvidenceIngressPort } from './evidenceIngressClient.js'
import type { EvidenceStagingPort } from './stagingStore.js'
import type { AsyncMiniAppStore, MiniAppRequestRecord, MiniAppStore } from './store.js'

const PROCESSING_LEASE_MS = 5 * 60_000
const MAX_TASK_ATTEMPTS = 8
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SAFE_DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,256}$/
const SAFE_CASE_ID = /^PMC-\d{6}-\d{4,}$/

type WorkerSafeErrorCode =
  | 'ASYNC_WORKER_INVALID_INPUT'
  | 'ASYNC_CLAIM_RETRY'
  | 'ASYNC_RETRY_RECORD_FAILED'
  | 'EVIDENCE_COPY_RETRY'
  | 'BOOKING_INGRESS_RETRY'
  | 'BOOKING_COMPLETION_RETRY'
  | 'STAGING_CLEANUP_RETRY'
  | 'STALE_PROCESSING_LEASE'

type WorkerStage = 'EVIDENCE' | 'BOOKING' | 'COMPLETION'

export interface AsyncBookingWorker {
  finalize(input: { requestId: string; draftId: string; attempt: number }): Promise<{
    requestId: string
    caseId: string | null
    state: 'CONFIRMED' | 'RETRYING' | 'NEEDS_REVIEW'
  }>
}

export class AsyncBookingWorkerError extends Error {
  readonly code: WorkerSafeErrorCode

  constructor(code: WorkerSafeErrorCode) {
    super(code)
    this.name = 'AsyncBookingWorkerError'
    this.code = code
  }
}

class AsyncBookingProgressError extends AsyncBookingWorkerError {
  readonly draft: MiniAppRequestRecord

  constructor(code: WorkerSafeErrorCode, draft: MiniAppRequestRecord) {
    super(code)
    this.name = 'AsyncBookingProgressError'
    this.draft = draft
  }
}

export function createAsyncBookingWorker(input: {
  store: MiniAppStore & AsyncMiniAppStore
  staging: EvidenceStagingPort
  evidenceIngress: EvidenceIngressPort
  bookingIngress: BookingIngressPort
  now: () => Date
}): AsyncBookingWorker {
  const nowIso = (): string => {
    const value = input.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')
    }
    return value.toISOString()
  }

  async function copyEvidenceToDrive(draft: MiniAppRequestRecord): Promise<MiniAppRequestRecord> {
    assertEvidenceLayout(draft, false)
    const paymentEvidenceFileIds = await copyMissingEvidence(
      draft,
      'PAYMENT',
      draft.paymentEvidenceObjectKeys,
      draft.paymentEvidenceFileIds,
    )
    const chatEvidenceFileIds = await copyMissingEvidence(
      draft,
      'CHAT',
      draft.chatEvidenceObjectKeys,
      draft.chatEvidenceFileIds,
    )
    const evidenceCount = paymentEvidenceFileIds.length + chatEvidenceFileIds.length
    const updated = await input.store.updateProcessingProjection({
      requestId: draft.requestId,
      expectedAttempt: draft.attemptCount,
      expectedVersion: draft.version,
      nowIso: nowIso(),
      patch: { paymentEvidenceFileIds, chatEvidenceFileIds, evidenceCount },
    })
    try {
      assertProjectionPersisted(draft, updated, paymentEvidenceFileIds, chatEvidenceFileIds)
    } catch {
      throw new AsyncBookingProgressError('EVIDENCE_COPY_RETRY', updated)
    }
    return updated
  }

  async function copyMissingEvidence(
    draft: MiniAppRequestRecord,
    kind: 'PAYMENT' | 'CHAT',
    objectKeys: readonly string[],
    existingFileIds: readonly string[],
  ): Promise<string[]> {
    const fileIds = [...existingFileIds]
    for (let ordinal = fileIds.length; ordinal < objectKeys.length; ordinal += 1) {
      const staged = await input.staging.get(objectKeys[ordinal]!)
      const fileId = await input.evidenceIngress.upload({
        draftId: draft.draftId,
        requestId: draft.requestId,
        kind,
        mimeType: staged.mimeType,
        bytes: staged.bytes,
      })
      if (!SAFE_DRIVE_FILE_ID.test(fileId)) throw new AsyncBookingWorkerError('EVIDENCE_COPY_RETRY')
      fileIds[ordinal] = fileId
    }
    return fileIds
  }

  async function submitBooking(draft: MiniAppRequestRecord): Promise<MiniAppBookingIngressResult> {
    assertEvidenceLayout(draft, true)
    const result = await input.bookingIngress.send(draft)
    if (!SAFE_CASE_ID.test(result.caseId) || !isConfirmationStatus(result.status)) {
      throw new AsyncBookingWorkerError('BOOKING_INGRESS_RETRY')
    }
    return result
  }

  async function recordCompletion(
    draft: MiniAppRequestRecord,
    result: MiniAppBookingIngressResult,
  ): Promise<MiniAppRequestRecord> {
    const completed = await input.store.completeAsyncBooking({
      requestId: draft.requestId,
      caseId: result.caseId,
      status: result.status,
      projectionState: 'CONFIRMED',
      nowIso: nowIso(),
      expectedAttempt: draft.attemptCount,
      expectedVersion: draft.version,
    })
    if (completed.state !== 'CONFIRMED' || completed.caseId !== result.caseId) {
      throw new AsyncBookingWorkerError('BOOKING_COMPLETION_RETRY')
    }
    return completed
  }

  async function cleanupVerifiedStaging(draft: MiniAppRequestRecord): Promise<void> {
    if (draft.state !== 'CONFIRMED' || !draft.caseId) {
      throw new AsyncBookingWorkerError('STAGING_CLEANUP_RETRY')
    }
    assertEvidenceLayout(draft, true)
    for (const objectKey of [...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys]) {
      await input.staging.deleteVerified(objectKey)
    }
  }

  return {
    async finalize(finalizeInput) {
      assertFinalizeInput(finalizeInput)
      let claim: Awaited<ReturnType<AsyncMiniAppStore['claimProcessing']>>
      try {
        const claimedAt = nowIso()
        claim = await input.store.claimProcessing({
          requestId: finalizeInput.requestId,
          draftId: finalizeInput.draftId,
          nowIso: claimedAt,
          leaseUntil: new Date(Date.parse(claimedAt) + PROCESSING_LEASE_MS).toISOString(),
        })
      } catch (error) {
        throw safeWorkerError(error, 'ASYNC_CLAIM_RETRY')
      }

      if (!claim.claimed) {
        const terminal = terminalResult(claim.draft)
        if (terminal) return terminal
        throw new AsyncBookingWorkerError('ASYNC_CLAIM_RETRY')
      }

      let draft = claim.draft
      let stage: WorkerStage = 'EVIDENCE'
      try {
        draft = await copyEvidenceToDrive(draft)
        stage = 'BOOKING'
        const result = await submitBooking(draft)
        stage = 'COMPLETION'
        draft = await recordCompletion(draft, result)
      } catch (error) {
        if (error instanceof AsyncBookingProgressError) draft = error.draft
        const leaseError = leaseOwnershipError(error)
        if (leaseError) throw leaseError
        const safeCode = stageErrorCode(stage)
        let failed: MiniAppRequestRecord
        try {
          failed = await input.store.markAsyncRetry({
            requestId: draft.requestId,
            safeErrorCode: finalizeInput.attempt === MAX_TASK_ATTEMPTS ? 'RETRY_EXHAUSTED' : safeCode,
            nowIso: nowIso(),
            expectedAttempt: draft.attemptCount,
            expectedVersion: draft.version,
          })
        } catch (retryError) {
          throw leaseOwnershipError(retryError) ?? new AsyncBookingWorkerError('ASYNC_RETRY_RECORD_FAILED')
        }
        const terminal = terminalResult(failed)
        if (terminal) return terminal
        throw new AsyncBookingWorkerError(safeCode)
      }

      const terminal = terminalResult(draft)
      if (!terminal) throw new AsyncBookingWorkerError('BOOKING_COMPLETION_RETRY')
      try {
        await cleanupVerifiedStaging(draft)
      } catch (error) {
        safeWorkerError(error, 'STAGING_CLEANUP_RETRY')
      }
      return terminal
    },
  }
}

function assertFinalizeInput(input: { requestId: string; draftId: string; attempt: number }): void {
  if (!SAFE_ID.test(input.requestId) || !SAFE_ID.test(input.draftId)
    || !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > MAX_TASK_ATTEMPTS) {
    throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')
  }
}

function assertEvidenceLayout(draft: MiniAppRequestRecord, requireCompleteFileIds: boolean): void {
  const paymentCount = draft.paymentEvidenceObjectKeys.length
  const chatCount = draft.chatEvidenceObjectKeys.length
  if (paymentCount < 1 || chatCount < 1 || draft.evidenceCount !== paymentCount + chatCount
    || draft.paymentEvidenceFileIds.length > paymentCount || draft.chatEvidenceFileIds.length > chatCount
    || requireCompleteFileIds && (draft.paymentEvidenceFileIds.length !== paymentCount
      || draft.chatEvidenceFileIds.length !== chatCount)
    || !draft.paymentEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))
    || !draft.chatEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))) {
    throw new AsyncBookingWorkerError('EVIDENCE_COPY_RETRY')
  }
}

function assertProjectionPersisted(
  previous: MiniAppRequestRecord,
  updated: MiniAppRequestRecord,
  paymentEvidenceFileIds: readonly string[],
  chatEvidenceFileIds: readonly string[],
): void {
  if (updated.requestId !== previous.requestId || updated.draftId !== previous.draftId || updated.state !== 'PROCESSING'
    || updated.attemptCount !== previous.attemptCount || updated.version !== previous.version + 1
    || updated.evidenceCount !== paymentEvidenceFileIds.length + chatEvidenceFileIds.length
    || !sameStrings(updated.paymentEvidenceFileIds, paymentEvidenceFileIds)
    || !sameStrings(updated.chatEvidenceFileIds, chatEvidenceFileIds)) {
    throw new AsyncBookingWorkerError('EVIDENCE_COPY_RETRY')
  }
  assertEvidenceLayout(updated, true)
}

function terminalResult(draft: MiniAppRequestRecord): Awaited<ReturnType<AsyncBookingWorker['finalize']>> | null {
  if (draft.state === 'CONFIRMED' && draft.caseId && SAFE_CASE_ID.test(draft.caseId)) {
    return { requestId: draft.requestId, caseId: draft.caseId, state: 'CONFIRMED' }
  }
  if (draft.state === 'NEEDS_REVIEW') {
    return { requestId: draft.requestId, caseId: draft.caseId, state: 'NEEDS_REVIEW' }
  }
  return null
}

function stageErrorCode(stage: WorkerStage): WorkerSafeErrorCode {
  if (stage === 'EVIDENCE') return 'EVIDENCE_COPY_RETRY'
  if (stage === 'BOOKING') return 'BOOKING_INGRESS_RETRY'
  return 'BOOKING_COMPLETION_RETRY'
}

function leaseOwnershipError(error: unknown): AsyncBookingWorkerError | null {
  const code = error instanceof Error ? error.message : ''
  return code === 'STALE_PROCESSING_LEASE' || code === 'DRAFT_NOT_PROCESSING' || code === 'PROCESSING_LEASE_EXPIRED'
    ? new AsyncBookingWorkerError('STALE_PROCESSING_LEASE')
    : null
}

function safeWorkerError(error: unknown, fallback: WorkerSafeErrorCode): AsyncBookingWorkerError {
  return leaseOwnershipError(error) ?? new AsyncBookingWorkerError(fallback)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isConfirmationStatus(value: string): value is MiniAppBookingIngressResult['status'] {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}
