import type { Storage } from '@google-cloud/storage'
import { describe, expect, it } from 'vitest'
import {
  assertEvidenceStagingDescriptorSlot,
  createGoogleEvidenceStagingPort,
  evidenceObjectKey,
} from '../../server/pmc-mini-app/stagingStore'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01])
const jpegSha256 = 'ea42ea6c51e8eae9d737a5e99e89ebc661375c534103544b35e5af2529df45dc'

describe('Google evidence staging port', () => {
  it('rejects a valid descriptor when the worker slot belongs to another request', async () => {
    const fake = fakeStorage()
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })
    const stored = await port.put({
      requestId: 'request-1', draftId: 'draft-1', kind: 'PAYMENT', ordinal: 0,
      mimeType: 'image/jpeg', bytes: jpeg,
    })
    const descriptor = await port.describe(stored.objectKey)

    expect(() => assertEvidenceStagingDescriptorSlot(descriptor, {
      objectKey: stored.objectKey, requestId: 'other-request', draftId: 'draft-1', kind: 'PAYMENT', ordinal: 0,
    })).toThrow('EVIDENCE_STAGING_SLOT_MISMATCH')
  })

  it('stages identical bytes in distinct protocol-2 ordinal slots with exact private metadata', async () => {
    const fake = fakeStorage()
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })
    const common = {
      requestId: 'request-1', draftId: 'draft-1', kind: 'PAYMENT' as const,
      mimeType: 'image/jpeg' as const, bytes: jpeg,
    }

    const first = await port.put({ ...common, ordinal: 0 } as never) as unknown as Record<string, unknown>
    const second = await port.put({ ...common, ordinal: 1 } as never) as unknown as Record<string, unknown>

    const firstKey = `drafts/v2/request-1/draft-1/PAYMENT/0/333c1075921fee25d2dedd41a9ec892c85979cd5c93527268979c9b694b36809/${jpegSha256}.jpg`
    const secondKey = `drafts/v2/request-1/draft-1/PAYMENT/1/28e3e64f454498b241927217e005bd74ccdf6aba375f6aceaa7329c315977c02/${jpegSha256}.jpg`
    expect(first).toMatchObject({ objectKey: firstKey, uploadId: '333c1075921fee25d2dedd41a9ec892c85979cd5c93527268979c9b694b36809' })
    expect(second).toMatchObject({ objectKey: secondKey, uploadId: '28e3e64f454498b241927217e005bd74ccdf6aba375f6aceaa7329c315977c02' })
    expect(fake.uploads.map(({ objectKey, options }) => ({ objectKey, options }))).toEqual([
      {
        objectKey: firstKey,
        options: expect.objectContaining({ metadata: {
          contentType: 'image/jpeg', cacheControl: 'no-store',
          metadata: {
            pmcEvidenceVersion: '2', requestId: 'request-1', draftId: 'draft-1', evidenceKind: 'PAYMENT',
            ordinal: '0', uploadId: '333c1075921fee25d2dedd41a9ec892c85979cd5c93527268979c9b694b36809',
            contentSha256: jpegSha256, mimeType: 'image/jpeg',
          },
        } }),
      },
      {
        objectKey: secondKey,
        options: expect.objectContaining({ metadata: {
          contentType: 'image/jpeg', cacheControl: 'no-store',
          metadata: {
            pmcEvidenceVersion: '2', requestId: 'request-1', draftId: 'draft-1', evidenceKind: 'PAYMENT',
            ordinal: '1', uploadId: '28e3e64f454498b241927217e005bd74ccdf6aba375f6aceaa7329c315977c02',
            contentSha256: jpegSha256, mimeType: 'image/jpeg',
          },
        } }),
      },
    ])
  })

  it('reads and deletes a protocol-2 object only through its exact slot and generation descriptor', async () => {
    const fake = fakeStorage()
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })
    const staged = await port.put({
      requestId: 'request-1', draftId: 'draft-1', kind: 'PAYMENT', ordinal: 0,
      mimeType: 'image/jpeg', bytes: jpeg,
    })

    const read = await port.get(staged.objectKey)
    expect(read).toMatchObject({
      bytes: jpeg,
      mimeType: 'image/jpeg',
      cleanupDescriptor: {
        version: 2, objectKey: staged.objectKey, requestId: 'request-1', draftId: 'draft-1',
        kind: 'PAYMENT', ordinal: 0,
        uploadId: '333c1075921fee25d2dedd41a9ec892c85979cd5c93527268979c9b694b36809',
        contentSha256: jpegSha256, mimeType: 'image/jpeg', size: 5, generation: '1',
      },
    })
    await expect(port.deleteVerified({ ...read.cleanupDescriptor, ordinal: 1 } as never))
      .rejects.toThrow('EVIDENCE_STAGING_DESCRIPTOR_MISMATCH')
    await expect(port.deleteVerified(read.cleanupDescriptor)).resolves.toBeUndefined()
    expect(fake.deletes).toEqual([{
      objectKey: staged.objectKey, options: { ifGenerationMatch: '1' },
    }])
  })

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
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({ draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg })).resolves.toEqual({
      objectKey, size: 5, contentSha256: jpegSha256,
    })
    expect(fake.uploads).toHaveLength(1)
  })

  it('rejects a create-only conflict whose existing object does not match the deterministic content contract', async () => {
    const fake = fakeStorage()
    fake.putObject(`drafts/draft-1/PAYMENT/${jpegSha256}.jpg`, {
      bytes: Buffer.concat([jpeg, Buffer.from([0])]), contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4',
    })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({ draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg })).rejects.toThrow('EVIDENCE_STAGING_CONFLICT')
  })

  it('downloads only bounded private image objects inside the drafts namespace', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.get(objectKey)).resolves.toMatchObject({ bytes: jpeg, mimeType: 'image/jpeg' })
    await expect(port.get('patients/patient-1/slip.jpg')).rejects.toThrow('INVALID_EVIDENCE_STAGING_KEY')

    fake.putObject(`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`, {
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: 'image/png', cacheControl: 'public, max-age=60', generation: '5',
    })
    await expect(port.get(`drafts/draft-1/CHAT/${'b'.repeat(64)}.png`)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  })

  it('downloads the inspected generation when the latest object is replaced after metadata read', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    const replacement = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02])
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    fake.hooks.afterMetadataRead = () => {
      fake.putObject(objectKey, { bytes: replacement, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '5' })
    }
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.get(objectKey)).resolves.toMatchObject({ bytes: jpeg, mimeType: 'image/jpeg' })
    expect(fake.downloads).toEqual([{
      objectKey, generation: '4', options: { validation: 'crc32c' },
    }])
  })

  it('rejects an object without a valid generation before downloading it', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.get(objectKey)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
    expect(fake.downloads).toEqual([])
  })

  it('rejects gzip content encoding before a potentially expanded download', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.putObject(objectKey, {
      bytes: jpeg, downloadBytes: Buffer.alloc(10_000_001), contentType: 'image/jpeg', cacheControl: 'no-store', contentEncoding: 'gzip', generation: '4',
    })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.get(objectKey)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
    expect(fake.downloads).toEqual([])
  })

  it('does not accept gzip content encoding during a deterministic retry', async () => {
    const fake = fakeStorage()
    fake.putObject(`drafts/draft-1/PAYMENT/${jpegSha256}.jpg`, {
      bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', contentEncoding: 'gzip', generation: '4',
    })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    await expect(port.put({ draftId: 'draft-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg }))
      .rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  })

  it('deletes only verified private draft objects with their observed generation', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })

    const descriptor = await port.describe(objectKey)
    await expect(port.deleteVerified(descriptor)).resolves.toBeUndefined()
    expect(fake.deletes).toEqual([{ objectKey, options: { ifGenerationMatch: '4' } }])
    await expect(port.deleteVerified({ ...descriptor, objectKey: 'not-drafts/object.jpg' })).rejects.toThrow('INVALID_EVIDENCE_STAGING_KEY')

    const annotatedKey = `drafts/draft-1/CHAT/${'b'.repeat(64)}.png`
    fake.putObject(annotatedKey, {
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: 'image/png', cacheControl: 'no-store', generation: '5', metadata: { patient: 'forbidden' },
    })
    await expect(port.describe(annotatedKey)).rejects.toThrow('UNSUPPORTED_EVIDENCE_STAGING_METADATA')
  })

  it('uses a structured generation-fenced descriptor and treats only an exact missing object as idempotent', async () => {
    const fake = fakeStorage()
    const objectKey = `drafts/draft-1/PAYMENT/${jpegSha256}.jpg`
    fake.putObject(objectKey, { bytes: jpeg, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4' })
    const port = createGoogleEvidenceStagingPort({ bucketName: 'pmc-private-stage', storage: fake.storage })
    const descriptor = await port.describe(objectKey)

    expect(descriptor).toEqual({
      version: 1, objectKey, draftId: 'draft-1', kind: 'PAYMENT', contentSha256: jpegSha256,
      mimeType: 'image/jpeg', size: 5, generation: '4',
    })
    await expect(port.deleteVerified({ ...descriptor, generation: '5' })).rejects.toThrow('EVIDENCE_STAGING_DESCRIPTOR_MISMATCH')
    await expect(port.deleteVerified(descriptor)).resolves.toBeUndefined()
    await expect(port.deleteVerified(descriptor)).resolves.toBeUndefined()

    fake.hooks.metadataError = Object.assign(new Error('permission denied'), { code: 403 })
    await expect(port.deleteVerified(descriptor)).rejects.toMatchObject({ code: 403 })
  })
})

