import type { BookingPorts } from '../ports'

const NINETY_DAYS_MS = 90 * 86_400_000

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
    ports.repositories.retention.queue({
      id: `RETENTION-${booking.caseId}`,
      caseId: booking.caseId,
      driveFolderId: booking.driveFolderId,
      eligibleAt: new Date(eligibleAt).toISOString(),
      status: 'PENDING',
      approvedBy: '',
      approvedAt: '',
      reason: '',
      version: 1,
    })
  }
}

export function approveEvidenceDeletion(
  retentionId: string,
  approver: string,
  reason: string,
  ports: BookingPorts,
): void {
  if (!approver.trim() || !reason.trim()) throw new Error('retention approval identity and reason are required')
  const approved = ports.repositories.retention.approve(retentionId, approver, reason)
  const caseId = String(approved.caseId)
  const folderId = String(approved.driveFolderId)
  ports.drive.trashFolder(folderId)
  ports.repositories.audit.append({
    eventId: `AUDIT-${retentionId}-APPROVED`,
    caseId,
    actor: approver,
    action: 'EVIDENCE_TRASHED',
    target: folderId,
    before: { status: 'PENDING' },
    after: { status: 'APPROVED' },
    reason,
    timestamp: ports.clock.nowIso(),
    correlationId: retentionId,
  })
}
