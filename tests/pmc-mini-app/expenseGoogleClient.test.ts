import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  createFinanceGooglePorts,
  type FinanceGoogleFactory,
} from '../../server/pmc-mini-app/finance/googleClient'

const MONTH_KEY = '2026-08'
const EXPENSE_ID = 'EXP-202608-0001'

describe('private finance Google ports', () => {
  it('uses ADC scopes and resolves every master/month read from configured private containment and the master index', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)

    await expect(ports.readMaster(["'EXPENSE_REQUESTS'!A2:J"])).resolves.toEqual({
      "'EXPENSE_REQUESTS'!A2:J": [['request-1']],
    })
    await expect(ports.readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"])).resolves.toEqual({
      "'EXPENSE_SUBMISSIONS'!A2:T": [['EXP-202608-0001']],
    })

    expect(fake.scopes).toEqual([[
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ]])
    expect(fake.sheetReads.mock.calls.map(([input]) => input.spreadsheetId)).toEqual([
      'finance-master',
      'finance-master',
      'ledger-2026-08',
    ])
    expect(JSON.stringify(fake.sheetReads.mock.calls)).not.toContain('callerSpreadsheetId')
  })

  it('fails closed for duplicate index rows or any non-private/wrong direct ancestor resource', async () => {
    const duplicateIndex = financeGoogleFake()
    duplicateIndex.indexRows.push([...duplicateIndex.indexRows[0]!])
    await expect(createFinanceGooglePorts(config(), duplicateIndex.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const outsideMaster = financeGoogleFake()
    outsideMaster.item('finance-master').parents = ['outside-folder']
    await expect(createFinanceGooglePorts(config(), outsideMaster.factory)
      .readMaster(["'EXPENSE_REQUESTS'!A2:J"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const publicMonth = financeGoogleFake()
    publicMonth.item('month-2026-08').permissions = [{ id: 'public', type: 'anyone', role: 'reader' }]
    await expect(createFinanceGooglePorts(config(), publicMonth.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })

    const wrongLedgerType = financeGoogleFake()
    wrongLedgerType.item('ledger-2026-08').mimeType = 'application/pdf'
    await expect(createFinanceGooglePorts(config(), wrongLedgerType.factory)
      .readMonth(MONTH_KEY, ["'EXPENSE_SUBMISSIONS'!A2:T"]))
      .rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })
  })

  it('creates exactly one deterministic expenseId folder and rejects duplicate or mismatched identities', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)

    const first = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const retry = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)

    expect(retry).toBe(first)
    expect(fake.driveCreates).toHaveBeenCalledTimes(1)
    expect(fake.item(first)).toMatchObject({
      name: EXPENSE_ID,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['month-2026-08'],
      appProperties: {
        pmcExpenseId: EXPENSE_ID,
        pmcExpenseMonthKey: MONTH_KEY,
      },
    })

    const duplicate = financeGoogleFake()
    duplicate.addExpenseFolder('expense-folder-a')
    duplicate.addExpenseFolder('expense-folder-b')
    await expect(createFinanceGooglePorts(config(), duplicate.factory)
      .ensureExpenseFolder(MONTH_KEY, EXPENSE_ID))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })

    const mismatched = financeGoogleFake()
    mismatched.add({
      id: 'expense-folder-mismatch', name: EXPENSE_ID,
      mimeType: 'application/vnd.google-apps.folder', parents: ['month-2026-08'],
      appProperties: {}, permissions: privatePermissions(), trashed: false, version: '1',
    })
    await expect(createFinanceGooglePorts(config(), mismatched.factory)
      .ensureExpenseFolder(MONTH_KEY, EXPENSE_ID))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('uploads create-only deterministic files, returns an exact retry, and rejects poisoned conflicts', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const deterministicName = `001-${sha256}.jpg`
    const input = {
      monthKey: MONTH_KEY,
      expenseId: EXPENSE_ID,
      parentId,
      deterministicName,
      bytes,
      mimeType: 'image/jpeg' as const,
      ordinal: 1,
      sha256,
    }

    const first = await ports.uploadExpenseImage(input)
    await expect(ports.uploadExpenseImage(input)).resolves.toBe(first)
    expect(fake.driveCreates.mock.calls.filter(([request]) => request.requestBody?.mimeType !== 'application/vnd.google-apps.folder'))
      .toHaveLength(1)
    expect(fake.item(first)).toMatchObject({
      name: deterministicName,
      size: String(bytes.length),
      mimeType: 'image/jpeg',
      parents: [parentId],
      appProperties: {
        pmcExpenseId: EXPENSE_ID,
        pmcExpenseMonthKey: MONTH_KEY,
        pmcExpenseOrdinal: '1',
        pmcExpenseSha256: sha256,
      },
    })

    fake.item(first).bytes = Buffer.from('poisoned private bytes')
    fake.item(first).size = String(fake.item(first).bytes!.length)
    await expect(ports.uploadExpenseImage(input)).rejects.toMatchObject({
      code: 'EXPENSE_PRIVATE_FILE_INVALID',
      message: 'EXPENSE_PRIVATE_FILE_INVALID',
    })

    await expect(ports.uploadExpenseImage({ ...input, deterministicName: `1-${sha256}.jpg` }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })

  it('pins file identity around download and validates bytes, MIME, metadata, and direct parent', async () => {
    const fake = financeGoogleFake()
    const ports = createFinanceGooglePorts(config(), fake.factory)
    const parentId = await ports.ensureExpenseFolder(MONTH_KEY, EXPENSE_ID)
    const bytes = await jpeg()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fileId = await ports.uploadExpenseImage({
      monthKey: MONTH_KEY, expenseId: EXPENSE_ID, parentId,
      deterministicName: `001-${sha256}.jpg`, bytes, mimeType: 'image/jpeg', ordinal: 1, sha256,
    })

    await expect(ports.verifyExpenseFile({ monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId }))
      .resolves.toBeUndefined()
    await expect(ports.downloadExpenseFile({ monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId }))
      .resolves.toEqual({ bytes, mimeType: 'image/jpeg' })

    fake.afterMediaRead = () => { fake.item(fileId).version = '2' }
    await expect(ports.downloadExpenseFile({ monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })

    fake.afterMediaRead = undefined
    fake.item(fileId).parents = ['month-2026-08']
    await expect(ports.verifyExpenseFile({ monthKey: MONTH_KEY, expenseId: EXPENSE_ID, fileId }))
      .rejects.toMatchObject({ code: 'EXPENSE_PRIVATE_FILE_INVALID' })
  })
})

