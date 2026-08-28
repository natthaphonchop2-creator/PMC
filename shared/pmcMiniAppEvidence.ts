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
