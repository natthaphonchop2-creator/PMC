import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppAsyncIdentity,
  canonicalMiniAppAsyncStateIngress,
  type MiniAppAsyncRequestRecord,
  type MiniAppAsyncStateIngressEnvelope,
  type MiniAppAsyncStateMutation,
} from '../../../shared/pmcMiniAppAsyncState'
import { processBookingDoPost } from '../src/entrypoints'
import type { BookingPorts } from '../src/ports'
import { createTestPorts } from './helpers/fakes'

describe('Apps Script Mini App async-state ingress', () => {
  it('owner-lock retention converges same-binding disjoint terminal subsets and preserves business fields', () => {
    const terminal = queuedRequest({
      state: 'CANCELLED', version: 2, payloadHash: null, taskName: null, queuedAt: null,
      retentionState: 'PENDING_APPROVAL', paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0, evidenceProjectionHash: null,
    })
    const fixture = stateFixture(terminal)
    const binding = 'p'.repeat(43)
    const first = processBookingDoPost(event(envelope(retentionMutation({
      payloadHash: binding,
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'b')],
      evidenceCount: 1,
    }), 'nonce-retain-first')), fixture.ports)
    const second = processBookingDoPost(event(envelope(retentionMutation({
      payloadHash: binding,
      expectedVersion: 2,
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'a')],
      chatEvidenceObjectKeys: [objectKey('CHAT', 'c')],
      evidenceCount: 2,
    }), 'nonce-retain-second')), fixture.ports)
    const replay = processBookingDoPost(event(envelope(retentionMutation({
      payloadHash: binding,
      expectedVersion: 2,
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'b')],
      evidenceCount: 1,
    }), 'nonce-retain-replay')), fixture.ports)

    expect(first).toMatchObject({ state: 'CANCELLED', outcome: 'APPLIED' })
    expect(second).toMatchObject({ state: 'CANCELLED', outcome: 'APPLIED' })
    expect(replay).toMatchObject({ state: 'CANCELLED', outcome: 'IDEMPOTENT' })
    expect(fixture.requests.read('request-1')).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: binding,
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'a'), objectKey('PAYMENT', 'b')],
      chatEvidenceObjectKeys: [objectKey('CHAT', 'c')], evidenceCount: 3,
      customerName: terminal.customerName, facebookName: terminal.facebookName, doctorId: terminal.doctorId,
    })
    expect(fixture.requests.writeCount).toBe(2)
  })

  it('keeps the first durable prepare binding authoritative against an independent client', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'EXPIRED', version: 2, payloadHash: null, taskName: null, queuedAt: null,
      retentionState: 'PENDING_APPROVAL', paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0, evidenceProjectionHash: null,
    }))
    const first = retentionMutation({
      payloadHash: 'a'.repeat(43), paymentEvidenceObjectKeys: [],
      paymentEvidenceFileIds: ['drive-payment-1'], evidenceCount: 1,
    })
    const competing = retentionMutation({
      payloadHash: 'b'.repeat(43), paymentEvidenceObjectKeys: [],
      paymentEvidenceFileIds: ['drive-payment-2'], evidenceCount: 1,
    })
    processBookingDoPost(event(envelope(first, 'nonce-retain-winner')), fixture.ports)
    const authoritative = fixture.requests.read('request-1')

    expect(() => processBookingDoPost(event(envelope(competing, 'nonce-retain-loser')), fixture.ports))
      .toThrow(/prepare.*conflict|payload.*conflict/i)
    expect(fixture.requests.read('request-1')).toEqual(authoritative)
    expect(fixture.requests.writeCount).toBe(1)
  })

  it('retains the union from five same-binding cancel/expiry recoveries without orphaning a reference', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'CANCELLED', version: 2, payloadHash: null, taskName: null, queuedAt: null,
      retentionState: 'PENDING_APPROVAL', paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0, evidenceProjectionHash: null,
    }))
    const binding = 'c'.repeat(43)
    const keys = ['a', 'b', 'c', 'd', 'e'].map((marker) => objectKey('PAYMENT', marker))

    keys.forEach((key, index) => {
      processBookingDoPost(event(envelope(retentionMutation({
        payloadHash: binding,
        expectedVersion: 2,
        paymentEvidenceObjectKeys: [key],
        evidenceCount: 1,
      }), `nonce-retain-five-${index}`)), fixture.ports)
    })

    expect(fixture.requests.read('request-1')).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: binding,
      paymentEvidenceObjectKeys: keys, evidenceCount: 5,
    })
    expect(fixture.requests.writeCount).toBe(5)
  })

  it('rejects a same-binding terminal union that would exceed a per-kind evidence limit', () => {
    const existing = Array.from({ length: 10 }, (_, index) => objectKey('PAYMENT', index.toString(16)))
    const fixture = stateFixture(queuedRequest({
      state: 'CANCELLED', version: 3, payloadHash: null, taskName: null, queuedAt: null,
      retentionState: 'PENDING_APPROVAL', paymentEvidenceObjectKeys: existing, chatEvidenceObjectKeys: [],
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 10, evidenceProjectionHash: 'd'.repeat(43),
    }))
    const before = fixture.requests.read('request-1')

    expect(() => processBookingDoPost(event(envelope(retentionMutation({
      payloadHash: 'd'.repeat(43),
      expectedVersion: 2,
      paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'e')],
      evidenceCount: 1,
    }), 'nonce-retain-over-limit')), fixture.ports)).toThrow(/limit|retention/i)
    expect(fixture.requests.read('request-1')).toEqual(before)
  })

  it.each([
    ['non-null task', { taskName: 'task/forbidden' }],
    ['non-null lease', { leaseOwnerToken: 'worker-owner-token-1', leaseUntil: '2026-08-20T09:01:00+07:00' }],
    ['wrong attempt', { expectedAttempt: 1 }],
    ['mixed storage', { paymentEvidenceFileIds: ['drive-payment-1'] }],
    ['wrong count', { evidenceCount: 2 }],
  ])('rejects RETAIN_PREPARE with %s before terminal mutation', (_label, patch) => {
    const fixture = stateFixture(queuedRequest({
      state: 'CANCELLED', version: 2, payloadHash: null, taskName: null, queuedAt: null,
      retentionState: 'PENDING_APPROVAL', paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0, evidenceProjectionHash: null,
    }))
    const before = fixture.requests.read('request-1')

    expect(() => processBookingDoPost(event(envelope(retentionMutation(patch), 'nonce-retain-invalid')), fixture.ports))
      .toThrow()
    expect(fixture.requests.read('request-1')).toEqual(before)
    expect(fixture.requests.writeCount).toBe(0)
  })

  it('serializes QUEUE and task-delivery CLAIM without regressing a winning processing row', () => {
    const ready = queuedRequest({ state: 'READY_TO_CONFIRM', version: 1, payloadHash: null, taskName: null, queuedAt: null })
    const queueFirst = stateFixture(ready)
    const queued = processBookingDoPost(event(envelope(mutation({
      operation: 'QUEUE', expectedVersion: 1, expectedAttempt: 0, leaseOwnerToken: null,
      leaseUntil: null, taskName: 'task/request-1', payloadHash: createHash('sha256')
        .update(canonicalMiniAppAsyncIdentity(ready)).digest('base64url'),
    }))), queueFirst.ports)
    const queueReplay = processBookingDoPost(event(envelope(mutation({
      operation: 'QUEUE', expectedVersion: 1, expectedAttempt: 0, leaseOwnerToken: null,
      leaseUntil: null, taskName: 'task/request-1', payloadHash: queuedRequest().payloadHash!,
    }), 'nonce-queue-replay')), queueFirst.ports)

    expect(queued).toMatchObject({ state: 'QUEUED', version: 2, outcome: 'APPLIED' })
    expect(queueReplay).toMatchObject({ state: 'QUEUED', version: 2, outcome: 'IDEMPOTENT' })

    const claimFirst = stateFixture(ready)
    const claimed = processBookingDoPost(event(envelope(mutation({
      expectedVersion: 1, expectedAttempt: 0, taskName: null, payloadHash: queuedRequest().payloadHash!,
    }))), claimFirst.ports)
    const lateQueue = processBookingDoPost(event(envelope(mutation({
      operation: 'QUEUE', expectedVersion: 1, expectedAttempt: 0, leaseOwnerToken: null,
      leaseUntil: null, taskName: 'task/request-1', payloadHash: queuedRequest().payloadHash!,
    }), 'nonce-late-queue')), claimFirst.ports)

    expect(claimed).toMatchObject({ state: 'PROCESSING', version: 2, outcome: 'APPLIED' })
    expect(lateQueue).toMatchObject({ state: 'PROCESSING', version: 2, outcome: 'IDEMPOTENT' })
    expect(claimFirst.requests.writeCount).toBe(1)
  })

  it('serializes competing claims, returns one owner, and recovers response loss idempotently', () => {
    const fixture = stateFixture(queuedRequest())
    const first = processBookingDoPost(event(envelope(mutation())), fixture.ports)
    const responseLossRetry = processBookingDoPost(event(envelope(mutation(), 'nonce-state-0002')), fixture.ports)
    const competing = processBookingDoPost(event(envelope(mutation({
      leaseOwnerToken: 'worker-owner-token-2',
    }), 'nonce-state-0003')), fixture.ports)

    expect(first).toMatchObject({ state: 'PROCESSING', version: 4, attemptCount: 1, outcome: 'APPLIED' })
    expect(responseLossRetry).toMatchObject({ state: 'PROCESSING', version: 4, attemptCount: 1, outcome: 'IDEMPOTENT' })
    expect(competing).toMatchObject({ state: 'PROCESSING', version: 4, attemptCount: 1, outcome: 'BUSY' })
    expect(fixture.requests.read('request-1')).toMatchObject({
      state: 'PROCESSING', version: 4, attemptCount: 1, processingOwnerToken: 'worker-owner-token-1',
    })
    expect(fixture.requests.writeCount).toBe(1)
  })

  it.each(['RENEW', 'PROJECT', 'RETRY', 'COMPLETE'] as const)(
    'rejects stale %s after another owner reclaims the expired attempt',
    (operation) => {
      const expired = queuedRequest({
        state: 'PROCESSING', version: 4, attemptCount: 1, processingOwnerToken: 'worker-owner-token-1',
        processingStartedAt: '2026-08-20T08:58:00+07:00', processingLeaseUntil: '2026-08-20T08:59:00+07:00',
        lastProgressAt: '2026-08-20T08:58:00+07:00',
      })
      const fixture = stateFixture(expired)
      processBookingDoPost(event(envelope(mutation({
        operation: 'CLAIM', expectedVersion: 4, expectedAttempt: 1,
        leaseOwnerToken: 'worker-owner-token-2',
      }))), fixture.ports)
      const reclaimed = fixture.requests.read('request-1')!

      expect(() => processBookingDoPost(event(envelope(mutation({
        operation,
        expectedVersion: 4,
        expectedAttempt: 1,
        leaseOwnerToken: 'worker-owner-token-1',
        paymentEvidenceFileIds: ['owner-drive-payment-1'],
        chatEvidenceFileIds: ['owner-drive-chat-1'],
        caseId: operation === 'COMPLETE' ? 'PMC-202608-0001' : null,
        confirmationStatus: operation === 'COMPLETE' ? 'CONFIRMED' : null,
        safeErrorCode: operation === 'RETRY' ? 'EVIDENCE_COPY_RETRY' : null,
      }), `nonce-stale-${operation.toLowerCase()}`)), fixture.ports)).toThrow(/stale|owner|lease/i)
      expect(fixture.requests.read('request-1')).toEqual(reclaimed)
    },
  )

  it('projects only exact staged bindings and completes only for the current owner', () => {
    const fixture = stateFixture(queuedRequest())
    processBookingDoPost(event(envelope(mutation())), fixture.ports)

    const projected = processBookingDoPost(event(envelope(mutation({
      operation: 'PROJECT', expectedVersion: 4, expectedAttempt: 1,
      paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'],
    }), 'nonce-project-1')), fixture.ports)
    const completed = processBookingDoPost(event(envelope(mutation({
      operation: 'COMPLETE', expectedVersion: 5, expectedAttempt: 1,
      paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'],
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }), 'nonce-complete-1')), fixture.ports)

    expect(projected).toMatchObject({ state: 'PROCESSING', version: 5, outcome: 'APPLIED' })
    expect(completed).toMatchObject({ state: 'CONFIRMED', version: 6, outcome: 'APPLIED' })
    expect(fixture.requests.read('request-1')).toMatchObject({
      state: 'CONFIRMED', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
      processingOwnerToken: null, processingLeaseUntil: null,
      evidenceProjectionHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
  })

  it('rejects completion when the persisted projection hash does not match the exact ordered evidence', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'PROCESSING', version: 5, attemptCount: 1, processingOwnerToken: 'worker-owner-token-1',
      processingStartedAt: '2026-08-20T09:00:00+07:00', processingLeaseUntil: '2026-08-20T09:00:15+07:00',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'],
      evidenceProjectionHash: 'wrong-projection-hash',
    }))

    expect(() => processBookingDoPost(event(envelope(mutation({
      operation: 'COMPLETE', expectedVersion: 5, expectedAttempt: 1,
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'],
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }))), fixture.ports)).toThrow(/projection hash/i)
    expect(fixture.requests.read('request-1')).toMatchObject({ state: 'PROCESSING', version: 5 })
  })

  it('atomically fences a live nonterminal row to NEEDS_REVIEW only for task attempt eight', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'PROCESSING', version: 4, attemptCount: 1, processingOwnerToken: 'worker-owner-token-1',
      processingStartedAt: '2026-08-20T08:59:00+07:00', processingLeaseUntil: '2026-08-20T09:01:00+07:00',
      lastProgressAt: '2026-08-20T08:59:00+07:00',
    }))

    const result = processBookingDoPost(event(envelope(mutation({
      operation: 'EXHAUST', expectedVersion: 4, expectedAttempt: 1, taskAttempt: 8,
      leaseOwnerToken: null, leaseUntil: null, safeErrorCode: 'RETRY_EXHAUSTED',
    }))), fixture.ports)

    expect(result).toMatchObject({ state: 'NEEDS_REVIEW', version: 5, outcome: 'APPLIED' })
    expect(fixture.requests.read('request-1')).toMatchObject({
      state: 'NEEDS_REVIEW', safeErrorCode: 'RETRY_EXHAUSTED', processingOwnerToken: null,
      processingLeaseUntil: null,
    })
  })

  it('fences an invalid terminal projection to NEEDS_REVIEW instead of returning it as terminal success', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'CONFIRMED', version: 6, attemptCount: 1, processingOwnerToken: null,
      processingLeaseUntil: null, paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: [], evidenceCount: 1, caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }))

    const result = processBookingDoPost(event(envelope(mutation({
      operation: 'EXHAUST', expectedVersion: 6, expectedAttempt: 1, taskAttempt: 8,
      leaseOwnerToken: null, leaseUntil: null, safeErrorCode: 'RETRY_EXHAUSTED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: [], evidenceCount: 1,
    }))), fixture.ports)

    expect(result).toMatchObject({ state: 'NEEDS_REVIEW', version: 7, outcome: 'APPLIED' })
    expect(fixture.requests.read('request-1')).toMatchObject({ state: 'NEEDS_REVIEW' })
  })

  it('fences a terminal row with malformed Case ID even when evidence counts are complete', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'CONFIRMED', version: 6, attemptCount: 1, processingOwnerToken: null,
      processingLeaseUntil: null, paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
      caseId: 'bad-case', confirmationStatus: 'CONFIRMED',
    }))

    const result = processBookingDoPost(event(envelope(mutation({
      operation: 'EXHAUST', expectedVersion: 6, expectedAttempt: 1, taskAttempt: 8,
      leaseOwnerToken: null, leaseUntil: null, safeErrorCode: 'RETRY_EXHAUSTED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
    }))), fixture.ports)

    expect(result).toMatchObject({ state: 'NEEDS_REVIEW', version: 7, outcome: 'APPLIED' })
  })

  it('fences a terminal row whose safe Drive IDs differ from the expected completion binding', () => {
    const fixture = stateFixture(queuedRequest({
      state: 'CONFIRMED', version: 6, attemptCount: 1, processingOwnerToken: null,
      processingLeaseUntil: null, paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['other-drive-chat-1'], evidenceCount: 2,
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }))

    const result = processBookingDoPost(event(envelope(mutation({
      operation: 'EXHAUST', expectedVersion: 6, expectedAttempt: 1, taskAttempt: 8,
      leaseOwnerToken: null, leaseUntil: null, safeErrorCode: 'RETRY_EXHAUSTED',
      paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'], evidenceCount: 2,
    }))), fixture.ports)

    expect(result).toMatchObject({ state: 'NEEDS_REVIEW', version: 7, outcome: 'APPLIED' })
  })

  it('rejects unknown keys, altered signatures, expired timestamps, and nonce replay before mutation', () => {
    const fixture = stateFixture(queuedRequest())
    const signed = envelope(mutation())
    const unknown = { ...signed, payload: { ...signed.payload, customerName: 'forbidden' } }
    const altered = { ...signed, payload: { ...signed.payload, expectedVersion: 99 } }
    const expired = envelope(mutation(), 'nonce-expired-1', Math.floor(Date.parse('2026-08-19T09:00:00+07:00') / 1_000))

    expect(() => processBookingDoPost(event(unknown), fixture.ports)).toThrow()
    expect(() => processBookingDoPost(event(altered), fixture.ports)).toThrow(/signature/i)
    expect(() => processBookingDoPost(event(expired), fixture.ports)).toThrow(/expired/i)
    processBookingDoPost(event(signed), fixture.ports)
    expect(() => processBookingDoPost(event(signed), fixture.ports)).toThrow(/replay/i)
  })
})

