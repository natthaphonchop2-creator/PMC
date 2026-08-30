import { createHash } from 'node:crypto'
import type { BookingDraftInputV2 } from '../../src/apps/pmc-mini-app/contracts.js'
import {
  canonicalMiniAppDraftProjection,
  canonicalMiniAppPrepareBinding,
  type MiniAppDraftEvidenceItem,
  type MiniAppDraftProjection,
  type MiniAppDraftStateMutation,
  type MiniAppDraftStateResult,
  type MiniAppNormalizedBookingInputV2,
} from '../../shared/pmcMiniAppDraftState.js'
import { parseBookingDraftV2, type BookingDraftContextV2 } from './bookingDraft.js'
import type { DraftStateIngressPort } from './draftStateIngressClient.js'
import type { EvidenceBatchFile } from './evidenceBatch.js'
import { validateEvidence } from './evidence.js'
import { miniAppEvidenceIngressIdentity, type EvidenceIngressPort } from './evidenceIngressClient.js'
import { evidenceObjectKey, type EvidenceStagingPort } from './stagingStore.js'
import type { MiniAppRequestRecord, MiniAppStore } from './store.js'

type EvidenceKind = 'PAYMENT' | 'CHAT'
type EvidenceMime = 'image/jpeg' | 'image/png'

export interface EvidenceReference {
  deterministicUploadId: string
  storage: 'STAGED_OBJECT' | 'DRIVE_FILE'
  value: string
  contentSha256: string
}
export interface PersistedPrepareEvidence {
  payment: readonly EvidenceReference[]
  chat: readonly EvidenceReference[]
  complete: boolean
  draft: MiniAppRequestRecord
}
export interface PersistPrepareEvidenceInput {
  draft: MiniAppRequestRecord
  version: number
  input: BookingDraftInputV2
  paymentFiles: readonly EvidenceBatchFile[]
  chatFiles: readonly EvidenceBatchFile[]
  bookingContext?: Pick<BookingDraftContextV2, 'doctors' | 'services' | 'channels' | 'admins' | 'aes'>
  persistence: { type: 'ASYNC'; staging: EvidenceStagingPort } | { type: 'SYNC'; ingress: EvidenceIngressPort }
  store: Pick<MiniAppStore, 'getDraft'>
  draftStateIngress: DraftStateIngressPort
  now: () => string
}
export class BookingPreparePersistenceError extends Error {
  readonly code: 'BOOKING_PREPARE_CONFLICT' | 'BOOKING_PREPARE_RETRY'
  readonly persistedReferenceCount: number
  constructor(code: 'BOOKING_PREPARE_CONFLICT' | 'BOOKING_PREPARE_RETRY', persistedReferenceCount = 0) {
    super(code); this.name = 'BookingPreparePersistenceError'; this.code = code
    this.persistedReferenceCount = persistedReferenceCount
  }
}

interface EvidenceDescriptor {
  kind: EvidenceKind
  ordinal: number
  file: EvidenceBatchFile
  mimeType: EvidenceMime
  rawContentSha256: string
  stagedUploadId: string
  driveUploadId: string
  remoteContentSha256: string
  objectKey: string
}
interface PersistedReferences { payment: EvidenceReference[]; chat: EvidenceReference[] }
class RemoteEvidencePersistenceError extends Error {
  readonly persisted: PersistedReferences
  constructor(persisted: PersistedReferences) { super('BOOKING_PREPARE_REMOTE_RETRY'); this.persisted = persisted }
}

