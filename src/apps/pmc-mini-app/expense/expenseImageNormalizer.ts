import { expenseSourceImageType } from './expenseModel'

export interface ExpenseImageConversionPorts {
  convertWebp(file: File): Promise<Blob>
  convertHeic(file: File): Promise<Blob>
}

export class ExpenseImageConversionError extends Error {
  constructor() {
    super('EXPENSE_IMAGE_CONVERSION_FAILED')
    this.name = 'ExpenseImageConversionError'
  }
}

export async function normalizeExpenseUploadFiles(
  files: File[],
  ports: ExpenseImageConversionPorts = browserConversionPorts,
): Promise<File[]> {
  const normalized: File[] = []
  for (const file of files) {
    const sourceType = expenseSourceImageType(file)
    if (sourceType === 'JPEG' || sourceType === 'PNG') {
      normalized.push(file)
      continue
    }
    if (sourceType !== 'WEBP' && sourceType !== 'HEIC') throw new ExpenseImageConversionError()
    let converted: Blob
    try {
      converted = sourceType === 'WEBP'
        ? await ports.convertWebp(file)
        : await ports.convertHeic(file)
    } catch {
      throw new ExpenseImageConversionError()
    }
    if (!(converted instanceof Blob) || converted.type !== 'image/jpeg' || converted.size < 1) {
      throw new ExpenseImageConversionError()
    }
    normalized.push(new File([converted], jpegFileName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    }))
  }
  return normalized
}

const browserConversionPorts: ExpenseImageConversionPorts = {
  convertWebp: convertBrowserReadableImageToJpeg,
  async convertHeic(file) {
    const { convertHeic } = await import('@keeratita/heic-converter')
    return convertHeic(file, { to: 'jpeg', quality: 0.9 })
  },
}

async function convertBrowserReadableImageToJpeg(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new ExpenseImageConversionError()
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (!safeDimensions(bitmap.width, bitmap.height)) throw new ExpenseImageConversionError()
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new ExpenseImageConversionError()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob?.type === 'image/jpeg' && blob.size > 0) resolve(blob)
        else reject(new ExpenseImageConversionError())
      }, 'image/jpeg', 0.9)
    })
  } finally {
    bitmap.close()
  }
}

function safeDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0 && width <= Math.floor(20_000_000 / height)
}

function jpegFileName(value: string): string {
  return `${value.replace(/\.(?:webp|heic|heif)$/i, '')}.jpg`
}
