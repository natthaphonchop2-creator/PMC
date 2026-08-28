import { describe, expect, it, vi } from 'vitest'
import {
  AsyncBookingWorkerError,
  createAsyncBookingWorker,
} from '../../server/pmc-mini-app/asyncWorker'
import type { BookingIngressPort } from '../../server/pmc-mini-app/bookingIngressClient'
import type { EvidenceIngressPort } from '../../server/pmc-mini-app/evidenceIngressClient'
import type { EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import {
  WorkerLeaseError,
  type WorkerLeaseHandle,
  type WorkerLeasePort,
} from '../../server/pmc-mini-app/workerLease'
import type {
  AsyncMiniAppStore,
  MiniAppRequestRecord,
  MiniAppStore,
} from '../../server/pmc-mini-app/store'

const fixedNow = new Date('2026-08-28T03:00:00.000Z')
const paymentKeyOne = `drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`
const paymentKeyTwo = `drafts/draft-1/PAYMENT/${'b'.repeat(64)}.jpg`
const chatKeyOne = `drafts/draft-1/CHAT/${'c'.repeat(64)}.png`
const stagedEvidence = new Map<string, { bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>([
  [paymentKeyOne, { bytes: pngBytes(1), mimeType: 'image/png' }],
  [paymentKeyTwo, { bytes: jpegBytes(2), mimeType: 'image/jpeg' }],
  [chatKeyOne, { bytes: pngBytes(3), mimeType: 'image/png' }],
])

describe('PMC asynchronous booking worker', () => {
  it('copies ordered staged evidence, records one verified Drive projection, books once, then deletes staging', async () => {
    const fixture = workerFixture()

    await expect(fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 })).resolves.toEqual({
      requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })

    expect(fixture.store.projectionCalls).toEqual([{
      requestId: 'request-1', expectedAttempt: 1, expectedVersion: 3, nowIso: fixedNow.toISOString(),
      patch: {
        paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
        chatEvidenceFileIds: ['owner-drive-chat-3'],
        evidenceCount: 3,
      },
    }])
    expect(fixture.store.completionCalls).toEqual([{
      requestId: 'request-1', caseId: 'PMC-202608-0001', status: 'CONFIRMED', projectionState: 'CONFIRMED',
      nowIso: fixedNow.toISOString(), expectedAttempt: 1, expectedVersion: 4,
    }])
    expect(fixture.events).toEqual([
      'claim',
      `get:${paymentKeyOne}`, 'upload:PAYMENT:1',
      `get:${paymentKeyTwo}`, 'upload:PAYMENT:2',
      `get:${chatKeyOne}`, 'upload:CHAT:3',
      'projection', 'booking', 'complete',
      `delete:${paymentKeyOne}`, `delete:${paymentKeyTwo}`, `delete:${chatKeyOne}`,
    ])
    expect(fixture.store.read()).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
      chatEvidenceFileIds: ['owner-drive-chat-3'], evidenceCount: 3, lastProgressAt: fixedNow.toISOString(),
    })
  })

  it('reuses Drive IDs at matching ordinals and uploads only evidence missing a Drive ID', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        paymentEvidenceFileIds: ['owner-drive-existing-payment'],
        chatEvidenceFileIds: ['owner-drive-existing-chat'],
      }),
    })

    await fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 })

    expect(fixture.staging.get).toHaveBeenCalledOnce()
    expect(fixture.staging.get).toHaveBeenCalledWith(paymentKeyTwo)
    expect(fixture.evidenceIngress.upload).toHaveBeenCalledOnce()
    expect(fixture.store.read()).toMatchObject({
      paymentEvidenceFileIds: ['owner-drive-existing-payment', 'owner-drive-payment-2'],
      chatEvidenceFileIds: ['owner-drive-existing-chat'],
      evidenceCount: 3,
    })
  })

  it('does not call booking ingress when the persisted Drive-ID projection fails count verification', async () => {
    const fixture = workerFixture({ corruptProjection: true })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_COPY_RETRY', message: 'EVIDENCE_COPY_RETRY' })

    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.store.read()).toMatchObject({ state: 'RETRYING', safeErrorCode: 'EVIDENCE_COPY_RETRY' })
  })

  it.each([1, 2, 3, 4, 5, 6, 7])(
    'records attempt %i as RETRYING and throws a safe error so Cloud Tasks retries',
    async (attempt) => {
      const fixture = workerFixture({
        draft: queuedDraft({
          state: attempt === 1 ? 'QUEUED' : 'RETRYING',
          attemptCount: attempt - 1,
        }),
        stagingFailure: new Error('private gs://bucket/customer-file detail'),
      })

      await expect(
        fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt }),
      ).rejects.toMatchObject({ code: 'EVIDENCE_COPY_RETRY', message: 'EVIDENCE_COPY_RETRY' })

      expect(fixture.store.read()).toMatchObject({
        state: 'RETRYING', attemptCount: attempt, safeErrorCode: 'EVIDENCE_COPY_RETRY',
        processingLeaseUntil: null,
      })
      expect(fixture.store.retryCalls.at(-1)).toMatchObject({ expectedAttempt: attempt })
      expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
      expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    },
  )

  it('records the eighth failed attempt as NEEDS_REVIEW and returns terminal success', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({ state: 'QUEUED', attemptCount: 0 }),
      stagingFailure: new Error('private evidence provider detail'),
    })

    await expect(fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 8 })).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.store.read()).toMatchObject({
      state: 'NEEDS_REVIEW', attemptCount: 1, safeErrorCode: 'RETRY_EXHAUSTED', processingLeaseUntil: null,
    })
    expect(fixture.store.retryCalls).toEqual([expect.objectContaining({
      safeErrorCode: 'RETRY_EXHAUSTED', expectedAttempt: 1,
    })])
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
  })

  it('retries the same bound booking after a timeout and records the same Case ID once', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
        chatEvidenceFileIds: ['owner-drive-chat-3'],
      }),
      bookingResults: [new Error('private timeout response body'), { caseId: 'PMC-202608-0001', status: 'CONFIRMED' }],
    })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'BOOKING_INGRESS_RETRY', message: 'BOOKING_INGRESS_RETRY' })
    expect(fixture.store.read()).toMatchObject({ state: 'RETRYING', caseId: null })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 2 }),
    ).resolves.toEqual({ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED' })

    const submissions = fixture.bookingIngress.send.mock.calls.map(([draft]) => bookingIdentity(draft))
    expect(submissions).toEqual([submissions[0], submissions[0]])
    expect(submissions[0]).toEqual({
      requestId: 'request-1', payloadHash: 'payload-hash-1',
      paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
      chatEvidenceFileIds: ['owner-drive-chat-3'],
    })
    expect(fixture.evidenceIngress.upload).not.toHaveBeenCalled()
    expect(fixture.store.completionCalls).toHaveLength(1)
    expect(fixture.store.read()).toMatchObject({ state: 'CONFIRMED', caseId: 'PMC-202608-0001' })
  })

  it('never lets a stale worker mark retry after another lease owner reclaims the draft', async () => {
    const fixture = workerFixture({ staleDuringProjection: true })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'STALE_PROCESSING_LEASE', message: 'STALE_PROCESSING_LEASE' })

    expect(fixture.store.retryCalls).toHaveLength(0)
    expect(fixture.store.read()).toMatchObject({ state: 'PROCESSING', attemptCount: 2, version: 4 })
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('keeps the recorded Case ID terminal when staging deletion fails and terminal replay has no side effect', async () => {
    const fixture = workerFixture({ deleteFailure: new Error('private storage URL') })

    await expect(fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 })).resolves.toEqual({
      requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })
    expect(fixture.store.read()).toMatchObject({ state: 'CONFIRMED', caseId: 'PMC-202608-0001' })
    expect(fixture.staging.deleteVerified).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    fixture.events.length = 0
    await expect(fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 2 })).resolves.toEqual({
      requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })

    expect(fixture.events).toEqual([])
    expect(fixture.staging.get).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.evidenceIngress.upload).not.toHaveBeenCalled()
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.store.projectionCalls).toHaveLength(1)
    expect(fixture.store.completionCalls).toHaveLength(1)
  })

  it.each([
    ['CONFIRMED' as const, 'PMC-202608-0001', 'CONFIRMED' as const],
    ['NEEDS_REVIEW' as const, null, 'NEEDS_REVIEW' as const],
  ])('returns stored %s terminal state without Storage, Drive, or Apps Script mutation', async (state, caseId, expectedState) => {
    const fixture = workerFixture({
      draft: queuedDraft({ state, caseId, confirmationStatus: caseId ? 'CONFIRMED' : null, attemptCount: 1 }),
    })

    await expect(fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 2 })).resolves.toEqual({
      requestId: 'request-1', caseId, state: expectedState,
    })
    expect(fixture.events).toEqual([])
    expect(fixture.store.projectionCalls).toHaveLength(0)
    expect(fixture.store.retryCalls).toHaveLength(0)
    expect(fixture.store.completionCalls).toHaveLength(0)
  })

  it('returns a safe retryable error while another worker still owns the live processing lease', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        state: 'PROCESSING', attemptCount: 1, processingStartedAt: '2026-08-28T02:59:00.000Z',
        processingLeaseUntil: '2026-08-28T03:04:00.000Z', lastProgressAt: '2026-08-28T02:59:00.000Z',
      }),
    })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 2 }),
    ).rejects.toMatchObject({ code: 'ASYNC_CLAIM_RETRY', message: 'ASYNC_CLAIM_RETRY' })
    expect(fixture.events).toEqual(['claim'])
    expect(fixture.store.retryCalls).toHaveLength(0)
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
  })

  it('blocks booking when updateProcessingProjection returns a value that was not persisted', async () => {
    const fixture = workerFixture({ projectionWriteLost: true })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_COPY_RETRY' })

    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.store.read()).toMatchObject({ state: 'RETRYING', paymentEvidenceFileIds: [] })
  })

  it('blocks booking when the persisted projection has the wrong ordered Drive IDs', async () => {
    const fixture = workerFixture({ wrongPersistedProjection: true })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_COPY_RETRY' })

    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.store.read()).toMatchObject({ state: 'RETRYING' })
  })

  it('blocks cleanup when completeAsyncBooking returns a terminal value that was not persisted', async () => {
    const fixture = workerFixture({
      draft: queuedDraft({
        paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
        chatEvidenceFileIds: ['owner-drive-chat-3'],
      }),
      completionWriteLost: true,
    })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'BOOKING_COMPLETION_RETRY' })

    expect(fixture.bookingIngress.send).toHaveBeenCalledOnce()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
    expect(fixture.store.read()).toMatchObject({ state: 'RETRYING', caseId: null })
  })

  it('allows only one of two independent worker processes to claim or mutate through the shared coordination lease', async () => {
    const lease = new MemoryWorkerLease()
    let releaseUpload: (() => void) | undefined
    let uploadStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { uploadStarted = resolve })
    const blockedUpload = new Promise<void>((resolve) => { releaseUpload = resolve })
    const first = workerFixture({
      lease,
      evidenceUploadWait: async () => {
        uploadStarted?.()
        await blockedUpload
      },
    })
    const second = workerFixture({ lease })

    const firstRun = first.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 })
    await started
    await expect(
      second.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 2 }),
    ).rejects.toMatchObject({ code: 'WORKER_LEASE_RETRY' })
    releaseUpload?.()
    await expect(firstRun).resolves.toMatchObject({ caseId: 'PMC-202608-0001', state: 'CONFIRMED' })

    expect(first.store.claimCalls + second.store.claimCalls).toBe(1)
    expect(first.store.completionCalls.length + second.store.completionCalls.length).toBe(1)
    expect(first.bookingIngress.send.mock.calls.length + second.bookingIngress.send.mock.calls.length).toBe(1)
  })

  it('stops a stale coordination owner before it can overwrite another worker terminal result', async () => {
    const lease = new MemoryWorkerLease()
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      lease,
      evidenceUploadWait: async () => {
        lease.replaceOwner('request-1', fixedNow, 'other-owner-token1')
        fixtureRef.current?.store.forceConfirmed()
      },
    })
    fixtureRef.current = fixture

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'WORKER_LEASE_RETRY' })

    expect(fixture.store.read()).toMatchObject({ state: 'CONFIRMED', caseId: 'PMC-202608-0001' })
    expect(fixture.store.projectionCalls).toHaveLength(0)
    expect(fixture.store.retryCalls).toHaveLength(0)
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
  })

  it('waits on the eighth delivery until a busy coordination owner records a terminal result', async () => {
    const lease = new MemoryWorkerLease()
    lease.hold('request-1', fixedNow, 2_000, 'other-owner-token1')
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      lease,
      onWait: () => { fixtureRef.current?.store.forceConfirmed() },
    })
    fixtureRef.current = fixture

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 8 }),
    ).resolves.toEqual({ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED' })

    expect(fixture.clock.waits).toEqual([1_000])
    expect(fixture.store.claimCalls).toBe(0)
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
  })

  it('waits on the eighth delivery, reclaims expired coordination and Sheet leases, and completes without attempt nine', async () => {
    const lease = new MemoryWorkerLease()
    lease.hold('request-1', fixedNow, 2_000, 'other-owner-token1')
    const fixture = workerFixture({
      lease,
      draft: queuedDraft({
        state: 'PROCESSING', attemptCount: 1,
        processingStartedAt: fixedNow.toISOString(),
        processingLeaseUntil: new Date(fixedNow.getTime() + 2_000).toISOString(),
        lastProgressAt: fixedNow.toISOString(),
      }),
    })

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt: 8 }),
    ).resolves.toEqual({ requestId: 'request-1', caseId: 'PMC-202608-0001', state: 'CONFIRMED' })

    expect(fixture.clock.waits).toEqual([1_000, 1_000])
    expect(fixture.store.claimCalls).toBe(1)
    expect(fixture.store.read()).toMatchObject({ state: 'CONFIRMED', attemptCount: 2 })
  })

  it.each([0, 9, 1.5])('rejects invalid attempt %s before claiming or touching external ports', async (attempt) => {
    const fixture = workerFixture()

    await expect(
      fixture.worker.finalize({ requestId: 'request-1', draftId: 'draft-1', attempt }),
    ).rejects.toBeInstanceOf(AsyncBookingWorkerError)
    expect(fixture.events).toEqual([])
  })
})

