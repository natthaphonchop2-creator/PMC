import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  EXPENSE_BROWSER_TOKEN_MAX_PAYLOAD_LENGTH,
  isExpenseBrowserToken,
} from '../../../shared/pmcExpense.js'
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
  issuedAt: number
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
  const expiresAt = now + TOKEN_TTL_MS
  if (!Number.isSafeInteger(expiresAt)) throw new ExpenseStagingTokenError()
  const claims = orderedClaims({
    version: 1,
    objectKey: input.receipt.objectKey,
    staffId: input.staffId,
    rootRequestId: input.rootRequestId,
    ordinal: input.receipt.ordinal,
    sha256: input.receipt.sha256,
    issuedAt: now,
    expiresAt,
  })
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  if (payload.length > EXPENSE_BROWSER_TOKEN_MAX_PAYLOAD_LENGTH) throw new ExpenseStagingTokenError()
  const token = `${payload}.${signature(payload, input.secret)}`
  if (!isExpenseBrowserToken(token)) throw new ExpenseStagingTokenError()
  return token
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
    if (!isExpenseBrowserToken(token)) throw new ExpenseStagingTokenError()
    const parts = token.split('.')
    const payloadBytes = canonicalBase64url(parts[0]!)
    const signatureBytes = canonicalBase64url(parts[1]!)
    const expected = Buffer.from(signature(parts[0]!, input.secret), 'base64url')
    if (signatureBytes.length !== expected.length || !timingSafeEqual(signatureBytes, expected)) throw new ExpenseStagingTokenError()
    const claims = JSON.parse(payloadBytes.toString('utf8')) as unknown
    if (!isClaims(claims)) throw new ExpenseStagingTokenError()
    const ordered = orderedClaims(claims)
    if (
      ordered.staffId !== input.staffId
      || ordered.rootRequestId !== input.rootRequestId
      || ordered.expiresAt - ordered.issuedAt !== TOKEN_TTL_MS
      || ordered.issuedAt > now
      || ordered.expiresAt <= now
      || Buffer.from(JSON.stringify(ordered), 'utf8').toString('base64url') !== parts[0]
    ) {
      throw new ExpenseStagingTokenError()
    }
    const key = parseExpenseStagingObjectKey(ordered.objectKey)
    if (key.rootRequestId !== ordered.rootRequestId || key.ordinal !== ordered.ordinal || key.sha256 !== ordered.sha256) throw new ExpenseStagingTokenError()
    return ordered
  } catch {
    throw new ExpenseStagingTokenError()
  }
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}
function assertSafeSecret(value: string): void {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > 2_048) throw new ExpenseStagingTokenError()
}
function isClaims(value: unknown): value is ExpenseStagingTokenClaims {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'objectKey', 'staffId', 'rootRequestId', 'ordinal', 'sha256', 'issuedAt', 'expiresAt'])) return false
  const { version, objectKey, staffId, rootRequestId, ordinal, sha256, issuedAt, expiresAt } = value
  return version === 1 && typeof objectKey === 'string' && typeof staffId === 'string' && typeof rootRequestId === 'string'
    && SAFE_ID.test(staffId) && SAFE_ID.test(rootRequestId) && typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= 5
    && typeof sha256 === 'string' && SHA256.test(sha256)
    && typeof issuedAt === 'number' && Number.isSafeInteger(issuedAt) && issuedAt >= 0
    && typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) && expiresAt > 0
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function orderedClaims(value: ExpenseStagingTokenClaims): ExpenseStagingTokenClaims {
  return {
    version: 1,
    objectKey: value.objectKey,
    staffId: value.staffId,
    rootRequestId: value.rootRequestId,
    ordinal: value.ordinal,
    sha256: value.sha256,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }
}

function canonicalBase64url(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length < 1 || bytes.toString('base64url') !== value) throw new ExpenseStagingTokenError()
  return bytes
}
