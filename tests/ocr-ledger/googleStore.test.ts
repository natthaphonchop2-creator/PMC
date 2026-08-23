import { describe, expect, it } from 'vitest'
import type { OcrDraft, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts'
import type { OcrDrivePort, OcrSheetsPort } from '../../server/ocr-ledger/googleClient'
import { createGoogleOcrStore } from '../../server/ocr-ledger/googleStore'

class MemorySheets implements OcrSheetsPort {
  readonly books = new Map<string, Map<string, unknown[][]>>()
  readonly creates: Array<{ title: string; tabs: string[] }> = []
  failNextClearTab: string | null = null

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

  async clear(spreadsheetId: string, range: string): Promise<void> {
    const tab = tabName(range)
    if (this.failNextClearTab === tab) {
      this.failNextClearTab = null
      throw new Error('synthetic clear failure')
    }
    this.book(spreadsheetId).set(tab, [])
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
  readonly spreadsheetMoves: Array<{ fileId: string; parentId: string }> = []
  async createFolder(name: string, parentId?: string): Promise<string> { return `${parentId ?? 'root'}:${name}` }
  async findFolder(): Promise<string | null> { return null }
  async moveFile(): Promise<void> {}
  async moveSpreadsheet(fileId: string, parentId: string): Promise<void> { this.spreadsheetMoves.push({ fileId, parentId }) }
  async findImageByDocumentId(): Promise<null> { return null }
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

  it('serializes concurrent idempotent appends across store instances in one process', async () => {
    const sheets = new MemorySheets()
    const left = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const right = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })

    const [first, second] = await Promise.all([
      left.appendJob(queueJob({ jobId: 'job-left' })),
      right.appendJob(queueJob({ jobId: 'job-right' })),
    ])

    expect(first.jobId).toBe('job-left')
    expect(second.jobId).toBe('job-left')
    expect(await left.listJobs()).toHaveLength(1)
  })

  it('leases only available work and increments attempts exactly once', async () => {
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets: new MemorySheets(), drive: new MemoryDrive() })
    await store.appendJob(queueJob({ jobId: 'available', idempotencyKey: 'available' }))
    await store.appendJob(queueJob({ jobId: 'leased', idempotencyKey: 'leased', leaseUntil: '2026-08-22T10:30:00.000Z' }))

    const leased = await store.leaseJobs({ now: '2026-08-22T10:00:00.000Z', leaseSeconds: 60, limit: 10 })

    expect(leased).toEqual([expect.objectContaining({ jobId: 'available', state: 'LEASED', attempts: 1, leaseUntil: '2026-08-22T10:01:00.000Z' })])
    expect((await store.listJobs()).find((job) => job.jobId === 'leased')).toMatchObject({ attempts: 0, state: 'QUEUED' })
  })

  it('serializes concurrent leases so one queue row is never claimed twice in one process', async () => {
    const sheets = new MemorySheets()
    const left = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const right = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await left.appendJob(queueJob())

    const [first, second] = await Promise.all([
      left.leaseJobs({ now: '2026-08-22T10:00:00.000Z', leaseSeconds: 60, limit: 1 }),
      right.leaseJobs({ now: '2026-08-22T10:00:00.000Z', leaseSeconds: 60, limit: 1 }),
    ])

    expect([...first, ...second]).toHaveLength(1)
    expect([...first, ...second][0]).toMatchObject({ jobId: 'job-1', attempts: 1 })
  })

  it('persists one first-wins terminal decision marker and returns it to competing actions', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const base = {
      documentId: 'OCR-20260822-abc123', decision: 'CONFIRM' as const, actorLineUserId: 'U1', actorDisplayName: 'Resolved Staff',
      decidedAt: '2026-08-22T10:01:00.000Z', sourceJobId: 'confirm', expectedVersion: 3,
    }

    expect(await store.claimTerminalDecision(base)).toEqual({ record: base, claimed: true })
    expect(await store.getTerminalDecision(base.documentId)).toEqual(base)
    expect(await store.claimTerminalDecision(base)).toEqual({ record: base, claimed: false })
    expect(await store.claimTerminalDecision({ ...base, decision: 'CANCEL', sourceJobId: 'cancel' })).toEqual({ record: base, claimed: false })
    expect(sheets.rows('master', 'AUDIT_LOG')).toHaveLength(2)
  })

  it('persists queue outcomes, sanitized errors, audits, duplicate lookup, and monthly allocation', async () => {
    const sheets = new MemorySheets()
    const drive = new MemoryDrive()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', monthlyLedgersFolderId: 'monthly-folder', sheets, drive })
    await store.appendJob(queueJob())
    const completed = queueJob({ state: 'DONE', attempts: 1, leaseUntil: null, updatedAt: '2026-08-22T10:01:00.000Z' })
    await store.updateJob(completed)
    await store.saveDraft(draft())
    await store.appendError({ jobId: 'job-1', documentId: completed.documentId, code: 'OCR_RATE_LIMIT', createdAt: completed.updatedAt })
    await store.appendAudit({
      documentId: completed.documentId!, action: 'EDIT', actorLineUserId: 'U1', actorDisplayName: 'Staff',
      createdAt: completed.updatedAt, payloadJson: '{"draftVersion":2}',
    })
    await store.appendError({ jobId: 'job-1', documentId: completed.documentId, code: 'OCR_RATE_LIMIT', createdAt: completed.updatedAt })
    await store.appendAudit({
      documentId: completed.documentId!, action: 'EDIT', actorLineUserId: 'U1', actorDisplayName: 'Staff',
      createdAt: completed.updatedAt, payloadJson: '{"draftVersion":2}',
    })

    expect(await store.listJobs()).toEqual([completed])
    expect(await store.findDraftByImageSha256('hash-1')).toMatchObject({ documentId: completed.documentId })
    expect(await store.findDraftByImageSha256('missing')).toBeNull()
    expect(sheets.rows('master', 'ERRORS')).toHaveLength(2)
    expect(sheets.rows('master', 'AUDIT_LOG')).toHaveLength(2)

    const first = await store.ensureMonthlyLedger('2026-08')
    const repeated = await store.ensureMonthlyLedger('2026-08')
    expect(first).toEqual({ month: '2026-08', monthlySpreadsheetId: 'sheet-1' })
    expect(repeated).toEqual(first)
    expect(sheets.creates).toEqual([{ title: '2026-08 PMC OCR Ledger', tabs: ['TRANSACTIONS', 'LINE_ITEMS', 'DAILY_SUMMARY', 'CATEGORY_SUMMARY'] }])
    expect(drive.spreadsheetMoves).toEqual([
      { fileId: 'sheet-1', parentId: 'monthly-folder' },
      { fileId: 'sheet-1', parentId: 'monthly-folder' },
    ])
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

  it('reads validated CONFIG report settings with runtime defaults for missing or invalid values', async () => {
    const sheets = new MemorySheets()
    await sheets.append('master', 'CONFIG!A:ZZ', [
      ['key', 'value', 'updatedAt'],
      ['dailyReportEnabled', 'true', '2026-08-22T00:00:00.000Z'],
      ['dailyReportTime', '09:30', '2026-08-22T00:00:00.000Z'],
      ['dashboardUrl', 'https://docs.google.com/spreadsheets/d/master/edit#gid=0', '2026-08-22T00:00:00.000Z'],
    ])
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })

    await expect(store.readReportSettings({
      dailyReportEnabled: false, dailyReportTime: '20:00', dashboardUrl: 'https://docs.google.com/spreadsheets/d/default/edit#gid=0',
    })).resolves.toEqual({
      dailyReportEnabled: true, dailyReportTime: '09:30', dashboardUrl: 'https://docs.google.com/spreadsheets/d/master/edit#gid=0',
    })

    await sheets.update('master', 'CONFIG!A3', [['dailyReportTime', '99:99', '2026-08-22T00:00:00.000Z']])
    expect((await store.readReportSettings({
      dailyReportEnabled: false, dailyReportTime: '20:00', dashboardUrl: 'https://docs.google.com/spreadsheets/d/default/edit#gid=0',
    })).dailyReportTime).toBe('20:00')
  })

  it('derives failed-before-draft and duplicate evidence from durable queue, error, and draft rows using received time', async () => {
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets: new MemorySheets(), drive: new MemoryDrive() })
    const failed = queueJob({
      jobId: 'failed', documentId: 'OCR-20260822-failed1', idempotencyKey: 'failed', state: 'FAILED',
      payloadJson: JSON.stringify({ receivedAt: '2026-08-22T01:00:00.000Z' }),
    })
    const duplicate = queueJob({
      jobId: 'duplicate', documentId: 'OCR-20260822-duplicate1', idempotencyKey: 'duplicate', state: 'DONE',
      payloadJson: JSON.stringify({ receivedAt: '2026-08-22T02:00:00.000Z', duplicateOfDocumentId: 'OCR-20260821-existing1' }),
    })
    await store.appendJob(failed)
    await store.appendJob(duplicate)
    await store.appendError({ jobId: failed.jobId, documentId: failed.documentId, code: 'LINE_DOWNLOAD_FAILED', createdAt: failed.updatedAt })

    expect(await store.listOperationalEvidence()).toEqual(expect.arrayContaining([
      { documentId: failed.documentId, receivedAt: '2026-08-22T01:00:00.000Z', state: 'FAILED', duplicateWarning: false },
      { documentId: duplicate.documentId, receivedAt: '2026-08-22T02:00:00.000Z', state: null, duplicateWarning: true },
    ]))
  })

  it('refreshes all derived Sheet surfaces from confirmed-only money and records aggregate freshness', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    const confirmed = draft({ state: 'CONFIRMED', confirmedBy: 'Staff', confirmedAt: '2026-08-22T10:00:00.000Z', verificationStatus: 'STAFF_CONFIRMED', direction: 'INCOME', grandTotal: 107 })
    await store.finalizeDocument(confirmed, { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' })
    await store.saveDraft(draft({ documentId: 'OCR-20260822-pending1', grandTotal: 9999, state: 'PENDING_REVIEW' }))

    const result = await store.refreshDerivedSurfaces('2026-08-22T11:00:00.000Z')

    expect(result).toMatchObject({ dashboard: true, recentTransactions: true, pendingReview: true, monthlySummaries: { '2026-08': true } })
    expect(JSON.stringify(sheets.rows('master', 'DASHBOARD'))).toContain('confirmedIncome')
    expect(JSON.stringify(sheets.rows('master', 'DASHBOARD'))).toContain('107')
    expect(JSON.stringify(sheets.rows('master', 'DASHBOARD'))).not.toContain('9999')
    expect(JSON.stringify(sheets.rows('master', 'RECENT_TRANSACTIONS'))).toContain('OCR-20260822-abc123')
    expect(JSON.stringify(sheets.rows('master', 'RECENT_TRANSACTIONS'))).not.toContain('OCR-20260822-pending1')
    expect(JSON.stringify(sheets.rows('master', 'PENDING_REVIEW'))).toContain('OCR-20260822-pending1')
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'DAILY_SUMMARY'))).not.toContain('9999')
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'CATEGORY_SUMMARY'))).not.toContain('9999')
    expect(JSON.stringify(sheets.rows('master', 'MONTHLY_INDEX'))).toContain('2026-08-22T11:00:00.000Z')
  })

  it('repairs an independently failed derived surface later without duplicating confirmed ledger data', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.finalizeDocument(draft({ state: 'CONFIRMED' }), { month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08' })
    sheets.failNextClearTab = 'DASHBOARD'

    const failed = await store.refreshDerivedSurfaces('2026-08-22T11:00:00.000Z')
    const repaired = await store.refreshDerivedSurfaces('2026-08-22T11:01:00.000Z')

    expect(failed).toMatchObject({ dashboard: false, recentTransactions: true, pendingReview: true })
    expect(repaired.dashboard).toBe(true)
    expect(sheets.rows('monthly-2026-08', 'TRANSACTIONS')).toHaveLength(2)
    expect(sheets.rows('master', 'RECENT_TRANSACTIONS')).toHaveLength(2)
  })

  it('refreshes category summary even when daily summary fails and advances freshness only after both succeed', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleOcrStore({ masterSpreadsheetId: 'master', sheets, drive: new MemoryDrive() })
    await store.finalizeDocument(draft({ state: 'CONFIRMED', direction: 'EXPENSE', categoryId: 'office', grandTotal: 107 }), {
      month: '2026-08', monthlySpreadsheetId: 'monthly-2026-08',
    })
    await sheets.update('monthly-2026-08', 'DAILY_SUMMARY!A1', [['stale-daily']])
    await sheets.update('monthly-2026-08', 'CATEGORY_SUMMARY!A1', [['stale-category']])
    sheets.failNextClearTab = 'DAILY_SUMMARY'

    const partial = await store.refreshDerivedSurfaces('2026-08-22T11:00:00.000Z')

    expect(partial.monthlySummaries).toEqual({ '2026-08': false })
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'DAILY_SUMMARY'))).toContain('stale-daily')
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'CATEGORY_SUMMARY'))).toContain('office')
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'CATEGORY_SUMMARY'))).not.toContain('stale-category')
    expect(JSON.stringify(sheets.rows('master', 'MONTHLY_INDEX'))).not.toContain('2026-08-22T11:00:00.000Z')

    const repaired = await store.refreshDerivedSurfaces('2026-08-22T11:01:00.000Z')

    expect(repaired.monthlySummaries).toEqual({ '2026-08': true })
    expect(JSON.stringify(sheets.rows('monthly-2026-08', 'DAILY_SUMMARY'))).toContain('2026-08-22')
    expect(JSON.stringify(sheets.rows('master', 'MONTHLY_INDEX'))).toContain('2026-08-22T11:01:00.000Z')
  })
})
