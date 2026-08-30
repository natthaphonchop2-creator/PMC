import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppDraftStateIngress,
  canonicalMiniAppPrepareBinding,
  type MiniAppDraftEvidenceItem,
  type MiniAppDraftStateEnvelope,
  type MiniAppDraftStateMutation,
  type MiniAppNormalizedBookingInputV2,
} from '../../../shared/pmcMiniAppDraftState'
import type { MiniAppAsyncRequestRecord } from '../../../shared/pmcMiniAppAsyncState'
import { processBookingDoPost } from '../src/entrypoints'
import type { BookingPorts } from '../src/ports'
import { createTestPorts } from './helpers/fakes'

describe('Apps Script Mini App draft-state owner ingress', () => {
  it.each(['PREPARE_READY', 'PREPARE_PARTIAL'] as const)(
    'rejects direct %s that bypasses PREPARE_BEGIN without a row write',
    (operation) => {
      const fixture = draftStateFixture(draft())
      const evidence = operation === 'PREPARE_READY'
        ? [staged(0, 'PAYMENT'), staged(0, 'CHAT')]
        : [staged(0, 'PAYMENT'), staged(0, 'CHAT', null)]
      const before = fixture.requests.read()

      expect(() => processBookingDoPost(event(envelope(
        prepareMutation(operation, draft(), evidence),
        `nonce-bypass-${operation.toLowerCase()}`,
      )), fixture.ports)).toThrow(/begin|reservation|binding|conflict/i)
      expect(fixture.requests.read()).toEqual(before)
      expect(fixture.requests.writeCount).toBe(0)
    },
  )

  it('PREPARE_BEGIN reserves binding and exact attribution snapshots without customer or reference mutation', () => {
    const fixture = draftStateFixture(draft())
    const begin = beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')])
    const first = processBookingDoPost(event(envelope(begin, 'nonce-begin-first')), fixture.ports)
    const replay = processBookingDoPost(event(envelope(begin, 'nonce-begin-replay')), fixture.ports)

    expect(first).toMatchObject({ state: 'DRAFT', version: 2, outcome: 'APPLIED' })
    expect(replay).toMatchObject({ state: 'DRAFT', version: 2, outcome: 'IDEMPOTENT' })
    expect(fixture.requests.read()).toMatchObject({
      state: 'DRAFT', retentionState: '', evidenceProjectionHash: begin.prepareBindingHash,
      recorderName: 'Admin A', adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
      customerName: '', facebookName: '', doctorId: '', serviceId: '', channelId: '', evidenceCount: 0,
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
    })
    expect(fixture.requests.writeCount).toBe(1)
  })

  it.each([
    ['async READY', 'STAGED_OBJECT', 'PREPARE_READY'],
    ['sync PARTIAL', 'DRIVE_FILE', 'PREPARE_PARTIAL'],
  ] as const)('%s uses the reserved snapshots after mutable config changes', (_label, storage, operation) => {
    const fixture = draftStateFixture(draft())
    const complete = storage === 'STAGED_OBJECT'
      ? [staged(0, 'PAYMENT'), staged(0, 'CHAT')]
      : [drive(0, 'PAYMENT'), drive(0, 'CHAT')]
    const finalEvidence = operation === 'PREPARE_READY'
      ? complete
      : complete.map((item, index) => index === 0 ? item : { ...item, value: null })
    const begin = beginMutation(draft(), complete)
    processBookingDoPost(event(envelope(begin, `nonce-config-race-begin-${storage.toLowerCase()}`)), fixture.ports)

    fixture.ports.config.findStaffById = () => null
    fixture.ports.config.findDoctor = () => null
    fixture.ports.config.findService = () => null
    fixture.ports.config.findChannel = () => null

    const result = processBookingDoPost(event(envelope({
      ...prepareMutation(operation, fixture.requests.read()!, finalEvidence),
      prepareBindingHash: begin.prepareBindingHash,
      expectedVersion: 1,
    }, `nonce-config-race-final-${storage.toLowerCase()}`)), fixture.ports)

    expect(result).toMatchObject({ state: operation === 'PREPARE_READY' ? 'READY_TO_CONFIRM' : 'DRAFT' })
    expect(fixture.requests.read()).toMatchObject({
      recorderName: 'Admin A', adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
      retentionState: operation === 'PREPARE_PARTIAL' ? 'PENDING_APPROVAL' : '',
      evidenceCount: operation === 'PREPARE_PARTIAL' ? 1 : 2,
    })
  })

  it('PREPARE_BEGIN rejects an unbound terminal row but returns terminal for the same reserved binding', () => {
    const unbound = draft({ state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: 2 })
    const rejected = draftStateFixture(unbound)
    const begin = beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')])
    expect(() => processBookingDoPost(event(envelope(begin, 'nonce-begin-terminal-null')), rejected.ports))
      .toThrow(/terminal|begin/i)

    const reserved = draft({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: 3,
      evidenceProjectionHash: begin.prepareBindingHash,
      adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
    })
    const accepted = draftStateFixture(reserved)
    expect(processBookingDoPost(event(envelope(begin, 'nonce-begin-terminal-same')), accepted.ports))
      .toMatchObject({ state: 'CANCELLED', version: 3, outcome: 'TERMINAL' })
    expect(accepted.requests.writeCount).toBe(0)
  })

  it('persists partial refs without input, replays idempotently, then promotes the same binding to ready', () => {
    const fixture = draftStateFixture(draft())
    const partial = prepareMutation('PREPARE_PARTIAL', draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT', null)])
    processBookingDoPost(event(envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT', null)]), 'nonce-partial-begin')), fixture.ports)
    const first = processBookingDoPost(event(envelope(partial, 'nonce-draft-partial')), fixture.ports)
    const replay = processBookingDoPost(event(envelope(partial, 'nonce-draft-replay')), fixture.ports)
    const readyPayload = prepareMutation('PREPARE_READY', fixture.requests.read()!, [staged(0, 'PAYMENT'), staged(0, 'CHAT')], {
      expectedVersion: 1,
      prepareBindingHash: partial.prepareBindingHash,
    })
    const ready = processBookingDoPost(event(envelope(readyPayload, 'nonce-draft-ready')), fixture.ports)

    expect(first).toMatchObject({ state: 'DRAFT', version: 3, outcome: 'APPLIED' })
    expect(replay).toMatchObject({ state: 'DRAFT', version: 3, outcome: 'IDEMPOTENT' })
    expect(ready).toMatchObject({ state: 'READY_TO_CONFIRM', version: 4, outcome: 'APPLIED' })
    expect(fixture.requests.read()).toMatchObject({
      state: 'READY_TO_CONFIRM', retentionState: '', evidenceProjectionHash: partial.prepareBindingHash,
      adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
      customerName: 'ลูกค้า ทดสอบ', paymentEvidenceObjectKeys: [staged(0, 'PAYMENT').value],
      chatEvidenceObjectKeys: [staged(0, 'CHAT').value], evidenceCount: 2,
    })
  })

  it('keeps the first prepare binding authoritative under the owner lock', () => {
    const fixture = draftStateFixture(draft())
    const first = prepareMutation('PREPARE_PARTIAL', draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT', null)])
    processBookingDoPost(event(envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT', null)]), 'nonce-binding-begin')), fixture.ports)
    processBookingDoPost(event(envelope(first, 'nonce-binding-first')), fixture.ports)
    const authoritative = fixture.requests.read()
    const different = prepareMutation('PREPARE_READY', authoritative!, [staged(0, 'PAYMENT', undefined, 'c'), staged(0, 'CHAT')], {
      expectedVersion: 1,
    })

    expect(() => processBookingDoPost(event(envelope(different, 'nonce-binding-different')), fixture.ports))
      .toThrow(/binding|conflict/i)
    expect(fixture.requests.read()).toEqual(authoritative)
  })

  it('serializes READY before CANCEL so stale cancel cannot overwrite ready', () => {
    const fixture = draftStateFixture(draft())
    const ready = prepareMutation('PREPARE_READY', draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')])
    processBookingDoPost(event(envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]), 'nonce-ready-begin')), fixture.ports)
    processBookingDoPost(event(envelope(ready, 'nonce-ready-first')), fixture.ports)

    expect(() => processBookingDoPost(event(envelope(cancelMutation(1), 'nonce-cancel-late')), fixture.ports))
      .toThrow(/stale|conflict/i)
    expect(fixture.requests.read()).toMatchObject({ state: 'READY_TO_CONFIRM', version: 3 })
  })

  it('serializes CANCEL after BEGIN before READY and attaches every durable ref without reopening', () => {
    const fixture = draftStateFixture(draft())
    const ready = prepareMutation('PREPARE_READY', draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')])
    processBookingDoPost(event(envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]), 'nonce-cancel-begin')), fixture.ports)
    processBookingDoPost(event(envelope(cancelMutation(2), 'nonce-cancel-first')), fixture.ports)
    const result = processBookingDoPost(event(envelope(ready, 'nonce-ready-late')), fixture.ports)

    expect(result).toMatchObject({ state: 'CANCELLED', outcome: 'APPLIED' })
    expect(fixture.requests.read()).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', customerName: '', adminId: 'admin-1', adminName: 'Admin A',
      paymentEvidenceObjectKeys: [staged(0, 'PAYMENT').value],
      chatEvidenceObjectKeys: [staged(0, 'CHAT').value], evidenceCount: 2,
    })
  })

  it('canonical-unions five same-binding terminal subsets without orphaning a durable ref', () => {
    const fixture = draftStateFixture(draft())
    const all = [0, 1, 2, 3, 4].map((ordinal) => staged(ordinal, 'PAYMENT', undefined, ordinal.toString(16)))
    const base = prepareMutation('PREPARE_READY', draft(), [...all, staged(0, 'CHAT')])
    processBookingDoPost(event(envelope(beginMutation(draft(), [...all, staged(0, 'CHAT')]), 'nonce-five-begin')), fixture.ports)
    processBookingDoPost(event(envelope(cancelMutation(2), 'nonce-five-cancel')), fixture.ports)

    all.forEach((item, index) => {
      const evidence = [...all.map((candidate) => ({ ...candidate, value: candidate.ordinal === item.ordinal ? candidate.value : null })), staged(0, 'CHAT', null)]
      processBookingDoPost(event(envelope({
        ...base, operation: 'PREPARE_PARTIAL', evidence,
      }, `nonce-five-subset-${index}`)), fixture.ports)
    })

    expect(fixture.requests.read()).toMatchObject({
      state: 'CANCELLED', paymentEvidenceObjectKeys: all.map(({ value }) => value), evidenceCount: 5,
    })
  })

  it('rejects inactive/stale Admin config before any row write', () => {
    const fixture = draftStateFixture(draft())
    const findStaffById = fixture.ports.config.findStaffById
    fixture.ports.config.findStaffById = (id) => {
      const found = findStaffById(id)
      return found && id === 'admin-1' ? { ...found, active: false } : found
    }
    const before = fixture.requests.read()

    expect(() => processBookingDoPost(event(envelope(
      beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]),
      'nonce-inactive-admin',
    )), fixture.ports)).toThrow(/admin|config|active/i)
    expect(fixture.requests.read()).toEqual(before)
    expect(fixture.requests.writeCount).toBe(0)
  })

  it('returns only safe state metadata and a recomputable projection digest', () => {
    const fixture = draftStateFixture(draft())
    processBookingDoPost(event(envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]), 'nonce-safe-begin')), fixture.ports)
    const result = processBookingDoPost(event(envelope(
      prepareMutation('PREPARE_READY', draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]),
      'nonce-safe-result',
    )), fixture.ports) as Record<string, unknown>

    expect(Object.keys(result).sort()).toEqual([
      'draftId', 'outcome', 'projectionDigest', 'requestId', 'state', 'version',
    ])
    expect(result.projectionDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(result)).not.toMatch(/ลูกค้า|0812345678|drafts\//)
  })

  it('rejects unknown fields, altered signatures, and nonce replay before a second mutation', () => {
    const fixture = draftStateFixture(draft())
    const signed = envelope(beginMutation(draft(), [staged(0, 'PAYMENT'), staged(0, 'CHAT')]), 'nonce-security')
    const unknown = { ...signed, payload: { ...signed.payload, taskName: 'forbidden' } }
    const altered = { ...signed, payload: { ...signed.payload, expectedVersion: 99 } }

    expect(() => processBookingDoPost(event(unknown), fixture.ports)).toThrow()
    expect(() => processBookingDoPost(event(altered), fixture.ports)).toThrow(/signature/i)
    processBookingDoPost(event(signed), fixture.ports)
    expect(() => processBookingDoPost(event(signed), fixture.ports)).toThrow(/replay/i)
    expect(fixture.requests.writeCount).toBe(1)
  })
})

