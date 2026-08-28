import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'
import { createGoogleWorkerLeasePort } from '../../server/pmc-mini-app/workerLease'

const nowIso = '2026-08-28T04:00:00.000Z'
const leaseUntil = '2026-08-28T04:04:00.000Z'
const lockKey = 'locks/19f1064b619d49d35392eac7261cd7266c720671fc594f4b226f32bf0bee74ba'

describe('Google Cloud Storage worker coordination lease', () => {
  it('creates a private generation-zero lock whose body and metadata contain only owner token and expiry', async () => {
    const fake = fakeStorage()
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-0001',
    })

    await expect(port.acquire({ requestId: 'request-1', nowIso, leaseUntil })).resolves.toEqual({
      acquired: true,
      lease: { lockKey, ownerToken: 'owner-token-0001', expiresAt: leaseUntil, generation: '1' },
    })

    expect(fake.uploads).toHaveLength(1)
    const upload = fake.uploads[0]!
    expect(upload.objectKey).toBe(lockKey)
    expect(JSON.parse(upload.bytes.toString('utf8'))).toEqual({ ownerToken: 'owner-token-0001', expiresAt: leaseUntil })
    expect(upload.options).toEqual({
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'application/json', cacheControl: 'no-store',
        metadata: { ownerToken: 'owner-token-0001', expiresAt: leaseUntil },
      },
    })
    expect(JSON.stringify(upload)).not.toContain('request-1')
  })

  it('returns a live conflict without deleting or replacing the current generation', async () => {
    const fake = fakeStorage()
    fake.putLease(lockKey, 'owner-token-live', '2026-08-28T04:03:00.000Z', '7')
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-new1',
    })

    await expect(port.acquire({ requestId: 'request-1', nowIso, leaseUntil })).resolves.toEqual({
      acquired: false, expiresAt: '2026-08-28T04:03:00.000Z',
    })
    expect(fake.deletes).toEqual([])
    expect(fake.current(lockKey)).toMatchObject({ generation: '7' })
  })

  it('takes over an expired lock only after a generation-qualified delete', async () => {
    const fake = fakeStorage()
    fake.putLease(lockKey, 'owner-token-old1', '2026-08-28T03:59:59.000Z', '7')
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-new1',
    })

    await expect(port.acquire({ requestId: 'request-1', nowIso, leaseUntil })).resolves.toEqual({
      acquired: true,
      lease: { lockKey, ownerToken: 'owner-token-new1', expiresAt: leaseUntil, generation: '8' },
    })
    expect(fake.deletes).toEqual([{ objectKey: lockKey, options: { ifGenerationMatch: '7' } }])
    expect(fake.current(lockKey)).toMatchObject({ generation: '8' })
  })

  it('renews only the owned generation and returns the replacement generation', async () => {
    const fake = fakeStorage()
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-0001',
    })
    const acquired = await port.acquire({ requestId: 'request-1', nowIso, leaseUntil })
    if (!acquired.acquired) throw new Error('expected lease')

    await expect(port.renew({
      lease: acquired.lease,
      nowIso: '2026-08-28T04:01:00.000Z',
      leaseUntil: '2026-08-28T04:05:00.000Z',
    })).resolves.toEqual({
      lockKey, ownerToken: 'owner-token-0001', expiresAt: '2026-08-28T04:05:00.000Z', generation: '2',
    })
    expect(fake.uploads.at(-1)?.options).toMatchObject({ preconditionOpts: { ifGenerationMatch: '1' } })
    expect(fake.current(lockKey)).toMatchObject({ generation: '2', metadata: { ownerToken: 'owner-token-0001' } })
  })

  it('never lets a stale release delete a replacement lease', async () => {
    const fake = fakeStorage()
    const firstPort = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-first',
    })
    const first = await firstPort.acquire({ requestId: 'request-1', nowIso, leaseUntil })
    if (!first.acquired) throw new Error('expected first lease')
    fake.expire(lockKey, '2026-08-28T03:59:59.000Z')
    const secondPort = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-second',
    })
    const second = await secondPort.acquire({ requestId: 'request-1', nowIso, leaseUntil })
    if (!second.acquired) throw new Error('expected replacement lease')

    await expect(firstPort.release(first.lease)).resolves.toBeUndefined()
    expect(fake.current(lockKey)).toMatchObject({
      generation: second.lease.generation, metadata: { ownerToken: 'owner-token-second' },
    })

    await expect(secondPort.release(second.lease)).resolves.toBeUndefined()
    expect(fake.current(lockKey)).toBeUndefined()
    expect(fake.deletes.at(-1)).toEqual({ objectKey: lockKey, options: { ifGenerationMatch: second.lease.generation } })
  })

  it.each([
    ['oversized body', { body: Buffer.alloc(513, 1) }],
    ['extra metadata', { metadata: { ownerToken: 'owner-token-live', expiresAt: '2026-08-28T04:03:00.000Z', patient: 'forbidden' } }],
    ['body metadata mismatch', { bodyOwnerToken: 'owner-token-other' }],
    ['invalid generation', { generation: '' }],
  ])('fails closed on a bounded malformed existing lock: %s', async (_label, corruption) => {
    const fake = fakeStorage()
    fake.putLease(lockKey, 'owner-token-live', '2026-08-28T04:03:00.000Z', '7', corruption)
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-new1',
    })

    await expect(port.acquire({ requestId: 'request-1', nowIso, leaseUntil })).rejects.toThrow('WORKER_LEASE_CORRUPT')
    expect(fake.deletes).toEqual([])
  })

  it('rejects unsafe acquisition fields before touching Storage', async () => {
    const fake = fakeStorage()
    const port = createGoogleWorkerLeasePort({
      bucketName: 'pmc-private-stage', storage: fake.storage, ownerToken: () => 'owner-token-0001',
    })

    await expect(port.acquire({ requestId: '../patient', nowIso, leaseUntil })).rejects.toThrow('WORKER_LEASE_INVALID_INPUT')
    await expect(port.acquire({
      requestId: 'request-1', nowIso, leaseUntil: '2026-08-28T04:04:00.001Z',
    })).rejects.toThrow('WORKER_LEASE_INVALID_INPUT')
    expect(fake.uploads).toEqual([])
  })
})

