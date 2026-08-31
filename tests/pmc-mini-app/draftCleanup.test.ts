import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cleanupMiniAppDraftEvidence } from '../../server/pmc-mini-app/draftCleanup'
import type {
  EvidenceStagingCleanupDescriptor,
  EvidenceStagingPort,
} from '../../server/pmc-mini-app/stagingStore'
import {
  canonicalMiniAppDraftCleanup,
  type MiniAppDraftCleanupEnvelope,
  type UnsignedMiniAppDraftCleanupEnvelope,
} from '../../shared/pmcMiniAppDraftCleanup'
import {
  miniAppEvidenceObjectKeyV2,
  miniAppEvidenceUploadIdV2,
  type MiniAppEvidenceSlotIdentityV2,
} from '../../shared/pmcMiniAppEvidence'

describe('signed draft evidence cleanup route', () => {
  it('preflights and deletes one exact V2 descriptor', async () => {
    const resource = v2Resource()
    const descriptor = v2Descriptor(resource.objectKey, resource.uploadId, resource.contentSha256)
    const staging = stagingPort(vi.fn(async () => descriptor))

    await expect(cleanupMiniAppDraftEvidence(envelope([resource]), {
      secret,
      staging,
      nowSeconds,
    })).resolves.toEqual({ cleanedCount: 1 })
    expect(staging.describe).toHaveBeenCalledWith(resource.objectKey)
    expect(staging.deleteVerified).toHaveBeenCalledWith(descriptor)
  })

  it('treats an exact missing object as an idempotent cleanup success', async () => {
    const resource = v2Resource()
    const notFound = Object.assign(new Error('not found'), { code: 404 })
    const staging = stagingPort(vi.fn(async () => { throw notFound }))

    await expect(cleanupMiniAppDraftEvidence(envelope([resource]), {
      secret,
      staging,
      nowSeconds,
    })).resolves.toEqual({ cleanedCount: 1 })
    expect(staging.deleteVerified).not.toHaveBeenCalled()
  })

  it('supports a verified legacy staging descriptor during rolling cleanup', async () => {
    const contentSha256 = sha256Hex('legacy')
    const resource = {
      storage: 'STAGED_OBJECT' as const,
      kind: 'PAYMENT' as const,
      ordinal: 0,
      uploadId: sha256Hex('legacy-upload'),
      contentSha256,
      mimeType: 'image/jpeg' as const,
      objectKey: `drafts/draft-1/PAYMENT/${contentSha256}.jpg`,
    }
    const descriptor: EvidenceStagingCleanupDescriptor = {
      version: 1,
      objectKey: resource.objectKey,
      draftId: 'draft-1',
      kind: 'PAYMENT',
      contentSha256,
      mimeType: 'image/jpeg',
      size: 100,
      generation: '1',
    }
    const staging = stagingPort(vi.fn(async () => descriptor))

    await expect(cleanupMiniAppDraftEvidence(envelope([resource]), {
      secret,
      staging,
      nowSeconds,
    })).resolves.toEqual({ cleanedCount: 1 })
    expect(staging.deleteVerified).toHaveBeenCalledWith(descriptor)
  })

  it('rejects tampering, stale envelopes, and slot mismatches before delete', async () => {
    const resource = v2Resource()
    const staging = stagingPort(vi.fn(async () => v2Descriptor(
      resource.objectKey,
      resource.uploadId,
      resource.contentSha256,
    )))
    const tampered = envelope([resource])
    tampered.payload.resources[0]!.ordinal = 1
    await expect(cleanupMiniAppDraftEvidence(tampered, { secret, staging, nowSeconds }))
      .rejects.toThrow('DRAFT_CLEANUP_INVALID')
    await expect(cleanupMiniAppDraftEvidence(envelope([resource], nowSeconds - 301), {
      secret,
      staging,
      nowSeconds,
    })).rejects.toThrow('DRAFT_CLEANUP_INVALID')
    expect(staging.deleteVerified).not.toHaveBeenCalled()
  })
})

const secret = 'cleanup-secret'
const nowSeconds = 1_788_000_000

function envelope(
  resources: UnsignedMiniAppDraftCleanupEnvelope['payload']['resources'],
  timestamp = nowSeconds,
): MiniAppDraftCleanupEnvelope {
  const unsigned: UnsignedMiniAppDraftCleanupEnvelope = {
    kind: 'MINI_APP_DRAFT_CLEANUP',
    version: 1,
    timestamp,
    nonce: 'nonce-cleanup-1',
    payload: {
      cleanupClaimId: sha256Hex('claim'),
      manifestDigest: sha256Hex('manifest'),
      resources: structuredClone(resources),
    },
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', secret).update(canonicalMiniAppDraftCleanup(unsigned)).digest('hex'),
  }
}

function v2Resource() {
  const slot = v2Slot()
  const uploadId = miniAppEvidenceUploadIdV2(slot, sha256Hex)
  return {
    storage: 'STAGED_OBJECT' as const,
    kind: slot.evidenceKind,
    ordinal: slot.ordinal,
    uploadId,
    contentSha256: slot.contentSha256,
    mimeType: slot.mimeType,
    objectKey: miniAppEvidenceObjectKeyV2(slot, uploadId),
  }
}

function v2Descriptor(
  objectKey: string,
  uploadId: string,
  contentSha256: string,
): EvidenceStagingCleanupDescriptor {
  return {
    version: 2,
    objectKey,
    requestId: 'request-1',
    draftId: 'draft-1',
    kind: 'PAYMENT',
    ordinal: 0,
    uploadId,
    contentSha256,
    mimeType: 'image/jpeg',
    size: 100,
    generation: '1',
  }
}

function v2Slot(): MiniAppEvidenceSlotIdentityV2 {
  return {
    requestId: 'request-1',
    draftId: 'draft-1',
    evidenceKind: 'PAYMENT',
    ordinal: 0,
    mimeType: 'image/jpeg',
    contentSha256: sha256Hex('payment'),
  }
}

function stagingPort(
  describe: ReturnType<typeof vi.fn>,
): EvidenceStagingPort & { describe: ReturnType<typeof vi.fn>; deleteVerified: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn(),
    get: vi.fn(),
    describe,
    deleteVerified: vi.fn(async () => undefined),
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
