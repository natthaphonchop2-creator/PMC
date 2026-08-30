import { BOOKING_MASTER_COLUMNS_V1, SHEET_SCHEMAS, STAFF_CONFIG_COLUMNS } from '../sheetSchema'
import { bookingMasterMigrationPlan, staffConfigMigrationPlan } from '../domain/sheetMigration'
import {
  LEGACY_BOOKING_MASTER_HEADERS,
  LEGACY_MINI_APP_REQUEST_HEADERS,
  TARGET_BOOKING_MASTER_HEADERS,
  TARGET_MINI_APP_REQUEST_HEADERS,
  type ApplyBookingAttributionMigrationPlan,
  type AttributionMigrationTableSnapshot,
  type AttributionStaffSnapshot,
} from '../domain/attributionMigration'
import type { SheetRow, SheetStore } from '../repositories'
import type { DashboardPort } from '../ports'
import type { ExpenseTopologyPort } from '../ports'

function requireSheet(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet, tab: string) {
  const sheet = spreadsheet.getSheetByName(tab)
  if (!sheet) throw new Error(`missing required sheet: ${tab}`)
  return sheet
}

export function encodeSheetCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

export function resolveManagedSheetColumns(tab: string, actual: readonly string[]): readonly string[] {
  const canonical = SHEET_SCHEMAS[tab]
  if (!canonical?.length) throw new Error(`sheet is not repository-managed: ${tab}`)
  if (sameHeader(actual, canonical)) return canonical
  if (tab === 'BOOKING_MASTER' && sameHeader(actual, BOOKING_MASTER_COLUMNS_V1)) {
    return BOOKING_MASTER_COLUMNS_V1
  }
  throw new Error(`sheet header mismatch: ${tab}`)
}

export function ensureSheetTopology(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  for (const [tab, columns] of Object.entries(SHEET_SCHEMAS)) {
    let sheet = spreadsheet.getSheetByName(tab)
    if (!sheet) sheet = spreadsheet.insertSheet(tab)
    if (!columns.length) continue
    const existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : []
    const populated = existing.some((value) => String(value).trim())
    if (populated) resolveManagedSheetColumns(tab, existing.map(String))
    if (!populated) {
      sheet.getRange(1, 1, 1, columns.length).setValues([[...columns]])
      sheet.setFrozenRows(1)
    }
  }
}

export function createGoogleExpenseTopologyPort(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): ExpenseTopologyPort {
  return {
    readHeader(tab) {
      const sheet = spreadsheet.getSheetByName(tab)
      if (!sheet) return null
      if (sheet.getLastColumn() < 1) return []
      return sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getValues()[0]
        .map(String)
    },
    createTab(tab, headers) {
      if (spreadsheet.getSheetByName(tab)) throw new Error(`sheet already exists: ${tab}`)
      const sheet = spreadsheet.insertSheet(tab)
      sheet.getRange(1, 1, 1, headers.length).setValues([[...headers]])
    },
    freezeHeader(tab) {
      requireSheet(spreadsheet, tab).setFrozenRows(1)
    },
  }
}

export function migrateBookingMasterStaffColumns(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): void {
  const sheet = spreadsheet.getSheetByName('BOOKING_MASTER')
  if (!sheet || sheet.getLastColumn() < 1) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String)
    const plan = bookingMasterMigrationPlan(headers)
    if (plan.kind === 'NONE') return
    sheet.insertColumnsAfter(plan.afterColumn, plan.headers.length)
    sheet
      .getRange(1, plan.afterColumn + 1, 1, plan.headers.length)
      .setValues([[...plan.headers]])
  }
  throw new Error('BOOKING_MASTER migration did not converge')
}

