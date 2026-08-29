import type { MiniAppSheetsPort } from './googleClient.js'
import { MINI_APP_LINK_ATTEMPT_HEADERS, MINI_APP_REQUEST_HEADERS } from './store.js'

export const JERA_API_CACHE_HEADERS = [
  'cacheKey', 'reportType', 'sourceUuid', 'branchUuid', 'branchName', 'eventDate', 'patientUuid', 'patientCode',
  'patientName', 'paymentCode', 'status', 'type', 'totalSatang', 'paidAmountSatang', 'refundAmountSatang',
  'cashSatang', 'transferSatang', 'creditCardSatang', 'eWalletSatang', 'paymentLinkSatang', 'otherPaymentSatang',
  'itemCode', 'itemName', 'quantity', 'remainingQuantity', 'remainingValueSatang',
  'doctorName', 'salespersonName', 'sourceCreatedAt', 'sourceUpdatedAt', 'fetchedAt', 'sourceHash',
] as const

export const JERA_SYNC_STATE_HEADERS = [
  'cacheKey', 'reportType', 'filterHash', 'lastAttemptAt', 'lastManualAt', 'lastSuccessAt', 'lastSourceDate', 'status',
  'recordCount', 'nextPage', 'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
] as const

export const JERA_SYNC_AUDIT_HEADERS = [
  'syncRunId', 'actorType', 'actorId', 'reportType', 'filterHash', 'startedAt', 'finishedAt', 'status',
  'recordCount', 'safeErrorCode', 'correlationId',
] as const

export const JERA_PAYMENT_DETAIL_CACHE_HEADERS = [
  'detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash',
  'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated',
] as const

export const JERA_PAYMENT_DETAIL_LINES_HEADERS = [
  'detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang',
] as const

export const JERA_ALLOCATION_COVERAGE_HEADERS = [
  'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
  'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
  'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
  'safeErrorCode', 'leaseOwner', 'leaseExpiresAt', 'taskAttempt',
] as const

export const STOCK_PRODUCT_HEADERS = [
  'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
  'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
] as const

export const STOCK_LEDGER_HEADERS = [
  'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
  'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
  'reason', 'idempotencyKey', 'createdAt',
] as const

export const STOCK_AUDIT_HEADERS = [
  'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
  'targetProductIdsJson', 'correlationId', 'createdAt',
] as const

export const MANAGED_TAB_HEADERS = {
  MINI_APP_REQUESTS: MINI_APP_REQUEST_HEADERS,
  MINI_APP_LINK_ATTEMPTS: MINI_APP_LINK_ATTEMPT_HEADERS,
  JERA_API_CACHE: JERA_API_CACHE_HEADERS,
  JERA_SYNC_STATE: JERA_SYNC_STATE_HEADERS,
  JERA_SYNC_AUDIT: JERA_SYNC_AUDIT_HEADERS,
  JERA_PAYMENT_DETAIL_CACHE: JERA_PAYMENT_DETAIL_CACHE_HEADERS,
  JERA_PAYMENT_DETAIL_LINES: JERA_PAYMENT_DETAIL_LINES_HEADERS,
  JERA_ALLOCATION_COVERAGE: JERA_ALLOCATION_COVERAGE_HEADERS,
  STOCK_PRODUCTS: STOCK_PRODUCT_HEADERS,
  STOCK_LEDGER: STOCK_LEDGER_HEADERS,
  STOCK_AUDIT: STOCK_AUDIT_HEADERS,
} as const

const ASYNC_REQUEST_HEADERS = [
  'paymentEvidenceObjectKeysJson',
  'chatEvidenceObjectKeysJson',
  'taskName',
  'queuedAt',
  'processingStartedAt',
  'processingLeaseUntil',
  'lastProgressAt',
  'attemptCount',
  'processingOwnerToken',
  'evidenceProjectionHash',
] as const

const LEGACY_REQUEST_HEADERS = MINI_APP_REQUEST_HEADERS.slice(0, -ASYNC_REQUEST_HEADERS.length)

