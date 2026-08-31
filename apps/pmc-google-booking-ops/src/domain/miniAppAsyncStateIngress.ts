import {
  canonicalMiniAppAsyncIdentity,
  canonicalMiniAppAsyncStateIngress,
  canonicalMiniAppEvidenceProjection,
  type MiniAppAsyncStateIngressEnvelope,
  type MiniAppAsyncStateIngressResult,
  type MiniAppAsyncStateMutation,
  type UnsignedMiniAppAsyncStateIngressEnvelope,
} from '../../../../shared/pmcMiniAppAsyncState'
import { canonicalMiniAppP2BookingIdentity } from '../../../../shared/pmcMiniAppDraftState'
import type { BookingPorts, MiniAppRequestStateRecord } from '../ports'
import { transitionExistingDraftRetention } from '../workflows/draftRetention'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const
const PAYLOAD_KEYS = [
  'operation', 'requestId', 'draftId', 'payloadHash', 'expectedVersion', 'expectedAttempt', 'taskAttempt',
  'leaseOwnerToken', 'nowIso', 'leaseUntil', 'taskName', 'paymentEvidenceObjectKeys', 'chatEvidenceObjectKeys',
  'paymentEvidenceFileIds', 'chatEvidenceFileIds', 'evidenceCount', 'safeErrorCode', 'caseId', 'confirmationStatus',
] as const
const TERMINAL_STATES = new Set(['CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED'])
const MAX_LEASE_MS = 240_000
type AsyncEvidenceLayout = 'STAGED' | 'DRIVE_ONLY'

export function mutateMiniAppAsyncState(input: unknown, ports: BookingPorts): MiniAppAsyncStateIngressResult {
  const envelope = verifyEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) throw new Error('mini app async state replay detected')
    const current = ports.miniAppRequests.getByRequestId(envelope.payload.requestId)
    if (!current || current.draftId !== envelope.payload.draftId) throw new Error('mini app async request not found')
    validateImmutableBindings(current, envelope.payload, ports)
    const mutation = applyMutation(current, envelope.payload, ports)
    if (envelope.payload.operation === 'COMPLETE'
      && (mutation.next.state === 'CONFIRMED' || mutation.next.state === 'CONFIRMED_WITH_RETRY')) {
      transitionExistingDraftRetention(current.draftId, 'PROMOTED', 'ASYNC_CONFIRMED', ports)
    }
    const persisted = mutation.write
      ? ports.miniAppRequests.updateByRequestId(current.requestId, current.version, mutation.next)
      : current
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return result(persisted, mutation.outcome)
  })
}

