import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCRIPT_PROPERTY_KEYS } from '../src/config'
import {
  EXPENSE_ATTACHMENT_HEADERS,
  EXPENSE_AUDIT_HEADERS,
  EXPENSE_MASTER_SCHEMAS,
  EXPENSE_MONTHLY_INDEX_HEADERS,
  EXPENSE_MONTH_SCHEMAS,
  EXPENSE_REQUEST_HEADERS,
  EXPENSE_SUBMISSION_HEADERS,
  MONTHLY_SUMMARY_HEADERS,
} from '../src/expense/sheetTopology'
import {
  applyExpensePermissionGrants,
  bootstrapExpenseMonth,
  ensureExpenseMonthTopology,
  ensureFinanceMasterTopology,
  prepareExpensePermissionRoster,
  type ExpenseTopologyPort,
} from '../src/expense/setup'
import {
  applyExpensePermissionsWorkflow,
  prepareExpensePermissionsWorkflow,
  setupExpenseFinanceStorageWorkflow,
  validateRuntimeProperties,
} from '../src/runtime'
import { STAFF_CONFIG_COLUMNS } from '../src/sheetSchema'

class MemoryExpenseTopology implements ExpenseTopologyPort {
  readonly sheets = new Map<string, { headers: string[]; frozenRows: number }>()
  readonly created: string[] = []

  constructor(initial: Record<string, readonly string[]> = {}) {
    for (const [tab, headers] of Object.entries(initial)) {
      this.sheets.set(tab, { headers: [...headers], frozenRows: 0 })
    }
  }

  readHeader(tab: string): string[] | null {
    const sheet = this.sheets.get(tab)
    return sheet ? [...sheet.headers] : null
  }

  createTab(tab: string, headers: readonly string[]): void {
    if (this.sheets.has(tab)) throw new Error('duplicate tab')
    this.created.push(tab)
    this.sheets.set(tab, { headers: [...headers], frozenRows: 0 })
  }

  freezeHeader(tab: string): void {
    const sheet = this.sheets.get(tab)
    if (!sheet) throw new Error('missing tab')
    sheet.frozenRows = 1
  }
}

class FakeSheet {
  frozenRows = 0
  readonly writes: Array<{ row: number; column: number; rows: number; columns: number }> = []

  constructor(
    readonly data: unknown[][],
    private readonly failure?: {
      operation: 'read' | 'write' | 'freeze'
      sentinel: string
      row?: number
      column?: number
    },
  ) {}

  getLastColumn(): number { return this.data[0]?.length ?? 0 }
  getLastRow(): number { return this.data.length }

  getRange(row: number, column: number, rows = 1, columns = 1) {
    return {
      getValues: () => {
        this.throwIfConfigured('read', row, column)
        return Array.from({ length: rows }, (_, rowOffset) => (
          Array.from({ length: columns }, (_, columnOffset) => (
            this.data[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
          ))
        ))
      },
      setValues: (values: unknown[][]) => {
        this.throwIfConfigured('write', row, column)
        this.writes.push({ row, column, rows, columns })
        for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
          const target = this.data[row - 1 + rowOffset] ?? []
          this.data[row - 1 + rowOffset] = target
          for (let columnOffset = 0; columnOffset < columns; columnOffset += 1) {
            target[column - 1 + columnOffset] = values[rowOffset]?.[columnOffset] ?? ''
          }
        }
      },
    }
  }

  setFrozenRows(rows: number): void {
    this.throwIfConfigured('freeze')
    this.frozenRows = rows
  }

  private throwIfConfigured(operation: 'read' | 'write' | 'freeze', row?: number, column?: number): void {
    if (
      this.failure?.operation === operation
      && (this.failure.row === undefined || this.failure.row === row)
      && (this.failure.column === undefined || this.failure.column === column)
    ) {
      throw new Error(`external service leaked ${this.failure.sentinel}`)
    }
  }
}

class FakeSpreadsheet {
  readonly sheets = new Map<string, FakeSheet>()
  readonly inserted: string[] = []

  getSheetByName(tab: string): FakeSheet | null { return this.sheets.get(tab) ?? null }