export async function persistPrepareEvidence(input: PersistPrepareEvidenceInput): Promise<PersistedPrepareEvidence> {
  assertPrepareShape(input)
  const descriptors = describeEvidence(input)
  const validationDraft = parsedDraft(input, descriptors, placeholderReferences(input.persistence.type, descriptors))
  const normalizedInput = normalizedInputFromDraft(validationDraft)
  const bindingHash = prepareBindingHash(input, validationDraft, normalizedInput, descriptors)
  if (input.draft.state === 'READY_TO_CONFIRM') return exactReadyReplay(input, descriptors, bindingHash)
  assertRecoverableDraft(input.draft, input.version, bindingHash)
  const startedTerminal = input.draft.state === 'CANCELLED' || input.draft.state === 'EXPIRED'
  const reservedDraft = await reserveOwnerBinding(input, descriptors, bindingHash, normalizedInput, validationDraft)
  if (!startedTerminal && (reservedDraft.state === 'CANCELLED' || reservedDraft.state === 'EXPIRED')) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  const reservedInput = { ...input, draft: reservedDraft }

  let persisted: PersistedReferences
  try {
    persisted = reservedInput.persistence.type === 'ASYNC'
      ? await persistAsync(reservedInput, descriptors)
      : await persistSync(reservedInput, descriptors)
  } catch (error) {
    if (!(error instanceof RemoteEvidencePersistenceError)) throw error
    const draft = await mutateOwnerState(reservedInput, descriptors, error.persisted, bindingHash, normalizedInput, 'PREPARE_PARTIAL')
    if (draft.state === 'CANCELLED' || draft.state === 'EXPIRED') {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT', referenceCount(error.persisted))
    }
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(error.persisted))
  }
  const draft = await mutateOwnerState(reservedInput, descriptors, persisted, bindingHash, normalizedInput, 'PREPARE_READY')
  if (draft.state === 'CANCELLED' || draft.state === 'EXPIRED') {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT', referenceCount(persisted))
  }
  return { ...persisted, complete: true, draft }
}

