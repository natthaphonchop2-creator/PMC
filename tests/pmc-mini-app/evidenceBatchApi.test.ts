import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcAsyncBookingConfig } from '../../server/pmc-mini-app/asyncConfig'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import type { MiniAppDrivePort } from '../../server/pmc-mini-app/googleClient'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import type { MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'

describe('PMC Mini App evidence batch API', () => {
  it('stages three payment files and one chat file with bounded concurrency and one ordered draft write', async () => {
    const deps = dependencies()
    const response = await uploadBatch(deps, [pngBytes(1), pngBytes(2), pngBytes(3)], [jpegBytes(4)])

    expect(response).toMatchObject({ status: 200, body: { state: 'DRAFT', version: 2 } })
    expect(deps.storeFixture.writeCount()).toBe(1)
    expect(deps.storeFixture.read().paymentEvidenceObjectKeys).toEqual([
      objectKey('PAYMENT', pngBytes(1)), objectKey('PAYMENT', pngBytes(2)), objectKey('PAYMENT', pngBytes(3)),
    ])
    expect(deps.storeFixture.read().chatEvidenceObjectKeys).toEqual([objectKey('CHAT', jpegBytes(4))])
    expect(deps.storeFixture.read().evidenceCount).toBe(4)
    expect(deps.stagingFixture.maxActive()).toBeLessThanOrEqual(4)
  })

  it('keeps the authoritative staged evidence write when telemetry throws', async () => {
    const deps = { ...dependencies(), asyncTelemetry: vi.fn(() => { throw new Error('telemetry must not block') }) }

    const response = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)])

    expect(response).toMatchObject({ status: 200, body: { state: 'DRAFT' } })
    expect(deps.storeFixture.read().evidenceCount).toBe(2)
  })

  it('never runs more than four staging writes at once', async () => {
    const deps = dependencies()

    const response = await uploadBatch(
      deps,
      Array.from({ length: 5 }, (_, index) => pngBytes(index + 1)),
      Array.from({ length: 3 }, (_, index) => jpegBytes(index + 10)),
    )

    expect(response.status).toBe(200)
    expect(deps.stagingFixture.maxActive()).toBe(4)
  })

  it('keeps the batch response in DRAFT and lets the later booking-input PATCH make it ready', async () => {
    const deps = dependencies()
    const uploaded = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)])

    const patched = await jsonRequest(
      createPmcMiniAppMiddleware(deps),
      'PATCH',
      '/api/mini-app/booking-drafts/draft-1',
      { version: uploaded.body.version, input: validInput() },
    )

    expect(uploaded.body.state).toBe('DRAFT')
    expect(patched).toMatchObject({ status: 200, body: { state: 'READY_TO_CONFIRM' } })
    expect(deps.storeFixture.read().paymentEvidenceFileIds).toEqual([])
    expect(deps.storeFixture.read().paymentEvidenceObjectKeys).toEqual([objectKey('PAYMENT', pngBytes(1))])
  })

  it('recovers a partial network failure deterministically without duplicate objects or a partial draft write', async () => {
    const deps = dependencies()
    deps.stagingFixture.failOnceFor(objectKey('PAYMENT', pngBytes(2)))

    const failed = await uploadBatch(deps, [pngBytes(1), pngBytes(2), pngBytes(3)], [jpegBytes(4)])
    expect(failed).toEqual({ status: 503, body: { error: 'EVIDENCE_UPLOAD_FAILED' } })
    expect(deps.storeFixture.writeCount()).toBe(0)

    const retried = await uploadBatch(deps, [pngBytes(1), pngBytes(2), pngBytes(3)], [jpegBytes(4)])

    expect(retried.status).toBe(200)
    expect(deps.storeFixture.writeCount()).toBe(1)
    expect(deps.storeFixture.read().evidenceCount).toBe(4)
    expect(new Set([
      ...deps.storeFixture.read().paymentEvidenceObjectKeys,
      ...deps.storeFixture.read().chatEvidenceObjectKeys,
    ]).size).toBe(4)
    expect(deps.stagingFixture.createdObjectCount()).toBe(4)
  })

  it('reuses deterministic objects when the client repeats the complete batch', async () => {
    const deps = dependencies()
    const first = await uploadBatch(deps, [pngBytes(1), pngBytes(2)], [jpegBytes(3)])
    const firstKeys = deps.storeFixture.read().paymentEvidenceObjectKeys
    const repeated = await uploadBatch(deps, [pngBytes(1), pngBytes(2)], [jpegBytes(3)])

    expect(first.status).toBe(200)
    expect(repeated.status).toBe(200)
    expect(deps.storeFixture.read().paymentEvidenceObjectKeys).toEqual(firstKeys)
    expect(deps.storeFixture.read().evidenceCount).toBe(3)
    expect(deps.stagingFixture.createdObjectCount()).toBe(3)
  })

  it('verifies active identity, ownership, and uploadable state before staging', async () => {
    const deps = dependencies()
    const inactive = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)], 'inactive-staff-token')
    expect(inactive.status).toBe(403)
    expect(deps.stagingFixture.putCount()).toBe(0)

    const otherOwner = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)], 'other-staff-token')
    expect(otherOwner.status).toBe(404)
    expect(deps.stagingFixture.putCount()).toBe(0)

    deps.storeFixture.replace({ state: 'READY_TO_CONFIRM' })
    const wrongState = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)])
    expect(wrongState).toEqual({ status: 409, body: { error: 'DRAFT_NOT_UPLOADABLE' } })
    expect(deps.stagingFixture.putCount()).toBe(0)
  })

  it('keeps the legacy evidence endpoint active when async mode is disabled or the staff is not an async owner', async () => {
    const disabled = dependencies({ asyncBooking: null })
    expect((await uploadLegacy(disabled, 'valid-token')).status).toBe(200)
    expect(disabled.drive.uploadEvidence).toHaveBeenCalledOnce()

    const nonOwner = dependencies({ ownerStaffIds: new Set(['staff-owner']) })
    expect((await uploadLegacy(nonOwner, 'valid-token')).status).toBe(200)
    expect(nonOwner.drive.uploadEvidence).toHaveBeenCalledOnce()
  })

  it('marks cancellation with staged keys pending approval without deleting staged objects', async () => {
    const deps = dependencies()
    const uploaded = await uploadBatch(deps, [pngBytes(1)], [jpegBytes(2)])
    const cancelled = await jsonRequest(
      createPmcMiniAppMiddleware(deps),
      'POST',
      '/api/mini-app/booking-drafts/draft-1/cancel',
      { version: uploaded.body.version },
    )
    const replay = await jsonRequest(
      createPmcMiniAppMiddleware(deps),
      'POST',
      '/api/mini-app/booking-drafts/draft-1/cancel',
      { version: uploaded.body.version },
    )

    expect(cancelled).toMatchObject({ status: 200, body: { state: 'CANCELLED', retentionState: 'PENDING_APPROVAL' } })
    expect(replay).toEqual(cancelled)
    expect(deps.storeFixture.read().paymentEvidenceObjectKeys).toEqual([objectKey('PAYMENT', pngBytes(1))])
    expect(deps.storeFixture.writeCount()).toBe(2)
    expect(deps.stagingFixture.deleteCount()).toBe(0)
  })
})

