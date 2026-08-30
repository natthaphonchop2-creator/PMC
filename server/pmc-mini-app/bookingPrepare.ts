import { createHash } from 'node:crypto'
import type { BookingDraftInputV2 } from '../../src/apps/pmc-mini-app/contracts.js'
import {
  bookingPrepareBindingHash,
  parseBookingDraftV2,
  type BookingDraftContextV2,
} from './bookingDraft.js'
import type { EvidenceBatchFile } from './evidenceBatch.js'
import { validateEvidence } from './evidence.js'
import {
  miniAppEvidenceIngressIdentity,
  type EvidenceIngressPort,
} from './evidenceIngressClient.js'
import type { AsyncStateIngressPort } from './asyncStateIngressClient.js'
import { evidenceObjectKey, type EvidenceStagingPort } from './stagingStore.js'
import type { MiniAppAsyncStateMutation } from '../../shared/pmcMiniAppAsyncState.js'
import type { MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from './store.js'

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
  bookingContext: Pick<BookingDraftContextV2, 'doctors' | 'services' | 'channels' | 'admins' | 'aes'>
  persistence:
    | { type: 'ASYNC'; staging: EvidenceStagingPort }
    | { type: 'SYNC'; ingress: EvidenceIngressPort }
  store: Pick<MiniAppStore, 'getDraft' | 'updateDraft'>
  stateIngress: AsyncStateIngressPort
  now: () => string
}

export class BookingPreparePersistenceError extends Error {
  readonly code: 'BOOKING_PREPARE_CONFLICT' | 'BOOKING_PREPARE_RETRY'
  readonly persistedReferenceCount: number

  constructor(code: 'BOOKING_PREPARE_CONFLICT' | 'BOOKING_PREPARE_RETRY', persistedReferenceCount = 0) {
    super(code)
    this.name = 'BookingPreparePersistenceError'
    this.code = code
    this.persistedReferenceCount = persistedReferenceCount
  }
}

interface EvidenceDescriptor {
  kind: EvidenceKind
  file: EvidenceBatchFile
  mimeType: EvidenceMime
  rawContentSha256: string
  stagedUploadId: string
  driveUploadId: string
  remoteContentSha256: string
  objectKey: string
}

interface PersistedReferences {
  payment: EvidenceReference[]
  chat: EvidenceReference[]
}

export async function persistPrepareEvidence(input: PersistPrepareEvidenceInput): Promise<PersistedPrepareEvidence> {
  assertPrepareShape(input)
  const descriptors = describeEvidence(input)
  const paymentDescriptors = descriptors.filter(({ kind }) => kind === 'PAYMENT')
  const chatDescriptors = descriptors.filter(({ kind }) => kind === 'CHAT')
  const validationDraft = parsedDraft(input, descriptors, placeholderReferences(input.persistence.type, descriptors))
  const bindingHash = bookingPrepareBindingHash({
    draft: validationDraft,
    baseVersion: input.version,
    paymentContentSha256: paymentDescriptors.map(({ rawContentSha256 }) => rawContentSha256),
    chatContentSha256: chatDescriptors.map(({ rawContentSha256 }) => rawContentSha256),
  })

  if (input.draft.state === 'READY_TO_CONFIRM') {
    return exactReadyReplay(input, descriptors, bindingHash)
  }
  assertRecoverableDraft(input.draft, input.version, bindingHash)

  let persisted: PersistedReferences
  if (input.persistence.type === 'ASYNC') {
    persisted = await persistAsync(input, descriptors, bindingHash)
  } else {
    persisted = await persistSync(input, descriptors, bindingHash)
  }

  const completedDraft = parsedDraft(input, descriptors, persisted)
  const patch = readyPatch(completedDraft, persisted, bindingHash, input.now())
  try {
    const draft = await input.store.updateDraft(input.draft.draftId, input.draft.version, patch)
    return { ...persisted, complete: true, draft }
  } catch {
    const recovered = await safeReadDraft(input.store, input.draft.draftId)
    if (recovered && isExactReady(recovered, input, descriptors, bindingHash)) {
      return { ...referencesFromDraft(recovered, descriptors, input.persistence.type), complete: true, draft: recovered }
    }
    if (recovered) await persistRecoveryReferences(input, recovered, persisted, bindingHash, descriptors)
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(persisted))
  }
}

