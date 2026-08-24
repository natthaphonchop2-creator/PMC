import { describe, expect, it } from 'vitest'
import { migrateAppointmentRows } from '../src/domain/appointmentMigration'
import { bookingFixture } from './helpers/fakes'

describe('appointment row migration', () => {
  it('backfills existing Calendar bookings without changing external references', () => {
    const previous = bookingFixture({
      calendarEventId: 'event-1',
      driveFolderId: 'folder-1',
    }) as unknown as Record<string, unknown>
    delete previous.queueType
    delete previous.appointmentStatus
    delete previous.appointmentProposedAt
    delete previous.appointmentConfirmedAt
    delete previous.appointmentConfirmedBy

    const [migrated] = migrateAppointmentRows([previous])

    expect(migrated).toMatchObject({
      queueType: 'NORMAL',
      appointmentStatus: 'CONFIRMED',
      appointmentProposedAt: null,
      appointmentConfirmedAt: null,
      appointmentConfirmedBy: null,
      calendarEventId: 'event-1',
      driveFolderId: 'folder-1',
      caseId: 'PMC-202608-0001',
    })
  })

  it('backfills a row without Calendar as awaiting Admin without inventing a date', () => {
    const previous = bookingFixture({
      calendarEventId: null,
      appointmentStart: null,
      appointmentEnd: null,
    }) as unknown as Record<string, unknown>
    delete previous.queueType
    delete previous.appointmentStatus
    expect(migrateAppointmentRows([previous])[0]).toMatchObject({
      queueType: 'NORMAL',
      appointmentStatus: 'AWAITING_ADMIN_SLOT',
      appointmentStart: null,
      appointmentEnd: null,
    })
  })
})
