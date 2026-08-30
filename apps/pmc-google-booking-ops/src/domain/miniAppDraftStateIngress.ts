import {
  canonicalMiniAppDraftProjection,
  canonicalMiniAppDraftStateIngress,
  canonicalMiniAppP2BookingIdentity,
  canonicalMiniAppPrepareBinding,
  type MiniAppDraftEvidenceItem,
  type MiniAppDraftPrepareBeginMutation,
  type MiniAppDraftPrepareMutation,
  type MiniAppDraftProjection,
  type MiniAppDraftStateEnvelope,
  type MiniAppDraftStateMutation,
  type MiniAppDraftStateResult,
  type MiniAppNormalizedBookingInputV2,
  type UnsignedMiniAppDraftStateEnvelope,
} from '../../../../shared/pmcMiniAppDraftState'
import type { PmcMiniAppTargetRequestRecord } from '../../../../shared/pmcBookingRowContracts'
import type { BookingPorts, MiniAppRequestStateRecord, StaffConfig } from '../ports'

type P2Record = PmcMiniAppTargetRequestRecord & { protocolVersion: 2 }

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const
const CANCEL_KEYS = ['operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'nowIso'] as const
const PREPARE_KEYS = [
  'operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'baseVersion', 'nowIso',
  'prepareBindingHash', 'input', 'evidence',
] as const
const CONFIRM_CLAIM_KEYS = [
  'operation', 'requestId', 'draftId', 'expectedVersion', 'expectedAttempt', 'nowIso', 'payloadHash',
] as const
const CONFIRM_COMPLETE_KEYS = [
  ...CONFIRM_CLAIM_KEYS, 'caseId', 'confirmationStatus',
] as const
const CONFIRM_FAIL_KEYS = [
  ...CONFIRM_CLAIM_KEYS, 'safeErrorCode',
] as const
const INPUT_KEYS = [
  'requestId', 'adminId', 'aeId', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId',
  'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
] as const
const EVIDENCE_KEYS = ['kind', 'ordinal', 'contentSha256', 'mimeType', 'storage', 'value'] as const

export function mutateMiniAppDraftState(input: unknown, ports: BookingPorts): MiniAppDraftStateResult {
  const envelope = verifyEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) throw new Error('mini app draft state replay detected')
    const current = asP2Record(ports.miniAppRequests.getByRequestId(envelope.payload.requestId))
    if (!current || current.draftId !== envelope.payload.draftId) throw new Error('mini app draft state request not found')
    const mutation = applyOwnerMutation(current, envelope.payload, ports)
    const persisted = mutation.write
      ? asP2Record(ports.miniAppRequests.updateByRequestId(current.requestId, current.version, mutation.next))!
      : current
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return safeResult(persisted, mutation.outcome, ports)
  })
}

function applyOwnerMutation(current: P2Record, payload: MiniAppDraftStateMutation, ports: BookingPorts) {
  if (payload.operation === 'CANCEL') return applyCancel(current, payload)
  if (payload.operation === 'PREPARE_BEGIN') return applyPrepareBegin(current, payload, ports)
  if (payload.operation === 'PREPARE_READY' || payload.operation === 'PREPARE_PARTIAL') {
    return applyPrepare(current, payload, ports)
  }
  if (payload.operation === 'CONFIRM_CLAIM') return applyConfirmClaim(current, payload, ports)
  if (payload.operation === 'CONFIRM_COMPLETE') return applyConfirmComplete(current, payload, ports)
  if (payload.operation === 'CONFIRM_FAIL') return applyConfirmFail(current, payload, ports)
  throw new Error('unsupported mini app draft state operation')
}