function assertPrepareShape(input: PersistPrepareEvidenceInput): void {
  if (input.draft.protocolVersion !== 2 || !Number.isSafeInteger(input.version) || input.version < 1
    || input.paymentFiles.length < 1 || input.paymentFiles.length > 10
    || input.chatFiles.length < 1 || input.chatFiles.length > 10) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
}

function describeEvidence(input: PersistPrepareEvidenceInput): EvidenceDescriptor[] {
  return [
    ...input.paymentFiles.map((file) => descriptor(input.draft, 'PAYMENT', file)),
    ...input.chatFiles.map((file) => descriptor(input.draft, 'CHAT', file)),
  ]
}

function descriptor(
  draft: MiniAppRequestRecord,
  kind: EvidenceKind,
  file: EvidenceBatchFile,
): EvidenceDescriptor {
  const mimeType = validateEvidence(file.bytes, file.advertisedMime)
  if (mimeType !== file.advertisedMime) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  const rawContentSha256 = createHash('sha256').update(file.bytes).digest('hex')
  const stagedUploadId = createHash('sha256')
    .update(`${draft.draftId}\0${kind}\0${rawContentSha256}`, 'utf8')
    .digest('hex')
  const identity = miniAppEvidenceIngressIdentity({
    draftId: draft.draftId,
    requestId: draft.requestId,
    kind,
    mimeType,
    bytes: file.bytes,
  })
  return {
    kind,
    file,
    mimeType,
    rawContentSha256,
    stagedUploadId,
    driveUploadId: identity.deterministicUploadId,
    remoteContentSha256: identity.contentSha256,
    objectKey: evidenceObjectKey({ draftId: draft.draftId, kind, contentSha256: rawContentSha256, mimeType }),
  }
}

function placeholderReferences(type: 'ASYNC' | 'SYNC', descriptors: readonly EvidenceDescriptor[]): PersistedReferences {
  return splitReferences(
    descriptors.map((item) => reference(item, type === 'ASYNC' ? 'STAGED_OBJECT' : 'DRIVE_FILE',
      type === 'ASYNC' ? item.objectKey : item.rawContentSha256)),
    descriptors.filter(({ kind }) => kind === 'PAYMENT').length,
  )
}

function parsedDraft(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  persisted: PersistedReferences,
): MiniAppRequestRecord {
  const asyncEvidence = input.persistence.type === 'ASYNC'
  const draft = parseBookingDraftV2(input.input, {
    draftId: input.draft.draftId,
    staffId: input.draft.staffId,
    recorderName: input.draft.recorderName,
    lineUserIdHash: input.draft.lineUserIdHash,
    ...input.bookingContext,
    paymentEvidenceFileIds: asyncEvidence ? [] : persisted.payment.map(({ value }) => value),
    chatEvidenceFileIds: asyncEvidence ? [] : persisted.chat.map(({ value }) => value),
    paymentEvidenceObjectKeys: asyncEvidence ? persisted.payment.map(({ value }) => value) : [],
    chatEvidenceObjectKeys: asyncEvidence ? persisted.chat.map(({ value }) => value) : [],
    asyncEvidence,
    now: input.now(),
  })
  if (draft.requestId !== input.draft.requestId || descriptors.length !== draft.evidenceCount) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return draft
}

function exactReadyReplay(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
): PersistedPrepareEvidence {
  if (!isExactReady(input.draft, input, descriptors, bindingHash)) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return {
    ...referencesFromDraft(input.draft, descriptors, input.persistence.type),
    complete: true,
    draft: structuredClone(input.draft),
  }
}

