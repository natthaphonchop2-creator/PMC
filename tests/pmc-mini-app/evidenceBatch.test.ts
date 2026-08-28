import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { consumeEvidenceBatchMultipart } from '../../server/pmc-mini-app/evidenceBatch'

describe('PMC Mini App evidence batch multipart parser', () => {
  it('preserves payment and chat files in their per-kind input order', async () => {
    const boundary = 'pmc-batch-boundary'
    const request = multipartRequest(boundary, [
      filePart(boundary, 'paymentFiles', 'payment-one.png', pngBytes(1)),
      filePart(boundary, 'chatFiles', 'chat-one.jpg', jpegBytes(3)),
      filePart(boundary, 'paymentFiles', 'payment-two.png', pngBytes(2)),
      Buffer.from(`--${boundary}--\r\n`),
    ])

    const batch = await consumeEvidenceBatchMultipart(request, limits())

    expect(batch.paymentFiles.map(({ bytes }) => bytes.at(-1))).toEqual([1, 2])
    expect(batch.chatFiles.map(({ bytes }) => bytes.at(-1))).toEqual([3])
    expect(batch.totalBytes).toBe(pngBytes(1).length + jpegBytes(3).length + pngBytes(2).length)
  })

  it('rejects file fields and regular fields outside the exact allowlist', async () => {
    const boundary = 'pmc-batch-boundary'
    const unknownFile = multipartRequest(boundary, [
      filePart(boundary, 'files', 'unknown.png', pngBytes(1)),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    const regularField = multipartRequest(boundary, [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nnot-allowed\r\n--${boundary}--\r\n`),
    ])

    await expect(consumeEvidenceBatchMultipart(unknownFile, limits())).rejects.toThrow('UNKNOWN_MULTIPART_FIELD')
    await expect(consumeEvidenceBatchMultipart(regularField, limits())).rejects.toThrow('UNKNOWN_MULTIPART_FIELD')
  })

  it('rejects an eleventh file for either evidence kind', async () => {
    const boundary = 'pmc-batch-boundary'
    const elevenPayments = multipartRequest(boundary, [
      ...Array.from({ length: 11 }, (_, index) => filePart(boundary, 'paymentFiles', `payment-${index}.png`, pngBytes(index))),
      filePart(boundary, 'chatFiles', 'chat.png', pngBytes(20)),
      Buffer.from(`--${boundary}--\r\n`),
    ])

    await expect(consumeEvidenceBatchMultipart(elevenPayments, limits())).rejects.toThrow('PAYMENT_EVIDENCE_LIMIT')
  })

  it('enforces the per-file and total-byte limits independently', async () => {
    const boundary = 'pmc-batch-boundary'
    const oversizedFile = multipartRequest(boundary, [
      filePart(boundary, 'paymentFiles', 'payment.png', pngBytes(1, 10_000_001)),
      filePart(boundary, 'chatFiles', 'chat.png', pngBytes(2)),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    const oversizedBatch = multipartRequest(boundary, [
      filePart(boundary, 'paymentFiles', 'payment.png', pngBytes(1, 10_000_000)),
      filePart(boundary, 'paymentFiles', 'payment-two.png', pngBytes(3, 4_000_000)),
      filePart(boundary, 'chatFiles', 'chat.png', pngBytes(2, 10_000_000)),
      filePart(boundary, 'chatFiles', 'chat-two.png', pngBytes(4, 1_000_001)),
      Buffer.from(`--${boundary}--\r\n`),
    ])

    await expect(consumeEvidenceBatchMultipart(oversizedFile, limits())).rejects.toThrow('EVIDENCE_TOO_LARGE')
    await expect(consumeEvidenceBatchMultipart(oversizedBatch, limits())).rejects.toThrow('EVIDENCE_BATCH_TOO_LARGE')
  })

  it('rejects incomplete multipart and unsupported image signatures', async () => {
    const boundary = 'pmc-batch-boundary'
    const incomplete = multipartRequest(boundary, [
      filePart(boundary, 'paymentFiles', 'payment.png', pngBytes(1)),
      filePart(boundary, 'chatFiles', 'chat.png', pngBytes(2)),
    ])
    const unsupported = multipartRequest(boundary, [
      filePart(boundary, 'paymentFiles', 'fake.png', Buffer.from('GIF89a')),
      filePart(boundary, 'chatFiles', 'chat.png', pngBytes(2)),
      Buffer.from(`--${boundary}--\r\n`),
    ])

    await expect(consumeEvidenceBatchMultipart(incomplete, limits())).rejects.toThrow('INVALID_MULTIPART')
    await expect(consumeEvidenceBatchMultipart(unsupported, limits())).rejects.toThrow('UNSUPPORTED_EVIDENCE')
  })

  it.each([
    ['payment', [filePart('pmc-batch-boundary', 'chatFiles', 'chat.png', pngBytes(1))], 'PAYMENT_EVIDENCE_REQUIRED'],
    ['chat', [filePart('pmc-batch-boundary', 'paymentFiles', 'payment.png', pngBytes(1))], 'CHAT_EVIDENCE_REQUIRED'],
  ])('requires %s evidence', async (_kind, parts, code) => {
    const boundary = 'pmc-batch-boundary'
    const request = multipartRequest(boundary, [...parts, Buffer.from(`--${boundary}--\r\n`)])

    await expect(consumeEvidenceBatchMultipart(request, limits())).rejects.toThrow(code)
  })
})

function limits() {
  return { maxFilesPerKind: 10 as const, maxFileBytes: 10_000_000 as const, maxTotalBytes: 25_000_000 as const }
}

function multipartRequest(boundary: string, chunks: Buffer[]): IncomingMessage {
  const request = new PassThrough() as PassThrough & IncomingMessage
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
  for (const chunk of chunks) request.write(chunk)
  request.end()
  return request
}

function filePart(boundary: string, field: string, filename: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes,
    Buffer.from('\r\n'),
  ])
}

function pngBytes(marker: number, size = 9): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]), Buffer.alloc(Math.max(0, size - 9), marker)])
}

function jpegBytes(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker])
}