function assertPrepareShape(input: PersistPrepareEvidenceInput): void {
  if (input.draft.protocolVersion !== 2 || !Number.isSafeInteger(input.version) || input.version < 1
    || input.paymentFiles.length < 1 || input.paymentFiles.length > 10
    || input.chatFiles.length < 1 || input.chatFiles.length > 10) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
}
function describeEvidence(input: PersistPrepareEvidenceInput): EvidenceDescriptor[] {
  return [
    ...input.paymentFiles.map((file, ordinal) => descriptor(input.draft, 'PAYMENT', ordinal, file)),
    ...input.chatFiles.map((file, ordinal) => descriptor(input.draft, 'CHAT', ordinal, file)),
  ]
}
function descriptor(draft: MiniAppRequestRecord, kind: EvidenceKind, ordinal: number, file: EvidenceBatchFile): EvidenceDescriptor {
  const mimeType = validateEvidence(file.bytes, file.advertisedMime)
  if (mimeType !== file.advertisedMime) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  const rawContentSha256 = createHash('sha256').update(file.bytes).digest('hex')
  const stagedUploadId = createHash('sha256').update(`${draft.draftId}\0${kind}\0${rawContentSha256}`, 'utf8').digest('hex')
  const drive = miniAppEvidenceIngressIdentity({ draftId: draft.draftId, requestId: draft.requestId, kind, mimeType, bytes: file.bytes })
  return {
    kind, ordinal, file, mimeType, rawContentSha256, stagedUploadId,
    driveUploadId: drive.deterministicUploadId, remoteContentSha256: drive.contentSha256,
    objectKey: evidenceObjectKey({ draftId: draft.draftId, kind, contentSha256: rawContentSha256, mimeType }),
  }
}
function prepareBindingHash(
  input: PersistPrepareEvidenceInput,
  draft: MiniAppRequestRecord,
  normalizedInput: MiniAppNormalizedBookingInputV2,
  descriptors: readonly EvidenceDescriptor[],
): string {
  const canonical = canonicalMiniAppPrepareBinding({
    requestId: draft.requestId, draftId: draft.draftId, baseVersion: input.version,
    staffId: draft.staffId, recorderName: draft.recorderName, adminId: draft.adminId, adminName: draft.adminName,
    aeId: draft.aeId, aeName: draft.aeName, input: normalizedInput,
    evidence: descriptors.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.rawContentSha256, mimeType: item.mimeType,
      storage: input.persistence.type === 'ASYNC' ? 'STAGED_OBJECT' : 'DRIVE_FILE',
    })),
  })
  return createHash('sha256').update(canonical).digest('base64url')
}
function normalizedInputFromDraft(draft: MiniAppRequestRecord): MiniAppNormalizedBookingInputV2 {
  return {
    requestId: draft.requestId, adminId: draft.adminId, aeId: draft.aeId, customerName: draft.customerName,
    facebookName: draft.facebookName, phoneNormalized: draft.phoneNormalized, doctorId: draft.doctorId,
    serviceId: draft.serviceId, queueType: draft.queueType, appointmentDate: draft.appointmentDate,
    appointmentTime: draft.appointmentTime, depositAmount: draft.depositAmount, channelId: draft.channelId,
  }
}
function placeholderReferences(type: 'ASYNC' | 'SYNC', descriptors: readonly EvidenceDescriptor[]): PersistedReferences {
  return splitReferences(descriptors.map((item) => reference(
    item, type === 'ASYNC' ? 'STAGED_OBJECT' : 'DRIVE_FILE', type === 'ASYNC' ? item.objectKey : item.rawContentSha256,
  )), descriptors.filter(({ kind }) => kind === 'PAYMENT').length)
}
function parsedDraft(input: PersistPrepareEvidenceInput, descriptors: readonly EvidenceDescriptor[], persisted: PersistedReferences): MiniAppRequestRecord {
  const asyncEvidence = input.persistence.type === 'ASYNC'
  const reserved = input.draft.evidenceProjectionHash !== null
  const bookingContext = reserved ? reservedBookingContext(input) : input.bookingContext
  if (!bookingContext) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  let draft: MiniAppRequestRecord
  try {
    draft = parseBookingDraftV2(input.input, {
      draftId: input.draft.draftId,
      staffId: input.draft.staffId,
      recorderName: input.draft.recorderName,
      lineUserIdHash: input.draft.lineUserIdHash,
      ...bookingContext,
      paymentEvidenceFileIds: asyncEvidence ? [] : persisted.payment.map(({ value }) => value),
      chatEvidenceFileIds: asyncEvidence ? [] : persisted.chat.map(({ value }) => value),
      paymentEvidenceObjectKeys: asyncEvidence ? persisted.payment.map(({ value }) => value) : [],
      chatEvidenceObjectKeys: asyncEvidence ? persisted.chat.map(({ value }) => value) : [],
      asyncEvidence,
      now: input.now(),
    })
  } catch (error) {
    if (reserved) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    throw error
  }
  if (draft.requestId !== input.draft.requestId || descriptors.length !== draft.evidenceCount) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return draft
}

function reservedBookingContext(
  input: PersistPrepareEvidenceInput,
): Pick<BookingDraftContextV2, 'doctors' | 'services' | 'channels' | 'admins' | 'aes'> {
  const option = (id: unknown, name: unknown = id) => typeof id === 'string' && typeof name === 'string'
    ? [{ id, name }]
    : []
  return {
    doctors: option(input.input.doctorId),
    services: option(input.input.serviceId),
    channels: option(input.input.channelId),
    admins: option(input.draft.adminId, input.draft.adminName),
    aes: input.draft.aeId === null ? [] : option(input.draft.aeId, input.draft.aeName),
  }
}
function exactReadyReplay(input: PersistPrepareEvidenceInput, descriptors: readonly EvidenceDescriptor[], bindingHash: string): PersistedPrepareEvidence {
  const persisted = referencesFromDraft(input.draft, descriptors, input.persistence.type)
  if (input.draft.evidenceProjectionHash !== bindingHash
    || !samePreparedFields(input.draft, parsedDraft({ ...input, draft: input.draft }, descriptors, persisted))) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return { ...persisted, complete: true, draft: structuredClone(input.draft) }
}
function assertRecoverableDraft(draft: MiniAppRequestRecord, version: number, bindingHash: string): void {
  if (draft.payloadHash !== null) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  if (draft.state === 'CANCELLED' || draft.state === 'EXPIRED') {
    if (draft.evidenceProjectionHash !== bindingHash || draft.version < version + 2) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    return
  }
  if (draft.state !== 'DRAFT') throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  if (draft.evidenceProjectionHash === null) {
    if (draft.version !== version || referenceCountFromDraft(draft) !== 0) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  } else if (draft.evidenceProjectionHash !== bindingHash) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
}

