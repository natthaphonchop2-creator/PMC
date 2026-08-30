import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  BookingPreparePersistenceError,
  persistPrepareEvidence,
  type PersistPrepareEvidenceInput,
} from '../../server/pmc-mini-app/bookingPrepare'
import type { EvidenceIngressPort } from '../../server/pmc-mini-app/evidenceIngressClient'
import type { DraftStateIngressPort } from '../../server/pmc-mini-app/draftStateIngressClient'
import type { EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import {
  canonicalMiniAppDraftProjection,
  type MiniAppDraftProjection,
  type MiniAppDraftStateMutation,
  type MiniAppDraftStateResult,
} from '../../shared/pmcMiniAppDraftState'
import type { MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'

describe('PMC Mini App Booking prepare persistence', () => {
  it('stages async evidence with at most four concurrent puts and writes one ordered ready draft', async () => {
    const fixture = prepareFixture('ASYNC')

    const result = await persistPrepareEvidence(fixture.input({
      paymentFiles: [png(1), png(2), png(3), png(4), png(5)],
      chatFiles: [jpeg(6), jpeg(7), jpeg(8)],
    }))

    expect(result.complete).toBe(true)
    expect(result.draft).toMatchObject({
      state: 'READY_TO_CONFIRM', retentionState: '', protocolVersion: 2,
      recorderName: 'มัส', adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
      customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', evidenceCount: 8,
    })
    expect(result.payment.map(({ value }) => value)).toEqual([
      objectKey('PAYMENT', png(1).bytes), objectKey('PAYMENT', png(2).bytes), objectKey('PAYMENT', png(3).bytes),
      objectKey('PAYMENT', png(4).bytes), objectKey('PAYMENT', png(5).bytes),
    ])
    expect(result.chat.map(({ value }) => value)).toEqual([
      objectKey('CHAT', jpeg(6).bytes), objectKey('CHAT', jpeg(7).bytes), objectKey('CHAT', jpeg(8).bytes),
    ])
    expect(result.payment[0]?.deterministicUploadId).toBe(stagedUploadId('PAYMENT', png(1).bytes))
    expect(fixture.staging?.maxActive()).toBe(4)
    expect(fixture.store.writeCount()).toBe(2)
    expect(fixture.store.directWriteCount()).toBe(0)
    expect(fixture.draftStateIngress.operations()).toEqual(['PREPARE_BEGIN', 'PREPARE_READY'])
  })

  it('recovers an exact retry after response loss without another remote write', async () => {
    const fixture = prepareFixture('ASYNC')
    fixture.draftStateIngress.loseNextResponse()
    const input = fixture.input()

    const first = await persistPrepareEvidence(input)
    const putsAfterFirst = fixture.staging!.putCount()
    const replay = await persistPrepareEvidence({ ...input, draft: fixture.store.read() })

    expect(first.draft).toEqual(replay.draft)
    expect(first.payment).toEqual(replay.payment)
    expect(first.chat).toEqual(replay.chat)
    expect(fixture.staging!.putCount()).toBe(putsAfterFirst)
    expect(fixture.store.writeCount()).toBe(2)
  })

  it.each(['ASYNC', 'SYNC'] as const)(
    'returns an exact reserved READY %s retry after mutable config removal without another remote write',
    async (mode) => {
      const fixture = prepareFixture(mode)
      const input = fixture.input({ paymentFiles: [png(1), png(2)], chatFiles: [jpeg(3)] })
      const first = await persistPrepareEvidence(input)
      const remoteCalls = mode === 'ASYNC' ? fixture.staging!.putCount() : fixture.ingress!.callCount()
      const remoteCreates = mode === 'ASYNC' ? fixture.staging!.createdCount() : fixture.ingress!.createdCount()
      const ownerCalls = fixture.draftStateIngress.callCount()

      const replay = await persistPrepareEvidence({
        ...input,
        draft: fixture.store.read(),
        bookingContext: removedAndRenamedBookingContext(),
      })

      expect(replay.draft).toEqual(first.draft)
      expect(mode === 'ASYNC' ? fixture.staging!.putCount() : fixture.ingress!.callCount()).toBe(remoteCalls)
      expect(mode === 'ASYNC' ? fixture.staging!.createdCount() : fixture.ingress!.createdCount()).toBe(remoteCreates)
      expect(fixture.draftStateIngress.callCount()).toBe(ownerCalls)

      await expect(persistPrepareEvidence({
        ...input,
        draft: fixture.store.read(),
        bookingContext: removedAndRenamedBookingContext(),
        input: { ...input.input, customerName: 'ลูกค้าคนอื่น' },
      })).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
      expect(mode === 'ASYNC' ? fixture.staging!.putCount() : fixture.ingress!.callCount()).toBe(remoteCalls)
    },
  )

  it.each(['ASYNC', 'SYNC'] as const)(
    'continues an exact reserved PARTIAL %s retry after mutable config removal without duplicate remote objects',
    async (mode) => {
      const fixture = prepareFixture(mode)
      const input = fixture.input({ paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4)] })
      if (mode === 'ASYNC') fixture.staging!.failOnce(objectKey('PAYMENT', png(2).bytes))
      else fixture.ingress!.failOnceAt(2)
      await expect(persistPrepareEvidence(input)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_RETRY' })
      const partial = fixture.store.read()

      await expect(persistPrepareEvidence({
        ...input,
        draft: partial,
        bookingContext: removedAndRenamedBookingContext(),
      })).resolves.toMatchObject({ draft: { state: 'READY_TO_CONFIRM', retentionState: '', evidenceCount: 4 } })

      expect(mode === 'ASYNC' ? fixture.staging!.createdCount() : fixture.ingress!.createdCount()).toBe(4)
      await expect(persistPrepareEvidence({
        ...input,
        draft: fixture.store.read(),
        bookingContext: removedAndRenamedBookingContext(),
        paymentFiles: [png(3), png(2), png(1)],
      })).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    },
  )

  it('performs zero remote writes after two lost PREPARE_BEGIN calls and lets a later exact retry reserve', async () => {
    const fixture = prepareFixture('ASYNC')
    const input = fixture.input()
    fixture.draftStateIngress.loseBeforeNextApplies(2)

    await expect(persistPrepareEvidence(input)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_RETRY' })
    expect(fixture.staging!.putCount()).toBe(0)
    expect(fixture.store.writeCount()).toBe(0)

    const recovered = await persistPrepareEvidence({ ...input, draft: fixture.store.read() })
    expect(recovered.draft).toMatchObject({ state: 'READY_TO_CONFIRM', evidenceCount: 2 })
    expect(fixture.draftStateIngress.operations()).toEqual([
      'PREPARE_BEGIN', 'PREPARE_BEGIN', 'PREPARE_BEGIN', 'PREPARE_READY',
    ])
  })

  it('stops before remote persistence when cancellation wins after BEGIN but before its response', async () => {
    const fixture = prepareFixture('ASYNC')
    fixture.draftStateIngress.afterBeginApply(() => fixture.store.commitTerminal('CANCELLED'))
    fixture.draftStateIngress.loseNextResponse()

    await expect(persistPrepareEvidence(fixture.input())).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(0)
    expect(fixture.store.read()).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', evidenceCount: 0,
      customerName: '', adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
      paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
      evidenceProjectionHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
  })

  it.each([
    ['changed payment bytes', (input: PersistPrepareEvidenceInput) => ({
      ...input, paymentFiles: [png(9)],
    })],
    ['changed evidence order', (input: PersistPrepareEvidenceInput) => ({
      ...input, paymentFiles: [png(2), png(1)],
    })],
    ['changed booking input', (input: PersistPrepareEvidenceInput) => ({
      ...input, input: { ...input.input, customerName: 'ลูกค้าอื่น' },
    })],
    ['changed base version', (input: PersistPrepareEvidenceInput) => ({
      ...input, version: input.version + 1,
    })],
  ] as const)('rejects %s after a durable prepare without touching remote evidence', async (_label, change) => {
    const fixture = prepareFixture('ASYNC')
    const initial = fixture.input({ paymentFiles: [png(1), png(2)] })
    await persistPrepareEvidence(initial)
    const puts = fixture.staging!.putCount()

    await expect(persistPrepareEvidence(change({ ...initial, draft: fixture.store.read() })))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(puts)
    expect(fixture.store.writeCount()).toBe(2)
  })

  it('persists only partial async references as non-ready retention state and reuses them on retry', async () => {
    const fixture = prepareFixture('ASYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4)] })
    fixture.staging!.failOnce(objectKey('PAYMENT', png(2).bytes))

    await expect(persistPrepareEvidence(input)).rejects.toMatchObject({
      code: 'BOOKING_PREPARE_RETRY', persistedReferenceCount: expect.any(Number),
    })
    const partial = fixture.store.read()
    expect(partial).toMatchObject({
      state: 'DRAFT', retentionState: 'PENDING_APPROVAL', customerName: '', facebookName: '',
    })
    expect(partial.evidenceCount).toBeGreaterThan(0)
    expect(partial.evidenceCount).toBeLessThan(4)
    expect(partial.evidenceProjectionHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(fixture.store.directWriteCount()).toBe(0)

    const createdBeforeRetry = fixture.staging!.createdCount()
    const recovered = await persistPrepareEvidence({ ...input, draft: partial })

    expect(recovered.draft).toMatchObject({ state: 'READY_TO_CONFIRM', retentionState: '', evidenceCount: 4 })
    expect(fixture.staging!.createdCount()).toBe(4)
    expect(fixture.staging!.createdCount()).toBeGreaterThan(createdBeforeRetry)
    expect(fixture.store.writeCount()).toBe(3)
  })

  it('rejects changed input against a partially persisted binding before retrying remote evidence', async () => {
    const fixture = prepareFixture('ASYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2), png(3)] })
    fixture.staging!.failOnce(objectKey('PAYMENT', png(2).bytes))
    await expect(persistPrepareEvidence(input)).rejects.toBeInstanceOf(BookingPreparePersistenceError)
    const puts = fixture.staging!.putCount()

    await expect(persistPrepareEvidence({
      ...input,
      draft: fixture.store.read(),
      input: { ...input.input, facebookName: 'Changed Facebook' },
    })).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(puts)
  })

  it.each([
    ['different normalized input', (input: PersistPrepareEvidenceInput) => ({
      ...input, input: { ...input.input, customerName: 'ลูกค้าคนละราย' },
    })],
    ['different bytes', (input: PersistPrepareEvidenceInput) => ({
      ...input, paymentFiles: [png(1), png(9), png(3)],
    })],
    ['different order', (input: PersistPrepareEvidenceInput) => ({
      ...input, paymentFiles: [png(3), png(2), png(1)],
    })],
  ] as const)('lets the first PREPARE_BEGIN reservation win against concurrent %s', async (_label, change) => {
    const fixture = prepareFixture('ASYNC')
    const initial = fixture.input({ paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4)] })
    const competingStaging = new DeferredStaging()
    const competing = change({
      ...initial,
      persistence: { type: 'ASYNC' as const, staging: competingStaging },
    })
    const competingResult = persistPrepareEvidence(competing)
    await competingStaging.entered()

    await expect(persistPrepareEvidence(initial)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(0)
    competingStaging.release()

    await expect(competingResult).resolves.toMatchObject({ draft: { state: 'READY_TO_CONFIRM' } })
    expect(fixture.store.read()).toMatchObject({ state: 'READY_TO_CONFIRM', evidenceCount: 4 })
    expect(fixture.store.writeCount()).toBe(2)
  })

  it('keeps a partial base-version binding authoritative over a changed recovery version', async () => {
    const fixture = prepareFixture('ASYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2), png(3)] })
    fixture.staging!.failOnce(objectKey('PAYMENT', png(2).bytes))
    await expect(persistPrepareEvidence(input)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_RETRY' })
    const authoritative = fixture.store.read()
    const puts = fixture.staging!.putCount()

    await expect(persistPrepareEvidence({ ...input, draft: authoritative, version: 2 }))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.store.read()).toEqual(authoritative)
    expect(fixture.staging!.putCount()).toBe(puts)
  })

  it('rejects an unbound legacy Drive reference before uploading arbitrary new sync bytes', async () => {
    const fixture = prepareFixture('SYNC', {
      paymentEvidenceFileIds: ['legacy-file-01'], evidenceCount: 1, evidenceProjectionHash: null,
    })

    await expect(persistPrepareEvidence(fixture.input({ paymentFiles: [png(9)] })))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.ingress!.callCount()).toBe(0)
    expect(fixture.store.writeCount()).toBe(0)
  })

  it('rejects an unbound legacy staged object before any async remote call', async () => {
    const fixture = prepareFixture('ASYNC', {
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', png(1).bytes)],
      evidenceCount: 1,
      evidenceProjectionHash: null,
    })

    await expect(persistPrepareEvidence(fixture.input({ paymentFiles: [png(1)] })))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(0)
    expect(fixture.store.writeCount()).toBe(0)
  })

  it('serializes synchronous Apps Script ingress and writes only one final ready draft', async () => {
    const fixture = prepareFixture('SYNC')

    const result = await persistPrepareEvidence(fixture.input({
      paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4), jpeg(5)],
    }))

    expect(result.draft).toMatchObject({ state: 'READY_TO_CONFIRM', evidenceCount: 5 })
    expect(result.payment.map(({ storage }) => storage)).toEqual(['DRIVE_FILE', 'DRIVE_FILE', 'DRIVE_FILE'])
    expect(fixture.ingress?.maxActive()).toBe(1)
    expect(fixture.ingress?.callCount()).toBe(5)
    expect(fixture.store.writeCount()).toBe(2)
  })

  it('recovers synchronous partial failure by reusing deterministic Drive files', async () => {
    const fixture = prepareFixture('SYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2)], chatFiles: [jpeg(3), jpeg(4)] })
    fixture.ingress!.failOnceAt(3)

    await expect(persistPrepareEvidence(input)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_RETRY' })
    const partial = fixture.store.read()
    expect(partial).toMatchObject({ state: 'DRAFT', retentionState: 'PENDING_APPROVAL', evidenceCount: 2 })

    const recovered = await persistPrepareEvidence({ ...input, draft: partial })

    expect(recovered.draft).toMatchObject({ state: 'READY_TO_CONFIRM', retentionState: '', evidenceCount: 4 })
    expect(fixture.ingress!.createdCount()).toBe(4)
    expect(fixture.ingress!.maxActive()).toBe(1)
    expect(fixture.store.writeCount()).toBe(3)
  })

  it('retains every async object without reopening when cancellation overtakes in-flight staging', async () => {
    const fixture = prepareFixture('ASYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4)] })
    fixture.draftStateIngress.loseBeforeOperation('PREPARE_READY', 2)
    fixture.staging!.afterFirstCreate(() => fixture.store.commitTerminal('CANCELLED'))

    await expect(persistPrepareEvidence(input)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_RETRY' })

    const pendingTerminal = fixture.store.read()
    expect(pendingTerminal).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', evidenceCount: 0,
      evidenceProjectionHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    const putsBeforeChanged = fixture.staging!.putCount()
    await expect(persistPrepareEvidence({
      ...input, draft: pendingTerminal, input: { ...input.input, customerName: 'ลูกค้าคนอื่น' },
    })).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.staging!.putCount()).toBe(putsBeforeChanged)

    await expect(persistPrepareEvidence({ ...input, draft: pendingTerminal }))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })

    const terminal = fixture.store.read()
    expect(terminal).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', evidenceCount: 4,
      customerName: '', facebookName: '', adminId: 'ADMIN_02', adminName: 'แวว',
    })
    expect(terminal.paymentEvidenceObjectKeys).toEqual([
      objectKey('PAYMENT', png(1).bytes), objectKey('PAYMENT', png(2).bytes), objectKey('PAYMENT', png(3).bytes),
    ])
    expect(terminal.chatEvidenceObjectKeys).toEqual([objectKey('CHAT', jpeg(4).bytes)])
    expect(fixture.staging!.createdCount()).toBe(4)
    const puts = fixture.staging!.putCount()
    const writes = fixture.store.writeCount()

    await expect(persistPrepareEvidence({ ...input, draft: terminal }))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.store.read()).toEqual(terminal)
    expect(fixture.staging!.putCount()).toBe(puts)
    expect(fixture.store.writeCount()).toBe(writes)
  })

  it('retains every synchronous Drive file without reopening when expiry overtakes the final mutation', async () => {
    const fixture = prepareFixture('SYNC')
    const input = fixture.input({ paymentFiles: [png(1), png(2)], chatFiles: [jpeg(3), jpeg(4)] })
    fixture.draftStateIngress.loseNextResponse()
    const finalWrite = fixture.draftStateIngress.pauseBeforeOperation('PREPARE_READY')
    const result = persistPrepareEvidence(input)
    await finalWrite.entered
    fixture.store.commitTerminal('EXPIRED')
    finalWrite.release()

    await expect(result).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    const terminal = fixture.store.read()
    expect(terminal).toMatchObject({
      state: 'EXPIRED', retentionState: 'PENDING_APPROVAL', evidenceCount: 4,
      customerName: '', facebookName: '', adminId: 'ADMIN_02', adminName: 'แวว',
      paymentEvidenceFileIds: ['drive-file-01', 'drive-file-02'],
      chatEvidenceFileIds: ['drive-file-03', 'drive-file-04'],
    })
    expect(fixture.draftStateIngress.callCount()).toBe(2)
    const calls = fixture.ingress!.callCount()
    const writes = fixture.store.writeCount()

    await expect(persistPrepareEvidence({ ...input, draft: terminal }))
      .rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })
    expect(fixture.store.read()).toEqual(terminal)
    expect(fixture.ingress!.callCount()).toBe(calls)
    expect(fixture.store.writeCount()).toBe(writes)
  })

  it.each(['CANCELLED', 'EXPIRED'] as const)('keeps %s evidence pending approval without remote or draft mutation', async (state) => {
    const fixture = prepareFixture('ASYNC', { state, retentionState: 'PENDING_APPROVAL' })

    await expect(persistPrepareEvidence(fixture.input())).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })

    expect(fixture.staging!.putCount()).toBe(0)
    expect(fixture.store.writeCount()).toBe(0)
    expect(fixture.store.read()).toMatchObject({ state, retentionState: 'PENDING_APPROVAL' })
  })
})

