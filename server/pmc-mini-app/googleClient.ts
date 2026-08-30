import { google } from 'googleapis'

export const MINI_APP_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
] as const
export const MINI_APP_GOOGLE_REQUEST_TIMEOUT_MS = 30_000

interface GoogleResponse<T> { data: T }
type GoogleMethod<T> = (input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<GoogleResponse<T>>

interface MiniAppSheetsApi {
  spreadsheets: {
    get: GoogleMethod<{
      sheets?: Array<{
        properties?: {
          sheetId?: number | null
          title?: string | null
          gridProperties?: { columnCount?: number | null; rowCount?: number | null }
        }
      }>
    }>
    batchUpdate: GoogleMethod<unknown>
    values: {
      batchGet: GoogleMethod<{ valueRanges?: Array<{ range?: string | null; values?: unknown[][] }> }>
      append: GoogleMethod<unknown>
      update: GoogleMethod<unknown>
      batchUpdate: GoogleMethod<unknown>
    }
  }
}

interface MiniAppDriveApi {
  files: {
    create: GoogleMethod<{ id?: string | null }>
    get: GoogleMethod<{
      mimeType?: string | null
      parents?: string[] | null
      trashed?: boolean | null
      size?: string | number | null
      name?: string | null
      appProperties?: Record<string, string> | null
    } | ArrayBuffer>
  }
}

export interface MiniAppGoogleFactory {
  createAuth(scopes: string[]): unknown
  createSheets(auth: unknown): MiniAppSheetsApi
  createDrive(auth: unknown): MiniAppDriveApi
}

export interface MiniAppSheetsPort {
  batchGet(spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>>
  append(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  update(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void>
  getWorkbook(spreadsheetId: string): Promise<Array<{ sheetId: number; title: string; columnCount?: number; rowCount?: number }>>
  applyWorkbookRequests(spreadsheetId: string, requests: Array<Record<string, unknown>>): Promise<void>
}

export type MiniAppEvidenceKind = 'PAYMENT' | 'CHAT'
export type MiniAppEvidenceMime = 'image/jpeg' | 'image/png'

export interface MiniAppDrivePort {
  uploadEvidence(input: {
    parentId: string
    draftId: string
    requestId: string
    kind: MiniAppEvidenceKind
    name: string
    mimeType: MiniAppEvidenceMime
    bytes: Buffer
  }): Promise<string>
  downloadEvidence(fileId: string): Promise<{ bytes: Buffer; mimeType: MiniAppEvidenceMime }>
}

export interface MiniAppGooglePorts {
  authMode: 'ADC_SERVICE_IDENTITY'
  sheets: MiniAppSheetsPort
  drive: MiniAppDrivePort
}

export interface MiniAppGoogleClientConfig {
  spreadsheetId: string
  intakeFolderId: string
}

const realGoogleFactory: MiniAppGoogleFactory = {
  createAuth(scopes) {
    return new google.auth.GoogleAuth({ scopes })
  },
  createSheets(auth) {
    return google.sheets({ version: 'v4', auth: auth as InstanceType<typeof google.auth.GoogleAuth> }) as unknown as MiniAppSheetsApi
  },
  createDrive(auth) {
    return google.drive({ version: 'v3', auth: auth as InstanceType<typeof google.auth.GoogleAuth> }) as unknown as MiniAppDriveApi
  },
}

export function createMiniAppGooglePorts(
  config: MiniAppGoogleClientConfig,
  factory: MiniAppGoogleFactory = realGoogleFactory,
): MiniAppGooglePorts {
  const spreadsheetId = requiredIdentifier(config.spreadsheetId, 'spreadsheet')
  const intakeFolderId = requiredIdentifier(config.intakeFolderId, 'intake folder')
  const auth = factory.createAuth([...MINI_APP_GOOGLE_SCOPES])
  const sheetsApi = factory.createSheets(auth)
  const driveApi = factory.createDrive(auth)

  function assertSpreadsheet(candidate: string): void {
    if (candidate !== spreadsheetId) throw new Error('Spreadsheet is outside the Mini App allowlist')
  }

  async function isInsideIntakeHierarchy(parentIds: string[], visited = new Set<string>()): Promise<boolean> {
    for (const parentId of parentIds) {
      if (parentId === intakeFolderId) return true
      if (!safeIdentifier(parentId) || visited.has(parentId)) continue
      visited.add(parentId)
      const metadata = await driveApi.files.get({ fileId: parentId, fields: 'parents,trashed' })
      if (isDriveMetadata(metadata.data) && !metadata.data.trashed && await isInsideIntakeHierarchy(metadata.data.parents ?? [], visited)) return true
    }
    return false
  }

  return {
    authMode: 'ADC_SERVICE_IDENTITY',
    sheets: {
      async batchGet(candidate, ranges) {
        assertSpreadsheet(candidate)
        ranges.forEach(assertRange)
        const response = await sheetsApi.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges,
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
        })
        const valueRanges = response.data.valueRanges ?? []
        return Object.fromEntries(ranges.map((range) => {
          const match = valueRanges.find((candidate) => sheetRangeMatches(range, candidate.range ?? ''))
          return [range, match?.values ?? []]
        }))
      },
      async append(candidate, range, rows) {
        assertSpreadsheet(candidate)
        assertRange(range)
        await sheetsApi.spreadsheets.values.append({
          spreadsheetId, range, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows },
        }, { timeout: MINI_APP_GOOGLE_REQUEST_TIMEOUT_MS })
      },
      async update(candidate, range, rows) {
        assertSpreadsheet(candidate)
        assertRange(range)
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: rows },
        }, { timeout: MINI_APP_GOOGLE_REQUEST_TIMEOUT_MS })
      },
      async batchUpdate(candidate, data) {
        assertSpreadsheet(candidate)
        data.forEach(({ range }) => assertRange(range))
        await sheetsApi.spreadsheets.values.batchUpdate({
          spreadsheetId, requestBody: { valueInputOption: 'RAW', data },
        }, { timeout: MINI_APP_GOOGLE_REQUEST_TIMEOUT_MS })
      },
      async getWorkbook(candidate) {
        assertSpreadsheet(candidate)
        const response = await sheetsApi.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties(sheetId,title,gridProperties(columnCount,rowCount))',
        })
        return (response.data.sheets ?? []).flatMap(({ properties }) => {
          const sheetId = properties?.sheetId
          const title = properties?.title
          const columnCount = properties?.gridProperties?.columnCount
          const rowCount = properties?.gridProperties?.rowCount
          return typeof sheetId === 'number' && typeof title === 'string'
            ? [{
                sheetId,
                title,
                ...(typeof columnCount === 'number' ? { columnCount } : {}),
                ...(typeof rowCount === 'number' ? { rowCount } : {}),
              }]
            : []
        })
      },
      async applyWorkbookRequests(candidate, requests) {
        assertSpreadsheet(candidate)
        await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, { timeout: MINI_APP_GOOGLE_REQUEST_TIMEOUT_MS })
      },
    },
    drive: {
      async uploadEvidence(input) {
        if (input.parentId !== intakeFolderId) throw new Error('Drive parent is outside the Mini App allowlist')
        const draftId = requiredAppProperty(input.draftId, 'draft ID')
        const requestId = requiredAppProperty(input.requestId, 'request ID')
        if (!safeServerName(input.name)) throw new Error('Invalid evidence file name')
        if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new Error('Invalid evidence bytes')
        if (input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/png') throw new Error('Unsupported evidence MIME type')
        const response = await driveApi.files.create({
          requestBody: {
            name: input.name,
            parents: [intakeFolderId],
            appProperties: {
              pmcMiniAppDraftId: draftId,
              pmcMiniAppRequestId: requestId,
              evidenceKind: input.kind,
            },
          },
          media: { mimeType: input.mimeType, body: input.bytes },
          fields: 'id',
        })
        if (!response.data.id) throw new Error('Google Drive did not return an evidence file ID')
        return response.data.id
      },
      async downloadEvidence(fileId) {
        const safeFileId = requiredIdentifier(fileId, 'evidence file')
        const metadataResponse = await driveApi.files.get({ fileId: safeFileId, fields: 'mimeType,parents,trashed' })
        if (!isDriveMetadata(metadataResponse.data) || metadataResponse.data.trashed) throw new Error('Unsupported Mini App evidence')
        const mimeType = metadataResponse.data.mimeType
        if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') throw new Error('Unsupported Mini App evidence')
        if (!await isInsideIntakeHierarchy(metadataResponse.data.parents ?? [])) throw new Error('Drive file is outside the Mini App allowlist')
        const response = await driveApi.files.get({ fileId: safeFileId, alt: 'media' }, { responseType: 'arraybuffer' })
        if (!(response.data instanceof ArrayBuffer)) throw new Error('Google Drive returned invalid evidence bytes')
        return { bytes: Buffer.from(response.data), mimeType }
      },
    },
  }
}

