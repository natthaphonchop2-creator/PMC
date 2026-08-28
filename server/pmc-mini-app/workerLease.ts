import { createHash, randomUUID } from 'node:crypto'
import { Storage, type FileMetadata } from '@google-cloud/storage'

const MAX_LEASE_MS = 4 * 60_000
const MAX_LEASE_BODY_BYTES = 512
const MAX_ACQUIRE_RACES = 4
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SAFE_OWNER_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const SAFE_LOCK_KEY = /^locks\/[a-f0-9]{64}$/

export interface WorkerLeaseHandle {
  lockKey: string
  ownerToken: string
  expiresAt: string
  generation: string
}

export type WorkerLeaseAcquireResult =
  | { acquired: true; lease: WorkerLeaseHandle }
  | { acquired: false; expiresAt: string }

export interface WorkerLeasePort {
  acquire(input: { requestId: string; nowIso: string; leaseUntil: string }): Promise<WorkerLeaseAcquireResult>
  renew(input: { lease: WorkerLeaseHandle; nowIso: string; leaseUntil: string }): Promise<WorkerLeaseHandle>
  release(lease: WorkerLeaseHandle): Promise<void>
}

export class WorkerLeaseError extends Error {
  readonly code: 'WORKER_LEASE_INVALID_INPUT' | 'WORKER_LEASE_CORRUPT' | 'WORKER_LEASE_LOST' | 'WORKER_LEASE_FAILED'

  constructor(code: WorkerLeaseError['code']) {
    super(code)
    this.name = 'WorkerLeaseError'
    this.code = code
  }
}

export function createGoogleWorkerLeasePort(input: {
  bucketName: string
  storage?: Storage
  ownerToken?: () => string
}): WorkerLeasePort {
  if (!safeBucketName(input.bucketName)) throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)
  const nextOwnerToken = input.ownerToken ?? randomUUID

  async function readLease(lockKey: string, generation?: string): Promise<WorkerLeaseHandle> {
    const metadataFile = bucket.file(lockKey, generation === undefined ? undefined : { generation })
    const metadata = (await metadataFile.getMetadata())[0]
    const inspected = inspectMetadata(lockKey, metadata)
    const [body] = await bucket.file(lockKey, { generation: inspected.generation }).download({ validation: 'crc32c' })
    if (!Buffer.isBuffer(body) || body.length !== inspected.size || body.length > MAX_LEASE_BODY_BYTES) {
      throw new WorkerLeaseError('WORKER_LEASE_CORRUPT')
    }
    const parsed = parseLeaseBody(body)
    if (parsed.ownerToken !== inspected.ownerToken || parsed.expiresAt !== inspected.expiresAt) {
      throw new WorkerLeaseError('WORKER_LEASE_CORRUPT')
    }
    return { lockKey, ...parsed, generation: inspected.generation }
  }

  async function saveLease(
    lockKey: string,
    ownerToken: string,
    expiresAt: string,
    ifGenerationMatch: string | number,
  ): Promise<WorkerLeaseHandle> {
    const body = leaseBody(ownerToken, expiresAt)
    await bucket.file(lockKey).save(body, {
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch },
      metadata: {
        contentType: 'application/json',
        cacheControl: 'no-store',
        metadata: { ownerToken, expiresAt },
      },
    })
    const persisted = await readLease(lockKey)
    if (persisted.ownerToken !== ownerToken || persisted.expiresAt !== expiresAt) {
      throw new WorkerLeaseError('WORKER_LEASE_CORRUPT')
    }
    return persisted
  }

  return {
    async acquire(acquireInput) {
      validateAcquisition(acquireInput)
      const lockKey = workerLockKey(acquireInput.requestId)
      const ownerToken = nextOwnerToken()
      if (!SAFE_OWNER_TOKEN.test(ownerToken)) throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')

      for (let race = 0; race < MAX_ACQUIRE_RACES; race += 1) {
        try {
          return {
            acquired: true,
            lease: await saveLease(lockKey, ownerToken, acquireInput.leaseUntil, 0),
          }
        } catch (error) {
          if (!isPreconditionFailure(error)) throw safeLeaseFailure(error)
        }

        let existing: WorkerLeaseHandle
        try {
          existing = await readLease(lockKey)
        } catch (error) {
          if (isNotFound(error) || isPreconditionFailure(error)) continue
          throw safeLeaseFailure(error)
        }
        if (Date.parse(existing.expiresAt) > Date.parse(acquireInput.nowIso)) {
          return { acquired: false, expiresAt: existing.expiresAt }
        }
        try {
          await bucket.file(lockKey).delete({ ifGenerationMatch: existing.generation })
        } catch (error) {
          if (isNotFound(error) || isPreconditionFailure(error)) continue
          throw new WorkerLeaseError('WORKER_LEASE_FAILED')
        }
      }
      throw new WorkerLeaseError('WORKER_LEASE_FAILED')
    },

    async renew(renewInput) {
      validateHandle(renewInput.lease)
      validateLeaseWindow(renewInput.nowIso, renewInput.leaseUntil)
      if (Date.parse(renewInput.lease.expiresAt) <= Date.parse(renewInput.nowIso)) {
        throw new WorkerLeaseError('WORKER_LEASE_LOST')
      }
      try {
        const current = await readLease(renewInput.lease.lockKey, renewInput.lease.generation)
        if (current.ownerToken !== renewInput.lease.ownerToken) throw new WorkerLeaseError('WORKER_LEASE_LOST')
        return await saveLease(
          renewInput.lease.lockKey,
          renewInput.lease.ownerToken,
          renewInput.leaseUntil,
          renewInput.lease.generation,
        )
      } catch (error) {
        if (error instanceof WorkerLeaseError) throw error
        if (isNotFound(error) || isPreconditionFailure(error)) throw new WorkerLeaseError('WORKER_LEASE_LOST')
        throw new WorkerLeaseError('WORKER_LEASE_FAILED')
      }
    },

    async release(lease) {
      validateHandle(lease)
      try {
        const current = await readLease(lease.lockKey, lease.generation)
        if (current.ownerToken !== lease.ownerToken) return
        await bucket.file(lease.lockKey).delete({ ifGenerationMatch: lease.generation })
      } catch (error) {
        if (isNotFound(error) || isPreconditionFailure(error)) return
        if (error instanceof WorkerLeaseError) throw error
        throw new WorkerLeaseError('WORKER_LEASE_FAILED')
      }
    },
  }
}

