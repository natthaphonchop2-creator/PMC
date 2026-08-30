import type { BookingCase } from './domain/types'
import {
  PMC_BOOKING_MASTER_COLUMNS_V1,
  PMC_BOOKING_MASTER_COLUMNS_V2,
} from '../../../shared/pmcBookingRowContracts'

export const BOOKING_MASTER_COLUMNS_V1 = PMC_BOOKING_MASTER_COLUMNS_V1
export const BOOKING_MASTER_COLUMNS = PMC_BOOKING_MASTER_COLUMNS_V2 satisfies readonly (keyof BookingCase)[]

export const STAFF_CONFIG_COLUMNS = [
  'id',
  'name',
  'email',
  'lineUserId',
  'canCloseBooking',
  'canBeAe',
  'active',
  'profileImageUrl',
  'canManageStock',
  'canSubmitExpense',
  'canViewFinance',
  'canManageExpense',
] as const

export const SHEET_SCHEMAS: Record<string, readonly string[]> = {
  FORM_RESPONSES: [],
  BOOKING_MASTER: BOOKING_MASTER_COLUMNS,
  CALL_QUEUE: ['taskId', 'caseId', 'ownerAdminId', 'status', 'windowStart', 'windowEnd', 'nextCallAt', 'lastReminderDate', 'result', 'note', 'version'],
  JERA_IMPORT_RAW: ['importId', 'fileId', 'paymentId', 'date', 'time', 'customerNameNormalized', 'phoneNormalized', 'status', 'actualRevenue', 'importedAt'],
  JERA_IMPORT_FILES: ['fileId', 'hash', 'status', 'transactionCount', 'rejectedCount', 'importedAt', 'safeError'],
  RECONCILIATION: ['id', 'source', 'sourceId', 'reasonCode', 'candidateCaseIds', 'status', 'resolvedCaseId', 'resolvedBy', 'resolvedAt', 'version'],
  RETRY_QUEUE: ['id', 'caseId', 'operation', 'idempotencyKey', 'attempts', 'nextAttemptAt', 'status', 'safeError', 'payload'],
  CONFIG_ADMINS: ['id', 'name', 'email', 'lineUserId', 'active'],
  CONFIG_STAFF: STAFF_CONFIG_COLUMNS,
  CONFIG_DOCTORS: ['id', 'name', 'calendarId', 'lineGroupId', 'active'],
  CONFIG_SERVICES: ['id', 'name', 'durationMinutes', 'active'],
  CONFIG_CHANNELS: ['id', 'name', 'active'],
  CONFIG_RULES: ['key', 'value', 'updatedAt', 'updatedBy'],
  CONFIG_LINE_DIRECTORY: ['sourceType', 'sourceId', 'capturedAt', 'alias'],
  LINE_INGRESS_NONCES: ['nonce', 'capturedAt'],
  FORM_RESPONSE_MAP: ['formResponseId', 'caseId'],
  SYSTEM_SEQUENCES: ['month', 'sequence'],
  RETENTION_QUEUE: ['id', 'caseId', 'eligibleAt', 'status', 'approvedBy', 'approvedAt', 'reason', 'version'],
  AUDIT_LOG: ['eventId', 'caseId', 'actor', 'action', 'target', 'before', 'after', 'reason', 'timestamp', 'correlationId'],
  STOCK_PRODUCTS: [
    'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
    'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
  ],
  STOCK_LEDGER: [
    'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
    'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
    'reason', 'idempotencyKey', 'createdAt',
  ],
  STOCK_AUDIT: [
    'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
    'targetProductIdsJson', 'correlationId', 'createdAt',
  ],
  DASHBOARD: [],
}
