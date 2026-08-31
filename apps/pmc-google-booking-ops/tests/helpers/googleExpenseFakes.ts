import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { ExpensePrivateAttachment } from '../../../../shared/pmcMiniAppExpenseIngress'
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
  name: string
  appProperties: Record<string, string>
  properties: Record<string, string>
  version: string
  bytes: number[]
  description: string

  constructor(
    readonly id: string,
    readonly sharing: string,
    readonly parentFolders: FakeFolder[],
    readonly mimeType = 'application/vnd.google-apps.spreadsheet',
    options: {
      name?: string
      appProperties?: Record<string, string>
      properties?: Record<string, string>
      version?: string
      bytes?: number[]
      description?: string
    } = {},
  ) {
    this.name = options.name ?? id
    this.appProperties = { ...(options.appProperties ?? {}) }
    this.properties = { ...(options.properties ?? {}) }
    this.version = options.version ?? '1'
    this.bytes = [...(options.bytes ?? [])]
    this.description = options.description ?? ''
  }

  getId(): string { return this.id }
  isTrashed(): boolean { return false }
  getSharingAccess(): string { return this.sharing }
  getParents(): FakeIterator<FakeFolder> { return new FakeIterator(this.parentFolders) }
  getMimeType(): string { return this.mimeType }
  getBlob(): { getBytes(): number[]; getContentType(): string } {
    return {
      getBytes: () => [...this.bytes],
      getContentType: () => this.mimeType,
    }
  }
  moveTo(): FakeFile { return this }
}

export interface GoogleExpenseFakeEnvironment {
  master: FakeExpenseSpreadsheet
  ledger: FakeExpenseSpreadsheet
  ensureExpenseFolder(expenseId: string): void
  expenseFileCount(expenseId: string): number
  expenseFileMetadata(expenseId: string): { id: string; appProperties: Record<string, string>; properties: Record<string, string> }
  setExpenseFileProperties(fileId: string, input: { appProperties: Record<string, string>; properties: Record<string, string> }): void
  addExpenseAttachment(attachment: ExpensePrivateAttachment, bytes: number[]): void
  duplicateExpenseAttachment(attachment: ExpensePrivateAttachment, bytes: number[]): void
  mutateExpenseFile(fileId: string, patch: { bytes?: number[]; version?: string }): void
  setIncompleteSearch(value: boolean | undefined): void
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
  let incompleteSearch: boolean | undefined = false
  let ownerFileSequence = 0

