import {
  canonicalMiniAppEvidenceIngressV2,
  canonicalMiniAppEvidenceIngress,
  miniAppEvidenceFileMarkerV2,
  miniAppEvidenceFileNameV2,
  miniAppEvidenceUploadIdV2,
  type AnyMiniAppEvidenceIngressEnvelope,
  type MiniAppEvidenceIngressPayload,
  type MiniAppEvidenceIngressPayloadV2,
  type UnsignedMiniAppEvidenceIngressEnvelope,
  type UnsignedMiniAppEvidenceIngressEnvelopeV2,
} from '../../../../shared/pmcMiniAppEvidence'
import type { BookingPorts } from '../ports'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const
const V1_PAYLOAD_KEYS = [
  'draftId', 'requestId', 'evidenceKind', 'uploadId', 'fileName', 'mimeType', 'bytesBase64', 'contentSha256',
] as const
const V2_PAYLOAD_KEYS = [
  'requestId', 'draftId', 'evidenceKind', 'ordinal', 'mimeType', 'contentSha256', 'uploadId', 'fileName', 'bytesBase64',
] as const
const MAX_EVIDENCE_BYTES = 10_000_000
const MAX_BASE64_LENGTH = Math.ceil(MAX_EVIDENCE_BYTES / 3) * 4

export const MAX_EVIDENCE_INGRESS_LENGTH = MAX_BASE64_LENGTH + 4_096

export function uploadMiniAppEvidence(input: unknown, ports: BookingPorts): { fileId: string } {
  const envelope = verifyEnvelope(input, ports)
  if (envelope.version === 1) validateContentBindings(envelope, [], ports)
  const bytes = decodeEvidence(envelope.payload, ports)
  if (envelope.version === 2) validateContentBindings(envelope, bytes, ports)
  if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) throw new Error('mini app evidence ingress replay detected')
  ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())

  const fileId = ports.locks.withLock(() => {
    const intake = ports.drive.ensureChildFolder(
      ports.drive.rootFolderId(),
      '_MINI_APP_INTAKE',
      'mini-app-intake:v1',
    )
    if (envelope.version === 1) {
      return ports.drive.findFileByName(intake.id, envelope.payload.fileName)
        ?? ports.drive.createEvidenceFile(intake.id, envelope.payload.fileName, envelope.payload.mimeType, bytes)
    }
    const slot = evidenceSlot(envelope.payload)
    const marker = miniAppEvidenceFileMarkerV2(slot, envelope.payload.uploadId)
    return ports.drive.findEvidenceFile(intake.id, envelope.payload.fileName, envelope.payload.mimeType, marker)
      ?? ports.drive.createEvidenceFile(
        intake.id, envelope.payload.fileName, envelope.payload.mimeType, bytes, marker,
      )
  })
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) throw new Error('invalid mini app evidence file ID')
  return { fileId }
}

