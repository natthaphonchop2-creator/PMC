import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMiniAppAsyncStateIngress,
  createAsyncStateIngressClient,
} from '../../server/pmc-mini-app/asyncStateIngressClient'
import {
  canonicalMiniAppAsyncStateIngress,
  type MiniAppAsyncStateMutation,
} from '../../shared/pmcMiniAppAsyncState'

describe('PMC Mini App signed async-state ingress client', () => {
  it('signs the exact state-only canonical envelope without secret or business PII', () => {
    const request = buildMiniAppAsyncStateIngress(mutation(), {
      timestamp: 1_800_000_000,
      nonce: 'nonce-state-1234',
    }, 'server-secret')

    expect(request.body.kind).toBe('MINI_APP_ASYNC_STATE')
    expect(request.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.stringify(request.body)).not.toMatch(/server-secret|ลูกค้า|0812345678/)
    const { signature, ...unsigned } = request.body
    expect(signature).toBe(createHmac('sha256', 'server-secret')
      .update(canonicalMiniAppAsyncStateIngress(unsigned)).digest('hex'))
  })

  it('posts a bounded mutation and accepts only an exact safe result', async () => {
    const fetch = vi.fn(async () => response(200, {
      requestId: 'request-1', draftId: 'draft-1', state: 'PROCESSING', version: 4,
      attemptCount: 1, caseId: null, confirmationStatus: null, outcome: 'APPLIED',
    }))
    const client = createAsyncStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-state-1234', fetch,
    })

    await expect(client.mutate(mutation())).resolves.toEqual({
      requestId: 'request-1', draftId: 'draft-1', state: 'PROCESSING', version: 4,
      attemptCount: 1, caseId: null, confirmationStatus: null, outcome: 'APPLIED',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['provider failure', async () => response(500, { detail: 'private provider body' })],
    ['invalid result', async () => response(200, { state: 'PROCESSING', ownerToken: 'private-token' })],
    ['transport failure', async () => { throw new Error('private transport detail') }],
  ])('maps %s to a fixed safe client error', async (_label, fetchImplementation) => {
    const client = createAsyncStateIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-state-1234', fetch: vi.fn(fetchImplementation),
    })

    await expect(client.mutate(mutation())).rejects.toMatchObject({
      code: expect.stringMatching(/^ASYNC_STATE_INGRESS_/),
      message: expect.not.stringMatching(/private provider|private transport|private-token/),
    })
  })
})

function mutation(patch: Partial<MiniAppAsyncStateMutation> = {}): MiniAppAsyncStateMutation {
  return {
    operation: 'CLAIM', requestId: 'request-1', draftId: 'draft-1', payloadHash: 'payload-hash-1',
    expectedVersion: 3, expectedAttempt: 0, leaseOwnerToken: 'worker-owner-token-1',
    taskAttempt: 1,
    nowIso: '2026-08-28T04:00:00.000Z', leaseUntil: '2026-08-28T04:01:00.000Z', taskName: null,
    paymentEvidenceObjectKeys: [`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`],
    chatEvidenceObjectKeys: [`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`],
    paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 2,
    safeErrorCode: null, caseId: null, confirmationStatus: null,
    ...patch,
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
