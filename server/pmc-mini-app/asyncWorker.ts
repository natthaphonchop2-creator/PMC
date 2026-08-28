import { randomUUID } from 'node:crypto'
import type { MiniAppBookingIngressResult } from '../../shared/pmcMiniAppBooking.js'
import type { MiniAppAsyncStateMutation } from '../../shared/pmcMiniAppAsyncState.js'
import { bookingPayloadHash } from './bookingDraft.js'
import type { AsyncStateIngressPort } from './asyncStateIngressClient.js'
import type { BookingIngressPort } from './bookingIngressClient.js'
import type { EvidenceIngressPort } from './evidenceIngressClient.js'
import type { EvidenceStagingPort } from './stagingStore.js'
import type { MiniAppRequestRecord, MiniAppStore } from './store.js'

const CLAIM_LEASE_MS = 15_000
const FINAL_WAIT_MS = 30_000
const POLL_MS = 1_000
const MAX_TASK_ATTEMPTS = 8
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SAFE_OWNER = /^[A-Za-z0-9_-]{16,128}$/
const SAFE_DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,256}$/
const SAFE_CASE_ID = /^PMC-\d{6}-\d{4,}$/

type WorkerSafeErrorCode =
  | 'ASYNC_WORKER_INVALID_INPUT'
  | 'ASYNC_STATE_RETRY'
  | 'ASYNC_STATE_FENCE_LOST'
  | 'INVALID_PERSISTED_ASYNC_STATE'
  | 'EVIDENCE_COPY_RETRY'
  | 'BOOKING_INGRESS_RETRY'
  | 'BOOKING_COMPLETION_RETRY'
  | 'STAGING_CLEANUP_RETRY'

type AsyncBookingWorkerResult = {
  requestId: string
  caseId: string | null
  state: 'CONFIRMED' | 'NEEDS_REVIEW'
}

