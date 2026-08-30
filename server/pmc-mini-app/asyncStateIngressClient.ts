import { createHmac, randomUUID } from 'node:crypto'
import {
  canonicalMiniAppAsyncStateIngress,
  type MiniAppAsyncStateIngressEnvelope,
  type MiniAppAsyncStateIngressResult,
  type MiniAppAsyncStateMutation,
  type UnsignedMiniAppAsyncStateIngressEnvelope,
} from '../../shared/pmcMiniAppAsyncState.js'

interface IngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type IngressFetch = (
  url: string,
  init: { method: 'POST'; headers: { 'content-type': string }; body: string; signal: AbortSignal },
) => Promise<IngressResponse>

export interface AsyncStateIngressPort {
  mutate(input: MiniAppAsyncStateMutation): Promise<MiniAppAsyncStateIngressResult>
}

export interface AsyncStateIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export class AsyncStateIngressClientError extends Error {
  readonly code: 'ASYNC_STATE_INGRESS_TIMEOUT' | 'ASYNC_STATE_INGRESS_FAILED' | 'ASYNC_STATE_INGRESS_INVALID_RESPONSE'

  constructor(code: AsyncStateIngressClientError['code']) {
    super(code)
    this.name = 'AsyncStateIngressClientError'
    this.code = code
  }
}

export function buildMiniAppAsyncStateIngress(
  input: MiniAppAsyncStateMutation,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppAsyncStateIngressEnvelope; headers: { 'content-type': 'application/json' } } {
  if (!validMutation(input) || !Number.isSafeInteger(context.timestamp) || context.timestamp <= 0
    || !/^[A-Za-z0-9_-]{8,128}$/.test(context.nonce) || !secret) {
    throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_FAILED')
  }
  const unsigned: UnsignedMiniAppAsyncStateIngressEnvelope = {
    kind: 'MINI_APP_ASYNC_STATE', version: 1, timestamp: context.timestamp, nonce: context.nonce,
    payload: structuredClone(input),
  }
  const signature = createHmac('sha256', secret).update(canonicalMiniAppAsyncStateIngress(unsigned), 'utf8').digest('hex')
  return { body: { ...unsigned, signature }, headers: { 'content-type': 'application/json' } }
}

export function createAsyncStateIngressClient(options: AsyncStateIngressClientOptions): AsyncStateIngressPort {
  const url = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (!url || !secret || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !request) {
    throw new Error('Invalid async state ingress client configuration')
  }
  return {
    async mutate(input) {
      const built = buildMiniAppAsyncStateIngress(input, { timestamp: now(), nonce: nonce() }, secret)
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const response = await request(url, {
          method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: controller.signal,
        })
        if (!response.ok) throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_FAILED')
        let body: unknown
        try { body = await response.json() } catch { throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_INVALID_RESPONSE') }
        if (!isResult(body)) throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_INVALID_RESPONSE')
        return body
      } catch (error) {
        if (timedOut) throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_TIMEOUT')
        if (error instanceof AsyncStateIngressClientError) throw error
        throw new AsyncStateIngressClientError('ASYNC_STATE_INGRESS_FAILED')
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function validMutation(value: MiniAppAsyncStateMutation): boolean {
  const common = value !== null && typeof value === 'object'
    && /^(QUEUE|CLAIM|RENEW|PROJECT|RETRY|EXHAUST|COMPLETE|RETAIN_PREPARE)$/.test(value.operation)
    && /^[A-Za-z0-9._:-]{1,124}$/.test(value.requestId)
    && /^[A-Za-z0-9._:-]{1,124}$/.test(value.draftId)
    && /^[A-Za-z0-9_-]{4,128}$/.test(value.payloadHash)
    && Number.isSafeInteger(value.expectedVersion) && value.expectedVersion >= 1
    && Number.isSafeInteger(value.expectedAttempt) && value.expectedAttempt >= 0
    && Number.isSafeInteger(value.taskAttempt) && value.taskAttempt >= 1 && value.taskAttempt <= 8
    && typeof value.nowIso === 'string' && Number.isFinite(Date.parse(value.nowIso))
    && validObjectKeys(value.paymentEvidenceObjectKeys, value.draftId, 'PAYMENT')
    && validObjectKeys(value.chatEvidenceObjectKeys, value.draftId, 'CHAT')
    && validFileIds(value.paymentEvidenceFileIds) && validFileIds(value.chatEvidenceFileIds)
    && Number.isSafeInteger(value.evidenceCount) && value.evidenceCount >= 0 && value.evidenceCount <= 20
  if (!common) return false
  if (value.operation !== 'RETAIN_PREPARE') return true
  const fileCount = value.paymentEvidenceFileIds.length + value.chatEvidenceFileIds.length
  const objectCount = value.paymentEvidenceObjectKeys.length + value.chatEvidenceObjectKeys.length
  return value.payloadHash.length === 43
    && value.taskAttempt === 1
    && value.leaseOwnerToken === null
    && value.leaseUntil === null
    && value.taskName === null
    && value.safeErrorCode === null
    && value.caseId === null
    && value.confirmationStatus === null
    && fileCount + objectCount >= 1
    && fileCount + objectCount === value.evidenceCount
    && !(fileCount > 0 && objectCount > 0)
}

function validObjectKeys(values: unknown, draftId: string, kind: 'PAYMENT' | 'CHAT'): values is string[] {
  const prefix = `drafts/${draftId}/${kind}/`
  return Array.isArray(values) && values.length <= 10 && values.every((value) => typeof value === 'string'
    && value.startsWith(prefix) && /^[a-f0-9]{64}\.(?:jpg|png)$/.test(value.slice(prefix.length)))
}

function validFileIds(values: unknown): values is string[] {
  return Array.isArray(values) && values.length <= 10
    && values.every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(value))
}

function isResult(value: unknown): value is MiniAppAsyncStateIngressResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return Object.keys(result).length === 8
    && typeof result.requestId === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(result.requestId)
    && typeof result.draftId === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(result.draftId)
    && typeof result.state === 'string' && /^(DRAFT|UPLOADING|READY_TO_CONFIRM|QUEUED|PROCESSING|RETRYING|CONFIRMING|CONFIRMED|CONFIRMED_WITH_RETRY|NEEDS_REVIEW|FAILED_RETRYABLE|CANCELLED|EXPIRED)$/.test(result.state)
    && Number.isSafeInteger(result.version) && Number(result.version) >= 1
    && Number.isSafeInteger(result.attemptCount) && Number(result.attemptCount) >= 0
    && (result.caseId === null || typeof result.caseId === 'string' && /^PMC-\d{6}-\d{4,}$/.test(result.caseId))
    && (result.confirmationStatus === null || result.confirmationStatus === 'CONFIRMED'
      || result.confirmationStatus === 'TENTATIVE' || result.confirmationStatus === 'AWAITING_ADMIN_SLOT')
    && (result.outcome === 'APPLIED' || result.outcome === 'IDEMPOTENT' || result.outcome === 'BUSY' || result.outcome === 'TERMINAL')
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}
