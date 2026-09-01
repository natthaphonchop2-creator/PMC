import { createHash } from 'node:crypto'
import { Storage, type Bucket } from '@google-cloud/storage'
import {
  deriveExpenseScope,
  isCanonicalExpenseTimestamp,
  isValidExpenseOriginalFileName,
  parseExpenseDate,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense.js'
import type {
  ExpenseAsyncJobState,
  ExpenseAsyncOperation,
} from '../../../shared/pmcExpenseAsync.js'
import {
  isMiniAppExpenseSafeErrorCode,
  type MiniAppExpenseSafeErrorCode,
} from '../../../shared/pmcMiniAppExpenseIngress.js'
import type { ExpenseSubmissionInput } from './submissionService.js'
import { parseExpenseStagingObjectKey } from './stagingStore.js'

const ROOT = /^[A-Za-z0-9._:-]{1,116}$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const GENERATION = /^[1-9]\d*$/
const OWNER = /^[A-Za-z0-9._:-]{8,128}$/
const TASK_NAME = /^projects\/[a-z][a-z0-9-]{4,62}[a-z0-9]\/locations\/[a-z0-9-]+\/queues\/[a-z0-9._-]+\/tasks\/[a-z0-9._-]+$/
const JOB_PREFIX = 'expense-async-jobs/v1/'
const MAX_JOB_BYTES = 64 * 1024

export interface ExpenseAsyncJobInput {
  kind: ExpenseAsyncOperation['kind']
  replacementOfExpenseId: string | null
  expectedVersion: number | null
  submission: ExpenseSubmissionInput
  acceptedAt: string
}

export interface ExpenseAsyncJob extends ExpenseAsyncJobInput {
  version: 1
  objectKey: string
  generation: string
  fingerprint: string
  rootRequestId: string
  staffId: string
  state: ExpenseAsyncJobState
  taskName: string | null
  createdAt: string
  updatedAt: string
  attemptCount: number
  leaseOwnerToken: string | null
  leaseExpiresAt: string | null
  receipt: ExpenseReceipt | null
  safeErrorCode: MiniAppExpenseSafeErrorCode | null
}

type PersistedJob = Omit<ExpenseAsyncJob, 'objectKey' | 'generation'>

export interface ExpenseAsyncJobStore {
  createOrRead(input: ExpenseAsyncJobInput): Promise<{ job: ExpenseAsyncJob; created: boolean }>
  markQueued(job: ExpenseAsyncJob, taskName: string): Promise<ExpenseAsyncJob>
  read(rootRequestId: string): Promise<ExpenseAsyncJob | null>
  claim(input: {
    rootRequestId: string
    fingerprint: string
    ownerToken: string
    leaseExpiresAt: string
    taskAttempt: number
  }): Promise<ExpenseAsyncJob>
  renew(job: ExpenseAsyncJob, leaseExpiresAt: string): Promise<ExpenseAsyncJob>
  markRetrying(job: ExpenseAsyncJob, safeErrorCode: MiniAppExpenseSafeErrorCode): Promise<ExpenseAsyncJob>
  commit(job: ExpenseAsyncJob, receipt: ExpenseReceipt): Promise<ExpenseAsyncJob>
  fail(job: ExpenseAsyncJob, safeErrorCode: MiniAppExpenseSafeErrorCode): Promise<ExpenseAsyncJob>
  needsReview(job: ExpenseAsyncJob): Promise<ExpenseAsyncJob>
}

export type ExpenseAsyncJobStoreErrorCode =
  | 'EXPENSE_IDEMPOTENCY_CONFLICT'
  | 'EXPENSE_ASYNC_JOB_INVALID'
  | 'EXPENSE_ASYNC_JOB_STALE'
  | 'EXPENSE_ASYNC_JOB_LEASE_UNAVAILABLE'
  | 'EXPENSE_ASYNC_JOB_TERMINAL'
  | 'EXPENSE_ASYNC_JOB_UNAVAILABLE'

export class ExpenseAsyncJobStoreError extends Error {
  readonly code: ExpenseAsyncJobStoreErrorCode
  constructor(code: ExpenseAsyncJobStoreErrorCode) {
    super(code)
    this.name = 'ExpenseAsyncJobStoreError'
    this.code = code
  }
}

export function canonicalExpenseAsyncJobInput(input: ExpenseAsyncJobInput): string {
  const value = validInput(input)
  return JSON.stringify(orderedInput(value))
}

export function expenseAsyncFingerprint(input: ExpenseAsyncJobInput): string {
  return createHash('sha256').update(canonicalExpenseAsyncJobInput(input), 'utf8').digest('hex')
}

export function createGoogleExpenseAsyncJobStore(input: {
  bucketName: string
  storage?: Storage
  now?: () => string
}): ExpenseAsyncJobStore {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(input.bucketName)) {
    throw new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_INVALID')
  }
  const bucket = (input.storage ?? new Storage()).bucket(input.bucketName)
  const now = input.now ?? (() => new Date().toISOString())

  async function read(rootRequestId: string): Promise<ExpenseAsyncJob | null> {
    if (!ROOT.test(rootRequestId)) throw invalid()
    const objectKey = `${JOB_PREFIX}${rootRequestId}.json`
    try {
      return await readJob(bucket, objectKey)
    } catch (error) {
      if (isNotFound(error)) return null
      if (error instanceof ExpenseAsyncJobStoreError) throw error
      throw unavailable()
    }
  }

  async function transition(
    job: ExpenseAsyncJob,
    patch: Partial<PersistedJob>,
  ): Promise<ExpenseAsyncJob> {
    const current = validJob(job)
    const updatedAt = validNow(now())
    const next = validPersisted({
      ...persisted(current),
      ...patch,
      rootRequestId: current.rootRequestId,
      staffId: current.staffId,
      fingerprint: current.fingerprint,
      kind: current.kind,
      replacementOfExpenseId: current.replacementOfExpenseId,
      expectedVersion: current.expectedVersion,
      submission: current.submission,
      acceptedAt: current.acceptedAt,
      createdAt: current.createdAt,
      updatedAt,
    })
    try {
      await saveJob(bucket.file(current.objectKey), next, current.generation)
      return await readJob(bucket, current.objectKey)
    } catch (error) {
      if (isPrecondition(error)) throw stale()
      if (error instanceof ExpenseAsyncJobStoreError) throw error
      throw unavailable()
    }
  }

  return {
    async createOrRead(jobInput) {
      const validated = validInput(jobInput)
      const rootRequestId = validated.submission.rootRequestId
      const objectKey = `${JOB_PREFIX}${rootRequestId}.json`
      const fingerprint = expenseAsyncFingerprint(validated)
      const initial = validPersisted({
        version: 1,
        ...orderedInput(validated),
        rootRequestId,
        staffId: validated.submission.staffId,
        fingerprint,
        state: 'QUEUING',
        taskName: null,
        createdAt: validated.acceptedAt,
        updatedAt: validated.acceptedAt,
        attemptCount: 0,
        leaseOwnerToken: null,
        leaseExpiresAt: null,
        receipt: null,
        safeErrorCode: null,
      })
      try {
        await saveJob(bucket.file(objectKey), initial, 0)
        return { job: await readJob(bucket, objectKey), created: true }
      } catch (error) {
        if (!isPrecondition(error)) {
          if (error instanceof ExpenseAsyncJobStoreError) throw error
          throw unavailable()
        }
      }
      const existing = await readJob(bucket, objectKey)
      if (
        existing.fingerprint !== fingerprint
        || canonicalExpenseAsyncJobInput(orderedInput(existing)) !== canonicalExpenseAsyncJobInput(validated)
      ) throw new ExpenseAsyncJobStoreError('EXPENSE_IDEMPOTENCY_CONFLICT')
      return { job: existing, created: false }
    },

    read,

    async markQueued(job, taskName) {
      const current = validJob(job)
      if (!TASK_NAME.test(taskName)) throw invalid()
      if (current.state === 'QUEUED' && current.taskName === taskName) return current
      if (current.state !== 'QUEUING') throw terminal()
      return transition(current, { state: 'QUEUED', taskName })
    },

    async claim(claimInput) {
      if (
        !ROOT.test(claimInput.rootRequestId)
        || !SHA256.test(claimInput.fingerprint)
        || !OWNER.test(claimInput.ownerToken)
        || !Number.isSafeInteger(claimInput.taskAttempt)
        || claimInput.taskAttempt < 0
      ) throw invalid()
      const capturedAt = validNow(now())
      const leaseExpiresAt = validLeaseExpiry(claimInput.leaseExpiresAt, capturedAt)
      const current = await read(claimInput.rootRequestId)
      if (!current) throw unavailable()
      if (current.fingerprint !== claimInput.fingerprint) throw new ExpenseAsyncJobStoreError('EXPENSE_IDEMPOTENCY_CONFLICT')
      if (isTerminal(current.state)) return current
      if (current.state === 'PROCESSING' && Date.parse(current.leaseExpiresAt ?? '') > Date.parse(capturedAt)) {
        if (current.leaseOwnerToken === claimInput.ownerToken) return current
        throw new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_LEASE_UNAVAILABLE')
      }
      if (!['QUEUED', 'RETRYING', 'PROCESSING'].includes(current.state)) throw stale()
      return transition(current, {
        state: 'PROCESSING',
        attemptCount: Math.max(current.attemptCount, claimInput.taskAttempt + 1),
        leaseOwnerToken: claimInput.ownerToken,
        leaseExpiresAt,
        safeErrorCode: null,
      })
    },

    async renew(job, leaseExpiresAt) {
      const current = validJob(job)
      if (current.state !== 'PROCESSING' || !current.leaseOwnerToken) throw stale()
      validLeaseExpiry(leaseExpiresAt, validNow(now()))
      return transition(current, { leaseExpiresAt })
    },

    async markRetrying(job, safeErrorCode) {
      requireSafeError(safeErrorCode)
      const current = validJob(job)
      if (current.state !== 'PROCESSING') throw stale()
      return transition(current, {
        state: 'RETRYING', leaseOwnerToken: null, leaseExpiresAt: null, safeErrorCode,
      })
    },

    async commit(job, receipt) {
      const current = validJob(job)
      const safeReceipt = validReceipt(receipt)
      if (current.state === 'COMMITTED') {
        if (JSON.stringify(current.receipt) !== JSON.stringify(safeReceipt)) throw terminal()
        return current
      }
      if (isTerminal(current.state) || current.state !== 'PROCESSING') throw terminal()
      return transition(current, {
        state: 'COMMITTED', receipt: safeReceipt,
        leaseOwnerToken: null, leaseExpiresAt: null, safeErrorCode: null,
      })
    },

    async fail(job, safeErrorCode) {
      requireSafeError(safeErrorCode)
      const current = validJob(job)
      if (isTerminal(current.state)) throw terminal()
      if (current.state !== 'PROCESSING') throw stale()
      return transition(current, {
        state: 'FAILED', receipt: null,
        leaseOwnerToken: null, leaseExpiresAt: null, safeErrorCode,
      })
    },

    async needsReview(job) {
      const current = validJob(job)
      if (current.state === 'NEEDS_REVIEW') return current
      if (isTerminal(current.state) || current.state !== 'PROCESSING') throw terminal()
      return transition(current, {
        state: 'NEEDS_REVIEW', receipt: null,
        leaseOwnerToken: null, leaseExpiresAt: null, safeErrorCode: 'EXPENSE_NEEDS_REVIEW',
      })
    },
  }
}

