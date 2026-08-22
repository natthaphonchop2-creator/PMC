import { google } from 'googleapis'

export const GOOGLE_OCR_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
] as const

export interface OcrSheetsPort {
  batchGet(spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>>
  append(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  update(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void>
  create(title: string, tabs: string[]): Promise<string>
}

export interface OcrDrivePort {
  createFolder(name: string, parentId?: string): Promise<string>
  uploadImage(input: { name: string; parentId: string; mimeType: 'image/jpeg' | 'image/png'; bytes: Buffer }): Promise<string>
  downloadImage(fileId: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
}

export interface GoogleOcrClientConfig {
  googleClientId: string
  googleClientSecret: string
  googleRefreshToken: string
  driveRootId?: string
}

export function createGoogleOcrPorts(config: GoogleOcrClientConfig): { sheets: OcrSheetsPort; drive: OcrDrivePort } {
  const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret)
  auth.setCredentials({ refresh_token: config.googleRefreshToken })
  const sheetsApi = google.sheets({ version: 'v4', auth })
  const driveApi = google.drive({ version: 'v3', auth })
  const appOwnedFolders = new Set(config.driveRootId ? [config.driveRootId] : [])

  async function isInAppOwnedHierarchy(parentIds: string[], visited = new Set<string>()): Promise<boolean> {
    for (const parentId of parentIds) {
      if (appOwnedFolders.has(parentId)) return true
      if (visited.has(parentId)) continue
      visited.add(parentId)
      const parent = await driveApi.files.get({ fileId: parentId, fields: 'parents,trashed' })
      if (!parent.data.trashed && await isInAppOwnedHierarchy(parent.data.parents ?? [], visited)) return true
    }
    return false
  }

  return {
    sheets: {
      async batchGet(spreadsheetId, ranges) {
        const response = await sheetsApi.spreadsheets.values.batchGet({ spreadsheetId, ranges })
        const valueRanges = response.data.valueRanges ?? []
        return Object.fromEntries(ranges.map((range) => {
          const found = valueRanges.find((entry) => sheetName(entry.range ?? '') === sheetName(range))
          return [range, (found?.values ?? []) as unknown[][]]
        }))
      },
      async append(spreadsheetId, range, rows) {
        await sheetsApi.spreadsheets.values.append({
          spreadsheetId, range, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows },
        })
      },
      async update(spreadsheetId, range, rows) {
        await sheetsApi.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: rows } })
      },
      async batchUpdate(spreadsheetId, data) {
        await sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } })
      },
      async create(title, tabs) {
        const response = await sheetsApi.spreadsheets.create({
          requestBody: { properties: { title }, sheets: tabs.map((tab) => ({ properties: { title: tab } })) },
        })
        if (!response.data.spreadsheetId) throw new Error('Google Sheets did not return a spreadsheet ID')
        return response.data.spreadsheetId
      },
    },
    drive: {
      async createFolder(name, parentId) {
        const response = await driveApi.files.create({
          requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) },
          fields: 'id',
        })
        if (!response.data.id) throw new Error('Google Drive did not return a folder ID')
        appOwnedFolders.add(response.data.id)
        return response.data.id
      },
      async uploadImage(input) {
        if (!appOwnedFolders.has(input.parentId)) throw new Error('Image parent is outside the app-owned OCR hierarchy')
        const response = await driveApi.files.create({
          requestBody: { name: input.name, parents: [input.parentId] },
          media: { mimeType: input.mimeType, body: input.bytes },
          fields: 'id',
        })
        if (!response.data.id) throw new Error('Google Drive did not return an image ID')
        return response.data.id
      },
      async downloadImage(fileId) {
        const metadata = await driveApi.files.get({ fileId, fields: 'mimeType,parents,trashed' })
        const mimeType = metadata.data.mimeType
        if (metadata.data.trashed || (mimeType !== 'image/jpeg' && mimeType !== 'image/png')) {
          throw new Error('Unsupported OCR image')
        }
        if (!await isInAppOwnedHierarchy(metadata.data.parents ?? [])) {
          throw new Error('Image is outside the app-owned OCR hierarchy')
        }
        const response = await driveApi.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
        return { bytes: Buffer.from(response.data as ArrayBuffer), mimeType }
      },
    },
  }
}

function sheetName(range: string): string {
  return range.replace(/^'/, '').replace(/'.*$/, '').split('!')[0]
}
