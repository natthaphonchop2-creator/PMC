import { createHmac, timingSafeEqual } from 'node:crypto'

export type BookingEvidenceKind = 'PAYMENT' | 'CHAT'
export type BookingEvidenceVariant = 'preview' | 'full'

export interface BookingEvidenceTokenPayload {
  v: 1
  caseId: string
  fileId: string
  kind: BookingEvidenceKind
  ordinal: number
  variant: BookingEvidenceVariant
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function validPayload(value: unknown): value is BookingEvidenceTokenPayload {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    item.v === 1 &&
    typeof item.caseId === 'string' &&
    /^PMC-\d{6}-\d{4}$/.test(item.caseId) &&
    typeof item.fileId === 'string' &&
    /^[A-Za-z0-9_-]{6,128}$/.test(item.fileId) &&
    ['PAYMENT', 'CHAT'].includes(String(item.kind)) &&
    Number.isInteger(item.ordinal) &&
    Number(item.ordinal) >= 1 &&
    Number(item.ordinal) <= 99 &&
    ['preview', 'full'].includes(String(item.variant))
  )
}

export function signBookingEvidenceToken(
  payload: BookingEvidenceTokenPayload,
  secret: string,
): string {
  if (!secret || !validPayload(payload)) throw new Error('Invalid evidence token')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signature(body, secret)}`
}

export function verifyBookingEvidenceToken(
  token: string,
  secret: string,
): BookingEvidenceTokenPayload {
  const [body, supplied, extra] = token.split('.')
  if (!body || !supplied || extra || !secret) throw new Error('Invalid evidence token')

  const expected = signature(body, secret)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('Invalid evidence token')
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown
    if (!validPayload(parsed)) throw new Error('Invalid evidence token')
    return parsed
  } catch {
    throw new Error('Invalid evidence token')
  }
}
