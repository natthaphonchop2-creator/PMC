import { createHmac, randomUUID } from 'node:crypto'
import {
  deriveExpenseScope,
  parseExpenseDate,
  type ExpenseReceipt,
} from '../../../shared/pmcExpense.js'
import {
  canonicalMiniAppExpenseIngress,
  isMiniAppExpenseSafeErrorCode,
  type ExpensePrepareResult,
  type ExpenseCommandResult,
  type MiniAppExpenseCommand,
  type MiniAppExpenseIngressEnvelope,
  type MiniAppExpenseSafeErrorCode,
  type UnsignedMiniAppExpenseIngressEnvelope,
} from '../../../shared/pmcMiniAppExpenseIngress.js'

interface IngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type IngressFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { 'content-type': string }
    body: string
    signal: AbortSignal
  },
) => Promise<IngressResponse>

type PrepareCommand = Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }>
type CommitCommand = Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
type VoidCommand = Extract<MiniAppExpenseCommand, { commandType: 'VOID_EXPENSE' }>
type VoidResult = Extract<ExpenseCommandResult, { commandType: 'VOID_EXPENSE' }>

export interface ExpenseIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export interface ExpenseIngressClient {
  prepare(command: PrepareCommand): Promise<ExpensePrepareResult>
  commit(command: CommitCommand): Promise<ExpenseReceipt>
  void(command: VoidCommand): Promise<VoidResult>
}

export class ExpenseIngressClientError extends Error {
  readonly code: MiniAppExpenseSafeErrorCode
  readonly retryable: boolean

  constructor(code: MiniAppExpenseSafeErrorCode) {
    super(`Expense ingress failed: ${code}`)
    this.name = 'ExpenseIngressClientError'
    this.code = code
    this.retryable = code === 'EXPENSE_STORAGE_UNAVAILABLE'
  }
}

export function buildMiniAppExpenseIngress(
  command: MiniAppExpenseCommand,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppExpenseIngressEnvelope; headers: { 'content-type': 'application/json' } } {
  if (
    !Number.isSafeInteger(context.timestamp)
    || context.timestamp <= 0
    || !safeNonce(context.nonce)
    || !boundedSecret(secret)
  ) throw new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE')

  const unsigned: UnsignedMiniAppExpenseIngressEnvelope = {
    kind: 'MINI_APP_EXPENSE',
    version: 1,
    timestamp: context.timestamp,
    nonce: context.nonce,
    command,
  }
  let canonical: string
  try {
    canonical = canonicalMiniAppExpenseIngress(unsigned)
  } catch {
    throw new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE')
  }
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
  return {
    body: { ...unsigned, signature },
    headers: { 'content-type': 'application/json' },
  }
}

export function createExpenseIngressClient(
  options: ExpenseIngressClientOptions,
): ExpenseIngressClient {
  const url = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 60_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (
    !url
    || !boundedSecret(secret)
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 60_000
    || !request
  ) throw new Error('Invalid Expense ingress client configuration')
  const endpoint = url

  async function send(command: PrepareCommand): Promise<ExpensePrepareResult>
  async function send(command: CommitCommand): Promise<ExpenseReceipt>
  async function send(command: VoidCommand): Promise<VoidResult>
  async function send(command: PrepareCommand | CommitCommand | VoidCommand): Promise<ExpensePrepareResult | ExpenseReceipt | VoidResult> {
    const built = buildMiniAppExpenseIngress(command, { timestamp: now(), nonce: nonce() }, secret)
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: controller.signal,
      })
      if (!response.ok) throw unavailable()
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw unavailable()
      }
      if (hasExactKeys(body, ['ok', 'result']) && body.ok === true) {
        if (command.commandType === 'PREPARE_EXPENSE') return parsePrepareResult(body.result, command)
        if (command.commandType === 'COMMIT_EXPENSE') return parseCommitResult(body.result, command)
        return parseVoidResult(body.result, command)
      }
      if (
        hasExactKeys(body, ['ok', 'error'])
        && body.ok === false
        && isMiniAppExpenseSafeErrorCode(body.error)
      ) throw new ExpenseIngressClientError(body.error)
      throw unavailable()
    } catch (error) {
      if (timedOut) throw unavailable()
      if (error instanceof ExpenseIngressClientError) throw error
      throw unavailable()
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    prepare(command) { return send(command) },
    commit(command) { return send(command) },
    void(command) { return send(command) },
  }
}