async function persistAsync(input: PersistPrepareEvidenceInput, descriptors: readonly EvidenceDescriptor[]): Promise<PersistedReferences> {
  if (input.persistence.type !== 'ASYNC') throw new Error('unreachable')
  const staging = input.persistence.staging
  const existing = asyncExistingReferences(input.draft, descriptors)
  const completed = new Map(existing.map((item) => [item.value, item]))
  const missing = descriptors.filter(({ objectKey }) => !completed.has(objectKey))
  let cursor = 0; let failure: unknown
  const worker = async () => {
    while (failure === undefined) {
      const item = missing[cursor++]
      if (!item) return
      try {
        const staged = await staging.put({ draftId: input.draft.draftId, kind: item.kind, mimeType: item.mimeType, bytes: item.file.bytes })
        if (staged.objectKey !== item.objectKey || staged.size !== item.file.bytes.length
          || staged.contentSha256 !== item.rawContentSha256) throw new Error('INVALID_STAGE_RESULT')
        completed.set(item.objectKey, reference(item, 'STAGED_OBJECT', item.objectKey))
      } catch (error) { failure ??= error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker))
  const persisted = referencesInDescriptorOrder(descriptors, completed)
  if (failure !== undefined) throw new RemoteEvidencePersistenceError(persisted)
  return persisted
}
async function persistSync(input: PersistPrepareEvidenceInput, descriptors: readonly EvidenceDescriptor[]): Promise<PersistedReferences> {
  if (input.persistence.type !== 'SYNC') throw new Error('unreachable')
  const existing = syncExistingReferences(input.draft, descriptors)
  const paymentCount = descriptors.filter(({ kind }) => kind === 'PAYMENT').length
  const all = [...existing.payment, ...existing.chat]
  for (let index = all.length; index < descriptors.length; index += 1) {
    const item = descriptors[index]!
    try {
      const fileId = await input.persistence.ingress.upload({
        draftId: input.draft.draftId, requestId: input.draft.requestId, kind: item.kind,
        mimeType: item.mimeType, bytes: item.file.bytes,
      })
      if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) throw new Error('INVALID_INGRESS_RESULT')
      all[index] = reference(item, 'DRIVE_FILE', fileId)
    } catch { throw new RemoteEvidencePersistenceError(splitReferences(all, paymentCount)) }
  }
  return splitReferences(all, paymentCount)
}

