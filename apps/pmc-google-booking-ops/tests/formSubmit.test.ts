import { describe, expect, it } from 'vitest'
import { parseBookingFormEvent } from '../src/adapters/googleForms'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { createTestPorts, validBookingIntake } from './helpers/fakes'

describe('booking Form workflow', () => {
  it('maps the ten Thai Form fields and uploaded Drive file IDs', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-1:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
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

    expect(intake.aeName).toBe('เอม')
    expect('adminName' in intake).toBe(false)
    expect(intake.submitterEmail).toBe('admin@example.com')
    expect(intake.channelId).toBe('เพจหลัก')
    expect(intake.paymentEvidenceFileIds).toEqual(['payment-file-id-123456789012345'])
    expect(intake.chatEvidenceFileIds).toEqual([
      'chat-file-id-123456789012345',
      'chat-file-id-223456789012345',
    ])
  })

  it('keeps the optional channel empty when Admin does not select one', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-1:3',
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
    ).toThrow('missing Form field: AE ผู้เปิดแชท')
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

  it('attributes the booking to selected Admin when all staff share one Google email', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(validBookingIntake({ submitterEmail: 'shared@example.com' }), ports)
    expect(result.status).toBe('BOOKING_CONFIRMED')
    expect(result.adminId).toBe('admin-1')
    expect(result.adminIdentityStatus).toBe('SHARED_ACCOUNT')
  })

  it('rejects missing slip or chat evidence before reserving a Case ID', () => {
    const ports = createTestPorts()
    expect(() => submitBookingIntake(validBookingIntake({ chatEvidenceFileIds: [] }), ports)).toThrow(
      'chat evidence is required',
    )
    expect(ports.bookings.list()).toEqual([])
  })
})
