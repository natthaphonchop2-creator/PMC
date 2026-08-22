import { createHash } from 'node:crypto'
import sharp from 'sharp'

export interface PreparedOcrImage {
  originalSha256: string
  analysisJpeg: Buffer
  width: number
  height: number
}

const MAX_INPUT_PIXELS = 40_000_000

export async function prepareOcrImage(original: Buffer, maxBytes: number): Promise<PreparedOcrImage> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('OCR_MAX_IMAGE_BYTES must be a positive integer')
  if (original.byteLength > maxBytes) throw new RangeError('Image exceeds OCR_MAX_IMAGE_BYTES')

  if (!hasAllowedImageMagic(original)) throw new TypeError('Unsupported OCR image format')
  const image = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
  const metadata = await image.metadata()
  if (metadata.format !== 'jpeg' && metadata.format !== 'png') throw new TypeError('Unsupported OCR image format')

  const originalSha256 = createHash('sha256').update(original).digest('hex')
  const { data: analysisJpeg, info } = await image
    .rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return { originalSha256, analysisJpeg, width: info.width, height: info.height }
}

function hasAllowedImageMagic(bytes: Buffer): boolean {
  const jpeg = bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return jpeg || png
}