async function reserveOwnerBinding(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
  normalizedInput: MiniAppNormalizedBookingInputV2,
  validationDraft: MiniAppRequestRecord,
): Promise<MiniAppRequestRecord> {
  const mutation = beginMutation(input, descriptors, bindingHash, normalizedInput)
  const expected = expectedBeginProjection(input.draft, validationDraft, bindingHash, input.now())
  try {
    const result = await input.draftStateIngress.mutate(mutation)
    if (trustedResult(result, expected)) return withResultVersion(expected, result)
  } catch { /* exactly one authoritative reread below */ }
  const reread = await safeReadDraft(input.store, input.draft.draftId)
  if (!reread) throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY')
  if (reread.evidenceProjectionHash === bindingHash) {
    if (!sameReservedAttribution(reread, validationDraft)) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    if (reread.state === 'DRAFT' || reread.state === 'CANCELLED' || reread.state === 'EXPIRED') return reread
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  if (reread.evidenceProjectionHash !== null) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  if (reread.state === 'CANCELLED' || reread.state === 'EXPIRED') throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  if (projectionDigest(reread) !== projectionDigest(input.draft)) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  try {
    const result = await input.draftStateIngress.mutate(mutation)
    if (trustedResult(result, expected)) return withResultVersion(expected, result)
  } catch { /* bounded resend has no remote side effect and no second reread */ }
  throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY')
}

function beginMutation(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
  normalizedInput: MiniAppNormalizedBookingInputV2,
): MiniAppDraftStateMutation {
  return {
    operation: 'PREPARE_BEGIN', requestId: input.draft.requestId, draftId: input.draft.draftId,
    expectedVersion: input.draft.version, expectedAttempt: input.draft.attemptCount, baseVersion: input.version,
    nowIso: input.now(), prepareBindingHash: bindingHash, input: normalizedInput,
    evidence: descriptors.map((item) => ({
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.rawContentSha256,
      mimeType: item.mimeType, storage: input.persistence.type === 'ASYNC' ? 'STAGED_OBJECT' : 'DRIVE_FILE',
    })),
  }
}

function expectedBeginProjection(
  draft: MiniAppRequestRecord,
  validationDraft: MiniAppRequestRecord,
  bindingHash: string,
  updatedAt: string,
): MiniAppRequestRecord {
  if (draft.evidenceProjectionHash === bindingHash) return structuredClone(draft)
  return {
    ...structuredClone(draft),
    recorderName: validationDraft.recorderName,
    adminId: validationDraft.adminId,
    adminName: validationDraft.adminName,
    aeId: validationDraft.aeId,
    aeName: validationDraft.aeName,
    evidenceProjectionHash: bindingHash,
    updatedAt,
    version: draft.version + 1,
  }
}

async function mutateOwnerState(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  persisted: PersistedReferences,
  bindingHash: string,
  normalizedInput: MiniAppNormalizedBookingInputV2,
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
): Promise<MiniAppRequestRecord> {
  const mutation = draftStateMutation(input, descriptors, persisted, bindingHash, normalizedInput, operation)
  const expected = expectedOwnerProjection(input, descriptors, persisted, bindingHash, operation)
  try {
    const result = await input.draftStateIngress.mutate(mutation)
    if (trustedResult(result, expected)) return withResultVersion(expected, result)
  } catch { /* exactly one authoritative reread below */ }
  const reread = await safeReadDraft(input.store, input.draft.draftId)
  if (!reread) throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(persisted))
  if (attestsApplied(reread, expected, persisted, bindingHash, input.persistence.type, operation)) return reread
  if (reread.evidenceProjectionHash && reread.evidenceProjectionHash !== bindingHash) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  const cancelWonWithoutPrepare = (reread.state === 'CANCELLED' || reread.state === 'EXPIRED')
    && reread.evidenceProjectionHash === null && referenceCountFromDraft(reread) === 0
    && reread.version === input.draft.version + 1
  const terminalSameBindingNoApply = (reread.state === 'CANCELLED' || reread.state === 'EXPIRED')
    && reread.evidenceProjectionHash === bindingHash
    && !attestsApplied(reread, expected, persisted, bindingHash, input.persistence.type, operation)
  if (!cancelWonWithoutPrepare && !terminalSameBindingNoApply
    && projectionDigest(reread) !== projectionDigest(input.draft)) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  const resendExpected = cancelWonWithoutPrepare || terminalSameBindingNoApply
    ? expectedOwnerProjection({ ...input, draft: reread }, descriptors, persisted, bindingHash, operation)
    : expected
  try {
    const result = await input.draftStateIngress.mutate(mutation)
    if (trustedResult(result, resendExpected)) return withResultVersion(resendExpected, result)
  } catch { /* bounded resend has no second reread */ }
  throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(persisted))
}
function draftStateMutation(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  persisted: PersistedReferences,
  bindingHash: string,
  normalizedInput: MiniAppNormalizedBookingInputV2,
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
): MiniAppDraftStateMutation {
  const objectValues = new Map([...persisted.payment, ...persisted.chat].map((item) => [item.value, item]))
  const evidence: MiniAppDraftEvidenceItem[] = descriptors.map((item) => {
    const storage = input.persistence.type === 'ASYNC' ? 'STAGED_OBJECT' : 'DRIVE_FILE'
    const persistedRef = storage === 'STAGED_OBJECT' ? objectValues.get(item.objectKey)
      : (item.kind === 'PAYMENT' ? persisted.payment[item.ordinal] : persisted.chat[item.ordinal])
    return {
      kind: item.kind, ordinal: item.ordinal, contentSha256: item.rawContentSha256,
      mimeType: item.mimeType, storage, value: persistedRef?.value ?? null,
    }
  })
  return {
    operation, requestId: input.draft.requestId, draftId: input.draft.draftId,
    expectedVersion: input.draft.version, expectedAttempt: input.draft.attemptCount, baseVersion: input.version,
    nowIso: input.now(), prepareBindingHash: bindingHash, input: normalizedInput, evidence,
  }
}