function verifyEnvelope(input: unknown, ports: BookingPorts): MiniAppDraftStateEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ENVELOPE_KEYS)
    || input.kind !== 'MINI_APP_DRAFT_STATE' || input.version !== 1 || !Number.isSafeInteger(input.timestamp)
    || typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)
    || typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)
    || !isRecord(input.payload)) throw new Error('invalid mini app draft state envelope')
  const payload = input.payload as unknown as MiniAppDraftStateMutation
  validatePayload(payload)
  const unsigned: UnsignedMiniAppDraftStateEnvelope = {
    kind: 'MINI_APP_DRAFT_STATE', version: 1, timestamp: input.timestamp as number, nonce: input.nonce, payload,
  }
  const expected = ports.crypto.hmacSha256Hex(canonicalMiniAppDraftStateIngress(unsigned), ports.secrets.bookingIngressSecret())
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app draft state signature')
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app draft state timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function validatePayload(payload: MiniAppDraftStateMutation): void {
  if (!isRecord(payload) || !safeId(payload.requestId) || !safeId(payload.draftId)
    || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 1
    || !Number.isSafeInteger(payload.expectedAttempt) || payload.expectedAttempt < 0 || !validIso(payload.nowIso)) {
    throw new Error('invalid mini app draft state payload')
  }
  if (payload.operation === 'CANCEL') {
    if (!hasExactKeys(payload, CANCEL_KEYS)) throw new Error('invalid mini app draft cancel payload')
    return
  }
  if (payload.operation === 'CONFIRM_CLAIM') {
    if (!hasExactKeys(payload, CONFIRM_CLAIM_KEYS) || !validPayloadHash(payload.payloadHash)) {
      throw new Error('invalid mini app draft confirm claim payload')
    }
    return
  }
  if (payload.operation === 'CONFIRM_COMPLETE') {
    if (!hasExactKeys(payload, CONFIRM_COMPLETE_KEYS) || !validPayloadHash(payload.payloadHash)
      || !/^PMC-\d{6}-\d{4,}$/.test(payload.caseId)
      || !validConfirmationStatus(payload.confirmationStatus)) {
      throw new Error('invalid mini app draft confirm complete payload')
    }
    return
  }
  if (payload.operation === 'CONFIRM_FAIL') {
    if (!hasExactKeys(payload, CONFIRM_FAIL_KEYS) || !validPayloadHash(payload.payloadHash)
      || !/^BOOKING_INGRESS_[A-Z_]{1,60}$/.test(payload.safeErrorCode)) {
      throw new Error('invalid mini app draft confirm fail payload')
    }
    return
  }
  if ((payload.operation !== 'PREPARE_BEGIN' && payload.operation !== 'PREPARE_READY' && payload.operation !== 'PREPARE_PARTIAL')
    || !hasExactKeys(payload, PREPARE_KEYS) || !Number.isSafeInteger(payload.baseVersion) || payload.baseVersion < 1
    || !/^[A-Za-z0-9_-]{43}$/.test(payload.prepareBindingHash)
    || !validNormalizedInput(payload.input, payload.requestId)) throw new Error('invalid mini app draft prepare payload')
  if (payload.operation === 'PREPARE_BEGIN') validateEvidenceManifest(payload.evidence)
  else validateEvidence(payload)
}

function validateEvidenceManifest(values: MiniAppDraftPrepareBeginMutation['evidence']): void {
  if (!Array.isArray(values) || values.length < 2 || values.length > 20) throw new Error('invalid mini app draft evidence')
  validateEvidenceShape(values, ['kind', 'ordinal', 'contentSha256', 'mimeType', 'storage'])
}

function validateEvidence(payload: MiniAppDraftPrepareMutation): void {
  if (!Array.isArray(payload.evidence) || payload.evidence.length < 2 || payload.evidence.length > 20) {
    throw new Error('invalid mini app draft evidence')
  }
  validateEvidenceShape(payload.evidence, EVIDENCE_KEYS)
  for (const item of payload.evidence) {
    if (item.value !== null && !validEvidenceValue(item, payload.draftId)) throw new Error('invalid mini app draft evidence reference')
  }
  const persisted = payload.evidence.filter(({ value }) => value !== null).length
  if (payload.operation === 'PREPARE_READY' ? persisted !== payload.evidence.length : persisted < 1 || persisted >= payload.evidence.length) {
    throw new Error('invalid mini app draft evidence completeness')
  }
}

function validateEvidenceShape(
  values: Array<{ kind: 'PAYMENT' | 'CHAT'; ordinal: number; contentSha256: string; mimeType: string; storage: string }>,
  keys: readonly string[],
): void {
  const storage = values[0]?.storage
  if (storage !== 'STAGED_OBJECT' && storage !== 'DRIVE_FILE') throw new Error('invalid mini app draft evidence storage')
  for (const kind of ['PAYMENT', 'CHAT'] as const) {
    const items = values.filter((item) => item.kind === kind).sort((left, right) => left.ordinal - right.ordinal)
    if (items.length < 1 || items.length > 10 || items.some((item, index) => item.ordinal !== index)) {
      throw new Error('invalid mini app draft evidence ordinal')
    }
  }
  const identities = new Set<string>()
  for (const item of values) {
    if (!isRecord(item) || !hasExactKeys(item, keys) || item.storage !== storage
      || !Number.isSafeInteger(item.ordinal) || item.ordinal < 0 || !/^[a-f0-9]{64}$/.test(item.contentSha256)
      || item.mimeType !== 'image/jpeg' && item.mimeType !== 'image/png') throw new Error('invalid mini app draft evidence')
    const identity = `${item.kind}:${item.ordinal}`
    if (identities.has(identity)) throw new Error('duplicate mini app draft evidence ordinal')
    identities.add(identity)
  }
}