function workerFixture(options: {
  draft?: MiniAppRequestRecord
  stagingFailure?: Error
  bookingResults?: Array<Error | { caseId: string; status: 'CONFIRMED' }>
  deleteFailure?: Error
  corruptProjection?: boolean
  staleDuringProjection?: boolean
  projectionWriteLost?: boolean
  wrongPersistedProjection?: boolean
  completionWriteLost?: boolean
  evidenceUploadWait?: () => Promise<void>
  lease?: MemoryWorkerLease
  onWait?: (milliseconds: number) => void
} = {}) {
  const events: string[] = []
  const clock = new WorkerClock(fixedNow, options.onWait)
  const store = new WorkerStoreFixture(options.draft ?? queuedDraft(), events, {
    corruptProjection: options.corruptProjection,
    staleDuringProjection: options.staleDuringProjection,
    projectionWriteLost: options.projectionWriteLost,
    wrongPersistedProjection: options.wrongPersistedProjection,
    completionWriteLost: options.completionWriteLost,
  })
  const staging: EvidenceStagingPort & {
    get: ReturnType<typeof vi.fn>
    deleteVerified: ReturnType<typeof vi.fn>
  } = {
    put: vi.fn(async () => { throw new Error('worker must not stage evidence') }),
    get: vi.fn(async (objectKey: string) => {
      events.push(`get:${objectKey}`)
      if (options.stagingFailure) throw options.stagingFailure
      const value = stagedEvidence.get(objectKey)
      if (!value) throw new Error('missing fake staged object')
      return { bytes: Buffer.from(value.bytes), mimeType: value.mimeType }
    }),
    deleteVerified: vi.fn(async (objectKey: string) => {
      events.push(`delete:${objectKey}`)
      if (options.deleteFailure) throw options.deleteFailure
    }),
  }
  const evidenceIngress: EvidenceIngressPort & { upload: ReturnType<typeof vi.fn> } = {
    upload: vi.fn(async (input: Parameters<EvidenceIngressPort['upload']>[0]) => {
      const marker = input.bytes.at(-1)
      events.push(`upload:${input.kind}:${marker}`)
      await options.evidenceUploadWait?.()
      return input.kind === 'CHAT' ? `owner-drive-chat-${marker}` : `owner-drive-payment-${marker}`
    }),
  }
  const bookingResults = [...(options.bookingResults ?? [{ caseId: 'PMC-202608-0001', status: 'CONFIRMED' as const }])]
  const bookingIngress: BookingIngressPort & { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn(async () => {
      events.push('booking')
      const result = bookingResults.shift()
      if (!result) throw new Error('missing fake booking result')
      if (result instanceof Error) throw result
      return result
    }),
  }
  const lease = options.lease ?? new MemoryWorkerLease()
  const worker = createAsyncBookingWorker({
    store,
    staging,
    evidenceIngress,
    bookingIngress,
    now: () => clock.now,
    lease,
    wait: (milliseconds: number) => clock.wait(milliseconds),
  })
  return { worker, store, staging, evidenceIngress, bookingIngress, events, lease, clock }
}

