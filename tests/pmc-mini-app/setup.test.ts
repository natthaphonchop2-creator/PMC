import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { ensureMiniAppWorkbook, MANAGED_TAB_HEADERS, migrateMiniAppAsyncRequestColumns } from '../../server/pmc-mini-app/setup'
import { MINI_APP_REQUEST_HEADERS } from '../../server/pmc-mini-app/store'

describe('PMC Mini App managed Sheet setup', () => {
  it('atomically grows the grid and appends every asynchronous header to the valid legacy header', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS', columnCount: 36 }])
    const legacyHeaders = MINI_APP_REQUEST_HEADERS.slice(0, 28)
    sheets.headers.set('MINI_APP_REQUESTS', [...legacyHeaders])

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: [
        'paymentEvidenceObjectKeysJson', 'chatEvidenceObjectKeysJson', 'taskName', 'queuedAt',
        'processingStartedAt', 'processingLeaseUntil', 'lastProgressAt', 'attemptCount', 'processingOwnerToken',
        'evidenceProjectionHash',
      ],
    })

    expect(sheets.headers.get('MINI_APP_REQUESTS')).toEqual(MINI_APP_REQUEST_HEADERS)
    expect(sheets.workbookRequests).toEqual([[
      { appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 2 } },
      {
        updateCells: {
          range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 28, endColumnIndex: 38 },
          rows: [{ values: MINI_APP_REQUEST_HEADERS.slice(28).map((stringValue) => ({ userEnteredValue: { stringValue } })) }],
          fields: 'userEnteredValue',
        },
      },
    ]])
    expect(sheets.workbook.find(({ title }) => title === 'MINI_APP_REQUESTS')?.columnCount).toBe(38)
  })

  it('rejects a changed legacy request header without writes', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS' }])
    const legacyHeaders = MINI_APP_REQUEST_HEADERS.slice(0, 28)
    legacyHeaders[4] = 'changedState'
    sheets.headers.set('MINI_APP_REQUESTS', legacyHeaders)

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).rejects.toThrow('incompatible header: MINI_APP_REQUESTS')

    expect(sheets.headerWrites).toEqual([])
    expect(sheets.headerWriteRanges).toEqual([])
    expect(sheets.workbookRequests).toEqual([])
  })

  it('grows the grid for the two current asynchronous headers missing from a 36-column sheet', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS', columnCount: 36 }])
    sheets.headers.set('MINI_APP_REQUESTS', MINI_APP_REQUEST_HEADERS.slice(0, -2))

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: ['processingOwnerToken', 'evidenceProjectionHash'],
    })
    expect(sheets.headers.get('MINI_APP_REQUESTS')).toEqual(MINI_APP_REQUEST_HEADERS)
    expect(sheets.workbookRequests).toEqual([[
      { appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 2 } },
      {
        updateCells: {
          range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 36, endColumnIndex: 38 },
          rows: [{ values: [
            { userEnteredValue: { stringValue: 'processingOwnerToken' } },
            { userEnteredValue: { stringValue: 'evidenceProjectionHash' } },
          ] }],
          fields: 'userEnteredValue',
        },
      },
    ]])
  })

  it('appends only the final asynchronous header when spare grid capacity exists', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS', columnCount: 38 }])
    sheets.headers.set('MINI_APP_REQUESTS', MINI_APP_REQUEST_HEADERS.slice(0, -1))

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: ['evidenceProjectionHash'],
    })
    expect(sheets.headers.get('MINI_APP_REQUESTS')).toEqual(MINI_APP_REQUEST_HEADERS)
    expect(sheets.workbookRequests).toEqual([[
      {
        updateCells: {
          range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 37, endColumnIndex: 38 },
          rows: [{ values: [{ userEnteredValue: { stringValue: 'evidenceProjectionHash' } }] }],
          fields: 'userEnteredValue',
        },
      },
    ]])
  })

  it('makes no additional workbook requests on a second migration call', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'MINI_APP_REQUESTS', columnCount: 38 }])
    sheets.headers.set('MINI_APP_REQUESTS', MINI_APP_REQUEST_HEADERS.slice(0, -1))

    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({
      appendedColumns: ['evidenceProjectionHash'],
    })
    await expect(migrateMiniAppAsyncRequestColumns({ spreadsheetId: 'sheet-1', sheets })).resolves.toEqual({ appendedColumns: [] })

    expect(sheets.workbookRequests).toHaveLength(1)
  })

  it('adds only missing managed tabs with exact headers and frozen first rows', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'BOOKING_MASTER' }])

    await ensureMiniAppWorkbook({ spreadsheetId: 'sheet-1', sheets })

    expect(sheets.workbook.map(({ title }) => title)).toEqual([
      'BOOKING_MASTER', 'MINI_APP_REQUESTS', 'MINI_APP_LINK_ATTEMPTS', 'JERA_API_CACHE', 'JERA_SYNC_STATE', 'JERA_SYNC_AUDIT',
      'JERA_PAYMENT_DETAIL_CACHE', 'JERA_PAYMENT_DETAIL_LINES', 'JERA_ALLOCATION_COVERAGE',
      'STOCK_PRODUCTS', 'STOCK_LEDGER', 'STOCK_AUDIT',
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

  it('defines the exact bounded JERA allocation cache headers', () => {
    expect(MANAGED_TAB_HEADERS.JERA_PAYMENT_DETAIL_CACHE).toEqual([
      'detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash',
      'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated',
    ])
    expect(MANAGED_TAB_HEADERS.JERA_PAYMENT_DETAIL_LINES).toEqual([
      'detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang',
    ])
    expect(MANAGED_TAB_HEADERS.JERA_ALLOCATION_COVERAGE).toEqual([
      'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
      'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
      'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
      'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
    ])
  })

  it('defines the exact managed Stock tab headers', () => {
    expect(Object.keys(MANAGED_TAB_HEADERS)).toEqual(expect.arrayContaining([
      'STOCK_PRODUCTS', 'STOCK_LEDGER', 'STOCK_AUDIT',
    ]))
    expect(MANAGED_TAB_HEADERS.STOCK_PRODUCTS).toEqual([
      'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
      'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
    ])
    expect(MANAGED_TAB_HEADERS.STOCK_LEDGER).toEqual([
      'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
      'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
      'reason', 'idempotencyKey', 'createdAt',
    ])
    expect(MANAGED_TAB_HEADERS.STOCK_AUDIT).toEqual([
      'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
      'targetProductIdsJson', 'correlationId', 'createdAt',
    ])
  })
})

