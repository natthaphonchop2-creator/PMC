import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { BookingDraftInputV2 } from '../../src/apps/pmc-mini-app/contracts'
import { consumeBookingPrepareMultipart } from '../../server/pmc-mini-app/evidenceBatch'

describe('PMC Booking prepare multipart parser', () => {
  it.each([
    ['missing input', []],
    ['duplicate input', [inputPart('prepare-boundary'), inputPart('prepare-boundary')]],
    ['invalid JSON', [textPart('prepare-boundary', 'input', '{')]],
    ['an unknown text field', [inputPart('prepare-boundary'), textPart('prepare-boundary', 'note', 'private')]],
    ['an extra outer JSON key', [inputPart('prepare-boundary', { traceId: 'private' })]],
    ['protocol 1', [inputPart('prepare-boundary', { protocolVersion: 1 })]],
    ['version zero', [inputPart('prepare-boundary', { version: 0 })]],
    ['a fractional version', [inputPart('prepare-boundary', { version: 1.5 })]],
    ['an extra Booking input key', [inputPart('prepare-boundary', {}, { recorderName: 'forged' })]],
    ['a noncanonical Booking input value', [inputPart('prepare-boundary', {}, { depositAmount: '900' })]],
  ])('rejects %s with the one safe JSON error', async (_case, inputParts) => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [
      ...inputParts,
      filePart(boundary, 'paymentFiles', 'payment.png', 'image/png', pngBytes(9)),
      filePart(boundary, 'chatFiles', 'chat.jpg', 'image/jpeg', jpegBytes(5)),
      closingPart(boundary),
    ])

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'BOOKING_PREPARE_JSON_REQUIRED' })
  })

  it.each([
    ['no payment file', [] as Buffer[], [filePart('prepare-boundary', 'chatFiles', 'chat.png', 'image/png', pngBytes(9))]],
    ['no chat file', [filePart('prepare-boundary', 'paymentFiles', 'payment.png', 'image/png', pngBytes(9))], [] as Buffer[]],
    ['eleven payment files', Array.from({ length: 11 }, (_, index) => filePart('prepare-boundary', 'paymentFiles', `${index}.png`, 'image/png', pngBytes(9))), [filePart('prepare-boundary', 'chatFiles', 'chat.png', 'image/png', pngBytes(9))]],
    ['eleven chat files and twenty-one total', Array.from({ length: 10 }, (_, index) => filePart('prepare-boundary', 'paymentFiles', `${index}.png`, 'image/png', pngBytes(9))), Array.from({ length: 11 }, (_, index) => filePart('prepare-boundary', 'chatFiles', `${index}.png`, 'image/png', pngBytes(9)))],
  ])('rejects %s with the evidence file limit', async (_case, payments, chats) => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [inputPart(boundary), ...payments, ...chats, closingPart(boundary)])

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'EVIDENCE_FILE_LIMIT' })
  })

  it('rejects a 10,000,001-byte file independently of the aggregate limit', async () => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [
      inputPart(boundary),
      filePart(boundary, 'paymentFiles', 'large.png', 'image/png', pngBytes(10_000_001)),
      filePart(boundary, 'chatFiles', 'chat.png', 'image/png', pngBytes(9)),
      closingPart(boundary),
    ])

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'EVIDENCE_TOO_LARGE' })
  })

  it('rejects 25,000,001 decoded evidence bytes across otherwise valid files', async () => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [
      inputPart(boundary),
      filePart(boundary, 'paymentFiles', 'payment-1.png', 'image/png', pngBytes(10_000_000)),
      filePart(boundary, 'paymentFiles', 'payment-2.png', 'image/png', pngBytes(5_000_001)),
      filePart(boundary, 'chatFiles', 'chat.png', 'image/png', pngBytes(10_000_000)),
      closingPart(boundary),
    ])

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'EVIDENCE_BATCH_TOO_LARGE' })
  })

  it.each([
    ['unsupported MIME', 'image/gif', pngBytes(9)],
    ['MIME and magic mismatch', 'image/png', jpegBytes(5)],
    ['empty evidence', 'image/png', Buffer.alloc(0)],
    ['truncated image signature', 'image/png', Buffer.from([0x89, 0x50, 0x4e])],
  ])('rejects %s without exposing multipart values', async (_case, mimeType, bytes) => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [
      inputPart(boundary),
      filePart(boundary, 'paymentFiles', 'private-customer-name.png', mimeType, bytes),
      filePart(boundary, 'chatFiles', 'chat.png', 'image/png', pngBytes(9)),
      closingPart(boundary),
    ])

    const error = await parsePrepare(request).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'UNSUPPORTED_EVIDENCE', message: 'UNSUPPORTED_EVIDENCE' })
    expect(String(error)).not.toContain('private-customer-name')
  })

  it('rejects file fields outside paymentFiles and chatFiles', async () => {
    const boundary = 'prepare-boundary'
    const request = multipartRequest(boundary, [
      inputPart(boundary),
      filePart(boundary, 'files', 'private.png', 'image/png', pngBytes(9)),
      filePart(boundary, 'paymentFiles', 'payment.png', 'image/png', pngBytes(9)),
      filePart(boundary, 'chatFiles', 'chat.png', 'image/png', pngBytes(9)),
      closingPart(boundary),
    ])

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'UNSUPPORTED_EVIDENCE' })
  })

  it('rejects an oversized advertised Content-Length before consuming the body', async () => {
    const request = multipartStream('prepare-boundary', {
      'content-length': '26000001',
    })

    await expect(parsePrepare(request)).rejects.toMatchObject({ code: 'EVIDENCE_BATCH_TOO_LARGE' })
    expect(request.listenerCount('data')).toBe(0)
    expect(request.readableFlowing).toBeNull()
    request.end()
  })

  it('stops and cleans up immediately when a chunked body exceeds 26,000,000 raw bytes', async () => {
    const request = multipartStream('prepare-boundary')
    const result = parsePrepare(request)

    request.write(Buffer.alloc(26_000_001))

    await expect(result).rejects.toMatchObject({ code: 'EVIDENCE_BATCH_TOO_LARGE' })
    expect(request.listenerCount('data')).toBe(0)
    expect(request.listenerCount('aborted')).toBe(0)
    expect(request.listenerCount('error')).toBe(0)
    request.end()
  })

  it('settles once and removes request listeners after an aborted multipart body', async () => {
    const request = multipartStream('prepare-boundary')
    const result = parsePrepare(request)

    request.emit('aborted')

    await expect(result).rejects.toMatchObject({ code: 'BOOKING_PREPARE_JSON_REQUIRED' })
    expect(request.listenerCount('data')).toBe(0)
    expect(request.listenerCount('aborted')).toBe(0)
    expect(request.listenerCount('error')).toBe(0)
    request.end()
  })

  it('accepts exact file and decoded-byte boundaries and preserves per-kind order', async () => {
    const boundary = 'prepare-boundary'
    const payment = pngBytes(10_000_000, 1)
    const firstChat = jpegBytes(10_000_000, 2)
    const secondChat = pngBytes(5_000_000, 3)
    const request = multipartRequest(boundary, [
      inputPart(boundary),
      filePart(boundary, 'chatFiles', 'chat-1.jpg', 'image/jpeg', firstChat),
      filePart(boundary, 'paymentFiles', 'payment.png', 'image/png', payment),
      filePart(boundary, 'chatFiles', 'chat-2.png', 'image/png', secondChat),
      closingPart(boundary),
    ])

    await expect(parsePrepare(request)).resolves.toMatchObject({
      protocolVersion: 2,
      version: 4,
      input: validBookingInput(),
      paymentFiles: [{ advertisedMime: 'image/png', originalName: 'payment.png' }],
      chatFiles: [
        { advertisedMime: 'image/jpeg', originalName: 'chat-1.jpg' },
        { advertisedMime: 'image/png', originalName: 'chat-2.png' },
      ],
    })
  })
})

