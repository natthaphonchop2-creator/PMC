import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { bookingPayloadHash } from '../../server/pmc-mini-app/bookingDraft'
import {
  createGoogleMiniAppStore,
  type MiniAppRequestRecord,
} from '../../server/pmc-mini-app/store'

describe('PMC Mini App Sheet store', () => {
  it('round-trips asynchronous booking request fields', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft({
      paymentEvidenceObjectKeys: ['payments/request-1/payment-1.jpg'],
      chatEvidenceObjectKeys: ['chats/request-1/chat-1.jpg'],
      taskName: 'projects/p/tasks/123',
      queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:01:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z',
      lastProgressAt: '2026-08-28T02:02:00.000Z',
      attemptCount: 2,
    })

    await store.createDraft(draft)

    expect(await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')).toMatchObject({
      paymentEvidenceObjectKeys: ['payments/request-1/payment-1.jpg'],
      chatEvidenceObjectKeys: ['chats/request-1/chat-1.jpg'],
      taskName: 'projects/p/tasks/123',
      queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:01:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z',
      lastProgressAt: '2026-08-28T02:02:00.000Z',
      attemptCount: 2,
    })
  })

  it('normalizes missing asynchronous fields from a legacy request row', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('MINI_APP_REQUESTS', [[
      'request-1', 'draft-1', 'staff-active', 'line-user-hash', 'READY_TO_CONFIRM', '', 1, '',
      'ไม่ระบุ', 'ลูกค้า ทดสอบ', 'Facebook Test', '0812345678', 'doctor-1', 'service-1', 'NORMAL',
      '2026-09-01', '13:00', 900, 'channel-1', '["payment-1"]', '["chat-1"]', 2,
      '2026-08-27T10:00:00.000Z', '', '', '', '', '2026-08-27T10:00:00.000Z',
    ]])

    const draft = await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')

    expect(draft).toMatchObject({
      paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
      processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    })
  })

  it('claims one confirmation and returns the persisted case after a restart', async () => {
    const sheets = new MemorySheets()
    const firstStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await firstStore.createDraft(validDraft())

    expect((await firstStore.claimConfirmation('request-1', 'hash-1')).claimed).toBe(true)
    await firstStore.completeConfirmation('request-1', 'PMC-202608-0001', '2026-08-27T10:05:00.000Z', 'CONFIRMED')

    const restartedStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    expect(await restartedStore.claimConfirmation('request-1', 'hash-1')).toEqual({
      claimed: false,
      caseId: 'PMC-202608-0001',
      status: 'CONFIRMED',
    })
    expect((await restartedStore.getDraft('draft-1'))?.state).toBe('CONFIRMED')
  })

  it('rejects a conflicting confirmation payload and stale draft version', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({ payloadHash: 'hash-1' }))

    await expect(store.claimConfirmation('request-1', 'hash-2')).rejects.toThrow('PAYLOAD_HASH_CONFLICT')
    await expect(store.updateDraft('draft-1', 0, { aeName: 'แวว' })).rejects.toThrow('STALE_DRAFT_VERSION')
  })

  it('resumes only the newest valid active draft owned by the staff member', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({ draftId: 'draft-old', requestId: 'request-old', state: 'DRAFT', updatedAt: '2026-08-27T10:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-other', requestId: 'request-other', staffId: 'staff-other', updatedAt: '2026-08-28T12:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-invalid', requestId: 'request-invalid', state: 'QUEUED', updatedAt: 'not-a-date' }))
    await store.createDraft(validDraft({ draftId: 'draft-terminal', requestId: 'request-terminal', state: 'CONFIRMED', updatedAt: '2026-08-29T12:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-review', requestId: 'request-review', state: 'NEEDS_REVIEW', updatedAt: '2026-08-28T11:00:00.000Z' }))

    await expect(store.getLatestActiveDraftByStaff('staff-active')).resolves.toMatchObject({
      draftId: 'draft-review', requestId: 'request-review', staffId: 'staff-active', state: 'NEEDS_REVIEW',
    })
    await expect(store.getLatestActiveDraftByStaff('staff-missing')).resolves.toBeNull()
  })

  it('queues a ready draft once with matching payload and task identity', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft()
    const payloadHash = bookingPayloadHash(draft)
    await store.createDraft(draft)

    const queued = await store.queueDraft(
      'request-1', payloadHash, 'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1', '2026-08-28T02:00:00.000Z',
    )
    const replay = await store.queueDraft(
      'request-1', payloadHash, queued.taskName!, '2026-08-28T02:01:00.000Z',
    )

    expect(queued).toMatchObject({
      state: 'QUEUED', payloadHash, queuedAt: '2026-08-28T02:00:00.000Z', updatedAt: '2026-08-28T02:00:00.000Z', version: 2,
    })
    expect(replay).toEqual(queued)
    await expect(store.queueDraft('request-1', 'wrong-hash', queued.taskName!, '2026-08-28T02:02:00.000Z'))
      .rejects.toThrow('PAYLOAD_HASH_CONFLICT')
  })

  it('claims a queued draft with the first processing lease and one attempt', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft()
    await store.createDraft(draft)
    await store.queueDraft(
      draft.requestId,
      bookingPayloadHash(draft),
      'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1',
      '2026-08-28T02:00:00.000Z',
    )

    await expect(store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:01:00.000Z', leaseUntil: '2026-08-28T02:06:00.000Z',
    })).resolves.toMatchObject({
      claimed: true,
      draft: {
        state: 'PROCESSING', processingStartedAt: '2026-08-28T02:01:00.000Z',
        processingLeaseUntil: '2026-08-28T02:06:00.000Z', lastProgressAt: '2026-08-28T02:01:00.000Z', attemptCount: 1, version: 3,
      },
    })
  })

  it('claims only the matching unbound ready draft when task delivery wins the queue update race', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())

    await expect(store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-other', nowIso: '2026-08-28T02:01:00.000Z', leaseUntil: '2026-08-28T02:06:00.000Z',
    })).rejects.toThrow('ASYNC_TASK_IDENTITY_CONFLICT')

    await expect(store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:01:00.000Z', leaseUntil: '2026-08-28T02:06:00.000Z',
    })).resolves.toMatchObject({ claimed: true, draft: { requestId: 'request-1', draftId: 'draft-1', state: 'PROCESSING' } })
  })

  it('reconciles queue identity without regressing processing when task delivery wins the Sheet update race', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft()
    const payloadHash = bookingPayloadHash(draft)
    const taskName = 'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1'
    await store.createDraft(draft)

    const claimed = await store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:00:01.000Z', leaseUntil: '2026-08-28T02:05:01.000Z',
    })
    const reconciled = await store.queueDraft('request-1', payloadHash, taskName, '2026-08-28T02:00:00.000Z')

    expect(claimed).toMatchObject({ claimed: true, draft: { state: 'PROCESSING', taskName: null, version: 2 } })
    expect(reconciled).toMatchObject({
      state: 'PROCESSING', payloadHash, taskName, queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:00:01.000Z', processingLeaseUntil: '2026-08-28T02:05:01.000Z', attemptCount: 1, version: 3,
    })
  })

  it('keeps the bound submission hash when queue reconciliation follows processing progress', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft()
    const payloadHash = bookingPayloadHash(draft)
    const taskName = 'projects/project-1/locations/asia-southeast1/queues/queue-1/tasks/request-1'
    await store.createDraft(draft)
    const claimed = await store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:00:01.000Z', leaseUntil: '2026-08-28T02:05:01.000Z',
    })
    await store.updateProcessingProjection({
      requestId: 'request-1', expectedAttempt: claimed.draft.attemptCount, expectedVersion: claimed.draft.version,
      nowIso: '2026-08-28T02:00:02.000Z', patch: { paymentEvidenceFileIds: ['verified-drive-payment'] },
    })

    await expect(store.queueDraft('request-1', payloadHash, taskName, '2026-08-28T02:00:00.000Z')).resolves.toMatchObject({
      state: 'PROCESSING', payloadHash, taskName, paymentEvidenceFileIds: ['verified-drive-payment'],
    })
  })

  it('blocks a live lease and reclaims only after expiry while preserving the first processing time', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({
      state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:05:00.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    }))

    const live = await store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:04:59.000Z', leaseUntil: '2026-08-28T02:09:59.000Z',
    })
    const reclaimed = await store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:05:00.000Z', leaseUntil: '2026-08-28T02:10:00.000Z',
    })

    expect(live).toMatchObject({ claimed: false, draft: { attemptCount: 1, version: 1 } })
    expect(reclaimed).toMatchObject({
      claimed: true,
      draft: {
        processingStartedAt: '2026-08-28T02:00:00.000Z', processingLeaseUntil: '2026-08-28T02:10:00.000Z',
        lastProgressAt: '2026-08-28T02:05:00.000Z', attemptCount: 2, version: 2,
      },
    })
  })

  it('reclaims a retry using its persisted submission hash after projection fields changed', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const payloadHash = bookingPayloadHash(validDraft())
    await store.createDraft(validDraft({
      state: 'RETRYING', payloadHash, taskName: 'projects/p/tasks/request-1',
      paymentEvidenceFileIds: ['verified-drive-payment'], processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: null, lastProgressAt: '2026-08-28T02:01:00.000Z', attemptCount: 1,
    }))

    await expect(store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:02:00.000Z', leaseUntil: '2026-08-28T02:07:00.000Z',
    })).resolves.toMatchObject({ claimed: true, draft: { state: 'PROCESSING', payloadHash, attemptCount: 2 } })
  })

  it('serializes concurrent claims so only one worker obtains the live lease', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({ state: 'QUEUED', payloadHash: bookingPayloadHash(validDraft()), taskName: 'projects/p/tasks/request-1' }))

    const claims = await Promise.all([
      store.claimProcessing({ requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:01:00.000Z', leaseUntil: '2026-08-28T02:06:00.000Z' }),
      store.claimProcessing({ requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:01:01.000Z', leaseUntil: '2026-08-28T02:06:01.000Z' }),
    ])

    expect(claims.map(({ claimed }) => claimed).sort()).toEqual([false, true])
    expect((await store.getDraft('draft-1'))?.attemptCount).toBe(1)
  })

  it('records retry progress and moves the eighth failed claim to operator review', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({
      state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    }))

    const retrying = await store.markAsyncRetry({
      requestId: 'request-1', safeErrorCode: 'EVIDENCE_COPY_RETRY', nowIso: '2026-08-28T02:01:00.000Z',
      expectedAttempt: 1, expectedVersion: 1,
    })
    expect(retrying).toMatchObject({
      state: 'RETRYING', safeErrorCode: 'EVIDENCE_COPY_RETRY', processingLeaseUntil: null,
      lastProgressAt: '2026-08-28T02:01:00.000Z', updatedAt: '2026-08-28T02:01:00.000Z', attemptCount: 1, version: 2,
    })

    await store.createDraft(validDraft({
      requestId: 'request-8', draftId: 'draft-8', state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 8,
    }))
    await expect(store.markAsyncRetry({
      requestId: 'request-8', safeErrorCode: 'RETRY_EXHAUSTED', nowIso: '2026-08-28T02:01:00.000Z',
      expectedAttempt: 8, expectedVersion: 1,
    })).resolves.toMatchObject({
      state: 'NEEDS_REVIEW', safeErrorCode: 'RETRY_EXHAUSTED', processingLeaseUntil: null,
    })
  })

  it('rejects retry and completion from a stale worker after another worker reclaims the lease', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({
      state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:05:00.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    }))
    const reclaimed = await store.claimProcessing({
      requestId: 'request-1', draftId: 'draft-1', nowIso: '2026-08-28T02:05:00.000Z', leaseUntil: '2026-08-28T02:10:00.000Z',
    })

    await expect(store.markAsyncRetry({
      requestId: 'request-1', safeErrorCode: 'STALE_WORKER_RETRY', nowIso: '2026-08-28T02:06:00.000Z',
      expectedAttempt: 1, expectedVersion: 1,
    })).rejects.toThrow('STALE_PROCESSING_LEASE')
    await expect(store.completeAsyncBooking({
      requestId: 'request-1', caseId: 'PMC-202608-0001', status: 'CONFIRMED', projectionState: 'CONFIRMED',
      nowIso: '2026-08-28T02:06:00.000Z', expectedAttempt: 1, expectedVersion: 1,
    })).rejects.toThrow('STALE_PROCESSING_LEASE')
    expect(await store.getDraft('draft-1')).toEqual(reclaimed.draft)

    const retried = await store.markAsyncRetry({
      requestId: 'request-1', safeErrorCode: 'CURRENT_WORKER_RETRY', nowIso: '2026-08-28T02:06:00.000Z',
      expectedAttempt: reclaimed.draft.attemptCount, expectedVersion: reclaimed.draft.version,
    })
    await expect(store.markAsyncRetry({
      requestId: 'request-1', safeErrorCode: 'STALE_WORKER_RETRY', nowIso: '2026-08-28T02:06:01.000Z',
      expectedAttempt: 1, expectedVersion: 1,
    })).rejects.toThrow('STALE_PROCESSING_LEASE')
    expect(await store.getDraft('draft-1')).toEqual(retried)
  })

  it.each([
    ['state', { state: 'DRAFT' }],
    ['customer identity', { customerName: 'ลูกค้าอื่น' }],
    ['ordered evidence', { paymentEvidenceObjectKeys: ['drafts/draft-1/PAYMENT/other.jpg'] }],
  ] as const)('rejects generic %s mutation after processing identity is bound', async (_label, patch) => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const original = validDraft({
      state: 'PROCESSING', payloadHash: bookingPayloadHash(validDraft()),
      processingStartedAt: '2026-08-28T02:00:00.000Z', processingLeaseUntil: '2026-08-28T02:05:00.000Z',
      lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    })
    await store.createDraft(original)

    await expect(store.updateDraft('draft-1', 1, patch)).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(original)
  })

  it('rejects generic terminal-state regression without a no-op write', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const terminal = validDraft({
      state: 'CONFIRMED', payloadHash: bookingPayloadHash(validDraft()), version: 4,
      confirmedAt: '2026-08-28T02:01:00.000Z', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    })
    await store.createDraft(terminal)

    await expect(store.updateDraft('draft-1', 4, { state: 'READY_TO_CONFIRM' })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(terminal)
  })

  it('cancels a bound failed synchronous confirmation and then marks retention pending', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())
    const claimed = await store.claimConfirmation('request-1', 'hash-1')
    if (!claimed.claimed) throw new Error('expected confirmation claim')
    const failed = await store.failConfirmation('request-1', 'BOOKING_RETRY', '2026-08-28T02:01:00.000Z')

    const cancelled = await store.updateDraft('draft-1', failed.version, {
      state: 'CANCELLED', updatedAt: '2026-08-28T02:02:00.000Z',
    })
    const retained = await store.markRetentionPending('draft-1', cancelled.version, '2026-08-28T02:03:00.000Z')

    expect(cancelled).toMatchObject({
      state: 'CANCELLED', payloadHash: 'hash-1', safeErrorCode: 'BOOKING_RETRY',
      updatedAt: '2026-08-28T02:02:00.000Z', version: 4,
    })
    expect(retained).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', payloadHash: 'hash-1',
      updatedAt: '2026-08-28T02:03:00.000Z', version: 5,
    })
  })

  it('rejects a failed-confirmation cancel patch that also changes customer identity', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())
    const claimed = await store.claimConfirmation('request-1', 'hash-1')
    if (!claimed.claimed) throw new Error('expected confirmation claim')
    const failed = await store.failConfirmation('request-1', 'BOOKING_RETRY', '2026-08-28T02:01:00.000Z')

    await expect(store.updateDraft('draft-1', failed.version, {
      state: 'CANCELLED', customerName: 'ลูกค้าอื่น', updatedAt: '2026-08-28T02:02:00.000Z',
    })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(failed)
  })

  it.each([
    'PROCESSING', 'RETRYING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'EXPIRED',
  ] as const)('keeps generic cancellation blocked from protected %s state', async (state) => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const protectedDraft = validDraft({ state, payloadHash: 'hash-1', version: 3 })
    await store.createDraft(protectedDraft)

    await expect(store.updateDraft('draft-1', 3, {
      state: 'CANCELLED', updatedAt: '2026-08-28T02:02:00.000Z',
    })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(protectedDraft)
  })

  it('updates processing projections only for the current attempt and version', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({
      state: 'PROCESSING', payloadHash: bookingPayloadHash(validDraft()),
      processingStartedAt: '2026-08-28T02:00:00.000Z', processingLeaseUntil: '2026-08-28T02:05:00.000Z',
      lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 2,
    }))

    await expect(store.updateProcessingProjection({
      requestId: 'request-1', expectedAttempt: 2, expectedVersion: 1, nowIso: '2026-08-28T02:01:00.000Z',
      patch: { paymentEvidenceFileIds: ['drive-payment'], chatEvidenceFileIds: ['drive-chat'], evidenceCount: 2 },
    })).resolves.toMatchObject({
      state: 'PROCESSING', paymentEvidenceFileIds: ['drive-payment'], chatEvidenceFileIds: ['drive-chat'], evidenceCount: 2,
      attemptCount: 2, lastProgressAt: '2026-08-28T02:01:00.000Z', updatedAt: '2026-08-28T02:01:00.000Z', version: 2,
    })
  })

  it('rejects stale or unknown processing projection mutations without a write', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const original = validDraft({
      state: 'PROCESSING', payloadHash: bookingPayloadHash(validDraft()), version: 3,
      processingStartedAt: '2026-08-28T02:00:00.000Z', processingLeaseUntil: '2026-08-28T02:05:00.000Z',
      lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 2,
    })
    await store.createDraft(original)

    await expect(store.updateProcessingProjection({
      requestId: 'request-1', expectedAttempt: 1, expectedVersion: 3, nowIso: '2026-08-28T02:01:00.000Z', patch: {},
    })).rejects.toThrow('STALE_PROCESSING_LEASE')
    await expect(store.updateProcessingProjection({
      requestId: 'request-1', expectedAttempt: 2, expectedVersion: 2, nowIso: '2026-08-28T02:01:00.000Z', patch: {},
    })).rejects.toThrow('STALE_PROCESSING_LEASE')
    await expect(store.updateProcessingProjection({
      requestId: 'request-1', expectedAttempt: 2, expectedVersion: 3, nowIso: '2026-08-28T02:01:00.000Z',
      patch: { customerName: 'ห้ามแก้' } as never,
    })).rejects.toThrow('INVALID_PROCESSING_PROJECTION_PATCH')
    expect(await store.getDraft('draft-1')).toEqual(original)
  })

  it('completes once and never regresses a terminal async state', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({
      state: 'PROCESSING', processingStartedAt: '2026-08-28T02:00:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z', lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    }))
    const completion = {
      requestId: 'request-1', caseId: 'PMC-202608-0001', status: 'CONFIRMED' as const,
      projectionState: 'CONFIRMED_WITH_RETRY' as const, nowIso: '2026-08-28T02:01:00.000Z', expectedAttempt: 1, expectedVersion: 1,
    }

    const completed = await store.completeAsyncBooking(completion)
    const replayed = await store.completeAsyncBooking({ ...completion, nowIso: '2026-08-28T02:02:00.000Z' })
    const lateRetry = await store.markAsyncRetry({
      requestId: 'request-1', safeErrorCode: 'LATE_RETRY', nowIso: '2026-08-28T02:03:00.000Z',
      expectedAttempt: completed.attemptCount, expectedVersion: completed.version,
    })

    expect(completed).toMatchObject({
      state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      confirmedAt: '2026-08-28T02:01:00.000Z', processingLeaseUntil: null, safeErrorCode: null, version: 2,
    })
    expect(replayed).toEqual(completed)
    expect(lateRetry).toEqual(completed)
  })

  it('marks cancelled evidence for approval-bound retention without deleting IDs', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())

    const updated = await store.markRetentionPending('draft-1', 1, '2026-08-27T10:06:00.000Z')

    expect(updated).toMatchObject({
      retentionState: 'PENDING_APPROVAL',
      paymentEvidenceFileIds: ['payment-1'],
      chatEvidenceFileIds: ['chat-1'],
    })
  })

  it('resolves only active staff from the canonical LINE mapping', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-active', 'มัส', 'staff@example.com', 'Uactive', true, true, true, 'https://example.com/profile.png'],
      ['staff-inactive', 'เก่า', 'old@example.com', 'Uinactive', true, true, false, ''],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveStaffByLineUserId('Uactive')).resolves.toMatchObject({ id: 'staff-active', name: 'มัส', active: true })
    await expect(store.getActiveStaffByLineUserId('Uinactive')).resolves.toBeNull()
  })

  it('reads canManageStock from the ninth CONFIG_STAFF column', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-stock', 'สต็อก', 'stock@example.com', 'Ustock', true, false, true, '', true],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Ustock'))
      .resolves.toMatchObject({ id: 'staff-stock', canManageStock: true })
  })

  it('defaults canManageStock to false for legacy eight-column CONFIG_STAFF rows', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-legacy', 'เดิม', 'legacy@example.com', 'Ulegacy', true, false, true, ''],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Ulegacy'))
      .resolves.toMatchObject({ id: 'staff-legacy', canManageStock: false })
  })

  it('lists only unlinked booking staff and links each LINE account exactly once', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-open', 'มัส', 'open@example.com', '', true, true, true, ''],
      ['staff-second', 'หมวย', 'second@example.com', '', true, true, true, ''],
      ['staff-linked', 'มิ้น', 'linked@example.com', 'Uexisting', true, true, true, ''],
      ['staff-ae-only', 'เออี', 'ae@example.com', '', false, true, true, ''],
      ['staff-inactive', 'เก่า', 'old@example.com', '', true, true, false, ''],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.listUnlinkedBookingStaff()).resolves.toEqual([
      { id: 'staff-open', name: 'มัส' },
      { id: 'staff-second', name: 'หมวย' },
    ])
    await expect(store.linkLineUserToStaff('staff-open', 'Unew')).resolves.toMatchObject({ id: 'staff-open', name: 'มัส' })
    await expect(store.getActiveStaffByLineUserId('Unew')).resolves.toMatchObject({ id: 'staff-open', name: 'มัส' })
    await expect(store.linkLineUserToStaff('staff-open', 'Uother')).rejects.toThrow('STAFF_ALREADY_LINKED')
    await expect(store.linkLineUserToStaff('staff-second', 'Unew')).rejects.toThrow('LINE_USER_ALREADY_LINKED')
  })

  it('persists PIN attempt lockout across store restarts', async () => {
    const sheets = new MemorySheets()
    const firstStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const start = '2026-08-28T01:00:00.000Z'

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(firstStore.consumeEnrollmentAttempt('line-user-hash', false, start)).resolves.toEqual({
        allowed: false, retryAfterSeconds: 0,
      })
    }
    await expect(firstStore.consumeEnrollmentAttempt('line-user-hash', false, start)).resolves.toEqual({
      allowed: false, retryAfterSeconds: 900,
    })

    const restartedStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await expect(restartedStore.consumeEnrollmentAttempt('line-user-hash', true, '2026-08-28T01:05:00.000Z')).resolves.toEqual({
      allowed: false, retryAfterSeconds: 600,
    })
    await expect(restartedStore.consumeEnrollmentAttempt('line-user-hash', true, '2026-08-28T01:16:00.000Z')).resolves.toEqual({
      allowed: true, retryAfterSeconds: 0,
    })
  })

  it('projects only active booking choices without operational identifiers', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-ae', 'มัส', 'private@example.com', 'Uprivate', true, true, true, 'https://example.com/private.png'],
      ['staff-unlinked-ae', 'หมวย', 'unlinked@example.com', '', true, true, true, ''],
      ['staff-old', 'เก่า', 'old@example.com', 'Uold', true, true, false, ''],
    ])
    sheets.setTab('CONFIG_DOCTORS', [
      ['doctor-1', 'หมอ Benz', 'private-calendar', 'private-group', true],
      ['doctor-old', 'หมอเก่า', 'old-calendar', 'old-group', false],
    ])
    sheets.setTab('CONFIG_SERVICES', [
      ['service-1', 'เติมไขมัน', 60, true],
      ['service-old', 'ปิดบริการ', 30, false],
    ])
    sheets.setTab('CONFIG_CHANNELS', [
      ['channel-1', 'เพจTAB', true],
      ['channel-old', 'ปิดช่องทาง', false],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveBookingConfig()).resolves.toEqual({
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      aes: [{ id: 'staff-ae', name: 'มัส' }, { id: 'staff-unlinked-ae', name: 'หมวย' }],
    })
  })

  it('keeps allowlisted Thai names as canonical doctor, service, and channel IDs', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_DOCTORS', [['หมอ Benz', 'หมอ Benz', 'private-calendar', 'private-group', true]])
    sheets.setTab('CONFIG_SERVICES', [['เติมไขมัน', 'เติมไขมัน', 60, true]])
    sheets.setTab('CONFIG_CHANNELS', [['เพจหลัก', 'เพจหลัก', true]])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveBookingConfig()).resolves.toMatchObject({
      doctors: [{ id: 'หมอ Benz', name: 'หมอ Benz' }],
      services: [{ id: 'เติมไขมัน', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'เพจหลัก', name: 'เพจหลัก' }],
    })
  })
})

function validDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-active', lineUserIdHash: 'line-user-hash',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'ไม่ระบุ',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()

  setTab(tab: string, rows: unknown[][]): void { this.tabs.set(tab, structuredClone(rows)) }

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    return Object.fromEntries(ranges.map((range) => [range, structuredClone(this.tabs.get(tabName(range)) ?? [])]))
  }

  async append(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    const rowNumber = Number(range.match(/!(?:[A-Z]+)(\d+)/)?.[1] ?? 2)
    const index = Math.max(0, rowNumber - 2)
    const current = [...(this.tabs.get(tab) ?? [])]
    current[index] = structuredClone(rows[0] ?? [])
    this.tabs.set(tab, current)
  }

  async batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    for (const item of data) await this.update(spreadsheetId, item.range, item.values)
  }

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { return [] }
  async applyWorkbookRequests(): Promise<void> { return undefined }
}

function tabName(range: string): string {
  return range.split('!', 1)[0]!.replaceAll("'", '')
}
