import { describe, expect, it } from 'vitest'
import { bookingPayloadHash } from '../../server/pmc-mini-app/bookingDraft'
import { createAsyncStateIngressClient } from '../../server/pmc-mini-app/asyncStateIngressClient'
import type { MiniAppRequestRecord } from '../../server/pmc-mini-app/store'
import type { MiniAppAsyncStateMutation } from '../../shared/pmcMiniAppAsyncState'
import type { PmcMiniAppTargetRequestRecord } from '../../shared/pmcBookingRowContracts'
import { processBookingDoPost } from '../../apps/pmc-google-booking-ops/src/entrypoints'
import type { BookingPorts, MiniAppRequestStatePort } from '../../apps/pmc-google-booking-ops/src/ports'
import { createTestPorts } from '../../apps/pmc-google-booking-ops/tests/helpers/fakes'

describe('protocol-2 async owner state integration', () => {
  it('uses the Cloud Run P2 hash through signed QUEUE, worker claim, projection, and completion', async () => {
    const ready = readyP2Request()
    let current = structuredClone(ready)
    const ports: BookingPorts = createTestPorts()
    ports.miniAppRequests = requestPort(
      () => current,
      (next) => { current = structuredClone(next as PmcMiniAppTargetRequestRecord) },
    )
    const nonces = ['nonce-p2-queue', 'nonce-p2-claim', 'nonce-p2-project', 'nonce-p2-complete']
    const client = createAsyncStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'ingress-secret',
      now: () => Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1_000),
      nonce: () => nonces.shift()!,
      fetch: async (_url, init) => response(200, processBookingDoPost(event(JSON.parse(init.body)), ports)),
    })
    const payloadHash = bookingPayloadHash(ready as unknown as MiniAppRequestRecord)

    const queued = await client.mutate(mutation(ready, payloadHash, {
      operation: 'QUEUE', expectedVersion: 3, expectedAttempt: 0, taskName: 'tasks/p2-request-1',
      leaseOwnerToken: null, leaseUntil: null,
    }))
    const claimed = await client.mutate(mutation(current, payloadHash, {
      operation: 'CLAIM', expectedVersion: 4, expectedAttempt: 0,
      leaseOwnerToken: 'worker-owner-token-1', leaseUntil: '2026-08-20T09:01:00+07:00',
    }))
    const projected = await client.mutate(mutation(current, payloadHash, {
      operation: 'PROJECT', expectedVersion: 5, expectedAttempt: 1,
      leaseOwnerToken: 'worker-owner-token-1', leaseUntil: null,
      paymentEvidenceFileIds: ['drive-payment-1'], chatEvidenceFileIds: ['drive-chat-1'],
    }))
    const completed = await client.mutate(mutation(current, payloadHash, {
      operation: 'COMPLETE', expectedVersion: 6, expectedAttempt: 1,
      leaseOwnerToken: 'worker-owner-token-1', leaseUntil: null,
      paymentEvidenceFileIds: ['drive-payment-1'], chatEvidenceFileIds: ['drive-chat-1'],
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    }))

    expect(queued).toMatchObject({ state: 'QUEUED', version: 4, outcome: 'APPLIED' })
    expect(claimed).toMatchObject({ state: 'PROCESSING', version: 5, attemptCount: 1, outcome: 'APPLIED' })
    expect(projected).toMatchObject({ state: 'PROCESSING', version: 6, outcome: 'APPLIED' })
    expect(completed).toMatchObject({
      state: 'CONFIRMED', version: 7, attemptCount: 1,
      caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED', outcome: 'APPLIED',
    })
    expect(current).toMatchObject({
      protocolVersion: 2, payloadHash, state: 'CONFIRMED', staffId: 'admin-1', recorderName: 'Admin A',
      adminId: 'admin-1', adminName: 'Admin A', aeId: 'staff-ae', aeName: 'เอม',
      paymentEvidenceFileIds: ['drive-payment-1'], chatEvidenceFileIds: ['drive-chat-1'],
    })
  })
})

function readyP2Request(): PmcMiniAppTargetRequestRecord {
  return {
    requestId: 'request-p2-1', draftId: 'draft-p2-1', protocolVersion: 2,
    staffId: 'admin-1', recorderName: 'Admin A', adminId: 'admin-1', adminName: 'Admin A',
    lineUserIdHash: 'line-user-hash', state: 'READY_TO_CONFIRM', retentionState: '', version: 3,
    payloadHash: null, aeId: 'staff-ae', aeName: 'เอม', customerName: 'ลูกค้าทดสอบ',
    facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1',
    queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900,
    channelId: 'เพจหลัก', paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 2,
    paymentEvidenceObjectKeys: [`drafts/draft-p2-1/PAYMENT/${'a'.repeat(64)}.png`],
    chatEvidenceObjectKeys: [`drafts/draft-p2-1/CHAT/${'b'.repeat(64)}.png`],
    taskName: null, queuedAt: null, processingStartedAt: null, processingLeaseUntil: null,
    lastProgressAt: null, attemptCount: 0, processingOwnerToken: null,
    evidenceProjectionHash: 'p'.repeat(43), createdAt: '2026-08-20T08:58:00+07:00',
    confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-20T08:59:00+07:00',
  }
}

function mutation(
  current: PmcMiniAppTargetRequestRecord,
  payloadHash: string,
  patch: Partial<MiniAppAsyncStateMutation>,
): MiniAppAsyncStateMutation {
  return {
    operation: 'QUEUE', requestId: current.requestId, draftId: current.draftId, payloadHash,
    expectedVersion: current.version, expectedAttempt: current.attemptCount, taskAttempt: 1,
    leaseOwnerToken: null, nowIso: '2026-08-20T09:00:00+07:00', leaseUntil: null,
    taskName: current.taskName, paymentEvidenceObjectKeys: [...current.paymentEvidenceObjectKeys],
    chatEvidenceObjectKeys: [...current.chatEvidenceObjectKeys],
    paymentEvidenceFileIds: [...current.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...current.chatEvidenceFileIds], evidenceCount: current.evidenceCount,
    safeErrorCode: null, caseId: null, confirmationStatus: null, ...patch,
  }
}

function requestPort(
  read: () => PmcMiniAppTargetRequestRecord,
  write: (next: PmcMiniAppTargetRequestRecord) => void,
): MiniAppRequestStatePort {
  return {
    getByRequestId(requestId) {
      const current = read()
      return current.requestId === requestId ? structuredClone(current) : null
    },
    updateByRequestId(requestId, expectedVersion, next) {
      const current = read()
      if (current.requestId !== requestId || current.version !== expectedVersion) throw new Error('version conflict')
      if (!('protocolVersion' in next) || next.protocolVersion !== 2) throw new Error('expected protocol-2 target row')
      write(next)
      return structuredClone(next)
    },
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
