import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  consumeExpenseMultipart,
  EXPENSE_MAX_RAW_MULTIPART_BYTES,
  inspectExpenseImage,
} from '../../server/pmc-mini-app/finance/multipart'

describe('expense evidence multipart parser', () => {
  it('returns one-to-five images in ordinal order even when multipart parts arrive out of order', async () => {
    const boundary = 'expense-boundary'
    const request = multipartRequest(boundary, [
      filePart(boundary, 'file2', 'two.png', 'image/png', await png(2, 1)),
      filePart(boundary, 'file1', 'one.jpg', 'image/jpeg', await jpeg(1, 2)),
      closingPart(boundary),
    ])

    await expect(consumeExpenseMultipart(request)).resolves.toMatchObject({
      totalBytes: expect.any(Number),
      files: [
        { ordinal: 1, originalFileName: 'one.jpg', mimeType: 'image/jpeg' },
        { ordinal: 2, originalFileName: 'two.png', mimeType: 'image/png' },
      ],
    })
  })

  it('rejects a sixth file, duplicate ordinal, unknown multipart field, and ordinary form field', async () => {
    const boundary = 'expense-boundary'
    const image = await jpeg(1, 1)
    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      ...Array.from({ length: 6 }, (_, index) => filePart(boundary, `file${index + 1}`, `${index + 1}.jpg`, 'image/jpeg', image)),
      closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_FILE_LIMIT' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'one.jpg', 'image/jpeg', image),
      filePart(boundary, 'file1', 'again.jpg', 'image/jpeg', image),
      closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_DUPLICATE_ORDINAL' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'evidence', 'one.jpg', 'image/jpeg', image), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_UNKNOWN_MULTIPART_FIELD' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      textPart(boundary, 'note', 'not allowed'), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_UNKNOWN_MULTIPART_FIELD' })
  })

  it('enforces the 160 Unicode-character original filename boundary', async () => {
    const image = await jpeg(1, 1)
    await expect(inspectExpenseImage({
      bytes: image, advertisedMime: 'image/jpeg', originalFileName: `${'ก'.repeat(156)}.jpg`,
    })).resolves.toMatchObject({ originalFileName: `${'ก'.repeat(156)}.jpg` })
    await expect(inspectExpenseImage({
      bytes: image, advertisedMime: 'image/jpeg', originalFileName: `${'ก'.repeat(157)}.jpg`,
    })).rejects.toMatchObject({ code: 'EXPENSE_INVALID_FILE_NAME' })
  })

  it('rejects empty, oversized, over-aggregate, MIME-mismatched, and noncontiguous files', async () => {
    const boundary = 'expense-boundary'
    const image = await jpeg(1, 1)
    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'empty.jpg', 'image/jpeg', Buffer.alloc(0)), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_FILE_EMPTY' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'large.jpg', 'image/jpeg', Buffer.concat([image, Buffer.alloc(10_000_001)])), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_FILE_TOO_LARGE' })

    const eightPointFiveMegabytes = Buffer.concat([image, Buffer.alloc(8_500_000)])
    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'one.jpg', 'image/jpeg', eightPointFiveMegabytes),
      filePart(boundary, 'file2', 'two.jpg', 'image/jpeg', eightPointFiveMegabytes),
      filePart(boundary, 'file3', 'three.jpg', 'image/jpeg', eightPointFiveMegabytes),
      closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_BATCH_TOO_LARGE' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'not-a-png.png', 'image/png', image), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_UNSUPPORTED_IMAGE' })

    const rawHeic = Buffer.from('0000001866747970686569630000000068656966', 'hex')
    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'raw.heic', 'image/heic', rawHeic), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_UNSUPPORTED_IMAGE' })

    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file2', 'two.jpg', 'image/jpeg', image), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_INVALID_ORDER' })
  })

  it('rejects an image over twenty megapixels after metadata inspection', async () => {
    const boundary = 'expense-boundary'
    const oversizedHeader = await pngHeader(5_001, 4_000)
    await expect(consumeExpenseMultipart(multipartRequest(boundary, [
      filePart(boundary, 'file1', 'large.png', 'image/png', oversizedHeader), closingPart(boundary),
    ]))).rejects.toMatchObject({ code: 'EXPENSE_PIXEL_LIMIT' })
  })

  it('rejects an oversized Content-Length before it starts Busboy parsing', async () => {
    const request = multipartStream('expense-boundary', { 'content-length': String(EXPENSE_MAX_RAW_MULTIPART_BYTES + 1) })
    await expect(consumeExpenseMultipart(request)).rejects.toMatchObject({ code: 'EXPENSE_MULTIPART_TOO_LARGE' })
    expect(request.listenerCount('data')).toBe(0)
    request.end()
  })

  it('stops immediately for unknown or duplicate fields before their large tails can reach later file processing', async () => {
    const boundary = 'expense-boundary'
    const image = await jpeg(1, 1)
    const unknown = multipartStream(boundary)
    const unknownResult = consumeExpenseMultipart(unknown)
    unknown.write(filePart(boundary, 'unknown', 'tail.jpg', 'image/jpeg', image))
    await expect(unknownResult).rejects.toMatchObject({ code: 'EXPENSE_UNKNOWN_MULTIPART_FIELD' })
    expect(unknown.listenerCount('data')).toBe(0)
    unknown.end(Buffer.alloc(EXPENSE_MAX_RAW_MULTIPART_BYTES + 1))

    const duplicate = multipartStream(boundary)
    const duplicateResult = consumeExpenseMultipart(duplicate)
    duplicate.write(filePart(boundary, 'file1', 'one.jpg', 'image/jpeg', image))
    duplicate.write(filePart(boundary, 'file1', 'duplicate.jpg', 'image/jpeg', image))
    await expect(duplicateResult).rejects.toMatchObject({ code: 'EXPENSE_DUPLICATE_ORDINAL' })
    expect(duplicate.listenerCount('data')).toBe(0)
    duplicate.end(Buffer.alloc(EXPENSE_MAX_RAW_MULTIPART_BYTES + 1))
  })

  it('enforces the raw chunked multipart budget before Busboy can buffer a malformed tail', async () => {
    const request = multipartStream('expense-boundary')
    const result = consumeExpenseMultipart(request)
    request.write(Buffer.alloc(EXPENSE_MAX_RAW_MULTIPART_BYTES + 1))
    await expect(result).rejects.toMatchObject({ code: 'EXPENSE_MULTIPART_TOO_LARGE' })
    expect(request.listenerCount('data')).toBe(0)
    request.end()
  })
})

function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer()
}

function pngHeader(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer()
}

function multipartRequest(boundary: string, chunks: Buffer[]): IncomingMessage {
  const request = multipartStream(boundary)
  request.end(Buffer.concat(chunks))
  return request
}

function multipartStream(boundary: string, headers: Record<string, string> = {}): IncomingMessage & PassThrough {
  return Object.assign(new PassThrough(), { headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...headers } }) as IncomingMessage & PassThrough
}

function filePart(boundary: string, fieldName: string, fileName: string, mimeType: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from('\r\n'),
  ])
}

function textPart(boundary: string, fieldName: string, value: string): Buffer {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`)
}

function closingPart(boundary: string): Buffer { return Buffer.from(`--${boundary}--\r\n`) }
