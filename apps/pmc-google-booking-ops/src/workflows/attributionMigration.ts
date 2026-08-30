import {
  TARGET_BOOKING_MASTER_HEADERS,
  TARGET_MINI_APP_REQUEST_HEADERS,
  migrationSnapshotFingerprint,
  planBookingAttributionMigration,
  verifyBookingAttributionMigrationReadback,
  type ApplyBookingAttributionMigrationPlan,
  type AttributionMigrationSheetSnapshot,
  type BookingAttributionMigrationPlan,
} from '../domain/attributionMigration'
import type {
  BookingMigrationManifest,
  BookingMigrationManifestPayload,
  BookingQueueAttestation,
} from '../domain/attributionMigrationState'
import { isReservedAttributionOption } from '../domain/staffDirectory'

export interface QueueGatePort {
  readAttestation(): BookingQueueAttestation
}

export interface BookingMigrationManifestPort {
  read(): BookingMigrationManifest | null
  createPrepared(payload: BookingMigrationManifestPayload): BookingMigrationManifest
  replaceExpected(
    expectedDigest: string,
    payload: BookingMigrationManifestPayload,
  ): BookingMigrationManifest
}

export interface VerifiedBookingMigrationBackup {
  fileId: string
  mimeType: 'application/vnd.google-apps.spreadsheet'
  parentId: string
  sourceFingerprint: string
}

export interface BookingAttributionMigrationPorts {
  queueGate: QueueGatePort
  manifest: BookingMigrationManifestPort
  readSnapshot(): AttributionMigrationSheetSnapshot
  withLock<T>(operation: () => T): T
  createAndVerifyPrivateNativeBackup(sourceFingerprint: string): VerifiedBookingMigrationBackup
  writeMigration(plan: ApplyBookingAttributionMigrationPlan): void
  nowIso(): string
  sha256(value: string): string
  /** Test-only fault boundary; production omits it. */
  beforeComplete?(): void
}

export type BookingAttributionMigrationResult =
  | { status: 'COMPLETE'; readbackVerified: true }
  | { status: 'RESTORE_REQUIRED'; readbackVerified: false }

export function previewBookingAttributionMigration(
  ports: BookingAttributionMigrationPorts,
): BookingAttributionMigrationPlan | { kind: 'RESTORE_REQUIRED' } {
  const manifest = ports.manifest.read()
  if (manifest?.state === 'PREPARED' || manifest?.state === 'RESTORE_REQUIRED') {
    return { kind: 'RESTORE_REQUIRED' }
  }
  if (manifest?.state === 'COMPLETE') {
    const snapshot = ports.readSnapshot()
    verifyCompletedManifest(manifest, snapshot)
    return planBookingAttributionMigration(snapshot)
  }
  const { snapshot } = readPreflightSnapshot(ports)
  const plan = planBookingAttributionMigration(snapshot)
  requireManifestForExistingTarget(plan, snapshot)
  return plan
}