  constructor(
    private readonly insertFailure?: { sentinel: string },
    private readonly insertedSheetFailure?: ConstructorParameters<typeof FakeSheet>[1],
  ) {}

  insertSheet(tab: string): FakeSheet {
    if (this.insertFailure) throw new Error(`external service leaked ${this.insertFailure.sentinel}`)
    this.inserted.push(tab)
    const sheet = new FakeSheet([], this.insertedSheetFailure)
    this.sheets.set(tab, sheet)
    return sheet
  }
}

function staffRows(): unknown[][] {
  return [
    [...STAFF_CONFIG_COLUMNS],
    ['OWNER_01', 'Owner', 'owner@example.test', 'U-owner', true, false, true, '', false, false, false, false],
    ['DOCTOR_01', 'Doctor', 'doctor@example.test', 'U-doctor', false, false, true, '', false, false, false, false],
    ['ADMIN_09', 'Mus', 'mus@example.test', 'U-mus', true, true, true, '', false, false, false, false],
    ['STAFF_01', 'Staff', 'staff@example.test', 'U-staff', true, true, true, '', false, 'true', 1, 'TRUE'],
  ]
}

function installAppsScriptFakes(options: {
  cutoverApproved?: string
  masterParentId?: string
  folderSharing?: string
  resourceLookupFails?: boolean
  externalFailureAt?:
    | 'open-booking'
    | 'open-finance'
    | 'staff-header-read'
    | 'permission-write'
    | 'permission-readback'
    | 'topology-header-read'
    | 'topology-create'
    | 'topology-header-write'
    | 'topology-freeze'
  externalSentinel?: string
  financeHeaderMismatch?: boolean
  managerIds?: string
} = {}) {
  const sentinel = options.externalSentinel ?? 'SENSITIVE-CONFIGURED-ID'
  const booking = new FakeSpreadsheet()
  booking.sheets.set('CONFIG_STAFF', new FakeSheet(staffRows(),
    options.externalFailureAt === 'staff-header-read'
      ? { operation: 'read', row: 1, column: 1, sentinel }
      : options.externalFailureAt === 'permission-write'
        ? { operation: 'write', row: 2, column: 10, sentinel }
        : options.externalFailureAt === 'permission-readback'
          ? { operation: 'read', row: 2, column: 10, sentinel }
          : undefined))
  const finance = new FakeSpreadsheet(
    options.externalFailureAt === 'topology-create' ? { sentinel } : undefined,
    options.externalFailureAt === 'topology-header-write'
      ? { operation: 'write', row: 1, column: 1, sentinel }
      : undefined,
  )
  finance.sheets.set('EXPENSE_MONTHLY_INDEX', new FakeSheet([[
    ...EXPENSE_MONTHLY_INDEX_HEADERS,
    ...(options.financeHeaderMismatch ? ['unexpected'] : []),
  ]], options.externalFailureAt === 'topology-header-read'
    ? { operation: 'read', row: 1, column: 1, sentinel }
    : options.externalFailureAt === 'topology-freeze'
      ? { operation: 'freeze', sentinel }
      : undefined))
  const properties = {
    [SCRIPT_PROPERTY_KEYS.spreadsheetId]: 'booking-sheet',
    [SCRIPT_PROPERTY_KEYS.financeMasterSpreadsheetId]: 'finance-master',
    [SCRIPT_PROPERTY_KEYS.financeFolderId]: 'finance-folder',
    [SCRIPT_PROPERTY_KEYS.expenseSubmitterIds]: 'OWNER_01,DOCTOR_01,ADMIN_09,STAFF_01',
    [SCRIPT_PROPERTY_KEYS.financeManagerIds]: options.managerIds ?? 'OWNER_01,DOCTOR_01,ADMIN_09',
    [SCRIPT_PROPERTY_KEYS.financePermissionCutoverApproved]: options.cutoverApproved ?? 'true',
  }
  let lockHeld = false
  let waitCount = 0
  let releaseCount = 0
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperties: () => properties,
    }),
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => {
      if (
        (id === 'booking-sheet' && options.externalFailureAt === 'open-booking')
        || (id === 'finance-master' && options.externalFailureAt === 'open-finance')
      ) {
        throw new Error(`external service leaked ${sentinel}`)
      }
      return id === 'booking-sheet' ? booking : finance
    },
  })
  vi.stubGlobal('LockService', {
    getScriptLock: () => ({
      waitLock: () => { waitCount += 1; lockHeld = true },
      releaseLock: () => { releaseCount += 1; lockHeld = false },
    }),
  })
  vi.stubGlobal('DriveApp', {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: () => {
      if (options.resourceLookupFails) throw new Error('missing finance-folder')
      return {
        isTrashed: () => false,
        getSharingAccess: () => options.folderSharing ?? 'PRIVATE',
      }
    },
    getFileById: () => ({
      isTrashed: () => false,
      getSharingAccess: () => 'PRIVATE',
      getParents: () => {
        const parents = [{ getId: () => options.masterParentId ?? 'finance-folder' }]
        return {
          hasNext: () => parents.length > 0,
          next: () => parents.shift(),
        }
      },
    }),
  })
  return {
    booking,
    finance,
    sentinel,
    lockState: () => ({ lockHeld, waitCount, releaseCount }),
  }
}

