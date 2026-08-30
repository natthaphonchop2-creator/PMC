import { createHash, randomUUID } from 'node:crypto'
import {
  deriveBookDailyKey,
  deriveExpenseScope,
  isValidExpenseOriginalFileName,
  parseExpenseDate,
  type EnabledExpenseCategory,
  type ExpensePaymentMethod,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense.js'
import { canonicalExpenseAttachmentManifest } from '../../../shared/pmcMiniAppExpenseIngress.js'
import type {
  ExpensePrepareResult,
  ExpensePrivateAttachment,
  MiniAppExpenseCommand,
  MiniAppExpenseSafeErrorCode,
} from '../../../shared/pmcMiniAppExpenseIngress.js'
import type { FinanceGoogleCapturePorts } from './googleClient.js'
import { FinanceGoogleError } from './googleClient.js'
import type { ExpenseIngressClient } from './ingressClient.js'
import { ExpenseIngressClientError } from './ingressClient.js'
import {
  ExpenseStagingError,
  parseExpenseStagingObjectKey,
  type ExpenseDriveSlotClaim,
  type ExpenseStagingPort,
  type ExpenseStagingReceipt,
  type ExpenseSubmissionLease,
  type ExpenseSubmissionLeaseIntent,
} from './stagingStore.js'

const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const ROOT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,116}$/
const SHA256 = /^[a-f0-9]{64}$/

export interface ExpenseSubmissionInput {
  rootRequestId: string
  staffId: string
  expenseDate: string
  category: EnabledExpenseCategory
  amountSatang: number
  counterpartyName: string | null
  description: string
  paymentMethod: ExpensePaymentMethod | null
  expectedRevision: number
  stagingReceipts: ExpenseStagingReceipt[]
}

export interface ExpenseSubmissionDependencies {
  ingress: ExpenseIngressClient
  finance: FinanceGoogleCapturePorts
  staging: ExpenseStagingPort
}

export interface ExpenseSubmissionService {
  submit(input: ExpenseSubmissionInput): Promise<ExpenseReceipt>
}

export class ExpenseSubmissionError extends Error {
  readonly code: MiniAppExpenseSafeErrorCode
  readonly retryable: boolean

  constructor(code: MiniAppExpenseSafeErrorCode) {
    super(`Expense submission failed: ${code}`)
    this.name = 'ExpenseSubmissionError'
    this.code = code
    this.retryable = code === 'EXPENSE_STORAGE_UNAVAILABLE'
  }
}

export function createExpenseSubmissionService(
  dependencies: ExpenseSubmissionDependencies,
  options: { ownerId?: string } = {},
): ExpenseSubmissionService {
  const flights = new Map<string, {
    fingerprint: string
    promise: Promise<ExpenseReceipt>
  }>()
  const ownerId = options.ownerId ?? `lease-${randomUUID()}`
  return {
    submit(input) {
      let fingerprint: string
      try {
        fingerprint = submissionFingerprint(input)
      } catch (error) {
        return Promise.reject(safeSubmissionError(error))
      }
      const current = flights.get(input.rootRequestId)
      if (current) {
        return current.fingerprint === fingerprint
          ? current.promise
          : Promise.reject(new ExpenseSubmissionError('EXPENSE_IDEMPOTENCY_CONFLICT'))
      }
      const promise = submitExpense(input, dependencies, ownerId).finally(() => {
        if (flights.get(input.rootRequestId)?.promise === promise) {
          flights.delete(input.rootRequestId)
        }
      })
      flights.set(input.rootRequestId, { fingerprint, promise })
      return promise
    },
  }
}