function parsePrepareResult(value: unknown, command: PrepareCommand): ExpensePrepareResult {
  if (
    !hasExactKeys(value, [
      'commandType',
      'expenseId',
      'monthKey',
      'recordState',
      'version',
      'expectedRevision',
      'expectedAttachmentCount',
      'expectedManifestHash',
    ])
    || value.commandType !== 'PREPARE_EXPENSE'
    || !safeExpenseId(value.expenseId)
    || value.monthKey !== command.payload.expenseDate.slice(0, 7)
    || !expenseIdMatchesMonth(value.expenseId, value.monthKey)
    || value.recordState !== 'PREPARED'
    || value.version !== 1
    || value.expectedRevision !== command.payload.expectedRevision
    || value.expectedAttachmentCount !== command.payload.expectedAttachmentCount
    || value.expectedManifestHash !== command.payload.expectedManifestHash
  ) throw unavailable()
  return {
    commandType: 'PREPARE_EXPENSE',
    expenseId: value.expenseId,
    monthKey: value.monthKey,
    recordState: 'PREPARED',
    version: 1,
    expectedRevision: value.expectedRevision,
    expectedAttachmentCount: value.expectedAttachmentCount,
    expectedManifestHash: value.expectedManifestHash,
  }
}

function parseCommitResult(value: unknown, command: CommitCommand): ExpenseReceipt {
  if (
    !hasExactKeys(value, [
      'commandType',
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
    || value.commandType !== 'COMMIT_EXPENSE'
    || value.expenseId !== command.payload.expenseId
    || value.receiptNumber !== value.expenseId
    || typeof value.expenseDate !== 'string'
    || typeof value.monthKey !== 'string'
    || !validReceiptDate(value.expenseDate, value.monthKey, value.expenseId)
    || !enabledCategory(value.category)
    || value.scope !== deriveExpenseScope(value.category)
    || !positiveSafeInteger(value.amountSatang)
    || value.recordState !== 'COMMITTED'
    || value.revision !== command.payload.expectedRevision + 1
    || typeof value.committedAt !== 'string'
    || !Number.isFinite(Date.parse(value.committedAt))
    || value.unreviewed !== true
  ) throw unavailable()
  return {
    expenseId: value.expenseId,
    receiptNumber: value.receiptNumber,
    expenseDate: value.expenseDate,
    monthKey: value.monthKey,
    category: value.category,
    scope: deriveExpenseScope(value.category),
    amountSatang: value.amountSatang,
    recordState: 'COMMITTED',
    revision: value.revision,
    committedAt: value.committedAt,
    unreviewed: true,
  }
}

function parseVoidResult(value: unknown, command: VoidCommand): VoidResult {
  if (
    !hasExactKeys(value, ['commandType', 'expenseId', 'recordState', 'version', 'updatedAt'])
    || value.commandType !== 'VOID_EXPENSE'
    || value.expenseId !== command.payload.expenseId
    || value.recordState !== 'VOID'
    || typeof value.version !== 'number'
    || !Number.isSafeInteger(value.version)
    || value.version !== command.payload.expectedVersion + 1
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))
  ) throw unavailable()
  return {
    commandType: 'VOID_EXPENSE',
    expenseId: value.expenseId,
    recordState: 'VOID',
    version: value.version,
    updatedAt: value.updatedAt,
  }
}

function validReceiptDate(expenseDate: string, monthKey: string, expenseId: string): boolean {
  try {
    const parsed = parseExpenseDate(expenseDate)
    return parsed.monthKey === monthKey && expenseIdMatchesMonth(expenseId, monthKey)
  } catch {
    return false
  }
}

function expenseIdMatchesMonth(expenseId: string, monthKey: string): boolean {
  return new RegExp(`^EXP-${monthKey.replace('-', '')}-[A-Za-z0-9._:-]{1,107}$`).test(expenseId)
}

function enabledCategory(value: unknown): value is ExpenseReceipt['category'] {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function safeExpenseId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function safeNonce(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value)
}

function boundedSecret(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_048
}

function safeHttpsUrl(value: string): string | null {
  try {
    const normalized = value.trim()
    const parsed = new URL(normalized)
    return parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password
      ? normalized
      : null
  } catch {
    return null
  }
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

function unavailable(): ExpenseIngressClientError {
  return new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE')
}