function expectedOwnerProjection(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  persisted: PersistedReferences,
  bindingHash: string,
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
): MiniAppRequestRecord {
  const draft = structuredClone(input.draft)
  const merged = mergeExpectedReferences(draft, persisted, descriptors, input.persistence.type)
  const terminal = draft.state === 'CANCELLED' || draft.state === 'EXPIRED'
  if (terminal) return nextIfChanged(draft, { retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: bindingHash, ...merged, updatedAt: input.now() })
  if (operation === 'PREPARE_PARTIAL') return nextIfChanged(draft, {
    state: 'DRAFT', retentionState: 'PENDING_APPROVAL', evidenceProjectionHash: bindingHash, ...merged, updatedAt: input.now(),
  })
  const parsed = parsedDraft(input, descriptors, persisted)
  return nextIfChanged(draft, {
    state: 'READY_TO_CONFIRM', retentionState: '', evidenceProjectionHash: bindingHash,
    adminId: parsed.adminId, adminName: parsed.adminName, aeId: parsed.aeId, aeName: parsed.aeName,
    customerName: parsed.customerName, facebookName: parsed.facebookName, phoneNormalized: parsed.phoneNormalized,
    doctorId: parsed.doctorId, serviceId: parsed.serviceId, queueType: parsed.queueType,
    appointmentDate: parsed.appointmentDate, appointmentTime: parsed.appointmentTime,
    depositAmount: parsed.depositAmount, channelId: parsed.channelId, ...merged, updatedAt: input.now(),
  })
}
function mergeExpectedReferences(draft: MiniAppRequestRecord, persisted: PersistedReferences, descriptors: readonly EvidenceDescriptor[], type: 'ASYNC' | 'SYNC') {
  if (type === 'ASYNC') {
    const all = new Set([...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys,
      ...persisted.payment.map(({ value }) => value), ...persisted.chat.map(({ value }) => value)])
    const paymentEvidenceObjectKeys = descriptors.filter(({ kind, objectKey }) => kind === 'PAYMENT' && all.has(objectKey)).map(({ objectKey }) => objectKey)
    const chatEvidenceObjectKeys = descriptors.filter(({ kind, objectKey }) => kind === 'CHAT' && all.has(objectKey)).map(({ objectKey }) => objectKey)
    return { paymentEvidenceFileIds: [], chatEvidenceFileIds: [], paymentEvidenceObjectKeys, chatEvidenceObjectKeys,
      evidenceCount: paymentEvidenceObjectKeys.length + chatEvidenceObjectKeys.length }
  }
  const paymentEvidenceFileIds = mergePrefix(draft.paymentEvidenceFileIds, persisted.payment.map(({ value }) => value))
  const chatEvidenceFileIds = mergePrefix(draft.chatEvidenceFileIds, persisted.chat.map(({ value }) => value))
  return { paymentEvidenceFileIds, chatEvidenceFileIds, paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [],
    evidenceCount: paymentEvidenceFileIds.length + chatEvidenceFileIds.length }
}
function nextIfChanged(draft: MiniAppRequestRecord, patch: Partial<MiniAppRequestRecord>): MiniAppRequestRecord {
  const candidate = { ...draft, ...patch }
  return projectionDigest(candidate) === projectionDigest(draft) ? draft : { ...candidate, version: draft.version + 1 }
}
function trustedResult(result: MiniAppDraftStateResult, expected: MiniAppRequestRecord): boolean {
  return result.requestId === expected.requestId && result.draftId === expected.draftId
    && result.state === expected.state && result.version === expected.version
    && result.projectionDigest === projectionDigest(expected)
    && (result.outcome === 'APPLIED' || result.outcome === 'IDEMPOTENT' || result.outcome === 'TERMINAL')
}
function withResultVersion(expected: MiniAppRequestRecord, result: MiniAppDraftStateResult): MiniAppRequestRecord {
  return { ...structuredClone(expected), version: result.version }
}
function attestsApplied(
  draft: MiniAppRequestRecord,
  expected: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
  type: 'ASYNC' | 'SYNC',
  operation: 'PREPARE_READY' | 'PREPARE_PARTIAL',
): boolean {
  if (draft.evidenceProjectionHash !== bindingHash) return false
  const terminal = draft.state === 'CANCELLED' || draft.state === 'EXPIRED'
  if (!terminal && operation === 'PREPARE_READY' && draft.state !== 'READY_TO_CONFIRM') return false
  if (!terminal && operation === 'PREPARE_PARTIAL' && draft.state !== 'DRAFT' && draft.state !== 'READY_TO_CONFIRM') return false
  const payment = type === 'ASYNC' ? draft.paymentEvidenceObjectKeys : draft.paymentEvidenceFileIds
  const chat = type === 'ASYNC' ? draft.chatEvidenceObjectKeys : draft.chatEvidenceFileIds
  return isSubset(persisted.payment.map(({ value }) => value), payment)
    && isSubset(persisted.chat.map(({ value }) => value), chat)
    && (projectionDigest(draft) === projectionDigest(expected) || operation === 'PREPARE_PARTIAL' || terminal)
}
export function projectionDigest(draft: MiniAppRequestRecord): string {
  return createHash('sha256').update(canonicalMiniAppDraftProjection(projection(draft))).digest('base64url')
}
function projection(draft: MiniAppRequestRecord): MiniAppDraftProjection {
  return {
    requestId: draft.requestId, draftId: draft.draftId, protocolVersion: 2, staffId: draft.staffId,
    recorderName: draft.recorderName, adminId: draft.adminId, adminName: draft.adminName,
    aeId: draft.aeId, aeName: draft.aeName, state: draft.state as MiniAppDraftProjection['state'],
    retentionState: draft.retentionState, version: draft.version, evidenceProjectionHash: draft.evidenceProjectionHash,
    input: draft.adminId && draft.customerName ? normalizedInputFromDraft(draft) : null,
    paymentEvidenceFileIds: [...draft.paymentEvidenceFileIds], chatEvidenceFileIds: [...draft.chatEvidenceFileIds],
    paymentEvidenceObjectKeys: [...draft.paymentEvidenceObjectKeys], chatEvidenceObjectKeys: [...draft.chatEvidenceObjectKeys],
    evidenceCount: draft.evidenceCount,
  }
}

