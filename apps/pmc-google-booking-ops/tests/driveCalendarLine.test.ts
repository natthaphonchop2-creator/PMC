import { describe, expect, it } from 'vitest'
import { ensureCaseEvidenceFolder } from '../src/adapters/googleDrive'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { rescheduleBooking } from '../src/workflows/bookingUpdate'
import { bookingFixture, createFakeDrive, createTestPorts, validBookingIntake } from './helpers/fakes'

describe('Drive evidence', () => {
  it('creates year, month, and customer-case folders with deterministic filenames', () => {
    const drive = createFakeDrive()
    const result = ensureCaseEvidenceFolder(bookingFixture(), validBookingIntake({ chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'] }), drive)
    expect(result.path).toBe('PMC Bookings/2026/08/ลูกค้าทดสอบ - PMC-202608-0001')
    expect(result.renamedFiles).toEqual([
      'PMC-202608-0001_PAYMENT_01.jpg',
      'PMC-202608-0001_CHAT_01.jpg',
      'PMC-202608-0001_CHAT_02.png',
    ])
  })

  it('reuses the existing folder and evidence files on retry', () => {
    const drive = createFakeDrive()
    const intake = validBookingIntake()
    const first = ensureCaseEvidenceFolder(bookingFixture(), intake, drive)
    const second = ensureCaseEvidenceFolder(bookingFixture({ driveFolderId: first.folderId }), intake, drive)
    expect(second.folderId).toBe(first.folderId)
    expect(drive.createdFolderCount()).toBe(3)
    expect(drive.movedFileCount()).toBe(2)
  })

  it('never creates public sharing', () => {
    const drive = createFakeDrive()
    ensureCaseEvidenceFolder(bookingFixture(), validBookingIntake(), drive)
    expect(drive.publicLinks()).toEqual([])
  })

  it('persists Drive completion on the canonical case', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.driveFolderId).toBe('folder-3')
    expect(result.driveState).toBe('OK')
    expect(ports.bookings.getByCaseId(result.caseId)?.driveFolderId).toBe('folder-3')
  })
})

describe('doctor Calendar', () => {
  it('sets TIME_CONFLICT and creates no event when the interval overlaps', () => {
    const ports = createTestPorts({ calendarConflicts: true })
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.status).toBe('TIME_CONFLICT')
    expect(result.calendarState).toBe('CONFLICT')
    expect(ports.calendar.createdEvents()).toHaveLength(0)
  })

  it('creates one event with Case ID and safe customer fields', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.calendarEventId).toBe('event-PMC-202608-0001')
    expect(ports.calendar.createdEvents()[0]).toMatchObject({
      calendarId: 'doctor-calendar-1',
      externalId: 'PMC-202608-0001',
    })
    expect(JSON.stringify(ports.calendar.createdEvents()[0])).not.toContain('0812345678')
  })

  it('patches the same event on reschedule', () => {
    const ports = createTestPorts()
    const booking = submitBookingIntake(validBookingIntake(), ports)
    const updated = rescheduleBooking(
      booking.caseId,
      { appointmentStart: '2026-08-21T14:00:00+07:00', reason: 'customer requested' },
      ports,
    )
    expect(updated.appointmentStart).toBe('2026-08-21T14:00:00+07:00')
    expect(updated.appointmentEnd).toBe('2026-08-21T15:00:00+07:00')
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.calendar.updatedEvents()).toHaveLength(1)
  })
})