function orderedInput(input: ExpenseAsyncJobInput): ExpenseAsyncJobInput {
  return {
    kind: input.kind,
    replacementOfExpenseId: input.replacementOfExpenseId,
    expectedVersion: input.expectedVersion,
    acceptedAt: input.acceptedAt,
    submission: {
      rootRequestId: input.submission.rootRequestId,
      staffId: input.submission.staffId,
      expenseDate: input.submission.expenseDate,
      category: input.submission.category,
      amountSatang: input.submission.amountSatang,
      counterpartyName: input.submission.counterpartyName,
      description: input.submission.description,
      paymentMethod: input.submission.paymentMethod,
      expectedRevision: input.submission.expectedRevision,
      stagingReceipts: input.submission.stagingReceipts.map((receipt) => ({
        objectKey: receipt.objectKey,
        sizeBytes: receipt.sizeBytes,
        mimeType: receipt.mimeType,
        sha256: receipt.sha256,
        ordinal: receipt.ordinal,
        originalFileName: receipt.originalFileName,
        createdAt: receipt.createdAt,
      })),
    },
  }
}

function validInput(input: ExpenseAsyncJobInput): ExpenseAsyncJobInput {
  if (!hasExactKeys(input, ['kind', 'replacementOfExpenseId', 'expectedVersion', 'submission', 'acceptedAt'])
    || !isCanonicalExpenseTimestamp(input.acceptedAt)) throw invalid()
  const submission = input.submission
  if (
    !hasExactKeys(submission, [
      'rootRequestId', 'staffId', 'expenseDate', 'category', 'amountSatang',
      'counterpartyName', 'description', 'paymentMethod', 'expectedRevision', 'stagingReceipts',
    ])
    || !ROOT.test(submission.rootRequestId)
    || !SAFE_ID.test(submission.staffId)
    || !['BILL_DOCUMENT', 'BOOK_CLINIC', 'BOOK_DOCTOR_PERSONAL'].includes(submission.category)
    || !Number.isSafeInteger(submission.amountSatang) || submission.amountSatang <= 0
    || !Number.isSafeInteger(submission.expectedRevision) || submission.expectedRevision < 0
    || typeof submission.description !== 'string' || submission.description.length > 500
    || !Array.isArray(submission.stagingReceipts)
    || submission.stagingReceipts.length < 1 || submission.stagingReceipts.length > 5
  ) throw invalid()
  try { parseExpenseDate(submission.expenseDate) } catch { throw invalid() }
  if (submission.category === 'BILL_DOCUMENT') {
    if (!submission.counterpartyName?.trim() || !['TRANSFER', 'CASH', 'CREDIT', 'OTHER'].includes(String(submission.paymentMethod))) throw invalid()
  } else if (submission.counterpartyName !== null || submission.paymentMethod !== null) throw invalid()
  for (const [index, receipt] of submission.stagingReceipts.entries()) {
    if (!hasExactKeys(receipt, [
      'objectKey', 'sizeBytes', 'mimeType', 'sha256', 'ordinal', 'originalFileName', 'createdAt',
    ])) throw invalid()
    let parsed
    try { parsed = parseExpenseStagingObjectKey(receipt.objectKey) } catch { throw invalid() }
    if (
      parsed.rootRequestId !== submission.rootRequestId
      || parsed.ordinal !== index + 1
      || parsed.sha256 !== receipt.sha256
      || parsed.mimeType !== receipt.mimeType
      || receipt.ordinal !== index + 1
      || !SHA256.test(receipt.sha256)
      || !Number.isSafeInteger(receipt.sizeBytes) || receipt.sizeBytes < 1 || receipt.sizeBytes > 10_000_000
      || !isValidExpenseOriginalFileName(receipt.originalFileName)
      || !isCanonicalExpenseTimestamp(receipt.createdAt)
    ) throw invalid()
  }
  if (input.kind === 'CREATE') {
    if (input.replacementOfExpenseId !== null || input.expectedVersion !== null) throw invalid()
  } else if (input.kind === 'REPLACE') {
    const replacementOfExpenseId = input.replacementOfExpenseId
    const expectedVersion = input.expectedVersion
    if (typeof replacementOfExpenseId !== 'string' || !SAFE_ID.test(replacementOfExpenseId)
      || typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw invalid()
  } else throw invalid()
  return orderedInput(input)
}

function validJob(job: ExpenseAsyncJob): ExpenseAsyncJob {
  if (!job || job.objectKey !== `${JOB_PREFIX}${job.rootRequestId}.json` || !GENERATION.test(job.generation)) throw invalid()
  const persistedJob = validPersisted(persisted(job))
  return { ...persistedJob, objectKey: job.objectKey, generation: job.generation }
}

function validPersisted(value: PersistedJob): PersistedJob {
  if (!hasExactKeys(value, [
    'version', 'kind', 'replacementOfExpenseId', 'expectedVersion', 'acceptedAt', 'submission',
    'rootRequestId', 'staffId', 'fingerprint', 'state', 'taskName', 'createdAt', 'updatedAt',
    'attemptCount', 'leaseOwnerToken', 'leaseExpiresAt', 'receipt', 'safeErrorCode',
  ]) || value.version !== 1 || !ROOT.test(value.rootRequestId) || !SAFE_ID.test(value.staffId)) throw invalid()
  const input = validInput(orderedInput(value))
  if (
    input.submission.rootRequestId !== value.rootRequestId
    || input.submission.staffId !== value.staffId
    || expenseAsyncFingerprint(input) !== value.fingerprint
    || value.createdAt !== value.acceptedAt
    || !isCanonicalExpenseTimestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || !Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 || value.attemptCount > 8
  ) throw invalid()
  if (value.taskName !== null && !TASK_NAME.test(value.taskName)) throw invalid()
  if (value.safeErrorCode !== null && !isMiniAppExpenseSafeErrorCode(value.safeErrorCode)) throw invalid()
  if (value.state === 'QUEUING') requireEmptyRuntime(value, false)
  else if (value.state === 'QUEUED') requireQueued(value)
  else if (value.state === 'PROCESSING') requireProcessing(value)
  else if (value.state === 'RETRYING') requireRetrying(value)
  else if (value.state === 'COMMITTED') {
    requireNoLease(value)
    validReceipt(value.receipt)
    if (value.safeErrorCode !== null) throw invalid()
  } else if (value.state === 'FAILED') {
    requireNoLease(value)
    if (value.receipt !== null || value.safeErrorCode === null) throw invalid()
  } else if (value.state === 'NEEDS_REVIEW') {
    requireNoLease(value)
    if (value.receipt !== null || value.safeErrorCode !== 'EXPENSE_NEEDS_REVIEW') throw invalid()
  } else throw invalid()
  return { ...value, ...input, receipt: value.receipt ? validReceipt(value.receipt) : null }
}

function requireEmptyRuntime(value: PersistedJob, needsTask: boolean): void {
  if ((needsTask ? value.taskName === null : value.taskName !== null)
    || value.attemptCount !== 0 || value.leaseOwnerToken !== null || value.leaseExpiresAt !== null
    || value.receipt !== null || value.safeErrorCode !== null) throw invalid()
}

function requireQueued(value: PersistedJob): void {
  if (value.taskName === null || value.leaseOwnerToken !== null || value.leaseExpiresAt !== null
    || value.receipt !== null || value.safeErrorCode !== null) throw invalid()
}

function requireProcessing(value: PersistedJob): void {
  if (value.taskName === null || !value.leaseOwnerToken || !OWNER.test(value.leaseOwnerToken)
    || !isCanonicalExpenseTimestamp(value.leaseExpiresAt) || value.receipt !== null || value.safeErrorCode !== null
    || value.attemptCount < 1) throw invalid()
}

function requireRetrying(value: PersistedJob): void {
  if (value.taskName === null || value.leaseOwnerToken !== null || value.leaseExpiresAt !== null
    || value.receipt !== null || value.safeErrorCode === null || value.attemptCount < 1) throw invalid()
}

function requireNoLease(value: PersistedJob): void {
  if (value.taskName === null || value.leaseOwnerToken !== null || value.leaseExpiresAt !== null
    || value.attemptCount < 1) throw invalid()
}

function validReceipt(value: ExpenseReceipt | null): ExpenseReceipt {
  if (
    !hasExactKeys(value, [
      'expenseId', 'receiptNumber', 'expenseDate', 'monthKey', 'category', 'scope',
      'amountSatang', 'recordState', 'revision', 'committedAt', 'unreviewed',
    ])
    || !SAFE_ID.test(value.expenseId)
    || value.receiptNumber !== value.expenseId
    || parseExpenseDate(value.expenseDate).monthKey !== value.monthKey
    || !['BILL_DOCUMENT', 'BOOK_CLINIC', 'BOOK_DOCTOR_PERSONAL'].includes(value.category)
    || value.scope !== deriveExpenseScope(value.category)
    || !Number.isSafeInteger(value.amountSatang) || value.amountSatang <= 0
    || value.recordState !== 'COMMITTED'
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !isCanonicalExpenseTimestamp(value.committedAt)
    || value.unreviewed !== true
  ) throw invalid()
  return { ...value }
}

function persisted(job: ExpenseAsyncJob): PersistedJob {
  const { objectKey, generation, ...value } = job
  void objectKey
  void generation
  return value
}

async function saveJob(file: ReturnType<Bucket['file']>, job: PersistedJob, generation: string | number): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(job), 'utf8')
  if (bytes.length < 2 || bytes.length > MAX_JOB_BYTES) throw invalid()
  await file.save(bytes, {
    resumable: false,
    validation: 'crc32c',
    preconditionOpts: { ifGenerationMatch: generation },
    metadata: { contentType: 'application/json', cacheControl: 'no-store' },
  })
}

