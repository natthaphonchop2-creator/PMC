import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  canonicalMiniAppDraftCleanup,
  type MiniAppDraftCleanupEnvelope,
  type UnsignedMiniAppDraftCleanupEnvelope,
} from '../../shared/pmcMiniAppDraftCleanup.js'
import {
  assertEvidenceStagingDescriptorSlot,
  isEvidenceStagingNotFound,
  type EvidenceStagingCleanupDescriptor,
  type EvidenceStagingPort,
} from './stagingStore.js'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature']
const PAYLOAD_KEYS = ['cleanupClaimId', 'manifestDigest', 'resources']
const RESOURCE_KEYS = ['storage', 'kind', 'ordinal', 'uploadId', 'contentSha256', 'mimeType', 'objectKey']
const LEGACY_KEY = /^drafts\/([A-Za-z0-9_-]{1,124})\/(PAYMENT|CHAT)\/([a-f0-9]{64})\.(jpg|png)$/
const V2_KEY = /^drafts\/v2\/([A-Za-z0-9._:-]{1,124})\/([A-Za-z0-9._:-]{1,124})\/(PAYMENT|CHAT)\/([0-9])\/[a-f0-9]{64}\/[a-f0-9]{64}\.(jpg|png)$/

export async function cleanupMiniAppDraftEvidence(
  input: unknown,
  options: { secret: string; staging: EvidenceStagingPort; nowSeconds: number },
): Promise<{ cleanedCount: number }> {
  const envelope = verify(input, options.secret, options.nowSeconds)
  const descriptors = new Map<string, EvidenceStagingCleanupDescriptor | null>()
  for (const resource of envelope.payload.resources) {
    const v2 = V2_KEY.exec(resource.objectKey)
    const legacy = LEGACY_KEY.exec(resource.objectKey)
    if (!v2 && !legacy) throw new Error('DRAFT_CLEANUP_INVALID')
    let descriptor: EvidenceStagingCleanupDescriptor
    try { descriptor = await options.staging.describe(resource.objectKey) } catch (error) {
      if (isEvidenceStagingNotFound(error)) { descriptors.set(resource.objectKey, null); continue }
      throw error
    }
    const draftId = v2?.[2] ?? legacy?.[1] ?? ''
    assertEvidenceStagingDescriptorSlot(descriptor, {
      objectKey: resource.objectKey,
      requestId: v2?.[1] ?? 'legacy-cleanup',
      draftId,
      kind: resource.kind,
      ordinal: resource.ordinal,
    })
    if (descriptor.contentSha256 !== resource.contentSha256 || descriptor.mimeType !== resource.mimeType
      || descriptor.version === 2 && descriptor.uploadId !== resource.uploadId
      || descriptor.version === 1 && (!legacy || legacy[2] !== resource.kind
        || legacy[3] !== resource.contentSha256)) {
      throw new Error('DRAFT_CLEANUP_BINDING_MISMATCH')
    }
    descriptors.set(resource.objectKey, descriptor)
  }
  for (const descriptor of descriptors.values()) {
    if (descriptor) await options.staging.deleteVerified(descriptor)
  }
  return { cleanedCount: envelope.payload.resources.length }
}

function verify(input: unknown, secret: string, nowSeconds: number): MiniAppDraftCleanupEnvelope {
  if (!record(input) || !keys(input, ENVELOPE_KEYS) || input.kind !== 'MINI_APP_DRAFT_CLEANUP'
    || input.version !== 1 || !Number.isSafeInteger(input.timestamp)
    || typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)
    || typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)
    || !record(input.payload) || !keys(input.payload, PAYLOAD_KEYS)) throw new Error('DRAFT_CLEANUP_INVALID')
  const payload = input.payload
  if (!secret || typeof payload.cleanupClaimId !== 'string' || !/^[a-f0-9]{64}$/.test(payload.cleanupClaimId)
    || typeof payload.manifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(payload.manifestDigest)
    || !Array.isArray(payload.resources) || payload.resources.length < 1
    || payload.resources.length > 20) throw new Error('DRAFT_CLEANUP_INVALID')
  for (const resource of payload.resources) {
    if (!record(resource) || !keys(resource, RESOURCE_KEYS) || resource.storage !== 'STAGED_OBJECT'
      || !['PAYMENT', 'CHAT'].includes(String(resource.kind)) || !Number.isSafeInteger(resource.ordinal)
      || Number(resource.ordinal) < 0 || Number(resource.ordinal) > 9
      || typeof resource.uploadId !== 'string' || !/^[a-f0-9]{64}$/.test(resource.uploadId)
      || typeof resource.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.contentSha256)
      || !['image/jpeg', 'image/png'].includes(String(resource.mimeType)) || typeof resource.objectKey !== 'string') {
      throw new Error('DRAFT_CLEANUP_INVALID')
    }
  }
  const unsigned: UnsignedMiniAppDraftCleanupEnvelope = {
    kind: 'MINI_APP_DRAFT_CLEANUP', version: 1, timestamp: input.timestamp as number,
    nonce: input.nonce, payload: payload as unknown as UnsignedMiniAppDraftCleanupEnvelope['payload'],
  }
  const expected = createHmac('sha256', secret).update(canonicalMiniAppDraftCleanup(unsigned)).digest('hex')
  if (!constantEqual(input.signature, expected) || !Number.isSafeInteger(nowSeconds)
    || Math.abs(nowSeconds - unsigned.timestamp) > 300) throw new Error('DRAFT_CLEANUP_INVALID')
  return { ...unsigned, signature: input.signature }
}

function constantEqual(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort(); const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}