function dependencies(options: { asyncBooking?: PmcAsyncBookingConfig | null; ownerStaffIds?: ReadonlySet<string> } = {}) {
  const storeFixture = new TestStore()
  const stagingFixture = new TestStagingPort()
  const identity: LineIdentityPort = {
    async verify(token) {
      if (token === 'valid-token') return { lineUserId: 'Uactive' }
      if (token === 'other-staff-token') return { lineUserId: 'Uother' }
      if (token === 'inactive-staff-token') return { lineUserId: 'Uinactive' }
      throw new Error('unauthorized')
    },
  }
  const drive = {
    uploadEvidence: vi.fn(async () => 'drive-file-1'),
    downloadEvidence: vi.fn(),
  } as unknown as MiniAppDrivePort & { uploadEvidence: ReturnType<typeof vi.fn> }
  const asyncBooking = options.asyncBooking === undefined
    ? asyncConfig(options.ownerStaffIds ?? new Set(['staff-1']))
    : options.asyncBooking
  const config: PmcMiniAppServerConfig = {
    enabled: true, miniAppId: '2001234567-mini-app', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'ingress-secret',
    signingSecret: 'signing-secret', enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10, asyncBooking,
  }
  return {
    config,
    identity,
    store: storeFixture as MiniAppStore,
    drive,
    evidenceStaging: stagingFixture as EvidenceStagingPort,
    now: () => new Date('2026-08-28T10:00:00.000Z'),
    randomId: () => 'legacy-upload',
    storeFixture,
    stagingFixture,
  }
}

class TestStore implements MiniAppStore {
  private draft = draftFixture()
  private writes = 0