function assertRecoverableDraft(
  draft: MiniAppRequestRecord,
  version: number,
  bindingHash: string,
): void {
  if (draft.state !== 'DRAFT' || draft.payloadHash !== null) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  if (draft.retentionState === '') {
    if (draft.version !== version || draft.evidenceProjectionHash !== null || referenceCountFromDraft(draft) !== 0) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    return
  }
  if (draft.retentionState !== 'PENDING_APPROVAL' || draft.evidenceProjectionHash !== bindingHash) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
}

async function persistAsync(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
): Promise<PersistedReferences> {
  if (input.persistence.type !== 'ASYNC') throw new Error('unreachable')
  const staging = input.persistence.staging
  const existing = asyncExistingReferences(input.draft, descriptors)
  const completed = new Map(existing.map((item) => [item.value, item]))
  const missing = descriptors.filter(({ objectKey }) => !completed.has(objectKey))
  let cursor = 0
  let failure: unknown

  const worker = async () => {
    while (failure === undefined) {
      const item = missing[cursor]
      cursor += 1
      if (!item) return
      try {
        const staged = await staging.put({
          draftId: input.draft.draftId,
          kind: item.kind,
          mimeType: item.mimeType,
          bytes: item.file.bytes,
        })
        if (staged.objectKey !== item.objectKey || staged.size !== item.file.bytes.length
          || staged.contentSha256 !== item.rawContentSha256) throw new Error('INVALID_STAGE_RESULT')
        completed.set(item.objectKey, reference(item, 'STAGED_OBJECT', item.objectKey))
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker))
  const persisted: PersistedReferences = {
    payment: descriptors.filter(({ kind }) => kind === 'PAYMENT').flatMap((item) => {
      const found = completed.get(item.objectKey)
      return found ? [found] : []
    }),
    chat: descriptors.filter(({ kind }) => kind === 'CHAT').flatMap((item) => {
      const found = completed.get(item.objectKey)
      return found ? [found] : []
    }),
  }
  if (failure !== undefined) {
    await persistRecoveryReferences(input, input.draft, persisted, bindingHash, descriptors)
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(persisted))
  }
  return persisted
}

async function persistSync(
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
): Promise<PersistedReferences> {
  if (input.persistence.type !== 'SYNC') throw new Error('unreachable')
  const existing = syncExistingReferences(input.draft, descriptors)
  const paymentCount = descriptors.filter(({ kind }) => kind === 'PAYMENT').length
  const all = [...existing.payment, ...existing.chat]
  for (let index = all.length; index < descriptors.length; index += 1) {
    const item = descriptors[index]!
    try {
      const fileId = await input.persistence.ingress.upload({
        draftId: input.draft.draftId,
        requestId: input.draft.requestId,
        kind: item.kind,
        mimeType: item.mimeType,
        bytes: item.file.bytes,
      })
      if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) throw new Error('INVALID_INGRESS_RESULT')
      all[index] = reference(item, 'DRIVE_FILE', fileId)
    } catch {
      const persisted = splitReferences(all, paymentCount)
      await persistRecoveryReferences(input, input.draft, persisted, bindingHash, descriptors)
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_RETRY', referenceCount(persisted))
    }
  }
  return splitReferences(all, paymentCount)
}