function applyPrepareBegin(current: P2Record, payload: MiniAppDraftPrepareBeginMutation, ports: BookingPorts) {
  if (current.attemptCount !== payload.expectedAttempt) throw new Error('stale mini app draft prepare attempt')
  if (current.evidenceProjectionHash === null) {
    const { snapshots, bindingHash } = resolveInitialPrepare(current, payload, ports)
    if (current.state === 'CANCELLED' || current.state === 'EXPIRED') throw new Error('terminal mini app draft begin rejected')
    if (current.state !== 'DRAFT' || current.version !== payload.expectedVersion || referenceCount(current) !== 0) {
      throw new Error('stale mini app draft begin version')
    }
    return changed(current, {
      recorderName: snapshots.recorder.name,
      adminId: snapshots.admin.id,
      adminName: snapshots.admin.name,
      aeId: snapshots.ae?.id ?? null,
      aeName: snapshots.ae?.name ?? 'ไม่ระบุ',
      evidenceProjectionHash: bindingHash,
      updatedAt: payload.nowIso,
    })
  }
  const { bindingHash } = resolveReservedPrepare(current, payload, ports)
  if (current.evidenceProjectionHash !== bindingHash) throw new Error('mini app draft prepare binding conflict')
  if (current.state === 'CANCELLED' || current.state === 'EXPIRED') return unchanged(current, 'TERMINAL')
  if (current.state !== 'DRAFT' && current.state !== 'READY_TO_CONFIRM') throw new Error('mini app draft begin state conflict')
  return unchanged(current)
}

function applyPrepare(current: P2Record, payload: MiniAppDraftPrepareMutation, ports: BookingPorts) {
  if (current.attemptCount !== payload.expectedAttempt) throw new Error('stale mini app draft prepare attempt')
  const { snapshots, bindingHash } = resolveReservedPrepare(current, payload, ports)
  if (current.evidenceProjectionHash === null) {
    throw new Error('mini app draft prepare reservation required')
  }
  if (current.evidenceProjectionHash !== bindingHash) {
    throw new Error('mini app draft prepare binding conflict')
  }
  const evidence = mergeEvidence(current, payload)
  if (current.state === 'CANCELLED' || current.state === 'EXPIRED') {
    return applyTerminalEvidence(current, evidence, bindingHash, payload.nowIso)
  }
  if (current.state === 'READY_TO_CONFIRM') {
    if (payload.operation !== 'PREPARE_READY' || !sameReadyProjection(current, payload, snapshots, evidence)) {
      throw new Error('mini app draft ready conflict')
    }
    return unchanged(current)
  }
  if (current.state !== 'DRAFT') throw new Error('mini app draft prepare state conflict')
  if (payload.operation === 'PREPARE_PARTIAL') {
    if (sameEvidence(current, evidence) && current.evidenceProjectionHash === bindingHash
      && current.retentionState === 'PENDING_APPROVAL') return unchanged(current)
    return changed(current, {
      retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: bindingHash, ...evidence, updatedAt: payload.nowIso,
    })
  }
  return changed(current, {
    state: 'READY_TO_CONFIRM', retentionState: '', evidenceProjectionHash: bindingHash,
    adminId: snapshots.admin.id, adminName: snapshots.admin.name, aeId: snapshots.ae?.id ?? null,
    aeName: snapshots.ae?.name ?? 'ไม่ระบุ', customerName: payload.input.customerName,
    facebookName: payload.input.facebookName, phoneNormalized: payload.input.phoneNormalized,
    doctorId: payload.input.doctorId, serviceId: payload.input.serviceId, queueType: payload.input.queueType,
    appointmentDate: payload.input.appointmentDate, appointmentTime: payload.input.appointmentTime,
    depositAmount: payload.input.depositAmount, channelId: payload.input.channelId, ...evidence,
    safeErrorCode: null, updatedAt: payload.nowIso,
  })
}

