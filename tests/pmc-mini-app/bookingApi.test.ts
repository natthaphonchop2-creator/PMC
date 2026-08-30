import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { PmcAsyncBookingConfig } from '../../server/pmc-mini-app/asyncConfig'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { BookingIngressClientError } from '../../server/pmc-mini-app/bookingIngressClient'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { BookingTaskQueuePort } from '../../server/pmc-mini-app/taskQueue'
import type { AsyncStateIngressPort } from '../../server/pmc-mini-app/asyncStateIngressClient'
import type { DraftStateIngressPort } from '../../server/pmc-mini-app/draftStateIngressClient'
import type { MiniAppDraftStateMutation, MiniAppDraftStateResult } from '../../shared/pmcMiniAppDraftState'
import { projectionDigest } from '../../server/pmc-mini-app/bookingPrepare'
import type {
  MiniAppBookingConfigProjection,
  MiniAppDraftPatch,
  MiniAppRequestRecord,
  MiniAppStore,
} from '../../server/pmc-mini-app/store'

describe('PMC Mini App booking draft API', () => {
  it('projects only the persisted async resume fields for polling', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})

    expect(created.body).toMatchObject({
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    })
  })

  it('projects staged evidence counts without exposing private object keys', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachStagedEvidence(draftId)

    const response = await invoke(middleware, `/api/mini-app/booking-drafts/${draftId}`, {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ paymentEvidenceCount: 1, chatEvidenceCount: 1 })
    expect(JSON.stringify(body)).not.toContain(`drafts/${draftId}`)
  })

  it('authenticates and returns a PII-free projection of the current owner latest async draft', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(deps)
    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/active', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', input: null, paymentEvidenceIds: [], chatEvidenceIds: [] })
    expect(body).not.toHaveProperty('customerName')
    expect(JSON.stringify(body)).not.toContain('ลูกค้าทดสอบ')
    expect(JSON.stringify(body)).not.toContain('drafts/draft-1')
  })

  it.each(['DRAFT', 'READY_TO_CONFIRM'] as const)(
    'returns a PII-free latest synchronous %s draft when prepare recovery is enabled',
    async (state) => {
      const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
      deps.config.bookingProtocol.prepare = true
      await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
      deps.storeFixture.replace({
        state,
        version: state === 'DRAFT' ? 2 : 3,
        retentionState: state === 'DRAFT' ? 'PENDING_APPROVAL' : '',
        customerName: state === 'READY_TO_CONFIRM' ? 'ลูกค้าทดสอบ' : '',
        phoneNormalized: state === 'READY_TO_CONFIRM' ? '0812345678' : '',
        paymentEvidenceFileIds: ['private-payment-file'], chatEvidenceFileIds: ['private-chat-file'], evidenceCount: 2,
      })

      const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/active', {
        headers: { authorization: 'Bearer valid-token' },
      })
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toMatchObject({ state, input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1 })
      expect(JSON.stringify(body)).not.toMatch(/ลูกค้าทดสอบ|0812345678|private-payment-file|private-chat-file/)
      expect(deps.config.asyncBooking).toBeNull()
    },
  )

  it('keeps synchronous active-draft discovery private while prepare recovery is disabled', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/active', {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(404)
  })

  it('does not call Apps Script before explicit confirmation', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    expect(created.status).toBe(201)
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachEvidence(draftId)

    const patched = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 1, input: validInput({ requestId: created.body.requestId }),
    })
    expect(patched.body.state).toBe('READY_TO_CONFIRM')
    expect(deps.ingress.send).not.toHaveBeenCalled()

    const confirmed = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/confirm`, {
      version: patched.body.version,
    })
    expect(confirmed).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.ingress.send).toHaveBeenCalledOnce()
  })

  it('returns the same case and appointment status on duplicate confirmation', async () => {
    const deps = dependencies({ ingressStatus: 'AWAITING_ADMIN_SLOT' })
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachEvidence(draftId)
    const patched = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 1,
      input: validInput({ requestId: created.body.requestId, queueType: 'AUTO', appointmentDate: null, appointmentTime: null }),
    })
    const first = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/confirm`, { version: patched.body.version })
    const current = deps.storeFixture.read(draftId)!
    const duplicate = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/confirm`, { version: current.version })

    expect(first.body).toEqual({ caseId: 'PMC-202608-0001', status: 'AWAITING_ADMIN_SLOT' })
    expect(duplicate.body).toEqual(first.body)
    expect(deps.ingress.send).toHaveBeenCalledOnce()
  })

  it('retries confirmation from the client version after a provider timeout finalized in the background', async () => {
    const deps = dependencies()
    vi.mocked(deps.ingress.send).mockRejectedValueOnce(new BookingIngressClientError('BOOKING_INGRESS_TIMEOUT'))
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachEvidence(draftId)
    const patched = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 1, input: validInput({ requestId: created.body.requestId }),
    })

    const timedOut = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/confirm`, {
      version: patched.body.version,
    })
    const retried = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/confirm`, {
      version: patched.body.version,
    })

    expect(timedOut).toEqual({ status: 504, body: { error: 'BOOKING_INGRESS_TIMEOUT' } })
    expect(retried).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.ingress.send).toHaveBeenCalledTimes(2)
  })

  it('rejects stale versions and hides drafts owned by another staff member', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)

    const stale = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 0, input: validInput({ requestId: created.body.requestId }),
    })
    const hidden = await invoke(middleware, `/api/mini-app/booking-drafts/${draftId}`, {
      headers: { authorization: 'Bearer other-staff-token' },
    })

    expect(stale).toEqual({ status: 409, body: { error: 'STALE_DRAFT_VERSION' } })
    expect(hidden.status).toBe(404)
  })

  it('returns the saved draft when an Android client repeats the identical PATCH with a stale version', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachEvidence(draftId)
    const input = validInput({ requestId: created.body.requestId })
    const saved = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 1, input,
    })

    const repeated = await jsonRequest(middleware, 'PATCH', `/api/mini-app/booking-drafts/${draftId}`, {
      version: 1, input,
    })

    expect(saved).toMatchObject({ status: 200, body: { state: 'READY_TO_CONFIRM', version: 2 } })
    expect(repeated).toEqual(saved)
    expect(deps.storeFixture.read(draftId)?.version).toBe(2)
  })

  it('cancels a draft and marks its evidence for approval-bound retention', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)
    deps.storeFixture.attachEvidence(draftId)

    const cancelled = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/cancel`, { version: 1 })

    expect(cancelled.body).toMatchObject({ state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' })
    expect(deps.storeFixture.read(draftId)?.paymentEvidenceFileIds).toEqual(['payment-1'])
    expect(deps.storeFixture.writeCount()).toBe(1)
  })

  it('returns the current cancelled draft without writing when a stale cancellation is retried after response loss', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)

    const first = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/cancel`, { version: 1 })
    const replay = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/cancel`, { version: 1 })

    expect(replay).toEqual(first)
    expect(replay).toMatchObject({ status: 200, body: { state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: 2 } })
    expect(deps.storeFixture.writeCount()).toBe(1)
  })

  it('cannot split cancellation when the retired retention-only write path is injected to fail', async () => {
    const deps = dependencies()
    deps.storeFixture.failRetentionOnlyWrite()
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
    const draftId = String(created.body.draftId)

    const cancelled = await jsonRequest(middleware, 'POST', `/api/mini-app/booking-drafts/${draftId}/cancel`, { version: 1 })

    expect(cancelled).toMatchObject({ status: 200, body: { state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' } })
    expect(deps.storeFixture.read(draftId)).toMatchObject({ state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' })
    expect(deps.storeFixture.writeCount()).toBe(1)
  })

  it('requires JSON and rejects unknown metadata keys without mutating storage', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const wrongType = await invoke(middleware, '/api/mini-app/booking-drafts', {
      method: 'POST', headers: { authorization: 'Bearer valid-token', 'content-type': 'text/plain' }, body: '{}',
    })
    const unknownKey = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', { adminName: 'ปลอม' })

    expect(wrongType.status).toBe(415)
    expect(unknownKey).toEqual({ status: 400, body: { error: 'UNKNOWN_BOOKING_FIELD' } })
    expect(deps.storeFixture.count()).toBe(0)
  })

  it('creates only the exact legacy envelope on a v1 request schema', async () => {
    const deps = dependencies({ requestSchemaVersion: 1 })

    const created = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', {})

    expect(created.status).toBe(201)
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      protocolVersion: 1, staffId: 'staff-1', recorderName: '', adminId: 'staff-1', adminName: '', aeId: null,
    })
  })

  it('creates protocol 2 on a v2 request schema and snapshots the immutable recorder', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })

    const created = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })

    expect(created.status).toBe(201)
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      protocolVersion: 2, state: 'DRAFT', staffId: 'staff-1', recorderName: 'มัส',
      adminId: '', adminName: '', aeId: null, aeName: 'ไม่ระบุ',
    })
  })

  it.each([
    ['protocol 2 on v1 schema', 1, { protocolVersion: 2 }],
    ['legacy protocol on v2 schema', 2, {}],
  ] as const)('rejects cross-schema create: %s', async (_label, requestSchemaVersion, body) => {
    const deps = dependencies({ requestSchemaVersion })

    const response = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', body)

    expect(response).toEqual({ status: 409, body: { error: 'BOOKING_PROTOCOL_SCHEMA_MISMATCH' } })
    expect(deps.storeFixture.count()).toBe(0)
  })

  it('rejects extra fields on a protocol-2 create envelope', async () => {
    const deps = dependencies({ requestSchemaVersion: 2 })

    const response = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', {
      protocolVersion: 2, adminName: 'ปลอม',
    })

    expect(response).toEqual({ status: 400, body: { error: 'UNKNOWN_BOOKING_FIELD' } })
    expect(deps.storeFixture.count()).toBe(0)
  })

  it('saves canonical Admin and AE snapshots after a protocol-2 create', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
    deps.storeFixture.attachEvidence('draft-1')

    const saved = await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      protocolVersion: 2,
      version: 1,
      input: validInputV2({ requestId: created.body.requestId, adminId: 'staff-admin', aeId: 'staff-ae' }),
    })

    expect(saved).toMatchObject({ status: 200, body: { state: 'READY_TO_CONFIRM', version: 2 } })
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      protocolVersion: 2, staffId: 'staff-1', recorderName: 'มัส',
      adminId: 'staff-admin', adminName: 'แวว', aeId: 'staff-ae', aeName: 'หมวย',
    })
  })

  it('passes canonical protocol-2 recorder, Admin, and AE snapshots into synchronous confirmation', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
    deps.storeFixture.attachEvidence('draft-1')
    const saved = await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      protocolVersion: 2,
      version: 1,
      input: validInputV2({ requestId: created.body.requestId, adminId: 'staff-admin', aeId: 'staff-ae' }),
    })

    const confirmed = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      protocolVersion: 2,
      version: saved.body.version,
    })

    expect(confirmed.status).toBe(200)
    expect(deps.ingress.send).toHaveBeenCalledWith(expect.objectContaining({
      protocolVersion: 2,
      state: 'CONFIRMING',
      staffId: 'staff-1',
      recorderName: 'มัส',
      adminId: 'staff-admin',
      adminName: 'แวว',
      aeId: 'staff-ae',
      aeName: 'หมวย',
    }))
  })

  it('owner-fences a prepared protocol-2 synchronous confirmation before booking ingress', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    deps.storeFixture.resetDirectConfirmationCounts()
    const callOrder: string[] = []
    owner.onOperation((operation) => callOrder.push(operation))
    vi.mocked(deps.ingress.send).mockImplementationOnce(async (draft) => {
      callOrder.push('BOOKING_INGRESS')
      expect(draft).toMatchObject({ state: 'CONFIRMING', payloadHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
      return { caseId: 'PMC-202608-0001', status: 'CONFIRMED' }
    })

    const response = await confirmP2Draft({ ...deps, draftStateIngress: owner }, Number(ready.version))

    expect(response).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(callOrder).toEqual(['CONFIRM_CLAIM', 'BOOKING_INGRESS', 'CONFIRM_COMPLETE'])
    expect(deps.storeFixture.directConfirmationCounts()).toEqual({ claim: 0, complete: 0, fail: 0 })
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    })
  })

  it('recovers an applied CONFIRM_CLAIM response loss with exactly one authoritative reread', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    owner.loseResponseAfter('CONFIRM_CLAIM')
    deps.storeFixture.resetGetDraftCount()

    const response = await confirmP2Draft({ ...deps, draftStateIngress: owner }, Number(ready.version))

    expect(response.status).toBe(200)
    expect(deps.storeFixture.getDraftCount()).toBe(2)
    expect(owner.operations()).toEqual(['CONFIRM_CLAIM', 'CONFIRM_COMPLETE'])
  })

  it('recovers an applied CONFIRM_COMPLETE response loss without repeating booking ingress', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    owner.loseResponseAfter('CONFIRM_COMPLETE')
    deps.storeFixture.resetGetDraftCount()

    const response = await confirmP2Draft({ ...deps, draftStateIngress: owner }, Number(ready.version))

    expect(response).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.ingress.send).toHaveBeenCalledOnce()
    expect(deps.storeFixture.getDraftCount()).toBe(2)
  })

  it('records a synchronous ingress failure through the owner fence and preserves the prepared draft', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    vi.mocked(deps.ingress.send).mockRejectedValueOnce(new BookingIngressClientError('BOOKING_INGRESS_TIMEOUT'))

    const response = await confirmP2Draft({ ...deps, draftStateIngress: owner }, Number(ready.version))

    expect(response).toEqual({ status: 504, body: { error: 'BOOKING_INGRESS_TIMEOUT' } })
    expect(owner.operations()).toEqual(['CONFIRM_CLAIM', 'CONFIRM_FAIL'])
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      state: 'FAILED_RETRYABLE', safeErrorCode: 'BOOKING_INGRESS_TIMEOUT',
      customerName: 'ลูกค้าทดสอบ', paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    })
  })

  it('does not call booking ingress when CANCEL wins the owner lock before CONFIRM_CLAIM', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    owner.cancelBeforeClaim()

    const response = await confirmP2Draft({ ...deps, draftStateIngress: owner }, Number(ready.version))

    expect(response).toEqual({ status: 409, body: { error: 'DRAFT_NOT_READY' } })
    expect(deps.ingress.send).not.toHaveBeenCalled()
    expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' })
  })

  it('converges five concurrent protocol-2 confirms on one durable booking result', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    deps.config.bookingProtocol.prepare = true
    const owner = new TestConfirmDraftStateIngress(deps.storeFixture)
    const ready = await createPreparedP2ReadyDraft(deps)
    const wired = { ...deps, draftStateIngress: owner }

    const results = await Promise.all(Array.from({ length: 5 }, () => confirmP2Draft(wired, Number(ready.version))))

    expect(results).toEqual(Array.from({ length: 5 }, () => ({
      status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' },
    })))
    expect(new Set(results.map(({ body }) => body.caseId))).toEqual(new Set(['PMC-202608-0001']))
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    })
    expect(deps.storeFixture.directConfirmationCounts()).toEqual({ claim: 0, complete: 0, fail: 0 })
  })

  it('projects only browser-safe persisted attribution snapshots for a protocol-2 review', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    const middleware = createPmcMiniAppMiddleware(deps)
    const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
    deps.storeFixture.attachEvidence('draft-1')
    await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      protocolVersion: 2,
      version: 1,
      input: validInputV2({ requestId: created.body.requestId, adminId: 'staff-admin', aeId: 'staff-ae' }),
    })

    const response = await invoke(middleware, '/api/mini-app/booking-drafts/draft-1', {
      headers: { authorization: 'Bearer valid-token' },
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.attribution).toEqual({
      protocolVersion: 2,
      recorder: { id: 'staff-1', name: 'มัส' },
      admin: { id: 'staff-admin', name: 'แวว' },
      ae: { id: 'staff-ae', name: 'หมวย' },
    })
    expect(JSON.stringify(body.attribution)).not.toContain('private@example.com')
    expect(body.input).not.toHaveProperty('adminName')
    expect(body.input).not.toHaveProperty('aeName')
  })

  it('returns the exact authenticated Booking protocol capability', async () => {
    const deps = dependencies({ minimumMutation: 2 })

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/config', {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      bookingProtocol: { supported: 2, minimumMutation: 2, prepare: false },
    })
  })

  it('rejects a new protocol-1 create at the protocol-2 floor before storage mutation', async () => {
    const deps = dependencies({ minimumMutation: 2 })

    const response = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', {})

    expect(response).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(deps.storeFixture.count()).toBe(0)
    expect(deps.storeFixture.writeCount()).toBe(0)
    expect(deps.ingress.send).not.toHaveBeenCalled()
    expect(deps.taskQueue.enqueue).not.toHaveBeenCalled()
  })

  it('rejects new protocol-1 save, cancel, and confirm effects after the floor reaches 2', async () => {
    const saveDeps = dependencies()
    const saveMiddleware = createPmcMiniAppMiddleware(saveDeps)
    await jsonRequest(saveMiddleware, 'POST', '/api/mini-app/booking-drafts', {})
    saveDeps.storeFixture.attachEvidence('draft-1')
    saveDeps.config.bookingProtocol.minimumMutation = 2

    const rejectedSave = await jsonRequest(saveMiddleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      version: 1, input: validInput(),
    })
    const rejectedCancel = await jsonRequest(saveMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/cancel', { version: 1 })

    expect(rejectedSave).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(rejectedCancel).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(saveDeps.storeFixture.writeCount()).toBe(0)

    saveDeps.config.bookingProtocol.minimumMutation = 1
    const saved = await jsonRequest(saveMiddleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      version: 1, input: validInput(),
    })
    saveDeps.config.bookingProtocol.minimumMutation = 2
    const rejectedConfirm = await jsonRequest(saveMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      version: saved.body.version,
    })

    expect(rejectedConfirm).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(saveDeps.ingress.send).not.toHaveBeenCalled()
    expect(saveDeps.taskQueue.enqueue).not.toHaveBeenCalled()
  })

  it('retains exact protocol-1 idempotent save, cancel, confirm, and GET recovery at floor 2', async () => {
    const saveDeps = dependencies()
    const saveMiddleware = createPmcMiniAppMiddleware(saveDeps)
    await jsonRequest(saveMiddleware, 'POST', '/api/mini-app/booking-drafts', {})
    saveDeps.storeFixture.attachEvidence('draft-1')
    const input = validInput()
    const saved = await jsonRequest(saveMiddleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', { version: 1, input })
    const writeCountAfterSave = saveDeps.storeFixture.writeCount()
    saveDeps.config.bookingProtocol.minimumMutation = 2

    const savedReplay = await jsonRequest(saveMiddleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', { version: 1, input })
    const getSaved = await invoke(saveMiddleware, '/api/mini-app/booking-drafts/draft-1', {
      headers: { authorization: 'Bearer valid-token' },
    })

    expect(savedReplay).toEqual(saved)
    expect(getSaved.status).toBe(200)
    expect(saveDeps.storeFixture.writeCount()).toBe(writeCountAfterSave)

    const cancelDeps = dependencies()
    const cancelMiddleware = createPmcMiniAppMiddleware(cancelDeps)
    await jsonRequest(cancelMiddleware, 'POST', '/api/mini-app/booking-drafts', {})
    const cancelled = await jsonRequest(cancelMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/cancel', { version: 1 })
    const cancelWrites = cancelDeps.storeFixture.writeCount()
    cancelDeps.config.bookingProtocol.minimumMutation = 2
    const cancelReplay = await jsonRequest(cancelMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/cancel', { version: 1 })

    expect(cancelReplay).toEqual(cancelled)
    expect(cancelDeps.storeFixture.writeCount()).toBe(cancelWrites)

    const confirmDeps = dependencies()
    const confirmMiddleware = createPmcMiniAppMiddleware(confirmDeps)
    await jsonRequest(confirmMiddleware, 'POST', '/api/mini-app/booking-drafts', {})
    confirmDeps.storeFixture.attachEvidence('draft-1')
    const ready = await jsonRequest(confirmMiddleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      version: 1, input: validInput(),
    })
    const confirmed = await jsonRequest(confirmMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      version: ready.body.version,
    })
    const ingressCalls = confirmDeps.ingress.send.mock.calls.length
    confirmDeps.config.bookingProtocol.minimumMutation = 2
    const confirmedReplay = await jsonRequest(confirmMiddleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      version: confirmDeps.storeFixture.read('draft-1')!.version,
    })

    expect(confirmedReplay).toEqual(confirmed)
    expect(confirmDeps.ingress.send).toHaveBeenCalledTimes(ingressCalls)
  })

  it('requires exact protocol-2 save and confirm envelopes before any effect', async () => {
    const deps = dependencies({ requestSchemaVersion: 2, minimumMutation: 2 })
    const middleware = createPmcMiniAppMiddleware(deps)
    await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
    deps.storeFixture.attachEvidence('draft-1')
    const input = validInputV2()

    const missingSaveProtocol = await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      version: 1, input,
    })
    const extraSaveField = await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      protocolVersion: 2, version: 1, input, recorderName: 'ปลอม',
    })

    expect(missingSaveProtocol).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(extraSaveField).toEqual({ status: 400, body: { error: 'UNKNOWN_BOOKING_FIELD' } })
    expect(deps.storeFixture.writeCount()).toBe(0)

    const saved = await jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
      protocolVersion: 2, version: 1, input,
    })
    const missingConfirmProtocol = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      version: saved.body.version,
    })
    expect(missingConfirmProtocol).toEqual({ status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' } })
    expect(deps.ingress.send).not.toHaveBeenCalled()

    const confirmed = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
      protocolVersion: 2, version: saved.body.version,
    })
    expect(confirmed).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.ingress.send).toHaveBeenCalledOnce()
  })

  it('returns 202 after enqueue and Sheet state without calling Apps Script inline for an owner pilot', async () => {
    const events: string[] = []
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])), events })
    const response = await createReadyDraftAndConfirm(deps)

    expect(response).toEqual({ status: 202, body: queuedBody(deps.storeFixture.read('draft-1')!) })
    expect(events).toEqual(['enqueue', 'stateIngress', 'queueDraft'])
    const persisted = deps.storeFixture.read('draft-1')!
    expect(deps.taskQueue.enqueue).toHaveBeenCalledWith({
      requestId: 'request-1', draftId: 'draft-1', payloadHash: persisted.payloadHash!, baseVersion: persisted.version - 1,
      scheduleAt: new Date('2026-08-27T10:00:02.000Z'),
    })
    expect(deps.ingress.send).not.toHaveBeenCalled()
    expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'QUEUED', taskName: 'task/request-1' })
  })

  it('keeps the durable queue acknowledgement when telemetry throws after task creation', async () => {
    const deps = { ...dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) }), asyncTelemetry: vi.fn(() => { throw new Error('telemetry must not block') }) }

    const response = await createReadyDraftAndConfirm(deps)

    expect(response.status).toBe(202)
    expect(deps.taskQueue.enqueue).toHaveBeenCalledOnce()
    expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'QUEUED' })
  })

  it.each([false, true])(
    'queues only through Apps Script state ingress and recovers response loss=%s from persisted reread',
    async (loseResponse) => {
      const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
      const ready = await createReadyDraft(deps)
      const stateIngress: AsyncStateIngressPort = {
        mutate: vi.fn(async (mutation) => {
          const current = deps.storeFixture.read('draft-1')!
          deps.storeFixture.replace({
            state: 'QUEUED', payloadHash: mutation.payloadHash, taskName: mutation.taskName,
            queuedAt: mutation.nowIso, updatedAt: mutation.nowIso, version: current.version + 1,
          })
          if (loseResponse) throw new Error('simulated async state response loss')
          const persisted = deps.storeFixture.read('draft-1')!
          return {
            requestId: persisted.requestId, draftId: persisted.draftId, state: persisted.state,
            version: persisted.version, attemptCount: persisted.attemptCount, caseId: persisted.caseId,
            confirmationStatus: persisted.confirmationStatus, outcome: 'APPLIED' as const,
          }
        }),
      }

      const response = await confirmDraft({
        ...deps,
        stateIngress,
      }, Number(ready.body.version))

      expect(response).toEqual({ status: 202, body: queuedBody(deps.storeFixture.read('draft-1')!) })
      expect(stateIngress.mutate).toHaveBeenCalledOnce()
      expect(deps.storeFixture.queueWriteCount()).toBe(0)
      expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'QUEUED', version: Number(ready.body.version) + 1 })
    },
  )

  it('keeps synchronous confirmation unchanged when async is off or the staff member is not an owner', async () => {
    const disabled = dependencies()
    const nonOwner = dependencies({ asyncBooking: asyncConfig(new Set(['staff-owner'])) })

    expect(await createReadyDraftAndConfirm(disabled)).toMatchObject({ status: 200, body: { caseId: 'PMC-202608-0001' } })
    expect(await createReadyDraftAndConfirm(nonOwner)).toMatchObject({ status: 200, body: { caseId: 'PMC-202608-0001' } })
    expect(disabled.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(nonOwner.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(disabled.ingress.send).toHaveBeenCalledOnce()
    expect(nonOwner.ingress.send).toHaveBeenCalledOnce()
  })

  it('fails closed without a Sheet write or provider details when task creation fails', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    deps.taskQueue.enqueue.mockRejectedValueOnce(new Error('provider secret body'))

    const response = await createReadyDraftAndConfirm(deps)

    expect(response).toEqual({ status: 503, body: { error: 'BOOKING_TASK_QUEUE_FAILED' } })
    expect(deps.storeFixture.queueWriteCount()).toBe(0)
    expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'READY_TO_CONFIRM', payloadHash: null, taskName: null })
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it('continues the Sheet write when deterministic task creation reports ALREADY_EXISTS', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    deps.taskQueue.enqueue.mockResolvedValueOnce({ taskName: 'task/request-1', alreadyExists: true })

    const response = await createReadyDraftAndConfirm(deps)

    expect(response).toEqual({ status: 202, body: queuedBody(deps.storeFixture.read('draft-1')!) })
    expect(deps.storeFixture.queueWriteCount()).toBe(1)
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it('retries an ALREADY_EXISTS task and reconciles a Sheet update lost after task creation', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    deps.storeFixture.failNextQueueWrite()
    const first = await createReadyDraftAndConfirm(deps)
    deps.taskQueue.enqueue.mockResolvedValueOnce({ taskName: 'task/request-1', alreadyExists: true })
    const retry = await confirmReadyDraft(deps)

    expect(first).toEqual({ status: 503, body: { error: 'MINI_APP_STORAGE_UNAVAILABLE' } })
    expect(retry).toEqual({ status: 202, body: queuedBody(deps.storeFixture.read('draft-1')!) })
    expect(deps.taskQueue.enqueue).toHaveBeenCalledTimes(2)
    expect(deps.storeFixture.queueWriteCount()).toBe(1)
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it('returns the committed queue result when the first response is lost after the Sheet mutation', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const ready = await createReadyDraft(deps)
    const clientVersion = Number(ready.body.version)
    deps.storeFixture.failNextQueueWriteAfterCommit()

    const first = await confirmDraft(deps, clientVersion)
    const committed = deps.storeFixture.read('draft-1')!
    const retry = await confirmDraft(deps, clientVersion)

    expect(first).toEqual({ status: 202, body: queuedBody(committed) })
    expect(retry).toEqual({ status: 202, body: queuedBody(committed) })
    expect(deps.storeFixture.read('draft-1')).toEqual(committed)
    expect(committed).toMatchObject({ state: 'QUEUED', version: clientVersion + 1, taskName: 'task/request-1' })
    expect(deps.taskQueue.enqueue).toHaveBeenCalledOnce()
    expect(deps.storeFixture.queueWriteCount()).toBe(1)
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it.each(['QUEUED', 'PROCESSING', 'RETRYING'] as const)(
    'returns the existing queue result for a current-version %s owner retry without side effects',
    async (state) => {
      const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
      await createReadyDraftAndConfirm(deps)
      const queued = deps.storeFixture.read('draft-1')!
      deps.storeFixture.replace({ state, version: queued.version + 1 })
      const current = deps.storeFixture.read('draft-1')!
      deps.taskQueue.enqueue.mockClear()

      const retry = await confirmDraft(deps, current.version)
      const futureVersion = await confirmDraft(deps, current.version + 1)

      expect(retry).toEqual({ status: 202, body: queuedBody(current) })
      expect(futureVersion).toEqual({ status: 409, body: { error: 'STALE_DRAFT_VERSION' } })
      expect(deps.storeFixture.read('draft-1')).toEqual(current)
      expect(deps.taskQueue.enqueue).not.toHaveBeenCalled()
      expect(deps.storeFixture.queueWriteCount()).toBe(1)
      expect(deps.ingress.send).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['missing payload hash', { state: 'QUEUED' as const, payloadHash: null }],
    ['missing task name', { state: 'QUEUED' as const, taskName: null }],
    ['malformed payload hash', { state: 'QUEUED' as const, payloadHash: 'bad hash' }],
    ['malformed task name', { state: 'QUEUED' as const, taskName: 'bad task name' }],
  ])('rejects an async confirmation retry with %s', async (_label, patch) => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(deps)
    deps.storeFixture.replace(patch)
    const current = deps.storeFixture.read('draft-1')!
    deps.taskQueue.enqueue.mockClear()

    const retry = await confirmDraft(deps, current.version)

    expect(retry).toEqual({ status: 409, body: { error: 'DRAFT_NOT_READY' } })
    expect(deps.storeFixture.read('draft-1')).toEqual(current)
    expect(deps.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(deps.storeFixture.queueWriteCount()).toBe(1)
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it('does not expose a queued draft to another staff member or treat a non-owner as an async retry', async () => {
    const ownerDeps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(ownerDeps)
    ownerDeps.taskQueue.enqueue.mockClear()
    const queued = ownerDeps.storeFixture.read('draft-1')!

    const hidden = await jsonRequestWithToken(ownerDeps, 'other-staff-token', queued.version)

    expect(hidden).toEqual({ status: 404, body: { error: 'DRAFT_NOT_FOUND' } })
    expect(ownerDeps.taskQueue.enqueue).not.toHaveBeenCalled()

    const nonOwnerDeps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-owner'])) })
    await createReadyDraft(nonOwnerDeps)
    nonOwnerDeps.storeFixture.replace({
      state: 'QUEUED',
      payloadHash: 'bound-payload-hash',
      taskName: 'task/request-1',
    })
    const nonOwnerDraft = nonOwnerDeps.storeFixture.read('draft-1')!

    const rejected = await confirmDraft(nonOwnerDeps, nonOwnerDraft.version)

    expect(rejected).toEqual({ status: 409, body: { error: 'DRAFT_NOT_READY' } })
    expect(nonOwnerDeps.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(nonOwnerDeps.ingress.send).not.toHaveBeenCalled()
  })

  it('keeps the existing terminal CONFIRMED duplicate response for an async owner', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(deps)
    deps.storeFixture.replace({
      state: 'CONFIRMED',
      caseId: 'PMC-202608-0001',
      confirmationStatus: 'CONFIRMED',
      version: 4,
    })
    deps.taskQueue.enqueue.mockClear()

    const duplicate = await confirmDraft(deps, 3)

    expect(duplicate).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.storeFixture.read('draft-1')).toMatchObject({ state: 'CONFIRMED', version: 4 })
    expect(deps.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it('returns the Case ID when a queued owner task reaches CONFIRMED_WITH_RETRY before the confirm reread', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const ready = await createReadyDraft(deps)
    const stateIngress: AsyncStateIngressPort = {
      mutate: vi.fn(async (mutation) => {
        await deps.storeFixture.queueDraft(mutation.requestId, mutation.payloadHash, mutation.taskName!, mutation.nowIso)
        const queued = deps.storeFixture.read('draft-1')!
        deps.storeFixture.replace({
          state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
          safeErrorCode: 'DOWNSTREAM_RETRY', version: queued.version + 1,
        })
        return asyncIngressResult(deps.storeFixture.read('draft-1')!)
      }),
    }

    const response = await confirmDraft({ ...deps, stateIngress }, Number(ready.body.version))

    expect(response).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.storeFixture.read('draft-1')).toMatchObject({
      state: 'CONFIRMED_WITH_RETRY', safeErrorCode: 'DOWNSTREAM_RETRY',
    })
  })

  it('uses an exact applied queue result without a post-ingress draft reread', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const ready = await createReadyDraft(deps)
    deps.storeFixture.resetGetDraftCount()

    const response = await confirmDraft(deps, Number(ready.body.version))

    expect(response).toEqual({ status: 202, body: queuedBody(deps.storeFixture.read('draft-1')!) })
    expect(deps.storeFixture.getDraftCount()).toBe(1)
  })

  it('uses the actual processing projection returned by an idempotent queue result without rereading', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const ready = await createReadyDraft(deps)
    const base = deps.storeFixture.read('draft-1')!
    const stateIngress: AsyncStateIngressPort = {
      mutate: vi.fn(async (mutation) => ({
        requestId: mutation.requestId,
        draftId: mutation.draftId,
        state: 'PROCESSING',
        version: base.version + 2,
        attemptCount: base.attemptCount + 1,
        caseId: null,
        confirmationStatus: null,
        outcome: 'IDEMPOTENT',
      })),
    }
    deps.storeFixture.resetGetDraftCount()

    const response = await confirmDraft({ ...deps, stateIngress }, Number(ready.body.version))

    expect(response).toMatchObject({
      status: 202,
      body: {
        status: 'QUEUED',
        projection: { state: 'PROCESSING', version: base.version + 2 },
      },
    })
    expect(deps.storeFixture.getDraftCount()).toBe(1)
  })

  it.each([
    ['BUSY', { state: 'PROCESSING' as const, versionOffset: 2, attemptOffset: 1, outcome: 'BUSY' as const }],
    ['wrong queue version', { state: 'QUEUED' as const, versionOffset: 2, attemptOffset: 0, outcome: 'APPLIED' as const }],
  ])('performs exactly one authoritative reread for an uncertain %s ingress result', async (_label, result) => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    const ready = await createReadyDraft(deps)
    const base = deps.storeFixture.read('draft-1')!
    const stateIngress: AsyncStateIngressPort = {
      mutate: vi.fn(async (mutation) => ({
        requestId: mutation.requestId,
        draftId: mutation.draftId,
        state: result.state,
        version: base.version + result.versionOffset,
        attemptCount: base.attemptCount + result.attemptOffset,
        caseId: null,
        confirmationStatus: null,
        outcome: result.outcome,
      })),
    }
    deps.storeFixture.resetGetDraftCount()

    const response = await confirmDraft({ ...deps, stateIngress }, Number(ready.body.version))

    expect(response).toEqual({ status: 503, body: { error: 'MINI_APP_STORAGE_UNAVAILABLE' } })
    expect(deps.storeFixture.getDraftCount()).toBe(2)
  })

  it('returns the original Case ID when CONFIRMED_WITH_RETRY confirmation is replayed with a stale version', async () => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(deps)
    const queued = deps.storeFixture.read('draft-1')!
    deps.storeFixture.replace({
      state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      safeErrorCode: 'DOWNSTREAM_RETRY', version: queued.version + 1,
    })
    deps.taskQueue.enqueue.mockClear()

    const replay = await confirmDraft(deps, queued.version)

    expect(replay).toEqual({ status: 200, body: { caseId: 'PMC-202608-0001', status: 'CONFIRMED' } })
    expect(deps.taskQueue.enqueue).not.toHaveBeenCalled()
    expect(deps.ingress.send).not.toHaveBeenCalled()
  })

  it.each([
    ['missing Case ID', { caseId: null }],
    ['malformed Case ID', { caseId: 'not-a-case' }],
    ['missing status', { confirmationStatus: null }],
    ['wrong safe error', { safeErrorCode: 'BOOKING_INGRESS_RETRY' }],
  ])('does not treat CONFIRMED_WITH_RETRY with %s as terminal', async (_label, patch) => {
    const deps = dependencies({ asyncBooking: asyncConfig(new Set(['staff-1'])) })
    await createReadyDraftAndConfirm(deps)
    const queued = deps.storeFixture.read('draft-1')!
    deps.storeFixture.replace({
      state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      safeErrorCode: 'DOWNSTREAM_RETRY', version: queued.version + 1, ...patch,
    })

    await expect(confirmDraft(deps, queued.version)).resolves.toEqual({
      status: 409, body: { error: 'STALE_DRAFT_VERSION' },
    })
  })
})