export function applyBookingAttributionMigration(
  ports: BookingAttributionMigrationPorts,
): BookingAttributionMigrationResult {
  const existing = ports.manifest.read()
  if (existing?.state === 'PREPARED' || existing?.state === 'RESTORE_REQUIRED') {
    return restoreRequiredResult()
  }
  if (existing?.state === 'COMPLETE') {
    try {
      verifyCompletedManifest(existing, ports.readSnapshot())
      return completeResult()
    } catch (error) {
      return markCompletedManifestRestoreRequired(ports, error)
    }
  }

  const first = readPreflightSnapshot(ports)
  const firstPlan = planBookingAttributionMigration(first.snapshot)
  requireManifestForExistingTarget(firstPlan, first.snapshot)
  if (firstPlan.kind === 'NONE') return completeResult()

  return ports.withLock(() => {
    const lockedManifest = ports.manifest.read()
    if (lockedManifest?.state === 'PREPARED' || lockedManifest?.state === 'RESTORE_REQUIRED') {
      return restoreRequiredResult()
    }
    if (lockedManifest?.state === 'COMPLETE') {
      verifyCompletedManifest(lockedManifest, ports.readSnapshot())
      return completeResult()
    }
    const locked = readPreflightSnapshot(ports)
    if (migrationSnapshotFingerprint(locked.snapshot) !== firstPlan.preflightFingerprint) {
      throw new Error('MIGRATION_FINGERPRINT_CHANGED')
    }
    const lockedPlan = planBookingAttributionMigration(locked.snapshot)
    if (lockedPlan.kind !== 'MIGRATE') throw new Error('MIGRATION_FINGERPRINT_CHANGED')
    validatePlannedTargetRows(lockedPlan, locked.snapshot)
    const backup = ports.createAndVerifyPrivateNativeBackup(lockedPlan.preflightFingerprint)
    requireVerifiedBackup(backup, lockedPlan.preflightFingerprint)
    const preparedPayload = preparedManifestPayload(
      lockedPlan,
      backup,
      locked.attestation,
      ports.nowIso(),
    )

    try {
      const prepared = ports.manifest.createPrepared(preparedPayload)
      ports.writeMigration(lockedPlan)
      const readback = ports.readSnapshot()
      verifyBookingAttributionMigrationReadback(lockedPlan, readback)
      validateTargetRows(readback)
      ports.beforeComplete?.()
      ports.manifest.replaceExpected(prepared.digest, {
        ...preparedPayload,
        state: 'COMPLETE',
        updatedAt: ports.nowIso(),
        completedAt: ports.nowIso(),
        safeFailureCode: null,
      })
      return completeResult()
    } catch (error) {
      return handlePostBackupFailure(ports, error)
    }
  })
}

function validatePlannedTargetRows(
  plan: ApplyBookingAttributionMigrationPlan,
  source: AttributionMigrationSheetSnapshot,
): void {
  validateTargetRows({
    ...source,
    request: {
      ...source.request,
      headers: [...TARGET_MINI_APP_REQUEST_HEADERS],
      rows: plan.requestRows,
    },
    master: {
      ...source.master,
      headers: [...TARGET_BOOKING_MASTER_HEADERS],
      rows: plan.masterRows,
    },
  })
}

function markCompletedManifestRestoreRequired(
  ports: BookingAttributionMigrationPorts,
  error: unknown,
): BookingAttributionMigrationResult {
  return ports.withLock(() => {
    const current = ports.manifest.read()
    if (current?.state === 'PREPARED' || current?.state === 'RESTORE_REQUIRED') {
      return restoreRequiredResult()
    }
    if (current?.state !== 'COMPLETE') throw safeMigrationError(error)
    try {
      verifyCompletedManifest(current, ports.readSnapshot())
      return completeResult()
    } catch (lockedError) {
      try {
        ports.manifest.replaceExpected(current.digest, {
          ...withoutDigest(current),
          state: 'RESTORE_REQUIRED',
          updatedAt: ports.nowIso(),
          completedAt: null,
          safeFailureCode: safeFailureCode(lockedError),
        })
      } catch {
        // A mismatched COMPLETE remains fail-closed even if the conservative state write fails.
      }
      return restoreRequiredResult()
    }
  })
}

function readPreflightSnapshot(ports: BookingAttributionMigrationPorts): {
  attestation: BookingQueueAttestation
  snapshot: AttributionMigrationSheetSnapshot
} {
  const attestation = ports.queueGate.readAttestation()
  return {
    attestation,
    snapshot: {
      ...ports.readSnapshot(),
      queueState: attestation.state,
      activeTaskCount: attestation.activeTaskCount,
    },
  }
}

function requireManifestForExistingTarget(
  plan: BookingAttributionMigrationPlan,
  snapshot: AttributionMigrationSheetSnapshot,
): void {
  const requestTarget = sameHeader(snapshot.request.headers, TARGET_MINI_APP_REQUEST_HEADERS)
  const masterTarget = sameHeader(snapshot.master.headers, TARGET_BOOKING_MASTER_HEADERS)
  const nonempty = snapshot.request.rows.length > 0 || snapshot.master.rows.length > 0
  if (nonempty && (requestTarget || masterTarget)) throw new Error('UNMANIFESTED_PARTIAL_TARGET')
  if (plan.kind === 'NONE' && nonempty) throw new Error('UNMANIFESTED_PARTIAL_TARGET')
}

