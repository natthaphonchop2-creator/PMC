import type {
  EnabledExpenseCategory,
  ExpensePaymentMethod,
  ExpenseReceipt,
} from './pmcExpense'

export interface ExpensePrivateAttachment {
  attachmentId: string
  expenseId: string
  ordinal: number
  mediaType: 'image/jpeg' | 'image/png'
  originalFileName: string
  privateFileId: string
  sha256: string
  uploadedByStaffId: string
  uploadedAt: string
}

export type MiniAppExpenseCommand =
  | {
    rootRequestId: string
    commandIdempotencyKey: string
    staffId: string
    commandType: 'PREPARE_EXPENSE'
    payload: {
      expenseDate: string
      category: EnabledExpenseCategory
      bookDailyKey: string | null
      amountSatang: number
      counterpartyName: string | null
      description: string
      paymentMethod: ExpensePaymentMethod | null
      expectedAttachmentCount: number
      expectedManifestHash: string
      expectedRevision: number
    }
  }
  | {
    rootRequestId: string
    commandIdempotencyKey: string
    staffId: string
    commandType: 'COMMIT_EXPENSE'
    payload: {
      expenseId: string
      expectedVersion: number
      expectedRevision: number
      expectedManifestHash: string
      attachments: ExpensePrivateAttachment[]
    }
  }
  | {
    rootRequestId: string
    commandIdempotencyKey: string
    staffId: string
    commandType: 'VOID_EXPENSE'
    payload: {
      expenseId: string
      expectedVersion: number
      reason: string
    }
  }

export interface ExpensePrepareResult {
  commandType: 'PREPARE_EXPENSE'
  expenseId: string
  monthKey: string
  recordState: 'PREPARED'
  version: number
  expectedRevision: number
}

export type ExpenseCommandResult =
  | ExpensePrepareResult
  | ({ commandType: 'COMMIT_EXPENSE' } & ExpenseReceipt)
  | {
    commandType: 'VOID_EXPENSE'
    expenseId: string
    recordState: 'VOID'
    version: number
    updatedAt: string
  }

export interface UnsignedMiniAppExpenseIngressEnvelope {
  kind: 'MINI_APP_EXPENSE'
  version: 1
  timestamp: number
  nonce: string
  command: MiniAppExpenseCommand
}

export interface MiniAppExpenseIngressEnvelope extends UnsignedMiniAppExpenseIngressEnvelope {
  signature: string
}

export const MINI_APP_EXPENSE_SAFE_ERROR_CODES = [
  'EXPENSE_INVALID_REQUEST',
  'EXPENSE_INVALID_DATE',
  'EXPENSE_INVALID_AMOUNT',
  'EXPENSE_INVALID_CATEGORY',
  'EXPENSE_INVALID_PAYMENT_METHOD',
  'EXPENSE_INVALID_ATTACHMENTS',
  'EXPENSE_STAFF_REQUIRED',
  'EXPENSE_SUBMIT_PERMISSION_REQUIRED',
  'EXPENSE_FINANCE_PERMISSION_REQUIRED',
  'EXPENSE_IDEMPOTENCY_CONFLICT',
  'EXPENSE_NOT_FOUND',
  'EXPENSE_NOT_PREPARED',
  'EXPENSE_REVISION_CONFLICT',
  'EXPENSE_IMMUTABLE_FIELD',
  'EXPENSE_PRIVATE_FILE_INVALID',
  'EXPENSE_STORAGE_UNAVAILABLE',
] as const

export type MiniAppExpenseSafeErrorCode = typeof MINI_APP_EXPENSE_SAFE_ERROR_CODES[number]

export type MiniAppExpenseIngressResponse =
  | { ok: true; result: ExpenseCommandResult }
  | { ok: false; error: MiniAppExpenseSafeErrorCode }

export function isMiniAppExpenseSafeErrorCode(
  value: unknown,
): value is MiniAppExpenseSafeErrorCode {
  return typeof value === 'string'
    && (MINI_APP_EXPENSE_SAFE_ERROR_CODES as readonly string[]).includes(value)
}

