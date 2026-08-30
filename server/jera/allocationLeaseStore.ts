import { createHash } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'

const PREFIX = 'jera-allocation-leases'
const DAY_KEY = /^[a-f0-9]{64}$/
const OWNER = /^[A-Za-z0-9._:-]{1,256}$/
export const JERA_ALLOCATION_STORE_LEASE_KEY = createHash('sha256').update('JERA_ALLOCATION_STORE_V1').digest('hex')

export interface JeraAllocationLease {
  dayKey: string
  owner: string
  fencingToken: string
  expiresAt: string
}

export interface JeraAllocationLeasePort {
  claim(input: { dayKey: string; owner: string; now: string; ttlMs: number }): Promise<JeraAllocationLease | null>
  renew(lease: JeraAllocationLease, input: { now: string; ttlMs: number }): Promise<JeraAllocationLease | null>
  assertCurrent(lease: JeraAllocationLease, now: string): Promise<boolean>
  release(lease: JeraAllocationLease): Promise<void>
}

export class JeraAllocationLeaseError extends Error {
  readonly code: 'JERA_ALLOCATION_LEASE_INVALID_INPUT' | 'JERA_ALLOCATION_LEASE_CORRUPT' | 'JERA_ALLOCATION_LEASE_FAILED'
  constructor(code: JeraAllocationLeaseError['code']) { super(code); this.name = 'JeraAllocationLeaseError'; this.code = code }
}

export function jeraAllocationLeaseObjectKey(dayKey: string): string {
  assertDayKey(dayKey)
  return `${PREFIX}/${dayKey}.json`
}

export function createGoogleJeraAllocationLeasePort(input: { bucketName: string; storage?: Storage }): JeraAllocationLeasePort {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}$/.test(input.bucketName)) throw new JeraAllocationLeaseError('JERA_ALLOCATION_LEASE_INVALID_INPUT')
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)

  async function read(dayKey: string): Promise<JeraAllocationLease | null> {
    const objectKey = jeraAllocationLeaseObjectKey(dayKey)
    const file = bucket.file(objectKey)
    let metadata: FileMetadata
    try {
      metadata = (await file.getMetadata())[0]
    } catch (error) {
      if (status(error) === 404) return null
      throw failed()
    }
    const generation = verifyMetadata(objectKey, metadata)
    let bytes: Buffer
    try {
      [bytes] = await bucket.file(objectKey, { generation }).download()
    } catch (error) {
      if (status(error) === 404 || status(error) === 412) return null
      throw failed()
    }
    if (bytes.length > 512) corrupt()
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch { corrupt() }
    return parseLease(parsed, generation)
  }

  async function save(lease: Omit<JeraAllocationLease, 'fencingToken'>, ifGenerationMatch: string | number): Promise<JeraAllocationLease | null> {
    const objectKey = jeraAllocationLeaseObjectKey(lease.dayKey)
    const body = Buffer.from(JSON.stringify({ dayKey: lease.dayKey, owner: lease.owner, expiresAt: lease.expiresAt }))
    try {
      await bucket.file(objectKey).save(body, {
        resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch },
        metadata: { contentType: 'application/json', cacheControl: 'no-store' },
      })
    } catch (error) {
      if (status(error) === 412) return null
      throw failed()
    }
    const persisted = await read(lease.dayKey)
    if (!persisted || persisted.owner !== lease.owner || persisted.expiresAt !== lease.expiresAt) return null
    return persisted
  }

  return {
    async claim(request) {
      validateClaim(request)
      const expiresAt = new Date(Date.parse(request.now) + request.ttlMs).toISOString()
      const next = { dayKey: request.dayKey, owner: request.owner, expiresAt }
      const current = await read(request.dayKey)
      if (!current) return save(next, 0)
      if (Date.parse(current.expiresAt) > Date.parse(request.now)) return null
      return save(next, current.fencingToken)
    },
    async renew(lease, request) {
      validateLease(lease)
      validateRenew(request)
      const now = Date.parse(request.now)
      if (Date.parse(lease.expiresAt) <= now) return null
      const current = await read(lease.dayKey)
      if (!sameLeaseGeneration(current, lease) || Date.parse(current.expiresAt) <= now) return null
      return save({
        dayKey: lease.dayKey,
        owner: lease.owner,
        expiresAt: new Date(now + request.ttlMs).toISOString(),
      }, lease.fencingToken)
    },
    async assertCurrent(lease, nowValue) {
      validateLease(lease)
      const now = Date.parse(instant(nowValue))
      const current = await read(lease.dayKey)
      return sameLeaseGeneration(current, lease) && Date.parse(current.expiresAt) > now
    },
    async release(lease) {
      validateLease(lease)
      const objectKey = jeraAllocationLeaseObjectKey(lease.dayKey)
      try {
        await bucket.file(objectKey).delete({ ifGenerationMatch: lease.fencingToken })
      } catch (error) {
        if (status(error) === 404 || status(error) === 412) return
        throw failed()
      }
    },
  }
}

