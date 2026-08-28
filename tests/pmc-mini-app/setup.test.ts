import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { ensureMiniAppWorkbook, MANAGED_TAB_HEADERS, migrateMiniAppAsyncRequestColumns } from '../../server/pmc-mini-app/setup'
import { MINI_APP_REQUEST_HEADERS } from '../../server/pmc-mini-app/store'

describe('PMC Mini App managed Sheet setup', () => {
  it('appends exactly the asynchronous request headers to the valid legacy header', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    const legacyHeaders = MINI_APP_REQUEST_HEADERS.slice(0, 28)
    sheets.headers.set('MINI_APP_REQUESTS', [...legacyHeaders])

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: [
        'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt',
        'processingStartedAt', 'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken',
      ],
    })

    expect(sheets.headers.get('MINI_APP_REQUESTS')).toEqual(MINI_APP_REQUEST_HEADERS)
    expect(sheets.headerWriteRanges).toEqual(["'MINI_APP_REQUESTS'!AC1:AK1"])
  })

  it('rejects a changed legacy request header without writes', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    const legacyHeaders = MINI_APP_REQUEST_HEADERS.slice(0, 28)
    legacyHeaders[4] = 'changedState'
    sheets.headers.set('MINI_APP_REQUESTS', legacyHeaders)

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).rejects.toThrow('incompatible header: MINI_APP_REQUESTS')

    expect(sheets.headerWrites).toEqual([])
    expect(sheets.headerWriteRanges).toEqual([])
  })

  it('appends only processingOwnerToken to the previously migrated async header', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    sheets.headers.set('MINI_APP_REQUESTS', MINI_APP_REQUEST_HEADERS.slice(0, -1))

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: ['processingOwnerToken'],
    })
    expect(sheets.headers.get('MINI_APP_REQUESTS')).toEqual(MINI_APP_REQUEST_HEADERS)
    expect(sheets.headerWriteRanges).toEqual(["'MINI_APP_REQUESTS'!AK1:AK1"])
  })

  it('adds only missing managed tabs with exact headers and frozen first rows', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'BOOKING_MASTER' }])

    await ensureMiniAppWorkbook({ spreadsheetId: 'sheet-1', sheets })

    expect(sheets.workbook.map(({ title }) => title)).toEqual([
      'BOOKING_MASTER', 'MINI_APP_REQUESTS', 'MINI_APP_LINK_ATTEMPTS', 'JERA_API_CACHE', 'JERA_SYNC_STATE', 'JERA_SYNC_AUDIT',
    ])
    for (const [tab, headers] of Object.entries(MANAGED_TAB_HEADERS)) {
      expect(sheets.headers.get(tab)).toEqual(headers)
      expect(sheets.frozenTabs).toContain(tab)
    }
    expect(sheets.deletedTabs).toEqual([])
  })

  it('rejects an incompatible non-empty managed header before changing the workbook', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    sheets.headers.set('MINI_APP_REQUESTS', ['wrong', 'columns'])

    await expect(ensureMiniAppWorkbook({ spreadsheetId: 'sheet-1', sheets })).rejects.toThrow('incompatible header: MINI_APP_REQUESTS')
    expect(sheets.workbook).toEqual([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    expect(sheets.frozenTabs).toEqual([])
  })

  it('preserves exact existing headers without rewriting their values', async () => {
    const workbook = Object.keys(MANAGED_TAB_HEADERS).map((title, index) => ({ sheetId: index + 1, title }))
    const sheets = new SetupSheets(workbook)
    for (const [tab, headers] of Object.entries(MANAGED_TAB_HEADERS)) sheets.headers.set(tab, [...headers])

    await ensureMiniAppWorkbook({ spreadsheetId: 'sheet-1', sheets })

    expect(sheets.headerWrites).toEqual([])
    expect(sheets.deletedTabs).toEqual([])
  })

  it('names stored monetary columns as integer satang and includes lease fields', () => {
    expect(MANAGED_TAB_HEADERS.MINI_APP_LINK_ATTEMPTS).toEqual([
      'lineUserIdHash', 'failureCount', 'windowStartedAt', 'lockedUntil', 'lastAttemptAt',
    ])
    expect(MANAGED_TAB_HEADERS.JERA_API_CACHE).toEqual(expect.arrayContaining([
      'branchName', 'patientName', 'totalSatang', 'paidAmountSatang', 'refundAmountSatang',
      'cashSatang', 'transferSatang', 'creditCardSatang', 'eWalletSatang', 'paymentLinkSatang', 'otherPaymentSatang',
      'itemCode', 'itemName', 'quantity', 'remainingQuantity', 'remainingValueSatang',
    ]))
    expect(MANAGED_TAB_HEADERS.JERA_SYNC_STATE).toEqual(expect.arrayContaining(['lastManualAt', 'leaseOwner', 'leaseExpiresAt']))
  })
})

class SetupSheets implements MiniAppSheetsPort {
  readonly workbook: Array<{ sheetId: number; title: string }>
  readonly headers = new Map<string, unknown[]>()
  readonly frozenTabs: string[] = []
  readonly deletedTabs: string[] = []
  readonly headerWrites: string[] = []
  readonly headerWriteRanges: string[] = []
  private nextSheetId: number

  constructor(workbook: Array<{ sheetId: number; title: string }>) {
    this.workbook = structuredClone(workbook)
    this.nextSheetId = Math.max(0, ...workbook.map(({ sheetId }) => sheetId)) + 1
  }

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    return Object.fromEntries(ranges.map((range) => {
      const headers = this.headers.get(tabName(range))
      return [range, headers ? [structuredClone(headers)] : []]
    }))
  }

  async append(): Promise<void> { return undefined }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    const startColumn = columnNumber(range.match(/!([A-Z]+)\d+/)?.[1] ?? 'A')
    const next = [...(this.headers.get(tab) ?? [])]
    next.splice(startColumn - 1, (rows[0] ?? []).length, ...structuredClone(rows[0] ?? []))
    this.headers.set(tab, next)
    this.headerWrites.push(tab)
    this.headerWriteRanges.push(range)
  }

  async batchUpdate(): Promise<void> { return undefined }

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> {
    return structuredClone(this.workbook)
  }

  async applyWorkbookRequests(_spreadsheetId: string, requests: Array<Record<string, unknown>>): Promise<void> {
    for (const request of requests) {
      const addSheet = request.addSheet as { properties?: { title?: string } } | undefined
      if (addSheet?.properties?.title) {
        this.workbook.push({ sheetId: this.nextSheetId++, title: addSheet.properties.title })
        continue
      }
      const update = request.updateSheetProperties as { properties?: { sheetId?: number; gridProperties?: { frozenRowCount?: number } } } | undefined
      if (update?.properties?.gridProperties?.frozenRowCount === 1) {
        const tab = this.workbook.find(({ sheetId }) => sheetId === update.properties?.sheetId)?.title
        if (tab) this.frozenTabs.push(tab)
        continue
      }
      const deletion = request.deleteSheet as { sheetId?: number } | undefined
      if (typeof deletion?.sheetId === 'number') {
        const tab = this.workbook.find(({ sheetId }) => sheetId === deletion.sheetId)?.title
        if (tab) this.deletedTabs.push(tab)
      }
    }
  }
}

function tabName(range: string): string {
  return range.split('!', 1)[0]!.replaceAll("'", '')
}

function columnNumber(value: string): number {
  return [...value].reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0)
}