  read(): MiniAppRequestRecord { return structuredClone(this.draft) }
  writeCount(): number { return this.writes }
  replace(patch: Partial<MiniAppRequestRecord>): void { this.draft = { ...this.draft, ...structuredClone(patch) } }
  async getActiveStaffByLineUserId(lineUserId: string) {
    if (lineUserId === 'Uinactive') return null
    return {
      id: lineUserId === 'Uother' ? 'staff-2' : 'staff-1', name: 'active', email: '', lineUserId,
      canCloseBooking: true, canBeAe: true, active: true as const, profileImageUrl: null,
    }
  }
  async getActiveBookingConfig() {
    return {
      doctors: [{ id: 'doctor-1', name: 'doctor' }],
      services: [{ id: 'service-1', name: 'service', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'channel' }],
      aes: [{ id: 'staff-1', name: 'active' }],
    }
  }
  async createDraft(draft: MiniAppRequestRecord) { this.draft = structuredClone(draft); return this.read() }
  async getDraft(draftId: string) { return draftId === this.draft.draftId ? this.read() : null }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    if (draftId !== this.draft.draftId) throw new Error('DRAFT_NOT_FOUND')
    if (expectedVersion !== this.draft.version) throw new Error('STALE_DRAFT_VERSION')
    this.draft = { ...this.draft, ...structuredClone(patch), version: this.draft.version + 1 }
    this.writes += 1
    return this.read()
  }
  async markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string) {
    return this.updateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async claimConfirmation(): Promise<never> { throw new Error('not used') }
  async completeConfirmation(): Promise<never> { throw new Error('not used') }
  async failConfirmation(): Promise<never> { throw new Error('not used') }
}

class TestStagingPort implements EvidenceStagingPort {
  private readonly objects = new Set<string>()
  private readonly oneTimeFailures = new Set<string>()
  private active = 0
  private activeHighWater = 0
  private puts = 0
  private deletes = 0

  failOnceFor(key: string): void { this.oneTimeFailures.add(key) }
  maxActive(): number { return this.activeHighWater }
  putCount(): number { return this.puts }
  deleteCount(): number { return this.deletes }
  createdObjectCount(): number { return this.objects.size }

  async put(input: Parameters<EvidenceStagingPort['put']>[0]) {
    this.puts += 1
    this.active += 1
    this.activeHighWater = Math.max(this.activeHighWater, this.active)
    const key = objectKey(input.kind, input.bytes)
    try {
      await new Promise((resolve) => setTimeout(resolve, 6 - (input.bytes.at(-1) ?? 0) % 5))
      if (this.oneTimeFailures.delete(key)) throw new Error('temporary staging failure')
      this.objects.add(key)
      return { objectKey: key, size: input.bytes.length, contentSha256: sha256(input.bytes) }
    } finally {
      this.active -= 1
    }
  }
  async get(): Promise<never> { throw new Error('not used') }
  async deleteVerified(): Promise<void> { this.deletes += 1 }
}

async function uploadBatch(
  deps: ReturnType<typeof dependencies>,
  payments: Buffer[],
  chats: Buffer[],
  token = 'valid-token',
) {
  const form = new FormData()
  payments.forEach((bytes, index) => form.append('paymentFiles', new Blob([bytes]), `payment-${index}.png`))
  chats.forEach((bytes, index) => form.append('chatFiles', new Blob([bytes]), `chat-${index}.jpg`))
  const response = await invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence-batch', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function uploadLegacy(deps: ReturnType<typeof dependencies>, token: string) {
  const form = new FormData()
  form.append('files', new Blob([pngBytes(1)]), 'payment.png')
  return invoke(createPmcMiniAppMiddleware(deps), '/api/mini-app/booking-drafts/draft-1/evidence?kind=PAYMENT', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  })
}

function asyncConfig(ownerStaffIds: ReadonlySet<string>): PmcAsyncBookingConfig {
  return {
    enabled: true, projectId: 'pmc-project', location: 'asia-southeast1', bucketName: 'pmc-private-stage',
    queueName: 'pmc-bookings', workerUrl: 'https://worker.example.test/run', workerAudience: 'https://worker.example.test',
    taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com', ownerStaffIds, maxBatchBytes: 25_000_000,
  }
}

function draftFixture(): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    state: 'DRAFT', retentionState: '', version: 1, payloadHash: null, aeName: '', customerName: '', facebookName: '',
    phoneNormalized: '', doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null, appointmentTime: null,
    depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null, processingStartedAt: null,
    processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    createdAt: '2026-08-28T09:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-28T09:00:00.000Z',
  }
}

function objectKey(kind: 'PAYMENT' | 'CHAT', bytes: Buffer): string {
  const mimeExtension = bytes[0] === 0xff ? 'jpg' : 'png'
  return `drafts/draft-1/${kind}/${sha256(bytes)}.${mimeExtension}`
}

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }
function pngBytes(marker: number): Buffer { return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]) }
function jpegBytes(marker: number): Buffer { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker]) }
function validInput() {
  return {
    requestId: 'request-1', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
  }
}

async function jsonRequest(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
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
