import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import type { MiniAppDrivePort } from '../../server/pmc-mini-app/googleClient'
import { createPmcMiniAppMiddleware, type PmcMiniAppMiddlewareDependencies } from '../../server/pmc-mini-app/middleware'
import type { MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'

describe('PMC Mini App evidence API', () => {
  it('uploads repeated images in order with server-owned names and persists every file ID', async () => {
    const deps = dependencies()
    const form = new FormData()
    form.append('files', new Blob([pngBytes()], { type: 'image/png' }), '../../client-one.png')
    form.append('files', new Blob([pngBytes()], { type: 'image/png' }), 'client-two.png')

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=CHAT', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: {
        draftId: 'draft-1',
        requestId: 'request-1',
        state: 'DRAFT',
        retentionState: '',
        version: 5,
        input: null,
        paymentEvidenceIds: [],
        chatEvidenceIds: ['drive-file-1', 'drive-file-2'],
        confirmationStatus: null,
      },
    })
    expect(deps.drive.uploadEvidence).toHaveBeenNthCalledWith(1, expect.objectContaining({
      parentId: 'folder-1', draftId: 'draft-1', requestId: 'request-1', kind: 'CHAT', name: 'chat-upload-1.png',
    }))
    expect(deps.drive.uploadEvidence).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'chat-upload-2.png' }))
    expect(deps.currentDraft.chatEvidenceFileIds).toEqual(['drive-file-1', 'drive-file-2'])
  })

  it('rejects unsupported bytes before calling Drive', async () => {
    const deps = dependencies()
    const form = new FormData()
    form.append('files', new Blob([Buffer.from('GIF89a')], { type: 'image/png' }), 'fake.png')

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'UNSUPPORTED_EVIDENCE' })
    expect(deps.drive.uploadEvidence).not.toHaveBeenCalled()
  })

  it('uploads a real JPEG when the mobile browser advertises a generic MIME type', async () => {
    const deps = dependencies()
    const form = new FormData()
    form.append('files', new Blob([jpegBytes()], { type: 'application/octet-stream' }), 'slip.jpg')

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })

    expect(response.status).toBe(200)
    expect(deps.drive.uploadEvidence).toHaveBeenCalledWith(expect.objectContaining({
      name: 'payment-upload-1.jpg', mimeType: 'image/jpeg', bytes: jpegBytes(),
    }))
  })

  it('routes evidence through the owner ingress when the runtime service account cannot create My Drive files', async () => {
    const deps = dependencies()
    vi.mocked(deps.drive.uploadEvidence).mockRejectedValue(new Error('service account has no storage quota'))
    const form = new FormData()
    form.append('files', new Blob([jpegBytes()], { type: 'image/jpeg' }), 'slip.jpg')

    const response = await invoke(createPmcMiniAppMiddleware({
      ...deps,
      evidenceIngress: { upload: vi.fn(async () => 'owner-drive-file-1') },
    } as PmcMiniAppMiddlewareDependencies), '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: {
        draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 4,
        input: null, paymentEvidenceIds: ['owner-drive-file-1'], chatEvidenceIds: [], confirmationStatus: null,
      },
    })
    expect(deps.currentDraft.paymentEvidenceFileIds).toEqual(['owner-drive-file-1'])
  })

  it('does not reveal or modify a draft owned by another staff member', async () => {
    const deps = dependencies()
    const form = new FormData()
    form.append('files', new Blob([pngBytes()], { type: 'image/png' }), 'chat.png')

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=CHAT', {
      method: 'POST', headers: { authorization: 'Bearer other-staff-token' }, body: form,
    })

    expect(response.status).toBe(404)
    expect(deps.drive.uploadEvidence).not.toHaveBeenCalled()
  })

  it('refuses an eleventh file for one evidence kind', async () => {
    const deps = dependencies({ chatEvidenceFileIds: Array.from({ length: 10 }, (_, index) => `chat-${index}`), evidenceCount: 10 })
    const form = new FormData()
    form.append('files', new Blob([pngBytes()], { type: 'image/png' }), 'chat.png')

    const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=CHAT', {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: form,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'CHAT_EVIDENCE_LIMIT' })
    expect(deps.drive.uploadEvidence).not.toHaveBeenCalled()
  })
})

function dependencies(patch: Partial<MiniAppRequestRecord> = {}) {
  let currentDraft: MiniAppRequestRecord = {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    state: 'DRAFT', retentionState: '', version: 1, payloadHash: null, aeName: '', customerName: '', facebookName: '',
    phoneNormalized: '', doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null, appointmentTime: null,
    depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-27T10:00:00.000Z', ...patch,
  }
  let uploadCount = 0
  const randomIds = ['upload-1', 'upload-2']
  const identity: LineIdentityPort = {
    async verify(token) {
      if (token === 'valid-token') return { lineUserId: 'Uactive' }
      if (token === 'other-staff-token') return { lineUserId: 'Uother' }
      throw new Error('unauthorized')
    },
  }
  const store = {
    getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => ({
      id: lineUserId === 'Uother' ? 'staff-2' : 'staff-1', name: 'มัส', email: '', lineUserId,
      canCloseBooking: true, canBeAe: true, active: true as const, profileImageUrl: null,
    })),
    getDraft: vi.fn(async () => structuredClone(currentDraft)),
    updateDraft: vi.fn(async (_draftId: string, expectedVersion: number, next: Partial<MiniAppRequestRecord>) => {
      if (currentDraft.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
      currentDraft = { ...currentDraft, ...structuredClone(next), version: currentDraft.version + 1 }
      return structuredClone(currentDraft)
    }),
  } as unknown as MiniAppStore
  const drive = {
    uploadEvidence: vi.fn(async () => `drive-file-${++uploadCount}`),
    downloadEvidence: vi.fn(),
  } as unknown as MiniAppDrivePort & { uploadEvidence: ReturnType<typeof vi.fn> }
  const config: PmcMiniAppServerConfig = {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
  }
  return {
    config, identity, store, drive, now: () => new Date('2026-08-27T10:05:00.000Z'),
    randomId: () => randomIds.shift() ?? 'upload-extra',
    get currentDraft() { return currentDraft },
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
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
}

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
}