function referencesInDescriptorOrder(descriptors: readonly EvidenceDescriptor[], completed: Map<string, EvidenceReference>): PersistedReferences {
  return {
    payment: descriptors.filter(({ kind }) => kind === 'PAYMENT').flatMap((item) => completed.get(item.objectKey) ? [completed.get(item.objectKey)!] : []),
    chat: descriptors.filter(({ kind }) => kind === 'CHAT').flatMap((item) => completed.get(item.objectKey) ? [completed.get(item.objectKey)!] : []),
  }
}
function asyncExistingReferences(draft: MiniAppRequestRecord, descriptors: readonly EvidenceDescriptor[]): EvidenceReference[] {
  if (draft.paymentEvidenceFileIds.length || draft.chatEvidenceFileIds.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  const expected = new Map(descriptors.map((item) => [item.objectKey, item]))
  return [...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys].map((value) => {
    const item = expected.get(value)
    if (!item) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    return reference(item, 'STAGED_OBJECT', value)
  })
}
function syncExistingReferences(draft: MiniAppRequestRecord, descriptors: readonly EvidenceDescriptor[]): PersistedReferences {
  if (draft.paymentEvidenceObjectKeys.length || draft.chatEvidenceObjectKeys.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  const payment = descriptors.filter(({ kind }) => kind === 'PAYMENT'); const chat = descriptors.filter(({ kind }) => kind === 'CHAT')
  if (draft.paymentEvidenceFileIds.length > payment.length || draft.chatEvidenceFileIds.length > chat.length
    || draft.paymentEvidenceFileIds.length < payment.length && draft.chatEvidenceFileIds.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return {
    payment: draft.paymentEvidenceFileIds.map((value, index) => reference(payment[index]!, 'DRIVE_FILE', value)),
    chat: draft.chatEvidenceFileIds.map((value, index) => reference(chat[index]!, 'DRIVE_FILE', value)),
  }
}
function referencesFromDraft(draft: MiniAppRequestRecord, descriptors: readonly EvidenceDescriptor[], type: 'ASYNC' | 'SYNC') {
  const refs = type === 'ASYNC' ? splitReferences(asyncExistingReferences(draft, descriptors), draft.paymentEvidenceObjectKeys.length)
    : syncExistingReferences(draft, descriptors)
  if (referenceCount(refs) !== descriptors.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return refs
}
function reference(item: EvidenceDescriptor, storage: EvidenceReference['storage'], value: string): EvidenceReference {
  return { deterministicUploadId: storage === 'DRIVE_FILE' ? item.driveUploadId : item.stagedUploadId,
    storage, value, contentSha256: storage === 'DRIVE_FILE' ? item.remoteContentSha256 : item.rawContentSha256 }
}
function splitReferences(values: readonly EvidenceReference[], paymentCount: number): PersistedReferences {
  return { payment: values.slice(0, paymentCount), chat: values.slice(paymentCount) }
}
function mergePrefix(existing: readonly string[], incoming: readonly string[]): string[] {
  const overlap = Math.min(existing.length, incoming.length)
  for (let index = 0; index < overlap; index += 1) if (existing[index] !== incoming[index]) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return existing.length >= incoming.length ? [...existing] : [...incoming]
}
function samePreparedFields(left: MiniAppRequestRecord, right: MiniAppRequestRecord): boolean {
  return projectionDigest(left) === projectionDigest({
    ...right,
    version: left.version,
    evidenceProjectionHash: left.evidenceProjectionHash,
    updatedAt: left.updatedAt,
  })
}
function sameReservedAttribution(left: MiniAppRequestRecord, right: MiniAppRequestRecord): boolean {
  return left.staffId === right.staffId && left.recorderName === right.recorderName
    && left.adminId === right.adminId && left.adminName === right.adminName
    && left.aeId === right.aeId && left.aeName === right.aeName
}
function referenceCount(refs: PersistedReferences): number { return refs.payment.length + refs.chat.length }
function referenceCountFromDraft(draft: MiniAppRequestRecord): number {
  return draft.paymentEvidenceFileIds.length + draft.chatEvidenceFileIds.length
    + draft.paymentEvidenceObjectKeys.length + draft.chatEvidenceObjectKeys.length
}
function isSubset(values: readonly string[], expected: readonly string[]): boolean {
  const set = new Set(expected); return values.every((value) => set.has(value))
}
async function safeReadDraft(store: Pick<MiniAppStore, 'getDraft'>, draftId: string) {
  try { return await store.getDraft(draftId) } catch { return null }
}
