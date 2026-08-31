import { createHmac, randomUUID } from 'node:crypto'
import {
  canonicalMiniAppExpenseRecoveryIngress,
  isExpenseRecoveryCounts,
  type ExpenseRecoveryCounts,
  type ExpenseRecoveryWorkerIdentity,
  type MiniAppExpenseRecoveryIngressEnvelope,
  type UnsignedMiniAppExpenseRecoveryIngressEnvelope,
} from '../../../shared/pmcMiniAppExpenseIngress.js'

interface RecoveryIngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type RecoveryIngressFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { 'content-type': string }
    body: string
    signal: AbortSignal
  },
) => Promise<RecoveryIngressResponse>

export interface ExpenseRecoveryIngressClient {
  recover(input: {
    correlationId: string
    worker: ExpenseRecoveryWorkerIdentity
  }): Promise<ExpenseRecoveryCounts>
}

export interface ExpenseRecoveryWorker {
  recover(worker: ExpenseRecoveryWorkerIdentity): Promise<ExpenseRecoveryCounts>
}

export interface ExpenseRecoveryLogEntry {
  correlationId: string
  code: 'EXPENSE_RECOVERY_COMPLETED' | 'EXPENSE_RECOVERY_FAILED'
}

export class ExpenseRecoveryIngressError extends Error {
  readonly code = 'EXPENSE_RECOVERY_FAILED' as const

  constructor() {
    super('Expense recovery ingress failed')
    this.name = 'ExpenseRecoveryIngressError'
  }
}

export class ExpenseRecoveryWorkerError extends Error {
  readonly code = 'EXPENSE_RECOVERY_FAILED' as const

  constructor() {
    super('Expense recovery failed')
    this.name = 'ExpenseRecoveryWorkerError'
  }
}

export function createExpenseRecoveryIngressClient(options: {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: RecoveryIngressFetch
}): ExpenseRecoveryIngressClient {
  const endpoint = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 60_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as RecoveryIngressFetch)
  if (
    !endpoint
    || !boundedSecret(secret)
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 60_000
    || !request
  ) throw new Error('Invalid expense recovery ingress configuration')

  return {
    async recover(input) {
      let body: MiniAppExpenseRecoveryIngressEnvelope
      try {
        body = buildRecoveryIngress(input, { timestamp: now(), nonce: nonce() }, secret)
      } catch {
        throw unavailable()
      }
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      try {
        const response = await request(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) throw unavailable()
        let responseBody: unknown
        try {
          responseBody = await response.json()
        } catch {
          throw unavailable()
        }
        if (
          hasExactKeys(responseBody, ['ok', 'result'])
          && responseBody.ok === true
          && isExpenseRecoveryCounts(responseBody.result)
        ) return { ...responseBody.result }
        throw unavailable()
      } catch (error) {
        if (timedOut || !(error instanceof ExpenseRecoveryIngressError)) throw unavailable()
        throw error
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export function createExpenseRecoveryWorker(options: {
  ingress: ExpenseRecoveryIngressClient
  correlationId?: () => string
  log?: (entry: ExpenseRecoveryLogEntry) => void
}): ExpenseRecoveryWorker {
  const correlationId = options.correlationId ?? (() => `expense-recovery-${randomUUID()}`)
  const log = options.log ?? defaultRecoveryLog
  return {
    async recover(worker) {
      const currentCorrelationId = correlationId()
      if (!safeCorrelationId(currentCorrelationId)) throw new ExpenseRecoveryWorkerError()
      try {
        const result = await options.ingress.recover({ correlationId: currentCorrelationId, worker })
        log({ correlationId: currentCorrelationId, code: 'EXPENSE_RECOVERY_COMPLETED' })
        return result
      } catch {
        log({ correlationId: currentCorrelationId, code: 'EXPENSE_RECOVERY_FAILED' })
        throw new ExpenseRecoveryWorkerError()
      }
    },
  }
}

function buildRecoveryIngress(
  input: { correlationId: string; worker: ExpenseRecoveryWorkerIdentity },
  context: { timestamp: number; nonce: string },
  secret: string,
): MiniAppExpenseRecoveryIngressEnvelope {
  const unsigned: UnsignedMiniAppExpenseRecoveryIngressEnvelope = {
    kind: 'MINI_APP_EXPENSE_RECOVERY',
    version: 1,
    timestamp: context.timestamp,
    nonce: context.nonce,
    correlationId: input.correlationId,
    worker: input.worker,
  }
  const canonical = canonicalMiniAppExpenseRecoveryIngress(unsigned)
  return {
    ...unsigned,
    signature: createHmac('sha256', secret).update(canonical, 'utf8').digest('hex'),
  }
}

function defaultRecoveryLog(entry: ExpenseRecoveryLogEntry): void {
  console.info(JSON.stringify(entry))
}

function safeCorrelationId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function boundedSecret(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_048
}

function safeHttpsUrl(value: string): string | null {
  try {
    const normalized = value.trim()
    const parsed = new URL(normalized)
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password
      ? normalized
      : null
  } catch {
    return null
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

function unavailable(): ExpenseRecoveryIngressError {
  return new ExpenseRecoveryIngressError()
}
