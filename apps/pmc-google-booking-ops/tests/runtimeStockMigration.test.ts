import { describe, expect, it, vi } from 'vitest'
import { SCRIPT_PROPERTY_KEYS } from '../src/config'
import { migrateConfigStaffProfileColumn } from '../src/adapters/googleSheets'
import { SHEET_SCHEMAS, STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'

const fakes = vi.hoisted(() => ({
  spreadsheet: null as unknown as FakeSpreadsheet,
  properties: {} as Record<string, string>,
  responseStates: [] as boolean[],
  backups: 0,
  approvalDeletes: 0,
}))

vi.mock('../src/adapters/googleSheets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/adapters/googleSheets')>()
  return {
    ...actual,
    createGoogleSheetStore: () => ({ read: () => [], replace: () => undefined }),
    createGoogleDashboardPort: () => ({ write: () => undefined }),
  }
})

vi.mock('../src/adapters/googleForms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/adapters/googleForms')>()
  return {
    ...actual,
    createGoogleFormsPort: () => ({
      bookingCollectsEmail: () => true,
      pauseBookingResponses: () => fakes.responseStates.push(false),
      ensureFacebookNameField: () => undefined,
      bookingHasFacebookNameField: () => true,
      resumeBookingResponses: () => fakes.responseStates.push(true),
    }),
  }
})

vi.mock('../src/adapters/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/adapters/googleDrive')>()
  return {
    ...actual,
    createGoogleDrivePort: () => ({}),
    createGoogleBackupPort: () => ({}),
  }
})

vi.mock('../src/adapters/googleFiles', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/googleFiles')>(),
  createGoogleFilePort: () => ({}),
}))

vi.mock('../src/adapters/googleCalendar', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/googleCalendar')>(),
  createGoogleCalendarPort: () => ({}),
}))

vi.mock('../src/adapters/evidenceMedia', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/evidenceMedia')>(),
  createEvidenceMediaPort: () => ({}),
}))

vi.mock('../src/adapters/lineMessaging', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/lineMessaging')>(),
  createAppsScriptCryptoPort: () => ({}),
  createGoogleLinePort: () => ({}),
}))

import {
  applyAutoQueueMigrationWorkflow,
  configureFacebookNameFieldWorkflow,
} from '../src/runtime'

class FakeSheet {
  constructor(readonly headers: string[]) {}

  getLastColumn(): number { return this.headers.length }
  getLastRow(): number { return 1 }
  getSheetId(): number { return 1 }

  getRange(_row: number, column: number, _rows = 1, columns = this.headers.length): {
    getValues: () => unknown[][]
    setValues: (values: unknown[][]) => void
    setValue: (value: unknown) => void
  } {
    return {
      getValues: () => [[...this.headers.slice(column - 1, column - 1 + columns)]],
      setValues: (values) => this.headers.splice(column - 1, values[0]?.length ?? 0, ...(values[0] ?? []).map(String)),
      setValue: (value) => { this.headers[column - 1] = String(value) },
    }
  }

  insertColumnsAfter(column: number, count: number): void {
    this.headers.splice(column, 0, ...Array<string>(count).fill(''))
  }
}

class FakeSpreadsheet {
  readonly sheets = new Map<string, FakeSheet>()

  constructor() {
    for (const [title, headers] of Object.entries(SHEET_SCHEMAS)) {
      this.sheets.set(title, new FakeSheet([...headers]))
    }
    this.sheets.set('CONFIG_STAFF', new FakeSheet(STAFF_CONFIG_COLUMNS.filter((header) => header !== 'canManageStock')))
  }

  getSheetByName(title: string): FakeSheet | null { return this.sheets.get(title) ?? null }
  getUrl(): string { return 'https://example.test/spreadsheet' }
}

function installFakes(): FakeSpreadsheet {
  fakes.spreadsheet = new FakeSpreadsheet()
  fakes.responseStates = []
  fakes.backups = 0
  fakes.approvalDeletes = 0
  fakes.properties = {
    [SCRIPT_PROPERTY_KEYS.spreadsheetId]: 'spreadsheet-1',
    [SCRIPT_PROPERTY_KEYS.bookingFormId]: 'booking-form-1',
    [SCRIPT_PROPERTY_KEYS.callResultFormId]: 'call-form-1',
    [SCRIPT_PROPERTY_KEYS.driveRootId]: 'drive-root-1',
    [SCRIPT_PROPERTY_KEYS.jeraIncomingFolderId]: 'jera-folder-1',
    [SCRIPT_PROPERTY_KEYS.backupFolderId]: 'backup-folder-1',
    [SCRIPT_PROPERTY_KEYS.adminLineGroupId]: 'admin-group-1',
    [SCRIPT_PROPERTY_KEYS.lineAccessToken]: 'line-token',
    [SCRIPT_PROPERTY_KEYS.bookingIngressSecret]: 'ingress-secret',
    [SCRIPT_PROPERTY_KEYS.mediaBaseUrl]: 'https://media.example.test/evidence',
    [SCRIPT_PROPERTY_KEYS.mediaSigningSecret]: 'media-secret',
    [SCRIPT_PROPERTY_KEYS.brandLogoUrl]: 'https://media.example.test/assets/pmc-flex-logo-v1.png',
    [SCRIPT_PROPERTY_KEYS.autoQueueMigrationApproval]: 'true',
  }
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperties: () => fakes.properties,
      deleteProperty: () => { fakes.approvalDeletes += 1 },
    }),
  })
  vi.stubGlobal('SpreadsheetApp', { openById: () => fakes.spreadsheet })
  vi.stubGlobal('DriveApp', {
    getFileById: () => ({ makeCopy: () => { fakes.backups += 1 } }),
    getFolderById: () => ({}),
  })
  vi.stubGlobal('Utilities', { formatDate: () => '2026-08-28_13-00-00' })
  return fakes.spreadsheet
}

describe('Stock-role CONFIG_STAFF migration in side-effecting workflows', () => {
  it('converges a legacy eight-column CONFIG_STAFF header once and stays canonical on repeat', () => {
    const spreadsheet = installFakes()

    migrateConfigStaffProfileColumn(spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet)
    migrateConfigStaffProfileColumn(spreadsheet as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet)

    expect(spreadsheet.getSheetByName('CONFIG_STAFF')?.headers).toEqual(STAFF_CONFIG_COLUMNS)
  })

  it('resumes the Facebook-name workflow after converging an old eight-column CONFIG_STAFF header', () => {
    const spreadsheet = installFakes()

    expect(configureFacebookNameFieldWorkflow()).toMatchObject({ acceptingResponses: true })
    expect(configureFacebookNameFieldWorkflow()).toMatchObject({ acceptingResponses: true })
    expect(spreadsheet.getSheetByName('CONFIG_STAFF')?.headers).toEqual(STAFF_CONFIG_COLUMNS)
    expect(fakes.responseStates).toEqual([false, true, false, true])
  })

  it('converges the old CONFIG_STAFF header before the approved auto-queue migration writes', () => {
    const spreadsheet = installFakes()

    expect(applyAutoQueueMigrationWorkflow()).toMatchObject({ migratedRows: 0, preservedReferences: true })
    expect(spreadsheet.getSheetByName('CONFIG_STAFF')?.headers).toEqual(STAFF_CONFIG_COLUMNS)
    expect(fakes.approvalDeletes).toBe(1)
    expect(fakes.backups).toBe(1)
  })
})