export async function migrateMiniAppAsyncRequestColumns(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): Promise<{ appendedColumns: string[] }> {
  const { spreadsheetId, sheets } = input
  const range = "'MINI_APP_REQUESTS'!1:1"
  const current = ((await sheets.batchGet(spreadsheetId, [range]))[range]?.[0] ?? []).map(String)
  const expected = [...MINI_APP_REQUEST_HEADERS]

  if (sameHeader(current, expected)) return { appendedColumns: [] }
  if (current.length < LEGACY_REQUEST_HEADERS.length || !sameHeader(current, expected.slice(0, current.length))) {
    throw new Error('incompatible header: MINI_APP_REQUESTS')
  }

  const appendedColumns = expected.slice(current.length)
  const sheet = (await sheets.getWorkbook(spreadsheetId)).find(({ title }) => title === 'MINI_APP_REQUESTS')
  if (!sheet) throw new Error('managed tab missing: MINI_APP_REQUESTS')
  const existingColumnCount = sheet.columnCount ?? current.length
  const additionalColumns = Math.max(0, expected.length - existingColumnCount)
  const requests: Array<Record<string, unknown>> = []
  if (additionalColumns > 0) {
    requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'COLUMNS', length: additionalColumns } })
  }
  requests.push({
    updateCells: {
      range: {
        sheetId: sheet.sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: current.length,
        endColumnIndex: expected.length,
      },
      rows: [{ values: appendedColumns.map((stringValue) => ({ userEnteredValue: { stringValue } })) }],
      fields: 'userEnteredValue',
    },
  })
  await sheets.applyWorkbookRequests(spreadsheetId, requests)
  return { appendedColumns }
}

export async function ensureMiniAppWorkbook(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): Promise<void> {
  const { spreadsheetId, sheets } = input
  const initialWorkbook = await sheets.getWorkbook(spreadsheetId)
  const initialTitles = new Set(initialWorkbook.map(({ title }) => title))
  const existingManagedTabs = Object.keys(MANAGED_TAB_HEADERS).filter((title) => initialTitles.has(title))
  const headerRanges = existingManagedTabs.map((title) => `'${title}'!1:1`)
  const currentHeaders = headerRanges.length > 0 ? await sheets.batchGet(spreadsheetId, headerRanges) : {}

  for (const title of existingManagedTabs) {
    const range = `'${title}'!1:1`
    const actual = (currentHeaders[range]?.[0] ?? []).map(String)
    const expected = [...MANAGED_TAB_HEADERS[title as keyof typeof MANAGED_TAB_HEADERS]]
    const compatibleAllocationCoverage = title === 'JERA_ALLOCATION_COVERAGE'
      && sameHeader(actual, expected.slice(0, -1))
    if (actual.length > 0 && !sameHeader(actual, expected) && !compatibleAllocationCoverage) {
      throw new Error(`incompatible header: ${title}`)
    }
  }

  const missingTitles = Object.keys(MANAGED_TAB_HEADERS).filter((title) => !initialTitles.has(title))
  if (missingTitles.length > 0) {
    await sheets.applyWorkbookRequests(spreadsheetId, missingTitles.map((title) => ({
      addSheet: { properties: { title } },
    })))
  }

  const workbook = await sheets.getWorkbook(spreadsheetId)
  const byTitle = new Map(workbook.map((sheet) => [sheet.title, sheet]))
  const allocationRange = "'JERA_ALLOCATION_COVERAGE'!1:1"
  const allocationHeader = (currentHeaders[allocationRange]?.[0] ?? []).map(String)
  const expectedAllocationHeader = [...JERA_ALLOCATION_COVERAGE_HEADERS]
  if (sameHeader(allocationHeader, expectedAllocationHeader.slice(0, -1))) {
    const sheet = byTitle.get('JERA_ALLOCATION_COVERAGE')
    if (!sheet) throw new Error('managed tab missing after setup: JERA_ALLOCATION_COVERAGE')
    const requests: Array<Record<string, unknown>> = []
    const existingColumnCount = sheet.columnCount ?? allocationHeader.length
    if (existingColumnCount < expectedAllocationHeader.length) {
      requests.push({ appendDimension: {
        sheetId: sheet.sheetId,
        dimension: 'COLUMNS',
        length: expectedAllocationHeader.length - existingColumnCount,
      } })
    }
    requests.push({
      updateCells: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: expectedAllocationHeader.length - 1,
          endColumnIndex: expectedAllocationHeader.length,
        },
        rows: [{ values: [{ userEnteredValue: { stringValue: 'taskAttempt' } }] }],
        fields: 'userEnteredValue',
      },
    })
    await sheets.applyWorkbookRequests(spreadsheetId, requests)
    currentHeaders[allocationRange] = [[...expectedAllocationHeader]]
  }
  for (const [title, headers] of Object.entries(MANAGED_TAB_HEADERS)) {
    const sheet = byTitle.get(title)
    if (!sheet) throw new Error(`managed tab missing after setup: ${title}`)
    const existingRange = `'${title}'!1:1`
    const actual = initialTitles.has(title) ? (currentHeaders[existingRange]?.[0] ?? []).map(String) : []
    if (actual.length === 0) await sheets.update(spreadsheetId, `'${title}'!A1:${columnName(headers.length)}1`, [[...headers]])
  }

  await sheets.applyWorkbookRequests(spreadsheetId, Object.keys(MANAGED_TAB_HEADERS).map((title) => ({
    updateSheetProperties: {
      properties: { sheetId: byTitle.get(title)!.sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  })))
}

function sameHeader(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function columnName(count: number): string {
  let value = count
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}
