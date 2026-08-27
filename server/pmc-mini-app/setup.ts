import type { MiniAppSheetsPort } from './googleClient.js'
import { MINI_APP_REQUEST_HEADERS } from './store.js'

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

export const MANAGED_TAB_HEADERS = {
  MINI_APP_REQUESTS: MINI_APP_REQUEST_HEADERS,
  JERA_API_CACHE: JERA_API_CACHE_HEADERS,
  JERA_SYNC_STATE: JERA_SYNC_STATE_HEADERS,
  JERA_SYNC_AUDIT: JERA_SYNC_AUDIT_HEADERS,
} as const

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
    if (actual.length > 0 && !sameHeader(actual, expected)) throw new Error(`incompatible header: ${title}`)
  }

  const missingTitles = Object.keys(MANAGED_TAB_HEADERS).filter((title) => !initialTitles.has(title))
  if (missingTitles.length > 0) {
    await sheets.applyWorkbookRequests(spreadsheetId, missingTitles.map((title) => ({
      addSheet: { properties: { title } },
    })))
  }

  const workbook = await sheets.getWorkbook(spreadsheetId)
  const byTitle = new Map(workbook.map((sheet) => [sheet.title, sheet]))
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