describe('PMC Mini App Booking prepare HTTP route', () => {
  it.each(['SYNC', 'ASYNC'] as const)('authenticates and snapshots once before one owner-prepared %s response', async (mode) => {
    const fixture = prepareFixture(mode)
    const identity: LineIdentityPort = { verify: async () => ({ lineUserId: 'Uactive' }) }
    const response = await invokePrepare(createPmcMiniAppMiddleware({
      config: routeConfig(mode), identity, store: fixture.store,
      evidenceIngress: fixture.ingress ?? undefined,
      evidenceStaging: fixture.staging ?? undefined,
      draftStateIngress: fixture.draftStateIngress,
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    }))

    expect(response).toMatchObject({ status: 200, body: { state: 'READY_TO_CONFIRM', version: 3 } })
    expect(fixture.store.staffReadCount()).toBe(1)
    expect(fixture.store.draftReadCount()).toBe(1)
    expect(fixture.store.configReadCount()).toBe(1)
    expect(fixture.store.directWriteCount()).toBe(0)
    expect(fixture.draftStateIngress.operations()).toEqual(['PREPARE_BEGIN', 'PREPARE_READY'])
  })

  it('keeps the route unavailable when prepare capability is false without consuming the body', async () => {
    const fixture = prepareFixture('SYNC')
    const config = routeConfig('SYNC')
    config.bookingProtocol.prepare = false
    const response = await invokePrepare(createPmcMiniAppMiddleware({
      config,
      identity: { verify: async () => ({ lineUserId: 'Uactive' }) },
      store: fixture.store,
      evidenceIngress: fixture.ingress!,
      draftStateIngress: fixture.draftStateIngress,
    }))

    expect(response).toEqual({ status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' } })
    expect(fixture.store.staffReadCount()).toBe(0)
    expect(fixture.store.draftReadCount()).toBe(0)
    expect(fixture.ingress!.callCount()).toBe(0)
  })

  it('applies the maintenance barrier before authentication, multipart parsing, or external effects', async () => {
    const fixture = prepareFixture('SYNC')
    const config = routeConfig('SYNC')
    config.bookingMutationsPaused = true
    const response = await invokePrepare(createPmcMiniAppMiddleware({
      config,
      identity: { verify: async () => ({ lineUserId: 'Uactive' }) },
      store: fixture.store,
      evidenceIngress: fixture.ingress!,
      draftStateIngress: fixture.draftStateIngress,
    }))

    expect(response).toEqual({ status: 503, body: { error: 'BOOKING_MUTATIONS_PAUSED' } })
    expect(fixture.store.staffReadCount()).toBe(0)
    expect(fixture.store.draftReadCount()).toBe(0)
    expect(fixture.ingress!.callCount()).toBe(0)
  })

  it('serializes protocol-2 cancellation through the owner ingress and recovers a lost response', async () => {
    const fixture = prepareFixture('SYNC')
    fixture.draftStateIngress.loseNextResponse()
    const response = await invokeRequest(createPmcMiniAppMiddleware({
      config: routeConfig('SYNC'),
      identity: { verify: async () => ({ lineUserId: 'Uactive' }) },
      store: fixture.store,
      evidenceIngress: fixture.ingress!,
      draftStateIngress: fixture.draftStateIngress,
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    }), '/api/mini-app/booking-drafts/draft-1/cancel', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 2, version: 1 }),
    })

    expect(response).toMatchObject({ status: 200, body: { state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' } })
    expect(fixture.draftStateIngress.operations()).toEqual(['CANCEL'])
    expect(fixture.store.directWriteCount()).toBe(0)
    expect(fixture.store.draftReadCount()).toBe(2)
  })

  it.each([
    ['PATCH', '/api/mini-app/booking-drafts/draft-1', JSON.stringify({ protocolVersion: 2, version: 1, input: bookingInput() })],
    ['POST', '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', new FormData()],
    ['POST', '/api/mini-app/booking-drafts/draft-1/evidence-batch', new FormData()],
  ] as const)('blocks a new protocol-2 legacy %s writer before config, evidence, or Sheet effects', async (method, path, body) => {
    const fixture = prepareFixture('SYNC')
    if (body instanceof FormData) body.append('files', new Blob([png(1).bytes], { type: 'image/png' }), 'evidence.png')
    const response = await invokeRequest(createPmcMiniAppMiddleware({
      config: routeConfig('SYNC'),
      identity: { verify: async () => ({ lineUserId: 'Uactive' }) },
      store: fixture.store,
      evidenceIngress: fixture.ingress!,
      draftStateIngress: fixture.draftStateIngress,
    }), path, {
      method,
      headers: body instanceof FormData
        ? { authorization: 'Bearer valid-token' }
        : { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body,
    })

    expect(response).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(fixture.store.configReadCount()).toBe(0)
    expect(fixture.store.directWriteCount()).toBe(0)
    expect(fixture.ingress!.callCount()).toBe(0)
  })
})

function prepareFixture(mode: 'ASYNC' | 'SYNC', draftPatch: Partial<MiniAppRequestRecord> = {}) {
  const store = new PrepareStore(draft(draftPatch))
  const staging = mode === 'ASYNC' ? new PrepareStaging() : null
  const ingress = mode === 'SYNC' ? new PrepareIngress() : null
  const draftStateIngress = new PrepareOwnerDraftStateIngress(store)
  return {
    store,
    staging,
    ingress,
    draftStateIngress,
    input(patch: Partial<PersistPrepareEvidenceInput> = {}): PersistPrepareEvidenceInput {
      return {
        draft: store.read(),
        version: 1,
        input: bookingInput(),
        paymentFiles: [png(1)],
        chatFiles: [jpeg(2)],
        bookingContext: {
          doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
          services: [{ id: 'service-1', name: 'เติมไขมัน' }],
          channels: [{ id: 'channel-1', name: 'เพจTAB' }],
          admins: [{ id: 'ADMIN_02', name: 'แวว' }, { id: 'ADMIN_03', name: 'หมวย' }],
          aes: [{ id: 'ADMIN_02', name: 'แวว' }, { id: 'ADMIN_03', name: 'หมวย' }],
        },
        persistence: mode === 'ASYNC'
          ? { type: 'ASYNC', staging: staging! }
          : { type: 'SYNC', ingress: ingress! },
        store,
        draftStateIngress,
        now: () => '2026-08-30T10:00:00.000Z',
        ...patch,
      }
    },
  }
}

function removedAndRenamedBookingContext(): PersistPrepareEvidenceInput['bookingContext'] {
  return {
    doctors: [],
    services: [],
    channels: [],
    admins: [{ id: 'ADMIN_02', name: 'แววใหม่' }],
    aes: [],
  }
}

class PrepareStore implements MiniAppStore {
  private current: MiniAppRequestRecord
  private writes = 0
  private directWrites = 0
  private staffReads = 0
  private draftReads = 0
  private configReads = 0

  constructor(initial: MiniAppRequestRecord) { this.current = structuredClone(initial) }
  read(): MiniAppRequestRecord { return structuredClone(this.current) }
  writeCount(): number { return this.writes }
  directWriteCount(): number { return this.directWrites }
  staffReadCount(): number { return this.staffReads }
  draftReadCount(): number { return this.draftReads }
  configReadCount(): number { return this.configReads }
  commitTerminal(state: 'CANCELLED' | 'EXPIRED'): void {
    this.current = {
      ...this.current,
      state,
      retentionState: 'PENDING_APPROVAL',
      version: this.current.version + 1,
      updatedAt: '2026-08-30T10:00:00.000Z',
    }
    this.writes += 1
  }
  async getActiveStaffByLineUserId(lineUserId: string) {
    this.staffReads += 1
    return { id: 'ADMIN_01', name: 'มัส', email: '', lineUserId, canCloseBooking: true, canBeAe: true,
      active: true as const, profileImageUrl: null }
  }
  async getActiveBookingConfig() {
    this.configReads += 1
    return {
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      admins: [{ id: 'ADMIN_02', name: 'แวว' }, { id: 'ADMIN_03', name: 'หมวย' }],
      aes: [{ id: 'ADMIN_02', name: 'แวว' }, { id: 'ADMIN_03', name: 'หมวย' }],
    }
  }
  async createDraft(value: MiniAppRequestRecord) { this.current = structuredClone(value); return this.read() }
  async getDraft(draftId: string) { this.draftReads += 1; return draftId === this.current.draftId ? this.read() : null }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    if (draftId !== this.current.draftId) throw new Error('DRAFT_NOT_FOUND')
    if (expectedVersion !== this.current.version) throw new Error('STALE_DRAFT_VERSION')
    this.current = { ...this.current, ...structuredClone(patch), version: this.current.version + 1 }
    this.writes += 1
    this.directWrites += 1
    return this.read()
  }
  ownerMutate(input: MiniAppDraftStateMutation): MiniAppDraftStateResult {
    if (input.draftId !== this.current.draftId || input.requestId !== this.current.requestId) throw new Error('INVALID_DRAFT_STATE')
    if (input.operation === 'CANCEL') {
      if (this.current.state === 'CANCELLED' || this.current.state === 'EXPIRED') return fakeResult(this.current, 'IDEMPOTENT')
      if (this.current.version !== input.expectedVersion) throw new Error('BOOKING_PREPARE_CONFLICT')
      this.current = { ...this.current, state: 'CANCELLED', retentionState: 'PENDING_APPROVAL',
        updatedAt: input.nowIso, version: this.current.version + 1 }
      this.writes += 1
      return fakeResult(this.current, 'APPLIED')
    }
    if (input.operation === 'PREPARE_BEGIN') {
      if (this.current.evidenceProjectionHash === null) {
        if (this.current.state === 'CANCELLED' || this.current.state === 'EXPIRED'
          || this.current.version !== input.expectedVersion) throw new Error('BOOKING_PREPARE_CONFLICT')
        this.current = { ...this.current,
          recorderName: this.current.recorderName,
          adminId: input.input.adminId,
          adminName: input.input.adminId === 'ADMIN_02' ? 'แวว' : 'หมวย',
          aeId: input.input.aeId,
          aeName: input.input.aeId === null ? 'ไม่ระบุ' : 'หมวย',
          evidenceProjectionHash: input.prepareBindingHash,
          updatedAt: input.nowIso, version: this.current.version + 1 }
        this.writes += 1
        return fakeResult(this.current, 'APPLIED')
      }
      if (this.current.evidenceProjectionHash !== input.prepareBindingHash) throw new Error('BOOKING_PREPARE_CONFLICT')
      return fakeResult(this.current,
        this.current.state === 'CANCELLED' || this.current.state === 'EXPIRED' ? 'TERMINAL' : 'IDEMPOTENT')
    }
    if (this.current.evidenceProjectionHash === null) throw new Error('BOOKING_PREPARE_RESERVATION_REQUIRED')
    if (this.current.evidenceProjectionHash !== input.prepareBindingHash) throw new Error('BOOKING_PREPARE_CONFLICT')
    const merged = fakeMergedEvidence(this.current, input)
    const terminal = this.current.state === 'CANCELLED' || this.current.state === 'EXPIRED'
    let candidate: MiniAppRequestRecord
    if (terminal) {
      candidate = { ...this.current, retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: input.prepareBindingHash,
        ...merged, updatedAt: input.nowIso }
    } else if (input.operation === 'PREPARE_PARTIAL') {
      candidate = { ...this.current, state: 'DRAFT', retentionState: 'PENDING_APPROVAL',
        evidenceProjectionHash: input.prepareBindingHash, ...merged, updatedAt: input.nowIso }
    } else {
      candidate = { ...this.current, state: 'READY_TO_CONFIRM', retentionState: '',
        evidenceProjectionHash: input.prepareBindingHash, adminId: input.input.adminId,
        adminName: input.input.adminId === 'ADMIN_02' ? 'แวว' : 'หมวย', aeId: input.input.aeId,
        aeName: input.input.aeId === null ? 'ไม่ระบุ' : 'หมวย', customerName: input.input.customerName,
        facebookName: input.input.facebookName, phoneNormalized: input.input.phoneNormalized,
        doctorId: input.input.doctorId, serviceId: input.input.serviceId, queueType: input.input.queueType,
        appointmentDate: input.input.appointmentDate, appointmentTime: input.input.appointmentTime,
        depositAmount: input.input.depositAmount, channelId: input.input.channelId, ...merged, updatedAt: input.nowIso }
    }
    const unchanged = fakeProjectionDigest(candidate) === fakeProjectionDigest(this.current)
    if (!unchanged) { this.current = { ...candidate, version: this.current.version + 1 }; this.writes += 1 }
    return fakeResult(this.current, unchanged ? (terminal ? 'TERMINAL' : 'IDEMPOTENT') : 'APPLIED')
  }
  async markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string) {
    return this.updateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async claimConfirmation(): Promise<never> { throw new Error('not used') }
  async completeConfirmation(): Promise<never> { throw new Error('not used') }
  async failConfirmation(): Promise<never> { throw new Error('not used') }
}

class PrepareOwnerDraftStateIngress implements DraftStateIngressPort {
  private tail: Promise<void> = Promise.resolve()
  private loseResponse = false
  private loseBeforeApply = 0
  private calls = 0
  private readonly operationLog: MiniAppDraftStateMutation['operation'][] = []
  private afterBeginHook: (() => void) | null = null
  private readonly loseByOperation = new Map<MiniAppDraftStateMutation['operation'], number>()
  private operationGate: {
    operation: MiniAppDraftStateMutation['operation']; entered: () => void; wait: Promise<void>
  } | null = null

  constructor(private readonly store: PrepareStore) {}
  loseNextResponse(): void { this.loseResponse = true }
  loseBeforeNextApply(): void { this.loseBeforeApply += 1 }
  loseBeforeNextApplies(count: number): void { this.loseBeforeApply += count }
  afterBeginApply(hook: () => void): void { this.afterBeginHook = hook }
  loseBeforeOperation(operation: MiniAppDraftStateMutation['operation'], count: number): void {
    this.loseByOperation.set(operation, (this.loseByOperation.get(operation) ?? 0) + count)
  }
  callCount(): number { return this.calls }
  operations(): MiniAppDraftStateMutation['operation'][] { return [...this.operationLog] }

  pauseBeforeOperation(operation: MiniAppDraftStateMutation['operation']): { entered: Promise<void>; release(): void } {
    let entered!: () => void; let release!: () => void
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.operationGate = { operation, entered, wait }
    return { entered: enteredPromise, release }
  }

  async mutate(input: MiniAppDraftStateMutation): Promise<MiniAppDraftStateResult> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      this.calls += 1
      this.operationLog.push(input.operation)
      const operationLosses = this.loseByOperation.get(input.operation) ?? 0
      if (operationLosses > 0) {
        this.loseByOperation.set(input.operation, operationLosses - 1)
        throw new Error('OWNER_INGRESS_REQUEST_LOST')
      }
      if (this.loseBeforeApply > 0) {
        this.loseBeforeApply -= 1
        throw new Error('OWNER_INGRESS_REQUEST_LOST')
      }
      if (this.operationGate?.operation === input.operation) {
        const gate = this.operationGate; this.operationGate = null; gate.entered(); await gate.wait
      }
      const result = this.store.ownerMutate(input)
      if (input.operation === 'PREPARE_BEGIN' && this.afterBeginHook) {
        const hook = this.afterBeginHook; this.afterBeginHook = null; hook()
      }
      if (this.loseResponse) {
        this.loseResponse = false
        throw new Error('OWNER_INGRESS_RESPONSE_LOST')
      }
      return result
    } finally {
      release()
    }
  }
}

