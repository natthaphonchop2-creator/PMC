import { describe, expect, it } from 'vitest'
import { buildEvidenceFlexMessages } from '../src/adapters/evidenceCarouselFlex'
import { evidenceFixture } from './helpers/fakes'

describe('compact evidence Flex', () => {
  it('builds one slip-first thumbnail card capped at four images', () => {
    const messages = buildEvidenceFlexMessages(evidenceFixture({
      paymentCount: 3,
      chatCount: 19,
    }))

    expect(messages).toHaveLength(1)
    const json = JSON.stringify(messages[0])
    expect(json).not.toContain('"type":"carousel"')
    expect(json).toContain('สลิป 1')
    expect(json).toContain('สลิป 3')
    expect(json).toContain('แชท 1')
    expect(json).not.toContain('แชท 2')
    expect(json).toContain('แสดง 4 จากทั้งหมด 22 รูป')
    expect(json.length).toBeLessThan(50_000)
  })

  it('returns no evidence message when no image is available', () => {
    expect(buildEvidenceFlexMessages(evidenceFixture({
      paymentCount: 0,
      chatCount: 0,
    }))).toEqual([])
  })
})
