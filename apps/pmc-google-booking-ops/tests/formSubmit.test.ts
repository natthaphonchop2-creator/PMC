import { describe, expect, it } from 'vitest'
import { parseBookingFormEvent } from '../src/adapters/googleForms'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { createTestPorts, validBookingIntake } from './helpers/fakes'

describe('booking Form workflow', () => {
  it('maps the eleven Thai Form fields and uploaded Drive file IDs', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-1:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        ผู้ปิดการจอง: ['มัส'],
        'AE ผู้เปิดแชท': ['เอม'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        เบอร์มือถือ: ['0812345678'],
        หมอ: ['doctor-1'],
        'บริการ/โปรแกรม': ['service-1'],
        วันที่นัด: ['2026-08-20'],
        เวลานัด: ['13:00'],
        จำนวนเงินจอง: ['1000'],
        'เพจคลินิก/ช่องทาง': ['เพจหลัก'],
        สลิปเงินจอง: ['https://drive.google.com/open?id=payment-file-id-123456789012345'],
        หลักฐานแชท: [
          'https://drive.google.com/open?id=chat-file-id-123456789012345, https://drive.google.com/open?id=chat-file-id-223456789012345',
        ],
      },
    })

    expect(intake.closerName).toBe('มัส')
    expect(intake.aeName).toBe('เอม')
    expect(intake.submitterEmail).toBe('admin@example.com')
    expect(intake.channelId).toBe('เพจหลัก')
    expect(intake.paymentEvidenceFileIds).toEqual(['payment-file-id-123456789012345'])
    expect(intake.chatEvidenceFileIds).toEqual([
      'chat-file-id-123456789012345',
      'chat-file-id-223456789012345',
    ])
  })

  it('parses the compact Admin and AE field titles', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-compact:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        Admin: ['มัส'],
        AE: ['ไม่ระบุ'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        เบอร์มือถือ: ['0812345678'],
        หมอ: ['doctor-1'],
        'บริการ/โปรแกรม': ['service-1'],
        วันที่นัด: ['2026-08-20'],
        เวลานัด: ['13:00'],
        จำนวนเงินจอง: ['1000'],
        สลิปเงินจอง: ['payment-file-id-123456789012345'],
        หลักฐานแชท: ['chat-file-id-123456789012345'],
      },
    })
    expect(intake.closerName).toBe('มัส')
    expect(intake.aeName).toBe('ไม่ระบุ')
  })

  it('keeps the optional channel empty when Admin does not select one', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-1:3',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'shared@example.com',
      namedValues: {
        ผู้ปิดการจอง: ['มัส'],
        'AE ผู้เปิดแชท': ['เอม'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        เบอร์มือถือ: ['0812345678'],
        หมอ: ['doctor-1'],
        'บริการ/โปรแกรม': ['service-1'],
        วันที่นัด: ['2026-08-20'],
        เวลานัด: ['13:00'],
        จำนวนเงินจอง: ['1000'],
        สลิปเงินจอง: ['payment-file-id-123456789012345'],
        หลักฐานแชท: ['chat-file-id-123456789012345'],
      },
    })
    expect(intake.channelId).toBeNull()
  })

  it('rejects the legacy Admin field when the required AE field is absent', () => {
    expect(() =>
      parseBookingFormEvent({
        responseKey: 'sheet-1:4',
        submittedAt: '2026-08-20T09:00:00+07:00',
        submitterEmail: 'admin@example.com',
        namedValues: {
          ผู้ปิดการจอง: ['มัส'],
          'Admin ผู้รับจอง': ['Admin A'],
          ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
          เบอร์มือถือ: ['0812345678'],
          หมอ: ['doctor-1'],
          'บริการ/โปรแกรม': ['service-1'],
          วันที่นัด: ['2026-08-20'],
          เวลานัด: ['13:00'],
          จำนวนเงินจอง: ['1000'],
          สลิปเงินจอง: ['payment-file-id-123456789012345'],
          หลักฐานแชท: ['chat-file-id-123456789012345'],
        },
      }),
    ).toThrow('missing Form field: AE')
  })

  it('rejects the Form when the required closer field is absent', () => {
    expect(() =>
      parseBookingFormEvent({
        responseKey: 'sheet-1:5',
        submittedAt: '2026-08-20T09:00:00+07:00',
        submitterEmail: 'shared@example.com',
        namedValues: {
          'AE ผู้เปิดแชท': ['เอม'],
          ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
          เบอร์มือถือ: ['0812345678'],
          หมอ: ['doctor-1'],
          'บริการ/โปรแกรม': ['service-1'],
          วันที่นัด: ['2026-08-20'],
          เวลานัด: ['13:00'],
          จำนวนเงินจอง: ['1000'],
          สลิปเงินจอง: ['payment-file-id-123456789012345'],
          หลักฐานแชท: ['chat-file-id-123456789012345'],
        },
      }),
    ).toThrow('missing Form field: Admin')
  })

  it('creates one canonical case with automatic values', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake(), ports)
    expect(result.caseId).toBe('PMC-202608-0001')
    expect(result.depositExpiresAt).toBe('2027-02-20T09:00:00+07:00')
    expect(result.appointmentEnd).toBe('2026-08-20T14:00:00+07:00')
    expect(result.commissionEligibility).toBe('NOT_ELIGIBLE')
    expect(result.commissionAmount).toBeNull()
  })

  it('does not process the same Form response twice', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake(), ports)
    expect(() => submitBookingIntake(validBookingIntake(), ports)).toThrow('form response already processed')
    expect(ports.bookings.list()).toHaveLength(1)
  })

  it('attributes closer from verified email and AE from the required choice', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(
      validBookingIntake({ submitterEmail: 'admin@example.com', aeName: 'เอม' }),
      ports,
    )
    expect(result).toMatchObject({
      adminId: 'admin-1',
      adminName: 'Admin A',
      adminIdentityStatus: 'VERIFIED_EMAIL',
      aeId: 'staff-ae',
      aeName: 'เอม',
      callOwnerAdminId: 'admin-1',
    })
  })

  it('attributes the approved shared email to the closer selected in the Form', () => {
    const ports = createTestPorts()
    ports.config.isSharedCloserEmail = (email) =>
      email.trim().toLowerCase() === 'shared@example.com'

    const result = submitBookingIntake(
      validBookingIntake({
        submitterEmail: 'shared@example.com',
        closerName: 'Admin A',
        aeName: 'เอม',
      }),
      ports,
    )

    expect(result).toMatchObject({
      adminId: 'admin-1',
      adminName: 'Admin A',
      adminIdentityStatus: 'SHARED_ACCOUNT',
      aeId: 'staff-ae',
      aeName: 'เอม',
      commissionEligibility: 'NOT_ELIGIBLE',
    })
  })

  it('accepts the closer as AE in the same booking', () => {
    const result = submitBookingIntake(
      validBookingIntake({ closerName: 'Admin A', aeName: 'Admin A' }),
      createTestPorts(),
    )
    expect(result.aeId).toBe(result.adminId)
  })

  it('records an explicit no-AE selection without inventing a Staff identity', () => {
    const result = submitBookingIntake(
      validBookingIntake({ aeName: 'ไม่ระบุ' }),
      createTestPorts(),
    )
    expect(result.aeId).toBeNull()
    expect(result.aeName).toBe('ไม่ระบุ')
  })

  it('rejects an unknown closer selected by a shared account before any side effect', () => {
    const ports = createTestPorts()
    ports.config.isSharedCloserEmail = (email) =>
      email.trim().toLowerCase() === 'shared@example.com'

    expect(() =>
      submitBookingIntake(
        validBookingIntake({
          submitterEmail: 'shared@example.com',
          closerName: 'Unknown Closer',
        }),
        ports,
      ),
    ).toThrow('selected closer is not active or eligible')
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])
  })

  it('rejects a closer choice that does not match a verified personal email', () => {
    const ports = createTestPorts()
    ports.config.findCloserByName = () => ({
      id: 'admin-2',
      name: 'Admin B',
      email: 'admin-b@example.com',
      lineUserId: '',
      canCloseBooking: true,
      canBeAe: true,
      active: true,
    })

    expect(() =>
      submitBookingIntake(
        validBookingIntake({ submitterEmail: 'admin@example.com', closerName: 'Admin B' }),
        ports,
      ),
    ).toThrow('selected closer does not match submitter email')
    expect(ports.bookings.list()).toEqual([])
  })

  it('rejects unknown closer email before sequence allocation or side effects', () => {
    const ports = createTestPorts()
    expect(() =>
      submitBookingIntake(
        validBookingIntake({ submitterEmail: 'unknown@example.com' }),
        ports,
      ),
    ).toThrow('submitter is not an active booking closer')
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])

    const firstValid = submitBookingIntake(
      validBookingIntake({ formResponseId: 'response-2' }),
      ports,
    )
    expect(firstValid.caseId).toBe('PMC-202608-0001')
  })

  it('rejects an ineligible AE before any booking side effect', () => {
    const ports = createTestPorts()
    expect(() =>
      submitBookingIntake(validBookingIntake({ aeName: 'Admin Only' }), ports),
    ).toThrow('selected AE is not active or eligible')
    expect(ports.bookings.list()).toEqual([])
  })

  it('rejects missing slip or chat evidence before reserving a Case ID', () => {
    const ports = createTestPorts()
    expect(() => submitBookingIntake(validBookingIntake({ chatEvidenceFileIds: [] }), ports)).toThrow(
      'chat evidence is required',
    )
    expect(ports.bookings.list()).toEqual([])
  })
})