async function persistRecoveryReferences(
  input: PersistPrepareEvidenceInput,
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
  descriptors: readonly EvidenceDescriptor[],
  recoveryAttempt = 0,
): Promise<void> {
  if (draft.evidenceProjectionHash !== null && draft.evidenceProjectionHash !== bindingHash) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  if (draft.state === 'READY_TO_CONFIRM') {
    if (draft.evidenceProjectionHash !== bindingHash) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    const existing = referencesFromDraft(draft, descriptors, input.persistence.type)
    if (!sameReferences(existing, mergePersistedReferences(draft, persisted, descriptors, input.persistence.type))) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    return
  }
  const terminal = draft.state === 'CANCELLED' || draft.state === 'EXPIRED'
  const merged = terminal
    ? mergeTerminalPersistedReferences(draft, persisted, descriptors, input.persistence.type)
    : mergePersistedReferences(draft, persisted, descriptors, input.persistence.type)
  const persistedCount = referenceCount(merged)
  if (persistedCount === 0) return
  if (terminal) {
    await retainTerminalReferences(input, draft, merged, bindingHash, descriptors, recoveryAttempt)
    return
  }
  if (draft.state !== 'DRAFT') throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  if (draft.retentionState === 'PENDING_APPROVAL' && draft.evidenceProjectionHash === bindingHash
    && sameReferences(referencesFromDraftPartial(draft, descriptors, input.persistence.type), merged)) return
  const patch: MiniAppDraftPatch = {
    state: 'DRAFT',
    retentionState: 'PENDING_APPROVAL',
    paymentEvidenceFileIds: input.persistence.type === 'SYNC' ? merged.payment.map(({ value }) => value) : [],
    chatEvidenceFileIds: input.persistence.type === 'SYNC' ? merged.chat.map(({ value }) => value) : [],
    paymentEvidenceObjectKeys: input.persistence.type === 'ASYNC' ? merged.payment.map(({ value }) => value) : [],
    chatEvidenceObjectKeys: input.persistence.type === 'ASYNC' ? merged.chat.map(({ value }) => value) : [],
    evidenceCount: persistedCount,
    evidenceProjectionHash: bindingHash,
    updatedAt: input.now(),
  }
  try {
    await input.store.updateDraft(draft.draftId, draft.version, patch)
  } catch {
    const recovered = await safeReadDraft(input.store, draft.draftId)
    if (!recovered) return
    if (recoveryAttempt >= 2) return
    await persistRecoveryReferences(input, recovered, merged, bindingHash, descriptors, recoveryAttempt + 1)
  }
}

async function retainTerminalReferences(
  input: PersistPrepareEvidenceInput,
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
  descriptors: readonly EvidenceDescriptor[],
  recoveryAttempt: number,
): Promise<void> {
  const mutation = terminalRetentionMutation(input, draft, persisted, bindingHash)
  try { await input.stateIngress.mutate(mutation) } catch { /* authoritative reread below */ }
  const recovered = await safeReadDraft(input.store, draft.draftId)
  if (!recovered) return
  if (recovered.evidenceProjectionHash !== null && recovered.evidenceProjectionHash !== bindingHash) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  const merged = mergeTerminalPersistedReferences(recovered, persisted, descriptors, input.persistence.type)
  if (terminalRetentionAttests(recovered, merged, bindingHash, input.persistence.type)) return
  if (recoveryAttempt >= 2) return
  await persistRecoveryReferences(input, recovered, merged, bindingHash, descriptors, recoveryAttempt + 1)
}

function terminalRetentionMutation(
  input: PersistPrepareEvidenceInput,
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
): MiniAppAsyncStateMutation {
  return {
    operation: 'RETAIN_PREPARE',
    requestId: draft.requestId,
    draftId: draft.draftId,
    payloadHash: bindingHash,
    expectedVersion: draft.version,
    expectedAttempt: draft.attemptCount,
    taskAttempt: 1,
    leaseOwnerToken: null,
    nowIso: input.now(),
    leaseUntil: null,
    taskName: null,
    paymentEvidenceFileIds: input.persistence.type === 'SYNC' ? persisted.payment.map(({ value }) => value) : [],
    chatEvidenceFileIds: input.persistence.type === 'SYNC' ? persisted.chat.map(({ value }) => value) : [],
    paymentEvidenceObjectKeys: input.persistence.type === 'ASYNC' ? persisted.payment.map(({ value }) => value) : [],
    chatEvidenceObjectKeys: input.persistence.type === 'ASYNC' ? persisted.chat.map(({ value }) => value) : [],
    evidenceCount: referenceCount(persisted),
    safeErrorCode: null,
    caseId: null,
    confirmationStatus: null,
  }
}