function requiredIdentifier(value: string, label: string): string {
  const trimmed = value.trim()
  if (!safeIdentifier(trimmed)) throw new Error(`Invalid Mini App ${label} ID`)
  return trimmed
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value)
}

function requiredAppProperty(value: string, label: string): string {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,124}$/.test(trimmed)) throw new Error(`Invalid Mini App ${label}`)
  return trimmed
}

function safeServerName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(value)
}

function assertRange(range: string): void {
  if (!range || range.length > 512 || /[\r\n]/.test(range)) throw new Error('Invalid Mini App Sheet range')
}

function normalizeA1(range: string): string {
  return range.replaceAll("'", '').replaceAll('$', '').toUpperCase()
}

function sheetRangeMatches(requested: string, returned: string): boolean {
  const expected = normalizeA1(requested)
  const actual = normalizeA1(returned)
  if (expected === actual) return true
  const expectedRow = /^([^!]+)!(\d+):(\d+)$/.exec(expected)
  const boundedActual = /^([^!]+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(actual)
  if (expectedRow && boundedActual) {
    const [, expectedSheet, expectedStartRow, expectedEndRow] = expectedRow
    const [, actualSheet, , actualStartRow, , actualEndRow] = boundedActual
    return expectedSheet === actualSheet && expectedStartRow === actualStartRow && expectedEndRow === actualEndRow
  }
  const expectedParts = /^([^!]+)!([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(expected)
  const actualParts = /^([^!]+)!([A-Z]+)(\d*):([A-Z]+)(\d*)$/.exec(actual)
  if (!expectedParts || !actualParts) return false
  const [, expectedSheet, expectedStartColumn, expectedStartRow, expectedEndColumn, expectedEndRow] = expectedParts
  const [, actualSheet, actualStartColumn, actualStartRow, actualEndColumn, actualEndRow] = actualParts
  const startMatches = expectedStartRow ? expectedStartRow === actualStartRow : actualStartRow === '1'
  const endMatches = expectedEndRow
    ? /^\d+$/.test(actualEndRow) && Number(actualEndRow) >= Number(actualStartRow) && Number(actualEndRow) <= Number(expectedEndRow)
    : /^\d+$/.test(actualEndRow)
  return expectedSheet === actualSheet
    && expectedStartColumn === actualStartColumn
    && expectedEndColumn === actualEndColumn
    && startMatches
    && endMatches
}

function isDriveMetadata(value: unknown): value is {
  mimeType?: string | null
  parents?: string[] | null
  trashed?: boolean | null
} {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
