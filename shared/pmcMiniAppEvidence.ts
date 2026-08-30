export type MiniAppEvidenceIngressKind = 'PAYMENT' | 'CHAT'
export type MiniAppEvidenceIngressMime = 'image/jpeg' | 'image/png'

export interface MiniAppEvidenceIngressPayload {
  draftId: string
  requestId: string
  evidenceKind: MiniAppEvidenceIngressKind
  uploadId: string
  fileName: string
  mimeType: MiniAppEvidenceIngressMime
  bytesBase64: string
  contentSha256: string
}

export interface MiniAppEvidenceSlotIdentityV2 {
  requestId: string
  draftId: string
  evidenceKind: MiniAppEvidenceIngressKind
  ordinal: number
  mimeType: MiniAppEvidenceIngressMime
  contentSha256: string
}

export interface MiniAppEvidenceIngressPayloadV2 extends MiniAppEvidenceSlotIdentityV2 {
  uploadId: string
  fileName: string
  bytesBase64: string
}

export interface UnsignedMiniAppEvidenceIngressEnvelope {
  kind: 'MINI_APP_EVIDENCE'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppEvidenceIngressPayload
}

export interface MiniAppEvidenceIngressEnvelope extends UnsignedMiniAppEvidenceIngressEnvelope {
  signature: string
}

export interface UnsignedMiniAppEvidenceIngressEnvelopeV2 {
  kind: 'MINI_APP_EVIDENCE'
  version: 2
  timestamp: number
  nonce: string
  payload: MiniAppEvidenceIngressPayloadV2
}

export interface MiniAppEvidenceIngressEnvelopeV2 extends UnsignedMiniAppEvidenceIngressEnvelopeV2 {
  signature: string
}

export type AnyUnsignedMiniAppEvidenceIngressEnvelope =
  | UnsignedMiniAppEvidenceIngressEnvelope
  | UnsignedMiniAppEvidenceIngressEnvelopeV2

export type AnyMiniAppEvidenceIngressEnvelope =
  | MiniAppEvidenceIngressEnvelope
  | MiniAppEvidenceIngressEnvelopeV2

export function canonicalMiniAppEvidenceIngress(envelope: UnsignedMiniAppEvidenceIngressEnvelope): string {
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: {
      draftId: envelope.payload.draftId,
      requestId: envelope.payload.requestId,
      evidenceKind: envelope.payload.evidenceKind,
      uploadId: envelope.payload.uploadId,
      fileName: envelope.payload.fileName,
      mimeType: envelope.payload.mimeType,
      contentSha256: envelope.payload.contentSha256,
    },
  })
}

export function canonicalMiniAppEvidenceIngressV2(envelope: UnsignedMiniAppEvidenceIngressEnvelopeV2): string {
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: {
      requestId: envelope.payload.requestId,
      draftId: envelope.payload.draftId,
      evidenceKind: envelope.payload.evidenceKind,
      ordinal: envelope.payload.ordinal,
      mimeType: envelope.payload.mimeType,
      contentSha256: envelope.payload.contentSha256,
      uploadId: envelope.payload.uploadId,
      fileName: envelope.payload.fileName,
    },
  })
}

export function canonicalMiniAppEvidenceSlotV2(slot: MiniAppEvidenceSlotIdentityV2): string {
  return JSON.stringify({
    version: 2,
    requestId: slot.requestId,
    draftId: slot.draftId,
    evidenceKind: slot.evidenceKind,
    ordinal: slot.ordinal,
    mimeType: slot.mimeType,
    contentSha256: slot.contentSha256,
  })
}

export function miniAppEvidenceUploadIdV2(
  slot: MiniAppEvidenceSlotIdentityV2,
  sha256Hex: (value: string) => string,
): string {
  return sha256Hex(canonicalMiniAppEvidenceSlotV2(slot)).toLowerCase()
}

export function miniAppEvidenceFileNameV2(slot: MiniAppEvidenceSlotIdentityV2, uploadId: string): string {
  const extension = slot.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  return `${slot.evidenceKind.toLowerCase()}-${String(slot.ordinal).padStart(2, '0')}-${uploadId}.${extension}`
}

export function miniAppEvidenceObjectKeyV2(slot: MiniAppEvidenceSlotIdentityV2, uploadId: string): string {
  const extension = slot.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  return `drafts/v2/${slot.requestId}/${slot.draftId}/${slot.evidenceKind}/${slot.ordinal}/${uploadId}/${slot.contentSha256}.${extension}`
}

export function miniAppEvidenceFileMarkerV2(slot: MiniAppEvidenceSlotIdentityV2, uploadId: string): string {
  return JSON.stringify({
    kind: 'MINI_APP_EVIDENCE_FILE',
    version: 2,
    requestId: slot.requestId,
    draftId: slot.draftId,
    evidenceKind: slot.evidenceKind,
    ordinal: slot.ordinal,
    mimeType: slot.mimeType,
    contentSha256: slot.contentSha256,
    uploadId,
  })
}