  vi.stubGlobal('DriveApp', {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: (id: string) => folders.get(id)!,
    getFileById: (id: string) => files.get(id)!,
  })
  vi.stubGlobal('Drive', {
    Files: {
      get: (id: string) => advancedFile(files.get(id)!),
      list: (input: { q?: string }) => {
        const parentId = /'([^']+)'\s+in\s+parents/.exec(input.q ?? '')?.[1]
        return {
          incompleteSearch,
          files: [...files.values()]
            .filter((file) => !parentId || file.parentFolders.some(({ id }) => id === parentId))
            .map(advancedFile),
        }
      },
      create: (
        resource: {
          name: string
          description: string
          mimeType: string
          parents: string[]
          appProperties?: Record<string, string>
          properties?: Record<string, string>
        },
        blob: { bytes: number[]; mimeType: string; name: string },
      ) => {
        const parent = folders.get(resource.parents[0]!)
        if (!parent || blob.mimeType !== resource.mimeType || blob.name !== resource.name) {
          throw new Error('invalid fake Drive create')
        }
        ownerFileSequence += 1
        const file = new FakeFile(`owner-file-${ownerFileSequence}`, 'PRIVATE', [parent], resource.mimeType, {
          name: resource.name,
          appProperties: resource.appProperties,
          properties: resource.properties,
          version: '1',
          bytes: blob.bytes,
          description: resource.description,
        })
        files.set(file.id, file)
        parent.filesByName.set(file.name, [...(parent.filesByName.get(file.name) ?? []), file])
        return advancedFile(file)
      },
    },
  })
  vi.stubGlobal('Utilities', {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: (_algorithm: string, value: string | number[]) => {
      const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
      return [...createHash('sha256').update(bytes).digest()].map((byte) => byte > 127 ? byte - 256 : byte)
    },
    newBlob: (bytes: number[], mimeType: string, name: string) => ({ bytes: [...bytes], mimeType, name }),
  })
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => spreadsheets.get(id)!,
    create: () => { throw new Error('unexpected spreadsheet creation') },
    flush: vi.fn(),
  })
  function addExpenseAttachment(
    attachment: ExpensePrivateAttachment,
    bytes: number[],
    fileId = attachment.privateFileId,
  ): void {
    let expenseFolder = (month.foldersByName.get(attachment.expenseId) ?? [])[0]
    if (!expenseFolder) {
      expenseFolder = new FakeFolder(`folder-${attachment.expenseId}`, 'PRIVATE', [month])
      month.foldersByName.set(attachment.expenseId, [expenseFolder])
      folders.set(expenseFolder.id, expenseFolder)
    }
    const description = JSON.stringify({
      originalFileName: attachment.originalFileName,
      uploadedAt: attachment.uploadedAt,
    })
    const file = new FakeFile(fileId, 'PRIVATE', [expenseFolder], attachment.mediaType, {
      name: attachment.deterministicName,
      version: attachment.driveVersion,
      bytes,
      description,
      properties: expensePublicPropertiesForTest('2026-08', attachment, description),
    })
    files.set(fileId, file)
    const byName = expenseFolder.filesByName.get(file.name) ?? []
    expenseFolder.filesByName.set(file.name, [...byName, file])
  }

  return {
    master,
    ledger,
    ensureExpenseFolder(expenseId) {
      if (month.foldersByName.get(expenseId)?.length) return
      const expenseFolder = new FakeFolder(`folder-${expenseId}`, 'PRIVATE', [month])
      month.foldersByName.set(expenseId, [expenseFolder])
      folders.set(expenseFolder.id, expenseFolder)
    },
    expenseFileCount(expenseId) {
      const expenseFolder = (month.foldersByName.get(expenseId) ?? [])[0]
      return expenseFolder ? [...expenseFolder.filesByName.values()].flat().length : 0
    },
    expenseFileMetadata(expenseId) {
      const expenseFolder = (month.foldersByName.get(expenseId) ?? [])[0]
      const file = expenseFolder ? [...expenseFolder.filesByName.values()].flat()[0] : undefined
      if (!file) throw new Error('missing fake expense file')
      return {
        id: file.id,
        appProperties: { ...file.appProperties },
        properties: { ...file.properties },
      }
    },
    setExpenseFileProperties(fileId, input) {
      const file = files.get(fileId)
      if (!file) throw new Error('missing fake expense file')
      file.appProperties = { ...input.appProperties }
      file.properties = { ...input.properties }
    },
    addExpenseAttachment,
    duplicateExpenseAttachment(attachment, bytes) {
      addExpenseAttachment(attachment, bytes, `${attachment.privateFileId}-duplicate`)
    },
    mutateExpenseFile(fileId, patch) {
      const file = files.get(fileId)
      if (!file) throw new Error('missing fake expense file')
      if (patch.bytes) file.bytes = [...patch.bytes]
      if (patch.version) file.version = patch.version
    },
    setIncompleteSearch(value) { incompleteSearch = value },
  }
}

function advancedFile(file: FakeFile) {
  return {
    id: file.id,
    name: file.name,
    description: file.description,
    mimeType: file.mimeType,
    parents: file.parentFolders.map(({ id }) => id),
    trashed: false,
    size: String(file.bytes.length),
    version: file.version,
    appProperties: { ...file.appProperties },
    properties: { ...file.properties },
    permissions: [{ id: 'owner-user', type: 'user', role: 'owner', deleted: false }],
  }
}

function expensePublicPropertiesForTest(
  monthKey: string,
  attachment: ExpensePrivateAttachment,
  description: string,
): Record<string, string> {
  const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
  return {
    v: '1', eid: sha(attachment.expenseId), mon: monthKey, ord: String(attachment.ordinal),
    sha: attachment.sha256, sid: attachment.slotClaimId, rid: sha(attachment.rootRequestId),
    uid: sha(attachment.uploadedByStaffId), aid: attachment.attachmentId, msh: sha(description),
  }
}