function config() {
  return { masterSpreadsheetId: 'finance-master', folderId: 'finance-root' }
}

interface FakePermission {
  id: string
  type: 'user' | 'group' | 'domain' | 'anyone'
  role: string
  deleted?: boolean
}

interface FakeItem {
  id: string
  name: string
  mimeType: string
  parents: string[]
  trashed: boolean
  appProperties: Record<string, string>
  permissions: FakePermission[]
  version: string
  size?: string
  bytes?: Buffer
}

function privatePermissions(): FakePermission[] {
  return [{ id: 'owner-user', type: 'user', role: 'owner', deleted: false }]
}

function financeGoogleFake() {
  const items = new Map<string, FakeItem>()
  const scopes: string[][] = []
  const indexRows: unknown[][] = [[
    MONTH_KEY,
    'ledger-2026-08',
    'month-2026-08',
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:00:00.000Z',
  ]]
  let sequence = 0
  let afterMediaRead: (() => void) | undefined

  const add = (item: FakeItem) => { items.set(item.id, item); return item }
  add({
    id: 'finance-root', name: 'PMC Finance', mimeType: 'application/vnd.google-apps.folder',
    parents: ['owner-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
  })
  add({
    id: 'finance-master', name: 'PMC Finance Master', mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: ['finance-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
  })
  add({
    id: 'month-2026-08', name: 'PMC Expenses 2026-08', mimeType: 'application/vnd.google-apps.folder',
    parents: ['finance-root'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
  })
  add({
    id: 'ledger-2026-08', name: 'PMC Expenses 2026-08', mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: ['month-2026-08'], trashed: false, appProperties: {}, permissions: privatePermissions(), version: '1',
  })

  const sheetReads = vi.fn(async (input: { spreadsheetId: string; ranges: string[] }) => ({
    data: {
      valueRanges: input.ranges.map((range) => ({
        range,
        values: input.spreadsheetId === 'finance-master' && range.includes('EXPENSE_MONTHLY_INDEX')
          ? indexRows
          : input.spreadsheetId === 'finance-master'
            ? [['request-1']]
            : [['EXP-202608-0001']],
      })),
    },
  }))

  const driveGets = vi.fn(async (input: { fileId: string; alt?: string }) => {
    const selected = items.get(input.fileId)
    if (!selected) throw Object.assign(new Error('private provider not found'), { code: 404 })
    if (input.alt === 'media') {
      if (!selected.bytes) throw new Error('private missing media')
      const bytes = Buffer.from(selected.bytes)
      afterMediaRead?.()
      afterMediaRead = undefined
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    }
    return { data: driveMetadata(selected) }
  })

  const driveLists = vi.fn(async (input: { q?: string }) => {
    const parent = /'([^']+)'\s+in\s+parents/.exec(input.q ?? '')?.[1]
    return {
      data: {
        files: [...items.values()]
          .filter((candidate) => !parent || candidate.parents.includes(parent))
          .map(driveMetadata),
      },
    }
  })

  const driveCreates = vi.fn(async (input: {
    requestBody?: Partial<FakeItem>
    media?: { body: Buffer; mimeType: string }
  }) => {
    sequence += 1
    const id = `created-${sequence}`
    const request = input.requestBody ?? {}
    const bytes = input.media ? Buffer.from(input.media.body) : undefined
    const item: FakeItem = {
      id,
      name: String(request.name ?? ''),
      mimeType: String(request.mimeType ?? input.media?.mimeType ?? ''),
      parents: [...(request.parents ?? [])],
      trashed: false,
      appProperties: { ...(request.appProperties ?? {}) },
      permissions: privatePermissions(),
      version: '1',
      ...(bytes ? { bytes, size: String(bytes.length) } : {}),
    }
    add(item)
    return { data: driveMetadata(item) }
  })

  const factory: FinanceGoogleFactory = {
    createAuth(nextScopes) { scopes.push(nextScopes); return { kind: 'adc' } },
    createSheets() {
      return { spreadsheets: { values: { batchGet: sheetReads } } }
    },
    createDrive() {
      return { files: { get: driveGets, list: driveLists, create: driveCreates } }
    },
  }

  return {
    factory,
    scopes,
    indexRows,
    sheetReads,
    driveGets,
    driveLists,
    driveCreates,
    add,
    addExpenseFolder(id: string) {
      add({
        id, name: EXPENSE_ID, mimeType: 'application/vnd.google-apps.folder',
        parents: ['month-2026-08'], trashed: false,
        appProperties: { pmcExpenseId: EXPENSE_ID, pmcExpenseMonthKey: MONTH_KEY },
        permissions: privatePermissions(), version: '1',
      })
    },
    item(id: string) {
      const selected = items.get(id)
      if (!selected) throw new Error('test fixture missing item')
      return selected
    },
    get afterMediaRead() { return afterMediaRead },
    set afterMediaRead(callback: (() => void) | undefined) { afterMediaRead = callback },
  }
}

function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

function driveMetadata(item: FakeItem): Omit<FakeItem, 'bytes'> {
  return structuredClone({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parents: item.parents,
    trashed: item.trashed,
    appProperties: item.appProperties,
    permissions: item.permissions,
    version: item.version,
    ...(item.size === undefined ? {} : { size: item.size }),
  })
}
