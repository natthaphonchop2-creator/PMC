import {
  isCanonicalExpenseTimestamp,
  isExpenseIdForMonth,
  isValidExpenseOriginalFileName,
  parseExpenseDate,
} from './pmcExpense'
import type {
  EnabledExpenseCategory,
  ExpensePaymentMethod,
  ExpenseReceipt,
} from './pmcExpense'

export interface ExpensePrivateAttachment {
  attachmentId: string
  expenseId: string
  rootRequestId: string
  ordinal: number
  mediaType: 'image/jpeg' | 'image/png'
  originalFileName: string
  privateFileId: string
  deterministicName: string
  sizeBytes: number
  driveVersion: string
  slotClaimId: string
  sha256: string
  uploadedByStaffId: string
  uploadedAt: string
}

export function canonicalExpenseAttachmentManifest(
  attachments: readonly Pick<
    ExpensePrivateAttachment,
    'ordinal' | 'mediaType' | 'originalFileName' | 'sha256'
  >[],
): string {
  if (
    attachments.length < 1
    || attachments.length > 5
    || attachments.some((attachment, index) => (
      attachment.ordinal !== index + 1
      || (attachment.mediaType !== 'image/jpeg' && attachment.mediaType !== 'image/png')
      || !isValidExpenseOriginalFileName(attachment.originalFileName)
      || !sha256(attachment.sha256)
    ))
  ) throw new Error('invalid mini app expense attachment manifest')
  return JSON.stringify(attachments.map((attachment) => ({
    ordinal: attachment.ordinal,
    mediaType: attachment.mediaType,
    originalFileName: attachment.originalFileName,
    sha256: attachment.sha256,
  })))
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
      expectedRevision: number
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
  expectedAttachmentCount: number
  expectedManifestHash: string
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
  'EXPENSE_RESUME_FORBIDDEN',
  'EXPENSE_STORAGE_UNAVAILABLE',
] as const

export type MiniAppExpenseSafeErrorCode = typeof MINI_APP_EXPENSE_SAFE_ERROR_CODES[number]

export type ExpenseResumeStatus =
  | { status: 'COMMITTED'; receipt: ExpenseReceipt }
  | { status: 'PENDING' }
  | { status: 'SAFE_TO_RETRY' }
  | { status: 'FAILED'; error: MiniAppExpenseSafeErrorCode }

export interface UnsignedMiniAppExpenseResumeIngressEnvelope {
  kind: 'MINI_APP_EXPENSE_RESUME'
  version: 1
  timestamp: number
  nonce: string
  rootRequestId: string
  staffId: string
}

export interface MiniAppExpenseResumeIngressEnvelope
  extends UnsignedMiniAppExpenseResumeIngressEnvelope {
  signature: string
}

export type MiniAppExpenseResumeIngressResponse =
  | { ok: true; result: ExpenseResumeStatus }
  | { ok: false; error: MiniAppExpenseSafeErrorCode }

export type MiniAppExpenseIngressResponse =
  | { ok: true; result: ExpenseCommandResult }
  | { ok: false; error: MiniAppExpenseSafeErrorCode }

export interface ExpenseRecoveryCounts {
  recovered: number
  abandoned: number
  unchanged: number
  failed: number
}

export interface ExpenseRecoveryWorkerIdentity {
  email: string
  subject: string
}

export interface UnsignedMiniAppExpenseRecoveryIngressEnvelope {
  kind: 'MINI_APP_EXPENSE_RECOVERY'
  version: 1
  timestamp: number
  nonce: string
  correlationId: string
  worker: ExpenseRecoveryWorkerIdentity
}

export interface MiniAppExpenseRecoveryIngressEnvelope
  extends UnsignedMiniAppExpenseRecoveryIngressEnvelope {
  signature: string
}