class WorkerStoreFixture implements MiniAppStore, AsyncMiniAppStore {
  readonly projectionCalls: Array<Parameters<AsyncMiniAppStore['updateProcessingProjection']>[0]> = []
  readonly retryCalls: Array<Parameters<AsyncMiniAppStore['markAsyncRetry']>[0]> = []
  readonly completionCalls: Array<Parameters<AsyncMiniAppStore['completeAsyncBooking']>[0]> = []
  claimCalls = 0
  private draft: MiniAppRequestRecord

  constructor(
    draft: MiniAppRequestRecord,
    private readonly events: string[],
    private readonly behavior: {
      corruptProjection?: boolean
      staleDuringProjection?: boolean
      projectionWriteLost?: boolean
      wrongPersistedProjection?: boolean
      completionWriteLost?: boolean
    },
  ) {
    this.draft = structuredClone(draft)
  }

  read(): MiniAppRequestRecord { return structuredClone(this.draft) }

  async claimProcessing(input: Parameters<AsyncMiniAppStore['claimProcessing']>[0]) {
    this.events.push('claim')
    this.claimCalls += 1
    if (input.requestId !== this.draft.requestId || input.draftId !== this.draft.draftId) throw new Error('ASYNC_TASK_IDENTITY_CONFLICT')
    if (this.draft.state === 'CONFIRMED' || this.draft.state === 'NEEDS_REVIEW') {
      return { claimed: false, draft: this.read() }
    }
    if (this.draft.state === 'PROCESSING'
      && this.draft.processingLeaseUntil
      && Date.parse(this.draft.processingLeaseUntil) > Date.parse(input.nowIso)) {
      return { claimed: false, draft: this.read() }
    }
    this.draft = {
      ...this.draft,
      state: 'PROCESSING',
      processingStartedAt: this.draft.processingStartedAt ?? input.nowIso,
      processingLeaseUntil: input.leaseUntil,
      lastProgressAt: input.nowIso,
      attemptCount: this.draft.attemptCount + 1,
      safeErrorCode: null,
      updatedAt: input.nowIso,
      version: this.draft.version + 1,
    }
    return { claimed: true, draft: this.read() }
  }