export async function submitExpense(
  input: ExpenseSubmissionInput,
  dependencies: ExpenseSubmissionDependencies,
  ownerId = `lease-${randomUUID()}`,
): Promise<ExpenseReceipt> {
  try {
    const validated = validateSubmission(input)
    const expectedManifestHash = expenseAttachmentManifestHash(validated.stagingReceipts)
    const prepareCommand: Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }> = {
      rootRequestId: validated.rootRequestId,
      commandIdempotencyKey: `${validated.rootRequestId}:prepare`,
      staffId: validated.staffId,
      commandType: 'PREPARE_EXPENSE',
      payload: {
        expenseDate: validated.expenseDate,
        category: validated.category,
        bookDailyKey: deriveBookDailyKey(validated.category, validated.expenseDate),
        amountSatang: validated.amountSatang,
        counterpartyName: validated.counterpartyName,
        description: validated.description,
        paymentMethod: validated.paymentMethod,
        expectedAttachmentCount: validated.stagingReceipts.length,
        expectedManifestHash,
        expectedRevision: validated.expectedRevision,
      },
    }
    const prepared = await dependencies.ingress.prepare(prepareCommand)
    validatePrepared(prepared, validated)
    let lease = await dependencies.staging.acquireSubmissionLease({
      ...submissionLeaseIntent(validated, prepared),
      ownerId,
    })
    if (lease.state === 'COMMITTED') {
      const recovered = await dependencies.finance.listVerifiedExpenseImages(
        prepared.monthKey,
        prepared.expenseId,
      )
      await validateRecoveredAttachments(recovered, prepared, validated, dependencies.staging)
      const receipt = await commitPreparedExpense(
        prepared,
        validated,
        recovered,
        dependencies.ingress,
      )
      await cleanupStaging(validated.stagingReceipts, dependencies.staging)
      return receipt
    }
    const claimed = await claimExpenseSlotsWithLease(
      validated,
      prepared,
      lease,
      dependencies.staging,
    )
    lease = claimed.lease
    lease = await dependencies.staging.renewSubmissionLease(lease)
    await dependencies.staging.assertSubmissionLease(lease)
    const folderId = await dependencies.finance.ensureExpenseFolder(
      prepared.monthKey,
      prepared.expenseId,
    )
    const attachments: ExpensePrivateAttachment[] = []
    for (const receipt of validated.stagingReceipts) {
      lease = await dependencies.staging.renewSubmissionLease(lease)
      await dependencies.staging.assertSubmissionLease(lease)
      const staged = await dependencies.staging.get(receipt.objectKey)
      verifyStagedReceipt(receipt, staged)
      const deterministicName = deterministicNameFor(receipt)
      const attachmentId = deterministicAttachmentId(
        validated.rootRequestId,
        prepared.expenseId,
        receipt.ordinal,
      )
      const claim = await dependencies.staging.claimDriveSlot({
        ...driveSlotIntent(validated, prepared, receipt),
        lease,
      })
      let attachment: ExpensePrivateAttachment | null = null
      try {
        attachment = await dependencies.finance.uploadExpenseImage({
          monthKey: prepared.monthKey,
          expenseId: prepared.expenseId,
          parentId: folderId,
          deterministicName,
          bytes: staged.bytes,
          mimeType: receipt.mimeType,
          ordinal: receipt.ordinal,
          sha256: receipt.sha256,
          rootRequestId: validated.rootRequestId,
          uploadedByStaffId: validated.staffId,
          uploadedAt: receipt.createdAt,
          originalFileName: receipt.originalFileName,
          attachmentId,
          slotClaim: claim,
          allowClaimReplayCreate: true,
        })
        const registered = await dependencies.staging.registerDriveSlotFile({
          claim,
          lease,
          fileId: attachment.privateFileId,
        })
        if (registered.state !== 'REGISTERED' || registered.registeredFileId !== attachment.privateFileId) {
          throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
        }
      } catch (error) {
        if (attachment) {
          let registeredFileId: string | null = null
          try {
            registeredFileId = (await dependencies.staging.readDriveSlotClaim(
              driveSlotIntent(validated, prepared, receipt),
            )).registeredFileId
          } catch { /* preserve the original fenced failure */ }
          await dependencies.finance.deleteExpenseFileIfUnregistered({
            monthKey: prepared.monthKey,
            expenseId: prepared.expenseId,
            fileId: attachment.privateFileId,
            expectedAttachment: attachment,
            registeredFileId,
          }).catch(() => undefined)
        }
        throw error
      }
      if (!attachment) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
      await dependencies.finance.verifyExpenseFile({
        monthKey: prepared.monthKey,
        expenseId: prepared.expenseId,
        fileId: attachment.privateFileId,
        expectedAttachment: attachment,
      })
      await dependencies.staging.assertSubmissionLease(lease)
      attachments.push(attachment)
    }
    lease = await dependencies.staging.renewSubmissionLease(lease)
    await dependencies.staging.assertSubmissionLease(lease)
    await assertRegisteredAttachments(validated, prepared, attachments, dependencies.staging)
    const receipt = await commitPreparedExpense(
      prepared,
      validated,
      attachments,
      dependencies.ingress,
    )
    await dependencies.staging.assertSubmissionLease(lease)
    const committedLease = await dependencies.staging.commitSubmissionLease(lease)
    if (committedLease.state !== 'COMMITTED') {
      throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
    }
    await cleanupStaging(validated.stagingReceipts, dependencies.staging)
    return receipt
  } catch (error) {
    throw safeSubmissionError(error)
  }
}

