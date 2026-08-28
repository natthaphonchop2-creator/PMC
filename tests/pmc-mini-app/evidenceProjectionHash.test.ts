import { describe, expect, it } from 'vitest'
import { evidenceProjectionHash } from '../../server/pmc-mini-app/bookingDraft'
import {
  canonicalMiniAppEvidenceProjection,
  type MiniAppEvidenceProjectionBinding,
} from '../../shared/pmcMiniAppAsyncState'

describe('Mini App evidence projection hash contract', () => {
  it('uses one exact canonical field order shared by Cloud Run and Apps Script', () => {
    expect(canonicalMiniAppEvidenceProjection(binding())).toBe(JSON.stringify({
      requestId: 'request-1',
      draftId: 'draft-1',
      payloadHash: 'payload-hash-1',
      paymentEvidenceObjectKeys: [`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`],
      chatEvidenceObjectKeys: [`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`],
      paymentEvidenceFileIds: ['owner-drive-payment-1'],
      chatEvidenceFileIds: ['owner-drive-chat-1'],
      evidenceCount: 2,
    }))
  })

  it('changes for ordered Drive IDs, object keys, counts, or independent payload identity', () => {
    const base = binding({
      paymentEvidenceObjectKeys: [
        `drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`,
        `drafts/draft-1/PAYMENT/${'c'.repeat(64)}.png`,
      ],
      paymentEvidenceFileIds: ['owner-drive-payment-1', 'owner-drive-payment-2'],
      evidenceCount: 3,
    })
    const baseHash = evidenceProjectionHash(base)

    expect(evidenceProjectionHash({ ...base, paymentEvidenceFileIds: [...base.paymentEvidenceFileIds].reverse() })).not.toBe(baseHash)
    expect(evidenceProjectionHash({ ...base, paymentEvidenceObjectKeys: [...base.paymentEvidenceObjectKeys].reverse() })).not.toBe(baseHash)
    expect(evidenceProjectionHash({ ...base, evidenceCount: 2 })).not.toBe(baseHash)
    expect(evidenceProjectionHash({ ...base, payloadHash: 'payload-hash-2' })).not.toBe(baseHash)
  })
})

function binding(patch: Partial<MiniAppEvidenceProjectionBinding> = {}): MiniAppEvidenceProjectionBinding {
  return {
    requestId: 'request-1', draftId: 'draft-1', payloadHash: 'payload-hash-1',
    paymentEvidenceObjectKeys: [`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.png`],
    chatEvidenceObjectKeys: [`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`],
    paymentEvidenceFileIds: ['owner-drive-payment-1'], chatEvidenceFileIds: ['owner-drive-chat-1'],
    evidenceCount: 2, ...patch,
  }
}
