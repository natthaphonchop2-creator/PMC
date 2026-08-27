import { describe, expect, it, vi } from 'vitest'
import { createMiniAppGooglePorts, type MiniAppGoogleFactory } from '../../server/pmc-mini-app/googleClient'

describe('PMC Mini App keyless Google ports', () => {
  it('uses ADC service identity with only the required Google scopes', () => {
    const scopes: string[][] = []
    const factory = inertFactory((nextScopes) => scopes.push(nextScopes))

    const ports = createMiniAppGooglePorts({ spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' }, factory)

    expect(ports.authMode).toBe('ADC_SERVICE_IDENTITY')
    expect(scopes).toEqual([[
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ]])
  })

  it('rejects a spreadsheet ID outside the configured resource', async () => {
    const ports = createMiniAppGooglePorts({ spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' }, inertFactory())

    await expect(ports.sheets.batchGet('other-sheet', ['CONFIG_STAFF!A:H'])).rejects.toThrow('outside the Mini App allowlist')
  })

  it('maps Sheet batch reads by returned range and writes values as RAW', async () => {
    const batchGet = vi.fn(async () => ({ data: { valueRanges: [
      { range: "'TAB_B'!A1:B2", values: [['b']] },
      { range: "'TAB_A'!A1:B2", values: [['a']] },
    ] } }))
    const batchUpdate = vi.fn(async () => ({ data: {} }))
    const base = inertFactory()
    const ports = createMiniAppGooglePorts(
      { spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' },
      {
        ...base,
        createSheets: () => ({
          spreadsheets: {
            get: vi.fn(), batchUpdate: vi.fn(),
            values: { batchGet, append: vi.fn(), update: vi.fn(), batchUpdate },
          },
        }),
      },
    )

    await expect(ports.sheets.batchGet('sheet-1', ["'TAB_A'!A1:B2", "'TAB_B'!A1:B2"])).resolves.toEqual({
      "'TAB_A'!A1:B2": [['a']],
      "'TAB_B'!A1:B2": [['b']],
    })
    await ports.sheets.batchUpdate('sheet-1', [{ range: "'TAB_A'!A2:B2", values: [['x', 'y']] }])
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      requestBody: { valueInputOption: 'RAW', data: [{ range: "'TAB_A'!A2:B2", values: [['x', 'y']] }] },
    })
  })

  it('matches an open-ended requested range when Google returns its populated end row', async () => {
    const batchGet = vi.fn(async () => ({ data: { valueRanges: [
      { range: "'CONFIG_STAFF'!A2:H9", values: [['staff-1', 'มัส']] },
    ] } }))
    const base = inertFactory()
    const ports = createMiniAppGooglePorts(
      { spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' },
      {
        ...base,
        createSheets: () => ({
          spreadsheets: {
            get: vi.fn(), batchUpdate: vi.fn(),
            values: { batchGet, append: vi.fn(), update: vi.fn(), batchUpdate: vi.fn() },
          },
        }),
      },
    )

    await expect(ports.sheets.batchGet('sheet-1', ["'CONFIG_STAFF'!A2:H"])).resolves.toEqual({
      "'CONFIG_STAFF'!A2:H": [['staff-1', 'มัส']],
    })
  })

  it('uploads evidence only to the intake folder with bounded app properties', async () => {
    const create = vi.fn(async () => ({ data: { id: 'file-1' } }))
    const ports = createMiniAppGooglePorts(
      { spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' },
      factoryWithDrive({ create, get: vi.fn() }),
    )

    await expect(ports.drive.uploadEvidence({
      parentId: 'folder-1',
      draftId: 'draft-1',
      requestId: 'request-1',
      kind: 'CHAT',
      name: 'server-name.png',
      mimeType: 'image/png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })).resolves.toBe('file-1')

    expect(create).toHaveBeenCalledWith({
      requestBody: {
        name: 'server-name.png',
        parents: ['folder-1'],
        appProperties: {
          pmcMiniAppDraftId: 'draft-1',
          pmcMiniAppRequestId: 'request-1',
          evidenceKind: 'CHAT',
        },
      },
      media: { mimeType: 'image/png', body: expect.any(Buffer) },
      fields: 'id',
    })

    await expect(ports.drive.uploadEvidence({
      parentId: 'other-folder', draftId: 'draft-1', requestId: 'request-1', kind: 'CHAT',
      name: 'server-name.png', mimeType: 'image/png', bytes: Buffer.from('png'),
    })).rejects.toThrow('outside the Mini App allowlist')
  })

  it('downloads only supported evidence inside the configured Drive hierarchy', async () => {
    const get = vi.fn(async (input: { fileId: string; alt?: string }) => {
      if (input.alt === 'media') return { data: Uint8Array.from([1, 2, 3]).buffer }
      if (input.fileId === 'file-1') return { data: { mimeType: 'image/jpeg', parents: ['child-folder'], trashed: false } }
      if (input.fileId === 'child-folder') return { data: { parents: ['folder-1'], trashed: false } }
      if (input.fileId === 'outside-file') return { data: { mimeType: 'image/jpeg', parents: ['outside-folder'], trashed: false } }
      return { data: { parents: ['outside-folder'], trashed: false } }
    })
    const ports = createMiniAppGooglePorts(
      { spreadsheetId: 'sheet-1', intakeFolderId: 'folder-1' },
      factoryWithDrive({ create: vi.fn(), get }),
    )

    await expect(ports.drive.downloadEvidence('file-1')).resolves.toEqual({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
    })
    await expect(ports.drive.downloadEvidence('outside-file')).rejects.toThrow('outside the Mini App allowlist')
  })
})

function inertFactory(onScopes: (scopes: string[]) => void = () => undefined): MiniAppGoogleFactory {
  return {
    createAuth(scopes) { onScopes(scopes); return { kind: 'adc' } },
    createSheets() {
      return {
        spreadsheets: {
          get: vi.fn(), batchUpdate: vi.fn(),
          values: { batchGet: vi.fn(), append: vi.fn(), update: vi.fn(), batchUpdate: vi.fn() },
        },
      }
    },
    createDrive() { return { files: { create: vi.fn(), get: vi.fn() } } },
  }
}

function factoryWithDrive(files: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }): MiniAppGoogleFactory {
  const factory = inertFactory()
  return { ...factory, createDrive: () => ({ files }) }
}