function dependencies(options: {
  ingressStatus?: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'
  asyncBooking?: PmcAsyncBookingConfig | null
  events?: string[]
  requestSchemaVersion?: 1 | 2
  minimumMutation?: 1 | 2
} = {}) {
  const storeFixture = new TestStore(options.requestSchemaVersion ?? 1)
  const identity: LineIdentityPort = {
    async verify(token) {
      if (token === 'valid-token') return { lineUserId: 'Uactive' }
      if (token === 'other-staff-token') return { lineUserId: 'Uother' }
      throw new Error('unauthorized')
    },
  }
  const ingress = {
    send: vi.fn(async () => ({ caseId: 'PMC-202608-0001', status: options.ingressStatus ?? 'CONFIRMED' })),
  }
  const taskQueue: { enqueue: ReturnType<typeof vi.fn<BookingTaskQueuePort['enqueue']>> } = {
    enqueue: vi.fn(async () => {
      options.events?.push('enqueue')
      return { taskName: 'task/request-1', alreadyExists: false }
    }),
  }
  const stateIngress: AsyncStateIngressPort = {
    mutate: vi.fn(async (mutation) => {
      options.events?.push('stateIngress')
      const persisted = await storeFixture.queueDraft(
        mutation.requestId, mutation.payloadHash, mutation.taskName!, mutation.nowIso,
      )
      return asyncIngressResult(persisted)
    }),
  }
  const config: PmcMiniAppServerConfig = {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: options.minimumMutation ?? 1, prepare: false },
    asyncBooking: options.asyncBooking ?? null,
  }
  storeFixture.onQueueWrite(() => options.events?.push('queueDraft'))
  return {
    config, identity, store: storeFixture as MiniAppStore, ingress, taskQueue, stateIngress,
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    requestId: () => 'request-1', draftId: () => 'draft-1',
    storeFixture,
  }
}

