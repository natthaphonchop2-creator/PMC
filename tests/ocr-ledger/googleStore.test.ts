import { describe, expect, it } from 'vitest'
import type { OcrDraft, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts'
import type { OcrDrivePort, OcrSheetsPort } from '../../server/ocr-ledger/googleClient'
import { createGoogleOcrStore } from '../../server/ocr-ledger/googleStore'

class MemorySheets implements OcrSheetsPort {
  readonly books = new Map<string, Map<string, unknown[][]>>()
  readonly creates: Array<{ title: string; tabs: string[] }> = []

  async batchGet(spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    const book = this.books.get(spreadsheetId) ?? new Map<string, unknown[][]>()
    return Object.fromEntries(ranges.map((range) => [range, structuredClone(book.get(tabName(range)) ?? [])]))
  }

  async append(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    const book = this.book(spreadsheetId)
    book.set(tab, [...(book.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    const rowNumber = Number(/!(?:[A-Z]+)(\d+)/.exec(range)?.[1] ?? 0)
    const book = this.book(spreadsheetId)
    const current = book.get(tab) ?? []
    const next = [...current]
    for (const [offset, input] of rows.entries()) {
      const currentRow = next[Math.max(rowNumber - 1, 0) + offset] ?? []
      // Sheets Values API skips null input values; only an empty string clears a cell.
      next[Math.max(rowNumber - 1, 0) + offset] = input.map((value, index) => value === null ? currentRow[index] : value)
    }
    book.set(tab, next)
  }

  async batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    await Promise.all(data.map((entry) => this.update(spreadsheetId, entry.range, entry.values)))
  }

  async create(title: string, tabs: string[]): Promise<string> {
    const id = `sheet-${this.creates.length + 1}`
    this.creates.push({ title, tabs: [...tabs] })
    const book = this.book(id)
    for (const tab of tabs) book.set(tab, [])
    return id
  }

  rows(spreadsheetId: string, tab: string): unknown[][] {
    return structuredClone(this.book(spreadsheetId).get(tab) ?? [])
  }

  private book(id: string): Map<string, unknown[][]> {
    let book = this.books.get(id)
    if (!book) {
      book = new Map()
      this.books.set(id, book)
    }
    return book
  }
}

class MemoryDrive implements OcrDrivePort {
  async createFolder(name: string, parentId?: string): Promise<string> { return `${parentId ?? 'root'}:${name}` }
  async uploadImage(): Promise<string> { return 'image-1' }
  async downloadImage(): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }> {
    return { bytes: Buffer.from('image'), mimeType: 'image/jpeg' }
  }
}

const queueJob = (overrides: Partial<OcrQueueJob> = {}): OcrQueueJob => ({
  jobId: 'job-1', jobType: 'INTAKE', documentId: 'OCR-20260822-abc123', idempotencyKey: 'line-message-1',
  payloadJson: '{"messageId":"message-1"}', state: 'QUEUED', attempts: 0,
  availableAt: '2026-08-22T10:00:00.000Z', leaseUntil: null, lastErrorCode: null,
  createdAt: '2026-08-22T10:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z',
  ...overrides,
})

const draft = (overrides: Partial<OcrDraft> = {}): OcrDraft => ({
  documentId: 'OCR-20260822-abc123', documentType: 'RECEIPT', direction: 'EXPENSE', state: 'PENDING_REVIEW',
  documentDate: '2026-08-22', documentTime: null, counterpartyName: 'PMC Supplier', currency: 'THB',
  subtotal: 100, discountAmount: 0, taxAmount: 7, serviceCharge: 0, grandTotal: 107,
  referenceNumber: 'R-1', categoryId: 'office', note: null, sourceImageFileId: 'image-1', sourceImageSha256: 'hash-1',
  sourceLineMessageId: 'message-1', sourceLineUserId: 'U1', confidenceByField: {}, senderName: null, senderBank: null,
  senderAccountMasked: null, receiverName: null, receiverBank: null, receiverAccountMasked: null, transferDate: null,
  transferTime: null, amount: null, merchantName: 'PMC Supplier', merchantTaxId: null, branch: null, receiptNumber: 'R-1',
  receiptDate: '2026-08-22', paymentMethod: null, draftVersion: 1, confirmedBy: null, confirmedAt: null,
  verificationStatus: null, warnings: [],
  lineItems: [{ documentId: 'OCR-20260822-abc123', lineNumber: 1, description: 'Paper', quantity: 1, unit: 'pack', unitPrice: 100, discountAmount: 0, taxAmount: 7, lineTotal: 107, categoryId: 'office', confidence: 0.99 }],
  ...overrides,
})

function tabName(range: string): string {
  return range.replace(/^'/, '').replace(/'.*$/, '').split('!')[0]
}

describe('Google OCR ledger store', () => {
  it('returns the first queue job when the idempotency key repeats', async () => {
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets: new MemorySheets(), drive: new MemoryDrive() })
    const first = await store.appendJob(queueJob())
    const repeated = await store.appendJob(queueJob({ jobId: 'job-2' }))

    expect(repeated.jobId).toBe('job-1')
    expect(await store.listJobs()).toHaveLength(1)
    expect(first).toEqual(repeated)
  })

  it('leases only available work and increments attempts exactly once', async () => {
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets: new MemorySheets(), drive: new MemoryDrive() })
    await store.appendJob(queueJob({ jobId: 'available', idempotencyKey: 'available' }))
    await store.appendJob(queueJob({ jobId: 'leased', idempotencyKey: 'leased', leaseUntil: '2026-08-22T10:30:00.000Z' }))

    const leased = await store.leaseJobs({ now: '2026-08-22T10:00:00.000Z', leaseSeconds: 60, limit: 10 })

    expect(leased).toEqual([expect.objectContaining({ jobId: 'available', state: 'LEASED', attempts: 1, leaseUntil: '2026-08-22T10:01:00.000Z' })])
    expect((await store.listJobs()).find((job) => job.jobId === 'leased')).toMatchObject({ attempts: 0, state: 'QUEUED' })
  })

  it('replaces the current draft version without writing confirmed ledger tabs', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.saveDraft(draft())
    await store.saveDraft(draft({ draftVersion: 2, note: 'corrected' }))

    expect(await store.getDraft('OCR-20260822-abc123')).toMatchObject({ draftVersion: 2, note: 'corrected' })
    expect(sheets.rows('master', 'DRAFTS')).toHaveLength(2)
    expect(sheets.rows('master', 'TRANSACTIONS')).toEqual([])
    expect(sheets.rows('master', 'LINE_ITEMS')).toEqual([])
  })

  it('clears removed draft fields and line rows with Google Sheets empty-string semantics', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.saveDraft(draft({ note: 'remove this note' }))
    await store.saveDraft(draft({ draftVersion: 2, note: null, lineItems: [] }))

    expect(await store.getDraft('OCR-20260822-abc123')).toMatchObject({ draftVersion: 2, note: null, lineItems: [] })
  })

  it('repairs a partial monthly write by document and line write keys without duplicates', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const document = draft()
    await store.finalizeDocument(document, { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' })

    const transactions = sheets.rows('monthly-2026-08', 'TRANSACTIONS')
    const header = transactions[0] as string[]
    const writingRow = [...transactions[1] as unknown[]]
    writingRow[header.indexOf('writeState')] = 'WRITING'
    await sheets.update('monthly-2026-08', 'TRANSACTIONS!A2', [writingRow])
    await store.finalizeDocument(document, { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' })

    const repairedTransactions = sheets.rows('monthly-2026-08', 'TRANSACTIONS')
    const lineItems = sheets.rows('monthly-2026-08', 'LINE_ITEMS')
    expect(repairedTransactions).toHaveLength(2)
    expect(repairedTransactions[1][header.indexOf('writeState')]).toBe('CONFIRMED')
    expect(lineItems).toHaveLength(2)
    expect((lineItems[1] as unknown[])[(lineItems[0] as string[]).indexOf('itemWriteKey')]).toBe('OCR-20260822-abc123:1')
  })

  it('rejects a monthly finalization that disagrees with the authoritative month index', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.finalizeDocument(draft(), { month: '2026-08', monthlySpreadsheetId: 'monthly-a' })

    await expect(store.finalizeDocument(draft({ documentId: 'OCR-20260822-def456' }), { month: '2026-08', monthlySpreadsheetId: 'monthly-b' }))
      .rejects.toThrow('Monthly ledger ID mismatch')
    expect(sheets.rows('monthly-b', 'TRANSACTIONS')).toEqual([])
  })

  it('rejects duplicate draft line numbers before writing a monthly transaction', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const duplicated = draft({
      lineItems: [
        draft().lineItems[0],
        { ...draft().lineItems[0], description: 'Duplicated visible line number' },
      ],
    })

    await expect(store.finalizeDocument(duplicated, { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' }))
      .rejects.toThrow('Duplicate line number')
    expect(sheets.rows('monthly-2026-08', 'TRANSACTIONS')).toEqual([])
  })

  it('returns only confirmed monthly headers for reporting reads', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.finalizeDocument(draft(), { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' })
    const rows = sheets.rows('monthly-2026-08', 'TRANSACTIONS')
    const header = rows[0] as string[]
    const pending = [...rows[1] as unknown[]]
    pending[header.indexOf('documentId')] = 'OCR-20260822-pending1'
    pending[header.indexOf('writeState')] = 'WRITING'
    await sheets.append('monthly-2026-08', 'TRANSACTIONS!A:ZZ', [pending])

    expect(await store.listConfirmedDocuments('monthly-2026-08')).toEqual([
      expect.objectContaining({ documentId: 'OCR-20260822-abc123', state: 'CONFIRMED' }),
    ])
  })
})
