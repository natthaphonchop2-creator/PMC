import { describe, expect, it } from 'vitest'
import { buildDashboardSnapshot, writeDashboard } from '../src/workflows/dashboard'
import { createDailyBackup, runIntegrityReport } from '../src/workflows/integrity'
import { approveEvidenceDeletion, queueEvidenceRetention } from '../src/workflows/retention'
import { bookingFixture, createTestPorts } from './helpers/fakes'

describe('dashboard and controls', () => {
  it('derives management metrics without raw PII', () => {
    const snapshot = buildDashboardSnapshot(
      [
        bookingFixture({ status: 'BOOKING_CONFIRMED', depositAmount: 1000 }),
        bookingFixture({ caseId: 'PMC-202608-0002', formResponseId: 'response-2', status: 'CLOSED_JERA', depositAmount: 2000 }),
      ],
      [],
    )
    expect(snapshot.kpis).toMatchObject({ bookings: 2, deposits: 3000, closedJera: 1 })
    expect(snapshot.operations[0].channelId).toBeNull()
    expect(snapshot.operations[0]).toMatchObject({ adminId: 'admin-1', aeId: 'staff-ae' })
    expect(JSON.stringify(snapshot)).not.toContain('0812345678')
  })

  it('writes only the sanitized dashboard snapshot', () => {
    const ports = createTestPorts()
    ports.bookings.insert(ports.bookingFixture())
    writeDashboard(ports)
    expect(ports.dashboard.lastSnapshot()?.kpis.bookings).toBe(1)
    expect(JSON.stringify(ports.dashboard.lastSnapshot())).not.toContain('0812345678')
  })

  it('creates at most one backup per Bangkok day', () => {
    const ports = createTestPorts()
    createDailyBackup(ports)
    createDailyBackup(ports)
    expect(ports.backups.createdDates()).toEqual(['2026-08-20'])
  })

  it('finds closed cases with active call tasks and duplicate JERA IDs', () => {
    const ports = createTestPorts()
    ports.seedIntegrityFailures()
    const report = runIntegrityReport(ports)
    expect(report.codes).toEqual(expect.arrayContaining(['CLOSED_WITH_ACTIVE_CALL', 'DUPLICATE_JERA_PAYMENT_ID']))
  })

  it('queues evidence after 90 days but never deletes without approval', () => {
    const ports = createTestPorts({ now: '2026-11-19T09:00:00+07:00' })
    ports.bookings.insert(
      ports.bookingFixture({
        status: 'CLOSED_JERA',
        jeraClosedAt: '2026-08-20T09:00:00+07:00',
        driveFolderId: 'folder-3',
      }),
    )
    queueEvidenceRetention(ports)
    expect(ports.retention.pending()).toHaveLength(1)
    expect(ports.drive.trashedFolderIds()).toEqual([])
  })

  it('records manager approval without deleting evidence', () => {
    const ports = createTestPorts({ now: '2026-11-19T09:00:00+07:00' })
    ports.bookings.insert(
      ports.bookingFixture({
        status: 'CLOSED_JERA',
        jeraClosedAt: '2026-08-20T09:00:00+07:00',
        driveFolderId: 'folder-3',
      }),
    )
    queueEvidenceRetention(ports)
    const item = ports.retention.pending()[0]
    approveEvidenceDeletion(String(item.id), 'manager@example.com', 'retention policy', ports)
    expect(ports.drive.trashedFolderIds()).toEqual([])
    expect(ports.retention.get(String(item.id))).toMatchObject({ status: 'APPROVED' })
    expect(ports.repositories.audit.listForCase('PMC-202608-0001')).toHaveLength(1)
  })
})