function verifyEnvelope(input: unknown, ports: BookingPorts): MiniAppAsyncStateIngressEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ENVELOPE_KEYS)) throw new Error('invalid mini app async state envelope')
  if (input.kind !== 'MINI_APP_ASYNC_STATE' || input.version !== 1 || !Number.isSafeInteger(input.timestamp)) {
    throw new Error('invalid mini app async state envelope')
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)) throw new Error('invalid mini app async state nonce')
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) throw new Error('invalid mini app async state signature')
  if (!isRecord(input.payload) || !hasExactKeys(input.payload, PAYLOAD_KEYS)) throw new Error('invalid mini app async state payload')
  const payload = input.payload as unknown as MiniAppAsyncStateMutation
  validatePayloadShape(payload)
  const unsigned: UnsignedMiniAppAsyncStateIngressEnvelope = {
    kind: 'MINI_APP_ASYNC_STATE', version: 1, timestamp: input.timestamp as number, nonce: input.nonce, payload,
  }
  const expected = ports.crypto.hmacSha256Hex(
    canonicalMiniAppAsyncStateIngress(unsigned), ports.secrets.bookingIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app async state signature')
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app async state timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function validatePayloadShape(payload: MiniAppAsyncStateMutation): void {
  if (!/^(QUEUE|CLAIM|RENEW|PROJECT|RETRY|EXHAUST|COMPLETE)$/.test(payload.operation)
    || !safeId(payload.requestId) || !safeId(payload.draftId) || !/^[A-Za-z0-9_-]{4,128}$/.test(payload.payloadHash)
    || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1
    || !Number.isSafeInteger(payload.expectedAttempt) || payload.expectedAttempt < 0
    || !Number.isSafeInteger(payload.taskAttempt) || payload.taskAttempt < 1 || payload.taskAttempt > 8
    || !validIso(payload.nowIso) || payload.leaseUntil !== null && !validIso(payload.leaseUntil)
    || payload.leaseOwnerToken !== null && !safeOwner(payload.leaseOwnerToken)
    || payload.taskName !== null && !/^[A-Za-z0-9._:/-]{1,512}$/.test(payload.taskName)
    || !validBoundObjectKeys(payload.paymentEvidenceObjectKeys)
    || !validBoundObjectKeys(payload.chatEvidenceObjectKeys)
    || !validFileIds(payload.paymentEvidenceFileIds) || !validFileIds(payload.chatEvidenceFileIds)
    || !Number.isSafeInteger(payload.evidenceCount) || payload.evidenceCount < 0 || payload.evidenceCount > 20
    || payload.safeErrorCode !== null && !/^[A-Z0-9_]{1,80}$/.test(payload.safeErrorCode)
    || payload.caseId !== null && !/^PMC-\d{6}-\d{4,}$/.test(payload.caseId)
    || payload.confirmationStatus !== null && !['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(payload.confirmationStatus)) {
    throw new Error('invalid mini app async state payload')
  }
}

function validateImmutableBindings(
  current: MiniAppRequestStateRecord,
  payload: MiniAppAsyncStateMutation,
  ports: BookingPorts,
): void {
  const canonicalHash = ports.crypto.sha256Base64Url(canonicalRequestIdentity(current))
  const persistedHash = current.payloadHash ?? canonicalHash
  const layout = evidenceLayout(current)
  if (persistedHash !== payload.payloadHash
    || !sameStrings(current.paymentEvidenceObjectKeys, payload.paymentEvidenceObjectKeys)
    || !sameStrings(current.chatEvidenceObjectKeys, payload.chatEvidenceObjectKeys)) {
    throw new Error('mini app async payload conflict')
  }
  if (payload.operation !== 'EXHAUST' && layout === null) throw new Error('mini app async evidence layout rejected')
  if (layout === 'DRIVE_ONLY'
    && (canonicalHash !== payload.payloadHash
      || !sameStrings(current.paymentEvidenceFileIds, payload.paymentEvidenceFileIds)
      || !sameStrings(current.chatEvidenceFileIds, payload.chatEvidenceFileIds)
      || current.evidenceCount !== payload.evidenceCount)) {
    throw new Error('mini app async Drive evidence binding conflict')
  }
}

function applyMutation(
  current: MiniAppRequestStateRecord,
  payload: MiniAppAsyncStateMutation,
  ports: BookingPorts,
): { write: boolean; next: MiniAppRequestStateRecord; outcome: MiniAppAsyncStateIngressResult['outcome'] } {
  if (payload.operation === 'EXHAUST') return applyExhaust(current, payload, ports)
  if (TERMINAL_STATES.has(current.state)) return { write: false, next: current, outcome: 'TERMINAL' }
  if (payload.operation === 'QUEUE') return applyQueue(current, payload)
  if (payload.operation === 'CLAIM') return applyClaim(current, payload)
  if (payload.operation === 'RENEW') return applyRenew(current, payload)
  if (payload.operation === 'PROJECT') return applyProject(current, payload, ports)
  if (payload.operation === 'RETRY') return applyRetry(current, payload)
  return applyComplete(current, payload, ports)
}

function applyQueue(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation) {
  if (current.state === 'QUEUED' && current.version === payload.expectedVersion + 1
    && current.taskName === payload.taskName && current.payloadHash === payload.payloadHash) return unchanged(current)
  if ((current.state === 'PROCESSING' || current.state === 'RETRYING') && current.payloadHash === payload.payloadHash) {
    return unchanged(current)
  }
  requireExpected(current, payload)
  if (current.state !== 'READY_TO_CONFIRM' || !payload.taskName) throw new Error('mini app async state transition rejected')
  return changed(current, {
    state: 'QUEUED', payloadHash: payload.payloadHash, taskName: payload.taskName, queuedAt: payload.nowIso,
    safeErrorCode: null, updatedAt: payload.nowIso,
  })
}

function applyClaim(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation) {
  requireLeaseFields(payload)
  if (current.state === 'PROCESSING') {
    if (current.processingOwnerToken === payload.leaseOwnerToken
      && current.version === payload.expectedVersion + 1 && current.attemptCount === payload.expectedAttempt + 1) {
      return unchanged(current)
    }
    if (current.processingLeaseUntil && Date.parse(current.processingLeaseUntil) > Date.parse(payload.nowIso)) {
      return { write: false as const, next: current, outcome: 'BUSY' as const }
    }
  }
  requireExpected(current, payload)
  if (!['READY_TO_CONFIRM', 'QUEUED', 'RETRYING', 'PROCESSING'].includes(current.state)) {
    throw new Error('mini app async state transition rejected')
  }
  return changed(current, {
    state: 'PROCESSING', payloadHash: payload.payloadHash,
    processingStartedAt: current.processingStartedAt ?? payload.nowIso,
    processingLeaseUntil: payload.leaseUntil, processingOwnerToken: payload.leaseOwnerToken,
    lastProgressAt: payload.nowIso, attemptCount: current.attemptCount + 1,
    safeErrorCode: null, updatedAt: payload.nowIso,
  })
}

function applyRenew(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation) {
  requireLeaseFields(payload)
  if (current.state === 'PROCESSING' && current.processingOwnerToken === payload.leaseOwnerToken
    && current.version === payload.expectedVersion + 1 && current.attemptCount === payload.expectedAttempt
    && current.processingLeaseUntil === payload.leaseUntil) return unchanged(current)
  requireOwnedProcessing(current, payload)
  return changed(current, {
    processingLeaseUntil: payload.leaseUntil, lastProgressAt: payload.nowIso, updatedAt: payload.nowIso,
  })
}

function applyProject(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation, ports: BookingPorts) {
  if (!projectableEvidenceBinding(current, payload)) throw new Error('mini app async evidence projection rejected')
  const projectionHash = ports.crypto.sha256Base64Url(canonicalMiniAppEvidenceProjection(projectionBinding(current, payload)))
  if (current.state === 'PROCESSING' && current.processingOwnerToken === payload.leaseOwnerToken
    && current.version === payload.expectedVersion + 1 && current.attemptCount === payload.expectedAttempt
    && sameStrings(current.paymentEvidenceFileIds, payload.paymentEvidenceFileIds)
    && sameStrings(current.chatEvidenceFileIds, payload.chatEvidenceFileIds)
    && current.evidenceProjectionHash === projectionHash) return unchanged(current)
  requireOwnedProcessing(current, payload)
  return changed(current, {
    paymentEvidenceFileIds: [...payload.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...payload.chatEvidenceFileIds], evidenceCount: payload.evidenceCount,
    evidenceProjectionHash: projectionHash,
    lastProgressAt: payload.nowIso, updatedAt: payload.nowIso,
  })
}

function applyRetry(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation) {
  if (!payload.safeErrorCode) throw new Error('mini app async retry rejected')
  const target = payload.taskAttempt === 8 || payload.safeErrorCode === 'RETRY_EXHAUSTED' ? 'NEEDS_REVIEW' : 'RETRYING'
  if (current.state === target && current.version === payload.expectedVersion + 1
    && current.attemptCount === payload.expectedAttempt && current.safeErrorCode === payload.safeErrorCode) return unchanged(current)
  requireOwnedProcessing(current, payload)
  return changed(current, {
    state: target, safeErrorCode: target === 'NEEDS_REVIEW' ? 'RETRY_EXHAUSTED' : payload.safeErrorCode,
    processingLeaseUntil: null, processingOwnerToken: null, lastProgressAt: payload.nowIso, updatedAt: payload.nowIso,
  })
}

function applyComplete(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation, ports: BookingPorts) {
  if (!payload.caseId || !payload.confirmationStatus) throw new Error('mini app async completion rejected')
  if (payload.safeErrorCode !== null && payload.safeErrorCode !== 'DOWNSTREAM_RETRY') {
    throw new Error('mini app async completion rejected')
  }
  const state = payload.safeErrorCode === 'DOWNSTREAM_RETRY' ? 'CONFIRMED_WITH_RETRY' : 'CONFIRMED'
  if (current.state === state && current.version === payload.expectedVersion + 1
    && current.caseId === payload.caseId && current.confirmationStatus === payload.confirmationStatus) return unchanged(current)
  requireOwnedProcessing(current, payload)
  if (!completeEvidenceBinding(current, payload)) {
    throw new Error('mini app async completion evidence rejected')
  }
  if (current.evidenceProjectionHash !== projectionHash(current, ports)) {
    throw new Error('mini app async completion projection hash rejected')
  }
  return changed(current, {
    state, caseId: payload.caseId, confirmationStatus: payload.confirmationStatus,
    confirmedAt: payload.nowIso, processingLeaseUntil: null, processingOwnerToken: null,
    lastProgressAt: payload.nowIso, safeErrorCode: payload.safeErrorCode, updatedAt: payload.nowIso,
  })
}

function applyExhaust(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation, ports: BookingPorts) {
  if (payload.taskAttempt !== 8 || payload.safeErrorCode !== 'RETRY_EXHAUSTED') {
    throw new Error('mini app async exhaustion rejected')
  }
  if ((current.state === 'CONFIRMED' || current.state === 'CONFIRMED_WITH_RETRY')
    && current.caseId && /^PMC-\d{6}-\d{4,}$/.test(current.caseId)
    && current.confirmationStatus && ['CONFIRMED', 'TENTATIVE', 'AWAITING_ADMIN_SLOT'].includes(current.confirmationStatus)
    && current.processingOwnerToken === null && current.processingLeaseUntil === null
    && completeEvidenceBinding(current, payload)
    && current.evidenceProjectionHash === projectionHash(current, ports)) {
    return { write: false as const, next: current, outcome: 'TERMINAL' as const }
  }
  if (!['READY_TO_CONFIRM', 'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY'].includes(current.state)) {
    throw new Error('mini app async exhaustion rejected')
  }
  return changed(current, {
    state: 'NEEDS_REVIEW', safeErrorCode: 'RETRY_EXHAUSTED', processingLeaseUntil: null,
    processingOwnerToken: null, lastProgressAt: payload.nowIso, updatedAt: payload.nowIso,
  })
}

function evidenceLayout(current: MiniAppRequestStateRecord): AsyncEvidenceLayout | null {
  const staged = current.paymentEvidenceObjectKeys.length >= 1 && current.chatEvidenceObjectKeys.length >= 1
    && current.paymentEvidenceFileIds.length <= current.paymentEvidenceObjectKeys.length
    && current.chatEvidenceFileIds.length <= current.chatEvidenceObjectKeys.length
    && current.evidenceCount === current.paymentEvidenceObjectKeys.length + current.chatEvidenceObjectKeys.length
  if (staged) return 'STAGED'
  const driveOnly = 'protocolVersion' in current && current.protocolVersion === 2
    && current.paymentEvidenceObjectKeys.length === 0 && current.chatEvidenceObjectKeys.length === 0
    && current.paymentEvidenceFileIds.length >= 1 && current.chatEvidenceFileIds.length >= 1
    && current.evidenceCount === current.paymentEvidenceFileIds.length + current.chatEvidenceFileIds.length
  return driveOnly ? 'DRIVE_ONLY' : null
}

function completeEvidenceBinding(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation): boolean {
  const layout = evidenceLayout(current)
  if (!layout || current.evidenceCount !== payload.evidenceCount
    || !sameStrings(current.paymentEvidenceObjectKeys, payload.paymentEvidenceObjectKeys)
    || !sameStrings(current.chatEvidenceObjectKeys, payload.chatEvidenceObjectKeys)
    || !sameStrings(current.paymentEvidenceFileIds, payload.paymentEvidenceFileIds)
    || !sameStrings(current.chatEvidenceFileIds, payload.chatEvidenceFileIds)) return false
  if (layout === 'DRIVE_ONLY') return true
  return current.paymentEvidenceFileIds.length === current.paymentEvidenceObjectKeys.length
    && current.chatEvidenceFileIds.length === current.chatEvidenceObjectKeys.length
    && current.evidenceCount === current.paymentEvidenceFileIds.length + current.chatEvidenceFileIds.length
}

function projectableEvidenceBinding(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation): boolean {
  const layout = evidenceLayout(current)
  if (!layout || current.evidenceCount !== payload.evidenceCount
    || !sameStrings(current.paymentEvidenceObjectKeys, payload.paymentEvidenceObjectKeys)
    || !sameStrings(current.chatEvidenceObjectKeys, payload.chatEvidenceObjectKeys)) return false
  if (layout === 'DRIVE_ONLY') {
    return sameStrings(current.paymentEvidenceFileIds, payload.paymentEvidenceFileIds)
      && sameStrings(current.chatEvidenceFileIds, payload.chatEvidenceFileIds)
  }
  return payload.paymentEvidenceFileIds.length === current.paymentEvidenceObjectKeys.length
    && payload.chatEvidenceFileIds.length === current.chatEvidenceObjectKeys.length
    && payload.evidenceCount === payload.paymentEvidenceFileIds.length + payload.chatEvidenceFileIds.length
    && isPrefix(current.paymentEvidenceFileIds, payload.paymentEvidenceFileIds)
    && isPrefix(current.chatEvidenceFileIds, payload.chatEvidenceFileIds)
}

function isPrefix(prefix: readonly string[], values: readonly string[]): boolean {
  return prefix.length <= values.length && prefix.every((value, index) => values[index] === value)
}

function projectionHash(current: MiniAppRequestStateRecord, ports: BookingPorts): string | null {
  if (!current.payloadHash) return null
  return ports.crypto.sha256Base64Url(canonicalMiniAppEvidenceProjection({
    requestId: current.requestId,
    draftId: current.draftId,
    payloadHash: current.payloadHash,
    paymentEvidenceObjectKeys: [...current.paymentEvidenceObjectKeys],
    chatEvidenceObjectKeys: [...current.chatEvidenceObjectKeys],
    paymentEvidenceFileIds: [...current.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...current.chatEvidenceFileIds],
    evidenceCount: current.evidenceCount,
  }))
}

function projectionBinding(
  current: MiniAppRequestStateRecord,
  payload: MiniAppAsyncStateMutation,
) {
  return {
    requestId: current.requestId,
    draftId: current.draftId,
    payloadHash: payload.payloadHash,
    paymentEvidenceObjectKeys: [...current.paymentEvidenceObjectKeys],
    chatEvidenceObjectKeys: [...current.chatEvidenceObjectKeys],
    paymentEvidenceFileIds: [...payload.paymentEvidenceFileIds],
    chatEvidenceFileIds: [...payload.chatEvidenceFileIds],
    evidenceCount: payload.evidenceCount,
  }
}

function requireExpected(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation): void {
  if (current.version !== payload.expectedVersion || current.attemptCount !== payload.expectedAttempt) {
    throw new Error('stale mini app async state')
  }
}

function requireLeaseFields(payload: MiniAppAsyncStateMutation): void {
  const now = Date.parse(payload.nowIso)
  const until = payload.leaseUntil ? Date.parse(payload.leaseUntil) : 0
  if (!payload.leaseOwnerToken || !safeOwner(payload.leaseOwnerToken)
    || !payload.leaseUntil || until <= now || until - now > MAX_LEASE_MS) throw new Error('invalid mini app async lease')
}

function requireOwnedProcessing(current: MiniAppRequestStateRecord, payload: MiniAppAsyncStateMutation): void {
  requireExpected(current, payload)
  if (current.state !== 'PROCESSING' || !payload.leaseOwnerToken
    || current.processingOwnerToken !== payload.leaseOwnerToken
    || !current.processingLeaseUntil || Date.parse(current.processingLeaseUntil) <= Date.parse(payload.nowIso)) {
    throw new Error('stale mini app async owner or lease')
  }
}

function changed(current: MiniAppRequestStateRecord, patch: Partial<MiniAppRequestStateRecord>) {
  return { write: true as const, next: { ...current, ...patch, version: current.version + 1 }, outcome: 'APPLIED' as const }
}
function unchanged(current: MiniAppRequestStateRecord) {
  return { write: false as const, next: current, outcome: 'IDEMPOTENT' as const }
}
function result(record: MiniAppRequestStateRecord, outcome: MiniAppAsyncStateIngressResult['outcome']): MiniAppAsyncStateIngressResult {
  return {
    requestId: record.requestId, draftId: record.draftId, state: record.state, version: record.version,
    attemptCount: record.attemptCount, caseId: record.caseId, confirmationStatus: record.confirmationStatus, outcome,
  }
}

function canonicalRequestIdentity(record: MiniAppRequestStateRecord): string {
  return 'protocolVersion' in record && record.protocolVersion === 2
    ? canonicalMiniAppP2BookingIdentity({ ...record, protocolVersion: 2 })
    : canonicalMiniAppAsyncIdentity(record)
}
function validBoundObjectKeys(values: unknown): values is string[] {
  // Prepare owns the exact legacy/v2 key format. Async mutations are authorized only when these
  // bounded keys exactly match the persisted row in validateImmutableBindings().
  return Array.isArray(values) && values.length <= 10 && values.every((value) => {
    if (typeof value !== 'string' || value.length < 8 || value.length > 1_024
      || !value.startsWith('drafts/') || !/^drafts\/[A-Za-z0-9._:/-]+$/.test(value)) return false
    return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  })
}
function validFileIds(values: unknown): values is string[] {
  return Array.isArray(values) && values.length <= 10
    && values.every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(value))
}
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeOwner(value: string): boolean { return /^[A-Za-z0-9_-]{16,128}$/.test(value) }
function validIso(value: string): boolean { return Number.isFinite(Date.parse(value)) }
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}