function fakeMergedEvidence(current: MiniAppRequestRecord, input: Exclude<MiniAppDraftStateMutation, { operation: 'CANCEL' }>) {
  const storage = input.evidence[0]!.storage
  const mergeKind = (kind: 'PAYMENT' | 'CHAT') => {
    const items = input.evidence.filter((item) => item.kind === kind).sort((left, right) => left.ordinal - right.ordinal)
    const previous = storage === 'STAGED_OBJECT'
      ? kind === 'PAYMENT' ? current.paymentEvidenceObjectKeys : current.chatEvidenceObjectKeys
      : kind === 'PAYMENT' ? current.paymentEvidenceFileIds : current.chatEvidenceFileIds
    const slots: Array<string | null> = items.map(() => null)
    if (storage === 'STAGED_OBJECT') {
      for (const value of previous) {
        const index = items.findIndex((item) => value.endsWith(`/${item.contentSha256}.${item.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`))
        if (index >= 0) slots[index] = value
      }
    } else previous.forEach((value, index) => { slots[index] = value })
    items.forEach((item) => { if (item.value !== null) slots[item.ordinal] = item.value })
    return slots.flatMap((value) => value === null ? [] : [value])
  }
  const payment = mergeKind('PAYMENT'); const chat = mergeKind('CHAT')
  return {
    paymentEvidenceFileIds: storage === 'DRIVE_FILE' ? payment : [],
    chatEvidenceFileIds: storage === 'DRIVE_FILE' ? chat : [],
    paymentEvidenceObjectKeys: storage === 'STAGED_OBJECT' ? payment : [],
    chatEvidenceObjectKeys: storage === 'STAGED_OBJECT' ? chat : [],
    evidenceCount: payment.length + chat.length,
  }
}