interface MemoryAsyncRequests {
  read(requestId: string): MiniAppAsyncRequestRecord | null
  getByRequestId(requestId: string): MiniAppAsyncRequestRecord | null
  updateByRequestId(requestId: string, expectedVersion: number, next: MiniAppAsyncRequestRecord): MiniAppAsyncRequestRecord
  writeCount: number
}

function stateFixture(initial: MiniAppAsyncRequestRecord) {
  let current = structuredClone(initial)
  const requests: MemoryAsyncRequests = {
    writeCount: 0,
    read(requestId) { return current.requestId === requestId ? structuredClone(current) : null },
    getByRequestId(requestId) { return this.read(requestId) },
    updateByRequestId(requestId, expectedVersion, next) {
      if (current.requestId !== requestId) throw new Error('async request not found')
      if (current.version !== expectedVersion) throw new Error('async state version conflict')
      current = structuredClone(next)
      this.writeCount += 1
      return structuredClone(current)
    },
  }
  const ports = createTestPorts() as unknown as BookingPorts & {
    miniAppRequests: MemoryAsyncRequests
    crypto: BookingPorts['crypto'] & { sha256Base64Url(value: string): string }
  }
  ports.miniAppRequests = requests
  ports.crypto.sha256Base64Url = (value) => createHash('sha256').update(value).digest('base64url')
  return { ports, requests }
}

