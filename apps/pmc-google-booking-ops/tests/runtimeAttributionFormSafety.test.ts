import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCRIPT_PROPERTY_KEYS } from '../src/config'

const fakes = vi.hoisted(() => ({
  pause: vi.fn(),
  rename: vi.fn(),
  ensureCloser: vi.fn(),
  syncChoices: vi.fn(),
  configureCompact: vi.fn(),
}))

const reservedOnlyStaff = [{
  id: 'NONE',
  name: 'ไม่ระบุ',
  email: 'reserved@example.com',
  lineUserId: 'Ureserved',
  canCloseBooking: true,
  canBeAe: true,
  canManageStock: false,
  canSubmitExpense: false,
  canViewFinance: false,
  canManageExpense: false,
  active: true,
  profileImageUrl: '',
}]

vi.mock('../src/adapters/googleSheets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/googleSheets')>(),
  createGoogleSheetStore: () => ({
    read: (tab: string) => tab === 'CONFIG_STAFF' ? reservedOnlyStaff : [],
    replace: () => undefined,
    append: () => undefined,
    update: () => undefined,
  }),
  createGoogleDashboardPort: () => ({}),
}))

vi.mock('../src/adapters/googleForms', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/googleForms')>(),
  createGoogleFormsPort: () => ({
    bookingCollectsEmail: () => true,
    bookingHasCloserField: () => true,
    bookingHasAeField: () => true,
    pauseBookingResponses: fakes.pause,
    renameAdminFieldToAe: fakes.rename,
    ensureCloserField: fakes.ensureCloser,
    syncBookingChoices: fakes.syncChoices,
    configureCompactIdentityFields: fakes.configureCompact,
  }),
}))

vi.mock('../src/adapters/googleDrive', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/googleDrive')>(),
  createGoogleDrivePort: () => ({}),
  createGoogleBackupPort: () => ({}),
}))

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
  createAppsScriptCryptoPort: () => ({ sha256Hex: () => 'hash' }),
  createGoogleLinePort: () => ({}),
}))

vi.mock('../src/adapters/miniAppRequestState', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/adapters/miniAppRequestState')>(),
  createGoogleMiniAppRequestStatePort: () => ({}),
}))

vi.mock('../src/expense/repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/expense/repository')>(),
  createGoogleExpenseRepository: () => ({}),
}))

import {
  configureCompactBookingIdentityFieldsWorkflow,
  pauseAndCutoverBookingFormWorkflow,
} from '../src/runtime'

beforeEach(() => {
  vi.clearAllMocks()
  const properties = {
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
    [SCRIPT_PROPERTY_KEYS.brandLogoUrl]: 'https://media.example.test/logo.png',
  }
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({ getProperties: () => properties }),
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: () => ({
      getSheetByName: (title: string) => title === 'CALL_QUEUE' ? { getSheetId: () => 1 } : null,
      getUrl: () => 'https://example.test/spreadsheet',
    }),
  })
  vi.stubGlobal('Utilities', {
    formatDate: () => '2026-08-30T10:00:00+07:00',
    getUuid: () => 'uuid-1',
  })
})

describe('Booking Form attribution workflow safety', () => {
  it('does not mutate compact Form fields when the canonical eligible set is empty', () => {
    expect(() => configureCompactBookingIdentityFieldsWorkflow())
      .toThrow('no active booking attribution staff')
    expect(fakes.configureCompact).not.toHaveBeenCalled()
    expect(fakes.pause).not.toHaveBeenCalled()
  })

  it('does not pause, rename, add, or sync Form fields when the canonical eligible set is empty', () => {
    expect(() => pauseAndCutoverBookingFormWorkflow())
      .toThrow('no active booking attribution staff')
    expect(fakes.pause).not.toHaveBeenCalled()
    expect(fakes.rename).not.toHaveBeenCalled()
    expect(fakes.ensureCloser).not.toHaveBeenCalled()
    expect(fakes.syncChoices).not.toHaveBeenCalled()
  })
})
