import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'
import {
  createGoogleEvidenceStagingPort,
  evidenceObjectKey,
} from '../../server/pmc-mini-app/stagingStore'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01])
const jpegSha256 = 'ea42ea6c51e8eae9d737a5e99e89ebc661375c534103544b35e5af2529df45dc'

describe('Google evidence staging port', () => {
  it('builds a deterministic private draft object key', () => {
    expect(evidenceObjectKey({
      draftId: 'draft-1',
      kind: 'PAYMENT',
      contentSha256: 'a'.repeat(64),
      mimeType: 'image/jpeg',
    })).toBe(`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.jpg`)
    expect(evidenceObjectKey({
      draftId: 'draft_2', kind: 'CHAT', contentSha256: 'b'.repeat(64), mimeType: 'image/png',
    })).toBe(`drafts/draft_2/CHAT/${'b'.repeat(64)}.png`)
    expect(() => evidenceObjectKey({
      draftId: '../patient', kind: 'PAYMENT', contentSha256: 'a'.repeat(64), mimeType: 'image/jpeg',
    })).toThrow('INVALID_EVIDENCE_STAGING_INPUT')
  })

  it('uploads original image bytes with a create-only, CRC-validated, private no-store contract', async () => {
    const fake = fakeStorage()
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({
      draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg,
    })).resolves.toEqual({
      objectKey: `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`, size: 5, contentSha256: jpegSha256,
    })

    expect(fake.uploads).toEqual([{
      objectKey: `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`,
      bytes: jpeg,
      options: {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/jpeg', cacheControl: 'no-store' },
      },
    }])
  })

  it('rejects unsafe IDs, empty or oversized bytes, unsupported declared types, and image signature mismatches', async () => {
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fakeStorage().storage })

    await expect(port.put({ draftId: '../draft', kind: 'CHAT', mimeType: 'image/jpeg', bytes: jpeg })).rejects.toThrow('INVALID_EVIDENCE_STAGING_INPUT')
    await expect(port.put({ draftId: 'draft-1', kind: 'CHAT', mimeType: 'image/jpeg', bytes: Buffer.alloc(0) })).rejects.toThrow('INVALID_EVIDENCE_STAGING_INPUT')
    await expect(port.put({ draftId: 'draft-1', kind: 'CHAT', mimeType: 'image/jpeg', bytes: Buffer.alloc(10_000_001) })).rejects.toThrow('EVIDENCE_TOO_LARGE')
    await expect(port.put({ draftId: 'draft-1', kind: 'CHAT', mimeType: 'image/gif' as never, bytes: jpeg })).rejects.toThrow('INVALID_EVIDENCE_STAGING_INPUT')
    await expect(port.put({ draftId: 'draft-1', kind: 'CHAT', mimeType: 'image/png', bytes: jpeg })).rejects.toThrow('INVALID_EVIDENCE_STAGING_INPUT')
  })

  it('accepts a deterministic retry only when the create-only conflict has matching private object metadata', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.objects.set(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({ draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg })).resolves.toEqual({
      objectKey, size: 5, contentSha256: jpegSha256,
    })
    expect(fake.uploads).toHaveLength(1)
  })

  it('rejects a create-only conflict whose existing object does not match the deterministic content contract', async () => {
    const fake = fakeStorage()
    fake.objects.set(`drafts/draft-1/PAYMENT/${jpegSha256}.jpg`, {
      bytes: Buffer.concat([jpeg, Buffer.from([0])]), contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4',
    })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({ draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg })).rejects.toThrow('EVIDENCE_STAGING_CONFLICT')
  })

  it('downloads only bounded private image objects inside the drafts namespace', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.objects.set(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.get(objectKey)).resolves.toEqual({ bytes: jpeg, mimeType: 'image/jpeg' })
    await expect(port.get('patients/patient-1/slip.jpg')).rejects.toThrow('INVALID_EVIDENCE_STAGING_KEY')

    fake.objects.set(`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`, {
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: 'image/png', cacheControl: 'public, max-age=60', generation: '5',
    })
    await expect(port.get(`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  })

  it('deletes only verified private draft objects with their observed generation', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.objects.set(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.deleteVerified(objectKey)).resolves.toBeUndefined()
    expect(fake.deletes).toEqual([{ objectKey, options: { ifGenerationMatch: '4' } }])
    await expect(port.deleteVerified('not-drafts/object.jpg')).rejects.toThrow('INVALID_EVIDENCE_STAGING_KEY')

    const annotatedKey = `drafts/draft-1/CHAT/${'b'.repeat(64)}.png`
    fake.objects.set(annotatedKey, {
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: 'image/png', cacheControl: 'no-store', generation: '5', metadata: { patient: 'forbidden' },
    })
    await expect(port.deleteVerified(annotatedKey)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  })
})

interface FakeObject {
  bytes: Buffer
  contentType: string
  cacheControl: string
  generation: string
  metadata?: Record<string, string>
}

function fakeStorage() {
  const objects = new Map<string, FakeObject>()
  const uploads: Array<{ objectKey: string; bytes: Buffer; options: unknown }> = []
  const deletes: Array<{ objectKey: string; options: unknown }> = []
  const storage = {
    bucket: () => ({
      file: (objectKey: string) => ({
        async save(bytes: Buffer, options: { metadata: { contentType: string; cacheControl: string } }) {
          uploads.push({ objectKey, bytes, options })
          if (objects.has(objectKey)) throw Object.assign(new Error('already exists'), { code: 412 })
          objects.set(objectKey, {
            bytes, contentType: options.metadata.contentType, cacheControl: options.metadata.cacheControl, generation: '1',
          })
        },
        async getMetadata() {
          const stored = objects.get(objectKey)
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 })
          return [{
            name: objectKey,
            size: String(stored.bytes.length),
            contentType: stored.contentType,
            cacheControl: stored.cacheControl,
            generation: stored.generation,
            metadata: stored.metadata,
          }]
        },
        async download() {
          const stored = objects.get(objectKey)
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 })
          return [Buffer.from(stored.bytes)]
        },
        async delete(options: unknown) {
          deletes.push({ objectKey, options })
          objects.delete(objectKey)
        },
      }),
    }),
  } as unknown as Storage
  return { storage, objects, uploads, deletes }
}