function mutation(patch: Partial<MiniAppAsyncStateMutation> = {}): MiniAppAsyncStateMutation {
  const row = queuedRequest()
  return {
    operation: 'CLAIM', requestId: row.requestId, draftId: row.draftId, payloadHash: row.payloadHash!,
    expectedVersion: 3, expectedAttempt: 0, taskAttempt: 1, leaseOwnerToken: 'worker-owner-token-1',
    nowIso: '2026-08-20T09:00:00+07:00', leaseUntil: '2026-08-20T09:00:15+07:00', taskName: row.taskName,
    paymentEvidenceObjectKeys: row.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: row.chatEvidenceObjectKeys,
    paymentEvidenceFileIds: row.paymentEvidenceFileIds,
    chatEvidenceFileIds: row.chatEvidenceFileIds,
    evidenceCount: row.evidenceCount, safeErrorCode: null, caseId: null, confirmationStatus: null,
    ...patch,
  }
}

function retentionMutation(patch: Partial<MiniAppAsyncStateMutation> = {}): MiniAppAsyncStateMutation {
  return mutation({
    operation: 'RETAIN_PREPARE' as MiniAppAsyncStateMutation['operation'],
    payloadHash: 'p'.repeat(43),
    expectedVersion: 2,
    expectedAttempt: 0,
    taskAttempt: 1,
    leaseOwnerToken: null,
    leaseUntil: null,
    taskName: null,
    paymentEvidenceObjectKeys: [objectKey('PAYMENT', 'a')],
    chatEvidenceObjectKeys: [],
    paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [],
    evidenceCount: 1,
    safeErrorCode: null,
    caseId: null,
    confirmationStatus: null,
    ...patch,
  })
}

