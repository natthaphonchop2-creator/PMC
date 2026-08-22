import { createHmac, timingSafeEqual } from 'node:crypto'

export type ReviewTokenAction = 'REVIEW' | 'CONFIRM' | 'CANCEL' | 'RETRY'

export interface ReviewTokenPayload {
  v: 1
  documentId: string
  groupId: string
  draftVersion: number
  action: ReviewTokenAction
  exp: number
}

const MAX_REVIEW_TOKEN_TTL_SECONDS = 24 * 60 * 60
const REVIEW_TOKEN_KEYS = ['v', 'documentId', 'groupId', 'draftVersion', 'action', 'exp']

export function verifyLineSignature(rawBody: string | Buffer, suppliedSignature: string, channelSecret: string): boolean {
  if (!channelSecret || !suppliedSignature) return false
  const expectedSignature = createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  return safeEqual(suppliedSignature, expectedSignature)
}

export function signReviewToken(payload: ReviewTokenPayload, secret: string): string {
  if (!secret || !isReviewTokenPayload(payload)) throw new Error('Invalid review token')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${reviewTokenSignature(body, secret)}`
}

export function verifyReviewToken(token: string, secret: string, now: number): ReviewTokenPayload {
  const [body, suppliedSignature, extra] = token.split('.')
  if (!body || !suppliedSignature || extra || !secret || !Number.isSafeInteger(now)) {
    throw new Error('Invalid review token')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    throw new Error('Invalid review token')
  }
  if (!safeEqual(suppliedSignature, reviewTokenSignature(body, secret))) {
    throw new Error('Invalid review token')
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid review token')
  }
  if (!isReviewTokenPayload(payload)) throw new Error('Invalid review token')
  if (payload.exp <= now) throw new Error('Expired review token')
  if (payload.exp - now > MAX_REVIEW_TOKEN_TTL_SECONDS) throw new Error('Invalid review token')
  return payload
}

function reviewTokenSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function safeEqual(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function isReviewTokenPayload(value: unknown): value is ReviewTokenPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).length !== REVIEW_TOKEN_KEYS.length || Object.keys(payload).some((key) => !REVIEW_TOKEN_KEYS.includes(key))) return false
  return (
    payload.v === 1 &&
    typeof payload.documentId === 'string' && /^OCR-\d{8}-[A-Za-z0-9_-]{6,64}$/.test(payload.documentId) &&
    typeof payload.groupId === 'string' && /^C[A-Za-z0-9_-]{1,127}$/.test(payload.groupId) &&
    typeof payload.draftVersion === 'number' && Number.isSafeInteger(payload.draftVersion) && payload.draftVersion >= 1 &&
    (payload.action === 'REVIEW' || payload.action === 'CONFIRM' || payload.action === 'CANCEL' || payload.action === 'RETRY') &&
    typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp) && payload.exp > 0
  )
}