interface PrepareSnapshots {
  recorder: { id: string; name: string }
  admin: { id: string; name: string }
  ae: { id: string; name: string } | null
}

function resolveInitialPrepare(
  current: P2Record,
  payload: MiniAppDraftPrepareBeginMutation | MiniAppDraftPrepareMutation,
  ports: BookingPorts,
) {
  const snapshots = resolveSnapshots(current, payload.input, ports)
  return bindingFor(current, payload, snapshots, ports)
}

function resolveReservedPrepare(
  current: P2Record,
  payload: MiniAppDraftPrepareBeginMutation | MiniAppDraftPrepareMutation,
  ports: BookingPorts,
) {
  if (current.protocolVersion !== 2 || !current.recorderName || !current.adminId || !current.adminName
    || current.adminId !== payload.input.adminId || current.aeId !== payload.input.aeId
    || current.aeId === null && current.aeName !== 'ไม่ระบุ'
    || current.aeId !== null && !current.aeName) throw new Error('mini app draft reserved attribution conflict')
  const snapshots: PrepareSnapshots = {
    recorder: { id: current.staffId, name: current.recorderName },
    admin: { id: current.adminId, name: current.adminName },
    ae: current.aeId === null ? null : { id: current.aeId, name: current.aeName },
  }
  return bindingFor(current, payload, snapshots, ports)
}

function bindingFor(
  current: P2Record,
  payload: MiniAppDraftPrepareBeginMutation | MiniAppDraftPrepareMutation,
  snapshots: PrepareSnapshots,
  ports: BookingPorts,
) {
  const bindingProjection = {
    requestId: payload.requestId, draftId: payload.draftId, baseVersion: payload.baseVersion,
    staffId: current.staffId, recorderName: snapshots.recorder.name,
    adminId: snapshots.admin.id, adminName: snapshots.admin.name,
    aeId: snapshots.ae?.id ?? null, aeName: snapshots.ae?.name ?? 'ไม่ระบุ', input: payload.input,
    evidence: payload.evidence.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.contentSha256,
      mimeType: item.mimeType, storage: item.storage,
    })),
  }
  const bindingHash = ports.crypto.sha256Base64Url(canonicalMiniAppPrepareBinding(bindingProjection))
  if (bindingHash !== payload.prepareBindingHash) throw new Error('mini app draft prepare binding conflict')
  return { snapshots, bindingHash }
}

function applyCancel(current: P2Record, payload: Extract<MiniAppDraftStateMutation, { operation: 'CANCEL' }>) {
  if (current.attemptCount !== payload.expectedAttempt) throw new Error('stale mini app draft cancel attempt')
  if (current.state === 'CANCELLED' || current.state === 'EXPIRED') return unchanged(current)
  if (current.version !== payload.expectedVersion
    || !['DRAFT', 'UPLOADING', 'READY_TO_CONFIRM', 'FAILED_RETRYABLE'].includes(current.state)) {
    throw new Error('stale mini app draft cancel conflict')
  }
  return changed(current, { state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: payload.nowIso })
}

function applyConfirmClaim(
  current: P2Record,
  payload: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_CLAIM' }>,
  ports: BookingPorts,
) {
  const canonicalHash = confirmPayloadHash(current, ports)
  if (payload.payloadHash !== canonicalHash) throw new Error('mini app draft confirm payload hash conflict')
  if (current.state === 'CANCELLED' || current.state === 'EXPIRED') return unchanged(current, 'TERMINAL')
  if (current.state === 'CONFIRMED') {
    if (current.payloadHash !== payload.payloadHash || !current.caseId || !current.confirmationStatus) {
      throw new Error('mini app draft confirmed binding conflict')
    }
    return unchanged(current, 'TERMINAL')
  }
  if (current.state === 'CONFIRMING') {
    if (current.payloadHash === payload.payloadHash && current.version === payload.expectedVersion + 1
      && current.attemptCount === payload.expectedAttempt) return unchanged(current)
    throw new Error('mini app draft confirm claim conflict')
  }
  if (current.version !== payload.expectedVersion || current.attemptCount !== payload.expectedAttempt
    || !['READY_TO_CONFIRM', 'FAILED_RETRYABLE'].includes(current.state)) {
    throw new Error('stale mini app draft confirm claim')
  }
  if (current.payloadHash !== null && current.payloadHash !== payload.payloadHash) {
    throw new Error('mini app draft confirm payload hash conflict')
  }
  return changed(current, {
    state: 'CONFIRMING', payloadHash: payload.payloadHash, safeErrorCode: null, updatedAt: payload.nowIso,
  })
}