function asyncIngressResult(persisted: MiniAppRequestRecord) {
  return {
    requestId: persisted.requestId, draftId: persisted.draftId, state: persisted.state,
    version: persisted.version, attemptCount: persisted.attemptCount, caseId: persisted.caseId,
    confirmationStatus: persisted.confirmationStatus, outcome: 'APPLIED' as const,
  }
}

class TestStore implements MiniAppStore {
  private readonly drafts = new Map<string, MiniAppRequestRecord>()
  private writes = 0
  private failRetentionOnly = false
  private failQueue = false
  private failQueueAfterCommit = false
  private queueWrites = 0
  private draftReads = 0
  private directClaims = 0
  private directCompletes = 0
  private directFailures = 0
  private queueWriteHook: () => void = () => undefined

  constructor(private readonly requestSchemaVersion: 1 | 2) {}

  count(): number { return this.drafts.size }
  writeCount(): number { return this.writes }
  queueWriteCount(): number { return this.queueWrites }
  getDraftCount(): number { return this.draftReads }
  resetGetDraftCount(): void { this.draftReads = 0 }
  resetDirectConfirmationCounts(): void { this.directClaims = 0; this.directCompletes = 0; this.directFailures = 0 }
  directConfirmationCounts() { return { claim: this.directClaims, complete: this.directCompletes, fail: this.directFailures } }
  failRetentionOnlyWrite(): void { this.failRetentionOnly = true }
  failNextQueueWrite(): void { this.failQueue = true }
  failNextQueueWriteAfterCommit(): void { this.failQueueAfterCommit = true }
  onQueueWrite(hook: () => void): void { this.queueWriteHook = hook }
  read(draftId: string): MiniAppRequestRecord | null { return structuredClone(this.drafts.get(draftId) ?? null) }
  replace(patch: Partial<MiniAppRequestRecord>): void {
    const draftId = patch.draftId ?? 'draft-1'
    const draft = this.drafts.get(draftId)!
    this.drafts.set(draftId, { ...draft, ...structuredClone(patch) })
  }
  attachEvidence(draftId: string): void {
    const draft = this.drafts.get(draftId)!
    this.drafts.set(draftId, { ...draft, paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2 })
  }
  attachStagedEvidence(draftId: string): void {
    const draft = this.drafts.get(draftId)!
    this.drafts.set(draftId, {
      ...draft,
      paymentEvidenceObjectKeys: [`drafts/${draftId}/PAYMENT/${'a'.repeat(64)}.png`],
      chatEvidenceObjectKeys: [`drafts/${draftId}/CHAT/${'b'.repeat(64)}.png`],
      evidenceCount: 2,
    })
  }
  async getActiveStaffByLineUserId(lineUserId: string) {
    return {
      id: lineUserId === 'Uother' ? 'staff-2' : 'staff-1', name: 'มัส', email: '', lineUserId,
      canCloseBooking: true, canBeAe: true, active: true as const, profileImageUrl: null,
    }
  }
  async getActiveBookingConfig(): Promise<MiniAppBookingConfigProjection> {
    return {
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      admins: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
      aes: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
    }
  }
  async createDraft(draft: MiniAppRequestRecord) {
    if (draft.protocolVersion !== this.requestSchemaVersion) throw new Error('BOOKING_PROTOCOL_SCHEMA_MISMATCH')
    this.drafts.set(draft.draftId, structuredClone(draft))
    return structuredClone(draft)
  }
  async getDraft(draftId: string) { this.draftReads += 1; return this.read(draftId) }
  async getLatestActiveDraftByStaff(staffId: string) {
    return [...this.drafts.values()]
      .filter((draft) => draft.staffId === staffId && ['DRAFT', 'READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'NEEDS_REVIEW'].includes(draft.state))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null
  }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    const draft = this.drafts.get(draftId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
    if (this.failRetentionOnly && Object.keys(patch).every((key) => key === 'retentionState' || key === 'updatedAt')) {
      throw new Error('INJECTED_RETENTION_WRITE_FAILURE')
    }
    const next = { ...draft, ...structuredClone(patch), version: draft.version + 1 }
    this.drafts.set(draftId, next)
    this.writes += 1
    return structuredClone(next)
  }
  async markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string) {
    return this.updateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async queueDraft(requestId: string, payloadHash: string, taskName: string, queuedAt: string) {
    this.queueWriteHook()
    if (this.failQueue) {
      this.failQueue = false
      throw new Error('INJECTED_QUEUE_WRITE_FAILURE')
    }
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.payloadHash && draft.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
    if (draft.taskName && draft.taskName !== taskName) throw new Error('TASK_NAME_CONFLICT')
    if (draft.state === 'QUEUED') return structuredClone(draft)
    const next = {
      ...draft, state: 'QUEUED' as const, payloadHash, taskName, queuedAt, updatedAt: queuedAt, version: draft.version + 1,
    }
    this.drafts.set(next.draftId, next)
    this.queueWrites += 1
    if (this.failQueueAfterCommit) {
      this.failQueueAfterCommit = false
      throw new Error('INJECTED_QUEUE_RESPONSE_LOSS')
    }
    return structuredClone(next)
  }
  async claimConfirmation(requestId: string, payloadHash: string) {
    this.directClaims += 1
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.payloadHash && draft.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
    if (draft.state === 'CONFIRMED') return { claimed: false as const, caseId: draft.caseId, status: draft.confirmationStatus }
    const next = { ...draft, state: 'CONFIRMING' as const, payloadHash, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return { claimed: true as const, draft: structuredClone(next) }
  }
  async completeConfirmation(requestId: string, caseId: string, confirmedAt: string, status: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT') {
    this.directCompletes += 1
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'CONFIRMED' as const, caseId, confirmedAt, confirmationStatus: status, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
  async failConfirmation(requestId: string, safeErrorCode: string, updatedAt: string) {
    this.directFailures += 1
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'FAILED_RETRYABLE' as const, safeErrorCode, updatedAt, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
}

class TestConfirmDraftStateIngress implements DraftStateIngressPort {
  private readonly calls: MiniAppDraftStateMutation['operation'][] = []
  private readonly lost = new Set<MiniAppDraftStateMutation['operation']>()
  private hook: (operation: MiniAppDraftStateMutation['operation']) => void = () => undefined
  private cancelOnClaim = false

  constructor(private readonly store: TestStore) {}

  operations(): MiniAppDraftStateMutation['operation'][] { return [...this.calls] }
  onOperation(hook: (operation: MiniAppDraftStateMutation['operation']) => void): void { this.hook = hook }
  loseResponseAfter(operation: MiniAppDraftStateMutation['operation']): void { this.lost.add(operation) }
  cancelBeforeClaim(): void { this.cancelOnClaim = true }

  async mutate(input: MiniAppDraftStateMutation): Promise<MiniAppDraftStateResult> {
    this.calls.push(input.operation)
    this.hook(input.operation)
    let current = this.store.read(input.draftId)!
    let outcome: MiniAppDraftStateResult['outcome'] = 'APPLIED'
    if (input.operation === 'CONFIRM_CLAIM') {
      if (this.cancelOnClaim) {
        this.cancelOnClaim = false
        current = await this.store.updateDraft(current.draftId, current.version, {
          state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: input.nowIso,
        })
        outcome = 'TERMINAL'
      } else if (current.state === 'CONFIRMING' && current.payloadHash === input.payloadHash) {
        outcome = 'IDEMPOTENT'
      } else {
        current = await this.store.updateDraft(current.draftId, current.version, {
          state: 'CONFIRMING', payloadHash: input.payloadHash, safeErrorCode: null, updatedAt: input.nowIso,
        })
      }
    } else if (input.operation === 'CONFIRM_COMPLETE') {
      if (current.state === 'CONFIRMED' && current.caseId === input.caseId) outcome = 'IDEMPOTENT'
      else current = await this.store.updateDraft(current.draftId, current.version, {
        state: 'CONFIRMED', caseId: input.caseId, confirmationStatus: input.confirmationStatus,
        confirmedAt: input.nowIso, safeErrorCode: null, updatedAt: input.nowIso,
      })
    } else if (input.operation === 'CONFIRM_FAIL') {
      if (current.state === 'FAILED_RETRYABLE' && current.safeErrorCode === input.safeErrorCode) outcome = 'IDEMPOTENT'
      else current = await this.store.updateDraft(current.draftId, current.version, {
        state: 'FAILED_RETRYABLE', safeErrorCode: input.safeErrorCode, updatedAt: input.nowIso,
      })
    } else {
      throw new Error(`unsupported test operation ${input.operation}`)
    }
    const result: MiniAppDraftStateResult = {
      requestId: current.requestId, draftId: current.draftId, state: current.state as MiniAppDraftStateResult['state'],
      version: current.version, outcome, projectionDigest: projectionDigest(current),
    }
    if (this.lost.delete(input.operation)) throw new Error('INJECTED_OWNER_RESPONSE_LOSS')
    return result
  }
}

function asyncConfig(ownerStaffIds: ReadonlySet<string>): PmcAsyncBookingConfig {
  return {
    enabled: true, projectId: 'pmc-project', location: 'asia-southeast1', bucketName: 'pmc-booking-staging',
    queueName: 'pmc-booking-finalize', workerUrl: 'https://pmc-worker.example.com/internal/mini-app/booking-worker',
    workerAudience: 'https://pmc-worker.example.com', taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com',
    ownerStaffIds, maxBatchBytes: 25_000_000,
  }
}

async function createReadyDraftAndConfirm(deps: ReturnType<typeof dependencies>) {
  const patched = await createReadyDraft(deps)
  return confirmDraft(deps, Number(patched.body.version))
}

async function createReadyDraft(deps: ReturnType<typeof dependencies>) {
  const middleware = createPmcMiniAppMiddleware(deps)
  const created = await jsonRequest(middleware, 'POST', '/api/mini-app/booking-drafts', {})
  if (deps.config.asyncBooking?.ownerStaffIds.has('staff-1')) deps.storeFixture.attachStagedEvidence('draft-1')
  else deps.storeFixture.attachEvidence('draft-1')
  return jsonRequest(middleware, 'PATCH', '/api/mini-app/booking-drafts/draft-1', {
    version: 1, input: validInput({ requestId: created.body.requestId }),
  })
}

async function createPreparedP2ReadyDraft(deps: ReturnType<typeof dependencies>): Promise<MiniAppRequestRecord> {
  await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts', { protocolVersion: 2 })
  deps.storeFixture.replace({
    state: 'READY_TO_CONFIRM', version: 3,
    recorderName: 'มัส', adminId: 'staff-admin', adminName: 'แวว', aeId: 'staff-ae', aeName: 'หมวย',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Customer', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    evidenceProjectionHash: 'prepare-projection-hash',
  })
  return deps.storeFixture.read('draft-1')!
}

async function confirmP2Draft(
  deps: ReturnType<typeof dependencies> & { draftStateIngress: DraftStateIngressPort },
  version: number,
) {
  return jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', {
    protocolVersion: 2, version,
  })
}

async function confirmReadyDraft(deps: ReturnType<typeof dependencies>) {
  return confirmDraft(deps, deps.storeFixture.read('draft-1')!.version)
}

async function confirmDraft(deps: ReturnType<typeof dependencies>, version: number) {
  return jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', { version })
}

async function jsonRequestWithToken(deps: ReturnType<typeof dependencies>, token: string, version: number) {
  const response = await invoke(
    createPmcMiniAppMiddleware(deps),
    '/api/mini-app/booking-drafts/draft-1/confirm',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version }),
    },
  )
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function validInput(patch: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', ...patch,
  }
}

function validInputV2(patch: Record<string, unknown> = {}) {
  const base = validInput()
  delete base.aeName
  return { ...base, adminId: 'staff-admin', aeId: null, ...patch }
}

function queuedBody(draft: MiniAppRequestRecord) {
  return {
    requestId: draft.requestId,
    status: 'QUEUED',
    projection: {
      draftId: draft.draftId, requestId: draft.requestId, state: draft.state, retentionState: draft.retentionState,
      version: draft.version, input: null, paymentEvidenceIds: [], chatEvidenceIds: [],
      paymentEvidenceCount: Math.max(draft.paymentEvidenceFileIds.length, draft.paymentEvidenceObjectKeys.length),
      chatEvidenceCount: Math.max(draft.chatEvidenceFileIds.length, draft.chatEvidenceObjectKeys.length),
      confirmationStatus: draft.confirmationStatus, caseId: draft.caseId, safeErrorCode: draft.safeErrorCode,
      queuedAt: draft.queuedAt, lastProgressAt: draft.lastProgressAt,
    },
  }
}

async function jsonRequest(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await invoke(middleware, path, {
    method, headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
