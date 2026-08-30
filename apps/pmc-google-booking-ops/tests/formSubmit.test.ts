import { describe, expect, it } from 'vitest'
import { parseBookingFormEvent } from '../src/adapters/googleForms'
import { bookingAttributionFormChoices } from '../src/domain/staffDirectory'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { createTestPorts, validBookingIntake } from './helpers/fakes'

describe('booking Form workflow', () => {
  it('keeps the same ordered Form Admin and AE choices while excluding reserved identities', () => {
    const base = createTestPorts().config.listStaff()
    const staff = [
      base[0],
      reservedStaff({ id: ' none ', name: 'Reserved by ID' }),
      base[1],
      reservedStaff({ id: 'reserved-name', name: ' ไม่ระบุ ' }),
    ]

    const formChoices = bookingAttributionFormChoices(staff)

    expect(formChoices).toEqual({
      admins: ['Admin A', 'เอม'],
      aes: ['Admin A', 'เอม'],
    })
  })

  it('fails closed when reserved filtering leaves no canonical Admin or AE choices', () => {
    expect(() => bookingAttributionFormChoices([
      reservedStaff({ id: 'NONE', name: 'ไม่ระบุ' }),
    ])).toThrow('no active booking attribution staff')
  })

  it('treats a legacy response with no queue type as NORMAL', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'legacy-normal:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        Admin: ['มัส'],
        AE: ['ไม่ระบุ'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        'ชื่อ Facebook': ['PMC Beauty'],
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
    expect(intake).toMatchObject({
      queueType: 'NORMAL',
      appointmentDate: '2026-08-20',
      appointmentTime: '13:00',
    })
  })

  it('parses AUTO without appointment date or time', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'auto-no-date:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        Admin: ['มัส'],
        AE: ['ไม่ระบุ'],
        รูปแบบคิวนัดหมาย: ['คิวอัตโนมัติ'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        'ชื่อ Facebook': ['PMC Beauty'],
        เบอร์มือถือ: ['0812345678'],
        หมอ: ['doctor-1'],
        'บริการ/โปรแกรม': ['service-1'],
        จำนวนเงินจอง: ['1000'],
        สลิปเงินจอง: ['payment-file-id-123456789012345'],
        หลักฐานแชท: ['chat-file-id-123456789012345'],
      },
    })
    expect(intake).toMatchObject({
      queueType: 'AUTO',
      appointmentDate: null,
      appointmentTime: null,
    })
  })

  it('maps the required Facebook name and uploaded Drive file IDs', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-1:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        ผู้ปิดการจอง: ['มัส'],
        'AE ผู้เปิดแชท': ['เอม'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        'ชื่อ Facebook': ['PMC Beauty'],
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
    expect(intake.facebookName).toBe('PMC Beauty')
    expect(intake.channelId).toBe('เพจหลัก')
    expect(intake.paymentEvidenceFileIds).toEqual(['payment-file-id-123456789012345'])
    expect(intake.chatEvidenceFileIds).toEqual([
      'chat-file-id-123456789012345',
      'chat-file-id-223456789012345',
    ])
  })

  it('keeps every uploaded Drive file when Google Forms returns one array entry per file', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'sheet-multiple-files:2',
      submittedAt: '2026-08-20T09:00:00+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        Admin: ['มัส'],
        AE: ['ไม่ระบุ'],
        ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
        'ชื่อ Facebook': ['PMC Beauty'],
        เบอร์มือถือ: ['0812345678'],
        หมอ: ['doctor-1'],
        'บริการ/โปรแกรม': ['service-1'],
        วันที่นัด: ['2026-08-20'],
        เวลานัด: ['13:00'],
        จำนวนเงินจอง: ['1000'],
        สลิปเงินจอง: [
          'payment-file-id-123456789012345',
          'payment-file-id-223456789012345',
        ],
        หลักฐานแชท: [
          'chat-file-id-123456789012345',
          'chat-file-id-223456789012345',
        ],
      },
    })

    expect(intake.paymentEvidenceFileIds).toEqual([
      'payment-file-id-123456789012345',
      'payment-file-id-223456789012345',
    ])
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
        'ชื่อ Facebook': ['ไม่มี'],
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
        'ชื่อ Facebook': ['PMC Beauty'],
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
    expect(result.facebookName).toBe('PMC Beauty')
    expect(result.commissionEligibility).toBe('NOT_ELIGIBLE')
    expect(result.commissionAmount).toBeNull()
  })

  it('does not process the same Form response twice', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake(), ports)
    expect(() => submitBookingIntake(validBookingIntake(), ports)).toThrow('form response already processed')
    expect(ports.bookings.list()).toHaveLength(1)
  })

  it('attributes the selected Admin while retaining the submitter email for audit', () => {
    const ports = createTestPorts()
    const result = submitBookingIntake(
      validBookingIntake({ submitterEmail: 'admin@example.com', aeName: 'เอม' }),
      ports,
    )
    expect(result).toMatchObject({
      recorderId: 'admin-1',
      recorderName: 'Admin A',
      recorderSource: 'FORM_EMAIL_MATCH',
      adminId: 'admin-1',
      adminName: 'Admin A',
      adminIdentityStatus: 'SELECTED_ADMIN',
      aeId: 'staff-ae',
      aeName: 'เอม',
      callOwnerAdminId: 'admin-1',
    })
  })

  it('uses an unresolved Google Form recorder without inventing a Staff identity', () => {
    const result = submitBookingIntake(
      validBookingIntake({ submitterEmail: 'unknown@example.com' }),
      createTestPorts(),
    )

    expect(result).toMatchObject({
      recorderId: null,
      recorderName: 'Google Form',
      recorderSource: 'FORM_UNRESOLVED',
      adminId: 'admin-1',
      callOwnerAdminId: 'admin-1',
    })
  })

  it('allows an active AE-eligible non-closer to be selected as Admin', () => {
    const result = submitBookingIntake(
      validBookingIntake({ closerName: 'เอม', aeName: 'ไม่ระบุ' }),
      createTestPorts(),
    )

    expect(result).toMatchObject({
      recorderId: 'admin-1',
      adminId: 'staff-ae',
      adminName: 'เอม',
      aeId: null,
      callOwnerAdminId: 'staff-ae',
    })
  })

  it('rejects duplicate active eligible Form names before any booking side effect', () => {
    const ports = createTestPorts()
    const original = ports.config.listStaff()
    ports.config.listStaff = () => [
      ...original,
      { ...original[0], id: 'admin-duplicate', email: 'duplicate@example.com' },
    ]

    expect(() => submitBookingIntake(validBookingIntake(), ports))
      .toThrow('duplicate active attribution staff name')
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])
  })

  it.each([
    ['reserved Admin ID', { closerName: 'Reserved by ID' }],
    ['reserved Admin name', { closerName: 'ไม่ระบุ' }],
    ['reserved AE ID', { aeName: 'Reserved by ID' }],
  ])('rejects %s before any booking side effect', (_label, patch) => {
    const ports = createTestPorts()
    const base = ports.config.listStaff()
    ports.config.listStaff = () => [
      base[0],
      reservedStaff({ id: 'NONE', name: 'Reserved by ID' }),
      base[1],
      reservedStaff({ id: 'reserved-name', name: 'ไม่ระบุ' }),
    ]

    expect(() => submitBookingIntake(validBookingIntake(patch), ports)).toThrow()
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])
  })

  it('accepts the exact protocol-2 trusted null AE pair', () => {
    const result = submitBookingIntake(
      validBookingIntake({ aeName: 'ไม่ระบุ' }),
      createTestPorts(),
      { trustedAttribution: trustedAttribution(2, null) },
    )
    expect(result).toMatchObject({ aeId: null, aeName: null })
  })

  it('rejects the legacy no-AE label in a protocol-2 trusted pair before side effects', () => {
    const ports = createTestPorts()
    expect(() => submitBookingIntake(
      validBookingIntake({ aeName: 'ไม่ระบุ' }),
      ports,
      { trustedAttribution: trustedAttribution(2, 'ไม่ระบุ') },
    )).toThrow('trusted AE attribution is not current')
    expect(ports.bookings.list()).toEqual([])
    expect(ports.calendar.createdEvents()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])
  })

  it('accepts the exact protocol-1 trusted legacy no-AE pair', () => {
    const result = submitBookingIntake(
      validBookingIntake({ aeName: 'ไม่ระบุ' }),
      createTestPorts(),
      { trustedAttribution: trustedAttribution(1, 'ไม่ระบุ') },
    )
    expect(result).toMatchObject({ aeId: null, aeName: 'ไม่ระบุ' })
  })

  it('uses the selected Admin even when the submitter uses the former shared email', () => {
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
      adminIdentityStatus: 'SELECTED_ADMIN',
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

  it('rejects an unknown Admin selection before any side effect', () => {
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

  it('accepts a selected Admin that differs from the submitter email mapping', () => {
    const ports = createTestPorts()
    const adminB = {
      id: 'admin-2',
      name: 'Admin B',
      email: 'admin-b@example.com',
      lineUserId: '',
      canCloseBooking: true,
      canBeAe: true,
      canManageStock: false,
      canSubmitExpense: false,
      canViewFinance: false,
      canManageExpense: false,
      active: true,
    }
    ports.config.listStaff = () => [...createTestPorts().config.listStaff(), adminB]

    const result = submitBookingIntake(
      validBookingIntake({ submitterEmail: 'admin@example.com', closerName: 'Admin B' }),
      ports,
    )
    expect(result).toMatchObject({
      adminId: 'admin-2',
      adminName: 'Admin B',
      submitterEmail: 'admin@example.com',
      adminIdentityStatus: 'SELECTED_ADMIN',
    })
  })

  it('accepts an unmapped personal email without consulting email identity mappings', () => {
    const ports = createTestPorts()
    ports.config.isSharedCloserEmail = () => {
      throw new Error('shared-email lookup must not run')
    }
    ports.config.findCloserByEmail = () => {
      throw new Error('closer-email lookup must not run')
    }
    const result = submitBookingIntake(
      validBookingIntake({ submitterEmail: 'unknown@example.com' }),
      ports,
    )
    expect(result).toMatchObject({
      caseId: 'PMC-202608-0001',
      adminId: 'admin-1',
      adminName: 'Admin A',
      submitterEmail: 'unknown@example.com',
      adminIdentityStatus: 'SELECTED_ADMIN',
    })
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

function reservedStaff(patch: { id: string; name: string }) {
  return {
    ...createTestPorts().config.listStaff()[1],
    ...patch,
  }
}

function trustedAttribution(protocolVersion: 1 | 2, aeName: string | null) {
  return {
    protocolVersion,
    recorderId: 'admin-1',
    recorderName: 'Admin A',
    recorderSource: 'VERIFIED_LINE' as const,
    adminId: 'admin-1',
    adminName: 'Admin A',
    aeId: null,
    aeName,
  }
}