function applyConfirmComplete(
  current: P2Record,
  payload: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_COMPLETE' }>,
  ports: BookingPorts,
) {
  requireConfirmBinding(current, payload.payloadHash, ports)
  if (current.state === 'CONFIRMED') {
    if (current.version === payload.expectedVersion + 1 && current.caseId === payload.caseId
      && current.confirmationStatus === payload.confirmationStatus) return unchanged(current)
    throw new Error('mini app draft confirm completion conflict')
  }
  if (current.state === 'CANCELLED' || current.state === 'EXPIRED') return unchanged(current, 'TERMINAL')
  if (current.state !== 'CONFIRMING' || current.version !== payload.expectedVersion
    || current.attemptCount !== payload.expectedAttempt) throw new Error('stale mini app draft confirm completion')
  return changed(current, {
    state: 'CONFIRMED', caseId: payload.caseId, confirmationStatus: payload.confirmationStatus,
    confirmedAt: payload.nowIso, safeErrorCode: null, updatedAt: payload.nowIso,
  })
}

function applyConfirmFail(
  current: P2Record,
  payload: Extract<MiniAppDraftStateMutation, { operation: 'CONFIRM_FAIL' }>,
  ports: BookingPorts,
) {
  requireConfirmBinding(current, payload.payloadHash, ports)
  if (current.state === 'FAILED_RETRYABLE') {
    if (current.version === payload.expectedVersion + 1 && current.safeErrorCode === payload.safeErrorCode) {
      return unchanged(current)
    }
    throw new Error('mini app draft confirm failure conflict')
  }
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED' || current.state === 'EXPIRED') {
    return unchanged(current, 'TERMINAL')
  }
  if (current.state !== 'CONFIRMING' || current.version !== payload.expectedVersion
    || current.attemptCount !== payload.expectedAttempt) throw new Error('stale mini app draft confirm failure')
  return changed(current, {
    state: 'FAILED_RETRYABLE', safeErrorCode: payload.safeErrorCode, updatedAt: payload.nowIso,
  })
}

function requireConfirmBinding(current: P2Record, payloadHash: string, ports: BookingPorts): void {
  if (current.payloadHash !== payloadHash || confirmPayloadHash(current, ports) !== payloadHash) {
    throw new Error('mini app draft confirm payload hash conflict')
  }
}

function confirmPayloadHash(current: P2Record, ports: BookingPorts): string {
  if (current.protocolVersion !== 2) throw new Error('mini app draft confirm protocol rejected')
  return ports.crypto.sha256Base64Url(canonicalMiniAppP2BookingIdentity({ ...current, protocolVersion: 2 }))
}

function resolveSnapshots(current: P2Record, input: MiniAppNormalizedBookingInputV2, ports: BookingPorts) {
  if (current.protocolVersion !== 2) throw new Error('mini app draft protocol rejected')
  const recorder = requireStaff(ports.config.findStaffById(current.staffId), 'recorder')
  if (!recorder.canCloseBooking || current.recorderName !== recorder.name) throw new Error('mini app draft recorder config rejected')
  const admin = requireStaff(ports.config.findStaffById(input.adminId), 'admin')
  if (!admin.canBeAe) throw new Error('mini app draft admin config rejected')
  const ae = input.aeId === null ? null : requireStaff(ports.config.findStaffById(input.aeId), 'AE')
  if (ae && !ae.canBeAe) throw new Error('mini app draft AE config rejected')
  if (!ports.config.findDoctor(input.doctorId)?.active || !ports.config.findService(input.serviceId)?.active
    || !ports.config.findChannel(input.channelId)?.active) throw new Error('mini app draft active config rejected')
  return { recorder, admin, ae }
}

function requireStaff(value: StaffConfig | null, label: string): StaffConfig {
  if (!value?.active) throw new Error(`mini app draft ${label} config rejected`)
  return value
}

