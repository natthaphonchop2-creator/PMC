import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BookingPreparePersistenceError,
  persistPrepareEvidence,
  type PersistPrepareEvidenceInput,
} from '../../server/pmc-mini-app/bookingPrepare'
import type { EvidenceIngressPort } from '../../server/pmc-mini-app/evidenceIngressClient'
import type { EvidenceStagingPort } from '../../server/pmc-mini-app/stagingStore'
import type { MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'

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
    expect(fixture.store.writeCount()).toBe(1)
  })

  it('recovers an exact retry after response loss without another remote write', async () => {
    const fixture = prepareFixture('ASYNC')
    fixture.store.loseFirstUpdateResponse()
    const input = fixture.input()

    const first = await persistPrepareEvidence(input)
    const putsAfterFirst = fixture.staging!.putCount()
    const replay = await persistPrepareEvidence({ ...input, draft: fixture.store.read() })

    expect(first.draft).toEqual(replay.draft)
    expect(first.payment).toEqual(replay.payment)
    expect(first.chat).toEqual(replay.chat)
    expect(fixture.staging!.putCount()).toBe(putsAfterFirst)
    expect(fixture.store.writeCount()).toBe(1)
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
    expect(fixture.store.writeCount()).toBe(1)
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

    const createdBeforeRetry = fixture.staging!.createdCount()
    const recovered = await persistPrepareEvidence({ ...input, draft: partial })

    expect(recovered.draft).toMatchObject({ state: 'READY_TO_CONFIRM', retentionState: '', evidenceCount: 4 })
    expect(fixture.staging!.createdCount()).toBe(4)
    expect(fixture.staging!.createdCount()).toBeGreaterThan(createdBeforeRetry)
    expect(fixture.store.writeCount()).toBe(2)
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

  it('serializes synchronous Apps Script ingress and writes only one final ready draft', async () => {
    const fixture = prepareFixture('SYNC')

    const result = await persistPrepareEvidence(fixture.input({
      paymentFiles: [png(1), png(2), png(3)], chatFiles: [jpeg(4), jpeg(5)],
    }))

    expect(result.draft).toMatchObject({ state: 'READY_TO_CONFIRM', evidenceCount: 5 })
    expect(result.payment.map(({ storage }) => storage)).toEqual(['DRIVE_FILE', 'DRIVE_FILE', 'DRIVE_FILE'])
    expect(fixture.ingress?.maxActive()).toBe(1)
    expect(fixture.ingress?.callCount()).toBe(5)
    expect(fixture.store.writeCount()).toBe(1)
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
    expect(fixture.store.writeCount()).toBe(2)
  })

  it.each(['CANCELLED', 'EXPIRED'] as const)('keeps %s evidence pending approval without remote or draft mutation', async (state) => {
    const fixture = prepareFixture('ASYNC', { state, retentionState: 'PENDING_APPROVAL' })

    await expect(persistPrepareEvidence(fixture.input())).rejects.toMatchObject({ code: 'BOOKING_PREPARE_CONFLICT' })

    expect(fixture.staging!.putCount()).toBe(0)
    expect(fixture.store.writeCount()).toBe(0)
    expect(fixture.store.read()).toMatchObject({ state, retentionState: 'PENDING_APPROVAL' })
  })
})

function prepareFixture(mode: 'ASYNC' | 'SYNC', draftPatch: Partial<MiniAppRequestRecord> = {}) {
  const store = new PrepareStore(draft(draftPatch))
  const staging = mode === 'ASYNC' ? new PrepareStaging() : null
  const ingress = mode === 'SYNC' ? new PrepareIngress() : null
  return {
    store,
    staging,
    ingress,
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
        now: () => '2026-08-30T10:00:00.000Z',
        ...patch,
      }
    },
  }
}

class PrepareStore implements MiniAppStore {
  private current: MiniAppRequestRecord
  private writes = 0
  private loseUpdate = false

  constructor(initial: MiniAppRequestRecord) { this.current = structuredClone(initial) }
  read(): MiniAppRequestRecord { return structuredClone(this.current) }
  writeCount(): number { return this.writes }
  loseFirstUpdateResponse(): void { this.loseUpdate = true }
  async getActiveStaffByLineUserId(): Promise<never> { throw new Error('not used') }
  async getActiveBookingConfig(): Promise<never> { throw new Error('not used') }
  async createDraft(value: MiniAppRequestRecord) { this.current = structuredClone(value); return this.read() }
  async getDraft(draftId: string) { return draftId === this.current.draftId ? this.read() : null }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    if (draftId !== this.current.draftId) throw new Error('DRAFT_NOT_FOUND')
    if (expectedVersion !== this.current.version) throw new Error('STALE_DRAFT_VERSION')
    this.current = { ...this.current, ...structuredClone(patch), version: this.current.version + 1 }
    this.writes += 1
    if (this.loseUpdate) {
      this.loseUpdate = false
      throw new Error('SHEETS_RESPONSE_LOST')
    }
    return this.read()
  }
  async markRetentionPending(draftId: string, expectedVersion: number, updatedAt: string) {
    return this.updateDraft(draftId, expectedVersion, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async claimConfirmation(): Promise<never> { throw new Error('not used') }
  async completeConfirmation(): Promise<never> { throw new Error('not used') }
  async failConfirmation(): Promise<never> { throw new Error('not used') }
}

class PrepareStaging implements EvidenceStagingPort {
  private readonly objects = new Set<string>()
  private readonly oneTimeFailures = new Set<string>()
  private active = 0
  private highWater = 0
  private calls = 0

  failOnce(key: string): void { this.oneTimeFailures.add(key) }
  maxActive(): number { return this.highWater }
  putCount(): number { return this.calls }
  createdCount(): number { return this.objects.size }

  async put(input: Parameters<EvidenceStagingPort['put']>[0]) {
    this.calls += 1
    this.active += 1
    this.highWater = Math.max(this.highWater, this.active)
    const key = objectKey(input.kind, input.bytes)
    try {
      await new Promise((resolve) => setTimeout(resolve, 4))
      if (this.oneTimeFailures.delete(key)) throw new Error('CONTROLLED_STAGE_FAILURE')
      this.objects.add(key)
      return { objectKey: key, size: input.bytes.length, contentSha256: sha256(input.bytes) }
    } finally {
      this.active -= 1
    }
  }
  async get(): Promise<never> { throw new Error('not used') }
  async deleteVerified(): Promise<void> { throw new Error('must retain for approval') }
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
