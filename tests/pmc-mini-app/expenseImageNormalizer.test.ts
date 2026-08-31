import { describe, expect, it, vi } from 'vitest'
import {
  ExpenseImageConversionError,
  normalizeExpenseUploadFiles,
  type ExpenseImageConversionPorts,
} from '../../src/apps/pmc-mini-app/expense/expenseImageNormalizer'

describe('expense mobile image normalization', () => {
  it('keeps JPEG and PNG while converting WebP, HEIC, and HEIF to ordered JPEG files', async () => {
    const jpeg = file('one.jpg', 'image/jpeg', 11)
    const png = file('two.png', 'image/png', 12)
    const webp = file('three.webp', 'image/webp', 13)
    const heic = file('four.HEIC', 'image/heic', 14)
    const heif = file('five.heif', 'image/heif', 15)
    const calls: string[] = []
    const ports: ExpenseImageConversionPorts = {
      convertWebp: vi.fn(async (source) => {
        calls.push(source.name)
        return new Blob([`jpeg:${source.name}`], { type: 'image/jpeg' })
      }),
      convertHeic: vi.fn(async (source) => {
        calls.push(source.name)
        return new Blob([`jpeg:${source.name}`], { type: 'image/jpeg' })
      }),
    }

    const normalized = await normalizeExpenseUploadFiles([jpeg, png, webp, heic, heif], ports)

    expect(normalized.slice(0, 2)).toEqual([jpeg, png])
    expect(normalized.map(({ name, type, lastModified }) => ({ name, type, lastModified }))).toEqual([
      { name: 'one.jpg', type: 'image/jpeg', lastModified: 11 },
      { name: 'two.png', type: 'image/png', lastModified: 12 },
      { name: 'three.jpg', type: 'image/jpeg', lastModified: 13 },
      { name: 'four.jpg', type: 'image/jpeg', lastModified: 14 },
      { name: 'five.jpg', type: 'image/jpeg', lastModified: 15 },
    ])
    expect(calls).toEqual(['three.webp', 'four.HEIC', 'five.heif'])
  })

  it('fails closed when a converter does not return one readable JPEG blob', async () => {
    const ports: ExpenseImageConversionPorts = {
      convertWebp: vi.fn(async () => new Blob(['wrong'], { type: 'image/png' })),
      convertHeic: vi.fn(async () => new Blob([], { type: 'image/jpeg' })),
    }

    await expect(normalizeExpenseUploadFiles([file('bad.webp', 'image/webp')], ports))
      .rejects.toBeInstanceOf(ExpenseImageConversionError)
    await expect(normalizeExpenseUploadFiles([file('empty.heic', 'image/heic')], ports))
      .rejects.toBeInstanceOf(ExpenseImageConversionError)
  })

  it('canonicalizes Android JPEG MIME aliases before multipart upload without recompressing', async () => {
    const androidJpeg = file('camera.jpeg', 'image/jpg', 21)
    const genericJpeg = file('download.jpg', 'application/octet-stream', 22)
    const ports: ExpenseImageConversionPorts = {
      convertWebp: vi.fn(),
      convertHeic: vi.fn(),
    }

    const normalized = await normalizeExpenseUploadFiles([androidJpeg, genericJpeg], ports)

    expect(normalized.map(({ name, type, lastModified }) => ({ name, type, lastModified }))).toEqual([
      { name: 'camera.jpeg', type: 'image/jpeg', lastModified: 21 },
      { name: 'download.jpg', type: 'image/jpeg', lastModified: 22 },
    ])
    expect(await normalized[0]!.arrayBuffer()).toEqual(await androidJpeg.arrayBuffer())
    expect(await normalized[1]!.arrayBuffer()).toEqual(await genericJpeg.arrayBuffer())
    expect(ports.convertWebp).not.toHaveBeenCalled()
    expect(ports.convertHeic).not.toHaveBeenCalled()
  })
})

function file(name: string, type: string, lastModified = 1): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type, lastModified })
}