type P2Request = MiniAppAsyncRequestRecord & {
  protocolVersion: 2
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
}

function draft(patch: Partial<P2Request> = {}): P2Request {
  return {
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 2, staffId: 'admin-1', recorderName: 'Admin A',
    adminId: '', adminName: '', lineUserIdHash: 'line-user-hash', state: 'DRAFT', retentionState: '', version: 1,
    payloadHash: null, aeId: null, aeName: 'ไม่ระบุ', customerName: '', facebookName: '', phoneNormalized: '',
    doctorId: '', serviceId: '', queueType: 'NORMAL', appointmentDate: null, appointmentTime: null,
    depositAmount: 0, channelId: '', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    processingOwnerToken: null, evidenceProjectionHash: null, createdAt: '2026-08-30T09:00:00.000Z',
    confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-30T09:00:00.000Z', ...patch,
  }
}

function normalizedInput(): MiniAppNormalizedBookingInputV2 {
  return {
    requestId: 'request-1', adminId: 'admin-1', aeId: 'staff-ae', customerName: 'ลูกค้า ทดสอบ',
    facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1',
    queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900,
    channelId: 'เพจหลัก',
  }
}

function staged(
  ordinal: number,
  kind: 'PAYMENT' | 'CHAT',
  value: string | null | undefined = undefined,
  marker = kind === 'PAYMENT' ? 'a' : 'b',
): MiniAppDraftEvidenceItem {
  const hash = marker.repeat(64)
  const objectKey = `drafts/draft-1/${kind}/${hash}.png`
  return {
    kind, ordinal, contentSha256: hash, mimeType: 'image/png', storage: 'STAGED_OBJECT',
    value: value === undefined ? objectKey : value,
  }
}