function workerLockKey(requestId: string): string {
  return `locks/${createHash('sha256').update(requestId, 'utf8').digest('hex')}`
}

function leaseBody(ownerToken: string, expiresAt: string): Buffer {
  const body = Buffer.from(JSON.stringify({ ownerToken, expiresAt }), 'utf8')
  if (body.length > MAX_LEASE_BODY_BYTES) throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')
  return body
}

function parseLeaseBody(body: Buffer): { ownerToken: string; expiresAt: string } {
  let value: unknown
  try { value = JSON.parse(body.toString('utf8')) } catch { throw new WorkerLeaseError('WORKER_LEASE_CORRUPT') }
  if (!isRecord(value) || !hasExactKeys(value, ['ownerToken', 'expiresAt'])
    || typeof value.ownerToken !== 'string' || !SAFE_OWNER_TOKEN.test(value.ownerToken)
    || typeof value.expiresAt !== 'string' || !validIso(value.expiresAt)) {
    throw new WorkerLeaseError('WORKER_LEASE_CORRUPT')
  }
  return { ownerToken: value.ownerToken, expiresAt: value.expiresAt }
}

function inspectMetadata(
  lockKey: string,
  metadata: FileMetadata,
): { ownerToken: string; expiresAt: string; generation: string; size: number } {
  const size = Number(metadata.size)
  const generation = String(metadata.generation ?? '')
  const custom = metadata.metadata
  if (!SAFE_LOCK_KEY.test(lockKey) || metadata.name !== undefined && metadata.name !== lockKey
    || metadata.contentType !== 'application/json' || metadata.cacheControl !== 'no-store'
    || metadata.contentEncoding !== undefined && metadata.contentEncoding !== ''
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_LEASE_BODY_BYTES
    || !/^[1-9]\d*$/.test(generation) || !isRecord(custom) || !hasExactKeys(custom, ['ownerToken', 'expiresAt'])
    || typeof custom.ownerToken !== 'string' || !SAFE_OWNER_TOKEN.test(custom.ownerToken)
    || typeof custom.expiresAt !== 'string' || !validIso(custom.expiresAt)) {
    throw new WorkerLeaseError('WORKER_LEASE_CORRUPT')
  }
  return { ownerToken: custom.ownerToken, expiresAt: custom.expiresAt, generation, size }
}

function validateAcquisition(input: { requestId: string; nowIso: string; leaseUntil: string }): void {
  if (!SAFE_REQUEST_ID.test(input.requestId)) throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')
  validateLeaseWindow(input.nowIso, input.leaseUntil)
}

function validateLeaseWindow(nowIso: string, leaseUntil: string): void {
  const now = Date.parse(nowIso)
  const until = Date.parse(leaseUntil)
  if (!validIso(nowIso) || !validIso(leaseUntil) || until <= now || until - now > MAX_LEASE_MS) {
    throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')
  }
}

function validateHandle(lease: WorkerLeaseHandle): void {
  if (!isRecord(lease) || !SAFE_LOCK_KEY.test(lease.lockKey) || !SAFE_OWNER_TOKEN.test(lease.ownerToken)
    || !validIso(lease.expiresAt) || !/^[1-9]\d*$/.test(lease.generation)) {
    throw new WorkerLeaseError('WORKER_LEASE_INVALID_INPUT')
  }
}

function validIso(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeBucketName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}$/.test(value)
}

function isPreconditionFailure(error: unknown): boolean {
  return storageCode(error) === 412
}

function isNotFound(error: unknown): boolean {
  return storageCode(error) === 404
}

function storageCode(error: unknown): number {
  if (!isRecord(error) || !('code' in error)) return 0
  return Number(error.code)
}

function safeLeaseFailure(error: unknown): WorkerLeaseError {
  return error instanceof WorkerLeaseError ? error : new WorkerLeaseError('WORKER_LEASE_FAILED')
}