function preparedManifestPayload(
  plan: ApplyBookingAttributionMigrationPlan,
  backup: VerifiedBookingMigrationBackup,
  attestation: BookingQueueAttestation,
  nowIso: string,
): BookingMigrationManifestPayload {
  return {
    version: 1,
    migration: 'PMC_BOOKING_ATTRIBUTION_V2',
    state: 'PREPARED',
    sourceFingerprint: plan.preflightFingerprint,
    backupFileId: backup.fileId,
    backupMimeType: backup.mimeType,
    backupParentId: backup.parentId,
    backupSourceFingerprint: backup.sourceFingerprint,
    expected: {
      requestHeaderHash: plan.requestHeaderHash,
      masterHeaderHash: plan.masterHeaderHash,
      requestValueHash: plan.requestValueHash,
      masterValueHash: plan.masterValueHash,
      requestNonTargetValueHash: plan.requestNonTargetValueHash,
      masterNonTargetValueHash: plan.masterNonTargetValueHash,
      requestPreservationHash: plan.requestPreservationFingerprint,
      masterPreservationHash: plan.masterPreservationFingerprint,
    },
    requestRowCount: plan.requestRows.length,
    masterRowCount: plan.masterRows.length,
    queueAttestationDigest: attestation.digest,
    preparedAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    safeFailureCode: null,
  }
}

function handlePostBackupFailure(
  ports: BookingAttributionMigrationPorts,
  error: unknown,
): BookingAttributionMigrationResult {
  const current = ports.manifest.read()
  if (current?.state === 'COMPLETE') return completeResult()
  if (current?.state === 'RESTORE_REQUIRED') return restoreRequiredResult()
  if (current?.state !== 'PREPARED') throw safeMigrationError(error)
  try {
    ports.manifest.replaceExpected(current.digest, {
      ...withoutDigest(current),
      state: 'RESTORE_REQUIRED',
      updatedAt: ports.nowIso(),
      completedAt: null,
      safeFailureCode: safeFailureCode(error),
    })
  } catch {
    // A valid PREPARED value remains fail-closed if the conservative transition cannot persist.
  }
  return restoreRequiredResult()
}

function verifyCompletedManifest(
  manifest: BookingMigrationManifest,
  snapshot: AttributionMigrationSheetSnapshot,
): void {
  if (manifest.state !== 'COMPLETE'
    || !sameHeader(snapshot.request.headers, TARGET_MINI_APP_REQUEST_HEADERS)
    || !sameHeader(snapshot.master.headers, TARGET_BOOKING_MASTER_HEADERS)
    || snapshot.request.rows.length < manifest.requestRowCount
    || snapshot.master.rows.length < manifest.masterRowCount) {
    throw new Error('COMPLETE_MANIFEST_READBACK_MISMATCH')
  }
  const prefix: AttributionMigrationSheetSnapshot = {
    ...snapshot,
    request: { ...snapshot.request, rows: snapshot.request.rows.slice(0, manifest.requestRowCount) },
    master: { ...snapshot.master, rows: snapshot.master.rows.slice(0, manifest.masterRowCount) },
    queueState: 'PAUSED',
    activeTaskCount: 0,
  }
  const plan = planBookingAttributionMigration(prefix)
  if (plan.kind !== 'NONE'
    || plan.requestHeaderHash !== manifest.expected.requestHeaderHash
    || plan.masterHeaderHash !== manifest.expected.masterHeaderHash
    || plan.requestValueHash !== manifest.expected.requestValueHash
    || plan.masterValueHash !== manifest.expected.masterValueHash
    || plan.requestNonTargetValueHash !== manifest.expected.requestNonTargetValueHash
    || plan.masterNonTargetValueHash !== manifest.expected.masterNonTargetValueHash
    || plan.requestPreservationFingerprint !== manifest.expected.requestPreservationHash
    || plan.masterPreservationFingerprint !== manifest.expected.masterPreservationHash) {
    throw new Error('COMPLETE_MANIFEST_READBACK_MISMATCH')
  }
  validateTargetRows(snapshot)
}

