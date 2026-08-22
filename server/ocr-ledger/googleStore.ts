import type { OcrDocument, OcrDraft, OcrLineItem, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts'
import type { OcrDrivePort, OcrSheetsPort } from './googleClient.js'

export const MASTER_TABS = [
  'DASHBOARD', 'RECENT_TRANSACTIONS', 'PENDING_REVIEW', 'CATEGORIES', 'CONFIG', 'OCR_QUEUE', 'DRAFTS',
  'DRAFT_LINE_ITEMS', 'ERRORS', 'AUDIT_LOG', 'MONTHLY_INDEX',
] as const
export const MONTHLY_TABS = ['TRANSACTIONS', 'LINE_ITEMS', 'DAILY_SUMMARY', 'CATEGORY_SUMMARY'] as const

const DOCUMENT_COLUMNS = [
  'documentId', 'documentType', 'direction', 'state', 'documentDate', 'documentTime', 'counterpartyName', 'currency',
  'subtotal', 'discountAmount', 'taxAmount', 'serviceCharge', 'grandTotal', 'referenceNumber', 'categoryId', 'note',
  'sourceImageFileId', 'sourceImageSha256', 'sourceLineMessageId', 'sourceLineUserId', 'confidenceByField', 'senderName',
  'senderBank', 'senderAccountMasked', 'receiverName', 'receiverBank', 'receiverAccountMasked', 'transferDate',
  'transferTime', 'amount', 'merchantName', 'merchantTaxId', 'branch', 'receiptNumber', 'receiptDate', 'paymentMethod',
  'draftVersion', 'confirmedBy', 'confirmedAt', 'verificationStatus', 'warnings',
] as const satisfies readonly (keyof OcrDocument)[]

const QUEUE_COLUMNS = ['jobId', 'jobType', 'documentId', 'idempotencyKey', 'payloadJson', 'state', 'attempts', 'availableAt', 'leaseUntil', 'lastErrorCode', 'createdAt', 'updatedAt'] as const satisfies readonly (keyof OcrQueueJob)[]
const DRAFT_LINE_COLUMNS = ['documentId', 'draftVersion', 'lineNumber', 'description', 'quantity', 'unit', 'unitPrice', 'discountAmount', 'taxAmount', 'lineTotal', 'categoryId', 'confidence'] as const
const TRANSACTION_COLUMNS = [...DOCUMENT_COLUMNS, 'writeState', 'schemaVersion'] as const
const LINE_ITEM_COLUMNS = ['itemWriteKey', ...DRAFT_LINE_COLUMNS.filter((column) => column !== 'draftVersion'), 'schemaVersion'] as const

export const MASTER_HEADERS: Record<(typeof MASTER_TABS)[number], readonly string[]> = {
  DASHBOARD: [], RECENT_TRANSACTIONS: [...TRANSACTION_COLUMNS], PENDING_REVIEW: [...DOCUMENT_COLUMNS],
  CATEGORIES: ['categoryId', 'name', 'direction', 'active', 'updatedAt'], CONFIG: ['key', 'value', 'updatedAt'],
  OCR_QUEUE: [...QUEUE_COLUMNS], DRAFTS: [...DOCUMENT_COLUMNS], DRAFT_LINE_ITEMS: [...DRAFT_LINE_COLUMNS],
  ERRORS: ['jobId', 'documentId', 'code', 'createdAt'], AUDIT_LOG: ['documentId', 'action', 'actorLineUserId', 'actorDisplayName', 'createdAt', 'payloadJson'],
  MONTHLY_INDEX: ['month', 'monthlySpreadsheetId', 'status', 'aggregateFreshAt', 'updatedAt'],
}

export const MONTHLY_HEADERS: Record<(typeof MONTHLY_TABS)[number], readonly string[]> = {
  TRANSACTIONS: [...TRANSACTION_COLUMNS], LINE_ITEMS: [...LINE_ITEM_COLUMNS],
  DAILY_SUMMARY: ['documentDate', 'direction', 'documentCount', 'grandTotal', 'updatedAt'],
  CATEGORY_SUMMARY: ['categoryId', 'direction', 'documentCount', 'grandTotal', 'updatedAt'],
}

export interface OcrLedgerStore {
  appendJob(job: OcrQueueJob): Promise<OcrQueueJob>
  listJobs(): Promise<OcrQueueJob[]>
  leaseJobs(input: { now: string; leaseSeconds: number; limit: number }): Promise<OcrQueueJob[]>
  saveDraft(draft: OcrDraft): Promise<void>
  getDraft(documentId: string): Promise<OcrDraft | null>
  finalizeDocument(draft: OcrDraft, ledger: { month: string; monthlySpreadsheetId: string }): Promise<void>
  listConfirmedDocuments(monthlySpreadsheetId: string): Promise<OcrDocument[]>
}

export function createGoogleOcrStore(input: { masterSpreadsheetId: string; sheets: OcrSheetsPort; drive: OcrDrivePort }): OcrLedgerStore {
  const { masterSpreadsheetId, sheets } = input

  async function queueRows(): Promise<RowWithPosition<OcrQueueJob>[]> {
    return readRows<OcrQueueJob>(masterSpreadsheetId, 'OCR_QUEUE', QUEUE_COLUMNS)
  }

  return {
    async appendJob(job) {
      const rows = await queueRows()
      const existing = rows.find((row) => row.value.idempotencyKey === job.idempotencyKey)
      if (existing) return existing.value
      await appendRow(masterSpreadsheetId, 'OCR_QUEUE', QUEUE_COLUMNS, job)
      return job
    },
    async listJobs() {
      return (await queueRows()).map((row) => row.value)
    },
    async leaseJobs({ now, leaseSeconds, limit }) {
      const candidates = (await queueRows())
        .filter(({ value }) => value.availableAt <= now && (value.state === 'QUEUED' || value.state === 'LEASED') && (!value.leaseUntil || value.leaseUntil <= now))
        .slice(0, limit)
      const leaseUntil = new Date(new Date(now).getTime() + leaseSeconds * 1000).toISOString()
      const leased = candidates.map(({ value }) => ({ ...value, state: 'LEASED' as const, attempts: value.attempts + 1, leaseUntil, updatedAt: now }))
      await Promise.all(candidates.map(({ rowNumber }, index) => updateRow(masterSpreadsheetId, 'OCR_QUEUE', rowNumber, QUEUE_COLUMNS, leased[index])))
      return leased
    },
    async saveDraft(draft) {
      const draftRows = await readRows<OcrDocument>(masterSpreadsheetId, 'DRAFTS', DOCUMENT_COLUMNS)
      const existing = draftRows.find((row) => row.value.documentId === draft.documentId)
      const header = documentRow(draft)
      if (existing) await updateRow(masterSpreadsheetId, 'DRAFTS', existing.rowNumber, DOCUMENT_COLUMNS, header)
      else await appendRow(masterSpreadsheetId, 'DRAFTS', DOCUMENT_COLUMNS, header)

      const lineRows = await readRows<Record<string, unknown>>(masterSpreadsheetId, 'DRAFT_LINE_ITEMS', DRAFT_LINE_COLUMNS)
      const current = lineRows.filter((row) => row.value.documentId === draft.documentId)
      const next = draft.lineItems.map((line) => lineItemRow(draft.documentId, draft.draftVersion, line))
      for (const [index, line] of next.entries()) {
        const target = current[index]
        if (target) await updateRow(masterSpreadsheetId, 'DRAFT_LINE_ITEMS', target.rowNumber, DRAFT_LINE_COLUMNS, line)
        else await appendRow(masterSpreadsheetId, 'DRAFT_LINE_ITEMS', DRAFT_LINE_COLUMNS, line)
      }
      for (const stale of current.slice(next.length)) await updateRow(masterSpreadsheetId, 'DRAFT_LINE_ITEMS', stale.rowNumber, DRAFT_LINE_COLUMNS, blankRow(DRAFT_LINE_COLUMNS))
    },
    async getDraft(documentId) {
      const headers = await readRows<OcrDocument>(masterSpreadsheetId, 'DRAFTS', DOCUMENT_COLUMNS)
      const header = headers.find((row) => row.value.documentId === documentId)?.value
      if (!header) return null
      const lineItems = (await readRows<Record<string, unknown>>(masterSpreadsheetId, 'DRAFT_LINE_ITEMS', DRAFT_LINE_COLUMNS))
        .filter(({ value }) => value.documentId === documentId)
        .map(({ value }) => toLineItem(value))
        .sort((left, right) => left.lineNumber - right.lineNumber)
      return { ...header, lineItems }
    },
    async finalizeDocument(draft, ledger) {
      assertUniqueLineNumbers(draft.lineItems)
      if (!/^\d{4}-\d{2}$/.test(ledger.month)) throw new Error('Invalid monthly ledger key')
      await ensureMonthlyIndex(ledger.month, ledger.monthlySpreadsheetId)
      const transactions = await readRows<Record<string, unknown>>(ledger.monthlySpreadsheetId, 'TRANSACTIONS', TRANSACTION_COLUMNS)
      const existing = transactions.find(({ value }) => value.documentId === draft.documentId)
      const confirmed = documentRow({ ...draft, state: 'CONFIRMED', verificationStatus: 'STAFF_CONFIRMED' })
      let transactionRow = existing?.rowNumber
      if (!transactionRow) {
        await appendRow(ledger.monthlySpreadsheetId, 'TRANSACTIONS', TRANSACTION_COLUMNS, { ...confirmed, writeState: 'WRITING', schemaVersion: 1 })
        transactionRow = (await readRows<Record<string, unknown>>(ledger.monthlySpreadsheetId, 'TRANSACTIONS', TRANSACTION_COLUMNS))
          .find(({ value }) => value.documentId === draft.documentId)?.rowNumber
      }
      if (!transactionRow) throw new Error('Unable to locate monthly transaction row')

      const lineRows = await readRows<Record<string, unknown>>(ledger.monthlySpreadsheetId, 'LINE_ITEMS', LINE_ITEM_COLUMNS)
      const persistedKeys = new Set(lineRows.map(({ value }) => String(value.itemWriteKey)))
      const expectedKeys = new Set(draft.lineItems.map((line) => `${draft.documentId}:${line.lineNumber}`))
      for (const line of draft.lineItems) {
        const itemWriteKey = `${draft.documentId}:${line.lineNumber}`
        if (!persistedKeys.has(itemWriteKey)) {
          await appendRow(ledger.monthlySpreadsheetId, 'LINE_ITEMS', LINE_ITEM_COLUMNS, { itemWriteKey, ...lineItemRow(draft.documentId, draft.draftVersion, line), schemaVersion: 1 })
          persistedKeys.add(itemWriteKey)
        }
      }
      const verifiedKeys = new Set((await readRows<Record<string, unknown>>(ledger.monthlySpreadsheetId, 'LINE_ITEMS', LINE_ITEM_COLUMNS)).map(({ value }) => String(value.itemWriteKey)))
      if ([...expectedKeys].some((key) => !verifiedKeys.has(key))) throw new Error('Missing monthly line item write key')
      await updateRow(ledger.monthlySpreadsheetId, 'TRANSACTIONS', transactionRow, TRANSACTION_COLUMNS, { ...confirmed, writeState: 'CONFIRMED', schemaVersion: 1 })
    },
    async listConfirmedDocuments(monthlySpreadsheetId) {
      return (await readRows<Record<string, unknown>>(monthlySpreadsheetId, 'TRANSACTIONS', TRANSACTION_COLUMNS))
        .filter(({ value }) => value.writeState === 'CONFIRMED' && value.state === 'CONFIRMED')
        .map(({ value }) => toDocument(value))
    },
  }

  async function ensureMonthlyIndex(month: string, monthlySpreadsheetId: string): Promise<void> {
    const rows = await readRows<Record<string, unknown>>(masterSpreadsheetId, 'MONTHLY_INDEX', MASTER_HEADERS.MONTHLY_INDEX)
    const existing = rows.find(({ value }) => value.month === month)
    if (existing) {
      if (existing.value.monthlySpreadsheetId !== monthlySpreadsheetId) throw new Error('Monthly ledger ID mismatch')
      return
    }
    await appendRow(masterSpreadsheetId, 'MONTHLY_INDEX', MASTER_HEADERS.MONTHLY_INDEX, {
      month, monthlySpreadsheetId, status: 'READY', aggregateFreshAt: null, updatedAt: null,
    })
  }

  async function readRows<T extends object>(spreadsheetId: string, tab: string, columns: readonly string[]): Promise<Array<RowWithPosition<T>>> {
    const range = `${tab}!A:ZZ`
    const data = (await sheets.batchGet(spreadsheetId, [range]))[range] ?? []
    if (data.length === 0) {
      await sheets.append(spreadsheetId, `${tab}!A:ZZ`, [[...columns]])
      return []
    }
    const header = data[0].map(String)
    if (header.length !== columns.length || header.some((column, index) => column !== columns[index])) throw new Error(`Unexpected ${tab} header`)
    return data.slice(1).flatMap((row, index) => {
      const record = Object.fromEntries(columns.map((column, columnIndex) => [column, decodeCell(column, row[columnIndex])]))
      const value = record as T
      return record.documentId || record.jobId || record.month || record.itemWriteKey ? [{ rowNumber: index + 2, value }] : []
    })
  }

  async function appendRow(spreadsheetId: string, tab: string, columns: readonly string[], value: object): Promise<void> {
    await readRows(spreadsheetId, tab, columns)
    await sheets.append(spreadsheetId, `${tab}!A:ZZ`, [encodeRow(columns, value)])
  }

  async function updateRow(spreadsheetId: string, tab: string, rowNumber: number, columns: readonly string[], value: object): Promise<void> {
    await sheets.update(spreadsheetId, `${tab}!A${rowNumber}`, [encodeRow(columns, value)])
  }
}

type RowWithPosition<T extends object = Record<string, unknown>> = { rowNumber: number; value: T }

function encodeRow(columns: readonly string[], value: object): unknown[] {
  const record = value as Record<string, unknown>
  return columns.map((column) => encodeCell(column, record[column]))
}

function blankRow(columns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, null]))
}

