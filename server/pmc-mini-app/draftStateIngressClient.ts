import { createHmac, randomUUID } from 'node:crypto'
import {
  canonicalMiniAppDraftStateIngress,
  type MiniAppDraftEvidenceItem,
  type MiniAppDraftEvidenceManifestItem,
  type MiniAppDraftStateEnvelope,
  type MiniAppDraftStateMutation,
  type MiniAppDraftStateResult,
  type MiniAppNormalizedBookingInputV2,
  type UnsignedMiniAppDraftStateEnvelope,
} from '../../shared/pmcMiniAppDraftState.js'

interface IngressResponse { ok: boolean; status: number; json(): Promise<unknown> }
type IngressFetch = (
  url: string,
  init: { method: 'POST'; headers: { 'content-type': string }; body: string; signal: AbortSignal },
) => Promise<IngressResponse>

export interface DraftStateIngressPort {
  mutate(input: MiniAppDraftStateMutation): Promise<MiniAppDraftStateResult>
}

export interface DraftStateIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export class DraftStateIngressClientError extends Error {
  readonly code: 'DRAFT_STATE_INGRESS_TIMEOUT' | 'DRAFT_STATE_INGRESS_FAILED' | 'DRAFT_STATE_INGRESS_INVALID_RESPONSE'

  constructor(code: DraftStateIngressClientError['code']) {
    super(code)
    this.name = 'DraftStateIngressClientError'
    this.code = code
  }
}

export function buildMiniAppDraftStateIngress(
  input: MiniAppDraftStateMutation,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppDraftStateEnvelope; headers: { 'content-type': 'application/json' } } {
  if (!validMutation(input) || !Number.isSafeInteger(context.timestamp) || context.timestamp <= 0
    || !/^[A-Za-z0-9_-]{8,128}$/.test(context.nonce) || !secret) {
    throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_FAILED')
  }
  const unsigned: UnsignedMiniAppDraftStateEnvelope = {
    kind: 'MINI_APP_DRAFT_STATE', version: 1, timestamp: context.timestamp, nonce: context.nonce,
    payload: structuredClone(input),
  }
  const signature = createHmac('sha256', secret).update(canonicalMiniAppDraftStateIngress(unsigned), 'utf8').digest('hex')
  return { body: { ...unsigned, signature }, headers: { 'content-type': 'application/json' } }
}

export function createDraftStateIngressClient(options: DraftStateIngressClientOptions): DraftStateIngressPort {
  const url = safeHttpsUrl(options.url)
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (!url || !options.secret || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !request) {
    throw new Error('Invalid draft state ingress client configuration')
  }
  return {
    async mutate(input) {
      const built = buildMiniAppDraftStateIngress(input, { timestamp: now(), nonce: nonce() }, options.secret)
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const response = await request(url, {
          method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: controller.signal,
        })
        if (!response.ok) throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_FAILED')
        let body: unknown
        try { body = await response.json() } catch { throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_INVALID_RESPONSE') }
        if (!isResult(body)) throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_INVALID_RESPONSE')
        return body
      } catch (error) {
        if (timedOut) throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_TIMEOUT')
        if (error instanceof DraftStateIngressClientError) throw error
        throw new DraftStateIngressClientError('DRAFT_STATE_INGRESS_FAILED')
      } finally { clearTimeout(timeout) }
    },
  }
}

const CANCEL_KEYS = ['operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'nowIso'] as const
const PREPARE_KEYS = [
  'operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'baseVersion', 'nowIso',
  'prepareBindingHash', 'input', 'evidence',
] as const
const CONFIRM_CLAIM_KEYS = [
  'operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'nowIso', 'payloadHash',
] as const
const CONFIRM_COMPLETE_KEYS = [...CONFIRM_CLAIM_KEYS, 'caseId', 'confirmationStatus'] as const
const CONFIRM_FAIL_KEYS = [...CONFIRM_CLAIM_KEYS, 'safeErrorCode'] as const
const INPUT_KEYS = [
  'requestId', 'adminId', 'aeId', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId',
  'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
] as const
const EVIDENCE_KEYS = ['kind', 'ordinal', 'contentSha256', 'mimeType', 'storage', 'value'] as const
const MANIFEST_KEYS = ['kind', 'ordinal', 'contentSha256', 'mimeType', 'storage'] as const

function validMutation(value: MiniAppDraftStateMutation): boolean {
  if (!isRecord(value) || !safeId(value.requestId) || !safeId(value.draftId)
    || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1
    || !Number.isSafeInteger(value.expectedAttempt) || value.expectedAttempt < 0 || !validIso(value.nowIso)) return false
  if (value.operation === 'CANCEL') return hasExactKeys(value, CANCEL_KEYS)
  if (value.operation === 'CONFIRM_CLAIM') {
    return hasExactKeys(value, CONFIRM_CLAIM_KEYS) && validPayloadHash(value.payloadHash)
  }
  if (value.operation === 'CONFIRM_COMPLETE') {
    return hasExactKeys(value, CONFIRM_COMPLETE_KEYS) && validPayloadHash(value.payloadHash)
      && /^PMC-\d{6}-\d{4,}$/.test(value.caseId) && validConfirmationStatus(value.confirmationStatus)
  }
  if (value.operation === 'CONFIRM_FAIL') {
    return hasExactKeys(value, CONFIRM_FAIL_KEYS) && validPayloadHash(value.payloadHash)
      && /^BOOKING_INGRESS_[A-Z_]{1,60}$/.test(value.safeErrorCode)
  }
  return (value.operation === 'PREPARE_BEGIN' || value.operation === 'PREPARE_READY' || value.operation === 'PREPARE_PARTIAL')
    && hasExactKeys(value, PREPARE_KEYS)
    && Number.isSafeInteger(value.baseVersion) && value.baseVersion >= 1
    && /^[A-Za-z0-9_-]{43}$/.test(value.prepareBindingHash)
    && validNormalizedInput(value.input, value.requestId)
    && (value.operation === 'PREPARE_BEGIN'
      ? validEvidenceManifest(value.evidence)
      : validEvidence(value.evidence, value.draftId, value.operation))
}

function validEvidenceManifest(values: unknown): boolean {
  if (!Array.isArray(values) || values.length < 2 || values.length > 20) return false
  return validEvidenceShape(values, MANIFEST_KEYS)
}

function validNormalizedInput(value: MiniAppNormalizedBookingInputV2, requestId: string): boolean {
  if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS) || value.requestId !== requestId
    || !safeConfigId(value.adminId) || value.aeId !== null && !safeConfigId(value.aeId)
    || !normalizedText(value.customerName, 160) || !normalizedText(value.facebookName, 160)
    || !/^0\d{8,9}$/.test(value.phoneNormalized) || !safeConfigId(value.doctorId)
    || !safeConfigId(value.serviceId) || !safeConfigId(value.channelId)
    || !Number.isFinite(value.depositAmount) || value.depositAmount <= 0 || value.depositAmount > 10_000_000) return false
  if (value.queueType === 'AUTO') return value.appointmentDate === null && value.appointmentTime === null
  return value.queueType === 'NORMAL' && validDate(value.appointmentDate) && validTime(value.appointmentTime)
}

