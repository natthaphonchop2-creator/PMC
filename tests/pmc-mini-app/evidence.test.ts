import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  consumeEvidenceMultipart,
  serverEvidenceName,
  validateEvidence,
} from '../../server/pmc-mini-app/evidence'

describe('PMC Mini App evidence validation', () => {
  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'image/jpeg'],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'image/png'],
  ] as const)('accepts a real %s signature', (_name, bytes, advertised, expected) => {
    expect(validateEvidence(bytes, advertised)).toBe(expected)
  })

  it.each([
    ['GIF masquerading as PNG', Buffer.from('GIF89a'), 'image/png'],
    ['empty body', Buffer.alloc(0), 'image/png'],
    ['mismatched JPEG advertisement', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg'],
  ])('rejects %s', (_name, bytes, advertised) => {
    expect(() => validateEvidence(bytes, advertised)).toThrow('UNSUPPORTED_EVIDENCE')
  })

  it('consumes repeated multipart files in order and rejects form fields', async () => {
    const boundary = 'pmc-boundary'
    const onFile = vi.fn(async () => undefined)
    const request = multipartRequest(boundary, [
      filePart(boundary, 'one.png', 'image/png', Buffer.from('one')),
      filePart(boundary, 'two.png', 'image/png', Buffer.from('two')),
      Buffer.from(`--${boundary}--\r\n`),
    ])

    await expect(consumeEvidenceMultipart(request, { maxFiles: 10, maxFileBytes: 20 }, onFile)).resolves.toBe(2)
    expect(onFile.mock.calls.map(([file]) => file.originalName)).toEqual(['one.png', 'two.png'])

    const withField = multipartRequest(boundary, [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nnot-allowed\r\n--${boundary}--\r\n`),
    ])
    await expect(consumeEvidenceMultipart(withField, { maxFiles: 10, maxFileBytes: 20 }, onFile)).rejects.toThrow('UNKNOWN_MULTIPART_FIELD')
  })

  it('rejects incomplete and oversized multipart streams', async () => {
    const boundary = 'pmc-boundary'
    const incomplete = multipartRequest(boundary, [filePart(boundary, 'one.png', 'image/png', Buffer.from('one'))])
    await expect(consumeEvidenceMultipart(incomplete, { maxFiles: 10, maxFileBytes: 20 }, async () => undefined)).rejects.toThrow('INVALID_MULTIPART')

    const oversized = multipartRequest(boundary, [
      filePart(boundary, 'large.png', 'image/png', Buffer.from('12345')),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    await expect(consumeEvidenceMultipart(oversized, { maxFiles: 10, maxFileBytes: 4 }, async () => undefined)).rejects.toThrow('EVIDENCE_TOO_LARGE')
  })

  it('creates a server-owned file name without using the client path', () => {
    expect(serverEvidenceName('CHAT', 'image/png', 'fixed-id')).toBe('chat-fixed-id.png')
    expect(() => serverEvidenceName('CHAT', 'image/png', '../../client-name')).toThrow('INVALID_EVIDENCE_ID')
  })
})

function multipartRequest(boundary: string, chunks: Buffer[]): IncomingMessage {
  const request = new PassThrough() as PassThrough & IncomingMessage
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
  for (const chunk of chunks) request.write(chunk)
  request.end()
  return request
}

function filePart(boundary: string, filename: string, mimeType: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from('\r\n'),
  ])
}