type WorkerContext = {
  draft: MiniAppRequestRecord
  bound: MiniAppRequestRecord
  ownerToken: string
  taskAttempt: number
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

export function createAsyncBookingWorker(input: {
  store: MiniAppStore
  staging: EvidenceStagingPort
  evidenceIngress: EvidenceIngressPort
  bookingIngress: BookingIngressPort
  stateIngress: AsyncStateIngressPort
  ownerToken?: () => string
  now: () => Date
  wait: (milliseconds: number) => Promise<void>
}): AsyncBookingWorker {
  const nextOwnerToken = input.ownerToken ?? randomUUID
  const nowDate = (): Date => {
    const value = input.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')
    }
    return new Date(value)
  }

  async function readDraft(draftId: string, requestId: string): Promise<MiniAppRequestRecord> {
    const draft = await input.store.getDraft(draftId)
    if (!draft || draft.requestId !== requestId || draft.draftId !== draftId) {
      throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
    }
    return draft
  }

  function mutation(
    operation: MiniAppAsyncStateMutation['operation'],
    draft: MiniAppRequestRecord,
    taskAttempt: number,
    ownerToken: string | null,
    patch: Partial<MiniAppAsyncStateMutation> = {},
  ): MiniAppAsyncStateMutation {
    const now = nowDate()
    return {
      operation,
      requestId: draft.requestId,
      draftId: draft.draftId,
      payloadHash: draft.payloadHash ?? bookingPayloadHash(draft),
      expectedVersion: draft.version,
      expectedAttempt: draft.attemptCount,
      taskAttempt,
      leaseOwnerToken: ownerToken,
      nowIso: now.toISOString(),
      leaseUntil: ownerToken ? new Date(now.getTime() + CLAIM_LEASE_MS).toISOString() : null,
      taskName: draft.taskName,
      paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys],
      chatEvidenceObjectKeys: [...draft.chatEvidenceObjectKeys],
      paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds],
      chatEvidenceFileIds: [...draft.chatEvidenceFileIds],
      evidenceCount: draft.evidenceCount,
      safeErrorCode: null,
      caseId: null,
      confirmationStatus: null,
      ...patch,
    }
  }

  async function sendAndRead(
    stateMutation: MiniAppAsyncStateMutation,
    validate: (draft: MiniAppRequestRecord) => boolean,
  ): Promise<MiniAppRequestRecord> {
    let sendFailed = false
    try { await input.stateIngress.mutate(stateMutation) } catch { sendFailed = true }
    let persisted: MiniAppRequestRecord
    try { persisted = await readDraft(stateMutation.draftId, stateMutation.requestId) } catch (error) {
      if (sendFailed) throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
      throw error
    }
    if (validate(persisted)) return persisted
    if (sendFailed) throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
    throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
  }

  async function renew(context: WorkerContext): Promise<void> {
    const previous = context.draft
    const renewMutation = mutation('RENEW', previous, context.taskAttempt, context.ownerToken)
    context.draft = await sendAndRead(renewMutation, (persisted) =>
      validOwnedProcessing(context.bound, persisted, context.ownerToken, nowDate().getTime())
      && persisted.attemptCount === previous.attemptCount
      && persisted.version === previous.version + 1
      && persisted.processingLeaseUntil === renewMutation.leaseUntil,
    )
  }

  async function fencedAwait<T>(context: WorkerContext, operation: () => Promise<T>): Promise<T> {
    await renew(context)
    try {
      const result = await operation()
      await renew(context)
      return result
    } catch (error) {
      try { await renew(context) } catch { throw new AsyncBookingWorkerError('ASYNC_STATE_FENCE_LOST') }
      throw error
    }
  }

  async function copyEvidenceToDrive(context: WorkerContext): Promise<void> {
    assertEvidenceLayout(context.bound, context.draft, false)
    const paymentEvidenceFileIds = await copyMissingEvidence(
      context, 'PAYMENT', context.draft.paymentEvidenceObjectKeys, context.draft.paymentEvidenceFileIds,
    )
    const chatEvidenceFileIds = await copyMissingEvidence(
      context, 'CHAT', context.draft.chatEvidenceObjectKeys, context.draft.chatEvidenceFileIds,
    )
    await renew(context)
    const previous = context.draft
    const projection = mutation('PROJECT', previous, context.taskAttempt, context.ownerToken, {
      paymentEvidenceFileIds,
      chatEvidenceFileIds,
      evidenceCount: paymentEvidenceFileIds.length + chatEvidenceFileIds.length,
    })
    context.draft = await sendAndRead(projection, (persisted) =>
      validOwnedProcessing(context.bound, persisted, context.ownerToken, nowDate().getTime())
      && persisted.attemptCount === previous.attemptCount
      && persisted.version === previous.version + 1
      && sameStrings(persisted.paymentEvidenceFileIds, paymentEvidenceFileIds)
      && sameStrings(persisted.chatEvidenceFileIds, chatEvidenceFileIds)
      && persisted.evidenceCount === paymentEvidenceFileIds.length + chatEvidenceFileIds.length,
    )
    assertEvidenceLayout(context.bound, context.draft, true)
  }

  async function copyMissingEvidence(
    context: WorkerContext,
    kind: 'PAYMENT' | 'CHAT',
    objectKeys: readonly string[],
    existingFileIds: readonly string[],
  ): Promise<string[]> {
    const fileIds = [...existingFileIds]
    for (let ordinal = fileIds.length; ordinal < objectKeys.length; ordinal += 1) {
      const staged = await fencedAwait(context, () => input.staging.get(objectKeys[ordinal]!))
      const fileId = await fencedAwait(context, () => input.evidenceIngress.upload({
        draftId: context.draft.draftId,
        requestId: context.draft.requestId,
        kind,
        mimeType: staged.mimeType,
        bytes: staged.bytes,
      }))
      if (!SAFE_DRIVE_FILE_ID.test(fileId)) throw new AsyncBookingWorkerError('EVIDENCE_COPY_RETRY')
      fileIds[ordinal] = fileId
    }
    return fileIds
  }

  async function submitBooking(context: WorkerContext): Promise<MiniAppBookingIngressResult> {
    assertEvidenceLayout(context.bound, context.draft, true)
    const result = await fencedAwait(context, () => input.bookingIngress.send(context.draft))
    if (!SAFE_CASE_ID.test(result.caseId) || !isConfirmationStatus(result.status)) {
      throw new AsyncBookingWorkerError('BOOKING_INGRESS_RETRY')
    }
    return result
  }

  async function recordCompletion(context: WorkerContext, result: MiniAppBookingIngressResult): Promise<void> {
    await renew(context)
    const previous = context.draft
    const completion = mutation('COMPLETE', previous, context.taskAttempt, context.ownerToken, {
      caseId: result.caseId,
      confirmationStatus: result.status,
    })
    context.draft = await sendAndRead(completion, (persisted) =>
      validExpectedCompletion(context.bound, previous, persisted, result),
    )
  }

  async function recordRetry(context: WorkerContext, safeErrorCode: string): Promise<AsyncBookingWorkerResult | null> {
    const previous = context.draft
    const retry = mutation('RETRY', previous, context.taskAttempt, context.ownerToken, {
      safeErrorCode: context.taskAttempt === MAX_TASK_ATTEMPTS ? 'RETRY_EXHAUSTED' : safeErrorCode,
    })
    const targetState = context.taskAttempt === MAX_TASK_ATTEMPTS ? 'NEEDS_REVIEW' : 'RETRYING'
    const persisted = await sendAndRead(retry, (draft) =>
      validIdentity(context.bound, draft)
      && draft.state === targetState
      && draft.version === previous.version + 1
      && draft.attemptCount === previous.attemptCount
      && draft.processingOwnerToken === null
      && draft.processingLeaseUntil === null,
    )
    context.draft = persisted
    return targetState === 'NEEDS_REVIEW' ? terminalResult(persisted) : null
  }

  async function exhaust(
    draft: MiniAppRequestRecord,
    bound: MiniAppRequestRecord,
    expectedEvidence?: MiniAppRequestRecord,
  ): Promise<AsyncBookingWorkerResult> {
    const exhaustMutation = mutation('EXHAUST', draft, 8, null, {
      safeErrorCode: 'RETRY_EXHAUSTED',
      ...(expectedEvidence ? {
        paymentEvidenceFileIds: [...expectedEvidence.paymentEvidenceFileIds],
        chatEvidenceFileIds: [...expectedEvidence.chatEvidenceFileIds],
        evidenceCount: expectedEvidence.evidenceCount,
      } : {}),
    })
    let sendFailed = false
    try { await input.stateIngress.mutate(exhaustMutation) } catch { sendFailed = true }
    for (let readAttempt = 0; readAttempt < 5; readAttempt += 1) {
      try {
        const persisted = await readDraft(draft.draftId, draft.requestId)
        if (validIdentity(bound, persisted) && persisted.state === 'NEEDS_REVIEW'
          && persisted.safeErrorCode === 'RETRY_EXHAUSTED') {
          return { requestId: persisted.requestId, caseId: persisted.caseId, state: 'NEEDS_REVIEW' }
        }
      } catch { /* retry the bounded persisted reread without sleeping */ }
    }
    throw new AsyncBookingWorkerError(sendFailed ? 'ASYNC_STATE_RETRY' : 'INVALID_PERSISTED_ASYNC_STATE')
  }

  async function cleanupVerifiedStaging(draft: MiniAppRequestRecord, bound: MiniAppRequestRecord): Promise<void> {
    if (!validTerminal(bound, draft)) throw new AsyncBookingWorkerError('STAGING_CLEANUP_RETRY')
    for (const objectKey of [...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys]) {
      await input.staging.deleteVerified(objectKey)
    }
  }

  return {
    async finalize(finalizeInput) {
      assertFinalizeInput(finalizeInput)
      const startedAt = nowDate().getTime()
      let lastDraft: MiniAppRequestRecord | null = null
      let bound: MiniAppRequestRecord | null = null
      const ownerToken = nextOwnerToken()
      if (!SAFE_OWNER.test(ownerToken)) throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')

      while (true) {
        try {
          lastDraft = await readDraft(finalizeInput.draftId, finalizeInput.requestId)
          bound ??= bindDraft(lastDraft)
          const terminal = terminalResult(lastDraft)
          if (terminal) {
            if (validTerminal(bound, lastDraft)) return terminal
            if (finalizeInput.attempt === MAX_TASK_ATTEMPTS) return exhaust(lastDraft, bound)
            throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
          }

          const previous = lastDraft
          const claim = mutation('CLAIM', previous, finalizeInput.attempt, ownerToken)
          try { await input.stateIngress.mutate(claim) } catch { /* persisted reread decides response loss */ }
          lastDraft = await readDraft(finalizeInput.draftId, finalizeInput.requestId)
          const claimed = validOwnedProcessing(bound, lastDraft, ownerToken, nowDate().getTime())
            && lastDraft.attemptCount === previous.attemptCount + 1
            && lastDraft.version === previous.version + 1
            && lastDraft.processingLeaseUntil === claim.leaseUntil
          if (claimed) break
          const claimedTerminal = terminalResult(lastDraft)
          if (claimedTerminal && validTerminal(bound, lastDraft)) return claimedTerminal
        } catch (error) {
          if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) {
            if (error instanceof AsyncBookingWorkerError) throw error
            throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
          }
        }

        if (finalizeInput.attempt < MAX_TASK_ATTEMPTS) throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
        const elapsed = nowDate().getTime() - startedAt
        if (elapsed >= FINAL_WAIT_MS) {
          if (!lastDraft || !bound) throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
          return exhaust(lastDraft, bound)
        }
        await input.wait(Math.min(POLL_MS, FINAL_WAIT_MS - elapsed))
      }

      if (!lastDraft || !bound) throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
      const context: WorkerContext = { draft: lastDraft, bound, ownerToken, taskAttempt: finalizeInput.attempt }
      let stage: WorkerSafeErrorCode = 'EVIDENCE_COPY_RETRY'
      let bookingResult: MiniAppBookingIngressResult | null = null
      try {
        await copyEvidenceToDrive(context)
        stage = 'BOOKING_INGRESS_RETRY'
        const result = await submitBooking(context)
        bookingResult = result
        stage = 'BOOKING_COMPLETION_RETRY'
        await recordCompletion(context, result)
        const terminal = terminalResult(context.draft)
        if (!terminal || !validTerminal(bound, context.draft)) {
          throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
        }
        try { await cleanupVerifiedStaging(context.draft, bound) } catch { /* retain staging after terminal */ }
        return terminal
      } catch (error) {
        if (error instanceof AsyncBookingWorkerError && error.code === 'ASYNC_STATE_FENCE_LOST') throw error
        let current: MiniAppRequestRecord
        try { current = await readDraft(context.draft.draftId, context.draft.requestId) } catch {
          throw new AsyncBookingWorkerError('ASYNC_STATE_RETRY')
        }
        const terminal = terminalResult(current)
        if (terminal) {
          const exactTerminal = bookingResult
            ? validExpectedCompletion(bound, context.draft, current, bookingResult)
            : validTerminal(bound, current)
          if (exactTerminal) return terminal
          if (finalizeInput.attempt === MAX_TASK_ATTEMPTS) {
            return exhaust(current, bound, bookingResult ? context.draft : undefined)
          }
          throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
        }
        if (!validOwnedProcessing(bound, current, ownerToken, nowDate().getTime())) {
          throw new AsyncBookingWorkerError('ASYNC_STATE_FENCE_LOST')
        }
        context.draft = current
        const reviewed = await recordRetry(context, stage)
        if (reviewed) return reviewed
        throw new AsyncBookingWorkerError(stage)
      }
    },
  }
}

