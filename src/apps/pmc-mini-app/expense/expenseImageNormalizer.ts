import { expenseSourceImageType, type ExpenseSourceImageType } from './expenseModel'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heif', 'heim', 'heis', 'mif1', 'msf1'])

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
    const sourceType = await imageTypeFromMagic(file) ?? expenseSourceImageType(file)
    if (sourceType === 'JPEG') {
      normalized.push(file.type.trim().toLowerCase() === 'image/jpeg' && /\.jpe?g$/i.test(file.name)
        ? file
        : new File([file], /\.jpe?g$/i.test(file.name) ? file.name : imageFileName(file.name, 'jpg'), {
          type: 'image/jpeg', lastModified: file.lastModified,
        }))
      continue
    }
    if (sourceType === 'PNG') {
      normalized.push(file.type.trim().toLowerCase() === 'image/png' && /\.png$/i.test(file.name)
        ? file
        : new File([file], imageFileName(file.name, 'png'), { type: 'image/png', lastModified: file.lastModified }))
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
    normalized.push(new File([converted], imageFileName(file.name, 'jpg'), {
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

async function imageTypeFromMagic(file: File): Promise<ExpenseSourceImageType | null> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  } catch {
    return null
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'
  if (bytes.length >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return 'PNG'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'WEBP'
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return 'HEIC'
  return null
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function imageFileName(value: string, extension: 'jpg' | 'png'): string {
  const base = value.replace(/\.(?:jpe?g|png|webp|heic|heif)$/i, '')
  return `${base || 'image'}.${extension}`
}