function validEvidence(
  values: MiniAppDraftEvidenceItem[],
  draftId: string,
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
): boolean {
  if (!Array.isArray(values) || values.length < 2 || values.length > 20) return false
  if (!validEvidenceShape(values, EVIDENCE_KEYS)) return false
  for (const item of values) if (item.value !== null && !validEvidenceValue(item, draftId)) return false
  const persisted = values.filter(({ value }) => value !== null).length
  return operation === 'PREPARE_READY' ? persisted === values.length : persisted > 0 && persisted < values.length
}

function validEvidenceShape(
  values: Array<MiniAppDraftEvidenceItem | MiniAppDraftEvidenceManifestItem>,
  keys: readonly string[],
): boolean {
  const storage = values[0]?.storage
  if (storage !== 'STAGED_OBJECT' && storage !== 'DRIVE_FILE') return false
  for (const kind of ['PAYMENT', 'CHAT'] as const) {
    const items = values.filter((item) => item.kind === kind).sort((left, right) => left.ordinal - right.ordinal)
    if (items.length < 1 || items.length > 10 || items.some((item, ordinal) => item.ordinal !== ordinal)) return false
  }
  const seen = new Set<string>()
  for (const item of values) {
    if (!isRecord(item) || !hasExactKeys(item as unknown as Record<string, unknown>, keys) || item.storage !== storage
      || !Number.isSafeInteger(item.ordinal) || item.ordinal < 0 || !/^[a-f0-9]{64}$/.test(item.contentSha256)
      || item.mimeType !== 'image/jpeg' && item.mimeType !== 'image/png') return false
    const identity = `${item.kind}:${item.ordinal}`
    if (seen.has(identity)) return false
    seen.add(identity)
  }
  return true
}

function validEvidenceValue(item: MiniAppDraftEvidenceItem, draftId: string): boolean {
  if (typeof item.value !== 'string') return false
  if (item.storage === 'DRIVE_FILE') return /^[A-Za-z0-9_-]{10,256}$/.test(item.value)
  const extension = item.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  return item.value === `drafts/${draftId}/${item.kind}/${item.contentSha256}.${extension}`
}

function isResult(value: unknown): value is MiniAppDraftStateResult {
  if (!isRecord(value) || !hasExactKeys(value, ['requestId', 'draftId', 'state', 'version', 'outcome', 'projectionDigest'])) return false
  return safeId(value.requestId) && safeId(value.draftId)
    && (value.state === 'DRAFT' || value.state === 'READY_TO_CONFIRM' || value.state === 'CONFIRMING'
      || value.state === 'FAILED_RETRYABLE' || value.state === 'CONFIRMED'
      || value.state === 'CANCELLED' || value.state === 'EXPIRED')
    && Number.isSafeInteger(value.version) && Number(value.version) >= 1
    && (value.outcome === 'APPLIED' || value.outcome === 'IDEMPOTENT' || value.outcome === 'TERMINAL')
    && typeof value.projectionDigest === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.projectionDigest)
}

function normalizedText(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.normalize('NFKC').replace(/\s+/g, ' ').trim() === value
}
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeConfigId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 124
    && value.trim() === value && hasNoControlCharacters(value)
}
function hasNoControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return false
  }
  return true
}
function validIso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function validPayloadHash(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) }
function validConfirmationStatus(value: unknown): boolean {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function validTime(value: unknown): value is string { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}