function bindDraft(draft: MiniAppRequestRecord): MiniAppRequestRecord {
  return structuredClone({ ...draft, payloadHash: draft.payloadHash ?? bookingPayloadHash(draft) })
}

function validIdentity(bound: MiniAppRequestRecord, draft: MiniAppRequestRecord): boolean {
  return draft.requestId === bound.requestId && draft.draftId === bound.draftId
    && draft.payloadHash === bound.payloadHash && bookingPayloadHash(draft) === bound.payloadHash
    && draft.staffId === bound.staffId && draft.lineUserIdHash === bound.lineUserIdHash
    && draft.aeName === bound.aeName && draft.customerName === bound.customerName
    && draft.facebookName === bound.facebookName && draft.phoneNormalized === bound.phoneNormalized
    && draft.doctorId === bound.doctorId && draft.serviceId === bound.serviceId
    && draft.queueType === bound.queueType && draft.appointmentDate === bound.appointmentDate
    && draft.appointmentTime === bound.appointmentTime && draft.depositAmount === bound.depositAmount
    && draft.channelId === bound.channelId
    && sameStrings(draft.paymentEvidenceObjectKeys, bound.paymentEvidenceObjectKeys)
    && sameStrings(draft.chatEvidenceObjectKeys, bound.chatEvidenceObjectKeys)
}

