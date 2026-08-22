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

  const originalSha256 = createHash('sha256').update(original).digest('hex')
  const { data: analysisJpeg, info } = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return { originalSha256, analysisJpeg, width: info.width, height: info.height }
}