function validateTargetRows(snapshot: AttributionMigrationSheetSnapshot): void {
  const requestStaffIdIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('staffId')
  const requestProtocolIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('protocolVersion')
  const requestStateIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('state')
  const requestPayloadHashIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('payloadHash')
  const requestRecorderIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('recorderName')
  const requestAdminIdIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('adminId')
  const requestAdminNameIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('adminName')
  const requestAeIdIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('aeId')
  const requestAeNameIndex = TARGET_MINI_APP_REQUEST_HEADERS.indexOf('aeName')
  for (const row of snapshot.request.rows) {
    const protocol = Number(row[requestProtocolIndex])
    const recorder = { id: text(row[requestStaffIdIndex]), name: text(row[requestRecorderIndex]) }
    const admin = { id: text(row[requestAdminIdIndex]), name: text(row[requestAdminNameIndex]) }
    const ae = { id: text(row[requestAeIdIndex]), name: text(row[requestAeNameIndex]) }
    const mayOmitAdmin = protocol === 2
      && ['DRAFT', 'UPLOADING', 'CANCELLED', 'EXPIRED'].includes(text(row[requestStateIndex]))
      && text(row[requestPayloadHashIndex]) === ''
    const validAdmin = mayOmitAdmin && admin.id === '' && admin.name === ''
      || Boolean(admin.id && admin.name && !isReservedAttributionOption(admin))
    if ((protocol !== 1 && protocol !== 2)
      || !recorder.id || !recorder.name || isReservedAttributionOption(recorder)
      || !validAdmin
      || ae.id === '' && ae.name !== '' && ae.name !== 'ไม่ระบุ'
      || ae.id !== '' && (!ae.name || isReservedAttributionOption(ae))) {
      throw new Error('COMPLETE_MANIFEST_READBACK_MISMATCH')
    }
  }
  const sourceIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('recorderSource')
  const recorderIdIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('recorderId')
  const recorderNameIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('recorderName')
  const adminIdIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('adminId')
  const adminNameIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('adminName')
  const aeIdIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('aeId')
  const aeNameIndex = TARGET_BOOKING_MASTER_HEADERS.indexOf('aeName')
  for (const row of snapshot.master.rows) {
    const source = text(row[sourceIndex])
    const recorderId = text(row[recorderIdIndex])
    const recorderName = text(row[recorderNameIndex])
    const admin = { id: text(row[adminIdIndex]), name: text(row[adminNameIndex]) }
    const ae = { id: text(row[aeIdIndex]), name: text(row[aeNameIndex]) }
    if (!['VERIFIED_LINE', 'LEGACY_ASSUMED_ADMIN', 'FORM_EMAIL_MATCH', 'FORM_UNRESOLVED'].includes(source)
      || source === 'FORM_UNRESOLVED' && (recorderId !== '' || recorderName !== 'Google Form')
      || source !== 'FORM_UNRESOLVED' && (!recorderId || !recorderName)
      || source !== 'FORM_UNRESOLVED' && isReservedAttributionOption({ id: recorderId, name: recorderName })
      || !admin.id || !admin.name || isReservedAttributionOption(admin)
      || source === 'LEGACY_ASSUMED_ADMIN' && (recorderId !== admin.id || recorderName !== admin.name)
      || ae.id === '' && ae.name !== '' && ae.name !== 'ไม่ระบุ'
      || ae.id !== '' && (!ae.name || isReservedAttributionOption(ae))) {
      throw new Error('COMPLETE_MANIFEST_READBACK_MISMATCH')
    }
  }
}

function requireVerifiedBackup(backup: VerifiedBookingMigrationBackup, sourceFingerprint: string): void {
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(backup.fileId)
    || backup.mimeType !== 'application/vnd.google-apps.spreadsheet'
    || !/^[A-Za-z0-9_-]{8,256}$/.test(backup.parentId)
    || backup.sourceFingerprint !== sourceFingerprint) {
    throw new Error('MIGRATION_BACKUP_VERIFICATION_FAILED')
  }
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z0-9_]{1,80}$/.test(message) ? message : 'MIGRATION_APPLY_FAILED'
}

function safeMigrationError(error: unknown): Error {
  return new Error(safeFailureCode(error))
}

function withoutDigest(manifest: BookingMigrationManifest): BookingMigrationManifestPayload {
  const { digest: _digest, ...payload } = manifest
  return { ...payload, expected: { ...payload.expected } }
}

function completeResult(): BookingAttributionMigrationResult {
  return { status: 'COMPLETE', readbackVerified: true }
}

function restoreRequiredResult(): BookingAttributionMigrationResult {
  return { status: 'RESTORE_REQUIRED', readbackVerified: false }
}

function sameHeader(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}
