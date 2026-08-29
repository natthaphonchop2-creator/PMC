import { vi } from 'vitest'
import {
  EXPENSE_MASTER_SCHEMAS,
  EXPENSE_MONTH_SCHEMAS,
} from '../../src/expense/sheetTopology'

type FormulaCell = { formula: string }

function isFormulaCell(value: unknown): value is FormulaCell {
  return Boolean(value) && typeof value === 'object' && 'formula' in (value as Record<string, unknown>)
}

class FakeRange {
  constructor(
    private readonly sheet: FakeExpenseSheet,
    private readonly row: number,
    private readonly column: number,
    private readonly rows: number,
    private readonly columns: number,
  ) {}

  getValues(): unknown[][] {
    return Array.from({ length: this.rows }, (_, rowOffset) => (
      Array.from({ length: this.columns }, (_, columnOffset) => {
        const value = this.sheet.data[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
        return isFormulaCell(value) ? '#FORMULA_EVALUATED!' : value
      })
    ))
  }

  setValues(values: unknown[][]): void {
    this.sheet.writeCount += 1
    for (let rowOffset = 0; rowOffset < this.rows; rowOffset += 1) {
      const target = this.sheet.data[this.row - 1 + rowOffset] ?? []
      this.sheet.data[this.row - 1 + rowOffset] = target
      for (let columnOffset = 0; columnOffset < this.columns; columnOffset += 1) {
        const value = values[rowOffset]?.[columnOffset] ?? ''
        if (typeof value === 'string' && /^\s*[=+\-@]/.test(value)) {
          this.sheet.formulaWriteCount += 1
          target[this.column - 1 + columnOffset] = { formula: value }
        } else {
          target[this.column - 1 + columnOffset] = value
        }
      }
    }
  }

  clearContent(): void {
    this.sheet.writeCount += 1
    for (let rowOffset = 0; rowOffset < this.rows; rowOffset += 1) {
      const target = this.sheet.data[this.row - 1 + rowOffset] ?? []
      for (let columnOffset = 0; columnOffset < this.columns; columnOffset += 1) {
        target[this.column - 1 + columnOffset] = ''
      }
    }
  }
}

export class FakeExpenseSheet {
  writeCount = 0
  formulaWriteCount = 0
  frozenRows = 0

  constructor(readonly data: unknown[][] = []) {}

  getLastColumn(): number { return this.data[0]?.length ?? 0 }
  getLastRow(): number { return this.data.length }
  getRange(row: number, column: number, rows = 1, columns = 1): FakeRange {
    return new FakeRange(this, row, column, rows, columns)
  }
  setFrozenRows(rows: number): void {
    this.writeCount += 1
    this.frozenRows = rows
  }
}

export class FakeExpenseSpreadsheet {
  readonly sheets = new Map<string, FakeExpenseSheet>()
  insertCount = 0

  constructor(readonly id: string) {}

  getId(): string { return this.id }
  getSheetByName(tab: string): FakeExpenseSheet | null { return this.sheets.get(tab) ?? null }
  insertSheet(tab: string): FakeExpenseSheet {
    this.insertCount += 1
    const sheet = new FakeExpenseSheet()
    this.sheets.set(tab, sheet)
    return sheet
  }
  topologyMutationCount(): number {
    return this.insertCount + [...this.sheets.values()].reduce((total, sheet) => total + sheet.writeCount, 0)
  }
  formulaWriteCount(): number {
    return [...this.sheets.values()].reduce((total, sheet) => total + sheet.formulaWriteCount, 0)
  }
}

class FakeIterator<T> {
  private readonly values: T[]
  constructor(values: readonly T[]) { this.values = [...values] }
  hasNext(): boolean { return this.values.length > 0 }
  next(): T { return this.values.shift()! }
}

class FakeFolder {
  readonly foldersByName = new Map<string, FakeFolder[]>()
  readonly filesByName = new Map<string, FakeFile[]>()

  constructor(
    readonly id: string,
    readonly sharing: string,
    readonly parentFolders: FakeFolder[],
  ) {}