function fakeResult(draft: MiniAppRequestRecord, outcome: MiniAppDraftStateResult['outcome']): MiniAppDraftStateResult {
  return { requestId: draft.requestId, draftId: draft.draftId, state: draft.state as MiniAppDraftStateResult['state'],
    version: draft.version, outcome, projectionDigest: fakeProjectionDigest(draft) }
}

function fakeProjectionDigest(draft: MiniAppRequestRecord): string {
  const projection: MiniAppDraftProjection = {
    requestId: draft.requestId, draftId: draft.draftId, protocolVersion: 2, staffId: draft.staffId,
    recorderName: draft.recorderName, adminId: draft.adminId, adminName: draft.adminName,
    aeId: draft.aeId, aeName: draft.aeName, state: draft.state as MiniAppDraftProjection['state'],
    retentionState: draft.retentionState, version: draft.version, evidenceProjectionHash: draft.evidenceProjectionHash,
    input: draft.adminId && draft.customerName ? {
      requestId: draft.requestId, adminId: draft.adminId, aeId: draft.aeId, customerName: draft.customerName,
      facebookName: draft.facebookName, phoneNormalized: draft.phoneNormalized, doctorId: draft.doctorId,
      serviceId: draft.serviceId, queueType: draft.queueType, appointmentDate: draft.appointmentDate,
      appointmentTime: draft.appointmentTime, depositAmount: draft.depositAmount, channelId: draft.channelId,
    } : null,
    paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds], chatEvidenceFileIds: [...draft.chatEvidenceFileIds],
    paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys], chatEvidenceObjectKeys: [...draft.chatEvidenceObjectKeys],
    evidenceCount: draft.evidenceCount,
  }
  return createHash('sha256').update(canonicalMiniAppDraftProjection(projection)).digest('base64url')
}

