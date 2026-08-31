import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { MiniAppRequestRecord } from '../../server/pmc-mini-app/store'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'

describe('PMC Booking maintenance write barrier', () => {
  const effects = {
    verifyIdentity: vi.fn(async () => ({ lineUserId: 'Uactive' })),
    lookupStaff: vi.fn(async () => staff()),
    getDraft: vi.fn(async () => terminalDraft()),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    claimConfirmation: vi.fn(),
    completeConfirmation: vi.fn(),
    failConfirmation: vi.fn(),
    driveUpload: vi.fn(),
    stagedPut: vi.fn(),
    taskEnqueue: vi.fn(),
    stateMutation: vi.fn(),
    ingressSend: vi.fn(),
    evidenceIngressUpload: vi.fn(),
  }

  beforeEach(() => {
    for (const spy of Object.values(effects)) spy.mockClear()
  })

  it.each([
    ['create', 'POST', '/api/mini-app/booking-drafts', 'application/json', '{broken'],
    ['save', 'PATCH', '/api/mini-app/booking-drafts/draft-1', 'application/json', '{broken'],
    ['confirm', 'POST', '/api/mini-app/booking-drafts/draft-1/confirm', 'application/json', '{broken'],
    ['cancel', 'POST', '/api/mini-app/booking-drafts/draft-1/cancel', 'application/json', '{broken'],
    ['evidence upload', 'POST', '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', 'multipart/form-data; boundary=broken', 'not-multipart'],
    ['evidence batch', 'POST', '/api/mini-app/booking-drafts/draft-1/evidence-batch', 'multipart/form-data; boundary=broken', 'not-multipart'],
  ])('blocks %s before authentication, body parsing, or any write effect', async (_label, method, path, contentType, body) => {
    const response = await request(method, path, contentType, body)

    expect(response).toEqual({ status: 503, body: { error: 'BOOKING_MUTATIONS_PAUSED' } })
    expect(effects.verifyIdentity).not.toHaveBeenCalled()
    expect(effects.lookupStaff).not.toHaveBeenCalled()
    expect(effects.getDraft).not.toHaveBeenCalled()
    for (const spy of writeEffects()) expect(spy).not.toHaveBeenCalled()
  })

  it('keeps an owned terminal Booking GET readable while writes are paused', async () => {
    const response = await request('GET', '/api/mini-app/booking-drafts/draft-1')

    expect(response).toMatchObject({ status: 200, body: { draftId: 'draft-1', state: 'CONFIRMED' } })
    expect(effects.verifyIdentity).toHaveBeenCalledOnce()
    expect(effects.lookupStaff).toHaveBeenCalledOnce()
    expect(effects.getDraft).toHaveBeenCalledOnce()
    for (const spy of writeEffects()) expect(spy).not.toHaveBeenCalled()
  })

  function middleware() {
    return createPmcMiniAppMiddleware({
      config: pausedConfig(),
      identity: { verify: effects.verifyIdentity },
      store: {
        getActiveStaffByLineUserId: effects.lookupStaff,
        getActiveBookingConfig: vi.fn(),
        createDraft: effects.createDraft,
        getDraft: effects.getDraft,
        updateDraft: effects.updateDraft,
        markRetentionPending: vi.fn(),
        claimConfirmation: effects.claimConfirmation,
        completeConfirmation: effects.completeConfirmation,
        failConfirmation: effects.failConfirmation,
      },
      drive: { uploadEvidence: effects.driveUpload, downloadEvidence: vi.fn() },
      evidenceStaging: { put: effects.stagedPut, get: vi.fn(), deleteVerified: vi.fn() },
      taskQueue: { enqueue: effects.taskEnqueue },
      stateIngress: { mutate: effects.stateMutation },
      ingress: { send: effects.ingressSend },
      evidenceIngress: { upload: effects.evidenceIngressUpload },
    })
  }

  async function request(method: string, path: string, contentType?: string, body?: string) {
    const headers: Record<string, string> = { authorization: 'Bearer valid-token' }
    if (contentType) headers['content-type'] = contentType
    const response = await invoke(middleware(), path, { method, headers, ...(body === undefined ? {} : { body }) })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }

  function writeEffects() {
    return [
      effects.createDraft, effects.updateDraft, effects.claimConfirmation, effects.completeConfirmation,
      effects.failConfirmation, effects.driveUpload, effects.stagedPut, effects.taskEnqueue,
      effects.stateMutation, effects.ingressSend, effects.evidenceIngressUpload,
    ]
  }
})

function pausedConfig(): PmcMiniAppServerConfig {
  return {
    enabled: true,
    miniAppId: '2001234567-mini-app',
    lineChannelId: '2001234567',
    spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1',
    bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret',
    enrollmentPin: null,
    maxImageBytes: 10_000_000,
    maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: 1, prepare: false },
    bookingMutationsPaused: true,
    asyncBooking: null,
    financeReportsEnabled: false,
    stockEnabled: false,
    stockManagerPilotOnly: false,
    finance: null,
  }
}

function staff() {
  return {
    id: 'staff-1', name: 'มัส', email: '', lineUserId: 'Uactive', canCloseBooking: true,
    canBeAe: true, active: true as const, profileImageUrl: null,
    canManageStock: false, canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  }
}

function terminalDraft(): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 1, staffId: 'staff-1',
    recorderName: '', adminId: 'staff-1', adminName: '', aeId: null, lineUserIdHash: 'hash-1',
    state: 'CONFIRMED', retentionState: '', version: 3, payloadHash: 'payload-hash', aeName: 'ไม่ระบุ',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [], evidenceCount: 0, paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
    taskName: null, queuedAt: null, processingStartedAt: null, processingLeaseUntil: null,
    lastProgressAt: null, attemptCount: 0, processingOwnerToken: null, evidenceProjectionHash: null,
    createdAt: '2026-08-30T00:00:00.000Z', confirmedAt: '2026-08-30T00:01:00.000Z',
    caseId: 'PMC-260830-0001', confirmationStatus: 'CONFIRMED', safeErrorCode: null,
    updatedAt: '2026-08-30T00:01:00.000Z',
  }
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
    const bytes = await response.arrayBuffer()
    return new Response(bytes, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