export function migrateConfigStaffColumns(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): boolean {
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet || sheet.getLastColumn() < 1) return false
  let changed = false
  let mutations = 0
  while (true) {
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String)
    const plan = staffConfigMigrationPlan(headers)
    if (plan.kind === 'NONE') return changed
    if (mutations >= 3) throw new Error('CONFIG_STAFF migration did not converge')
    if (plan.kind === 'APPEND_FINANCE_PERMISSIONS') {
      sheet.insertColumnsAfter(plan.afterColumn, plan.headers.length)
      sheet
        .getRange(1, plan.afterColumn + 1, 1, plan.headers.length)
        .setValues([[...plan.headers]])
    } else {
      sheet.insertColumnsAfter(plan.afterColumn, 1)
      sheet.getRange(1, plan.afterColumn + 1).setValue(plan.header)
    }
    changed = true
    mutations += 1
  }
}

export function createGoogleSheetStore(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet): SheetStore {
  const columnsFor = (tab: string, sheet: GoogleAppsScript.Spreadsheet.Sheet): readonly string[] => {
    if (sheet.getLastColumn() < 1) throw new Error(`sheet header mismatch: ${tab}`)
    const actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    return resolveManagedSheetColumns(tab, actual)
  }
  return {
    read(tab: string): SheetRow[] {
      const sheet = requireSheet(spreadsheet, tab)
      const headers = columnsFor(tab, sheet)
      if (sheet.getLastRow() < 2) return []
      return sheet
        .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
        .getValues()
        .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])))
    },
    replace(tab: string, rows: SheetRow[]): void {
      const sheet = requireSheet(spreadsheet, tab)
      const headers = columnsFor(tab, sheet)
      const existingRows = Math.max(sheet.getLastRow() - 1, 0)
      if (existingRows) sheet.getRange(2, 1, existingRows, headers.length).clearContent()
      if (rows.length) {
        sheet
          .getRange(2, 1, rows.length, headers.length)
          .setValues(rows.map((row) => headers.map((header) => encodeSheetCell(row[header]))))
      }
    },
    append(tab: string, rows: SheetRow[]): void {
      if (rows.length === 0) return
      const sheet = requireSheet(spreadsheet, tab)
      const headers = columnsFor(tab, sheet)
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
        .setValues(rows.map((row) => headers.map((header) => encodeSheetCell(row[header]))))
    },
    update(tab: string, rowIndex: number, row: SheetRow): void {
      const sheet = requireSheet(spreadsheet, tab)
      const headers = columnsFor(tab, sheet)
      if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheet.getLastRow() - 1) {
        throw new Error(`sheet row index out of range: ${tab}`)
      }
      sheet
        .getRange(rowIndex + 2, 1, 1, headers.length)
        .setValues([headers.map((header) => encodeSheetCell(row[header]))])
    },
  }
}