export function expenseAttachmentManifestHash(
  receipts: readonly (ExpenseStagingReceipt | ExpensePrivateAttachment)[],
): string {
  const canonical = canonicalExpenseAttachmentManifest(receipts.map((receipt) => ({
    ordinal: receipt.ordinal,
    mediaType: 'mimeType' in receipt ? receipt.mimeType : receipt.mediaType,
    originalFileName: receipt.originalFileName,
    sha256: receipt.sha256,
  })))
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function submissionLeaseIntent(
  input: ExpenseSubmissionInput,
  prepared: ExpensePrepareResult,
): ExpenseSubmissionLeaseIntent {
  return {
    rootRequestId: input.rootRequestId,
    expenseId: prepared.expenseId,
    expectedManifestHash: prepared.expectedManifestHash,
    staffId: input.staffId,
    slots: input.stagingReceipts.map((receipt) => ({
      ordinal: receipt.ordinal,
      sha256: receipt.sha256,
      mimeType: receipt.mimeType,
      deterministicName: deterministicNameFor(receipt),
    })),
  }
}

async function claimExpenseSlotsWithLease(
  input: ExpenseSubmissionInput,
  prepared: ExpensePrepareResult,
  initialLease: ExpenseSubmissionLease,
  staging: ExpenseStagingPort,
): Promise<{ lease: ExpenseSubmissionLease; claims: ExpenseDriveSlotClaim[] }> {
  let lease = initialLease
  const claims: ExpenseDriveSlotClaim[] = []
  for (const receipt of input.stagingReceipts) {
    lease = await staging.renewSubmissionLease(lease)
    const claim = await staging.claimDriveSlot({
      ...driveSlotIntent(input, prepared, receipt),
      lease,
    })
    await staging.assertSubmissionLease(lease)
    claims.push(claim)
  }
  return { lease, claims }
}

async function validateRecoveredAttachments(
  attachments: ExpensePrivateAttachment[],
  prepared: ExpensePrepareResult,
  input: ExpenseSubmissionInput,
  staging: ExpenseStagingPort,
): Promise<void> {
  if (
    attachments.length !== prepared.expectedAttachmentCount
    || expenseAttachmentManifestHash(attachments) !== prepared.expectedManifestHash
  ) throw new ExpenseSubmissionError('EXPENSE_PRIVATE_FILE_INVALID')
  attachments.forEach((attachment, index) => {
    if (
      attachment.expenseId !== prepared.expenseId
      || attachment.rootRequestId !== input.rootRequestId
      || attachment.ordinal !== index + 1
      || attachment.uploadedByStaffId !== input.staffId
      || attachment.attachmentId !== deterministicAttachmentId(
        input.rootRequestId,
        prepared.expenseId,
        attachment.ordinal,
      )
    ) throw new ExpenseSubmissionError('EXPENSE_PRIVATE_FILE_INVALID')
  })
  await assertRegisteredAttachments(input, prepared, attachments, staging)
}

function driveSlotIntent(
  input: ExpenseSubmissionInput,
  prepared: ExpensePrepareResult,
  receipt: ExpenseStagingReceipt,
) {
  return {
    rootRequestId: input.rootRequestId,
    expenseId: prepared.expenseId,
    ordinal: receipt.ordinal,
    sha256: receipt.sha256,
    mimeType: receipt.mimeType,
    deterministicName: deterministicNameFor(receipt),
  }
}

async function assertRegisteredAttachments(
  input: ExpenseSubmissionInput,
  prepared: ExpensePrepareResult,
  attachments: ExpensePrivateAttachment[],
  staging: ExpenseStagingPort,
): Promise<void> {
  for (const [index, receipt] of input.stagingReceipts.entries()) {
    const claim = await staging.readDriveSlotClaim(driveSlotIntent(input, prepared, receipt))
    if (
      claim.state !== 'REGISTERED'
      || claim.registeredFileId !== attachments[index]?.privateFileId
      || claim.claimId !== attachments[index]?.slotClaimId
    ) throw new ExpenseSubmissionError('EXPENSE_PRIVATE_FILE_INVALID')
  }
}

async function commitPreparedExpense(
  prepared: ExpensePrepareResult,
  input: ExpenseSubmissionInput,
  attachments: ExpensePrivateAttachment[],
  ingress: ExpenseIngressClient,
): Promise<ExpenseReceipt> {
  const commitCommand: Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }> = {
    rootRequestId: input.rootRequestId,
    commandIdempotencyKey: `${input.rootRequestId}:commit`,
    staffId: input.staffId,
    commandType: 'COMMIT_EXPENSE',
    payload: {
      expenseId: prepared.expenseId,
      expectedVersion: prepared.version,
      expectedRevision: input.expectedRevision,
      expectedManifestHash: prepared.expectedManifestHash,
      attachments,
    },
  }
  const receipt = await ingress.commit(commitCommand)
  validateReceipt(receipt, prepared, input)
  return receipt
}