function mergePersistedReferences(
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  descriptors: readonly EvidenceDescriptor[],
  type: 'ASYNC' | 'SYNC',
): PersistedReferences {
  const existing = referencesFromDraftPartial(draft, descriptors, type)
  if (type === 'ASYNC') {
    const byValue = new Map([...existing.payment, ...existing.chat, ...persisted.payment, ...persisted.chat]
      .map((item) => [item.value, item]))
    return {
      payment: descriptors.filter(({ kind }) => kind === 'PAYMENT').flatMap((item) => {
        const found = byValue.get(item.objectKey)
        return found ? [found] : []
      }),
      chat: descriptors.filter(({ kind }) => kind === 'CHAT').flatMap((item) => {
        const found = byValue.get(item.objectKey)
        return found ? [found] : []
      }),
    }
  }
  return {
    payment: mergeDriveReferences(existing.payment, persisted.payment),
    chat: mergeDriveReferences(existing.chat, persisted.chat),
  }
}

function mergeTerminalPersistedReferences(
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  descriptors: readonly EvidenceDescriptor[],
  type: 'ASYNC' | 'SYNC',
): PersistedReferences {
  if (type === 'ASYNC') {
    if (draft.paymentEvidenceFileIds.length > 0 || draft.chatEvidenceFileIds.length > 0) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    return {
      payment: terminalObjectReferences(
        draft.paymentEvidenceObjectKeys,
        persisted.payment,
        descriptors.filter(({ kind }) => kind === 'PAYMENT'),
      ),
      chat: terminalObjectReferences(
        draft.chatEvidenceObjectKeys,
        persisted.chat,
        descriptors.filter(({ kind }) => kind === 'CHAT'),
      ),
    }
  }
  if (draft.paymentEvidenceObjectKeys.length > 0 || draft.chatEvidenceObjectKeys.length > 0) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return {
    payment: terminalDriveReferences(draft.paymentEvidenceFileIds, persisted.payment, descriptors, 'PAYMENT'),
    chat: terminalDriveReferences(draft.chatEvidenceFileIds, persisted.chat, descriptors, 'CHAT'),
  }
}

