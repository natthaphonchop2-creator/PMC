import type { MiniAppBookingIngressResult } from '../../shared/pmcMiniAppBooking.js'
import type { BookingIngressPort } from './bookingIngressClient.js'
import type { EvidenceIngressPort } from './evidenceIngressClient.js'
import type { EvidenceStagingPort } from './stagingStore.js'
import type { AsyncMiniAppStore, MiniAppRequestRecord, MiniAppStore } from './store.js'
import type { WorkerLeaseHandle, WorkerLeasePort } from './workerLease.js'

const PROCESSING_LEASE_MS = 4 * 60_000
const FINAL_ATTEMPT_WAIT_BUDGET_MS = 4 * 60_000
const FINAL_ATTEMPT_POLL_MS = 1_000
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
  | 'WORKER_LEASE_RETRY'

type WorkerStage = 'EVIDENCE' | 'BOOKING' | 'COMPLETION'
type AsyncBookingWorkerResult = {
  requestId: string
  caseId: string | null
  state: 'CONFIRMED' | 'NEEDS_REVIEW'
}

export interface AsyncBookingWorker {
  finalize(input: { requestId: string; draftId: string; attempt: number }): Promise<AsyncBookingWorkerResult>
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
  lease: WorkerLeasePort
  now: () => Date
  wait: (milliseconds: number) => Promise<void>
}): AsyncBookingWorker {
  const nowDate = (): Date => {
    const value = input.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')
    }
    return new Date(value)
  }
  const nowIso = (): string => nowDate().toISOString()
  const leaseUntil = (now: Date): string => new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString()

  async function readTerminal(requestId: string, draftId: string): Promise<AsyncBookingWorkerResult | null> {
    const draft = await input.store.getDraft(draftId)
    if (!draft || draft.requestId !== requestId || draft.draftId !== draftId) return null
    return terminalResult(draft)
  }

  async function safeReadTerminal(requestId: string, draftId: string): Promise<AsyncBookingWorkerResult | null> {
    try { return await readTerminal(requestId, draftId) } catch { return null }
  }

  async function waitForFinalAttempt(startedAt: number, blockedUntil?: string): Promise<void> {
    const current = nowDate().getTime()
    const remaining = FINAL_ATTEMPT_WAIT_BUDGET_MS - (current - startedAt)
    if (remaining <= 0) throw new AsyncBookingWorkerError('WORKER_LEASE_RETRY')
    const untilBlocked = blockedUntil ? Date.parse(blockedUntil) - current : FINAL_ATTEMPT_POLL_MS
    const milliseconds = Math.max(1, Math.min(FINAL_ATTEMPT_POLL_MS, remaining, Math.max(1, untilBlocked)))
    await input.wait(milliseconds)
  }

  async function acquireCoordination(
    finalizeInput: { requestId: string; draftId: string; attempt: number },
    startedAt: number,
  ): Promise<{ lease: WorkerLeaseHandle } | { terminal: AsyncBookingWorkerResult }> {
    while (true) {
      const terminal = await safeReadTerminal(finalizeInput.requestId, finalizeInput.draftId)
      if (terminal) return { terminal }
      const current = nowDate()
      try {
        const acquired = await input.lease.acquire({
          requestId: finalizeInput.requestId,
          nowIso: current.toISOString(),
          leaseUntil: leaseUntil(current),
        })
        if (acquired.acquired) return { lease: acquired.lease }
        if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) throw new AsyncBookingWorkerError('WORKER_LEASE_RETRY')
        await waitForFinalAttempt(startedAt, acquired.expiresAt)
      } catch (error) {
        if (error instanceof AsyncBookingWorkerError) throw error
        if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) throw workerLeaseFailure(error)
        await waitForFinalAttempt(startedAt)
      }
    }
  }

  async function copyEvidenceToDrive(
    draft: MiniAppRequestRecord,
    renew: () => Promise<void>,
  ): Promise<MiniAppRequestRecord> {
    assertEvidenceLayout(draft, false)
    const paymentEvidenceFileIds = await copyMissingEvidence(
      draft, 'PAYMENT', draft.paymentEvidenceObjectKeys, draft.paymentEvidenceFileIds, renew,
    )
    const chatEvidenceFileIds = await copyMissingEvidence(
      draft, 'CHAT', draft.chatEvidenceObjectKeys, draft.chatEvidenceFileIds, renew,
    )
    const evidenceCount = paymentEvidenceFileIds.length + chatEvidenceFileIds.length
    await renew()
    await input.store.updateProcessingProjection({
      requestId: draft.requestId,
      expectedAttempt: draft.attemptCount,
      expectedVersion: draft.version,
      nowIso: nowIso(),
      patch: { paymentEvidenceFileIds, chatEvidenceFileIds, evidenceCount },
    })
    await renew()
    const persisted = await input.store.getDraft(draft.draftId)
    if (!persisted) throw new AsyncBookingProgressError('EVIDENCE_COPY_RETRY', draft)
    try {
      assertProjectionPersisted(draft, persisted, paymentEvidenceFileIds, chatEvidenceFileIds)
    } catch {
      throw new AsyncBookingProgressError('EVIDENCE_COPY_RETRY', persisted)
    }
    return persisted
  }

  async function copyMissingEvidence(
    draft: MiniAppRequestRecord,
    kind: 'PAYMENT' | 'CHAT',
    objectKeys: readonly string[],
    existingFileIds: readonly string[],
    renew: () => Promise<void>,
  ): Promise<string[]> {
    const fileIds = [...existingFileIds]
    for (let ordinal = fileIds.length; ordinal < objectKeys.length; ordinal += 1) {
      await renew()
      const staged = await input.staging.get(objectKeys[ordinal]!)
      await renew()
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

  async function submitBooking(
    draft: MiniAppRequestRecord,
    renew: () => Promise<void>,
  ): Promise<MiniAppBookingIngressResult> {
    assertEvidenceLayout(draft, true)
    await renew()
    const result = await input.bookingIngress.send(draft)
    if (!SAFE_CASE_ID.test(result.caseId) || !isConfirmationStatus(result.status)) {
      throw new AsyncBookingWorkerError('BOOKING_INGRESS_RETRY')
    }
    return result
  }

  async function recordCompletion(
    draft: MiniAppRequestRecord,
    result: MiniAppBookingIngressResult,
    renew: () => Promise<void>,
  ): Promise<MiniAppRequestRecord> {
    await renew()
    await input.store.completeAsyncBooking({
      requestId: draft.requestId,
      caseId: result.caseId,
      status: result.status,
      projectionState: 'CONFIRMED',
      nowIso: nowIso(),
      expectedAttempt: draft.attemptCount,
      expectedVersion: draft.version,
    })
    await renew()
    const persisted = await input.store.getDraft(draft.draftId)
    if (!persisted || !isPersistedCompletion(draft, persisted, result)) {
      throw new AsyncBookingProgressError('BOOKING_COMPLETION_RETRY', persisted ?? draft)
    }
    return persisted
  }

  async function cleanupVerifiedStaging(
    draft: MiniAppRequestRecord,
    renew: () => Promise<void>,
  ): Promise<void> {
    if (draft.state !== 'CONFIRMED' || !draft.caseId) {
      throw new AsyncBookingWorkerError('STAGING_CLEANUP_RETRY')
    }
    assertEvidenceLayout(draft, true)
    for (const objectKey of [...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys]) {
      await renew()
      await input.staging.deleteVerified(objectKey)
    }
  }

  return {
    async finalize(finalizeInput) {
      assertFinalizeInput(finalizeInput)
      const startedAt = nowDate().getTime()
      const coordination = await acquireCoordination(finalizeInput, startedAt)
      if ('terminal' in coordination) return coordination.terminal

      let activeLease = coordination.lease
      const renew = async (): Promise<void> => {
        const current = nowDate()
        try {
          activeLease = await input.lease.renew({
            lease: activeLease,
            nowIso: current.toISOString(),
            leaseUntil: leaseUntil(current),
          })
        } catch (error) {
          throw workerLeaseFailure(error)
        }
      }

      try {
        let claim: Awaited<ReturnType<AsyncMiniAppStore['claimProcessing']>>
        while (true) {
          await renew()
          try {
            const claimedAt = nowIso()
            claim = await input.store.claimProcessing({
              requestId: finalizeInput.requestId,
              draftId: finalizeInput.draftId,
              nowIso: claimedAt,
              leaseUntil: activeLease.expiresAt,
            })
          } catch (error) {
            if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) throw safeWorkerError(error, 'ASYNC_CLAIM_RETRY')
            await waitForFinalAttempt(startedAt)
            continue
          }
          if (claim.claimed) break
          await renew()
          const terminal = await readTerminal(finalizeInput.requestId, finalizeInput.draftId)
          if (terminal) return terminal
          if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) throw new AsyncBookingWorkerError('ASYNC_CLAIM_RETRY')
          await waitForFinalAttempt(startedAt, claim.draft.processingLeaseUntil ?? undefined)
        }

        let draft = claim.draft
        let stage: WorkerStage = 'EVIDENCE'
        try {
          draft = await copyEvidenceToDrive(draft, renew)
          stage = 'BOOKING'
          const result = await submitBooking(draft, renew)
          stage = 'COMPLETION'
          draft = await recordCompletion(draft, result, renew)
        } catch (error) {
          if (error instanceof AsyncBookingProgressError) draft = error.draft
          if (isCoordinationError(error)) throw error
          const leaseError = leaseOwnershipError(error)
          if (leaseError) throw leaseError
          const safeCode = stageErrorCode(stage)

          await renew()
          const current = await input.store.getDraft(draft.draftId)
          if (!current || current.requestId !== draft.requestId || current.draftId !== draft.draftId) {
            throw new AsyncBookingWorkerError('ASYNC_RETRY_RECORD_FAILED')
          }
          const completed = terminalResult(current)
          if (completed) {
            try { await cleanupVerifiedStaging(current, renew) } catch (cleanupError) {
              safeWorkerError(cleanupError, 'STAGING_CLEANUP_RETRY')
            }
            return completed
          }
          if (current.state !== 'PROCESSING' || current.attemptCount !== draft.attemptCount
            || current.version < draft.version || current.version > draft.version + 1) {
            throw new AsyncBookingWorkerError('STALE_PROCESSING_LEASE')
          }
          draft = current

          await renew()
          try {
            await input.store.markAsyncRetry({
              requestId: draft.requestId,
              safeErrorCode: finalizeInput.attempt === MAX_TASK_ATTEMPTS ? 'RETRY_EXHAUSTED' : safeCode,
              nowIso: nowIso(),
              expectedAttempt: draft.attemptCount,
              expectedVersion: draft.version,
            })
          } catch (retryError) {
            throw leaseOwnershipError(retryError) ?? new AsyncBookingWorkerError('ASYNC_RETRY_RECORD_FAILED')
          }
          await renew()
          const failed = await input.store.getDraft(draft.draftId)
          if (!failed) throw new AsyncBookingWorkerError('ASYNC_RETRY_RECORD_FAILED')
          const terminal = terminalResult(failed)
          if (terminal) return terminal
          if (failed.state !== 'RETRYING' || failed.safeErrorCode !== safeCode
            || failed.attemptCount !== draft.attemptCount || failed.version !== draft.version + 1) {
            throw new AsyncBookingWorkerError('ASYNC_RETRY_RECORD_FAILED')
          }
          throw new AsyncBookingWorkerError(safeCode)
        }

        const terminal = terminalResult(draft)
        if (!terminal) throw new AsyncBookingWorkerError('BOOKING_COMPLETION_RETRY')
        try {
          await cleanupVerifiedStaging(draft, renew)
        } catch (error) {
          safeWorkerError(error, 'STAGING_CLEANUP_RETRY')
        }
        return terminal
      } finally {
        try { await input.lease.release(activeLease) } catch { /* generation expiry is the safe fallback */ }
      }
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
  persisted: MiniAppRequestRecord,
  paymentEvidenceFileIds: readonly string[],
  chatEvidenceFileIds: readonly string[],
): void {
  if (persisted.requestId !== previous.requestId || persisted.draftId !== previous.draftId || persisted.state !== 'PROCESSING'
    || persisted.attemptCount !== previous.attemptCount || persisted.version !== previous.version + 1
    || persisted.evidenceCount !== paymentEvidenceFileIds.length + chatEvidenceFileIds.length
    || !sameStrings(persisted.paymentEvidenceFileIds, paymentEvidenceFileIds)
    || !sameStrings(persisted.chatEvidenceFileIds, chatEvidenceFileIds)) {
    throw new AsyncBookingWorkerError('EVIDENCE_COPY_RETRY')
  }
  assertEvidenceLayout(persisted, true)
}

function isPersistedCompletion(
  previous: MiniAppRequestRecord,
  persisted: MiniAppRequestRecord,
  result: MiniAppBookingIngressResult,
): boolean {
  return persisted.requestId === previous.requestId && persisted.draftId === previous.draftId
    && persisted.state === 'CONFIRMED' && persisted.attemptCount === previous.attemptCount
    && persisted.version === previous.version + 1 && persisted.caseId === result.caseId
    && persisted.confirmationStatus === result.status && persisted.processingLeaseUntil === null
}

function terminalResult(draft: MiniAppRequestRecord): AsyncBookingWorkerResult | null {
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

function isCoordinationError(error: unknown): error is AsyncBookingWorkerError {
  return error instanceof AsyncBookingWorkerError && error.code === 'WORKER_LEASE_RETRY'
}

function leaseOwnershipError(error: unknown): AsyncBookingWorkerError | null {
  const code = error instanceof Error ? error.message : ''
  return code === 'STALE_PROCESSING_LEASE' || code === 'DRAFT_NOT_PROCESSING' || code === 'PROCESSING_LEASE_EXPIRED'
    ? new AsyncBookingWorkerError('STALE_PROCESSING_LEASE')
    : null
}

function workerLeaseFailure(_error: unknown): AsyncBookingWorkerError {
  void _error
  return new AsyncBookingWorkerError('WORKER_LEASE_RETRY')
}

function safeWorkerError(error: unknown, fallback: WorkerSafeErrorCode): AsyncBookingWorkerError {
  if (isCoordinationError(error)) return error
  return leaseOwnershipError(error) ?? new AsyncBookingWorkerError(fallback)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isConfirmationStatus(value: string): value is MiniAppBookingIngressResult['status'] {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}
