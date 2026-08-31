import type { DraftRetentionResource } from './pmcMiniAppDraftRetention'

export interface MiniAppDraftCleanupPayload {
  cleanupClaimId: string
  manifestDigest: string
  resources: Array<Extract<DraftRetentionResource, { storage: 'STAGED_OBJECT' }>>
}
export interface UnsignedMiniAppDraftCleanupEnvelope {
  kind: 'MINI_APP_DRAFT_CLEANUP'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppDraftCleanupPayload
}
export interface MiniAppDraftCleanupEnvelope extends UnsignedMiniAppDraftCleanupEnvelope { signature: string }

export function canonicalMiniAppDraftCleanup(envelope: UnsignedMiniAppDraftCleanupEnvelope): string {
  return JSON.stringify({
    kind: envelope.kind, version: envelope.version, timestamp: envelope.timestamp, nonce: envelope.nonce,
    payload: {
      cleanupClaimId: envelope.payload.cleanupClaimId,
      manifestDigest: envelope.payload.manifestDigest,
      resources: envelope.payload.resources.map((resource) => ({
        storage: resource.storage, kind: resource.kind, ordinal: resource.ordinal, uploadId: resource.uploadId,
        contentSha256: resource.contentSha256, mimeType: resource.mimeType, objectKey: resource.objectKey,
      })),
    },
  })
}