function validOwnedProcessing(
  bound: MiniAppRequestRecord,
  draft: MiniAppRequestRecord,
  ownerToken: string,
  nowMs: number,
): boolean {
  return validIdentity(bound, draft) && draft.state === 'PROCESSING'
    && draft.processingOwnerToken === ownerToken && Boolean(draft.processingLeaseUntil)
    && Date.parse(draft.processingLeaseUntil!) > nowMs
}

function assertEvidenceLayout(bound: MiniAppRequestRecord, draft: MiniAppRequestRecord, complete: boolean): void {
  const paymentCount = bound.paymentEvidenceObjectKeys.length
  const chatCount = bound.chatEvidenceObjectKeys.length
  if (!validIdentity(bound, draft) || paymentCount < 1 || chatCount < 1
    || draft.paymentEvidenceFileIds.length > paymentCount || draft.chatEvidenceFileIds.length > chatCount
    || complete && (draft.paymentEvidenceFileIds.length !== paymentCount || draft.chatEvidenceFileIds.length !== chatCount)
    || !draft.paymentEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))
    || !draft.chatEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))
    || draft.evidenceCount !== paymentCount + chatCount) throw new AsyncBookingWorkerError('INVALID_PERSISTED_ASYNC_STATE')
}

function validTerminal(bound: MiniAppRequestRecord, draft: MiniAppRequestRecord): boolean {
  if (draft.state === 'NEEDS_REVIEW') {
    return validIdentity(bound, draft) && draft.processingOwnerToken === null && draft.processingLeaseUntil === null
  }
  return draft.state === 'CONFIRMED' && validIdentity(bound, draft)
    && Boolean(draft.caseId && SAFE_CASE_ID.test(draft.caseId)) && isConfirmationStatus(draft.confirmationStatus ?? '')
    && draft.processingOwnerToken === null && draft.processingLeaseUntil === null
    && draft.paymentEvidenceFileIds.length === bound.paymentEvidenceObjectKeys.length
    && draft.chatEvidenceFileIds.length === bound.chatEvidenceObjectKeys.length
    && draft.paymentEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))
    && draft.chatEvidenceFileIds.every((fileId) => SAFE_DRIVE_FILE_ID.test(fileId))
    && draft.evidenceCount === draft.paymentEvidenceFileIds.length + draft.chatEvidenceFileIds.length
}