  async updateProcessingProjection(input: Parameters<AsyncMiniAppStore['updateProcessingProjection']>[0]) {
    this.events.push('projection')
    this.projectionCalls.push(structuredClone(input))
    this.assertOwner(input.expectedAttempt, input.expectedVersion)
    if (this.behavior.staleDuringProjection) {
      this.draft = {
        ...this.draft,
        attemptCount: this.draft.attemptCount + 1,
        version: this.draft.version + 1,
        processingLeaseUntil: new Date(fixedNow.getTime() + 5 * 60_000).toISOString(),
      }
      throw new Error('STALE_PROCESSING_LEASE')
    }
    const patch = this.behavior.corruptProjection
      ? { ...input.patch, chatEvidenceFileIds: [] }
      : input.patch
    const correct = {
      ...this.draft,
      ...structuredClone(input.patch),
      lastProgressAt: input.nowIso,
      updatedAt: input.nowIso,
      version: this.draft.version + 1,
    }
    if (this.behavior.projectionWriteLost) return structuredClone(correct)
    this.draft = this.behavior.wrongPersistedProjection
      ? { ...correct, chatEvidenceFileIds: [] }
      : { ...correct, ...structuredClone(patch) }
    return structuredClone(correct)
  }

  async markAsyncRetry(input: Parameters<AsyncMiniAppStore['markAsyncRetry']>[0]) {
    this.events.push('retry')
    this.retryCalls.push(structuredClone(input))
    this.assertOwner(input.expectedAttempt, input.expectedVersion)
    this.draft = {
      ...this.draft,
      state: input.safeErrorCode === 'RETRY_EXHAUSTED' || this.draft.attemptCount >= 8 ? 'NEEDS_REVIEW' : 'RETRYING',
      safeErrorCode: input.safeErrorCode,
      processingLeaseUntil: null,
      lastProgressAt: input.nowIso,
      updatedAt: input.nowIso,
      version: this.draft.version + 1,
    }
    return this.read()
  }