function parsePrepare(request: IncomingMessage) {
  return consumeBookingPrepareMultipart(request, {
    maxFilesPerKind: 10,
    maxFileBytes: 10_000_000,
    maxDecodedBytes: 25_000_000,
    maxRawBytes: 26_000_000,
  })
}

function validBookingInput(): BookingDraftInputV2 {
  return {
    requestId: 'request-1',
    adminId: 'ADMIN_01',
    aeId: null,
    customerName: 'ลูกค้าทดสอบ',
    facebookName: 'Facebook Test',
    phone: '0812345678',
    doctorId: 'DOCTOR_01',
    serviceId: 'SERVICE_01',
    queueType: 'NORMAL',
    appointmentDate: '2026-09-01',
    appointmentTime: '13:00',
    depositAmount: 900,
    channelId: 'CHANNEL_01',
  }
}

function inputPart(
  boundary: string,
  envelopePatch: Record<string, unknown> = {},
  bookingPatch: Record<string, unknown> = {},
): Buffer {
  return textPart(boundary, 'input', JSON.stringify({
    protocolVersion: 2,
    version: 4,
    input: { ...validBookingInput(), ...bookingPatch },
    ...envelopePatch,
  }))
}

function multipartRequest(boundary: string, chunks: Buffer[]): IncomingMessage {
  const request = multipartStream(boundary)
  request.end(Buffer.concat(chunks))
  return request
}

function multipartStream(boundary: string, headers: Record<string, string> = {}): IncomingMessage & PassThrough {
  return Object.assign(new PassThrough(), {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...headers },
  }) as IncomingMessage & PassThrough
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

function closingPart(boundary: string): Buffer {
  return Buffer.from(`--${boundary}--\r\n`)
}

function pngBytes(size: number, marker = 1): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return size <= signature.length ? signature.subarray(0, size) : Buffer.concat([signature, Buffer.alloc(size - signature.length, marker)])
}

function jpegBytes(size: number, marker = 1): Buffer {
  const signature = Buffer.from([0xff, 0xd8, 0xff])
  return size <= signature.length ? signature.subarray(0, size) : Buffer.concat([signature, Buffer.alloc(size - signature.length, marker)])
}
