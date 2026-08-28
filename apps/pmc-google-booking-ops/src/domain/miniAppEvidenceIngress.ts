import {
  canonicalMiniAppEvidenceIngress,
  type MiniAppEvidenceIngressEnvelope,
  type MiniAppEvidenceIngressPayload,
  type UnsignedMiniAppEvidenceIngressEnvelope,
} from '../../../../shared/pmcMiniAppEvidence'
import type { BookingPorts } from '../ports'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const
const PAYLOAD_KEYS = [
  'draftId', 'requestId', 'evidenceKind', 'uploadId', 'fileName', 'mimeType', 'bytesBase64', 'contentSha256',
] as const
const MAX_EVIDENCE_BYTES = 10_000_000
const MAX_BASE64_LENGTH = Math.ceil(MAX_EVIDENCE_BYTES / 3) * 4

export const MAX_EVIDENCE_INGRESS_LENGTH = MAX_BASE64_LENGTH + 4_096

export function uploadMiniAppEvidence(input: unknown, ports: BookingPorts): { fileId: string } {
  const envelope = verifyEnvelope(input, ports)
  const bytes = decodeEvidence(envelope.payload, ports)
  if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) throw new Error('mini app evidence ingress replay detected')
  ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())

  const fileId = ports.locks.withLock(() => {
    const intake = ports.drive.ensureChildFolder(
      ports.drive.rootFolderId(),
      '_MINI_APP_INTAKE',
      'mini-app-intake:v1',
    )
    return ports.drive.findFileByName(intake.id, envelope.payload.fileName)
      ?? ports.drive.createEvidenceFile(intake.id, envelope.payload.fileName, envelope.payload.mimeType, bytes)
  })
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) throw new Error('invalid mini app evidence file ID')
  return { fileId }
}

function verifyEnvelope(input: unknown, ports: BookingPorts): MiniAppEvidenceIngressEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ENVELOPE_KEYS)) throw new Error('invalid mini app evidence envelope')
  if (input.kind !== 'MINI_APP_EVIDENCE' || input.version !== 1 || !Number.isSafeInteger(input.timestamp)) {
    throw new Error('invalid mini app evidence envelope')
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)) {
    throw new Error('invalid mini app evidence nonce')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app evidence signature')
  }
  if (!isRecord(input.payload) || !hasExactKeys(input.payload, PAYLOAD_KEYS)) {
    throw new Error('invalid mini app evidence payload')
  }
  const payload = input.payload as unknown as MiniAppEvidenceIngressPayload
  validateMetadataShape(payload)
  const unsigned: UnsignedMiniAppEvidenceIngressEnvelope = {
    kind: 'MINI_APP_EVIDENCE', version: 1, timestamp: input.timestamp as number, nonce: input.nonce, payload,
  }
  const expected = ports.crypto.hmacSha256Hex(
    canonicalMiniAppEvidenceIngress(unsigned),
    ports.secrets.bookingIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app evidence signature')
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app evidence timestamp')
  }
  validateContentBindings(payload, ports)
  return { ...unsigned, signature: input.signature }
}

function validateMetadataShape(payload: MiniAppEvidenceIngressPayload): void {
  if (!safeId(payload.draftId) || !safeId(payload.requestId)) throw new Error('invalid mini app evidence request')
  if (payload.evidenceKind !== 'PAYMENT' && payload.evidenceKind !== 'CHAT') throw new Error('invalid mini app evidence kind')
  if (payload.mimeType !== 'image/jpeg' && payload.mimeType !== 'image/png') throw new Error('invalid mini app evidence MIME')
  if (!/^[a-f0-9]{64}$/.test(payload.contentSha256) || !/^[a-f0-9]{64}$/.test(payload.uploadId)) {
    throw new Error('invalid mini app evidence hash')
  }
  if (typeof payload.bytesBase64 !== 'string' || payload.bytesBase64.length === 0 || payload.bytesBase64.length > MAX_BASE64_LENGTH) {
    throw new Error('invalid mini app evidence size')
  }
  const extension = payload.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  if (payload.fileName !== `${payload.evidenceKind.toLowerCase()}-${payload.uploadId}.${extension}`) {
    throw new Error('invalid mini app evidence file name')
  }
}

function validateContentBindings(payload: MiniAppEvidenceIngressPayload, ports: BookingPorts): void {
  const actualHash = ports.crypto.sha256Hex(payload.bytesBase64)
  if (!constantTimeEqual(payload.contentSha256, actualHash)) throw new Error('invalid mini app evidence content hash')
  const expectedUploadId = ports.crypto.sha256Hex(
    `${payload.draftId}\0${payload.evidenceKind}\0${payload.contentSha256}`,
  )
  if (!constantTimeEqual(payload.uploadId, expectedUploadId)) throw new Error('invalid mini app evidence upload ID')
}

function decodeEvidence(payload: MiniAppEvidenceIngressPayload, ports: BookingPorts): number[] {
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