function drive(ordinal: number, kind: 'PAYMENT' | 'CHAT', value: string | null | undefined = undefined): MiniAppDraftEvidenceItem {
  const marker = kind === 'PAYMENT' ? 'c' : 'd'
  return {
    kind, ordinal, contentSha256: marker.repeat(64), mimeType: 'image/png', storage: 'DRIVE_FILE',
    value: value === undefined ? `drive-file-${kind.toLowerCase()}-${ordinal}` : value,
  }
}

function prepareMutation(
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
  current: P2Request,
  evidence: MiniAppDraftEvidenceItem[],
  patch: Partial<Extract<MiniAppDraftStateMutation, { operation: 'PREPARE_READY' | 'PREPARE_PARTIAL' }>> = {},
): Extract<MiniAppDraftStateMutation, { operation: 'PREPARE_READY' | 'PREPARE_PARTIAL' }> {
  const input = normalizedInput()
  const binding = {
    requestId: current.requestId, draftId: current.draftId, baseVersion: 1, staffId: current.staffId,
    recorderName: current.recorderName, adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
    input, evidence: evidence.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.contentSha256,
      mimeType: item.mimeType, storage: item.storage,
    })),
  }
  return {
    operation, requestId: current.requestId, draftId: current.draftId, expectedVersion: current.version,
    expectedAttempt: current.attemptCount, baseVersion: 1, nowIso: '2026-08-30T10:00:00.000Z',
    prepareBindingHash: createHash('sha256').update(canonicalMiniAppPrepareBinding(binding)).digest('base64url'),
    input, evidence, ...patch,
  }
}