  async completeAsyncBooking(input: Parameters<AsyncMiniAppStore['completeAsyncBooking']>[0]) {
    this.events.push('complete')
    this.completionCalls.push(structuredClone(input))
    this.assertOwner(input.expectedAttempt, input.expectedVersion)
    const completed: MiniAppRequestRecord = {
      ...this.draft,
      state: input.projectionState,
      caseId: input.caseId,
      confirmationStatus: input.status,
      confirmedAt: input.nowIso,
      processingLeaseUntil: null,
      lastProgressAt: input.nowIso,
      safeErrorCode: null,
      updatedAt: input.nowIso,
      version: this.draft.version + 1,
    }
    if (this.behavior.completionWriteLost) return structuredClone(completed)
    this.draft = completed
    return this.read()
  }

  forceConfirmed(): void {
    this.draft = {
      ...this.draft,
      state: 'CONFIRMED',
      caseId: 'PMC-202608-0001',
      confirmationStatus: 'CONFIRMED',
      confirmedAt: fixedNow.toISOString(),
      processingLeaseUntil: null,
      version: this.draft.version + 1,
    }
  }

  private assertOwner(expectedAttempt: number, expectedVersion: number): void {
    if (this.draft.state !== 'PROCESSING'
      || this.draft.attemptCount !== expectedAttempt
      || this.draft.version !== expectedVersion) throw new Error('STALE_PROCESSING_LEASE')
  }