async function readJob(bucket: Bucket, objectKey: string): Promise<ExpenseAsyncJob> {
  try {
    const file = bucket.file(objectKey)
    const metadata = (await file.getMetadata())[0]
    const generation = String(metadata.generation ?? '')
    const size = Number(metadata.size)
    if (
      metadata.name !== objectKey || metadata.contentType !== 'application/json'
      || metadata.cacheControl !== 'no-store' || !GENERATION.test(generation)
      || !Number.isSafeInteger(size) || size < 2 || size > MAX_JOB_BYTES
    ) throw invalid()
    const [bytes] = await bucket.file(objectKey, { generation }).download({ validation: 'crc32c' })
    if (bytes.length !== size) throw invalid()
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw invalid() }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid()
    const job = validPersisted(parsed as PersistedJob)
    return { ...job, objectKey, generation }
  } catch (error) {
    if (error instanceof ExpenseAsyncJobStoreError) throw error
    throw error
  }
}

function validNow(value: string): string {
  if (!isCanonicalExpenseTimestamp(value)) throw invalid()
  return value
}

function validLeaseExpiry(value: string, capturedAt: string): string {
  if (!isCanonicalExpenseTimestamp(value)) throw invalid()
  const duration = Date.parse(value) - Date.parse(capturedAt)
  if (duration <= 0 || duration > 300_000) throw invalid()
  return value
}

function requireSafeError(code: MiniAppExpenseSafeErrorCode): void {
  if (!isMiniAppExpenseSafeErrorCode(code)) throw invalid()
}

function isTerminal(state: ExpenseAsyncJobState): boolean {
  return state === 'COMMITTED' || state === 'FAILED' || state === 'NEEDS_REVIEW'
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && Number(error.code) === 404)
}

function isPrecondition(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && Number(error.code) === 412)
}

function invalid(): ExpenseAsyncJobStoreError {
  return new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_INVALID')
}

function stale(): ExpenseAsyncJobStoreError {
  return new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_STALE')
}

function terminal(): ExpenseAsyncJobStoreError {
  return new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_TERMINAL')
}

function unavailable(): ExpenseAsyncJobStoreError {
  return new ExpenseAsyncJobStoreError('EXPENSE_ASYNC_JOB_UNAVAILABLE')
}
