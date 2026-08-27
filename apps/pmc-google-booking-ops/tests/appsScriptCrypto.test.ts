import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppsScriptCryptoPort } from '../src/adapters/lineMessaging'

const originalUtilities = globalThis.Utilities

afterEach(() => {
  globalThis.Utilities = originalUtilities
})

describe('Apps Script crypto adapter', () => {
  it('signs Thai booking payloads as UTF-8', () => {
    const utf8 = Symbol('UTF_8')
    globalThis.Utilities = {
      Charset: { UTF_8: utf8 },
      computeHmacSha256Signature(value: string, secret: string, charset?: symbol) {
        const encoding = charset === utf8 ? 'utf8' : 'utf16le'
        return [...createHmac('sha256', secret).update(value, encoding).digest()]
      },
    } as unknown as GoogleAppsScript.Utilities.Utilities

    const value = '{"customerName":"ลูกค้าทดสอบ","channelId":"เพจหลัก"}'

    expect(createAppsScriptCryptoPort().hmacSha256Hex(value, 'ingress-secret')).toBe(
      '1846b23dfade57b9c3358c0e359a4895a1c6890ce47d855dd5f599fdf23628cf',
    )
  })
})