  async getDraft(draftId: string) { return draftId === this.draft.draftId ? this.read() : null }
  async getActiveStaffByLineUserId(): Promise<null> { return null }
  async getActiveBookingConfig(): Promise<never> { throw new Error('not used') }
  async getLatestActiveDraftByStaff(): Promise<null> { return null }
  async createDraft(): Promise<never> { throw new Error('not used') }
  async updateDraft(): Promise<never> { throw new Error('not used') }
  async markRetentionPending(): Promise<never> { throw new Error('not used') }
  async claimConfirmation(): Promise<never> { throw new Error('not used') }
  async completeConfirmation(): Promise<never> { throw new Error('not used') }
  async failConfirmation(): Promise<never> { throw new Error('not used') }
  async queueDraft(): Promise<never> { throw new Error('not used') }
}

class WorkerClock {
  readonly waits: number[] = []
  now: Date

  constructor(initial: Date, private readonly onWait?: (milliseconds: number) => void) {
    this.now = new Date(initial)
  }

  async wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds)
    this.now = new Date(this.now.getTime() + milliseconds)
    this.onWait?.(milliseconds)
  }
}

class MemoryWorkerLease implements WorkerLeasePort {
  private generation = 0
  private current = new Map<string, WorkerLeaseHandle>()

  async acquire(input: Parameters<WorkerLeasePort['acquire']>[0]) {
    const existing = this.current.get(input.requestId)
    if (existing && Date.parse(existing.expiresAt) > Date.parse(input.nowIso)) {
      return { acquired: false as const, expiresAt: existing.expiresAt }
    }
    this.generation += 1
    const lease = {
      lockKey: `locks/${input.requestId}`,
      ownerToken: `owner-token-${this.generation.toString().padStart(4, '0')}`,
      expiresAt: input.leaseUntil,
      generation: String(this.generation),
    }
    this.current.set(input.requestId, lease)
    return { acquired: true as const, lease: structuredClone(lease) }
  }