async function cleanupStaging(
  receipts: ExpenseStagingReceipt[],
  staging: ExpenseStagingPort,
): Promise<void> {
  await Promise.allSettled(
    receipts.map(({ objectKey }) => staging.deleteVerified(objectKey)),
  )
}

function validateSubmission(input: ExpenseSubmissionInput): ExpenseSubmissionInput {
  if (!isRecord(input) || !hasExactKeys(input, [
    'rootRequestId',
    'staffId',
    'expenseDate',
    'category',
    'amountSatang',
    'counterpartyName',
    'description',
    'paymentMethod',
    'expectedRevision',
    'stagingReceipts',
  ])) throw new ExpenseSubmissionError('EXPENSE_INVALID_REQUEST')
  if (!ROOT_REQUEST_ID.test(input.rootRequestId) || !SAFE_ID.test(input.staffId)) {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_REQUEST')
  }
  try {
    parseExpenseDate(input.expenseDate)
  } catch {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_DATE')
  }
  if (!enabledCategory(input.category)) {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_CATEGORY')
  }
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0) {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_AMOUNT')
  }
  if (
    !nullableText(input.counterpartyName, 160)
    || !boundedText(input.description, 500)
    || !nullablePaymentMethod(input.paymentMethod)
    || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 0
  ) throw new ExpenseSubmissionError('EXPENSE_INVALID_REQUEST')
  if (
    input.category === 'BILL_DOCUMENT'
    && (
      input.expectedRevision !== 0
      || !input.counterpartyName?.trim()
      || input.paymentMethod === null
    )
  ) throw new ExpenseSubmissionError('EXPENSE_INVALID_REQUEST')
  if (!Array.isArray(input.stagingReceipts)
    || input.stagingReceipts.length < 1
    || input.stagingReceipts.length > 5) {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
  }
  let totalBytes = 0
  const objectKeys = new Set<string>()
  input.stagingReceipts.forEach((receipt, index) => {
    validateStagingReceipt(receipt, input.rootRequestId, index + 1)
    totalBytes += receipt.sizeBytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > 25_000_000 || objectKeys.has(receipt.objectKey)) {
      throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
    }
    objectKeys.add(receipt.objectKey)
  })
  return {
    ...input,
    stagingReceipts: input.stagingReceipts.map((receipt) => ({ ...receipt })),
  }
}

function validateStagingReceipt(
  receipt: ExpenseStagingReceipt,
  rootRequestId: string,
  expectedOrdinal: number,
): void {
  if (!isRecord(receipt) || !hasExactKeys(receipt, [
    'objectKey',
    'sizeBytes',
    'mimeType',
    'sha256',
    'ordinal',
    'originalFileName',
    'createdAt',
  ])) throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
  let key: ReturnType<typeof parseExpenseStagingObjectKey>
  try {
    key = parseExpenseStagingObjectKey(receipt.objectKey)
  } catch {
    throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
  }
  if (
    key.rootRequestId !== rootRequestId
    || key.ordinal !== expectedOrdinal
    || key.ordinal !== receipt.ordinal
    || key.mimeType !== receipt.mimeType
    || key.sha256 !== receipt.sha256
    || !Number.isSafeInteger(receipt.sizeBytes)
    || receipt.sizeBytes < 1
    || receipt.sizeBytes > 10_000_000
    || !SHA256.test(receipt.sha256)
    || !isValidExpenseOriginalFileName(receipt.originalFileName)
    || !validTimestamp(receipt.createdAt)
  ) throw new ExpenseSubmissionError('EXPENSE_INVALID_ATTACHMENTS')
}

function verifyStagedReceipt(
  expected: ExpenseStagingReceipt,
  actual: ExpenseStagingReceipt & { bytes: Buffer },
): void {
  if (
    !Buffer.isBuffer(actual.bytes)
    || actual.objectKey !== expected.objectKey
    || actual.sizeBytes !== expected.sizeBytes
    || actual.mimeType !== expected.mimeType
    || actual.sha256 !== expected.sha256
    || actual.ordinal !== expected.ordinal
    || actual.originalFileName !== expected.originalFileName
    || actual.createdAt !== expected.createdAt
    || actual.bytes.length !== expected.sizeBytes
    || createHash('sha256').update(actual.bytes).digest('hex') !== expected.sha256
  ) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
}

