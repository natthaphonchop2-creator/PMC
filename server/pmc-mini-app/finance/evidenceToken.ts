import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseExpenseDate } from '../../../shared/pmcExpense.js'

const TOKEN_TTL_MS = 5 * 60 * 1_000
const MAX_TOKEN_LENGTH = 2_048
const MAX_PAYLOAD_LENGTH = 1_536
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/

export interface FinanceEvidenceTokenClaims {
  version: 1
  staffId: string
  monthKey: string
  expenseId: string
  attachmentId: string
  issuedAt: number
  expiresAt: number
}

export class FinanceEvidenceTokenError extends Error {
  readonly code = 'EXPENSE_EVIDENCE_TOKEN_INVALID'

  constructor() {
    super('EXPENSE_EVIDENCE_TOKEN_INVALID')
    this.name = 'FinanceEvidenceTokenError'
  }
}

export function signFinanceEvidenceToken(input: {
  staffId: string
  monthKey: string
  expenseId: string
  attachmentId: string
  secret: string
  now?: () => number
}): string {
  try {
    requireSecret(input.secret)
    const issuedAt = input.now?.() ?? Date.now()
    requireNow(issuedAt)
    requireBoundIdentity(input)
    const expiresAt = issuedAt + TOKEN_TTL_MS
    if (!Number.isSafeInteger(expiresAt)) throw invalid()
    const claims = orderedClaims({
      version: 1,
      staffId: input.staffId,
      monthKey: input.monthKey,
      expenseId: input.expenseId,
      attachmentId: input.attachmentId,
      issuedAt,
      expiresAt,
    })
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
    if (payload.length > MAX_PAYLOAD_LENGTH) throw invalid()
    const token = `${payload}.${signature(payload, input.secret)}`
    if (token.length > MAX_TOKEN_LENGTH) throw invalid()
    return token
  } catch {
    throw invalid()
  }
}

export function verifyFinanceEvidenceToken(token: string, input: {
  staffId: string
  secret: string
  now?: () => number
}): FinanceEvidenceTokenClaims {
  try {
    requireSecret(input.secret)
    const now = input.now?.() ?? Date.now()
    requireNow(now)
    if (!SAFE_ID.test(input.staffId) || typeof token !== 'string' || token.length < 3 || token.length > MAX_TOKEN_LENGTH) {
      throw invalid()
    }
    const parts = token.split('.')
    if (
      parts.length !== 2
      || parts[0]!.length < 1
      || parts[0]!.length > MAX_PAYLOAD_LENGTH
      || parts[1]!.length !== 43
      || !BASE64URL.test(parts[0]!)
      || !BASE64URL.test(parts[1]!)
    ) throw invalid()
    const payloadBytes = canonicalBase64url(parts[0]!)
    const signatureBytes = canonicalBase64url(parts[1]!)
    const expectedBytes = Buffer.from(signature(parts[0]!, input.secret), 'base64url')
    if (
      signatureBytes.length !== expectedBytes.length
      || !timingSafeEqual(signatureBytes, expectedBytes)
    ) throw invalid()
    let parsed: unknown
    try {
      parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown
    } catch {
      throw invalid()
    }
    if (!isClaims(parsed)) throw invalid()
    const claims = orderedClaims(parsed)
    if (
      claims.staffId !== input.staffId
      || claims.expiresAt - claims.issuedAt !== TOKEN_TTL_MS
      || claims.issuedAt > now
      || claims.expiresAt <= now
      || Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url') !== parts[0]
    ) throw invalid()
    return claims
  } catch {
    throw invalid()
  }
}

function orderedClaims(value: FinanceEvidenceTokenClaims): FinanceEvidenceTokenClaims {
  return {
    version: 1,
    staffId: value.staffId,
    monthKey: value.monthKey,
    expenseId: value.expenseId,
    attachmentId: value.attachmentId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }
}

function isClaims(value: unknown): value is FinanceEvidenceTokenClaims {
  if (!isRecord(value) || !hasExactKeys(value, [
    'version', 'staffId', 'monthKey', 'expenseId', 'attachmentId', 'issuedAt', 'expiresAt',
  ])) return false
  if (
    value.version !== 1
    || typeof value.staffId !== 'string'
    || typeof value.monthKey !== 'string'
    || typeof value.expenseId !== 'string'
    || typeof value.attachmentId !== 'string'
    || typeof value.issuedAt !== 'number'
    || typeof value.expiresAt !== 'number'
  ) return false
  try {
    requireNow(value.issuedAt)
    requireNow(value.expiresAt)
    requireBoundIdentity({
      staffId: value.staffId,
      monthKey: value.monthKey,
      expenseId: value.expenseId,
      attachmentId: value.attachmentId,
    })
    return true
  } catch {
    return false
  }
}

function requireBoundIdentity(value: {
  staffId: string
  monthKey: string
  expenseId: string
  attachmentId: string
}): void {
  if (!SAFE_ID.test(value.staffId) || !SAFE_ID.test(value.attachmentId)) throw invalid()
  try {
    if (parseExpenseDate(`${value.monthKey}-01`).monthKey !== value.monthKey) throw invalid()
  } catch {
    throw invalid()
  }
  if (
    !SAFE_ID.test(value.expenseId)
    || !new RegExp(`^EXP-${value.monthKey.replace('-', '')}-[A-Za-z0-9._:-]{1,107}$`).test(value.expenseId)
  ) throw invalid()
}

function requireSecret(value: string): void {
  const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0
  if (length < 32 || length > 2_048) throw invalid()
}

function requireNow(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid()
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')
}

function canonicalBase64url(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length < 1 || bytes.toString('base64url') !== value) throw invalid()
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<const T extends readonly string[]>(
  value: Record<string, unknown>,
  keys: T,
): value is Record<T[number], unknown> {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function invalid(): FinanceEvidenceTokenError {
  return new FinanceEvidenceTokenError()
}
