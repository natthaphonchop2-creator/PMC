import type { BookingPorts } from '../ports'
import { createRetentionManifest, type RetentionRecordV2 } from '../../../../shared/pmcMiniAppDraftRetention'

const NINETY_DAYS_MS = 90 * 86_400_000
const HOUR_MS = 3_600_000

function terminalTimestamp(status: string, jeraClosedAt: string | null, updatedAt: string): string | null {
  if (status === 'CLOSED_JERA') return jeraClosedAt
  if (status === 'REFUNDED' || status === 'EXPIRED_6M') return updatedAt
  return null
}

export function queueEvidenceRetention(ports: BookingPorts): void {
  const now = Date.parse(ports.clock.nowIso())
  for (const booking of ports.repositories.bookings.list()) {
    const terminalAt = terminalTimestamp(booking.status, booking.jeraClosedAt, booking.updatedAt)
    if (!terminalAt || !booking.driveFolderId || ports.repositories.retention.hasCase(booking.caseId)) continue
    const eligibleAt = Date.parse(terminalAt) + NINETY_DAYS_MS
    if (now < eligibleAt) continue
    ports.locks.withLock(() => {
      const manifest = createRetentionManifest([
        { storage: 'CASE_FOLDER', folderId: booking.driveFolderId! },
      ], ports.crypto.sha256Hex)
      const record: RetentionRecordV2 = {
        id: `RETENTION-${booking.caseId}`, scope: 'CASE_FOLDER', caseId: booking.caseId, draftId: null,
        trigger: 'CASE_TERMINAL', eligibleAt: new Date(eligibleAt).toISOString(), status: 'PENDING',
        ...manifest, approvedBy: '', approvedAt: '', reason: '', cleanupAttemptCount: 0,
        cleanupClaimId: '', cleanupLeaseUntil: '', cleanedAt: '', safeErrorCode: '', version: 1,
      }
      ports.repositories.retention.upsert(record, 0)
    })
  }
}

export function reconcileAndExpireDraftEvidenceRetention(ports: BookingPorts): {
  expired: number
  repaired: number
} {
  const rawTtl = ports.config.ruleValue('MINI_APP_DRAFT_TTL_HOURS')
  if (!rawTtl || !/^\d+$/.test(rawTtl)) throw new Error('MINI_APP_DRAFT_TTL_HOURS_REQUIRED')
  const ttlHours = Number(rawTtl)
  if (!Number.isSafeInteger(ttlHours) || ttlHours < 1 || ttlHours > 720) {
    throw new Error('MINI_APP_DRAFT_TTL_HOURS_INVALID')
  }
  const nowIso = ports.clock.nowIso()
  const now = Date.parse(nowIso)
  let expired = 0
  let repaired = 0
  const list = ports.miniAppRequests.list
  if (!list) throw new Error('MINI_APP_REQUEST_LIST_UNAVAILABLE')
  for (const snapshot of list()) {
    if (!('protocolVersion' in snapshot) || snapshot.protocolVersion !== 2 || !hasDraftEvidence(snapshot)) continue
    ports.locks.withLock(() => {
      const current = ports.miniAppRequests.getByRequestId(snapshot.requestId)
      if (!current || !('protocolVersion' in current) || current.protocolVersion !== 2
        || current.draftId !== snapshot.draftId) return
      const retention = ports.repositories.retention.getByDraftId(current.draftId)
      if (!retention) throw new Error('DRAFT_RETENTION_RECONCILIATION_REQUIRED')
      if (current.state === 'CONFIRMED' || current.state === 'CONFIRMED_WITH_RETRY') {
        if (retention.status !== 'PROMOTED') {
          transitionRetention(current.draftId, 'PROMOTED', 'DAILY_RECONCILE_CONFIRMED', ports); repaired += 1
        }
        return
      }
      if (current.state === 'CANCELLED' || current.state === 'EXPIRED') {
        if (retention.status !== 'PENDING') {
          transitionRetention(current.draftId, 'PENDING', 'DAILY_RECONCILE_TERMINAL', ports); repaired += 1
        }
        return
      }
      if (current.state !== 'DRAFT' && current.state !== 'READY_TO_CONFIRM') return
      if (now - Date.parse(current.updatedAt) < ttlHours * HOUR_MS) return
      transitionRetention(current.draftId, 'PENDING', 'DRAFT_TTL_EXPIRED', ports)
      ports.miniAppRequests.updateByRequestId(current.requestId, current.version, {
        ...current, state: 'EXPIRED', retentionState: 'PENDING_APPROVAL',
        version: current.version + 1, updatedAt: nowIso,
      })
      expired += 1
    })
  }
  return { expired, repaired }
}

export function approveEvidenceDeletion(
  retentionId: string,
  approver: string,
  reason: string,
  ports: BookingPorts,
): void {
  if (!approver.trim() || !reason.trim()) throw new Error('retention approval identity and reason are required')
  const approved = ports.locks.withLock(() => {
    const current = ports.repositories.retention.get(retentionId)
    if (!current || current.status !== 'PENDING') throw new Error('retention item not found')
    return ports.repositories.retention.setStatus(retentionId, current.version, 'APPROVED', {
      approvedBy: approver, approvedAt: ports.clock.nowIso(), reason,
    })
  })
  const caseId = String(approved.caseId ?? '')
  ports.repositories.audit.append({
    eventId: `AUDIT-${retentionId}-APPROVED`,
    caseId,
    actor: approver,
    action: 'EVIDENCE_RETENTION_APPROVED',
    target: retentionId,
    before: { status: 'PENDING' },
    after: { status: approved.status },
    reason,
    timestamp: ports.clock.nowIso(),
    correlationId: retentionId,
  })
}

function hasDraftEvidence(record: {
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
  paymentEvidenceObjectKeys: string[]
  chatEvidenceObjectKeys: string[]
}): boolean {
  return record.paymentEvidenceFileIds.length + record.chatEvidenceFileIds.length
    + record.paymentEvidenceObjectKeys.length + record.chatEvidenceObjectKeys.length > 0
}

function transitionRetention(
  draftId: string,
  status: 'PENDING' | 'PROMOTED',
  trigger: string,
  ports: BookingPorts,
): void {
  const current = ports.repositories.retention.getByDraftId(draftId)
  if (!current || current.status === status && current.trigger === trigger) return
  ports.repositories.retention.upsert({
    ...current, status, trigger, approvedBy: '', approvedAt: '', reason: '', cleanupClaimId: '',
    cleanupLeaseUntil: '', cleanedAt: '', safeErrorCode: '', version: current.version + 1,
  }, current.version)
}