function encodeCell(column: string, value: unknown): unknown {
  if (value === undefined || value === null) return ''
  if (column === 'confidenceByField' || column === 'warnings') return JSON.stringify(value)
  return value
}

function decodeCell(column: string, value: unknown): unknown {
  if (value === '') return column === 'confidenceByField' ? {} : column === 'warnings' ? [] : null
  if (column === 'confidenceByField') return parseJson(value, {})
  if (column === 'warnings') return parseJson(value, [])
  return value ?? null
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { throw new Error('Invalid JSON value in OCR ledger') }
}

function documentRow(document: OcrDocument): Record<string, unknown> {
  return Object.fromEntries(DOCUMENT_COLUMNS.map((column) => [column, document[column]]))
}

function lineItemRow(documentId: string, draftVersion: number, line: OcrLineItem): Record<string, unknown> {
  return { documentId, draftVersion, ...Object.fromEntries(DRAFT_LINE_COLUMNS.filter((column) => column !== 'documentId' && column !== 'draftVersion').map((column) => [column, line[column as keyof OcrLineItem] ?? null])) }
}

function toLineItem(value: Record<string, unknown>): OcrLineItem {
  return Object.fromEntries(DRAFT_LINE_COLUMNS.filter((column) => column !== 'draftVersion').map((column) => [column, value[column] ?? null])) as unknown as OcrLineItem
}

function toDocument(value: Record<string, unknown>): OcrDocument {
  return Object.fromEntries(DOCUMENT_COLUMNS.map((column) => [column, value[column] ?? null])) as unknown as OcrDocument
}

function assertUniqueLineNumbers(lineItems: OcrLineItem[]): void {
  const seen = new Set<number>()
  for (const line of lineItems) {
    if (seen.has(line.lineNumber)) throw new Error('Duplicate line number')
    seen.add(line.lineNumber)
  }
}