function mergeEvidence(current: P2Record, payload: MiniAppDraftPrepareMutation) {
  const storage = payload.evidence[0]!.storage
  if (storage === 'STAGED_OBJECT' && (current.paymentEvidenceFileIds.length > 0 || current.chatEvidenceFileIds.length > 0)
    || storage === 'DRIVE_FILE' && (current.paymentEvidenceObjectKeys.length > 0 || current.chatEvidenceObjectKeys.length > 0)) {
    throw new Error('mini app draft evidence storage conflict')
  }
  const payment = mergedKind(current, payload, 'PAYMENT', storage)
  const chat = mergedKind(current, payload, 'CHAT', storage)
  return {
    paymentEvidenceFileIds: storage === 'DRIVE_FILE' ? payment : [],
    chatEvidenceFileIds: storage === 'DRIVE_FILE' ? chat : [],
    paymentEvidenceObjectKeys: storage === 'STAGED_OBJECT' ? payment : [],
    chatEvidenceObjectKeys: storage === 'STAGED_OBJECT' ? chat : [],
    evidenceCount: payment.length + chat.length,
  }
}

function mergedKind(
  current: P2Record,
  payload: MiniAppDraftPrepareMutation,
  kind: 'PAYMENT' | 'CHAT',
  storage: 'STAGED_OBJECT' | 'DRIVE_FILE',
): string[] {
  const items = payload.evidence.filter((item) => item.kind === kind).sort((left, right) => left.ordinal - right.ordinal)
  const previous = storage === 'STAGED_OBJECT'
    ? kind === 'PAYMENT' ? current.paymentEvidenceObjectKeys : current.chatEvidenceObjectKeys
    : kind === 'PAYMENT' ? current.paymentEvidenceFileIds : current.chatEvidenceFileIds
  const slots: Array<string | null> = items.map(() => null)
  if (storage === 'STAGED_OBJECT') {
    for (const value of previous) {
      const index = items.findIndex((item) => item.value === value || expectedStagedValue(item, payload.draftId) === value)
      if (index < 0) throw new Error('mini app draft evidence binding conflict')
      slots[index] = value
    }
  } else {
    previous.forEach((value, index) => { slots[index] = value })
  }
  for (const item of items) {
    if (item.value === null) continue
    const existing = slots[item.ordinal]
    if (existing && existing !== item.value) throw new Error('mini app draft evidence binding conflict')
    slots[item.ordinal] = item.value
  }
  const firstGap = slots.findIndex((value) => value === null)
  if (storage === 'DRIVE_FILE' && firstGap >= 0 && slots.slice(firstGap).some((value) => value !== null)) {
    throw new Error('mini app draft Drive ordinal gap')
  }
  return slots.flatMap((value) => value === null ? [] : [value])
}

function applyTerminalEvidence(
  current: P2Record,
  evidence: ReturnType<typeof mergeEvidence>,
  bindingHash: string,
  updatedAt: string,
) {
  if (sameEvidence(current, evidence) && current.evidenceProjectionHash === bindingHash
    && current.retentionState === 'PENDING_APPROVAL') return unchanged(current, 'TERMINAL')
  return changed(current, {
    retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: bindingHash, ...evidence, updatedAt,
  })
}

function sameReadyProjection(
  current: P2Record,
  payload: MiniAppDraftPrepareMutation,
  snapshots: PrepareSnapshots,
  evidence: ReturnType<typeof mergeEvidence>,
): boolean {
  return current.adminId === snapshots.admin.id && current.adminName === snapshots.admin.name
    && current.aeId === (snapshots.ae?.id ?? null) && current.aeName === (snapshots.ae?.name ?? 'ไม่ระบุ')
    && current.customerName === payload.input.customerName && current.facebookName === payload.input.facebookName
    && current.phoneNormalized === payload.input.phoneNormalized && current.doctorId === payload.input.doctorId
    && current.serviceId === payload.input.serviceId && current.queueType === payload.input.queueType
    && current.appointmentDate === payload.input.appointmentDate && current.appointmentTime === payload.input.appointmentTime
    && current.depositAmount === payload.input.depositAmount && current.channelId === payload.input.channelId
    && sameEvidence(current, evidence)
}

function sameEvidence(current: P2Record, evidence: ReturnType<typeof mergeEvidence>): boolean {
  return sameStrings(current.paymentEvidenceFileIds, evidence.paymentEvidenceFileIds)
    && sameStrings(current.chatEvidenceFileIds, evidence.chatEvidenceFileIds)
    && sameStrings(current.paymentEvidenceObjectKeys, evidence.paymentEvidenceObjectKeys)
    && sameStrings(current.chatEvidenceObjectKeys, evidence.chatEvidenceObjectKeys)
    && current.evidenceCount === evidence.evidenceCount
}

