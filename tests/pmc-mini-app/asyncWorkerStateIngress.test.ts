import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createAsyncBookingWorker } from '../../server/pmc-mini-app/asyncWorker'
import { bookingPayloadHash, evidenceProjectionHash } from '../../server/pmc-mini-app/bookingDraft'
import type { AsyncStateIngressPort } from '../../server/pmc-mini-app/asyncStateIngressClient'
import {
  createBookingIngressClient,
  type BookingIngressPort,
} from '../../server/pmc-mini-app/bookingIngressClient'
import type { EvidenceIngressPort } from '../../server/pmc-mini-app/evidenceIngressClient'
import type { EvidenceStagingCleanupDescriptor, EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import type { MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'
import type { MiniAppAsyncStateMutation } from '../../shared/pmcMiniAppAsyncState'

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

  it('emits one terminal lifecycle event only for the delivery that receives owner APPLIED', async () => {
    const telemetry = vi.fn()
    const fixture = workerFixture({ telemetry })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({ state: 'CONFIRMED' })
    await expect(fixture.worker.finalize(taskInput(2, fixture.state.read()))).resolves.toMatchObject({ state: 'CONFIRMED' })

    expect(telemetry.mock.calls.filter(([name]) => name === 'booking_worker_completed')).toHaveLength(1)
  })

  it('does not invent a terminal lifecycle event when COMPLETE response loss prevents owner APPLIED proof', async () => {
    const telemetry = vi.fn()
    const fixture = workerFixture({ telemetry, responseLossOperation: 'COMPLETE' })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({ state: 'CONFIRMED' })
    await expect(fixture.worker.finalize(taskInput(2, fixture.state.read()))).resolves.toMatchObject({ state: 'CONFIRMED' })

    expect(telemetry.mock.calls.filter(([name]) => name === 'booking_worker_completed')).toHaveLength(0)
  })

  it('measures worker phases from their immediate starts with a distinct completion mutation event', async () => {
    const telemetry = vi.fn()
    const fixture = workerFixture({
      telemetry,
      advanceOnClaimSendMs: 100,
      advanceOnStagingGetMs: 50,
      advanceOnBookingIngressMs: 200,
      advanceOnCompleteSendMs: 300,
    })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({ state: 'CONFIRMED' })

    expect(telemetry).toHaveBeenCalledWith('booking_worker_claimed', expect.objectContaining({ action: 'claim', elapsedMs: 100 }))
    expect(telemetry).toHaveBeenCalledWith('drive_copy_completed', expect.objectContaining({ action: 'evidence_projection', elapsedMs: 100 }))
    expect(telemetry).toHaveBeenCalledWith('booking_ingress_completed', expect.objectContaining({ action: 'booking_ingress', elapsedMs: 200 }))
    expect(telemetry).toHaveBeenCalledWith('booking_completion_mutation_completed', expect.objectContaining({ action: 'completion_mutation', elapsedMs: 300 }))
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
    expect(fixture.staging.deleteVerified).toHaveBeenNthCalledWith(1, expect.objectContaining({ objectKey: paymentKey }))
    expect(fixture.staging.deleteVerified).toHaveBeenNthCalledWith(2, expect.objectContaining({ objectKey: chatKey }))
    expect(fixture.state.read()).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      processingOwnerToken: null,
    })
  })

  it('passes the protocol-2 recorder, Admin, and AE snapshots through the real ingress client', async () => {
    const envelopes: unknown[] = []
    const fixture = workerFixture({
      draft: queuedDraft({
        protocolVersion: 2,
        staffId: 'recorder-1',
        recorderName: 'มัส',
        adminId: 'admin-2',
        adminName: 'แวว',
        aeId: 'ae-1',
        aeName: 'หมวย',
      }),
      productionIngressCapture: (body) => envelopes.push(body),
    })

    await expect(fixture.worker.finalize(taskInput(1, fixture.state.read()))).resolves.toMatchObject({
      state: 'CONFIRMED',
    })

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({
      version: 2,
      payload: {
        protocolVersion: 2,
        staffId: 'recorder-1',
        recorderName: 'มัส',
        adminId: 'admin-2',
        adminName: 'แวว',
        aeId: 'ae-1',
        aeName: 'หมวย',
      },
    })
  })

  it('projects identical same-kind bytes through distinct protocol-2 ordinals before confirmation', async () => {
    const repeatedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
    const paymentKeys = [
      v2ObjectKey('PAYMENT', 0, repeatedBytes),
      v2ObjectKey('PAYMENT', 1, repeatedBytes),
    ]
    const chatBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8])
    const chatObjectKey = v2ObjectKey('CHAT', 0, chatBytes)
    const fixture = workerFixture({
      responseLossOperation: 'PROJECT',
      draft: queuedDraft({
        protocolVersion: 2,
        paymentEvidenceObjectKeys: paymentKeys,
        chatEvidenceObjectKeys: [chatObjectKey],
        evidenceCount: 3,
      }),
      stagedBytesByKey: new Map([
        [paymentKeys[0]!, repeatedBytes], [paymentKeys[1]!, repeatedBytes], [chatObjectKey, chatBytes],
      ]),
      evidenceFileId: ({ kind, ordinal }) => kind === 'PAYMENT'
        ? `owner-drive-payment-${ordinal}`
        : `owner-drive-chat-${ordinal}`,
    })

    await expect(fixture.worker.finalize(taskInput(1, fixture.state.read()))).resolves.toMatchObject({
      state: 'CONFIRMED',
    })
    expect(fixture.evidenceIngress.upload).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'PAYMENT', ordinal: 0 }))
    expect(fixture.evidenceIngress.upload).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'PAYMENT', ordinal: 1 }))
    expect(fixture.evidenceIngress.upload).toHaveBeenNthCalledWith(3, expect.objectContaining({ kind: 'CHAT', ordinal: 0 }))
    expect(fixture.state.read()).toMatchObject({
      paymentEvidenceFileIds: ['owner-drive-payment-0', 'owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-0'], evidenceCount: 3,
    })
  })

  it('resumes an identical-byte worker projection at the missing ordinal and cleans every exact descriptor', async () => {
    const repeatedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
    const paymentKeys = [v2ObjectKey('PAYMENT', 0, repeatedBytes), v2ObjectKey('PAYMENT', 1, repeatedBytes)]
    const chatBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8])
    const chatObjectKey = v2ObjectKey('CHAT', 0, chatBytes)
    const fixture = workerFixture({
      draft: queuedDraft({
        protocolVersion: 2,
        paymentEvidenceObjectKeys: paymentKeys,
        chatEvidenceObjectKeys: [chatObjectKey],
        paymentEvidenceFileIds: ['owner-drive-payment-0'],
        evidenceCount: 3,
      }),
      stagedBytesByKey: new Map([
        [paymentKeys[0]!, repeatedBytes], [paymentKeys[1]!, repeatedBytes], [chatObjectKey, chatBytes],
      ]),
      evidenceFileId: ({ kind, ordinal }) => kind === 'PAYMENT'
        ? `owner-drive-payment-${ordinal}`
        : `owner-drive-chat-${ordinal}`,
    })

    await expect(fixture.worker.finalize(taskInput(1, fixture.state.read()))).resolves.toMatchObject({ state: 'CONFIRMED' })

    expect(fixture.staging.get).not.toHaveBeenCalledWith(paymentKeys[0])
    expect(fixture.evidenceIngress.upload).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'PAYMENT', ordinal: 1 }))
    expect(fixture.state.read()).toMatchObject({
      paymentEvidenceFileIds: ['owner-drive-payment-0', 'owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-0'], evidenceCount: 3,
    })
    expect(fixture.staging.describe).toHaveBeenCalledWith(paymentKeys[0])
    expect(fixture.staging.deleteVerified).toHaveBeenCalledTimes(3)
  })

  it('rejects a foreign protocol-2 slot before Drive upload, booking ingress, or cleanup', async () => {
    const paymentBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
    const foreignPaymentKey = v2ObjectKey('PAYMENT', 0, paymentBytes, 'other-request')
    const chatBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8])
    const currentChatKey = v2ObjectKey('CHAT', 0, chatBytes)
    const fixture = workerFixture({
      draft: queuedDraft({
        protocolVersion: 2,
        paymentEvidenceObjectKeys: [foreignPaymentKey],
        chatEvidenceObjectKeys: [currentChatKey],
        paymentEvidenceFileIds: ['owner-drive-payment-0'],
        chatEvidenceFileIds: ['owner-drive-chat-0'],
        evidenceCount: 2,
      }),
      stagedBytesByKey: new Map([[foreignPaymentKey, paymentBytes], [currentChatKey, chatBytes]]),
    })

    await expect(fixture.worker.finalize(taskInput(8, fixture.state.read()))).resolves.toMatchObject({
      state: 'NEEDS_REVIEW',
    })
    expect(fixture.evidenceIngress.upload).not.toHaveBeenCalled()
    expect(fixture.bookingIngress.send).not.toHaveBeenCalled()
    expect(fixture.staging.deleteVerified).not.toHaveBeenCalled()
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
      afterEvidenceUpload: () => fixtureRef.current?.clock.advance(241_000),
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

  it('keeps ownership across forty-second evidence uploads within the four-minute lease', async () => {
    const fixture = workerFixture({ advanceOnEvidenceUploadMs: 40_000 })

    await expect(fixture.worker.finalize(taskInput(1))).resolves.toMatchObject({
      caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })
    expect(fixture.state.read()).toMatchObject({ state: 'CONFIRMED', processingOwnerToken: null })
  })

  it('keeps attempt eight processing after the thirty-second overlap window', async () => {
    const fixture = workerFixture({ advanceOnEvidenceUploadMs: 40_000 })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toMatchObject({
      caseId: 'PMC-202608-0001', state: 'CONFIRMED',
    })
    expect(fixture.clock.now.getTime() - fixedNow.getTime()).toBeGreaterThan(30_000)
    expect(fixture.state.operations()).toContain('COMPLETE')
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

  it('waits at most thirty seconds for a reclaimed four-minute owner before atomically exhausting', async () => {
    const fixtureRef: { current?: ReturnType<typeof workerFixture> } = {}
    const fixture = workerFixture({
      afterEvidenceUpload: () => fixtureRef.current?.state.reclaim('worker-owner-token-2'),
    })
    fixtureRef.current = fixture

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toEqual({
      requestId: 'request-1', caseId: null, state: 'NEEDS_REVIEW',
    })
    expect(fixture.clock.totalWait).toBe(30_000)
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

  it('atomically exhausts after the thirty-second final-attempt overlap window', async () => {
    const fixture = workerFixture({ alwaysBusyClaim: true, advanceOnClaimSendMs: 30_000 })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toMatchObject({ state: 'NEEDS_REVIEW' })

    expect(fixture.state.operations()).toEqual(['CLAIM', 'EXHAUST'])
    expect(fixture.getDraft).toHaveBeenCalledTimes(2)
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
    expect(fixture.readsAfterExhaust()).toBeLessThanOrEqual(8)
    expect(fixture.clock.waits.every((milliseconds) => milliseconds <= 1_000)).toBe(true)
    expect(fixture.clock.now.getTime() - fixedNow.getTime()).toBeLessThanOrEqual(65_000)
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

  it('persists review after a long failed staging read on the final attempt', async () => {
    const fixture = workerFixture({
      stagingFailure: new Error('private storage detail'),
      advanceOnStagingGetMs: 30_000,
    })

    await expect(fixture.worker.finalize(taskInput(8))).resolves.toMatchObject({ state: 'NEEDS_REVIEW' })

    expect(fixture.state.operations()).toEqual(['CLAIM', 'RENEW', 'RENEW', 'RETRY'])
    expect(fixture.getDraft).toHaveBeenCalledTimes(6)
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
  advanceOnEvidenceUploadMs?: number
  advanceOnBookingIngressMs?: number
  advanceOnCompleteSendMs?: number
  stagingFailure?: Error
  bookingResults?: Array<Error | { caseId: string; status: 'CONFIRMED' }>
  deleteFailure?: Error
  telemetry?: ReturnType<typeof vi.fn>
  productionIngressCapture?: (body: unknown) => void
  stagedBytesByKey?: Map<string, Buffer>
  evidenceFileId?: (input: Parameters<EvidenceIngressPort['upload']>[0]) => string
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
      const bytes = options.stagedBytesByKey?.get(key)
        ?? Buffer.from(key === paymentKey ? [0x89, 0x50, 0x4e, 0x47, 1] : [0x89, 0x50, 0x4e, 0x47, 2])
      return {
        bytes,
        mimeType: 'image/png' as const,
        cleanupDescriptor: stagingDescriptor(key, bytes),
      }
    }),
    describe: vi.fn(async (key: string) => {
      const bytes = options.stagedBytesByKey?.get(key)
        ?? Buffer.from(key === paymentKey ? [0x89, 0x50, 0x4e, 0x47, 1] : [0x89, 0x50, 0x4e, 0x47, 2])
      return stagingDescriptor(key, bytes)
    }),
    deleteVerified: vi.fn(async () => {
      if (options.deleteFailure) throw options.deleteFailure
    }),
  }
  const evidenceIngress: EvidenceIngressPort = {
    upload: vi.fn(async (uploadInput) => {
      clock.advance(options.advanceOnEvidenceUploadMs ?? 0)
      options.afterEvidenceUpload?.()
      return options.evidenceFileId?.(uploadInput)
        ?? (uploadInput.kind === 'PAYMENT' ? 'owner-drive-payment-1' : 'owner-drive-chat-1')
    }),
  }
  const bookingResults = [...(options.bookingResults ?? [{
    caseId: 'PMC-202608-0001', status: 'CONFIRMED' as const,
    driveState: 'OK' as const, calendarState: 'OK' as const, lineState: 'OK' as const,
  }])]
  const productionIngress = options.productionIngressCapture
    ? createBookingIngressClient({
        url: 'https://script.google.com/macros/s/deployment/exec',
        secret: 'server-secret',
        now: () => 1_800_000_000,
        nonce: () => 'nonce-worker-123456',
        fetch: async (_url, init) => {
          options.productionIngressCapture?.(JSON.parse(init.body) as unknown)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              caseId: 'PMC-202608-0001', status: 'CONFIRMED',
              driveState: 'OK', calendarState: 'OK', lineState: 'OK',
            }),
          }
        },
      })
    : null
  const bookingIngress: BookingIngressPort & { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn(async (draft) => {
      clock.advance(options.advanceOnBookingIngressMs ?? 0)
      if (productionIngress) return productionIngress.send(draft)
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
      advanceOnCompleteSendMs?: number
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
      processingLeaseUntil: new Date(this.clock.now.getTime() + 240_000).toISOString(),
    }
  }

  async mutate(input: MiniAppAsyncStateMutation) {
    this.calls.push(structuredClone(input))
    if (input.operation === 'CLAIM') this.clock.advance(this.options.advanceOnClaimSendMs ?? 0)
    if (input.operation === 'COMPLETE') this.clock.advance(this.options.advanceOnCompleteSendMs ?? 0)
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
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 1 as const,
    staffId: 'staff-1', recorderName: '', adminId: 'staff-1', adminName: '', lineUserIdHash: 'line-user-hash',
    state: 'QUEUED' as const, retentionState: '' as const, version: 3, payloadHash: null, aeId: null, aeName: 'เอม',
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
      ? bookingPayloadHash(draft)
      : patch.payloadHash,
  }
}

function v2ObjectKey(kind: 'PAYMENT' | 'CHAT', ordinal: number, bytes: Buffer, requestId = 'request-1'): string {
  const contentSha256 = createHash('sha256').update(bytes).digest('hex')
  const uploadId = createHash('sha256').update(JSON.stringify({
    version: 2, requestId, draftId: 'draft-1', evidenceKind: kind,
    ordinal, mimeType: 'image/png', contentSha256,
  })).digest('hex')
  return `drafts/v2/${requestId}/draft-1/${kind}/${ordinal}/${uploadId}/${contentSha256}.png`
}

function stagingDescriptor(objectKey: string, bytes: Buffer): EvidenceStagingCleanupDescriptor {
  const v2 = /^drafts\/v2\/([^/]+)\/([^/]+)\/(PAYMENT|CHAT)\/([0-9])\/([a-f0-9]{64})\/([a-f0-9]{64})\.(jpg|png)$/.exec(objectKey)
  if (v2) {
    return {
      version: 2, objectKey, requestId: v2[1]!, draftId: v2[2]!, kind: v2[3] as 'PAYMENT' | 'CHAT',
      ordinal: Number(v2[4]), uploadId: v2[5]!, contentSha256: v2[6]!,
      mimeType: v2[7] === 'jpg' ? 'image/jpeg' : 'image/png', size: bytes.length, generation: '1',
    }
  }
  const legacy = /^drafts\/([^/]+)\/(PAYMENT|CHAT)\/([a-f0-9]{64})\.(jpg|png)$/.exec(objectKey)
  if (!legacy) throw new Error('invalid staging key fixture')
  return {
    version: 1, objectKey, draftId: legacy[1]!, kind: legacy[2] as 'PAYMENT' | 'CHAT',
    contentSha256: legacy[3]!, mimeType: legacy[4] === 'jpg' ? 'image/jpeg' : 'image/png',
    size: bytes.length, generation: '1',
  }
}

function taskInput(attempt: number, draft = queuedDraft()) {
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