class PrepareStaging implements EvidenceStagingPort {
  private readonly objects = new Set<string>()
  private readonly oneTimeFailures = new Set<string>()
  private active = 0
  private highWater = 0
  private calls = 0
  private firstCreateHook: (() => void) | null = null

  failOnce(key: string): void { this.oneTimeFailures.add(key) }
  maxActive(): number { return this.highWater }
  putCount(): number { return this.calls }
  createdCount(): number { return this.objects.size }
  afterFirstCreate(hook: () => void): void { this.firstCreateHook = hook }

  async put(input: Parameters<EvidenceStagingPort['put']>[0]) {
    this.calls += 1
    this.active += 1
    this.highWater = Math.max(this.highWater, this.active)
    const key = objectKey(input.kind, input.bytes)
    try {
      await new Promise((resolve) => setTimeout(resolve, 4))
      if (this.oneTimeFailures.delete(key)) throw new Error('CONTROLLED_STAGE_FAILURE')
      this.objects.add(key)
      if (this.firstCreateHook) {
        const hook = this.firstCreateHook
        this.firstCreateHook = null
        hook()
      }
      return { objectKey: key, size: input.bytes.length, contentSha256: sha256(input.bytes) }
    } finally {
      this.active -= 1
    }
  }
  async get(): Promise<never> { throw new Error('not used') }
  async deleteVerified(): Promise<void> { throw new Error('must retain for approval') }
}

