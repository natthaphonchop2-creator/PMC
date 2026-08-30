import {
  migrationSnapshotFingerprint,
  planBookingAttributionMigration,
  verifyBookingAttributionMigrationReadback,
  type ApplyBookingAttributionMigrationPlan,
  type AttributionMigrationSheetSnapshot,
  type BookingAttributionMigrationPlan,
} from '../domain/attributionMigration'

export interface QueueGatePort {
  state(): 'PAUSED' | 'RUNNING'
  activeTaskCount(): number
}

export interface BookingAttributionMigrationPorts {
  queueGate: QueueGatePort
  readSnapshot(): AttributionMigrationSheetSnapshot
  withLock<T>(operation: () => T): T
  createPrivateNativeBackup(preflightFingerprint: string): void
  writeMigration(plan: ApplyBookingAttributionMigrationPlan): void
}

export type BookingAttributionMigrationResult = {
  backupCreated: boolean
  requestRowsMigrated: number
  bookingRowsMigrated: number
  readbackVerified: true
  preflightFingerprint: string
}

export function previewBookingAttributionMigration(
  ports: BookingAttributionMigrationPorts,
): BookingAttributionMigrationPlan {
  return planBookingAttributionMigration(readPreflightSnapshot(ports))
}

export function applyBookingAttributionMigration(
  ports: BookingAttributionMigrationPorts,
): BookingAttributionMigrationResult {
  const first = readPreflightSnapshot(ports)
  const firstPlan = planBookingAttributionMigration(first)
  if (firstPlan.kind === 'NONE') {
    return {
      backupCreated: false,
      requestRowsMigrated: 0,
      bookingRowsMigrated: 0,
      readbackVerified: true,
      preflightFingerprint: firstPlan.preflightFingerprint,
    }
  }

  return ports.withLock(() => {
    const locked = readPreflightSnapshot(ports)
    if (migrationSnapshotFingerprint(locked) !== firstPlan.preflightFingerprint) {
      throw new Error('MIGRATION_FINGERPRINT_CHANGED')
    }
    const lockedPlan = planBookingAttributionMigration(locked)
    if (lockedPlan.kind !== 'MIGRATE') throw new Error('MIGRATION_FINGERPRINT_CHANGED')
    ports.createPrivateNativeBackup(lockedPlan.preflightFingerprint)
    ports.writeMigration(lockedPlan)
    const readback = ports.readSnapshot()
    verifyBookingAttributionMigrationReadback(lockedPlan, readback)
    return {
      backupCreated: true,
      requestRowsMigrated: lockedPlan.requestRowsMigrated,
      bookingRowsMigrated: lockedPlan.bookingRowsMigrated,
      readbackVerified: true,
      preflightFingerprint: lockedPlan.preflightFingerprint,
    }
  })
}

function readPreflightSnapshot(ports: BookingAttributionMigrationPorts): AttributionMigrationSheetSnapshot {
  const queueState = ports.queueGate.state()
  const activeTaskCount = ports.queueGate.activeTaskCount()
  return { ...ports.readSnapshot(), queueState, activeTaskCount }
}
