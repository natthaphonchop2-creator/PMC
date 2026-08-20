import type {
  BookingEvidenceImages,
  CryptoPort,
  EvidenceImageRef,
  EvidenceMediaPort,
} from '../ports'

export type EvidenceKind = 'PAYMENT' | 'CHAT'
export type EvidenceVariant = 'preview' | 'full'

export interface EvidenceTokenPayload {
  v: 1
  caseId: string
  fileId: string
  kind: EvidenceKind
  ordinal: number
  variant: EvidenceVariant
}

function validPayload(payload: EvidenceTokenPayload): boolean {
  return (
    payload.v === 1 &&
    /^PMC-\d{6}-\d{4}$/.test(payload.caseId) &&
    /^[A-Za-z0-9_-]{6,128}$/.test(payload.fileId) &&
    ['PAYMENT', 'CHAT'].includes(payload.kind) &&
    Number.isInteger(payload.ordinal) &&
    payload.ordinal >= 1 &&
    payload.ordinal <= 99 &&
    ['preview', 'full'].includes(payload.variant)
  )
}

export function evidenceToken(
  payload: EvidenceTokenPayload,
  secret: string,
  crypto: CryptoPort,
): string {
  if (!secret || !validPayload(payload)) throw new Error('invalid evidence media payload')
  const body = crypto.base64UrlUtf8(JSON.stringify(payload))
  return `${body}.${crypto.hmacSha256Hex(body, secret)}`
}

function imageRef(
  baseUrl: string,
  caseId: string,
  fileId: string,
  kind: EvidenceKind,
  ordinal: number,
  secret: string,
  crypto: CryptoPort,
): EvidenceImageRef {
  const url = (variant: EvidenceVariant) => {
    const token = evidenceToken(
      { v: 1, caseId, fileId, kind, ordinal, variant },
      secret,
      crypto,
    )
    return `${baseUrl}?t=${encodeURIComponent(token)}`
  }
  return { previewUrl: url('preview'), fullUrl: url('full') }
}

export function createEvidenceMediaPort(
  rawBaseUrl: string,
  secret: string,
  crypto: CryptoPort,
): EvidenceMediaPort {
  const baseUrl = rawBaseUrl.trim().replace(/[?&]+$/, '')
  if (!baseUrl.startsWith('https://')) throw new Error('evidence media base URL must use HTTPS')
  if (!secret) throw new Error('evidence media signing secret is required')
  return {
    images(caseId, paymentFileIds, chatFileIds): BookingEvidenceImages {
      return {
        payment: paymentFileIds[0]
          ? imageRef(baseUrl, caseId, paymentFileIds[0], 'PAYMENT', 1, secret, crypto)
          : null,
        chats: chatFileIds
          .slice(0, 3)
          .map((fileId, index) =>
            imageRef(baseUrl, caseId, fileId, 'CHAT', index + 1, secret, crypto),
          ),
        totalChatCount: chatFileIds.length,
      }
    },
  }
}