function beginMutation(
  current: P2Request,
  evidence: MiniAppDraftEvidenceItem[],
): Extract<MiniAppDraftStateMutation, { operation: 'PREPARE_BEGIN' }> {
  const ready = prepareMutation('PREPARE_READY', current, evidence)
  return {
    ...ready,
    operation: 'PREPARE_BEGIN',
    evidence: ready.evidence.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.contentSha256,
      mimeType: item.mimeType, storage: item.storage,
    })),
  }
}

function cancelMutation(expectedVersion: number): MiniAppDraftStateMutation {
  return {
    operation: 'CANCEL', requestId: 'request-1', draftId: 'draft-1', expectedVersion, expectedAttempt: 0,
    nowIso: '2026-08-30T10:00:00.000Z',
  }
}

function draftStateFixture(initial: P2Request) {
  let current = structuredClone(initial)
  const requests = {
    writeCount: 0,
    read: () => structuredClone(current),
    getByRequestId(requestId: string) { return current.requestId === requestId ? structuredClone(current) : null },
    updateByRequestId(requestId: string, expectedVersion: number, next: MiniAppAsyncRequestRecord) {
      if (current.requestId !== requestId || current.version !== expectedVersion) throw new Error('draft state version conflict')
      current = structuredClone(next as P2Request)
      this.writeCount += 1
      return structuredClone(current)
    },
  }
  const ports = createTestPorts() as unknown as BookingPorts & {
    miniAppRequests: typeof requests
    crypto: BookingPorts['crypto'] & { sha256Base64Url(value: string): string }
  }
  ports.miniAppRequests = requests
  ports.crypto.sha256Base64Url = (value) => createHash('sha256').update(value).digest('base64url')
  return { ports, requests }
}

function envelope(
  payload: MiniAppDraftStateMutation,
  nonce: string,
  timestamp = Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1_000),
): MiniAppDraftStateEnvelope {
  const unsigned = { kind: 'MINI_APP_DRAFT_STATE' as const, version: 1 as const, timestamp, nonce, payload }
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret').update(canonicalMiniAppDraftStateIngress(unsigned)).digest('hex'),
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
