import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseExpenseStagingObjectKey, type ExpenseStagingReceipt } from './stagingStore.js'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/

export interface ExpenseStagingTokenClaims {
  version: 1
  objectKey: string
  staffId: string
  rootRequestId: string
  ordinal: number
  sha256: string
  expiresAt: number
}

export class ExpenseStagingTokenError extends Error {
  readonly code = 'EXPENSE_STAGING_TOKEN_INVALID'

  constructor() {
    super('EXPENSE_STAGING_TOKEN_INVALID')
    this.name = 'ExpenseStagingTokenError'
  }
}

export function signExpenseStagingReceipt(input: {
  receipt: ExpenseStagingReceipt
  staffId: string
  rootRequestId: string
  secret: string
  now?: () => number
}): string {
  const now = input.now?.() ?? Date.now()
  assertSafeSecret(input.secret)
  if (!Number.isSafeInteger(now) || now < 0 || !SAFE_ID.test(input.staffId) || !SAFE_ID.test(input.rootRequestId)) throw new ExpenseStagingTokenError()
  const key = parseExpenseStagingObjectKey(input.receipt.objectKey)
  if (
    key.rootRequestId !== input.rootRequestId || key.ordinal !== input.receipt.ordinal || key.sha256 !== input.receipt.sha256
    || !SHA256.test(input.receipt.sha256) || !Number.isSafeInteger(input.receipt.ordinal) || input.receipt.ordinal < 1 || input.receipt.ordinal > 5
  ) throw new ExpenseStagingTokenError()
  const claims: ExpenseStagingTokenClaims = {
    version: 1,
    objectKey: input.receipt.objectKey,
    staffId: input.staffId,
    rootRequestId: input.rootRequestId,
    ordinal: input.receipt.ordinal,
    sha256: input.receipt.sha256,
    expiresAt: now + TOKEN_TTL_MS,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${signature(payload, input.secret)}`
}

export function verifyExpenseStagingReceipt(token: string, input: {
  staffId: string
  rootRequestId: string
  secret: string
  now?: () => number
}): ExpenseStagingTokenClaims {
  try {
    assertSafeSecret(input.secret)
    const now = input.now?.() ?? Date.now()
    if (!Number.isSafeInteger(now) || now < 0 || !SAFE_ID.test(input.staffId) || !SAFE_ID.test(input.rootRequestId)) throw new ExpenseStagingTokenError()
    const parts = token.split('.')
    if (parts.length !== 2 || !safeTokenPart(parts[0]!) || !safeTokenPart(parts[1]!)) throw new ExpenseStagingTokenError()
    const expected = Buffer.from(signature(parts[0]!, input.secret), 'base64url')
    const actual = Buffer.from(parts[1]!, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ExpenseStagingTokenError()
    const claims = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as unknown
    if (!isClaims(claims) || claims.staffId !== input.staffId || claims.rootRequestId !== input.rootRequestId || claims.expiresAt <= now) {
      throw new ExpenseStagingTokenError()
    }
    const key = parseExpenseStagingObjectKey(claims.objectKey)
    if (key.rootRequestId !== claims.rootRequestId || key.ordinal !== claims.ordinal || key.sha256 !== claims.sha256) throw new ExpenseStagingTokenError()
    return claims
  } catch {
    throw new ExpenseStagingTokenError()
  }
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}
function assertSafeSecret(value: string): void {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) throw new ExpenseStagingTokenError()
}
function safeTokenPart(value: string): boolean { return /^[A-Za-z0-9_-]+$/.test(value) }
function isClaims(value: unknown): value is ExpenseStagingTokenClaims {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'objectKey', 'staffId', 'rootRequestId', 'ordinal', 'sha256', 'expiresAt'])) return false
  const { version, objectKey, staffId, rootRequestId, ordinal, sha256, expiresAt } = value
  return version === 1 && typeof objectKey === 'string' && typeof staffId === 'string' && typeof rootRequestId === 'string'
    && SAFE_ID.test(staffId) && SAFE_ID.test(rootRequestId) && typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= 5
    && typeof sha256 === 'string' && SHA256.test(sha256) && typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) && expiresAt > 0
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