function sameHeader(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function readGoogleBookingAttributionMigrationSnapshot(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  hash: (value: string) => string = localStableHash,
): {
  request: AttributionMigrationTableSnapshot
  master: AttributionMigrationTableSnapshot
  staff: AttributionStaffSnapshot[]
} {
  const request = requireSheet(spreadsheet, 'MINI_APP_REQUESTS')
  const master = requireSheet(spreadsheet, 'BOOKING_MASTER')
  const staff = requireSheet(spreadsheet, 'CONFIG_STAFF')
  return {
    request: readAttributionTable(
      request,
      new Set(['protocolVersion', 'recorderName', 'adminId', 'adminName', 'aeId']),
      hash,
    ),
    master: readAttributionTable(
      master,
      new Set(['recorderId', 'recorderName', 'recorderSource']),
      hash,
    ),
    staff: readAttributionStaff(staff),
  }
}

export function writeGoogleBookingAttributionMigration(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  plan: ApplyBookingAttributionMigrationPlan,
): void {
  if (plan.migrateRequestSchema) {
    const sheet = requireSheet(spreadsheet, 'MINI_APP_REQUESTS')
    requireExactSheetHeader(sheet, LEGACY_MINI_APP_REQUEST_HEADERS, 'MINI_APP_REQUESTS')
    sheet.insertColumnsBefore(3, 1)
    sheet.insertColumnsAfter(4, 3)
    const interim = readHeader(sheet)
    const aeNameColumn = interim.indexOf('aeName') + 1
    if (aeNameColumn < 1) throw new Error('MIGRATION_WRITE_HEADER_MISMATCH')
    sheet.insertColumnsBefore(aeNameColumn, 1)
    writeInsertedColumns(
      sheet,
      TARGET_MINI_APP_REQUEST_HEADERS,
      plan.requestRows,
      ['protocolVersion', 'recorderName', 'adminId', 'adminName', 'aeId'],
    )
    requireExactSheetHeader(sheet, TARGET_MINI_APP_REQUEST_HEADERS, 'MINI_APP_REQUESTS')
  }
  if (plan.migrateMasterSchema) {
    const sheet = requireSheet(spreadsheet, 'BOOKING_MASTER')
    requireExactSheetHeader(sheet, LEGACY_BOOKING_MASTER_HEADERS, 'BOOKING_MASTER')
    sheet.insertColumnsAfter(4, 3)
    writeInsertedColumns(
      sheet,
      TARGET_BOOKING_MASTER_HEADERS,
      plan.masterRows,
      ['recorderId', 'recorderName', 'recorderSource'],
    )
    requireExactSheetHeader(sheet, TARGET_BOOKING_MASTER_HEADERS, 'BOOKING_MASTER')
  }
}

function readAttributionTable(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  insertedHeaders: ReadonlySet<string>,
  hash: (value: string) => string,
): AttributionMigrationTableSnapshot {
  const headers = readHeader(sheet)
  const rowCount = Math.max(sheet.getLastRow() - 1, 0)
  const rows = rowCount > 0
    ? sheet.getRange(2, 1, rowCount, headers.length).getValues()
    : []
  return {
    headers,
    rows,
    preservationFingerprint: sheetPreservationFingerprint(sheet, headers, insertedHeaders, hash),
  }
}

function readAttributionStaff(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
): AttributionStaffSnapshot[] {
  const headers = readHeader(sheet)
  const knownHeaders = [
    STAFF_CONFIG_COLUMNS.slice(0, 7),
    STAFF_CONFIG_COLUMNS.slice(0, 8),
    STAFF_CONFIG_COLUMNS.slice(0, 9),
    STAFF_CONFIG_COLUMNS,
  ]
  if (!knownHeaders.some((known) => sameHeader(headers, known))) {
    throw new Error('CONFIG_STAFF attribution header mismatch')
  }
  const required = ['id', 'name', 'email', 'canBeAe', 'active'] as const
  const indexes = required.map((header) => headers.indexOf(header))
  if (indexes.some((index) => index < 0) || new Set(headers).size !== headers.length) {
    throw new Error('CONFIG_STAFF attribution header mismatch')
  }
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    : []
  return rows.filter((values) => values.some((value) => String(value).trim())).map((values) => ({
    id: String(values[indexes[0]] ?? '').trim(),
    name: String(values[indexes[1]] ?? '').trim(),
    email: String(values[indexes[2]] ?? '').trim().toLowerCase(),
    canBeAe: booleanCell(values[indexes[3]]),
    active: booleanCell(values[indexes[4]]),
  }))
}

function writeInsertedColumns(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  targetHeaders: readonly string[],
  targetRows: readonly unknown[][],
  insertedHeaders: readonly string[],
): void {
  if (sheet.getLastRow() !== targetRows.length + 1) throw new Error('MIGRATION_WRITE_ROW_COUNT_CHANGED')
  for (const header of insertedHeaders) {
    const column = targetHeaders.indexOf(header) + 1
    if (column < 1) throw new Error('MIGRATION_WRITE_HEADER_MISMATCH')
    const values = [[header], ...targetRows.map((row) => [row[column - 1] ?? ''])]
    const range = sheet.getRange(1, column, values.length, 1)
    range.setValues(values)
    range.setNumberFormat(header === 'protocolVersion' ? '0' : '@')
  }
}

function requireExactSheetHeader(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  expected: readonly string[],
  tab: string,
): void {
  if (!sameHeader(readHeader(sheet), expected)) throw new Error(`sheet header mismatch: ${tab}`)
}

function readHeader(sheet: GoogleAppsScript.Spreadsheet.Sheet): string[] {
  if (sheet.getLastColumn() < 1) return []
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
}

function sheetPreservationFingerprint(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  headers: readonly string[],
  insertedHeaders: ReadonlySet<string>,
  hash: (value: string) => string,
): string {
  const rowCount = Math.max(sheet.getLastRow(), 1)
  const columnIndexes = headers.flatMap((header, index) => insertedHeaders.has(header) ? [] : [index])
  const range = sheet.getRange(1, 1, rowCount, headers.length)
  const pick = <T>(rows: T[][]): T[][] => rows.map((row) => columnIndexes.map((index) => row[index]))
  const validations = pick(range.getDataValidations()).map((row) => row.map(validationSignature))
  return hash(JSON.stringify({
    headers: columnIndexes.map((index) => headers[index]),
    formulas: pick(range.getFormulas()),
    numberFormats: pick(range.getNumberFormats()),
    validations,
    frozenRows: sheet.getFrozenRows(),
    frozenColumns: sheet.getFrozenColumns(),
    filter: filterSignature(sheet, headers, insertedHeaders),
  }))
}

function validationSignature(
  validation: GoogleAppsScript.Spreadsheet.DataValidation | null,
): unknown {
  if (!validation) return null
  return {
    criteriaType: String(validation.getCriteriaType()),
    criteriaValues: validation.getCriteriaValues().map(safeMetadataValue),
    allowInvalid: validation.getAllowInvalid(),
    helpText: validation.getHelpText(),
  }
}

function filterSignature(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  headers: readonly string[],
  insertedHeaders: ReadonlySet<string>,
): unknown {
  const filter = sheet.getFilter()
  if (!filter) return null
  const range = filter.getRange()
  const rangeStart = range.getColumn()
  const rangeEnd = rangeStart + range.getNumColumns() - 1
  const criteria: Array<[string, unknown]> = []
  headers.forEach((header, index) => {
    const column = index + 1
    if (column < rangeStart || column > rangeEnd || insertedHeaders.has(header)) return
    const item = filter.getColumnFilterCriteria(column)
    if (!item) {
      criteria.push([header, null])
      return
    }
    criteria.push([header, {
      criteriaType: String(item.getCriteriaType()),
      criteriaValues: item.getCriteriaValues().map(safeMetadataValue),
      hiddenValues: item.getHiddenValues(),
    }])
  })
  return {
    row: range.getRow(),
    column: rangeStart,
    rows: range.getNumRows(),
    logicalColumns: range.getNumColumns() - headers.filter((header, index) => (
      insertedHeaders.has(header) && index + 1 >= rangeStart && index + 1 <= rangeEnd
    )).length,
    criteria,
  }
}

function safeMetadataValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  return String(value)
}

function localStableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function booleanCell(value: unknown): boolean {
  return value === true || String(value).trim().toLowerCase() === 'true' || String(value).trim() === '1'
}

export function createGoogleDashboardPort(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): DashboardPort {
  return {
    write(snapshot) {
      const sheet = requireSheet(spreadsheet, 'DASHBOARD')
      sheet.getRange('A1:G1000').clearContent()
      const kpis = Object.entries(snapshot.kpis)
      sheet.getRange(1, 1, 1, 2).setValues([['KPI', 'Value']])
      if (kpis.length) sheet.getRange(2, 1, kpis.length, 2).setValues(kpis)
      const operationHeaders = [
        'caseId',
        'status',
        'adminId',
        'aeId',
        'doctorId',
        'channelId',
        'appointmentStart',
        'phoneMasked',
      ]
      const startRow = kpis.length + 4
      sheet.getRange(startRow, 1, 1, operationHeaders.length).setValues([operationHeaders])
      if (snapshot.operations.length) {
        sheet
          .getRange(startRow + 1, 1, snapshot.operations.length, operationHeaders.length)
          .setValues(snapshot.operations.map((row) => operationHeaders.map((header) => row[header] ?? '')))
      }
    },
  }
}