function validExpectedCompletion(
  bound: MiniAppRequestRecord,
  previous: MiniAppRequestRecord,
  persisted: MiniAppRequestRecord,
  result: MiniAppBookingIngressResult,
): boolean {
  return validTerminal(bound, persisted)
    && persisted.attemptCount === previous.attemptCount
    && persisted.version === previous.version + 1
    && persisted.caseId === result.caseId
    && persisted.confirmationStatus === result.status
    && sameStrings(persisted.paymentEvidenceFileIds, previous.paymentEvidenceFileIds)
    && sameStrings(persisted.chatEvidenceFileIds, previous.chatEvidenceFileIds)
    && persisted.evidenceCount === previous.evidenceCount
}

function terminalResult(draft: MiniAppRequestRecord): AsyncBookingWorkerResult | null {
  if (draft.state === 'CONFIRMED' && draft.caseId) {
    return { requestId: draft.requestId, caseId: draft.caseId, state: 'CONFIRMED' }
  }
  if (draft.state === 'NEEDS_REVIEW') {
    return { requestId: draft.requestId, caseId: draft.caseId, state: 'NEEDS_REVIEW' }
  }
  return null
}

function assertFinalizeInput(input: { requestId: string; draftId: string; attempt: number }): void {
  if (!SAFE_ID.test(input.requestId) || !SAFE_ID.test(input.draftId)
    || !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > MAX_TASK_ATTEMPTS) {
    throw new AsyncBookingWorkerError('ASYNC_WORKER_INVALID_INPUT')
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isConfirmationStatus(value: string): value is NonNullable<MiniAppRequestRecord['confirmationStatus']> {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}
