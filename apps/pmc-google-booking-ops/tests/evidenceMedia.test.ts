import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createEvidenceMediaPort,
  evidenceToken,
} from '../src/adapters/evidenceMedia'

const crypto = {
  hmacSha256Hex(value: string, secret: string) {
    return createHmac('sha256', secret).update(value).digest('hex')
  },
  sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex')
  },
  base64UrlUtf8(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url')
  },
  base64Decode(value: string) {
    return [...Buffer.from(value, 'base64')]
  },
}

describe('Apps Script evidence media signer', () => {
  it('returns every slip and chat reference in source order', () => {
    const port = createEvidenceMediaPort(
      'https://example.com/api/booking-evidence/image',
      'unit-test-secret',
      crypto,
    )
    const images = port.images(
      'PMC-202608-0001',
      ['pay-1aaaaa', 'pay-2bbbbb', 'pay-3ccccc'],
      ['chat-1aaaa', 'chat-2bbbb', 'chat-3cccc', 'chat-4dddd', 'chat-5eeee', 'chat-6ffff'],
    )

    expect(images.payments).toHaveLength(3)
    expect(images.chats).toHaveLength(6)
    expect(images.totalPaymentCount).toBe(3)
    expect(images.totalChatCount).toBe(6)
    expect(images.payments[2].previewUrl).toContain('?t=')
    expect(images.chats[5].fullUrl).toContain('?t=')
  })

  it('matches the Node fixed token vector', () => {
    expect(
      evidenceToken(
        {
          v: 1,
          caseId: 'PMC-202608-0001',
          fileId: 'file_ABC123xyz',
          kind: 'PAYMENT',
          ordinal: 1,
          variant: 'preview',
        },
        'unit-test-secret',
        crypto,
      ),
    ).toBe(
      'eyJ2IjoxLCJjYXNlSWQiOiJQTUMtMjAyNjA4LTAwMDEiLCJmaWxlSWQiOiJmaWxlX0FCQzEyM3h5eiIsImtpbmQiOiJQQVlNRU5UIiwib3JkaW5hbCI6MSwidmFyaWFudCI6InByZXZpZXcifQ.743a360b59bbdfa6e51296d458d838a3a338462b6258d35f600479ca92287205',
    )
  })

  it('creates deterministic variants for every selected file', () => {
    const port = createEvidenceMediaPort(
      'https://example.com/api/booking-evidence/image',
      'unit-test-secret',
      crypto,
    )
    const images = port.images('PMC-202608-0001', ['pay-123456'], [
      'chat-111111',
      'chat-222222',
      'chat-333333',
      'chat-444444',
    ])

    expect(images.payments[0]?.previewUrl).toContain('?t=')
    expect(images.payments[0]?.previewUrl).not.toBe(images.payments[0]?.fullUrl)
    expect(images.chats).toHaveLength(4)
    expect(images.totalPaymentCount).toBe(1)
    expect(images.totalChatCount).toBe(4)
    expect(port.images('PMC-202608-0001', ['pay-123456'], []).payments).toEqual(images.payments)
  })

  it('returns a no-image shape for empty evidence arrays', () => {
    const port = createEvidenceMediaPort(
      'https://example.com/api/booking-evidence/image',
      'unit-test-secret',
      crypto,
    )
    expect(port.images('PMC-202608-0001', [], [])).toEqual({
      payments: [],
      chats: [],
      totalPaymentCount: 0,
      totalChatCount: 0,
    })
  })
})
