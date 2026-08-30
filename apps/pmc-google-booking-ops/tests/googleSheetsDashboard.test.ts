import { describe, expect, it } from 'vitest'
import { createGoogleDashboardPort } from '../src/adapters/googleSheets'

type CellValue = string | number | boolean | null

interface RangeRecord {
  row: number
  column: number
  rows: number
  columns: number
}

class DashboardSheet {
  private readonly values = new Map<string, CellValue>()
  private readonly formats = new Map<string, string>()
  readonly clearedContentRanges: RangeRecord[] = []
  clearCalls = 0

  setValue(row: number, column: number, value: CellValue): void {
    this.values.set(cellKey(row, column), value)
  }

  setFormat(row: number, column: number, format: string): void {
    this.formats.set(cellKey(row, column), format)
  }

  valueAt(row: number, column: number): CellValue {
    return this.values.get(cellKey(row, column)) ?? ''
  }

  formatAt(row: number, column: number): string {
    return this.formats.get(cellKey(row, column)) ?? ''
  }

  getLastRow(): number {
    let lastRow = 0
    for (const key of this.values.keys()) {
      lastRow = Math.max(lastRow, Number(key.split(':', 1)[0]))
    }
    return lastRow
  }

  getRange(
    rowOrA1: number | string,
    column?: number,
    rows = 1,
    columns = 1,
  ) {
    const range = typeof rowOrA1 === 'string'
      ? parseA1Range(rowOrA1)
      : { row: rowOrA1, column: column ?? 1, rows, columns }

    return {
      clear: () => {
        this.clearCalls += 1
        this.clearValues(range)
        this.clearFormats(range)
      },
      clearContent: () => {
        this.clearedContentRanges.push({ ...range })
        this.clearValues(range)
      },
      setValues: (nextValues: CellValue[][]) => {
        for (let rowOffset = 0; rowOffset < range.rows; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < range.columns; columnOffset += 1) {
            this.setValue(
              range.row + rowOffset,
              range.column + columnOffset,
              nextValues[rowOffset]?.[columnOffset] ?? '',
            )
          }
        }
      },
    }
  }

  private clearValues(range: RangeRecord): void {
    for (let rowOffset = 0; rowOffset < range.rows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < range.columns; columnOffset += 1) {
        this.values.delete(cellKey(range.row + rowOffset, range.column + columnOffset))
      }
    }
  }

  private clearFormats(range: RangeRecord): void {
    for (let rowOffset = 0; rowOffset < range.rows; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < range.columns; columnOffset += 1) {
        this.formats.delete(cellKey(range.row + rowOffset, range.column + columnOffset))
      }
    }
  }
}

describe('Google Dashboard adapter', () => {
  it('clears stale A:H operation content beyond row 1,000 on a zero-operation refresh', () => {
    const sheet = new DashboardSheet()
    sheet.setValue(1_025, 8, 'stale phone')

    dashboardPort(sheet).write({ kpis: {}, operations: [] })

    expect(sheet.clearedContentRanges).toContainEqual({ row: 1, column: 1, rows: 1_025, columns: 8 })
    expect(sheet.valueAt(1_025, 8)).toBe('')
  })

  it('clears through the full future extent when the new snapshot is longer than the sheet', () => {
    const sheet = new DashboardSheet()
    sheet.setValue(1, 1, 'old dashboard')
    const operations = Array.from({ length: 1_001 }, (_, index) => ({
      caseId: `PMC-${String(index + 1).padStart(6, '0')}`,
    }))

    dashboardPort(sheet).write({ kpis: {}, operations })

    expect(sheet.clearedContentRanges).toContainEqual({ row: 1, column: 1, rows: 1_005, columns: 8 })
    expect(sheet.valueAt(1_005, 1)).toBe('PMC-001001')
  })

  it('keeps dashboard write positions and clears content without touching formats or column I', () => {
    const sheet = new DashboardSheet()
    sheet.setValue(7, 9, 'operator note')
    sheet.setFormat(7, 8, 'phone-format')

    dashboardPort(sheet).write({
      kpis: { bookings: 3, revenue: 2_700 },
      operations: [{
        caseId: 'PMC-000003',
        status: 'CONFIRMED',
        adminId: 'ADMIN_01',
        aeId: null,
        doctorId: 'DOCTOR_01',
        channelId: 'PAGE_TAB',
        appointmentStart: '2026-08-31T10:30:00+07:00',
        phoneMasked: '081-xxx-1234',
      }],
    })

    expect(valuesAt(sheet, 1, 1, 3, 2)).toEqual([
      ['KPI', 'Value'],
      ['bookings', 3],
      ['revenue', 2_700],
    ])
    expect(valuesAt(sheet, 6, 1, 2, 8)).toEqual([
      [
        'caseId',
        'status',
        'adminId',
        'aeId',
        'doctorId',
        'channelId',
        'appointmentStart',
        'phoneMasked',
      ],
      [
        'PMC-000003',
        'CONFIRMED',
        'ADMIN_01',
        '',
        'DOCTOR_01',
        'PAGE_TAB',
        '2026-08-31T10:30:00+07:00',
        '081-xxx-1234',
      ],
    ])
    expect(sheet.valueAt(7, 9)).toBe('operator note')
    expect(sheet.formatAt(7, 8)).toBe('phone-format')
    expect(sheet.clearCalls).toBe(0)
  })
})

function dashboardPort(sheet: DashboardSheet) {
  return createGoogleDashboardPort({
    getSheetByName: (tab: string) => tab === 'DASHBOARD' ? sheet : null,
  } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet)
}

function valuesAt(
  sheet: DashboardSheet,
  row: number,
  column: number,
  rows: number,
  columns: number,
): CellValue[][] {
  return Array.from({ length: rows }, (_, rowOffset) => (
    Array.from({ length: columns }, (_, columnOffset) => (
      sheet.valueAt(row + rowOffset, column + columnOffset)
    ))
  ))
}

function cellKey(row: number, column: number): string {
  return `${row}:${column}`
}

function parseA1Range(a1: string): RangeRecord {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1)
  if (!match) throw new Error(`unsupported A1 range: ${a1}`)
  const startColumn = columnNumber(match[1])
  const startRow = Number(match[2])
  const endColumn = columnNumber(match[3])
  const endRow = Number(match[4])
  return {
    row: startRow,
    column: startColumn,
    rows: endRow - startRow + 1,
    columns: endColumn - startColumn + 1,
  }
}

function columnNumber(column: string): number {
  return [...column].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0)
}
