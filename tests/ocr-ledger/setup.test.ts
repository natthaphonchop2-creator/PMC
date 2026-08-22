import { describe, expect, it } from 'vitest'
import type { OcrDrivePort, OcrSheetsPort } from '../../server/ocr-ledger/googleClient'
import { runOcrSetup } from '../../server/ocr-ledger/setup'

describe('OCR ledger setup', () => {
  it('defaults to dry run and makes no Drive or Sheets mutations', async () => {
    const mutations: string[] = []
    const drive: OcrDrivePort = {
      createFolder: async () => { mutations.push('folder'); return 'folder-1' },
      findFolder: async () => null,
      moveFile: async () => { mutations.push('move') },
      uploadImage: async () => { mutations.push('upload'); return 'image-1' },
      downloadImage: async () => ({ bytes: Buffer.alloc(0), mimeType: 'image/jpeg' }),
    }
    const sheets: OcrSheetsPort = {
      batchGet: async () => ({}), append: async () => { mutations.push('append') }, update: async () => { mutations.push('update') },
      batchUpdate: async () => { mutations.push('batchUpdate') }, create: async () => { mutations.push('sheet'); return 'sheet-1' },
    }

    const result = await runOcrSetup({ confirmCreate: false, drive, sheets, titlePrefix: 'PMC OCR' })

    expect(result.mode).toBe('DRY_RUN')
    expect(result.checks.map((check) => check.name)).toEqual(['OAuth scopes', 'private Drive hierarchy', 'master OCR workbook'])
    expect(mutations).toEqual([])
  })
})
