import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createAsyncBookingWorker } from '../../server/pmc-mini-app/asyncWorker'
import { evidenceProjectionHash } from '../../server/pmc-mini-app/bookingDraft'
import type { AsyncStateIngressPort } from '../../server/pmc-mini-app/asyncStateIngressClient'
import type { BookingIngressPort } from '../../server/pmc-mini-app/bookingIngressClient'
import type { EvidenceIngressPort } from '../../server/pmc-mini-app/evidenceIngressClient'
import type { EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import type { MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'
import {
  canonicalMiniAppAsyncIdentity,
  type MiniAppAsyncStateMutation,
} from '../../shared/pmcMiniAppAsyncState'

const fixedNow = new Date('2026-08-28T04:00:00.000Z')
const paymentKey = `drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`
const chatKey = `drafts/draft-1/CHAT/${'b'.repeat(64)}.png`

describe('PMC async worker through Apps Script state ingress', () => {
  it('emits one terminal event with finalize-entry elapsed time', async () => {
    const telemetry = vi.fn()
    const fixture = workerFixture({ telemetry, advanceOnStagingGetMs: 1_250 })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({ state: 'CONFIRMED' })

    const terminalEvents = telemetry.mock.calls.filter(([name]) => name === 'booking_worker_completed')
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]![1]).toMatchObject({ elapsedMs: 2_500, state: 'CONFIRMED' })
  })

  it('uses state ingress exclusively and validates reread state before booking and cleanup', async () => {
    const fixture = workerFixture()

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toEqual({
      requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })

    expect(fixture.state.operations()).toEqual(expect.arrayContaining(['CLAIM', 'PROJECT', 'COMPLETE']))
    expect(fixture.state.operations()).not.toContain('QUEUE')
    expect(fixture.bookingIngress.send).toHaveBeenCalledOnce()
    expect(fixture.staging.deleteVerified).toHaveBeenCalledTimes(2)
    expect(fixture.staging.get).toHaveBeenNthCalledWith(1, paymentKey)
    expect(fixture.staging.get).toHaveBeenNthCalledWith(2, chatKey)
    expect(fixture.staging.deleteVerified).toHaveBeenNthCalledWith(1, paymentKey)
    expect(fixture.staging.deleteVerified).toHaveBeenNthCalledWith(2, chatKey)
    expect(fixture.state.read()).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      processingOwnerToken: null,
    })
  })

  it('reuses exact existing Drive IDs by ordinal without rereading or reuploading staged bytes', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        paymentEvidenceFileIds: ['owner-drive-payment-1'],
        chatEvidenceFileIds: ['owner-drive-chat-1'],
      }),
    })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({
      state: 'CONFIRMED',
    })
    expect(fixture.staging.get).not.toHaveBeenCalled()
    expect(fixture.evidenceIngress.upload).not.toHaveBeenCalled()
    expect(fixture.bookingIngress.send).toHaveBeenCalledOnce()
  })

  it.each([
    ['Drive retry', { driveState: 'RETRY', calendarState: 'OK', lineState: 'OK' }],
    ['Calendar conflict', { driveState: 'OK', calendarState: 'CONFLICT', lineState: 'OK' }],
    ['LINE retry', { driveState: 'OK', calendarState: 'OK', lineState: 'RETRY' }],
  ])('persists CONFIRMED_WITH_RETRY while preserving the Case ID for %s', async (_label, projection) => {
    const fixture = workerFixture({
      bookingResults: [{
        caseId: 'PMC-202608-0001', status: 'CONFIRMED', ...projection,
      } as never],
    })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toEqual({
      requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED_WITH_RETRY',
    })
    expect(fixture.state.read()).toMatchObject({
      state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-202608-0001', safeErrorCode: 'DOWNSTREAM_RETRY',
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7])('persists RETRYING and throws safely for evidence failure on attempt %i', async (attempt) => {
    const fixture = workerFixture({
      draft: queuedDraft({ state: attempt === 1 ? 'QUEUED' : 'RETRYING', attemptCount: attempt - 1 }),
      stagingFailure: new Error('private object URL'),
    })

    await expect(
      fixture.worker.finalize(taskInput(attempt)),
    ).rejects.toMatchObject({ code: 'EVIDENCE_COPY_RETRY', message: 'EVIDENCE_COPY_RETRY' })
    expect(fixture.state.read()).toMatchObject({ state: 'RETRYING', safeErrorCode: 'EVIDENCE_COPY_RETRY' })
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('retries the same bound booking payload after timeout and records one Case ID', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        paymentEvidenceFileIds: ['owner-drive-payment-1'],
        chatEvidenceFileIds: ['owner-drive-chat-1'],
      }),
      bookingResults: [new Error('private timeout body'), {
        caseId: 'PMC-202608-0001', status: 'CONFIRMED',
        driveState: 'OK', calendarState: 'OK', lineState: 'OK',
      }],
    })

    await expect(
      fixture.worker.finalize(taskInput(1)),
    ).rejects.toMatchObject({ code: 'BOOKING_INGRESS_RETRY' })
    await expect(
      fixture.worker.finalize(taskInput(2)),
    ).resolves.toMatchObject({ caseId: 'PMC-202608-0001', state: 'CONFIRMED' })

    const submissions = fixture.bookingIngress.send.mock.calls.map(([draft]) => ({
      requestId: draft.requestId, payloadHash: draft.payloadHash,
      paymentEvidenceFileIds: draft.paymentEvidenceFileIds, chatEvidenceFileIds: draft.chatEvidenceFileIds,
    }))
    expect(submissions).toEqual([submissions[0], submissions[0]])
    expect(fixture.state.operations().filter((operation) => operation === 'COMPLETE')).toHaveLength(1)
  })

  it('keeps the persisted Case ID terminal when staging cleanup fails and terminal replay has no side effect', async () => {
    const fixture = workerFixture({ deleteFailure: new Error('private storage detail') })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({
      caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })
    const operationCount = fixture.state.operations().length
    vi.clearAllMocks()
    await expect(fixture.worker.finalize(taskInput(2))).resolves.toMatchObject({
      caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })
    expect(fixture.state.operations()).toHaveLength(operationCount)
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('recovers a timed-out applied PROJECT mutation from the exact persisted reread without downgrading', async () => {
    const fixture = workerFixture({ responseLossOperation: 'PROJECT' })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({
      caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })

    expect(fixture.state.operations().filter((operation) => operation === 'PROJECT')).toHaveLength(1)
    expect(fixture.state.operations()).not.toContain('RETRY')
    expect(fixture.bookingIngress.send).toHaveBeenCalledOnce()
  })

  it('fences a stale worker returning after a long upload before project, retry, completion, or cleanup', async () => {
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      afterEvidenceUpload: () => fixtureRef.current?.state.reclaim('worker-owner-token-2'),
    })
    fixtureRef.current = fixture

    await expect(
      fixture.worker.finalize(taskInput(1)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/ASYNC_STATE|STALE|OWNER|LEASE/) })

    expect(fixture.state.operations()).toContain('CLAIM')
    expect(fixture.state.operations()).not.toContain('PROJECT')
    expect(fixture.state.operations()).not.toContain('RETRY')
    expect(fixture.state.operations()).not.toContain('COMPLETE')
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('rejects a worker whose claim expires during a long external call even before another owner reclaims', async () => {
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      afterEvidenceUpload: () => fixtureRef.current?.clock.advance(16_000),
    })
    fixtureRef.current = fixture

    await expect(
      fixture.worker.finalize(taskInput(1)),
    ).rejects.toBeDefined()
    expect(fixture.state.operations()).not.toContain('PROJECT')
    expect(fixture.state.operations()).not.toContain('RETRY')
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it.each([
    ['payload identity', { customerName: 'tampered customer' }],
    ['object keys', { chatEvidenceObjectKeys: [`drafts/draft-1/CHAT/${'c'.repeat(64)}.png`] }],
    ['Drive IDs', { paymentEvidenceFileIds: [] }],
    ['evidence count', { evidenceCount: 1 }],
  ])('fails closed on terminal replay with invalid %s and retains all staging', async (_label, corruption) => {
    const valid = withProjectionHash(queuedDraft({
      state: 'CONFIRMED', version: 9, attemptCount: 1, caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
      processingLeaseUntil: null, processingOwnerToken: null,
    }))
    const invalid = { ...valid, ...structuredClone(corruption) }
    const fixture = workerFixture({ draft: invalid })

    await expect(
      fixture.worker.finalize(taskInput(2)),
    ).rejects.toBeDefined()
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('returns an exact independently anchored terminal replay without any mutation or cleanup', async () => {
    const terminal = withProjectionHash(queuedDraft({
      state: 'CONFIRMED', version: 9, attemptCount: 1,
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
      processingLeaseUntil: null, processingOwnerToken: null,
    }))
    const fixture = workerFixture({ draft: terminal })

    await expect(fixture.worker.finalize({
      requestId: terminal.requestId, draftId: terminal.draftId, payloadHash: terminal.payloadHash!, baseVersion: 3, attempt: 2,
    })).resolves.toEqual({ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED' })
    expect(fixture.state.operations()).toEqual([])
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('rejects safe-looking reordered Drive IDs when the persisted projection hash still binds the original order', async () => {
    const extraPaymentKey = `drafts/draft-1/PAYMENT/${'c'.repeat(64)}.png`
    const projected = withProjectionHash(queuedDraft({
      state: 'CONFIRMED', version: 9, attemptCount: 1,
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      paymentEvidenceObjectKeys: [paymentKey, extraPaymentKey],
      paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
      chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 3,
      processingLeaseUntil: null, processingOwnerToken: null,
    }))
    const corrupted = { ...projected, paymentEvidenceFileIds: [...projected.paymentEvidenceFileIds].reverse() }
    const fixture = workerFixture({ draft: corrupted })

    await expect(fixture.worker.finalize({
      requestId: corrupted.requestId, draftId: corrupted.draftId, payloadHash: corrupted.payloadHash!, baseVersion: 3, attempt: 2,
    })).rejects.toMatchObject({ code: 'INVALID_PERSISTED_ASYNC_STATE' })
    expect(fixture.state.operations()).toEqual([])
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it.each([
    ['task payload hash mismatch', { taskPayloadHash: 'different-payload-hash', baseVersion: 3, attemptCount: 1, version: 9, projection: 'VALID' }],
    ['regressed terminal version', { taskPayloadHash: 'USE_ROW', baseVersion: 9, attemptCount: 1, version: 9, projection: 'VALID' }],
    ['impossible attempt monotonicity', { taskPayloadHash: 'USE_ROW', baseVersion: 3, attemptCount: 5, version: 9, projection: 'VALID' }],
    ['missing projection hash', { taskPayloadHash: 'USE_ROW', baseVersion: 3, attemptCount: 1, version: 9, projection: 'MISSING' }],
    ['wrong projection hash', { taskPayloadHash: 'USE_ROW', baseVersion: 3, attemptCount: 1, version: 9, projection: 'WRONG' }],
  ])('rejects terminal replay with %s against the independent task snapshot', async (_label, scenario) => {
    const projected = withProjectionHash(queuedDraft({
      state: 'CONFIRMED', version: scenario.version, attemptCount: scenario.attemptCount,
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
      processingLeaseUntil: null, processingOwnerToken: null,
    } as Partial<MiniAppRequestRecord>))
    const terminal = {
      ...projected,
      evidenceProjectionHash: scenario.projection === 'MISSING' ? null
        : scenario.projection === 'WRONG' ? 'a'.repeat(43) : projected.evidenceProjectionHash,
    }
    const fixture = workerFixture({ draft: terminal })
    const taskPayloadHash = scenario.taskPayloadHash === 'USE_ROW' ? terminal.payloadHash! : scenario.taskPayloadHash

    await expect(fixture.worker.finalize({
      requestId: 'request-1', draftId: 'draft-1', attempt: 2,
      payloadHash: taskPayloadHash, baseVersion: scenario.baseVersion,
    } as never)).rejects.toBeDefined()
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('rejects completion when persisted terminal Drive IDs differ from the exact projected arrays', async () => {
    const fixture = workerFixture({ corruptAfterComplete: { chatEvidenceFileIds: ['other-drive-chat-1'] } })

    await expect(
      fixture.worker.finalize(taskInput(1)),
    ).rejects.toBeDefined()
    expect(fixture.bookingIngress.send).toHaveBeenCalledOnce()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('fences an invalid completion to NEEDS_REVIEW on attempt eight without deleting staging', async () => {
    const fixture = workerFixture({ corruptAfterComplete: { chatEvidenceFileIds: ['other-drive-chat-1'] } })

    await expect(
      fixture.worker.finalize(taskInput(8)),
    ).resolves.toEqual({ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'NEEDS_REVIEW' })
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.state.operations().at(-1)).toBe('EXHAUST')
  })

  it('keeps transient final-attempt reads inside one injected deadline and atomically persists NEEDS_REVIEW', async () => {
    const fixture = workerFixture({ alwaysBusyClaim: true, transientReadFailures: 4 })

    await expect(
      fixture.worker.finalize(taskInput(8)),
    ).resolves.toEqual({ requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW' })

    expect(fixture.clock.totalWait).toBe(4_000)
    expect(fixture.clock.waits.every((milliseconds) => milliseconds <= 1_000)).toBe(true)
    expect(fixture.state.operations().at(-1)).toBe('EXHAUST')
    expect(fixture.state.read()).toMatchObject({ state: 'NEEDS_REVIEW', safeErrorCode: 'RETRY_EXHAUSTED' })
  })

  it('converges through EXHAUST when an attempt-eight post-claim reread transiently fails after an external error', async () => {
    const fixture = workerFixture({
      stagingFailure: new Error('private storage detail'),
      transientReadFailuresAfterExternalError: 2,
    })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.clock.totalWait).toBeLessThanOrEqual(30_000)
    expect(fixture.state.operations().at(-1)).toBe('EXHAUST')
    expect(fixture.state.read()).toMatchObject({ state: 'NEEDS_REVIEW', safeErrorCode: 'RETRY_EXHAUSTED' })
  })

  it('waits for a reclaimed live post-claim owner to expire before attempt eight atomically exhausts', async () => {
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      afterEvidenceUpload: () => fixtureRef.current?.state.reclaim('worker-owner-token-2'),
    })
    fixtureRef.current = fixture

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.clock.totalWait).toBe(15_000)
    expect(fixture.state.operations().at(-1)).toBe('EXHAUST')
  })

  it('recovers exact persisted NEEDS_REVIEW after EXHAUST response loss and transient rereads', async () => {
    const fixture = workerFixture({
      alwaysBusyClaim: true,
      responseLossOperation: 'EXHAUST',
      transientReadFailuresAfterExhaust: 6,
    })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.clock.totalWait).toBe(6_000)
    expect(fixture.state.operations().filter((operation) => operation === 'EXHAUST')).toHaveLength(1)
  })

  it('begins no new final-attempt I/O after a claim send consumes the absolute deadline', async () => {
    const fixture = workerFixture({ alwaysBusyClaim: true, advanceOnClaimSendMs: 30_000 })

    await expect(fixture.worker.finalize(taskInput(8))).rejects.toMatchObject({ code: 'ASYNC_STATE_RETRY' })

    expect(fixture.state.operations()).toEqual(['CLAIM'])
    expect(fixture.getDraft).toHaveBeenCalledTimes(1)
    expect(fixture.clock.waits).toEqual([])
  })

  it('bounds EXHAUST sends, persisted rereads, and waits when their fakes consume the deadline', async () => {
    const fixture = workerFixture({
      stagingFailure: new Error('private storage detail'),
      transientReadFailuresAfterExternalError: 1,
      advanceOnExhaustSendMs: 7_000,
      exhaustFailure: new Error('private Apps Script outage'),
      advanceOnReadAfterExhaustMs: 7_000,
      failReadsAfterExhaust: true,
    })

    await expect(fixture.worker.finalize(taskInput(8))).rejects.toMatchObject({ code: 'ASYNC_STATE_RETRY' })

    expect(fixture.state.operations().filter((operation) => operation === 'EXHAUST')).toHaveLength(1)
    expect(fixture.readsAfterExhaust()).toBe(3)
    expect(fixture.clock.waits).toEqual([1_000, 1_000])
    expect(fixture.clock.now.getTime() - fixedNow.getTime()).toBe(30_000)
  })

  it('uses an exact terminal reread started before the deadline even when that call resolves after it', async () => {
    const fixture = workerFixture({
      stagingFailure: new Error('private storage detail'),
      transientReadFailuresAfterExternalError: 1,
      responseLossOperation: 'EXHAUST',
      advanceOnExhaustSendMs: 20_000,
      advanceOnReadAfterExhaustMs: 15_000,
    })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.state.operations().filter((operation) => operation === 'EXHAUST')).toHaveLength(1)
    expect(fixture.readsAfterExhaust()).toBe(1)
    expect(fixture.clock.waits).toEqual([])
  })

  it('begins no new state I/O after an in-flight staging read consumes the final deadline', async () => {
    const fixture = workerFixture({
      stagingFailure: new Error('private storage detail'),
      advanceOnStagingGetMs: 30_000,
    })

    await expect(fixture.worker.finalize(taskInput(8))).rejects.toMatchObject({ code: 'ASYNC_STATE_RETRY' })

    expect(fixture.state.operations()).toEqual(['CLAIM', 'RENEW'])
    expect(fixture.getDraft).toHaveBeenCalledTimes(3)
    expect(fixture.clock.waits).toEqual([])
  })
})

function workerFixture(options: {
  draft?: MiniAppRequestRecord
  responseLossOperation?: MiniAppAsyncStateMutation['operation']
  afterEvidenceUpload?: () => void
  corruptAfterProject?: Partial<MiniAppRequestRecord>
  corruptAfterComplete?: Partial<MiniAppRequestRecord>
  alwaysBusyClaim?: boolean
  transientReadFailures?: number
  transientReadFailuresAfterExternalError?: number
  transientReadFailuresAfterExhaust?: number
  advanceOnClaimSendMs?: number
  advanceOnExhaustSendMs?: number
  exhaustFailure?: Error
  advanceOnReadAfterExhaustMs?: number
  failReadsAfterExhaust?: boolean
  advanceOnStagingGetMs?: number
  stagingFailure?: Error
  bookingResults?: Array<Error | { caseId: string; status: 'CONFIRMED' }>
  deleteFailure?: Error
  telemetry?: ReturnType<typeof vi.fn>
} = {}) {
  const clock = new TestClock(fixedNow)
  let remainingReadFailures = options.transientReadFailures ?? 0
  const state = new StateIngressFixture(options.draft ?? queuedDraft(), clock, {
    ...options,
    afterExhaust: () => { remainingReadFailures += options.transientReadFailuresAfterExhaust ?? 0 },
  })
  const unavailable = vi.fn(async () => { throw new Error('direct async Sheet mutation forbidden') })
  let readsAfterExhaust = 0
  const getDraft = vi.fn(async (draftId: string) => {
    if (state.didAttemptExhaust()) {
      readsAfterExhaust += 1
      clock.advance(options.advanceOnReadAfterExhaustMs ?? 0)
      if (options.failReadsAfterExhaust) throw new Error('transient Sheet read')
    }
    if (remainingReadFailures > 0) {
      remainingReadFailures -= 1
      throw new Error('transient Sheet read')
    }
    const current = state.read()
    return current.draftId === draftId ? current : null
  })
  const store: MiniAppStore = {
    getDraft,
    getActiveStaffByLineUserId: unavailable,
    getActiveBookingConfig: unavailable,
    createDraft: unavailable,
    updateDraft: unavailable,
    markRetentionPending: unavailable,
    claimConfirmation: unavailable,
    completeConfirmation: unavailable,
    failConfirmation: unavailable,
  }
  const staging: EvidenceStagingPort & { deleteVerified: ReturnType<typeof vi.fn> } = {
    put: vi.fn(async () => { throw new Error('not used') }),
    get: vi.fn(async (key: string) => {
      clock.advance(options.advanceOnStagingGetMs ?? 0)
      if (options.stagingFailure) {
        remainingReadFailures += options.transientReadFailuresAfterExternalError ?? 0
        throw options.stagingFailure
      }
      return {
        bytes: Buffer.from(key === paymentKey ? [0x89, 0x50, 0x4e, 0x47, 1] : [0x89, 0x50, 0x4e, 0x47, 2]),
        mimeType: 'image/png' as const,
      }
    }),
    deleteVerified: vi.fn(async () => {
      if (options.deleteFailure) throw options.deleteFailure
    }),
  }
  const evidenceIngress: EvidenceIngressPort = {
    upload: vi.fn(async ({ kind }) => {
      options.afterEvidenceUpload?.()
      return kind === 'PAYMENT' ? 'owner-drive-payment-1' : 'owner-drive-chat-1'
    }),
  }
  const bookingResults = [...(options.bookingResults ?? [{
    caseId: 'PMC-202608-0001', status: 'CONFIRMED' as const,
    driveState: 'OK' as const, calendarState: 'OK' as const, lineState: 'OK' as const,
  }])]
  const bookingIngress: BookingIngressPort & { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn(async () => {
      const result = bookingResults.shift()
      if (!result) throw new Error('missing fake booking result')
      if (result instanceof Error) throw result
      return result
    }),
  }
  const worker = createAsyncBookingWorker({
    store,
    staging,
    evidenceIngress,
    bookingIngress,
    stateIngress: state,
    telemetry: options.telemetry,
    ownerToken: () => 'worker-owner-token-1',
    now: () => clock.now,
    wait: (milliseconds: number) => clock.wait(milliseconds),
  } as never)
  return {
    worker, state, store, staging, evidenceIngress, bookingIngress, clock, getDraft,
    readsAfterExhaust: () => readsAfterExhaust,
  }
}

class StateIngressFixture implements AsyncStateIngressPort {
  private draft: MiniAppRequestRecord
  private readonly calls: MiniAppAsyncStateMutation[] = []
  private lostResponse = false
  private exhaustAttempted = false

  constructor(
    draft: MiniAppRequestRecord,
    private readonly clock: TestClock,
    private readonly options: {
      responseLossOperation?: MiniAppAsyncStateMutation['operation']
      corruptAfterProject?: Partial<MiniAppRequestRecord>
      corruptAfterComplete?: Partial<MiniAppRequestRecord>
      alwaysBusyClaim?: boolean
      afterExhaust?: () => void
      advanceOnClaimSendMs?: number
      advanceOnExhaustSendMs?: number
      exhaustFailure?: Error
    },
  ) { this.draft = structuredClone(draft) }

  read(): MiniAppRequestRecord { return structuredClone(this.draft) }
  operations() { return this.calls.map(({ operation }) => operation) }
  didAttemptExhaust() { return this.exhaustAttempted }

  reclaim(ownerToken: string): void {
    this.draft = {
      ...this.draft, state: 'PROCESSING', attemptCount: this.draft.attemptCount + 1,
      version: this.draft.version + 1, processingOwnerToken: ownerToken,
      processingLeaseUntil: new Date(this.clock.now.getTime() + 15_000).toISOString(),
    }
  }

  async mutate(input: MiniAppAsyncStateMutation) {
    this.calls.push(structuredClone(input))
    if (input.operation === 'CLAIM') this.clock.advance(this.options.advanceOnClaimSendMs ?? 0)
    if (input.operation === 'CLAIM' && this.options.alwaysBusyClaim) {
      return result(this.draft, 'BUSY')
    }
    if (input.operation === 'EXHAUST') {
      this.exhaustAttempted = true
      this.clock.advance(this.options.advanceOnExhaustSendMs ?? 0)
      if (this.options.exhaustFailure) throw this.options.exhaustFailure
      this.draft = {
        ...this.draft, state: 'NEEDS_REVIEW', version: this.draft.version + 1,
        safeErrorCode: 'RETRY_EXHAUSTED', processingOwnerToken: null, processingLeaseUntil: null,
      }
      this.options.afterExhaust?.()
      if (this.options.responseLossOperation === input.operation && !this.lostResponse) {
        this.lostResponse = true
        throw new Error('simulated state response loss')
      }
      return result(this.draft, 'APPLIED')
    }
    if (input.operation === 'CLAIM') {
      this.requireVersion(input)
      this.draft = {
        ...this.draft, state: 'PROCESSING', version: this.draft.version + 1,
        attemptCount: this.draft.attemptCount + 1, processingOwnerToken: input.leaseOwnerToken,
        processingLeaseUntil: input.leaseUntil, payloadHash: input.payloadHash,
      }
    } else {
      this.requireOwner(input)
      if (input.operation === 'RENEW') {
        this.draft = { ...this.draft, version: this.draft.version + 1, processingLeaseUntil: input.leaseUntil }
      } else if (input.operation === 'PROJECT') {
        const projectionHash = evidenceProjectionHash({
          requestId: this.draft.requestId, draftId: this.draft.draftId, payloadHash: input.payloadHash,
          paymentEvidenceObjectKeys: [...this.draft.paymentEvidenceObjectKeys],
          chatEvidenceObjectKeys: [...this.draft.chatEvidenceObjectKeys],
          paymentEvidenceFileIds: [...input.paymentEvidenceFileIds],
          chatEvidenceFileIds: [...input.chatEvidenceFileIds], evidenceCount: input.evidenceCount,
        })
        this.draft = {
          ...this.draft, version: this.draft.version + 1,
          paymentEvidenceFileIds: [...input.paymentEvidenceFileIds],
          chatEvidenceFileIds: [...input.chatEvidenceFileIds], evidenceCount: input.evidenceCount,
          evidenceProjectionHash: projectionHash,
          ...(this.options.corruptAfterProject ?? {}),
        }
      } else if (input.operation === 'RETRY') {
        this.draft = {
          ...this.draft, state: input.taskAttempt === 8 ? 'NEEDS_REVIEW' : 'RETRYING',
          version: this.draft.version + 1, safeErrorCode: input.safeErrorCode,
          processingOwnerToken: null, processingLeaseUntil: null,
        }
      } else if (input.operation === 'COMPLETE') {
        this.draft = {
          ...this.draft, state: input.safeErrorCode === 'DOWNSTREAM_RETRY' ? 'CONFIRMED_WITH_RETRY' : 'CONFIRMED',
          version: this.draft.version + 1,
          caseId: input.caseId, confirmationStatus: input.confirmationStatus,
          safeErrorCode: input.safeErrorCode, processingOwnerToken: null, processingLeaseUntil: null,
          ...(this.options.corruptAfterComplete ?? {}),
        }
      }
    }
    if (this.options.responseLossOperation === input.operation && !this.lostResponse) {
      this.lostResponse = true
      throw new Error('simulated state response loss')
    }
    return result(this.draft, 'APPLIED')
  }

  private requireVersion(input: MiniAppAsyncStateMutation): void {
    if (this.draft.version !== input.expectedVersion || this.draft.attemptCount !== input.expectedAttempt) {
      throw new Error('stale async version')
    }
  }
  private requireOwner(input: MiniAppAsyncStateMutation): void {
    this.requireVersion(input)
    if (this.draft.state !== 'PROCESSING' || this.draft.processingOwnerToken !== input.leaseOwnerToken
      || !this.draft.processingLeaseUntil || Date.parse(this.draft.processingLeaseUntil) <= Date.parse(input.nowIso)) {
      throw new Error('stale async owner')
    }
  }
}

class TestClock {
  now: Date
  readonly waits: number[] = []
  constructor(now: Date) { this.now = new Date(now) }
  get totalWait() { return this.waits.reduce((sum, value) => sum + value, 0) }
  advance(milliseconds: number) { this.now = new Date(this.now.getTime() + milliseconds) }
  async wait(milliseconds: number) {
    this.waits.push(milliseconds)
    this.advance(milliseconds)
  }
}

function queuedDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  const draft = {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    state: 'QUEUED' as const, retentionState: '' as const, version: 3, payloadHash: null, aeName: 'เอม',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const, appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [], evidenceCount: 2, paymentEvidenceObjectKeys: [paymentKey],
    chatEvidenceObjectKeys: [chatKey], taskName: 'task/request-1', queuedAt: fixedNow.toISOString(),
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    processingOwnerToken: null, createdAt: fixedNow.toISOString(), confirmedAt: null, caseId: null,
    evidenceProjectionHash: null,
    confirmationStatus: null, safeErrorCode: null, updatedAt: fixedNow.toISOString(), ...patch,
  }
  return {
    ...draft,
    payloadHash: patch.payloadHash === undefined
      ? createHash('sha256').update(canonicalMiniAppAsyncIdentity(draft)).digest('base64url')
      : patch.payloadHash,
  }
}

function taskInput(attempt: number) {
  const draft = queuedDraft()
  return {
    requestId: draft.requestId,
    draftId: draft.draftId,
    payloadHash: draft.payloadHash!,
    baseVersion: 3,
    attempt,
  }
}

function withProjectionHash(draft: MiniAppRequestRecord): MiniAppRequestRecord {
  return {
    ...draft,
    evidenceProjectionHash: evidenceProjectionHash({
      requestId: draft.requestId, draftId: draft.draftId, payloadHash: draft.payloadHash!,
      paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys],
      chatEvidenceObjectKeys: [...draft.chatEvidenceObjectKeys],
      paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds],
      chatEvidenceFileIds: [...draft.chatEvidenceFileIds], evidenceCount: draft.evidenceCount,
    }),
  }
}

function result(draft: MiniAppRequestRecord, outcome: 'APPLIED' | 'BUSY') {
  return {
    requestId: draft.requestId, draftId: draft.draftId, state: draft.state, version: draft.version,
    attemptCount: draft.attemptCount, caseId: draft.caseId, confirmationStatus: draft.confirmationStatus, outcome,
  }
}
