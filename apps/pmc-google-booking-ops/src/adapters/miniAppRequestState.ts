import {
  MINI_APP_ASYNC_REQUEST_HEADERS,
  type MiniAppAsyncRequestRecord,
  type MiniAppAsyncRequestState,
  type MiniAppAsyncConfirmationStatus,
} from '../../../../shared/pmcMiniAppAsyncState'
import { encodeSheetCell } from './googleSheets'
import type { MiniAppRequestStatePort } from '../ports'

const TAB = 'MINI_APP_REQUESTS'
const REQUEST_ROW_NUMBER_FORMATS = MINI_APP_ASYNC_REQUEST_HEADERS.map((header) => {
  if (header === 'version' || header === 'evidenceCount' || header === 'attemptCount') return '0'
  if (header === 'depositAmount') return '0.############'
  return '@'
})

export function createGoogleMiniAppRequestStatePort(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): MiniAppRequestStatePort {
  const requireSheet = () => {
    const sheet = spreadsheet.getSheetByName(TAB)
    if (!sheet) throw new Error('missing required sheet: MINI_APP_REQUESTS')
    return sheet
  }

  function readRows(): Array<{ rowNumber: number; value: MiniAppAsyncRequestRecord }> {
    const sheet = requireSheet()
    const columnCount = sheet.getLastColumn()
    if (columnCount !== MINI_APP_ASYNC_REQUEST_HEADERS.length) throw new Error('MINI_APP_REQUESTS header mismatch')
    const headers = sheet.getRange(1, 1, 1, columnCount).getValues()[0].map(String)
    if (headers.some((header, index) => header !== MINI_APP_ASYNC_REQUEST_HEADERS[index])) {
      throw new Error('MINI_APP_REQUESTS header mismatch')
    }
    if (sheet.getLastRow() < 2) return []
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getValues()
      .map((row, index) => ({ rowNumber: index + 2, value: fromRow(row) }))
  }

  return {
    getByRequestId(requestId) {
      const matches = readRows().filter(({ value }) => value.requestId === requestId)
      if (matches.length > 1) throw new Error('duplicate mini app async request identity')
      return matches[0]?.value ?? null
    },
    updateByRequestId(requestId, expectedVersion, next) {
      const matches = readRows().filter(({ value }) => value.requestId === requestId)
      if (matches.length > 1) throw new Error('duplicate mini app async request identity')
      const row = matches[0]
      if (!row) throw new Error('mini app async request not found')
      if (row.value.version !== expectedVersion) throw new Error('mini app async state version conflict')
      if (next.requestId !== row.value.requestId || next.draftId !== row.value.draftId || next.version !== expectedVersion + 1) {
        throw new Error('invalid mini app async row update')
      }
      const sheet = requireSheet()
      const target = sheet.getRange(row.rowNumber, 1, 1, MINI_APP_ASYNC_REQUEST_HEADERS.length)
      target.setNumberFormats([REQUEST_ROW_NUMBER_FORMATS])
      target.setValues([toRow(next)])
      return JSON.parse(JSON.stringify(next)) as MiniAppAsyncRequestRecord
    },
  }
}

function fromRow(row: unknown[]): MiniAppAsyncRequestRecord {
  const value = Object.fromEntries(MINI_APP_ASYNC_REQUEST_HEADERS.map((header, index) => [header, row[index] ?? '']))
  return {
    requestId: text(value.requestId), draftId: text(value.draftId), staffId: text(value.staffId),
    lineUserIdHash: text(value.lineUserIdHash), state: text(value.state) as MiniAppAsyncRequestState,
    retentionState: text(value.retentionState) as MiniAppAsyncRequestRecord['retentionState'],
    version: numberValue(value.version), payloadHash: nullable(value.payloadHash), aeName: text(value.aeName),
    customerName: text(value.customerName), facebookName: text(value.facebookName),
    phoneNormalized: text(value.phoneNormalized), doctorId: text(value.doctorId), serviceId: text(value.serviceId),
    queueType: text(value.queueType) as 'NORMAL' | 'AUTO', appointmentDate: nullable(value.appointmentDate),
    appointmentTime: nullable(value.appointmentTime), depositAmount: numberValue(value.depositAmount),
    channelId: text(value.channelId), paymentEvidenceFileIds: stringArray(value.paymentEvidenceFileIdsJson),
    chatEvidenceFileIds: stringArray(value.chatEvidenceFileIdsJson), evidenceCount: numberValue(value.evidenceCount),
    createdAt: text(value.createdAt), confirmedAt: nullable(value.confirmedAt), caseId: nullable(value.caseId),
    confirmationStatus: nullable(value.confirmationStatus) as MiniAppAsyncConfirmationStatus | null,
    safeErrorCode: nullable(value.safeErrorCode), updatedAt: text(value.updatedAt),
    paymentEvidenceObjectKeys: stringArray(value.paymentEvidenceObjectKeysJson),
    chatEvidenceObjectKeys: stringArray(value.chatEvidenceObjectKeysJson), taskName: nullable(value.taskName),
    queuedAt: nullable(value.queuedAt), processingStartedAt: nullable(value.processingStartedAt),
    processingLeaseUntil: nullable(value.processingLeaseUntil), lastProgressAt: nullable(value.lastProgressAt),
    attemptCount: numberValue(value.attemptCount), processingOwnerToken: nullable(value.processingOwnerToken),
    evidenceProjectionHash: nullable(value.evidenceProjectionHash),
  }
}

function toRow(record: MiniAppAsyncRequestRecord): Array<string | number | boolean> {
  const mapped: Record<string, unknown> = {
    ...record,
    paymentEvidenceFileIdsJson: record.paymentEvidenceFileIds,
    chatEvidenceFileIdsJson: record.chatEvidenceFileIds,
    paymentEvidenceObjectKeysJson: record.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeysJson: record.chatEvidenceObjectKeys,
  }
  return MINI_APP_ASYNC_REQUEST_HEADERS.map((header) => encodeSheetCell(mapped[header]))
}

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullable(value: unknown): string | null { const result = text(value); return result ? result : null }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : Number(value) }
function stringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return [...value]
  try {
    const parsed: unknown = JSON.parse(text(value) || '[]')
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
  } catch { /* rejected below */ }
  throw new Error('invalid MINI_APP_REQUESTS array cell')
}