class DeferredStaging extends PrepareStaging {
  private readonly enteredPromise: Promise<void>
  private enteredResolve!: () => void
  private readonly waitPromise: Promise<void>
  private releaseResolve!: () => void

  constructor() {
    super()
    this.enteredPromise = new Promise((resolve) => { this.enteredResolve = resolve })
    this.waitPromise = new Promise((resolve) => { this.releaseResolve = resolve })
  }

  entered(): Promise<void> { return this.enteredPromise }
  release(): void { this.releaseResolve() }

  override async put(input: Parameters<EvidenceStagingPort['put']>[0]) {
    this.enteredResolve()
    await this.waitPromise
    return super.put(input)
  }
}

class PrepareIngress implements EvidenceIngressPort {
  private readonly filesByIdentity = new Map<string, string>()
  private active = 0
  private highWater = 0
  private calls = 0
  private failAt: number | null = null

  failOnceAt(call: number): void { this.failAt = call }
  maxActive(): number { return this.highWater }
  callCount(): number { return this.calls }
  createdCount(): number { return this.filesByIdentity.size }

  async upload(input: Parameters<EvidenceIngressPort['upload']>[0]) {
    this.calls += 1
    this.active += 1
    this.highWater = Math.max(this.highWater, this.active)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2))
      if (this.failAt === this.calls) {
        this.failAt = null
        throw new Error('CONTROLLED_INGRESS_FAILURE')
      }
      const identity = `${input.draftId}:${input.kind}:${sha256(input.bytes)}`
      const existing = this.filesByIdentity.get(identity)
      if (existing) return existing
      const fileId = `drive-file-${String(this.filesByIdentity.size + 1).padStart(2, '0')}`
      this.filesByIdentity.set(identity, fileId)
      return fileId
    } finally {
      this.active -= 1
    }
  }
}