function validatePrepared(
  prepared: ExpensePrepareResult,
  input: ExpenseSubmissionInput,
): void {
  const monthKey = input.expenseDate.slice(0, 7)
  if (
    !isRecord(prepared)
    || prepared.commandType !== 'PREPARE_EXPENSE'
    || prepared.monthKey !== monthKey
    || prepared.recordState !== 'PREPARED'
    || prepared.version !== 1
    || prepared.expectedRevision !== input.expectedRevision
    || prepared.expectedAttachmentCount !== input.stagingReceipts.length
    || prepared.expectedManifestHash !== expenseAttachmentManifestHash(input.stagingReceipts)
    || typeof prepared.expenseId !== 'string'
    || !new RegExp(`^EXP-${monthKey.replace('-', '')}-[A-Za-z0-9._:-]{1,107}$`).test(prepared.expenseId)
  ) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
}

function validateReceipt(
  receipt: ExpenseReceipt,
  prepared: ExpensePrepareResult,
  input: ExpenseSubmissionInput,
): void {
  if (
    !isRecord(receipt)
    || !hasExactKeys(receipt, [
      'expenseId',
      'receiptNumber',
      'expenseDate',
      'monthKey',
      'category',
      'scope',
      'amountSatang',
      'recordState',
      'revision',
      'committedAt',
      'unreviewed',
    ])
    || receipt.expenseId !== prepared.expenseId
    || receipt.receiptNumber !== prepared.expenseId
    || receipt.expenseDate !== input.expenseDate
    || receipt.monthKey !== prepared.monthKey
    || receipt.category !== input.category
    || receipt.scope !== deriveExpenseScope(input.category)
    || receipt.amountSatang !== input.amountSatang
    || receipt.recordState !== 'COMMITTED'
    || receipt.revision !== input.expectedRevision + 1
    || !validTimestamp(receipt.committedAt)
    || receipt.unreviewed !== true
  ) throw new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
}

function deterministicNameFor(receipt: ExpenseStagingReceipt): string {
  return `${String(receipt.ordinal).padStart(3, '0')}-${receipt.sha256}.${receipt.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
}

function deterministicAttachmentId(
  rootRequestId: string,
  expenseId: string,
  ordinal: number,
): string {
  const digest = createHash('sha256')
    .update(`${rootRequestId}:${expenseId}:${ordinal}`, 'utf8')
    .digest('hex')
  return `ATT-${digest.slice(0, 40)}`
}

function submissionFingerprint(input: ExpenseSubmissionInput): string {
  const validated = validateSubmission(input)
  return createHash('sha256').update(JSON.stringify({
    rootRequestId: validated.rootRequestId,
    staffId: validated.staffId,
    expenseDate: validated.expenseDate,
    category: validated.category,
    amountSatang: validated.amountSatang,
    counterpartyName: validated.counterpartyName,
    description: validated.description,
    paymentMethod: validated.paymentMethod,
    expectedRevision: validated.expectedRevision,
    stagingReceipts: validated.stagingReceipts,
  }), 'utf8').digest('hex')
}

function safeSubmissionError(error: unknown): ExpenseSubmissionError | ExpenseIngressClientError {
  if (error instanceof ExpenseSubmissionError || error instanceof ExpenseIngressClientError) return error
  if (error instanceof FinanceGoogleError) {
    return new ExpenseSubmissionError(error.code)
  }
  if (error instanceof ExpenseStagingError) {
    return new ExpenseSubmissionError(
      error.code === 'EXPENSE_DRIVE_SLOT_CONFLICT'
        || error.code === 'EXPENSE_SUBMISSION_LEASE_CONFLICT'
        ? 'EXPENSE_IDEMPOTENCY_CONFLICT'
        : 'EXPENSE_STORAGE_UNAVAILABLE',
    )
  }
  return new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE')
}

function enabledCategory(value: unknown): value is EnabledExpenseCategory {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}

function nullablePaymentMethod(value: unknown): value is ExpensePaymentMethod | null {
  return value === null || value === 'TRANSFER' || value === 'CASH' || value === 'CREDIT' || value === 'OTHER'
}

function nullableText(value: unknown, max: number): value is string | null {
  return value === null || boundedText(value, max)
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length <= max
    && !value.includes('\r')
    && !value.includes('\n')
    && !value.includes(String.fromCharCode(0))
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}