function changed(current: P2Record, patch: Partial<P2Record>) {
  return { write: true as const, next: { ...current, ...patch, version: current.version + 1 }, outcome: 'APPLIED' as const }
}
function unchanged(current: P2Record, outcome: 'IDEMPOTENT' | 'TERMINAL' = 'IDEMPOTENT') {
  return { write: false as const, next: current, outcome }
}

function safeResult(
  record: P2Record,
  outcome: MiniAppDraftStateResult['outcome'],
  ports: BookingPorts,
): MiniAppDraftStateResult {
  return {
    requestId: record.requestId, draftId: record.draftId,
    state: record.state as MiniAppDraftStateResult['state'], version: record.version, outcome,
    projectionDigest: ports.crypto.sha256Base64Url(canonicalMiniAppDraftProjection(projection(record))),
  }
}

function projection(record: P2Record): MiniAppDraftProjection {
  return {
    requestId: record.requestId, draftId: record.draftId, protocolVersion: 2, staffId: record.staffId,
    recorderName: record.recorderName, adminId: record.adminId, adminName: record.adminName,
    aeId: record.aeId, aeName: record.aeName,
    state: record.state as MiniAppDraftProjection['state'], retentionState: record.retentionState,
    version: record.version, evidenceProjectionHash: record.evidenceProjectionHash,
    input: record.adminId && record.customerName ? {
      requestId: record.requestId, adminId: record.adminId, aeId: record.aeId, customerName: record.customerName,
      facebookName: record.facebookName, phoneNormalized: record.phoneNormalized, doctorId: record.doctorId,
      serviceId: record.serviceId, queueType: record.queueType, appointmentDate: record.appointmentDate,
      appointmentTime: record.appointmentTime, depositAmount: record.depositAmount, channelId: record.channelId,
    } : null,
    paymentEvidenceFileIds: [...record.paymentEvidenceFileIds], chatEvidenceFileIds: [...record.chatEvidenceFileIds],
    paymentEvidenceObjectKeys: [...record.paymentEvidenceObjectKeys], chatEvidenceObjectKeys: [...record.chatEvidenceObjectKeys],
    evidenceCount: record.evidenceCount,
    payloadHash: record.payloadHash,
    attemptCount: record.attemptCount,
    confirmedAt: record.confirmedAt,
    caseId: record.caseId,
    confirmationStatus: record.confirmationStatus,
    safeErrorCode: record.safeErrorCode,
  }
}

function validNormalizedInput(value: MiniAppNormalizedBookingInputV2, requestId: string): boolean {
  return isRecord(value) && hasExactKeys(value, INPUT_KEYS) && value.requestId === requestId
    && safeConfigId(value.adminId) && (value.aeId === null || safeConfigId(value.aeId))
    && normalizedText(value.customerName, 160) && normalizedText(value.facebookName, 160)
    && /^0\d{8,9}$/.test(value.phoneNormalized) && safeConfigId(value.doctorId) && safeConfigId(value.serviceId)
    && safeConfigId(value.channelId) && Number.isFinite(value.depositAmount)
    && value.depositAmount > 0 && value.depositAmount <= 10_000_000
    && (value.queueType === 'AUTO' ? value.appointmentDate === null && value.appointmentTime === null
      : value.queueType === 'NORMAL' && validDate(value.appointmentDate) && validTime(value.appointmentTime))
}

function validEvidenceValue(item: MiniAppDraftEvidenceItem, draftId: string): boolean {
  if (typeof item.value !== 'string') return false
  return item.storage === 'DRIVE_FILE' ? /^[A-Za-z0-9_-]{10,256}$/.test(item.value)
    : item.value === expectedStagedValue(item, draftId)
}
function expectedStagedValue(item: MiniAppDraftEvidenceItem, draftId: string): string {
  return `drafts/${draftId}/${item.kind}/${item.contentSha256}.${item.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
}
function referenceCount(record: P2Record): number {
  return record.paymentEvidenceFileIds.length + record.chatEvidenceFileIds.length
    + record.paymentEvidenceObjectKeys.length + record.chatEvidenceObjectKeys.length
}
function asP2Record(value: MiniAppRequestStateRecord | null): P2Record | null {
  if (!value || !('protocolVersion' in value) || value.protocolVersion !== 2) return null
  return value as P2Record
}
function normalizedText(value: unknown, max: number): value is string {
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