function objectKey(kind: 'PAYMENT' | 'CHAT', marker: string): string {
  return `drafts/draft-1/${kind}/${marker.repeat(64)}.png`
}

function queuedRequest(patch: Partial<MiniAppAsyncRequestRecord> = {}): MiniAppAsyncRequestRecord {
  const base: MiniAppAsyncRequestRecord = {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'admin-1', lineUserIdHash: 'line-user-hash',
    state: 'QUEUED', retentionState: '', version: 3, payloadHash: null, aeName: 'เอม',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'เพจหลัก', paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [], evidenceCount: 2,
    paymentEvidenceObjectKeys: [`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`],
    chatEvidenceObjectKeys: [`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`],
    taskName: 'task/request-1', queuedAt: '2026-08-20T08:59:00+07:00', processingStartedAt: null,
    processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0, processingOwnerToken: null,
    evidenceProjectionHash: null,
    createdAt: '2026-08-20T08:58:00+07:00', confirmedAt: null, caseId: null,
    confirmationStatus: null, safeErrorCode: null, updatedAt: '2026-08-20T08:59:00+07:00',
  }
  const withPatch = { ...base, ...structuredClone(patch) }
  return {
    ...withPatch,
    payloadHash: patch.payloadHash === undefined
      ? createHash('sha256').update(canonicalMiniAppAsyncIdentity(withPatch)).digest('base64url')
      : patch.payloadHash,
  }
}

function envelope(
  payload: MiniAppAsyncStateMutation,
  nonce = 'nonce-state-0001',
  timestamp = Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1_000),
): MiniAppAsyncStateIngressEnvelope {
  const unsigned = { kind: 'MINI_APP_ASYNC_STATE' as const, version: 1 as const, timestamp, nonce, payload }
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret').update(canonicalMiniAppAsyncStateIngress(unsigned)).digest('hex'),
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
