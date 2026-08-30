export const EXPENSE_MONTHLY_INDEX_HEADERS = [
  'monthKey',
  'ledgerSpreadsheetId',
  'monthFolderId',
  'createdAt',
  'updatedAt',
] as const

export const EXPENSE_REQUEST_HEADERS = [
  'commandIdempotencyKey',
  'rootRequestId',
  'commandType',
  'commandFingerprint',
  'expenseId',
  'monthKey',
  'recordState',
  'resultJson',
  'createdAt',
  'updatedAt',
] as const

export const EXPENSE_AUDIT_HEADERS = [
  'eventId',
  'expenseId',
  'actorStaffId',
  'action',
  'beforeJson',
  'afterJson',
  'createdAt',
  'correlationId',
] as const

export const EXPENSE_SUBMISSION_HEADERS = [
  'expenseId',
  'expenseDate',
  'monthKey',
  'category',
  'scope',
  'amountSatang',
  'counterpartyName',
  'description',
  'paymentMethod',
  'recordState',
  'bookDailyKey',
  'revision',
  'supersedesExpenseId',
  'submittedByStaffId',
  'submittedByName',
  'submittedAt',
  'committedAt',
  'updatedAt',
  'version',
  'idempotencyKey',
] as const

export const EXPENSE_ATTACHMENT_HEADERS = [
  'attachmentId',
  'expenseId',
  'rootRequestId',
  'ordinal',
  'mediaType',
  'originalFileName',
  'privateFileId',
  'deterministicName',
  'sizeBytes',
  'driveVersion',
  'slotClaimId',
  'sha256',
  'uploadedByStaffId',
  'uploadedAt',
] as const

export const MONTHLY_SUMMARY_HEADERS = [
  'monthKey',
  'scope',
  'category',
  'committedSatang',
  'effectiveCount',
  'calculatedAt',
  'sourceHash',
] as const

export const EXPENSE_MASTER_SCHEMAS = {
  EXPENSE_MONTHLY_INDEX: EXPENSE_MONTHLY_INDEX_HEADERS,
  EXPENSE_REQUESTS: EXPENSE_REQUEST_HEADERS,
  EXPENSE_AUDIT: EXPENSE_AUDIT_HEADERS,
} as const satisfies Record<string, readonly string[]>

export const EXPENSE_MONTH_SCHEMAS = {
  EXPENSE_SUBMISSIONS: EXPENSE_SUBMISSION_HEADERS,
  EXPENSE_ATTACHMENTS: EXPENSE_ATTACHMENT_HEADERS,
  MONTHLY_SUMMARY: MONTHLY_SUMMARY_HEADERS,
} as const satisfies Record<string, readonly string[]>