interface FakeLeaseObject {
  bytes: Buffer
  contentType: string
  cacheControl: string
  generation: string
  metadata: Record<string, string>
  contentEncoding?: string
}

function fakeStorage() {
  const objects = new Map<string, FakeLeaseObject>()
  const versions = new Map<string, Map<string, FakeLeaseObject>>()
  const uploads: Array<{ objectKey: string; bytes: Buffer; options: Record<string, unknown> }> = []
  const deletes: Array<{ objectKey: string; options: unknown }> = []
  let generationCounter = 0

  const remember = (objectKey: string, object: FakeLeaseObject) => {
    objects.set(objectKey, structuredClone(object))
    const objectVersions = versions.get(objectKey) ?? new Map<string, FakeLeaseObject>()
    objectVersions.set(object.generation, structuredClone(object))
    versions.set(objectKey, objectVersions)
    generationCounter = Math.max(generationCounter, Number(object.generation) || 0)
  }

  const putLease = (
    objectKey: string,
    ownerToken: string,
    expiresAt: string,
    generation: string,
    corruption: {
      body?: Buffer
      metadata?: Record<string, string>
      bodyOwnerToken?: string
      generation?: string
    } = {},
  ) => {
    const storedGeneration = corruption.generation ?? generation
    const body = corruption.body ?? Buffer.from(JSON.stringify({
      ownerToken: corruption.bodyOwnerToken ?? ownerToken,
      expiresAt,
    }))
    remember(objectKey, {
      bytes: body,
      contentType: 'application/json',
      cacheControl: 'no-store',
      generation: storedGeneration,
      metadata: corruption.metadata ?? { ownerToken, expiresAt },
    })
  }

  const storage = {
    bucket: () => ({
      file: (objectKey: string, fileOptions?: { generation?: string | number }) => ({
        async save(bytes: Buffer, rawOptions: Record<string, unknown>) {
          const options = structuredClone(rawOptions) as {
            preconditionOpts?: { ifGenerationMatch?: string | number }
            metadata: { contentType: string; cacheControl: string; metadata: Record<string, string> }
          }
          uploads.push({ objectKey, bytes: Buffer.from(bytes), options: rawOptions })
          const current = objects.get(objectKey)
          const expected = options.preconditionOpts?.ifGenerationMatch
          if (expected === 0 && current) throw storageError(412)
          if (expected !== 0 && expected !== undefined
            && (!current || current.generation !== String(expected))) throw storageError(412)
          if (current) versions.get(objectKey)?.delete(current.generation)
          generationCounter += 1
          remember(objectKey, {
            bytes: Buffer.from(bytes),
            contentType: options.metadata.contentType,
            cacheControl: options.metadata.cacheControl,
            generation: String(generationCounter),
            metadata: structuredClone(options.metadata.metadata),
          })
        },
        async getMetadata() {
          const generation = fileOptions?.generation === undefined ? undefined : String(fileOptions.generation)
          const stored = generation === undefined ? objects.get(objectKey) : versions.get(objectKey)?.get(generation)
          if (!stored) throw storageError(404)
          return [{
            name: objectKey,
            size: String(stored.bytes.length),
            contentType: stored.contentType,
            cacheControl: stored.cacheControl,
            contentEncoding: stored.contentEncoding,
            generation: stored.generation,
            metadata: structuredClone(stored.metadata),
          }]
        },
        async download() {
          const generation = fileOptions?.generation === undefined ? undefined : String(fileOptions.generation)
          const stored = generation === undefined ? objects.get(objectKey) : versions.get(objectKey)?.get(generation)
          if (!stored) throw storageError(404)
          return [Buffer.from(stored.bytes)]
        },
        async delete(options: { ifGenerationMatch?: string | number }) {
          const current = objects.get(objectKey)
          if (!current) throw storageError(404)
          if (options.ifGenerationMatch !== undefined
            && current.generation !== String(options.ifGenerationMatch)) throw storageError(412)
          deletes.push({ objectKey, options })
          objects.delete(objectKey)
          versions.get(objectKey)?.delete(current.generation)
        },
      }),
    }),
  } as unknown as Storage

  const expire = (objectKey: string, expiresAt: string) => {
    const stored = objects.get(objectKey)
    if (!stored) throw new Error('missing fake lease')
    putLease(objectKey, stored.metadata.ownerToken!, expiresAt, stored.generation)
  }

  return {
    storage,
    uploads,
    deletes,
    putLease,
    expire,
    current: (objectKey: string): FakeLeaseObject | undefined => {
      const value = objects.get(objectKey)
      return value ? structuredClone(value) : undefined
    },
  }
}

function storageError(code: number): Error & { code: number } {
  return Object.assign(new Error(`storage-${code}`), { code })
}