function validateClaim(input: { dayKey: string; owner: string; now: string; ttlMs: number }): void {
  assertDayKey(input.dayKey); assertOwner(input.owner); instant(input.now)
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 900_000) invalid()
}
function validateRenew(input: { now: string; ttlMs: number }): void {
  instant(input.now)
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 900_000) invalid()
}
function validateLease(lease: JeraAllocationLease): void {
  if (!lease || typeof lease !== 'object') invalid()
  assertDayKey(lease.dayKey); assertOwner(lease.owner); assertGeneration(lease.fencingToken); instant(lease.expiresAt)
}
function parseLease(value: unknown, generation: string): JeraAllocationLease {
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt()
  const object = value as Record<string, unknown>
  if (Object.keys(object).length !== 3 || typeof object.dayKey !== 'string' || typeof object.owner !== 'string' || typeof object.expiresAt !== 'string') corrupt()
  try { assertDayKey(object.dayKey); assertOwner(object.owner); instant(object.expiresAt) } catch { corrupt() }
  return { dayKey: object.dayKey, owner: object.owner, fencingToken: generation, expiresAt: new Date(object.expiresAt).toISOString() }
}
function sameLeaseGeneration(current: JeraAllocationLease | null, expected: JeraAllocationLease): current is JeraAllocationLease {
  return Boolean(current && current.dayKey === expected.dayKey && current.owner === expected.owner
    && current.fencingToken === expected.fencingToken && current.expiresAt === expected.expiresAt)
}
function verifyMetadata(key: string, metadata: FileMetadata): string {
  if (metadata.name !== undefined && metadata.name !== key || metadata.contentType !== 'application/json' || metadata.cacheControl !== 'no-store'
    || metadata.contentEncoding !== undefined && metadata.contentEncoding !== '' || !emptyMetadata(metadata.metadata)
    || !safeSize(metadata.size) || !safeGeneration(metadata.generation)) corrupt()
  return String(metadata.generation)
}
function emptyMetadata(value: FileMetadata['metadata']): boolean { return value === undefined || typeof value === 'object' && value !== null && Object.keys(value).length === 0 }
function safeSize(value: string | number | undefined): boolean { const size = Number(value); return Number.isSafeInteger(size) && size > 0 && size <= 512 }
function safeGeneration(value: string | number | undefined): value is string | number { return typeof value === 'number' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && /^[1-9]\d*$/.test(value) }
function assertDayKey(value: string): void { if (typeof value !== 'string' || !DAY_KEY.test(value)) invalid() }
function assertOwner(value: string): void { if (typeof value !== 'string' || !OWNER.test(value)) invalid() }
function assertGeneration(value: string): void { if (!/^[1-9]\d*$/.test(value)) invalid() }
function instant(value: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(); return new Date(value).toISOString() }
function status(error: unknown): number | null { return error && typeof error === 'object' && 'code' in error && (error.code === 404 || error.code === '404' || error.code === 412 || error.code === '412') ? Number(error.code) : null }
function invalid(): never { throw new JeraAllocationLeaseError('JERA_ALLOCATION_LEASE_INVALID_INPUT') }
function corrupt(): never { throw new JeraAllocationLeaseError('JERA_ALLOCATION_LEASE_CORRUPT') }
function failed(): JeraAllocationLeaseError { return new JeraAllocationLeaseError('JERA_ALLOCATION_LEASE_FAILED') }