function captureError(operation: () => unknown): Error {
  try {
    operation()
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('expected operation to throw')
}

function expectSafeExternalError(
  operation: () => unknown,
  safeCode: string,
  sentinel: string,
): void {
  const error = captureError(operation)
  expect(error.message).toBe(safeCode)
  expect(String(error)).not.toContain(sentinel)
  expect(String(error.stack)).not.toContain(sentinel)
  expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const staff = [
  {
    id: 'OWNER_01', name: 'Owner', active: true,
    canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  },
  {
    id: 'DOCTOR_01', name: 'Doctor', active: true,
    canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  },
  {
    id: 'ADMIN_09', name: 'Mus', active: true,
    canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  },
  {
    id: 'STAFF_01', name: 'Staff', active: true,
    canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  },
] as const

describe('expense finance setup', () => {
  it('keeps finance properties optional for the Booking-wide runtime', () => {
    expect(SCRIPT_PROPERTY_KEYS).toMatchObject({
      financeMasterSpreadsheetId: 'PMC_FINANCE_MASTER_SPREADSHEET_ID',
      financeFolderId: 'PMC_FINANCE_FOLDER_ID',
      expenseIngressSecret: 'PMC_EXPENSE_INGRESS_SECRET',
      expenseSubmitterIds: 'PMC_EXPENSE_SUBMITTER_IDS',
      financeManagerIds: 'PMC_FINANCE_MANAGER_IDS',
      financePermissionCutoverApproved: 'PMC_FINANCE_PERMISSION_CUTOVER_APPROVED',
    })
    expect(() => validateRuntimeProperties({
      [SCRIPT_PROPERTY_KEYS.spreadsheetId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.bookingFormId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.callResultFormId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.driveRootId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.jeraIncomingFolderId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.backupFolderId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.adminLineGroupId]: 'configured',
      [SCRIPT_PROPERTY_KEYS.lineAccessToken]: 'configured',
      [SCRIPT_PROPERTY_KEYS.bookingIngressSecret]: 'configured',
      [SCRIPT_PROPERTY_KEYS.mediaBaseUrl]: 'configured',
      [SCRIPT_PROPERTY_KEYS.mediaSigningSecret]: 'configured',
      [SCRIPT_PROPERTY_KEYS.brandLogoUrl]: 'configured',
    })).not.toThrow()
  })

  it('uses only the approved private finance tabs and exact headers', () => {
    expect(EXPENSE_MASTER_SCHEMAS).toEqual({
      EXPENSE_MONTHLY_INDEX: EXPENSE_MONTHLY_INDEX_HEADERS,
      EXPENSE_REQUESTS: EXPENSE_REQUEST_HEADERS,
      EXPENSE_AUDIT: EXPENSE_AUDIT_HEADERS,
    })
    expect(EXPENSE_MONTH_SCHEMAS).toEqual({
      EXPENSE_SUBMISSIONS: EXPENSE_SUBMISSION_HEADERS,
      EXPENSE_ATTACHMENTS: EXPENSE_ATTACHMENT_HEADERS,
      MONTHLY_SUMMARY: MONTHLY_SUMMARY_HEADERS,
    })
  })

  it('creates only missing master tabs and freezes every managed header', () => {
    const topology = new MemoryExpenseTopology({
      EXPENSE_MONTHLY_INDEX: EXPENSE_MONTHLY_INDEX_HEADERS,
    })

    expect(ensureFinanceMasterTopology(topology)).toEqual({
      createdTabCount: 2,
      verifiedTabCount: 3,
    })
    expect(topology.created).toEqual(['EXPENSE_REQUESTS', 'EXPENSE_AUDIT'])
    expect([...topology.sheets.values()].map((sheet) => sheet.frozenRows)).toEqual([1, 1, 1])
  })

  it('rejects an existing managed tab with a non-exact header before creating another tab', () => {
    const topology = new MemoryExpenseTopology({
      EXPENSE_MONTHLY_INDEX: [...EXPENSE_MONTHLY_INDEX_HEADERS, 'unexpected'],
    })

    expect(() => ensureFinanceMasterTopology(topology)).toThrow(
      'sheet header mismatch: EXPENSE_MONTHLY_INDEX',
    )
    expect(topology.created).toEqual([])
  })

  it('validates every existing managed header before creating any missing tab', () => {
    const topology = new MemoryExpenseTopology({
      EXPENSE_REQUESTS: [...EXPENSE_REQUEST_HEADERS.slice(0, -1)],
    })

    expect(() => ensureFinanceMasterTopology(topology)).toThrow(
      'sheet header mismatch: EXPENSE_REQUESTS',
    )
    expect(topology.created).toEqual([])
  })

  it('creates and verifies the exact monthly-ledger topology', () => {
    const topology = new MemoryExpenseTopology()

    expect(ensureExpenseMonthTopology(topology)).toEqual({
      createdTabCount: 3,
      verifiedTabCount: 3,
    })
    expect(topology.created).toEqual([
      'EXPENSE_SUBMISSIONS',
      'EXPENSE_ATTACHMENTS',
      'MONTHLY_SUMMARY',
    ])
  })

  it('returns only immutable IDs, names, active state, and fail-closed finance flags', () => {
    expect(prepareExpensePermissionRoster([{
      id: 'ADMIN_01',
      name: 'มัส',
      email: 'secret@example.com',
      lineUserId: 'U-secret',
      active: true,
      canSubmitExpense: 'true',
      canViewFinance: 1,
      canManageExpense: true,
    }])).toEqual([{
      id: 'ADMIN_01',
      name: 'มัส',
      active: true,
      canSubmitExpense: false,
      canViewFinance: false,
      canManageExpense: true,
    }])
  })

  it('plans exact finance-column grants for active submitters and three managers', () => {
    expect(applyExpensePermissionGrants(
      staff,
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09', 'STAFF_01'],
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09'],
    )).toEqual({
      submitterCount: 4,
      managerCount: 3,
      changedRows: 4,
      grants: [
        { id: 'OWNER_01', canSubmitExpense: true, canViewFinance: true, canManageExpense: true },
        { id: 'DOCTOR_01', canSubmitExpense: true, canViewFinance: true, canManageExpense: true },
        { id: 'ADMIN_09', canSubmitExpense: true, canViewFinance: true, canManageExpense: true },
        { id: 'STAFF_01', canSubmitExpense: true, canViewFinance: false, canManageExpense: false },
      ],
    })
  })

  it.each([
    ['duplicate submitter IDs', ['OWNER_01', 'OWNER_01', 'DOCTOR_01', 'ADMIN_09'], ['OWNER_01', 'DOCTOR_01', 'ADMIN_09']],
    ['unsafe manager ID', ['OWNER_01', 'DOCTOR_01', 'ADMIN 09'], ['OWNER_01', 'DOCTOR_01', 'ADMIN 09']],
    ['not exactly three managers', ['OWNER_01', 'DOCTOR_01'], ['OWNER_01', 'DOCTOR_01']],
    ['manager outside submitters', ['OWNER_01', 'DOCTOR_01', 'STAFF_01'], ['OWNER_01', 'DOCTOR_01', 'ADMIN_09']],
  ])('rejects %s', (_label, submitterIds, managerIds) => {
    expect(() => applyExpensePermissionGrants(staff, submitterIds, managerIds)).toThrow(
      'invalid expense permission configuration',
    )
  })

  it('rejects inactive or duplicate configured staff targets', () => {
    const inactive = staff.map((item) => (
      item.id === 'ADMIN_09' ? { ...item, active: false } : item
    ))
    expect(() => applyExpensePermissionGrants(
      inactive,
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09'],
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09'],
    )).toThrow('invalid expense permission configuration')

    expect(() => applyExpensePermissionGrants(
      [...staff, { ...staff[0] }],
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09'],
      ['OWNER_01', 'DOCTOR_01', 'ADMIN_09'],
    )).toThrow('invalid expense permission configuration')
  })

  it('prepares a safe roster through the canonical CONFIG_STAFF parser', () => {
    installAppsScriptFakes()

    expect(prepareExpensePermissionsWorkflow()).toEqual([
      { id: 'OWNER_01', name: 'Owner', active: true, canSubmitExpense: false, canViewFinance: false, canManageExpense: false },
      { id: 'DOCTOR_01', name: 'Doctor', active: true, canSubmitExpense: false, canViewFinance: false, canManageExpense: false },
      { id: 'ADMIN_09', name: 'Mus', active: true, canSubmitExpense: false, canViewFinance: false, canManageExpense: false },
      { id: 'STAFF_01', name: 'Staff', active: true, canSubmitExpense: false, canViewFinance: false, canManageExpense: false },
    ])
  })

  it('refuses permission writes unless the explicit cutover property is exactly true', () => {
    const appsScript = installAppsScriptFakes({ cutoverApproved: 'TRUE' })

    expect(() => applyExpensePermissionsWorkflow()).toThrow(
      'expense permission cutover is not approved',
    )
    expect(appsScript.booking.getSheetByName('CONFIG_STAFF')?.writes).toEqual([])
    expect(appsScript.lockState()).toEqual({ lockHeld: false, waitCount: 0, releaseCount: 0 })
  })

  it('writes only the three finance columns under LockService and verifies exact readback', () => {
    const appsScript = installAppsScriptFakes()

    expect(applyExpensePermissionsWorkflow()).toEqual({
      submitterCount: 4,
      managerCount: 3,
      changedRows: 4,
    })
    expect(appsScript.booking.getSheetByName('CONFIG_STAFF')?.writes).toEqual([
      { row: 2, column: 10, rows: 4, columns: 3 },
    ])
    expect(appsScript.booking.getSheetByName('CONFIG_STAFF')?.data.slice(1).map((row) => row.slice(9, 12))).toEqual([
      [true, true, true],
      [true, true, true],
      [true, true, true],
      [true, false, false],
    ])
    expect(appsScript.lockState()).toEqual({ lockHeld: false, waitCount: 1, releaseCount: 1 })
  })

  it('verifies the finance master parent and returns only safe topology counts', () => {
    const appsScript = installAppsScriptFakes()
    const log = vi.spyOn(console, 'log')

    expect(setupExpenseFinanceStorageWorkflow()).toEqual({
      masterReady: true,
      createdTabCount: 2,
      verifiedTabCount: 3,
    })
    expect(appsScript.finance.inserted).toEqual(['EXPENSE_REQUESTS', 'EXPENSE_AUDIT'])
    expect([...appsScript.finance.sheets.values()].map((sheet) => sheet.frozenRows)).toEqual([1, 1, 1])
    expect(log).not.toHaveBeenCalled()
  })

  it('bootstraps one exact owner-approved month idempotently without a pilot expense write', () => {
    const months = new Set<string>()
    const ensureMonth = vi.fn((monthKey: string) => { months.add(monthKey) })
    const verifyMonth = vi.fn((monthKey: string) => months.has(monthKey))
    const port = { ensureMonth, verifyMonth }

    expect(() => bootstrapExpenseMonth('2026-08', '2026-09', port)).toThrow(
      'expense month bootstrap is not approved',
    )
    expect(() => bootstrapExpenseMonth('2026-13', '2026-13', port)).toThrow(
      'invalid expense bootstrap month',
    )
    expect(bootstrapExpenseMonth('2026-08', '2026-08', port)).toEqual({
      monthKey: '2026-08', monthReady: true,
    })
    expect(bootstrapExpenseMonth('2026-08', '2026-08', port)).toEqual({
      monthKey: '2026-08', monthReady: true,
    })
    expect(ensureMonth).toHaveBeenCalledTimes(2)
    expect(verifyMonth).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the configured finance master is outside the private folder', () => {
    const appsScript = installAppsScriptFakes({ masterParentId: 'other-folder' })

    expect(() => setupExpenseFinanceStorageWorkflow()).toThrow(
      'finance master is outside the configured private folder',
    )
    expect(appsScript.finance.inserted).toEqual([])
  })

  it('fails closed when the configured finance folder is not private', () => {
    const appsScript = installAppsScriptFakes({ folderSharing: 'ANYONE_WITH_LINK' })

    expect(() => setupExpenseFinanceStorageWorkflow()).toThrow(
      'finance master is outside the configured private folder',
    )
    expect(appsScript.finance.inserted).toEqual([])
  })

  it('does not expose configured resource values when Drive lookup fails', () => {
    installAppsScriptFakes({ resourceLookupFails: true })

    expectSafeExternalError(
      setupExpenseFinanceStorageWorkflow,
      'EXPENSE_FINANCE_STORAGE_UNAVAILABLE',
      'finance-folder',
    )
  })

  it.each([
    ['prepare open', prepareExpensePermissionsWorkflow, 'open-booking'],
    ['prepare header read', prepareExpensePermissionsWorkflow, 'staff-header-read'],
    ['apply open', applyExpensePermissionsWorkflow, 'open-booking'],
    ['apply header read', applyExpensePermissionsWorkflow, 'staff-header-read'],
    ['apply permission write', applyExpensePermissionsWorkflow, 'permission-write'],
    ['apply permission readback', applyExpensePermissionsWorkflow, 'permission-readback'],
  ] as const)('maps external %s failures to workflow-specific safe codes', (_label, workflow, externalFailureAt) => {
    const appsScript = installAppsScriptFakes({ externalFailureAt })
    expectSafeExternalError(
      workflow,
      workflow === prepareExpensePermissionsWorkflow
        ? 'EXPENSE_PERMISSION_PREPARE_UNAVAILABLE'
        : 'EXPENSE_PERMISSION_APPLY_UNAVAILABLE',
      appsScript.sentinel,
    )
  })

  it.each([
    ['open', 'open-finance'],
    ['header read', 'topology-header-read'],
    ['tab create', 'topology-create'],
    ['header mutation', 'topology-header-write'],
    ['header freeze', 'topology-freeze'],
  ] as const)('maps external finance topology %s failures to a safe code', (_label, externalFailureAt) => {
    const appsScript = installAppsScriptFakes({ externalFailureAt })
    expectSafeExternalError(
      setupExpenseFinanceStorageWorkflow,
      'EXPENSE_FINANCE_STORAGE_UNAVAILABLE',
      appsScript.sentinel,
    )
  })

  it('preserves safe local validation errors without configured identifiers', () => {
    const unsupportedHeader = installAppsScriptFakes()
    unsupportedHeader.booking.getSheetByName('CONFIG_STAFF')!.data[0]![1] = 'unexpected'
    expect(captureError(prepareExpensePermissionsWorkflow).message).toBe(
      'unsupported CONFIG_STAFF header',
    )

    const invalidPermissions = installAppsScriptFakes({ managerIds: 'OWNER_01,DOCTOR_01' })
    expect(captureError(applyExpensePermissionsWorkflow).message).toBe(
      'invalid expense permission configuration',
    )
    expect(String(captureError(applyExpensePermissionsWorkflow))).not.toContain(
      invalidPermissions.sentinel,
    )

    installAppsScriptFakes({ financeHeaderMismatch: true })
    expect(captureError(setupExpenseFinanceStorageWorkflow).message).toBe(
      'sheet header mismatch: EXPENSE_MONTHLY_INDEX',
    )
  })
})
