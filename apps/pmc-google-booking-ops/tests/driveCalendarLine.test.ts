import { describe, expect, it } from 'vitest'
import { ensureCaseEvidenceFolder } from '../src/adapters/googleDrive'
import { calendarEventInput } from '../src/adapters/googleCalendar'
import {
  adminBookingMessage,
  doctorBookingMessage,
  formatLinePushError,
  handleLineDirectoryIngress,
  isLinePushAcceptedStatus,
} from '../src/adapters/lineMessaging'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { refreshBookingCalendarPresentation, rescheduleBooking } from '../src/workflows/bookingUpdate'
import { bookingFixture, createFakeDrive, createTestPorts, validBookingIntake } from './helpers/fakes'

function visibleFlexText(value: unknown): string {
  if (Array.isArray(value)) return value.map(visibleFlexText).join(' ')
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      ['text', 'altText'].includes(key) && typeof child === 'string'
        ? [child]
        : [visibleFlexText(child)],
    )
    .join(' ')
}

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
  it('uses the Form response identity so a reset Case ID cannot collide with an old event', () => {
    const first = calendarEventInput(bookingFixture({
      calendarId: 'doctor-calendar-1',
      formResponseId: 'response-a',
    }))
    const second = calendarEventInput(bookingFixture({
      calendarId: 'doctor-calendar-1',
      formResponseId: 'response-b',
    }))
    expect(first.externalId).toBe('PMC-202608-0001:response-a')
    expect(second.externalId).toBe('PMC-202608-0001:response-b')
    expect(first.externalId).not.toBe(second.externalId)
  })

  it('creates the event and notifies when the interval overlaps', () => {
    const ports = createTestPorts({ calendarConflicts: true })
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.status).toBe('BOOKING_CONFIRMED')
    expect(result.calendarState).toBe('OK')
    expect(result.lineState).toBe('OK')
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.adminMessages()[0].eventType).toBe('BOOKING_CONFIRMED')
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.calls.list()).toHaveLength(1)
  })

  it('creates one clean mobile-friendly event with the approved booking details', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.calendarEventId).toBe('event-PMC-202608-0001:response-1')
    expect(ports.calendar.createdEvents()[0]).toMatchObject({
      calendarId: 'doctor-calendar-1',
      externalId: 'PMC-202608-0001:response-1',
      summary: 'doctor-1 | service-1 | ลูกค้าทดสอบ',
      description: [
        'ลูกค้า: ลูกค้าทดสอบ',
        'Facebook: <a href="https://www.facebook.com/search/people/?q=PMC%20Beauty">PMC Beauty</a>',
        'โทร: 0812345678',
        'ช่องทาง: ไม่ระบุ',
        'มัดจำ: 1,000 บาท · โอนแล้ว',
        'Admin: Admin A',
        'AE: Admin A',
      ].join('\n'),
      colorId: '5',
    })
  })

  it('encodes the Facebook search query and escapes the visible Facebook name', () => {
    const event = calendarEventInput(bookingFixture({
      facebookName: 'Mew & <Tanjung>',
      calendarId: 'promedcalender@gmail.com',
    }))

    expect(event.description).toContain(
      'Facebook: <a href="https://www.facebook.com/search/people/?q=Mew%20%26%20%3CTanjung%3E">Mew &amp; &lt;Tanjung&gt;</a>',
    )
  })

  it('uses only the customer first name in the Calendar title', () => {
    expect(calendarEventInput(bookingFixture({
      customerName: 'พิมพ์ชนก ท่าน้ำเที่ยง',
      doctorId: 'หมอ Benz',
      serviceId: 'เติมไขมัน',
      calendarId: 'promedcalender@gmail.com',
    })).summary).toBe('หมอ Benz | เติมไขมัน | พิมพ์ชนก')
  })

  it('refreshes an existing Calendar card without sending another LINE message', () => {
    const ports = createTestPorts()
    const booking = submitBookingIntake(validBookingIntake(), ports)
    const doctorMessagesBefore = ports.line.doctorMessages().length

    refreshBookingCalendarPresentation(booking.caseId, ports)

    expect(ports.calendar.updatedEvents()).toHaveLength(1)
    expect(ports.calendar.updatedEvents()[0].input.summary).toBe(
      'doctor-1 | service-1 | ลูกค้าทดสอบ',
    )
    expect(ports.line.doctorMessages()).toHaveLength(doctorMessagesBefore)
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
    payments: [{
      previewUrl: 'https://media.test/pay-preview',
      fullUrl: 'https://media.test/pay-full',
    }],
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
    totalPaymentCount: 1,
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

  it('routes configured closer and AE profile images into both LINE audiences', () => {
    const ports = createTestPorts()
    const originalFindStaffById = ports.config.findStaffById
    ports.config.findStaffById = (id) => {
      const staff = originalFindStaffById(id)
      if (!staff) return null
      return {
        ...staff,
        profileImageUrl: id === 'admin-1'
          ? 'https://media.example/assets/staff-profiles/admin-a.jpg'
          : 'https://media.example/assets/staff-profiles/aim.jpg',
      }
    }

    submitBookingIntake(validBookingIntake({ aeName: 'เอม' }), ports)

    for (const payload of [
      JSON.stringify(ports.line.adminMessages()[0]),
      JSON.stringify(ports.line.doctorMessages()[0]),
    ]) {
      expect(payload).toContain('https://media.example/assets/staff-profiles/admin-a.jpg')
      expect(payload).toContain('https://media.example/assets/staff-profiles/aim.jpg')
      expect(payload).not.toContain('drive.google.com')
    }
  })

  it('reuses the same profile when the closer and AE are the same person', () => {
    const ports = createTestPorts()
    const originalFindStaffById = ports.config.findStaffById
    ports.config.findStaffById = (id) => {
      const staff = originalFindStaffById(id)
      return staff
        ? { ...staff, profileImageUrl: 'https://media.example/assets/staff-profiles/admin-a.jpg' }
        : null
    }

    submitBookingIntake(validBookingIntake({ aeName: 'Admin A' }), ports)

    for (const message of [ports.line.adminMessages()[0], ports.line.doctorMessages()[0]]) {
      const json = JSON.stringify(message)
      expect((json.match(/admin-a\.jpg/g) ?? [])).toHaveLength(2)
    }
  })

  it('falls back to a blank avatar instead of sending a private Drive profile URL', () => {
    const ports = createTestPorts()
    const originalFindStaffById = ports.config.findStaffById
    ports.config.findStaffById = (id) => {
      const staff = originalFindStaffById(id)
      return staff
        ? { ...staff, profileImageUrl: 'https://drive.google.com/file/d/private/view' }
        : null
    }

    submitBookingIntake(validBookingIntake({ aeName: 'Admin A' }), ports)

    for (const message of [ports.line.adminMessages()[0], ports.line.doctorMessages()[0]]) {
      expect(JSON.stringify(message)).not.toContain('drive.google.com')
    }
  })

  it('uses white Flex Messages with full operational data for each audience', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake({ aeName: 'เอม' }), ports)
    const adminPayload = JSON.stringify(ports.line.adminMessages()[0])
    const doctorPayload = JSON.stringify(ports.line.doctorMessages()[0])

    for (const payload of [adminPayload, doctorPayload]) {
      expect(payload).toContain('"type":"flex"')
      expect(payload).toContain('#FFFFFF')
      expect(payload).toContain('ลูกค้าทดสอบ')
      expect(payload).toContain('0812345678')
      expect(payload).toContain('service-1')
      expect(payload).toContain('20 สิงหาคม 2569')
      expect(payload).toContain('Admin A')
      expect(payload).toContain('เอม')
      expect(payload).not.toContain('drive.google.com')
      expect(payload).not.toMatch(/\b\d{13}\b/)
    }

    expect(adminPayload).toContain('1,000')
    expect(visibleFlexText(ports.line.adminMessages()[0].apiMessage)).not.toContain('PMC-202608-0001')
    expect(ports.line.adminMessages()[0].text).not.toContain('PMC-202608-0001')
    expect(doctorPayload).not.toContain('ยอดจอง')
  })

  it('uses a serious white Admin evidence card and keeps doctor payload evidence-free', () => {
    const booking = bookingFixture({
      doctorLineGroupId: 'doctor-group-1',
      calendarId: 'doctor-calendar-1',
    })
    const logoUrl = 'https://evidence.example/assets/pmc-flex-logo-v1.png'
    const adminJson = JSON.stringify(adminBookingMessage(booking, 'admin-group', evidence, logoUrl))
    const doctorJson = JSON.stringify(doctorBookingMessage(booking, 'BOOKING_CONFIRMED', logoUrl))

    expect(adminJson).toContain('#FFFFFF')
    expect(adminJson).not.toContain('#FEE5E0')
    expect(adminJson).toContain('หลักฐาน')
    expect(adminJson).toContain('https://media.test/pay-preview')
    expect(adminJson).toContain('https://media.test/chat-3-preview')
    expect(adminJson).not.toContain('รูปเพิ่มเติมใน Drive')
    expect(adminJson).toContain('https://media.test/pay-full')
    expect(adminJson).toContain('https://media.test/chat-3-full')
    expect(adminJson).toContain('"aspectMode":"fit"')
    expect(adminJson).not.toContain('"aspectMode":"contain"')
    expect(doctorJson).not.toContain('media.test')
    expect(doctorJson).not.toContain('หลักฐาน')
  })

  it('shows a safe fallback when evidence URLs are unavailable', () => {
    const payload = JSON.stringify(
      adminBookingMessage(bookingFixture(), 'admin-group', {
        payments: [],
        chats: [],
        totalPaymentCount: 1,
        totalChatCount: 2,
      }, 'https://evidence.example/assets/pmc-flex-logo-v1.png'),
    )
    expect(payload).toContain('รูปหลักฐานยังไม่พร้อมแสดง')
    expect(payload).not.toContain('media.test')
  })

  it('does not send doctor LINE before Calendar success', () => {
    const ports = createTestPorts({ calendarCreateFails: true })
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.calendarState).toBe('RETRY')
    expect(ports.line.doctorMessages()).toEqual([])
  })

  it('treats LINE retry-key 409 as an accepted idempotent push', () => {
    expect(isLinePushAcceptedStatus(200)).toBe(true)
    expect(isLinePushAcceptedStatus(202)).toBe(true)
    expect(isLinePushAcceptedStatus(409)).toBe(true)
    expect(isLinePushAcceptedStatus(400)).toBe(false)
    expect(isLinePushAcceptedStatus(500)).toBe(false)
  })

  it('keeps bounded LINE validation details in a failed push error', () => {
    expect(
      formatLinePushError(
        400,
        '{"message":"A message in the request body is invalid","details":[{"property":"/body/contents/0"}]}',
      ),
    ).toBe(
      'LINE push failed with status 400: {"message":"A message in the request body is invalid","details":[{"property":"/body/contents/0"}]}',
    )
    expect(formatLinePushError(400, 'x'.repeat(900))).toHaveLength(834)
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
