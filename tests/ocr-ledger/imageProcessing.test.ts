import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareOcrImage } from '../../server/ocr-ledger/imageProcessing'

describe('prepareOcrImage', () => {
  it('rotates EXIF-oriented images and writes a bounded JPEG analysis copy', async () => {
    const original = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#1188cc' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const prepared = await prepareOcrImage(original, original.byteLength + 1)
    const metadata = await sharp(prepared.analysisJpeg).metadata()

    expect([prepared.width, prepared.height]).toEqual([100, 300])
    expect(metadata.format).toBe('jpeg')
  })

  it('limits the longest analysis edge to 2048 pixels without enlarging small images', async () => {
    const large = await sharp({ create: { width: 5000, height: 1000, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }).png().toBuffer()

    const [preparedLarge, preparedSmall] = await Promise.all([
      prepareOcrImage(large, large.byteLength + 1),
      prepareOcrImage(small, small.byteLength + 1),
    ])

    expect([preparedLarge.width, preparedLarge.height]).toEqual([2048, 410])
    expect([preparedSmall.width, preparedSmall.height]).toEqual([100, 50])
  })

  it('calculates the stable SHA-256 from original bytes instead of the analysis JPEG', async () => {
    const original = await sharp({ create: { width: 250, height: 100, channels: 3, background: '#559900' } }).png().toBuffer()

    const prepared = await prepareOcrImage(original, original.byteLength + 1)

    expect(prepared.originalSha256).toBe(createHash('sha256').update(original).digest('hex'))
    expect(prepared.analysisJpeg.equals(original)).toBe(false)
  })

  it('rejects decompression-bomb-sized input before analysis', async () => {
    const oversizedPixels = await sharp({ create: { width: 8000, height: 5001, channels: 3, background: '#000000' } }).jpeg().toBuffer()

    await expect(prepareOcrImage(oversizedPixels, oversizedPixels.byteLength + 1))
      .rejects.toThrow(/pixel limit/i)
  })

  it('rejects source bytes above OCR_MAX_IMAGE_BYTES', async () => {
    const original = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()

    await expect(prepareOcrImage(original, original.byteLength - 1))
      .rejects.toThrow('OCR_MAX_IMAGE_BYTES')
  })
})