function terminalObjectReferences(
  existingValues: readonly string[],
  incoming: readonly EvidenceReference[],
  descriptors: readonly EvidenceDescriptor[],
): EvidenceReference[] {
  const expected = new Map(descriptors.map((item) => [item.objectKey, item]))
  const values = new Set([...existingValues, ...incoming.map(({ value }) => value)])
  for (const value of values) {
    if (!expected.has(value)) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return [...values].sort().map((value) => reference(expected.get(value)!, 'STAGED_OBJECT', value))
}

function terminalDriveReferences(
  existingValues: readonly string[],
  incoming: readonly EvidenceReference[],
  descriptors: readonly EvidenceDescriptor[],
  kind: EvidenceKind,
): EvidenceReference[] {
  const values = [...new Set([...existingValues, ...incoming.map(({ value }) => value)])].sort()
  const candidates = descriptors.filter((item) => item.kind === kind)
  if (values.length > candidates.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return values.map((value, index) => reference(candidates[index]!, 'DRIVE_FILE', value))
}

function terminalRetentionAttests(
  draft: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
  type: 'ASYNC' | 'SYNC',
): boolean {
  if ((draft.state !== 'CANCELLED' && draft.state !== 'EXPIRED')
    || draft.retentionState !== 'PENDING_APPROVAL'
    || draft.evidenceProjectionHash !== bindingHash
    || draft.evidenceCount !== referenceCountFromDraft(draft)) return false
  const payment = type === 'ASYNC' ? draft.paymentEvidenceObjectKeys : draft.paymentEvidenceFileIds
  const chat = type === 'ASYNC' ? draft.chatEvidenceObjectKeys : draft.chatEvidenceFileIds
  return isSetSubset(persisted.payment.map(({ value }) => value), payment)
    && isSetSubset(persisted.chat.map(({ value }) => value), chat)
}

function isSetSubset(values: readonly string[], expected: readonly string[]): boolean {
  const expectedSet = new Set(expected)
  return values.every((value) => expectedSet.has(value))
}

function mergeDriveReferences(
  existing: readonly EvidenceReference[],
  incoming: readonly EvidenceReference[],
): EvidenceReference[] {
  const length = Math.max(existing.length, incoming.length)
  const result: EvidenceReference[] = []
  for (let index = 0; index < length; index += 1) {
    const previous = existing[index]
    const next = incoming[index]
    if (previous && next && previous.value !== next.value) {
      throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
    }
    result[index] = previous ?? next!
  }
  return result
}

function readyPatch(
  parsed: MiniAppRequestRecord,
  persisted: PersistedReferences,
  bindingHash: string,
  updatedAt: string,
): MiniAppDraftPatch {
  return {
    state: 'READY_TO_CONFIRM', retentionState: '', payloadHash: null,
    protocolVersion: 2, recorderName: parsed.recorderName, adminId: parsed.adminId, adminName: parsed.adminName,
    aeId: parsed.aeId, aeName: parsed.aeName, customerName: parsed.customerName, facebookName: parsed.facebookName,
    phoneNormalized: parsed.phoneNormalized, doctorId: parsed.doctorId, serviceId: parsed.serviceId,
    queueType: parsed.queueType, appointmentDate: parsed.appointmentDate, appointmentTime: parsed.appointmentTime,
    depositAmount: parsed.depositAmount, channelId: parsed.channelId,
    paymentEvidenceFileIds: parsed.paymentEvidenceFileIds,
    chatEvidenceFileIds: parsed.chatEvidenceFileIds,
    paymentEvidenceObjectKeys: parsed.paymentEvidenceObjectKeys,
    chatEvidenceObjectKeys: parsed.chatEvidenceObjectKeys,
    evidenceCount: referenceCount(persisted), evidenceProjectionHash: bindingHash, safeErrorCode: null, updatedAt,
  }
}

function isExactReady(
  draft: MiniAppRequestRecord,
  input: PersistPrepareEvidenceInput,
  descriptors: readonly EvidenceDescriptor[],
  bindingHash: string,
): boolean {
  if (draft.state !== 'READY_TO_CONFIRM' || draft.retentionState !== '' || draft.protocolVersion !== 2
    || draft.evidenceProjectionHash !== bindingHash || draft.payloadHash !== null) return false
  let persisted: PersistedReferences
  try { persisted = referencesFromDraft(draft, descriptors, input.persistence.type) } catch { return false }
  let parsed: MiniAppRequestRecord
  try { parsed = parsedDraft({ ...input, draft }, descriptors, persisted) } catch { return false }
  return samePreparedFields(draft, parsed)
}

function samePreparedFields(left: MiniAppRequestRecord, right: MiniAppRequestRecord): boolean {
  return left.requestId === right.requestId && left.draftId === right.draftId && left.staffId === right.staffId
    && left.recorderName === right.recorderName && left.adminId === right.adminId && left.adminName === right.adminName
    && left.aeId === right.aeId && left.aeName === right.aeName && left.customerName === right.customerName
    && left.facebookName === right.facebookName && left.phoneNormalized === right.phoneNormalized
    && left.doctorId === right.doctorId && left.serviceId === right.serviceId && left.queueType === right.queueType
    && left.appointmentDate === right.appointmentDate && left.appointmentTime === right.appointmentTime
    && left.depositAmount === right.depositAmount && left.channelId === right.channelId
    && sameStrings(left.paymentEvidenceFileIds, right.paymentEvidenceFileIds)
    && sameStrings(left.chatEvidenceFileIds, right.chatEvidenceFileIds)
    && sameStrings(left.paymentEvidenceObjectKeys, right.paymentEvidenceObjectKeys)
    && sameStrings(left.chatEvidenceObjectKeys, right.chatEvidenceObjectKeys)
    && left.evidenceCount === right.evidenceCount
}

function asyncExistingReferences(
  draft: MiniAppRequestRecord,
  descriptors: readonly EvidenceDescriptor[],
): EvidenceReference[] {
  if (draft.paymentEvidenceFileIds.length > 0 || draft.chatEvidenceFileIds.length > 0) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  const values = [...draft.paymentEvidenceObjectKeys, ...draft.chatEvidenceObjectKeys]
  if (!isOrderedSubset(values, descriptors.map(({ objectKey }) => objectKey))) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return values.map((value) => {
    const item = descriptors.find(({ objectKey }) => objectKey === value)!
    return reference(item, 'STAGED_OBJECT', value)
  })
}

function syncExistingReferences(
  draft: MiniAppRequestRecord,
  descriptors: readonly EvidenceDescriptor[],
): PersistedReferences {
  if (draft.paymentEvidenceObjectKeys.length > 0 || draft.chatEvidenceObjectKeys.length > 0) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  const paymentDescriptors = descriptors.filter(({ kind }) => kind === 'PAYMENT')
  const chatDescriptors = descriptors.filter(({ kind }) => kind === 'CHAT')
  if (draft.paymentEvidenceFileIds.length > paymentDescriptors.length || draft.chatEvidenceFileIds.length > chatDescriptors.length
    || draft.paymentEvidenceFileIds.length < paymentDescriptors.length && draft.chatEvidenceFileIds.length > 0) {
    throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  }
  return {
    payment: draft.paymentEvidenceFileIds.map((value, index) => reference(paymentDescriptors[index]!, 'DRIVE_FILE', value)),
    chat: draft.chatEvidenceFileIds.map((value, index) => reference(chatDescriptors[index]!, 'DRIVE_FILE', value)),
  }
}

function referencesFromDraft(
  draft: MiniAppRequestRecord,
  descriptors: readonly EvidenceDescriptor[],
  type: 'ASYNC' | 'SYNC',
): PersistedReferences {
  const refs = type === 'ASYNC' ? splitReferences(
    asyncExistingReferences(draft, descriptors),
    draft.paymentEvidenceObjectKeys.length,
  )
    : syncExistingReferences(draft, descriptors)
  if (referenceCount(refs) !== descriptors.length) throw new BookingPreparePersistenceError('BOOKING_PREPARE_CONFLICT')
  return refs
}

function referencesFromDraftPartial(
  draft: MiniAppRequestRecord,
  descriptors: readonly EvidenceDescriptor[],
  type: 'ASYNC' | 'SYNC',
): PersistedReferences {
  return type === 'ASYNC'
    ? splitReferences(asyncExistingReferences(draft, descriptors), draft.paymentEvidenceObjectKeys.length)
    : syncExistingReferences(draft, descriptors)
}

function reference(
  item: EvidenceDescriptor,
  storage: EvidenceReference['storage'],
  value: string,
): EvidenceReference {
  return {
    deterministicUploadId: storage === 'DRIVE_FILE' ? item.driveUploadId : item.stagedUploadId,
    storage,
    value,
    contentSha256: storage === 'DRIVE_FILE' ? item.remoteContentSha256 : item.rawContentSha256,
  }
}

function splitReferences(values: readonly EvidenceReference[], paymentCount: number): PersistedReferences {
  return {
    payment: values.slice(0, paymentCount),
    chat: values.slice(paymentCount),
  }
}

function referenceCount(value: PersistedReferences): number { return value.payment.length + value.chat.length }

function referenceCountFromDraft(draft: MiniAppRequestRecord): number {
  return draft.paymentEvidenceFileIds.length + draft.chatEvidenceFileIds.length
    + draft.paymentEvidenceObjectKeys.length + draft.chatEvidenceObjectKeys.length
}

function sameReferences(left: PersistedReferences, right: PersistedReferences): boolean {
  return sameEvidenceReferenceArray(left.payment, right.payment) && sameEvidenceReferenceArray(left.chat, right.chat)
}

function sameEvidenceReferenceArray(left: readonly EvidenceReference[], right: readonly EvidenceReference[]): boolean {
  return left.length === right.length && left.every((value, index) => value.value === right[index]?.value)
}

function isOrderedSubset(values: readonly string[], expected: readonly string[]): boolean {
  let cursor = 0
  for (const value of values) {
    while (cursor < expected.length && expected[cursor] !== value) cursor += 1
    if (cursor >= expected.length) return false
    cursor += 1
  }
  return true
}

async function safeReadDraft(
  store: Pick<MiniAppStore, 'getDraft'>,
  draftId: string,
): Promise<MiniAppRequestRecord | null> {
  try { return await store.getDraft(draftId) } catch { return null }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