const COMMAND_KEYS = [
  'rootRequestId',
  'commandIdempotencyKey',
  'staffId',
  'commandType',
  'payload',
] as const

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command'] as const

export function canonicalMiniAppExpenseCommand(command: MiniAppExpenseCommand): string {
  return JSON.stringify(orderedCommand(command))
}

export function canonicalMiniAppExpenseIngress(envelope: UnsignedMiniAppExpenseIngressEnvelope): string {
  if (
    !hasExactKeys(envelope, ENVELOPE_KEYS)
    || envelope.kind !== 'MINI_APP_EXPENSE'
    || envelope.version !== 1
    || !Number.isSafeInteger(envelope.timestamp)
    || !safeId(envelope.nonce)
  ) {
    throw new Error('invalid mini app expense envelope')
  }

  return JSON.stringify({
    kind: 'MINI_APP_EXPENSE',
    version: 1,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    command: orderedCommand(envelope.command),
  })
}

function orderedCommand(value: unknown): MiniAppExpenseCommand {
  if (
    !hasExactKeys(value, COMMAND_KEYS)
    || !safeId(value.rootRequestId)
    || !safeId(value.commandIdempotencyKey)
    || !safeId(value.staffId)
    || typeof value.commandType !== 'string'
    || !isRecord(value.payload)
  ) {
    throw new Error('invalid mini app expense command')
  }

  const expectedSuffix = value.commandType === 'PREPARE_EXPENSE'
    ? ':prepare'
    : value.commandType === 'COMMIT_EXPENSE'
      ? ':commit'
      : ':void'
  if (value.commandIdempotencyKey !== `${value.rootRequestId}${expectedSuffix}`) {
    throw new Error('invalid mini app expense command phase key')
  }

  const common = {
    rootRequestId: value.rootRequestId,
    commandIdempotencyKey: value.commandIdempotencyKey,
    staffId: value.staffId,
  }

  if (value.commandType === 'PREPARE_EXPENSE') {
    const keys = [
      'expenseDate',
      'category',
      'bookDailyKey',
      'amountSatang',
      'counterpartyName',
      'description',
      'paymentMethod',
      'expectedAttachmentCount',
      'expectedManifestHash',
      'expectedRevision',
    ] as const
    if (
      !hasExactKeys(value.payload, keys)
      || typeof value.payload.expenseDate !== 'string'
      || !isEnabledCategory(value.payload.category)
      || !nullableBookDailyKey(value.payload.bookDailyKey)
      || !positiveSatang(value.payload.amountSatang)
      || !nullableBoundedText(value.payload.counterpartyName, 160)
      || !boundedText(value.payload.description, 500)
      || !nullablePaymentMethod(value.payload.paymentMethod)
      || !safeInteger(value.payload.expectedAttachmentCount)
      || value.payload.expectedAttachmentCount < 1
      || value.payload.expectedAttachmentCount > 5
      || !sha256(value.payload.expectedManifestHash)
      || !safeInteger(value.payload.expectedRevision)
      || value.payload.expectedRevision < 0
    ) {
      throw new Error('invalid mini app expense command payload')
    }

    return {
      ...common,
      commandType: 'PREPARE_EXPENSE',
      payload: {
        expenseDate: value.payload.expenseDate,
        category: value.payload.category,
        bookDailyKey: value.payload.bookDailyKey,
        amountSatang: value.payload.amountSatang,
        counterpartyName: value.payload.counterpartyName,
        description: value.payload.description,
        paymentMethod: value.payload.paymentMethod,
        expectedAttachmentCount: value.payload.expectedAttachmentCount,
        expectedManifestHash: value.payload.expectedManifestHash,
        expectedRevision: value.payload.expectedRevision,
      },
    }
  }

  if (value.commandType === 'COMMIT_EXPENSE') {
    const keys = ['expenseId', 'expectedVersion', 'expectedRevision', 'expectedManifestHash', 'attachments'] as const
    if (
      !hasExactKeys(value.payload, keys)
      || !safeId(value.payload.expenseId)
      || !safeInteger(value.payload.expectedVersion)
      || value.payload.expectedVersion < 1
      || !safeInteger(value.payload.expectedRevision)
      || value.payload.expectedRevision < 0
      || !sha256(value.payload.expectedManifestHash)
      || !Array.isArray(value.payload.attachments)
      || value.payload.attachments.length < 1
      || value.payload.attachments.length > 5
    ) {
      throw new Error('invalid mini app expense command payload')
    }

    const attachments = value.payload.attachments.map(orderedAttachment)
    if (attachments.some((item, index) => item.ordinal !== index + 1)) {
      throw new Error('invalid mini app expense attachment order')
    }

    return {
      ...common,
      commandType: 'COMMIT_EXPENSE',
      payload: {
        expenseId: value.payload.expenseId,
        expectedVersion: value.payload.expectedVersion,
        expectedRevision: value.payload.expectedRevision,
        expectedManifestHash: value.payload.expectedManifestHash,
        attachments,
      },
    }
  }

  if (value.commandType === 'VOID_EXPENSE') {
    const keys = ['expenseId', 'expectedVersion', 'reason'] as const
    if (
      !hasExactKeys(value.payload, keys)
      || !safeId(value.payload.expenseId)
      || !safeInteger(value.payload.expectedVersion)
      || value.payload.expectedVersion < 1
      || !boundedText(value.payload.reason, 300)
      || value.payload.reason.trim().length < 3
    ) {
      throw new Error('invalid mini app expense command payload')
    }

    return {
      ...common,
      commandType: 'VOID_EXPENSE',
      payload: {
        expenseId: value.payload.expenseId,
        expectedVersion: value.payload.expectedVersion,
        reason: value.payload.reason,
      },
    }
  }

  throw new Error('invalid mini app expense command')
}

