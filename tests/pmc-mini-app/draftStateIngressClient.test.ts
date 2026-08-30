import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMiniAppDraftStateIngress,
  createDraftStateIngressClient,
} from '../../server/pmc-mini-app/draftStateIngressClient'
import {
  canonicalMiniAppDraftStateIngress,
  type MiniAppDraftStateMutation,
} from '../../shared/pmcMiniAppDraftState'

describe('PMC Mini App signed draft-state ingress client', () => {
  it('signs PREPARE_BEGIN with only binding inputs and an evidence manifest without references', () => {
    const built = buildMiniAppDraftStateIngress(beginMutation(), {
      timestamp: 1_800_000_000, nonce: 'nonce-draft-begin-1',
    }, 'server-secret')

    expect(built.body.payload.operation).toBe('PREPARE_BEGIN')
    if (built.body.payload.operation !== 'PREPARE_BEGIN') throw new Error('expected begin')
    expect(built.body.payload.evidence.every((item) => !('value' in item))).toBe(true)
    expect(JSON.stringify(built.body.payload)).not.toMatch(/drafts\/|drive-file/)
  })

  it('signs an exact PREPARE_READY sibling envelope without changing async-state v1', () => {
    const built = buildMiniAppDraftStateIngress(prepareMutation('PREPARE_READY'), {
      timestamp: 1_800_000_000, nonce: 'nonce-draft-state-1',
    }, 'server-secret')
    const { signature, ...unsigned } = built.body

    expect(built.body.kind).toBe('MINI_APP_DRAFT_STATE')
    expect(built.body.version).toBe(1)
    expect(built.body.payload.operation).toBe('PREPARE_READY')
    expect(signature).toBe(createHmac('sha256', 'server-secret')
      .update(canonicalMiniAppDraftStateIngress(unsigned)).digest('hex'))
  })

  it('posts PREPARE_PARTIAL and accepts only the exact safe digest result', async () => {
    const fetch = vi.fn(async () => response(200, {
      requestId: 'request-1', draftId: 'draft-1', state: 'DRAFT', version: 2,
      outcome: 'APPLIED', projectionDigest: 'd'.repeat(43),
    }))
    const client = createDraftStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-draft-state-1', fetch,
    })

    await expect(client.mutate(prepareMutation('PREPARE_PARTIAL'))).resolves.toMatchObject({
      state: 'DRAFT', version: 2, outcome: 'APPLIED', projectionDigest: 'd'.repeat(43),
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('signs the exact CANCEL discriminant without prepare input or evidence', () => {
    const built = buildMiniAppDraftStateIngress(cancelMutation(), {
      timestamp: 1_800_000_000, nonce: 'nonce-draft-state-1',
    }, 'server-secret')

    expect(Object.keys(built.body.payload).sort()).toEqual([
      'draftId', 'expectedAttempt', 'expectedVersion', 'nowIso', 'operation', 'requestId',
    ])
  })

  it.each([
    ['unknown prepare field', { input: { ...normalizedInput(), recorderName: 'forbidden' } }],
    ['duplicate ordinal', { evidence: [evidence(0), evidence(0)] }],
    ['mixed storage', { evidence: [evidence(0), { ...evidence(1), storage: 'DRIVE_FILE', value: 'drive-file-01' }] }],
    ['bad namespace', { evidence: [{ ...evidence(0), value: `drafts/other/PAYMENT/${'a'.repeat(64)}.png` }] }],
  ])('rejects %s before fetch', async (_label, patch) => {
    const fetch = vi.fn()
    const client = createDraftStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-draft-state-1', fetch,
    })

    await expect(client.mutate({ ...prepareMutation('PREPARE_READY'), ...patch } as MiniAppDraftStateMutation))
      .rejects.toMatchObject({ code: 'DRAFT_STATE_INGRESS_FAILED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['provider failure', async () => response(500, { private: 'detail' })],
    ['malformed digest result', async () => response(200, {
      requestId: 'request-1', draftId: 'draft-1', state: 'DRAFT', version: 2,
      outcome: 'APPLIED', projectionDigest: 'wrong',
    })],
    ['transport failure', async () => { throw new Error('private transport') }],
  ])('maps %s to a fixed safe error', async (_label, fetchImplementation) => {
    const client = createDraftStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-draft-state-1', fetch: vi.fn(fetchImplementation),
    })

    await expect(client.mutate(prepareMutation('PREPARE_READY'))).rejects.toMatchObject({
      code: expect.stringMatching(/^DRAFT_STATE_INGRESS_/),
      message: expect.not.stringMatching(/private transport|detail/),
    })
  })
})

function prepareMutation(operation: 'PREPARE_READY' | 'PREPARE_PARTIAL'): MiniAppDraftStateMutation {
  return {
    operation, requestId: 'request-1', draftId: 'draft-1', expectedVersion: 1, expectedAttempt: 0,
    baseVersion: 1, nowIso: '2026-08-30T10:00:00.000Z', prepareBindingHash: 'b'.repeat(43),
    input: normalizedInput(), evidence: [
      evidence(0),
      { ...evidence(0, 'CHAT'), ordinal: 0, value: operation === 'PREPARE_PARTIAL' ? null : evidence(0, 'CHAT').value },
    ],
  }
}

function beginMutation(): MiniAppDraftStateMutation {
  const ready = prepareMutation('PREPARE_READY')
  if (ready.operation !== 'PREPARE_READY') throw new Error('expected ready')
  return {
    ...ready,
    operation: 'PREPARE_BEGIN',
    evidence: ready.evidence.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.contentSha256,
      mimeType: item.mimeType, storage: item.storage,
    })),
  }
}

function cancelMutation(): MiniAppDraftStateMutation {
  return {
    operation: 'CANCEL', requestId: 'request-1', draftId: 'draft-1', expectedVersion: 1,
    expectedAttempt: 0, nowIso: '2026-08-30T10:00:00.000Z',
  }
}

function normalizedInput() {
  return {
    requestId: 'request-1', adminId: 'admin-1', aeId: 'staff-ae', customerName: 'ลูกค้า ทดสอบ',
    facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1',
    queueType: 'NORMAL' as const, appointmentDate: '2026-09-01', appointmentTime: '13:00',
    depositAmount: 900, channelId: 'เพจหลัก',
  }
}

function evidence(ordinal: number, kind: 'PAYMENT' | 'CHAT' = 'PAYMENT') {
  const hash = (kind === 'PAYMENT' ? 'a' : 'b').repeat(64)
  return {
    kind, ordinal, contentSha256: hash, mimeType: 'image/png' as const, storage: 'STAGED_OBJECT' as const,
    value: `drafts/draft-1/${kind}/${hash}.png`,
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
