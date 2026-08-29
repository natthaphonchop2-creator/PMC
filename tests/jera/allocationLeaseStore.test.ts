import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'
import { createGoogleJeraAllocationLeasePort } from '../../server/jera/allocationLeaseStore'

const DAY_KEY = 'a'.repeat(64)
const NOW = '2026-08-29T10:00:00.000Z'

describe('Google JERA allocation lease port', () => {
  it('uses generation-match create-only writes so independent clients have exactly one concurrent winner', async () => {
    const state = new LeaseStorageState()
    const left = createGoogleJeraAllocationLeasePort({ bucketName: 'pmc-private-locks', storage: state.client() })
    const right = createGoogleJeraAllocationLeasePort({ bucketName: 'pmc-private-locks', storage: state.client() })

    const leases = await Promise.all([
      left.claim({ dayKey: DAY_KEY, owner: 'worker-a', now: NOW, ttlMs: 60_000 }),
      right.claim({ dayKey: DAY_KEY, owner: 'worker-b', now: NOW, ttlMs: 60_000 }),
    ])

    expect(leases.filter(Boolean)).toHaveLength(1)
    expect(state.saves[0]).toMatchObject({ objectKey: `jera-allocation-leases/${DAY_KEY}.json`, ifGenerationMatch: 0 })
  })

  it('replaces an expired generation once and fences stale release tokens', async () => {
    const state = new LeaseStorageState()
    const first = createGoogleJeraAllocationLeasePort({ bucketName: 'pmc-private-locks', storage: state.client() })
    const second = createGoogleJeraAllocationLeasePort({ bucketName: 'pmc-private-locks', storage: state.client() })
    const original = await first.claim({ dayKey: DAY_KEY, owner: 'worker-a', now: NOW, ttlMs: 1_000 })
    expect(original).not.toBeNull()

    const replacements = await Promise.all([
      first.claim({ dayKey: DAY_KEY, owner: 'worker-b', now: '2026-08-29T10:00:02.000Z', ttlMs: 60_000 }),
      second.claim({ dayKey: DAY_KEY, owner: 'worker-c', now: '2026-08-29T10:00:02.000Z', ttlMs: 60_000 }),
    ])
    const replacement = replacements.find(Boolean)
    expect(replacements.filter(Boolean)).toHaveLength(1)
    expect(replacement?.fencingToken).not.toBe(original?.fencingToken)

    await first.release(original!)
    expect(state.current()?.generation).toBe(replacement?.fencingToken)
    expect(state.saves.filter((save) => save.ifGenerationMatch !== 0)).toHaveLength(2)
  })

  it('fails closed on malformed content or metadata without exposing raw storage errors', async () => {
    const state = new LeaseStorageState()
    state.put({ body: '{"dayKey":"bad"}', generation: '7' })
    const port = createGoogleJeraAllocationLeasePort({ bucketName: 'pmc-private-locks', storage: state.client() })
    await expect(port.claim({ dayKey: DAY_KEY, owner: 'worker-a', now: NOW, ttlMs: 60_000 })).rejects.toThrow('JERA_ALLOCATION_LEASE_CORRUPT')

    state.put({ body: JSON.stringify({ dayKey: DAY_KEY, owner: 'worker-a', expiresAt: '2026-08-29T10:01:00.000Z' }), generation: '8', metadata: { forbidden: 'x' } })
    await expect(port.claim({ dayKey: DAY_KEY, owner: 'worker-a', now: NOW, ttlMs: 60_000 })).rejects.toThrow('JERA_ALLOCATION_LEASE_CORRUPT')
  })
})

interface ObjectState { body: string; generation: string; metadata?: Record<string, string> }

class LeaseStorageState {
  private object: ObjectState | null = null
  private nextGeneration = 1
  readonly saves: Array<{ objectKey: string; ifGenerationMatch: string | number }> = []

  current(): ObjectState | null { return this.object ? structuredClone(this.object) : null }
  put(object: ObjectState): void { this.object = structuredClone(object); this.nextGeneration = Math.max(this.nextGeneration, Number(object.generation) + 1) }
  client(): Storage {
    return {
      bucket: () => ({
        file: (objectKey: string, options?: { generation?: string | number }) => ({
          save: async (bytes: Buffer, input: { preconditionOpts: { ifGenerationMatch: string | number } }) => {
            const expected = input.preconditionOpts.ifGenerationMatch
            this.saves.push({ objectKey, ifGenerationMatch: expected })
            const actual = this.object?.generation
            if (expected === 0 ? actual !== undefined : actual !== String(expected)) throw Object.assign(new Error('precondition'), { code: 412 })
            this.object = { body: bytes.toString('utf8'), generation: String(this.nextGeneration++) }
          },
          getMetadata: async () => {
            const object = options?.generation === undefined || String(options.generation) === this.object?.generation ? this.object : null
            if (!object) throw Object.assign(new Error('missing'), { code: 404 })
            return [{ name: objectKey, size: String(Buffer.byteLength(object.body)), contentType: 'application/json', cacheControl: 'no-store', generation: object.generation, metadata: object.metadata }]
          },
          download: async () => {
            const object = options?.generation === undefined || String(options.generation) === this.object?.generation ? this.object : null
            if (!object) throw Object.assign(new Error('missing'), { code: 404 })
            return [Buffer.from(object.body)]
          },
          delete: async (input: { ifGenerationMatch: string }) => {
            if (!this.object || this.object.generation !== String(input.ifGenerationMatch)) throw Object.assign(new Error('precondition'), { code: 412 })
            this.object = null
          },
        }),
      }),
    } as unknown as Storage
  }
}
