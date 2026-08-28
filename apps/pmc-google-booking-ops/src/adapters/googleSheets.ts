import { SHEET_SCHEMAS } from '../sheetSchema'
import { bookingMasterMigrationPlan, staffProfileMigrationPlan } from '../domain/sheetMigration'
import type { SheetRow, SheetStore } from '../repositories'
import type { DashboardPort } from '../ports'

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

export function ensureSheetTopology(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  for (const [tab, columns] of Object.entries(SHEET_SCHEMAS)) {
    let sheet = spreadsheet.getSheetByName(tab)
    if (!sheet) sheet = spreadsheet.insertSheet(tab)
    if (!columns.length) continue
    const existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : []
    const populated = existing.some((value) => String(value).trim())
    if (populated && columns.some((column, index) => existing[index] !== column)) {
      throw new Error(`sheet header mismatch: ${tab}`)
    }
    if (!populated) {
      sheet.getRange(1, 1, 1, columns.length).setValues([[...columns]])
      sheet.setFrozenRows(1)
    }
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

export function migrateConfigStaffProfileColumn(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): void {
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet || sheet.getLastColumn() < 1) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String)
    const plan = staffProfileMigrationPlan(headers)
    if (plan.kind === 'NONE') return
    sheet.insertColumnsAfter(plan.afterColumn, 1)
    sheet.getRange(1, plan.afterColumn + 1).setValue(plan.header)
  }
  throw new Error('CONFIG_STAFF migration did not converge')
}

export function createGoogleSheetStore(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet): SheetStore {
  return {
    read(tab: string): SheetRow[] {
      const sheet = requireSheet(spreadsheet, tab)
      if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return []
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      return sheet
        .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
        .getValues()
        .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])))
    },
    replace(tab: string, rows: SheetRow[]): void {
      const sheet = requireSheet(spreadsheet, tab)
      const headers = SHEET_SCHEMAS[tab]
      if (!headers?.length) throw new Error(`sheet is not repository-managed: ${tab}`)
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
      const headers = SHEET_SCHEMAS[tab]
      if (!headers?.length) throw new Error(`sheet is not repository-managed: ${tab}`)
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
        .setValues(rows.map((row) => headers.map((header) => encodeSheetCell(row[header]))))
    },
    update(tab: string, rowIndex: number, row: SheetRow): void {
      const sheet = requireSheet(spreadsheet, tab)
      const headers = SHEET_SCHEMAS[tab]
      if (!headers?.length) throw new Error(`sheet is not repository-managed: ${tab}`)
      if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= sheet.getLastRow() - 1) {
        throw new Error(`sheet row index out of range: ${tab}`)
      }
      sheet
        .getRange(rowIndex + 2, 1, 1, headers.length)
        .setValues([headers.map((header) => encodeSheetCell(row[header]))])
    },
  }
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