  async renew(input: Parameters<WorkerLeasePort['renew']>[0]) {
    const requestId = input.lease.lockKey.slice('locks/'.length)
    const existing = this.current.get(requestId)
    if (!existing || existing.ownerToken !== input.lease.ownerToken || existing.generation !== input.lease.generation) {
      throw new WorkerLeaseError('WORKER_LEASE_LOST')
    }
    this.generation += 1
    const renewed = { ...existing, expiresAt: input.leaseUntil, generation: String(this.generation) }
    this.current.set(requestId, renewed)
    return structuredClone(renewed)
  }

  async release(lease: WorkerLeaseHandle): Promise<void> {
    const requestId = lease.lockKey.slice('locks/'.length)
    const existing = this.current.get(requestId)
    if (existing?.ownerToken === lease.ownerToken && existing.generation === lease.generation) this.current.delete(requestId)
  }

  hold(requestId: string, now: Date, milliseconds: number, ownerToken: string): void {
    this.generation += 1
    this.current.set(requestId, {
      lockKey: `locks/${requestId}`,
      ownerToken,
      expiresAt: new Date(now.getTime() + milliseconds).toISOString(),
      generation: String(this.generation),
    })
  }

  replaceOwner(requestId: string, now: Date, ownerToken: string): void {
    this.hold(requestId, now, 4 * 60_000, ownerToken)
  }
}

function queuedDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-active', lineUserIdHash: 'line-user-hash',
    state: 'QUEUED', retentionState: '', version: 2, payloadHash: 'payload-hash-1', aeName: 'เอม',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 3,
    paymentEvidenceObjectKeys: [paymentKeyOne, paymentKeyTwo], chatEvidenceObjectKeys: [chatKeyOne],
    taskName: 'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1',
    queuedAt: '2026-08-28T02:59:00.000Z', processingStartedAt: null, processingLeaseUntil: null,
    lastProgressAt: null, attemptCount: 0, createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null,
    caseId: null, confirmationStatus: null, safeErrorCode: null, updatedAt: '2026-08-28T02:59:00.000Z',
    ...structuredClone(patch),
  }
}

function bookingIdentity(draft: MiniAppRequestRecord) {
  return {
    requestId: draft.requestId,
    payloadHash: draft.payloadHash,
    paymentEvidenceFileIds: draft.paymentEvidenceFileIds,
    chatEvidenceFileIds: draft.chatEvidenceFileIds,
  }
}

function pngBytes(marker: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
}

function jpegBytes(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker])
}
