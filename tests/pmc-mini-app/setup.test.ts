import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { ensureMiniAppWorkbook, MANAGED_TAB_HEADERS } from '../../server/pmc-mini-app/setup'

describe('PMC Mini App managed Sheet setup', () => {
  it('adds only missing managed tabs with exact headers and frozen first rows', async () => {
    const sheets = new SetupSheets([{ sheetId: 1, title: 'BOOKING_MASTER' }])

    await ensureMiniAppWorkbook({ spreadsheetId: 'sheet-1', sheets })

    expect(sheets.workbook.map(({ title }) => title)).toEqual([
      'BOOKING_MASTER', 'MINI_APP_REQUESTS', 'JERA_API_CACHE', 'JERA_SYNC_STATE', 'JERA_SYNC_AUDIT',
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
    expect(MANAGED_TAB_HEADERS.JERA_API_CACHE).toEqual(expect.arrayContaining([
      'branchName', 'patientName', 'totalSatang', 'paidAmountSatang', 'refundAmountSatang',
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
    this.headers.set(tab, structuredClone(rows[0] ?? []))
    this.headerWrites.push(tab)
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