function verifyEnvelope(input: unknown, ports: BookingPorts): AnyMiniAppEvidenceIngressEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ENVELOPE_KEYS)) throw new Error('invalid mini app evidence envelope')
  if (input.kind !== 'MINI_APP_EVIDENCE' || input.version !== 1 && input.version !== 2 || !Number.isSafeInteger(input.timestamp)) {
    throw new Error('invalid mini app evidence envelope')
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)) {
    throw new Error('invalid mini app evidence nonce')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app evidence signature')
  }
  const payloadKeys = input.version === 1 ? V1_PAYLOAD_KEYS : V2_PAYLOAD_KEYS
  if (!isRecord(input.payload) || !hasExactKeys(input.payload, payloadKeys)) {
    throw new Error('invalid mini app evidence payload')
  }
  const payload = input.payload as unknown as MiniAppEvidenceIngressPayload | MiniAppEvidenceIngressPayloadV2
  validateMetadataShape(payload, input.version)
  const unsigned: UnsignedMiniAppEvidenceIngressEnvelope | UnsignedMiniAppEvidenceIngressEnvelopeV2 = input.version === 1
    ? { kind: 'MINI_APP_EVIDENCE', version: 1, timestamp: input.timestamp as number, nonce: input.nonce,
        payload: payload as MiniAppEvidenceIngressPayload }
    : { kind: 'MINI_APP_EVIDENCE', version: 2, timestamp: input.timestamp as number, nonce: input.nonce,
        payload: payload as MiniAppEvidenceIngressPayloadV2 }
  const expected = ports.crypto.hmacSha256Hex(
    unsigned.version === 1 ? canonicalMiniAppEvidenceIngress(unsigned) : canonicalMiniAppEvidenceIngressV2(unsigned),
    ports.secrets.bookingIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app evidence signature')
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app evidence timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function validateMetadataShape(
  payload: MiniAppEvidenceIngressPayload | MiniAppEvidenceIngressPayloadV2,
  version: 1 | 2,
): void {
  if (!safeId(payload.draftId) || !safeId(payload.requestId)) throw new Error('invalid mini app evidence request')
  if (payload.evidenceKind !== 'PAYMENT' && payload.evidenceKind !== 'CHAT') throw new Error('invalid mini app evidence kind')
  if (payload.mimeType !== 'image/jpeg' && payload.mimeType !== 'image/png') throw new Error('invalid mini app evidence MIME')
  if (!/^[a-f0-9]{64}$/.test(payload.contentSha256) || !/^[a-f0-9]{64}$/.test(payload.uploadId)) {
    throw new Error('invalid mini app evidence hash')
  }
  if (typeof payload.bytesBase64 !== 'string' || payload.bytesBase64.length === 0 || payload.bytesBase64.length > MAX_BASE64_LENGTH) {
    throw new Error('invalid mini app evidence size')
  }
  if (version === 2 && (!('ordinal' in payload) || !Number.isSafeInteger(payload.ordinal)
    || payload.ordinal < 0 || payload.ordinal > 9)) throw new Error('invalid mini app evidence ordinal')
  const extension = payload.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const expectedFileName = version === 1
    ? `${payload.evidenceKind.toLowerCase()}-${payload.uploadId}.${extension}`
    : miniAppEvidenceFileNameV2(evidenceSlot(payload as MiniAppEvidenceIngressPayloadV2), payload.uploadId)
  if (payload.fileName !== expectedFileName) {
    throw new Error('invalid mini app evidence file name')
  }
}

function validateContentBindings(
  envelope: AnyMiniAppEvidenceIngressEnvelope,
  bytes: number[],
  ports: BookingPorts,
): void {
  const payload = envelope.payload
  const actualHash = envelope.version === 1
    ? ports.crypto.sha256Hex(payload.bytesBase64)
    : ports.crypto.sha256BytesHex(bytes)
  if (!constantTimeEqual(payload.contentSha256, actualHash)) throw new Error('invalid mini app evidence content hash')
  const expectedUploadId = envelope.version === 1
    ? ports.crypto.sha256Hex(`${envelope.payload.draftId}\0${envelope.payload.evidenceKind}\0${envelope.payload.contentSha256}`)
    : miniAppEvidenceUploadIdV2(evidenceSlot(envelope.payload), ports.crypto.sha256Hex)
  if (!constantTimeEqual(payload.uploadId, expectedUploadId)) throw new Error('invalid mini app evidence upload ID')
}

function decodeEvidence(payload: MiniAppEvidenceIngressPayload | MiniAppEvidenceIngressPayloadV2, ports: BookingPorts): number[] {
  let bytes: number[]
  try { bytes = ports.crypto.base64Decode(payload.bytesBase64) } catch { throw new Error('invalid mini app evidence base64') }
  if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) throw new Error('invalid mini app evidence size')
  const normalized = bytes.map((byte) => byte & 0xff)
  const isJpeg = normalized.length >= 3 && normalized[0] === 0xff && normalized[1] === 0xd8 && normalized[2] === 0xff
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const isPng = normalized.length >= pngSignature.length
    && pngSignature.every((byte, index) => normalized[index] === byte)
  if ((payload.mimeType === 'image/jpeg' && !isJpeg) || (payload.mimeType === 'image/png' && !isPng)) {
    throw new Error('invalid mini app evidence bytes')
  }
  return bytes
}

function evidenceSlot(payload: MiniAppEvidenceIngressPayloadV2) {
  return {
    requestId: payload.requestId, draftId: payload.draftId, evidenceKind: payload.evidenceKind,
    ordinal: payload.ordinal, mimeType: payload.mimeType, contentSha256: payload.contentSha256,
  }
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}