function draft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 2, staffId: 'ADMIN_01', recorderName: 'มัส',
    adminId: '', adminName: '', lineUserIdHash: 'line-user-hash', state: 'DRAFT', retentionState: '', version: 1,
    payloadHash: null, aeId: null, aeName: 'ไม่ระบุ', customerName: '', facebookName: '', phoneNormalized: '',
    doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null, appointmentTime: null,
    depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    processingOwnerToken: null, evidenceProjectionHash: null, createdAt: '2026-08-30T09:00:00.000Z',
    confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-30T09:00:00.000Z',
    ...structuredClone(patch),
  }
}

function bookingInput() {
  return {
    requestId: 'request-1', adminId: 'ADMIN_02', aeId: 'ADMIN_03', customerName: ' ลูกค้า ทดสอบ ',
    facebookName: ' Facebook Test ', phone: '081-234-5678', doctorId: 'doctor-1', serviceId: 'service-1',
    queueType: 'NORMAL' as const, appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900,
    channelId: 'channel-1',
  }
}

function png(marker: number) {
  return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]), advertisedMime: 'image/png', originalName: 'evidence.png' }
}

function jpeg(marker: number) {
  return { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker]), advertisedMime: 'image/jpeg', originalName: 'evidence.jpg' }
}

function objectKey(kind: 'PAYMENT' | 'CHAT', bytes: Buffer): string {
  return `drafts/draft-1/${kind}/${sha256(bytes)}.${bytes[0] === 0xff ? 'jpg' : 'png'}`
}

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }

function stagedUploadId(kind: 'PAYMENT' | 'CHAT', bytes: Buffer): string {
  return createHash('sha256').update(`draft-1\0${kind}\0${sha256(bytes)}`, 'utf8').digest('hex')
}

function routeConfig(mode: 'SYNC' | 'ASYNC'): PmcMiniAppServerConfig {
  return {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: 2, prepare: true }, bookingMutationsPaused: false,
    asyncBooking: mode === 'ASYNC' ? {
      enabled: true, projectId: 'pmc-project', location: 'asia-southeast1', bucketName: 'pmc-private-stage',
      queueName: 'pmc-bookings', workerUrl: 'https://worker.example.test/run', workerAudience: 'https://worker.example.test',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com', ownerStaffIds: new Set(['ADMIN_01']),
      maxBatchBytes: 25_000_000,
    } : null,
    financeReportsEnabled: false, stockEnabled: false, stockManagerPilotOnly: false, finance: null,
  }
}

async function invokePrepare(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData()
  form.append('input', JSON.stringify({ protocolVersion: 2, version: 1, input: bookingInput() }))
  form.append('paymentFiles', new Blob([png(1).bytes], { type: 'image/png' }), 'payment.png')
  form.append('chatFiles', new Blob([jpeg(2).bytes], { type: 'image/jpeg' }), 'chat.jpg')
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/mini-app/booking-drafts/draft-1/prepare`, {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function invokeRequest(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