export type MiniAppExpenseRecoveryIngressResponse =
  | { ok: true; result: ExpenseRecoveryCounts }
  | { ok: false; error: 'EXPENSE_STORAGE_UNAVAILABLE' }

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
const RECOVERY_ENVELOPE_KEYS = [
  'kind',
  'version',
  'timestamp',
  'nonce',
  'correlationId',
  'worker',
] as const
const RECOVERY_WORKER_KEYS = ['email', 'subject'] as const
const RESUME_ENVELOPE_KEYS = [
  'kind', 'version', 'timestamp', 'nonce', 'rootRequestId', 'staffId',
] as const

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

export function canonicalMiniAppExpenseRecoveryIngress(
  envelope: UnsignedMiniAppExpenseRecoveryIngressEnvelope,
): string {
  if (
    !hasExactKeys(envelope, RECOVERY_ENVELOPE_KEYS)
    || envelope.kind !== 'MINI_APP_EXPENSE_RECOVERY'
    || envelope.version !== 1
    || !Number.isSafeInteger(envelope.timestamp)
    || envelope.timestamp <= 0
    || typeof envelope.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(envelope.nonce)
    || !safeId(envelope.correlationId)
  ) throw new Error('invalid mini app expense recovery envelope')

  if (
    !hasExactKeys(envelope.worker, RECOVERY_WORKER_KEYS)
    || !serviceAccountEmail(envelope.worker.email)
    || typeof envelope.worker.subject !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,255}$/.test(envelope.worker.subject)
  ) throw new Error('invalid mini app expense recovery worker')

  return JSON.stringify({
    kind: 'MINI_APP_EXPENSE_RECOVERY',
    version: 1,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    correlationId: envelope.correlationId,
    worker: {
      email: envelope.worker.email,
      subject: envelope.worker.subject,
    },
  })
}

export function canonicalMiniAppExpenseResumeIngress(
  envelope: UnsignedMiniAppExpenseResumeIngressEnvelope,
): string {
  if (
    !hasExactKeys(envelope, RESUME_ENVELOPE_KEYS)
    || envelope.kind !== 'MINI_APP_EXPENSE_RESUME'
    || envelope.version !== 1
    || !Number.isSafeInteger(envelope.timestamp)
    || envelope.timestamp <= 0
    || typeof envelope.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(envelope.nonce)
    || !safeId(envelope.rootRequestId)
    || !safeId(envelope.staffId)
  ) throw new Error('invalid mini app expense resume envelope')
  return JSON.stringify({
    kind: 'MINI_APP_EXPENSE_RESUME',
    version: 1,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    rootRequestId: envelope.rootRequestId,
    staffId: envelope.staffId,
  })
}

export function isExpenseResumeStatus(value: unknown): value is ExpenseResumeStatus {
  if (!isRecord(value) || typeof value.status !== 'string') return false
  if (value.status === 'PENDING' || value.status === 'SAFE_TO_RETRY') {
    return hasExactKeys(value, ['status'] as const)
  }
  if (value.status === 'FAILED') {
    return hasExactKeys(value, ['status', 'error'] as const)
      && isMiniAppExpenseSafeErrorCode(value.error)
  }
  if (value.status !== 'COMMITTED' || !hasExactKeys(value, ['status', 'receipt'] as const)) return false
  return isExpenseReceipt(value.receipt)
}

function isExpenseReceipt(value: unknown): value is ExpenseReceipt {
  if (!isRecord(value) || !hasExactKeys(value, [
    'expenseId', 'receiptNumber', 'expenseDate', 'monthKey', 'category', 'scope',
    'amountSatang', 'recordState', 'revision', 'committedAt', 'unreviewed',
  ] as const)) return false
  let parsedDate: { monthKey: string }
  try {
    if (typeof value.expenseDate !== 'string') return false
    parsedDate = parseExpenseDate(value.expenseDate)
  } catch {
    return false
  }
  return safeId(value.expenseId)
    && value.receiptNumber === value.expenseId
    && typeof value.monthKey === 'string'
    && value.monthKey === parsedDate.monthKey
    && isExpenseIdForMonth(value.expenseId, value.monthKey)
    && isEnabledCategory(value.category)
    && value.scope === (value.category === 'BOOK_DOCTOR_PERSONAL' ? 'DOCTOR_PERSONAL' : 'CLINIC')
    && positiveSatang(value.amountSatang)
    && value.recordState === 'COMMITTED'
    && safeInteger(value.revision)
    && value.revision > 0
    && isCanonicalExpenseTimestamp(value.committedAt)
    && value.unreviewed === true
}

