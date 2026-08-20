import { describe, expect, it } from 'vitest'
import { ensureCaseEvidenceFolder } from '../src/adapters/googleDrive'
import {
  adminBookingMessage,
  doctorBookingMessage,
  handleLineDirectoryIngress,
} from '../src/adapters/lineMessaging'
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

describe('LINE routing', () => {
  const evidence = {
    payment: {
      previewUrl: 'https://media.test/pay-preview',
      fullUrl: 'https://media.test/pay-full',
    },
    chats: [
      {
        previewUrl: 'https://media.test/chat-1-preview',
        fullUrl: 'https://media.test/chat-1-full',
      },
      {
        previewUrl: 'https://media.test/chat-2-preview',
        fullUrl: 'https://media.test/chat-2-full',
      },
      {
        previewUrl: 'https://media.test/chat-3-preview',
        fullUrl: 'https://media.test/chat-3-full',
      },
    ],
    totalChatCount: 5,
  }

  it('sends a confirmed booking to the Admin group and selected doctor group', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake(), ports)
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.adminMessages()[0].to).toBe('admin-group')
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()[0].to).toBe('doctor-group-1')
  })

  it('uses white Flex Messages with full operational data for each audience', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake(), ports)
    const adminPayload = JSON.stringify(ports.line.adminMessages()[0])
    const doctorPayload = JSON.stringify(ports.line.doctorMessages()[0])

    for (const payload of [adminPayload, doctorPayload]) {
      expect(payload).toContain('"type":"flex"')
      expect(payload).toContain('#FFFFFF')
      expect(payload).toContain('ลูกค้าทดสอบ')
      expect(payload).toContain('0812345678')
      expect(payload).toContain('service-1')
      expect(payload).toContain('20/08/2026 13:00')
      expect(payload).toContain('Admin A')
      expect(payload).not.toContain('drive.google.com')
      expect(payload).not.toMatch(/\b\d{13}\b/)
    }

    expect(adminPayload).toContain('1,000')
    expect(adminPayload).toContain('สลิป 1')
    expect(adminPayload).toContain('แชท 1')
    expect(doctorPayload).not.toContain('ยอดจอง')
  })

  it('uses a serious white Admin evidence card and keeps doctor payload evidence-free', () => {
    const booking = bookingFixture({
      doctorLineGroupId: 'doctor-group-1',
      calendarId: 'doctor-calendar-1',
    })
    const adminJson = JSON.stringify(adminBookingMessage(booking, 'admin-group', evidence))
    const doctorJson = JSON.stringify(doctorBookingMessage(booking, 'BOOKING_CONFIRMED'))

    expect(adminJson).toContain('#FFFFFF')
    expect(adminJson).not.toContain('#FEE5E0')
    expect(adminJson).toContain('หลักฐานการโอน')
    expect(adminJson).toContain('หลักฐานแชท')
    expect(adminJson).toContain('https://media.test/pay-preview')
    expect(adminJson).toContain('https://media.test/chat-3-preview')
    expect(adminJson).toContain('+2 รูปเพิ่มเติมใน Drive')
    expect(adminJson).toContain('https://media.test/pay-full')
    expect(adminJson).toContain('https://media.test/chat-3-full')
    expect(adminJson).toContain('"aspectMode":"fit"')
    expect(adminJson).not.toContain('"aspectMode":"contain"')
    expect(doctorJson).not.toContain('media.test')
    expect(doctorJson).not.toContain('หลักฐานการโอน')
  })

  it('shows a safe fallback when evidence URLs are unavailable', () => {
    const payload = JSON.stringify(
      adminBookingMessage(bookingFixture(), 'admin-group', {
        payment: null,
        chats: [],
        totalChatCount: 2,
      }),
    )
    expect(payload).toContain('รูปหลักฐานยังไม่พร้อมแสดง')
    expect(payload).not.toContain('"type":"image"')
  })

  it('does not send doctor LINE before Calendar success', () => {
    const ports = createTestPorts({ calendarCreateFails: true })
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.calendarState).toBe('RETRY')
    expect(ports.line.doctorMessages()).toEqual([])
  })

  it('sends a reschedule message to the same doctor group', () => {
    const ports = createTestPorts()
    const booking = submitBookingIntake(validBookingIntake(), ports)
    rescheduleBooking(
      booking.caseId,
      { appointmentStart: '2026-08-21T14:00:00+07:00', reason: 'customer requested' },
      ports,
    )
    expect(ports.line.doctorMessages().map((message) => message.eventType)).toEqual([
      'BOOKING_CONFIRMED',
      'RESCHEDULED',
    ])
  })

  it('rejects invalid internal ingress HMAC before a directory write', () => {
    const ports = createTestPorts({ lineDirectoryCaptureEnabled: true })
    expect(() =>
      handleLineDirectoryIngress(
        {
          timestamp: 1_787_191_200,
          nonce: 'nonce-1',
          sourceType: 'group',
          sourceId: 'doctor-group-1',
          signature: 'invalid',
        },
        ports,
      ),
    ).toThrow('invalid booking ingress signature')
    expect(ports.lineDirectory.list()).toEqual([])
  })

  it('captures a verified LINE source ID without message content', () => {
    const ports = createTestPorts({ lineDirectoryCaptureEnabled: true })
    handleLineDirectoryIngress(ports.signedBookingIngressFixture('group', 'doctor-group-1'), ports)
    expect(ports.lineDirectory.list()).toEqual([
      { sourceType: 'group', sourceId: 'doctor-group-1', capturedAt: '2026-08-20T09:00:00+07:00' },
    ])
  })
})