interface FakeObject {
  bytes: Buffer
  downloadBytes?: Buffer
  contentType: string
  cacheControl: string
  generation: string
  contentEncoding?: string
  metadata?: Record<string, string>
}

function fakeStorage() {
  const objects = new Map<string, FakeObject>()
  const versions = new Map<string, Map<string, FakeObject>>()
  const uploads: Array<{ objectKey: string; bytes: Buffer; options: unknown }> = []
  const deletes: Array<{ objectKey: string; options: unknown }> = []
  const downloads: Array<{ objectKey: string; generation: string | undefined; options: unknown }> = []
  const hooks: { afterMetadataRead?: (objectKey: string) => void; metadataError?: Error } = {}
  const putObject = (objectKey: string, object: FakeObject) => {
    objects.set(objectKey, object)
    const objectVersions = versions.get(objectKey) ?? new Map<string, FakeObject>()
    objectVersions.set(object.generation, object)
    versions.set(objectKey, objectVersions)
  }
  const storage = {
    bucket: () => ({
      file: (objectKey: string, options?: { generation?: string | number }) => ({
        async save(bytes: Buffer, options: { metadata: { contentType: string; cacheControl: string; metadata?: Record<string, string> } }) {
          uploads.push({ objectKey, bytes, options })
          if (objects.has(objectKey)) throw Object.assign(new Error('already exists'), { code: 412 })
          putObject(objectKey, {
            bytes, contentType: options.metadata.contentType, cacheControl: options.metadata.cacheControl,
            metadata: options.metadata.metadata, generation: '1',
          })
        },
        async getMetadata() {
          if (hooks.metadataError) {
            const error = hooks.metadataError
            hooks.metadataError = undefined
            throw error
          }
          const stored = objects.get(objectKey)
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 })
          const metadata = {
            name: objectKey,
            size: String(stored.bytes.length),
            contentType: stored.contentType,
            cacheControl: stored.cacheControl,
            contentEncoding: stored.contentEncoding,
            generation: stored.generation,
            metadata: stored.metadata,
          }
          const afterMetadataRead = hooks.afterMetadataRead
          hooks.afterMetadataRead = undefined
          afterMetadataRead?.(objectKey)
          return [metadata]
        },
        async download(downloadOptions: unknown) {
          const generation = options?.generation === undefined ? undefined : String(options.generation)
          downloads.push({ objectKey, generation, options: downloadOptions })
          const stored = generation === undefined ? objects.get(objectKey) : versions.get(objectKey)?.get(generation)
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 })
          return [Buffer.from(stored.downloadBytes ?? stored.bytes)]
        },
        async delete(options: unknown) {
          deletes.push({ objectKey, options })
          const stored = objects.get(objectKey)
          if (!stored) throw Object.assign(new Error('not found'), { code: 404 })
          const expectedGeneration = (options as { ifGenerationMatch?: string | number }).ifGenerationMatch
          if (String(expectedGeneration) !== stored.generation) throw Object.assign(new Error('generation mismatch'), { code: 412 })
          objects.delete(objectKey)
        },
      }),
    }),
  } as unknown as Storage
  return { storage, objects, uploads, deletes, downloads, hooks, putObject }
}