export function isExpenseRecoveryCounts(value: unknown): value is ExpenseRecoveryCounts {
  if (!hasExactKeys(value, ['recovered', 'abandoned', 'unchanged', 'failed'] as const)) return false
  const counts = [value.recovered, value.abandoned, value.unchanged, value.failed]
  if (!counts.every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)) return false
  return (counts as number[]).reduce((total, count) => total + count, 0) <= 100
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
    const keys = ['expenseId', 'expectedVersion', 'expectedRevision', 'reason'] as const
    if (
      !hasExactKeys(value.payload, keys)
      || !safeId(value.payload.expenseId)
      || !safeInteger(value.payload.expectedVersion)
      || value.payload.expectedVersion < 1
      || !safeInteger(value.payload.expectedRevision)
      || value.payload.expectedRevision < 1
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
        expectedRevision: value.payload.expectedRevision,
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
  if (
    !hasExactKeys(value, keys)
    || !safeId(value.attachmentId)
    || !safeId(value.expenseId)
    || !safeId(value.rootRequestId)
    || !safeInteger(value.ordinal)
    || value.ordinal < 1
    || value.ordinal > 5
    || (value.mediaType !== 'image/jpeg' && value.mediaType !== 'image/png')
    || !isValidExpenseOriginalFileName(value.originalFileName)
    || !safeId(value.privateFileId)
    || typeof value.deterministicName !== 'string'
    || !safeInteger(value.sizeBytes)
    || value.sizeBytes < 1
    || value.sizeBytes > 10_000_000
    || typeof value.driveVersion !== 'string'
    || !/^[1-9]\d{0,31}$/.test(value.driveVersion)
    || typeof value.slotClaimId !== 'string'
    || !/^SLOT-[a-f0-9]{64}$/.test(value.slotClaimId)
    || !sha256(value.sha256)
    || value.deterministicName !== deterministicAttachmentName(
      value.ordinal,
      value.sha256,
      value.mediaType,
    )
    || !safeId(value.uploadedByStaffId)
    || typeof value.uploadedAt !== 'string'
    || !Number.isFinite(Date.parse(value.uploadedAt))
  ) {
    throw new Error('invalid mini app expense attachment')
  }

  return {
    attachmentId: value.attachmentId,
    expenseId: value.expenseId,
    rootRequestId: value.rootRequestId,
    ordinal: value.ordinal,
    mediaType: value.mediaType,
    originalFileName: value.originalFileName,
    privateFileId: value.privateFileId,
    deterministicName: value.deterministicName,
    sizeBytes: value.sizeBytes,
    driveVersion: value.driveVersion,
    slotClaimId: value.slotClaimId,
    sha256: value.sha256,
    uploadedByStaffId: value.uploadedByStaffId,
    uploadedAt: value.uploadedAt,
  }
}

function deterministicAttachmentName(
  ordinal: number,
  sha256Value: string,
  mediaType: 'image/jpeg' | 'image/png',
): string {
  return `${String(ordinal).padStart(3, '0')}-${sha256Value}.${mediaType === 'image/jpeg' ? 'jpg' : 'png'}`
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

function serviceAccountEmail(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._-]{2,62}@[a-z0-9-]{3,63}\.iam\.gserviceaccount\.com$/i.test(value)
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
