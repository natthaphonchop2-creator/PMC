import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { BookingIngressClientError } from '../../server/pmc-mini-app/bookingIngressClient'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type {
  MiniAppBookingConfigProjection,
  MiniAppDraftPatch,
  MiniAppRequestRecord,
  MiniAppStore,
} from '../../server/pmc-mini-app/store'

describe('PMC Mini App booking draft API', () => {
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
})

function dependencies(options: { ingressStatus?: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT' } = {}) {
  const storeFixture = new TestStore()
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
  const config: PmcMiniAppServerConfig = {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
  }
  return {
    config, identity, store: storeFixture as MiniAppStore, ingress,
    now: () => new Date('2026-08-27T10:00:00.000Z'),
    requestId: () => 'request-1', draftId: () => 'draft-1',
    storeFixture,
  }
}

class TestStore implements MiniAppStore {
  private readonly drafts = new Map<string, MiniAppRequestRecord>()

  count(): number { return this.drafts.size }
  read(draftId: string): MiniAppRequestRecord | null { return structuredClone(this.drafts.get(draftId) ?? null) }
  attachEvidence(draftId: string): void {
    const draft = this.drafts.get(draftId)!
    this.drafts.set(draftId, { ...draft, paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2 })
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
      aes: [{ id: 'staff-1', name: 'มัส' }],
    }
  }
  async createDraft(draft: MiniAppRequestRecord) { this.drafts.set(draft.draftId, structuredClone(draft)); return structuredClone(draft) }
  async getDraft(draftId: string) { return this.read(draftId) }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    const draft = this.drafts.get(draftId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
    const next = { ...draft, ...structuredClone(patch), version: draft.version + 1 }
    this.drafts.set(draftId, next)
    return structuredClone(next)
  }
  async markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string) {
    return this.updateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async claimConfirmation(requestId: string, payloadHash: string) {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.payloadHash && draft.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
    if (draft.state === 'CONFIRMED') return { claimed: false as const, caseId: draft.caseId, status: draft.confirmationStatus }
    const next = { ...draft, state: 'CONFIRMING' as const, payloadHash, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return { claimed: true as const, draft: structuredClone(next) }
  }
  async completeConfirmation(requestId: string, caseId: string, confirmedAt: string, status: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT') {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'CONFIRMED' as const, caseId, confirmedAt, confirmationStatus: status, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
  async failConfirmation(requestId: string, safeErrorCode: string, updatedAt: string) {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'FAILED_RETRYABLE' as const, safeErrorCode, updatedAt, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
}

function validInput(patch: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', ...patch,
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
