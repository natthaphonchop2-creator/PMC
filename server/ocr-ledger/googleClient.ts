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
  clear(spreadsheetId: string, range: string): Promise<void>
  create(title: string, tabs: string[]): Promise<string>
}

export interface OcrDrivePort {
  createFolder(name: string, parentId?: string): Promise<string>
  findFolder(name: string, parentId: string): Promise<string | null>
  moveFile(fileId: string, parentId: string): Promise<void>
  moveSpreadsheet(fileId: string, parentId: string): Promise<void>
  findImageByDocumentId(documentId: string, parentId: string): Promise<{ fileId: string; name: string; mimeType: 'image/jpeg' | 'image/png' } | null>
  uploadImage(input: { documentId: string; name: string; parentId: string; mimeType: 'image/jpeg' | 'image/png'; bytes: Buffer }): Promise<string>
  downloadImage(fileId: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
}

export interface GoogleOcrClientConfig {
  googleClientId: string
  googleClientSecret: string
  googleRefreshToken: string
  driveRootId?: string
  monthlyLedgersFolderId?: string
}

export function createGoogleOcrPorts(config: GoogleOcrClientConfig): { sheets: OcrSheetsPort; drive: OcrDrivePort } {
  const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret)
  auth.setCredentials({ refresh_token: config.googleRefreshToken })
  const sheetsApi = google.sheets({ version: 'v4', auth })
  const driveApi = google.drive({ version: 'v3', auth })
  const appOwnedFolders = new Set([config.driveRootId, config.monthlyLedgersFolderId].filter((value): value is string => Boolean(value)))

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
      async clear(spreadsheetId, range) {
        await sheetsApi.spreadsheets.values.clear({ spreadsheetId, range })
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
        if (parentId && !appOwnedFolders.has(parentId)) throw new Error('Folder parent is outside the app-owned OCR hierarchy')
        const response = await driveApi.files.create({
          requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) },
          fields: 'id',
        })
        if (!response.data.id) throw new Error('Google Drive did not return a folder ID')
        appOwnedFolders.add(response.data.id)
        return response.data.id
      },
      async findFolder(name, parentId) {
        if (!appOwnedFolders.has(parentId)) throw new Error('Folder parent is outside the app-owned OCR hierarchy')
        const response = await driveApi.files.list({
          q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id)', pageSize: 10,
        })
        const id = (response.data.files ?? []).flatMap((file) => file.id ? [file.id] : []).sort()[0] ?? null
        if (id) appOwnedFolders.add(id)
        return id
      },
      async moveFile(fileId, parentId) {
        if (!appOwnedFolders.has(parentId)) throw new Error('File destination is outside the app-owned OCR hierarchy')
        const metadata = await driveApi.files.get({ fileId, fields: 'parents,trashed' })
        if (metadata.data.trashed || !await isInAppOwnedHierarchy(metadata.data.parents ?? [])) {
          throw new Error('Image is outside the app-owned OCR hierarchy')
        }
        if ((metadata.data.parents ?? []).includes(parentId)) return
        await driveApi.files.update({
          fileId, addParents: parentId, removeParents: (metadata.data.parents ?? []).join(','), fields: 'id,parents',
        })
      },
      async moveSpreadsheet(fileId, parentId) {
        if (!appOwnedFolders.has(parentId)) throw new Error('Spreadsheet destination is outside the app-owned OCR hierarchy')
        const metadata = await driveApi.files.get({ fileId, fields: 'mimeType,parents,trashed' })
        if (metadata.data.trashed || metadata.data.mimeType !== 'application/vnd.google-apps.spreadsheet') {
          throw new Error('Unsupported OCR spreadsheet')
        }
        if ((metadata.data.parents ?? []).includes(parentId)) return
        await driveApi.files.update({
          fileId, addParents: parentId, removeParents: (metadata.data.parents ?? []).join(','), fields: 'id,parents',
        })
      },
      async findImageByDocumentId(documentId, parentId) {
        if (!/^OCR-\d{8}-[0-9a-f]{12}$/.test(documentId)) throw new Error('Invalid OCR document ID')
        if (!appOwnedFolders.has(parentId)) throw new Error('Image parent is outside the app-owned OCR hierarchy')
        const response = await driveApi.files.list({
          q: `'${escapeDriveQuery(parentId)}' in parents and appProperties has { key='ocrDocumentId' and value='${escapeDriveQuery(documentId)}' } and trashed = false`,
          fields: 'files(id,name,mimeType)', pageSize: 10,
        })
        const matches: Array<{ fileId: string; name: string; mimeType: 'image/jpeg' | 'image/png' }> = []
        for (const file of response.data.files ?? []) {
          const mimeType = file.mimeType
          if (!file.id || !file.name || (mimeType !== 'image/jpeg' && mimeType !== 'image/png')) continue
          matches.push({ fileId: file.id, name: file.name, mimeType })
        }
        matches.sort((left, right) => left.fileId.localeCompare(right.fileId))
        return matches[0] ?? null
      },
      async uploadImage(input) {
        if (!/^OCR-\d{8}-[0-9a-f]{12}$/.test(input.documentId)) throw new Error('Invalid OCR document ID')
        if (!appOwnedFolders.has(input.parentId)) throw new Error('Image parent is outside the app-owned OCR hierarchy')
        const response = await driveApi.files.create({
          requestBody: { name: input.name, parents: [input.parentId], appProperties: { ocrDocumentId: input.documentId } },
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

function escapeDriveQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