function orderedAttachment(value: unknown): ExpensePrivateAttachment {
  const keys = [
    'attachmentId',
    'expenseId',
    'ordinal',
    'mediaType',
    'originalFileName',
    'privateFileId',
    'sha256',
    'uploadedByStaffId',
    'uploadedAt',
  ] as const
  if (
    !hasExactKeys(value, keys)
    || !safeId(value.attachmentId)
    || !safeId(value.expenseId)
    || !safeInteger(value.ordinal)
    || value.ordinal < 1
    || value.ordinal > 5
    || (value.mediaType !== 'image/jpeg' && value.mediaType !== 'image/png')
    || !boundedText(value.originalFileName, 160)
    || !safeId(value.privateFileId)
    || !sha256(value.sha256)
    || !safeId(value.uploadedByStaffId)
    || typeof value.uploadedAt !== 'string'
    || !Number.isFinite(Date.parse(value.uploadedAt))
  ) {
    throw new Error('invalid mini app expense attachment')
  }

  return {
    attachmentId: value.attachmentId,
    expenseId: value.expenseId,
    ordinal: value.ordinal,
    mediaType: value.mediaType,
    originalFileName: value.originalFileName,
    privateFileId: value.privateFileId,
    sha256: value.sha256,
    uploadedByStaffId: value.uploadedByStaffId,
    uploadedAt: value.uploadedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function positiveSatang(value: unknown): value is number {
  return safeInteger(value) && value > 0
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length <= max
    && !value.includes('\r')
    && !value.includes('\n')
    && !value.includes(String.fromCharCode(0))
}

function nullableBoundedText(value: unknown, max: number): value is string | null {
  return value === null || boundedText(value, max)
}

function isEnabledCategory(value: unknown): value is EnabledExpenseCategory {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}

function nullableBookDailyKey(value: unknown): value is string | null {
  return value === null || /^(?:CLINIC|DOCTOR_PERSONAL):\d{4}-\d{2}-\d{2}$/.test(String(value))
}

function nullablePaymentMethod(value: unknown): value is ExpensePaymentMethod | null {
  return value === null || value === 'TRANSFER' || value === 'CASH' || value === 'CREDIT' || value === 'OTHER'
}
