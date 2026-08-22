import { describe, expect, it, vi } from 'vitest'
import { createOcrLineClient, OcrLineClientError } from '../../server/ocr-ledger/lineClient'

describe('OCR LINE client', () => {
  it('uses the documented LINE endpoints with injected fetch and authorization', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/content')) return response(200, {}, Buffer.from('jpeg-bytes'), { 'content-type': 'image/jpeg' })
      if (url.includes('/oauth2/')) return response(200, { sub: 'Ustaff', aud: '2001234567', exp: 1_900_000_000 })
      if (url.includes('/member/')) return response(200, { displayName: 'Staff' })
      return response(200, {})
    })
    const client = createOcrLineClient({
      channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 1024,
      now: () => 1_800_000_000, fetch,
    })

    await expect(client.downloadImage('message-1')).resolves.toEqual({ bytes: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' })
    await client.reply('reply-token', [{ type: 'text', text: 'รับแล้ว' }])
    await client.push('Cgroup1', [{ type: 'text', text: 'รายงาน' }])
    await expect(client.verifyLiffIdToken('raw-id-token')).resolves.toEqual({ userId: 'Ustaff' })
    await expect(client.assertGroupMember('Cgroup1', 'Ustaff')).resolves.toEqual({ displayName: 'Staff' })
    await client.validatePush([{ type: 'text', text: 'ตรวจสอบ' }])

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api-data.line.me/v2/bot/message/message-1/content',
      'https://api.line.me/v2/bot/message/reply',
      'https://api.line.me/v2/bot/message/push',
      'https://api.line.me/oauth2/v2.1/verify',
      'https://api.line.me/v2/bot/group/Cgroup1/member/Ustaff',
      'https://api.line.me/v2/bot/message/validate/push',
    ])
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST', headers: { authorization: 'Bearer channel-token', 'content-type': 'application/json' },
      body: JSON.stringify({ replyToken: 'reply-token', messages: [{ type: 'text', text: 'รับแล้ว' }] }),
    })
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id_token=raw-id-token&client_id=2001234567',
    })
  })

  it.each([
    ['rejects non-image content', response(200, {}, Buffer.from('gif'), { 'content-type': 'image/gif' }), 'LINE_IMAGE_CONTENT_TYPE'],
    ['rejects oversized content', response(200, {}, Buffer.alloc(6), { 'content-type': 'image/png' }), 'LINE_IMAGE_TOO_LARGE'],
    ['does not accept a mismatched LIFF audience', response(200, { sub: 'Ustaff', aud: 'other-channel', exp: 1_900_000_000 }), 'LINE_LIFF_ID_TOKEN_INVALID'],
    ['does not accept an expired LIFF token', response(200, { sub: 'Ustaff', aud: '2001234567', exp: 1_799_999_999 }), 'LINE_LIFF_ID_TOKEN_EXPIRED'],
  ])('%s', async (_name, verifiedTokenResponse, code) => {
    const usesImage = _name.includes('image') || _name.includes('oversized')
    const fetch = vi.fn(async (url: string) => usesImage
      ? verifiedTokenResponse
      : url.includes('/oauth2/') ? verifiedTokenResponse : response(200, { displayName: 'Staff' }))
    const client = createOcrLineClient({ channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 5, now: () => 1_800_000_000, fetch })

    const operation = usesImage
      ? client.downloadImage('message-1')
      : client.verifyLiffIdToken('raw-id-token')

    await expect(operation).rejects.toMatchObject({ code })
  })

  it('returns only safe errors for provider failures and non-members', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('/member/')
      ? response(403, { message: 'provider secret response body' })
      : response(500, { message: 'provider secret response body' }))
    const client = createOcrLineClient({ channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 1024, now: () => 1_800_000_000, fetch })

    await expect(client.push('Cgroup1', [])).rejects.toBeInstanceOf(OcrLineClientError)
    await expect(client.push('Cgroup1', [])).rejects.toMatchObject({ message: expect.not.stringContaining('provider secret response body') })
    await expect(client.assertGroupMember('Cgroup1', 'Ustaff')).rejects.toMatchObject({ code: 'LINE_GROUP_MEMBERSHIP_REQUIRED' })
  })

  it('sends the retry key on a push and accepts a 2xx response', async () => {
    const fetch = vi.fn(async () => response(202, {}))
    const client = createOcrLineClient({ channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 1024, fetch })

    await expect(client.push('Cgroup1', [{ type: 'text', text: 'รายงาน' }], '9c7e6bc6-5d38-46de-8fa9-2e0e8a580e53')).resolves.toBeUndefined()

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: {
      authorization: 'Bearer channel-token', 'content-type': 'application/json', 'x-line-retry-key': '9c7e6bc6-5d38-46de-8fa9-2e0e8a580e53',
    } })
  })

  it('accepts a 409 only for an identified previously accepted retry-key push', async () => {
    const fetch = vi.fn(async () => response(409, {}, Buffer.alloc(0), { 'x-line-accepted-request-id': 'accepted-request' }))
    const client = createOcrLineClient({ channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 1024, fetch })

    await expect(client.push('Cgroup1', [], '9c7e6bc6-5d38-46de-8fa9-2e0e8a580e53')).resolves.toBeUndefined()
  })

  it.each([
    ['without an accepted request ID', '9c7e6bc6-5d38-46de-8fa9-2e0e8a580e53', {}],
    ['without a retry key', undefined, { 'x-line-accepted-request-id': 'accepted-request' }],
  ])('rejects an unsafe 409 %s', async (_name, retryKey, headers) => {
    const fetch = vi.fn(async () => response(409, {}, Buffer.alloc(0), headers))
    const client = createOcrLineClient({ channelAccessToken: 'channel-token', liffChannelId: '2001234567', maxImageBytes: 1024, fetch })

    await expect(client.push('Cgroup1', [], retryKey)).rejects.toMatchObject({ code: 'LINE_PUSH_FAILED' })
  })
})

function response(status: number, json: unknown, bytes = Buffer.alloc(0), headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => json,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}
