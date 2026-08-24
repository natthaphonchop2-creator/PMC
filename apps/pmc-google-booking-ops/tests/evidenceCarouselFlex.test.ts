import { describe, expect, it } from 'vitest'
import { buildEvidenceFlexMessages } from '../src/adapters/evidenceCarouselFlex'
import { evidenceFixture } from './helpers/fakes'

describe('evidence Flex carousels', () => {
  it('builds every image in slip-first batches of ten', () => {
    const messages = buildEvidenceFlexMessages(evidenceFixture({
      paymentCount: 3,
      chatCount: 19,
    }))

    expect(messages).toHaveLength(3)
    const bubbles = messages.flatMap((message) =>
      (message.contents as { contents: unknown[] }).contents,
    )
    expect(bubbles).toHaveLength(22)
    expect(JSON.stringify(bubbles[0])).toContain('สลิป 1')
    expect(JSON.stringify(bubbles[2])).toContain('สลิป 3')
    expect(JSON.stringify(bubbles[3])).toContain('แชท 1')
    expect(JSON.stringify(bubbles[21])).toContain('แชท 19')
    for (const message of messages) {
      expect(JSON.stringify(message).length).toBeLessThan(50_000)
    }
  })

  it('returns no evidence message when no image is available', () => {
    expect(buildEvidenceFlexMessages(evidenceFixture({
      paymentCount: 0,
      chatCount: 0,
    }))).toEqual([])
  })
})