class SetupSheets implements MiniAppSheetsPort {
  readonly workbook: Array<{ sheetId: number; title: string; columnCount?: number }>
  readonly headers = new Map<string, unknown[]>()
  readonly frozenTabs: string[] = []
  readonly deletedTabs: string[] = []
  readonly headerWrites: string[] = []
  readonly headerWriteRanges: string[] = []
  readonly workbookRequests: Array<Array<Record<string, unknown>>> = []
  private nextSheetId: number

  constructor(workbook: Array<{ sheetId: number; title: string; columnCount?: number }>) {
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

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string; columnCount?: number }>> {
    return structuredClone(this.workbook)
  }

  async applyWorkbookRequests(_spreadsheetId: string, requests: Array<Record<string, unknown>>): Promise<void> {
    this.workbookRequests.push(structuredClone(requests))
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
      const appendDimension = request.appendDimension as { sheetId?: number; dimension?: string; length?: number } | undefined
      if (appendDimension?.dimension === 'COLUMNS' && typeof appendDimension.sheetId === 'number' && typeof appendDimension.length === 'number') {
        const sheet = this.workbook.find(({ sheetId }) => sheetId === appendDimension.sheetId)
        if (sheet) sheet.columnCount = (sheet.columnCount ?? 0) + appendDimension.length
        continue
      }
      const updateCells = request.updateCells as {
        range?: { sheetId?: number; startColumnIndex?: number }
        rows?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }>
      } | undefined
      if (updateCells?.range && typeof updateCells.range.sheetId === 'number' && typeof updateCells.range.startColumnIndex === 'number') {
        const tab = this.workbook.find(({ sheetId }) => sheetId === updateCells.range?.sheetId)?.title
        const values = updateCells.rows?.[0]?.values?.map(({ userEnteredValue }) => userEnteredValue?.stringValue ?? '') ?? []
        if (tab) {
          const header = [...(this.headers.get(tab) ?? [])]
          header.splice(updateCells.range.startColumnIndex, values.length, ...values)
          this.headers.set(tab, header)
        }
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