  getId(): string { return this.id }
  isTrashed(): boolean { return false }
  getSharingAccess(): string { return this.sharing }
  getParents(): FakeIterator<FakeFolder> { return new FakeIterator(this.parentFolders) }
  getFoldersByName(name: string): FakeIterator<FakeFolder> {
    return new FakeIterator(this.foldersByName.get(name) ?? [])
  }
  getFilesByName(name: string): FakeIterator<FakeFile> {
    return new FakeIterator(this.filesByName.get(name) ?? [])
  }
  createFolder(name: string): FakeFolder {
    const folder = new FakeFolder(`created-${name}`, this.sharing, [this])
    this.foldersByName.set(name, [folder])
    return folder
  }
}

class FakeFile {
  constructor(
    readonly id: string,
    readonly sharing: string,
    readonly parentFolders: FakeFolder[],
    readonly mimeType = 'application/vnd.google-apps.spreadsheet',
  ) {}

  getId(): string { return this.id }
  isTrashed(): boolean { return false }
  getSharingAccess(): string { return this.sharing }
  getParents(): FakeIterator<FakeFolder> { return new FakeIterator(this.parentFolders) }
  getMimeType(): string { return this.mimeType }
  moveTo(): FakeFile { return this }
}

export interface GoogleExpenseFakeEnvironment {
  master: FakeExpenseSpreadsheet
  ledger: FakeExpenseSpreadsheet
}

export function installGoogleExpenseFakes(options: {
  indexed?: boolean
  initializedLedger?: boolean
  ledgerSharing?: 'PRIVATE' | 'ANYONE'
  ledgerParent?: 'MONTH' | 'OUTSIDE'
} = {}): GoogleExpenseFakeEnvironment {
  const root = new FakeFolder('finance-root', 'PRIVATE', [])
  const outside = new FakeFolder('outside-folder', 'PRIVATE', [])
  const month = new FakeFolder('month-folder', 'PRIVATE', [root])
  root.foldersByName.set('PMC Expenses 2026-08', [month])

  const master = new FakeExpenseSpreadsheet('finance-master')
  for (const [tab, headers] of Object.entries(EXPENSE_MASTER_SCHEMAS)) {
    const rows: unknown[][] = [[...headers]]
    if (tab === 'EXPENSE_MONTHLY_INDEX' && options.indexed === true) {
      rows.push([
        '2026-08', 'ledger-2026-08', 'month-folder',
        '2026-08-01T00:00:00+07:00', '2026-08-01T00:00:00+07:00',
      ])
    }
    master.sheets.set(tab, new FakeExpenseSheet(rows))
  }

  const ledger = new FakeExpenseSpreadsheet('ledger-2026-08')
  if (options.initializedLedger === true) {
    for (const [tab, headers] of Object.entries(EXPENSE_MONTH_SCHEMAS)) {
      ledger.sheets.set(tab, new FakeExpenseSheet([[...headers]]))
    }
  }

  const masterFile = new FakeFile('finance-master', 'PRIVATE', [root])
  const ledgerFile = new FakeFile(
    'ledger-2026-08',
    options.ledgerSharing ?? 'PRIVATE',
    [options.ledgerParent === 'OUTSIDE' ? outside : month],
  )
  month.filesByName.set('PMC Expenses 2026-08', [ledgerFile])
  const folders = new Map([
    [root.id, root],
    [month.id, month],
    [outside.id, outside],
  ])
  const files = new Map([
    [masterFile.id, masterFile],
    [ledgerFile.id, ledgerFile],
  ])
  const spreadsheets = new Map([
    [master.id, master],
    [ledger.id, ledger],
  ])

  vi.stubGlobal('DriveApp', {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: (id: string) => folders.get(id)!,
    getFileById: (id: string) => files.get(id)!,
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => spreadsheets.get(id)!,
    create: () => { throw new Error('unexpected spreadsheet creation') },
  })
  return { master, ledger }
}
