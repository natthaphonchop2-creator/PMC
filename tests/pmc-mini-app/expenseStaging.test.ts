import { createHash } from 'node:crypto'
import type { Storage } from '@google-cloud/storage'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  createGoogleExpenseStagingPort,
  expenseStagingObjectKey,
  type ExpenseStagingReceipt,
} from '../../server/pmc-mini-app/finance/stagingStore'
import { signExpenseStagingReceipt, verifyExpenseStagingReceipt } from '../../server/pmc-mini-app/finance/stagingToken'

const ROOT_REQUEST_ID = 'expense-request-1'
const CREATED_AT = '2026-08-30T03:00:00.000Z'
const SECRET = 'a staff-bound staging secret that is at least thirty two bytes'

describe('expense GCS staging', () => {
  it('writes a deterministic private key with CRC32C and returns a bounded receipt', async () => {
    const fake = fakeStorage()
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const port = createGoogleExpenseStagingPort({ bucketName: 'pmc-expense-stage', storage: fake.storage, now: () => CREATED_AT })

    await expect(port.put({
      rootRequestId: ROOT_REQUEST_ID, ordinal: 1, originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', bytes,
    })).resolves.toEqual({
      objectKey: `expenses/${ROOT_REQUEST_ID}/1-${sha256}.jpg`, sizeBytes: bytes.length, mimeType: 'image/jpeg', sha256,
      ordinal: 1, originalFileName: 'receipt.jpg', createdAt: CREATED_AT,
    })
    expect(fake.uploads[0]).toMatchObject({
      objectKey: `expenses/${ROOT_REQUEST_ID}/1-${sha256}.jpg`,
      options: {
        resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/jpeg', cacheControl: 'no-store' },
      },
    })
  })

  it('only treats matching create-only conflicts as retry-safe and never exposes storage causes', async () => {
    const fake = fakeStorage()
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const objectKey = `expenses/${ROOT_REQUEST_ID}/1-${sha256}.jpg`
    fake.putObject(objectKey, metadataFor({ bytes, sha256 }))
    const port = createGoogleExpenseStagingPort({ bucketName: 'pmc-expense-stage', storage: fake.storage, now: () => CREATED_AT })

    await expect(port.put({ rootRequestId: ROOT_REQUEST_ID, ordinal: 1, originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', bytes }))
      .resolves.toMatchObject({ objectKey, sha256, createdAt: CREATED_AT })

    fake.putObject(objectKey, { ...metadataFor({ bytes, sha256 }), metadata: { sha256: 'f'.repeat(64), ordinal: '1', rootRequestId: ROOT_REQUEST_ID, originalFileName: 'receipt.jpg', createdAt: CREATED_AT } })
    await expect(port.put({ rootRequestId: ROOT_REQUEST_ID, ordinal: 1, originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', bytes }))
      .rejects.toThrow('EXPENSE_STAGING_CONFLICT')
  })

  it('deletes only the exact metadata generation after re-verifying its staging contract', async () => {
    const fake = fakeStorage()
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const objectKey = expenseStagingObjectKey({ rootRequestId: ROOT_REQUEST_ID, ordinal: 1, sha256, mimeType: 'image/jpeg' })
    fake.putObject(objectKey, { ...metadataFor({ bytes, sha256 }), generation: '9' })
    const port = createGoogleExpenseStagingPort({ bucketName: 'pmc-expense-stage', storage: fake.storage, now: () => CREATED_AT })

    await port.deleteVerified(objectKey)
    expect(fake.deletes).toEqual([{ objectKey, options: { ifGenerationMatch: '9' } }])

    fake.putObject(objectKey, { ...metadataFor({ bytes, sha256 }), metadata: { sha256, ordinal: '2', rootRequestId: ROOT_REQUEST_ID, originalFileName: 'receipt.jpg', createdAt: CREATED_AT } })
    await expect(port.deleteVerified(objectKey)).rejects.toThrow('EXPENSE_STAGING_METADATA_INVALID')
  })
})

describe('staff-bound expense staging receipt token', () => {
  it('contains only signed staff/request/object claims and verifies the exact binding', async () => {
    const receipt = await receiptForToken()
    const token = signExpenseStagingReceipt({ receipt, staffId: 'ADMIN_01', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => Date.parse(CREATED_AT) })
    const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'))
    expect(Object.keys(payload).sort()).toEqual(['expiresAt', 'objectKey', 'ordinal', 'rootRequestId', 'sha256', 'staffId', 'version'])
    expect(JSON.stringify(payload)).not.toContain('bucket')

    expect(verifyExpenseStagingReceipt(token, { staffId: 'ADMIN_01', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => Date.parse(CREATED_AT) }))
      .toEqual(payload)
    expect(() => verifyExpenseStagingReceipt(token, { staffId: 'ADMIN_02', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => Date.parse(CREATED_AT) }))
      .toThrow('EXPENSE_STAGING_TOKEN_INVALID')
    expect(() => verifyExpenseStagingReceipt(token, { staffId: 'ADMIN_01', rootRequestId: 'expense-request-2', secret: SECRET, now: () => Date.parse(CREATED_AT) }))
      .toThrow('EXPENSE_STAGING_TOKEN_INVALID')
  })

  it('rejects tampered or expired receipts without parsing a storage error', async () => {
    const receipt = await receiptForToken()
    const issued = Date.parse(CREATED_AT)
    const token = signExpenseStagingReceipt({ receipt, staffId: 'ADMIN_01', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => issued })
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifyExpenseStagingReceipt(tampered, { staffId: 'ADMIN_01', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => issued }))
      .toThrow('EXPENSE_STAGING_TOKEN_INVALID')
    expect(() => verifyExpenseStagingReceipt(token, { staffId: 'ADMIN_01', rootRequestId: ROOT_REQUEST_ID, secret: SECRET, now: () => issued + 86_400_001 }))
      .toThrow('EXPENSE_STAGING_TOKEN_INVALID')
  })
})

async function receiptForToken(): Promise<ExpenseStagingReceipt> {
  const bytes = await jpeg()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    objectKey: expenseStagingObjectKey({ rootRequestId: ROOT_REQUEST_ID, ordinal: 1, sha256, mimeType: 'image/jpeg' }),
    sizeBytes: bytes.length, mimeType: 'image/jpeg', sha256, ordinal: 1, originalFileName: 'receipt.jpg', createdAt: CREATED_AT,
  }
}

function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

function metadataFor(input: { bytes: Buffer; sha256: string }) {
  return {
    bytes: input.bytes, contentType: 'image/jpeg', cacheControl: 'no-store', generation: '4',
    metadata: { sha256: input.sha256, ordinal: '1', rootRequestId: ROOT_REQUEST_ID, originalFileName: 'receipt.jpg', createdAt: CREATED_AT },
  }
}

function fakeStorage() {
  const objects = new Map<string, ReturnType<typeof metadataFor>>()
  const uploads: Array<{ objectKey: string; bytes: Buffer; options: unknown }> = []
  const deletes: Array<{ objectKey: string; options: unknown }> = []
  const file = (objectKey: string) => ({
    async save(bytes: Buffer, options: { metadata: { contentType: string; cacheControl: string; metadata: Record<string, string> } }) {
      uploads.push({ objectKey, bytes, options })
      if (objects.has(objectKey)) throw Object.assign(new Error('already exists'), { code: 412 })
      objects.set(objectKey, { bytes, contentType: options.metadata.contentType, cacheControl: options.metadata.cacheControl, generation: '4', metadata: options.metadata.metadata })
    },
    async getMetadata() {
      const object = objects.get(objectKey)
      if (!object) throw new Error('missing')
      return [{ name: objectKey, size: String(object.bytes.length), contentType: object.contentType, cacheControl: object.cacheControl, generation: object.generation, metadata: object.metadata }]
    },
    async delete(options: { ifGenerationMatch: string }) {
      deletes.push({ objectKey, options })
      const object = objects.get(objectKey)
      if (!object || object.generation !== options.ifGenerationMatch) throw Object.assign(new Error('generation changed'), { code: 412 })
      objects.delete(objectKey)
    },
  })
  return {
    storage: { bucket: () => ({ file }) } as unknown as Storage,
    uploads,
    deletes,
    putObject(objectKey: string, object: ReturnType<typeof metadataFor>) { objects.set(objectKey, object) },
  }
}
