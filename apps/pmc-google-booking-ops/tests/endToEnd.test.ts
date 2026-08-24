import { describe, expect, it } from 'vitest'
import { runDailyCallReminders } from '../src/workflows/callQueue'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { importJeraFile } from '../src/workflows/jeraImport'
import {
  isConfigurationReady,
  runDailyOperationsWorkflow,
  runEligibleRetries,
  validateRuntimeProperties,
} from '../src/runtime'
import { createTestPorts, validBookingIntake } from './helpers/fakes'
import { seedStaffRowsFromLegacy } from '../src/workflows/staffAeMigration'

describe('PMC booking end to end', () => {
  it('seeds Staff roles from legacy Admin rows without copying the shared email', () => {
    expect(
      seedStaffRowsFromLegacy([
        {
          id: 'admin-1',
          name: 'มัส',
          email: 'shared@example.com',
          lineUserId: 'line-1',
          active: true,
        },
      ]),
    ).toEqual([
      {
        id: 'admin-1',
        name: 'มัส',
        email: '',
        lineUserId: 'line-1',
        canCloseBooking: true,
        canBeAe: true,
        active: true,
      },
    ])
  })

  it('books once, routes safely, reminds, and closes only from JERA paid evidence', () => {
    const ports = createTestPorts()
    const booking = submitBookingIntake(
      validBookingIntake({ customerName: 'สมหญิง ใจดี', phone: '0812345678' }),
      ports,
    )
    expect(booking.status).toBe('BOOKING_CONFIRMED')
    expect(ports.drive.createdFolderCount()).toBe(3)
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)

    runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(2)
    expect(ports.line.adminMessages()[1].eventType).toBe('CALL_REMINDER')
    expect(ports.line.adminMessages()[1].apiMessage?.type).toBe('flex')

    importJeraFile('jera-file-1', ports)
    expect(ports.bookings.getByCaseId(booking.caseId)?.status).toBe('CLOSED_JERA')
    expect(ports.calls.getOpenByCase(booking.caseId)).toBeNull()
    expect(ports.bookings.getByCaseId(booking.caseId)?.commissionAmount).toBeNull()
  })

  it('runs the scheduled daily workflow and writes a dashboard snapshot', () => {
    const ports = createTestPorts()
    submitBookingIntake(validBookingIntake(), ports)
    runDailyOperationsWorkflow(ports)
    expect(ports.dashboard.lastSnapshot()?.kpis.bookings).toBe(1)
  })

  it('retries a failed LINE step without duplicating Drive or Calendar', () => {
    const ports = createTestPorts({ linePushFails: true })
    const booking = submitBookingIntake(
      validBookingIntake({
        paymentEvidenceFileIds: ['payment-file-1'],
        chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'],
      }),
      ports,
    )
    expect(booking.lineState).toBe('RETRY')
    expect(ports.retries.listPending()).toHaveLength(1)
    expect(ports.retries.listPending()[0]).toMatchObject({
      operation: 'BOOKING_LINE',
      payload: {
        paymentEvidenceFileIds: ['payment-file-1'],
        chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'],
      },
    })
    ports.line.allowPushes()
    runEligibleRetries(ports)
    expect(ports.bookings.getByCaseId(booking.caseId)?.lineState).toBe('OK')
    expect(ports.drive.createdFolderCount()).toBe(3)
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[0].apiMessage)).toContain('payment-file-1')
    expect(JSON.stringify(ports.line.doctorMessages()[0].apiMessage)).not.toContain('payment-file-1')
    expect(ports.retries.listPending()).toHaveLength(0)
  })

  it('continues a recovered Calendar retry through call-task and both LINE deliveries', () => {
    const ports = createTestPorts({ calendarCreateFails: true })
    const booking = submitBookingIntake(
      validBookingIntake({
        paymentEvidenceFileIds: ['payment-file-1'],
        chatEvidenceFileIds: ['chat-file-1'],
      }),
      ports,
    )
    expect(booking).toMatchObject({
      status: 'FORM_SUBMITTED',
      calendarState: 'RETRY',
      lineState: 'PENDING',
    })
    expect(ports.calls.list()).toEqual([])
    expect(ports.line.adminMessages()).toEqual([])
    expect(ports.line.doctorMessages()).toEqual([])
    expect(ports.retries.listPending()[0]).toMatchObject({
      operation: 'CALENDAR_EVENT',
      payload: {
        paymentEvidenceFileIds: ['payment-file-1'],
        chatEvidenceFileIds: ['chat-file-1'],
      },
    })

    ports.calendar.allowCreates()
    runEligibleRetries(ports)

    expect(ports.retries.listPending()).toEqual([])
    expect(ports.bookings.getByCaseId(booking.caseId)).toMatchObject({
      status: 'BOOKING_CONFIRMED',
      calendarState: 'OK',
      lineState: 'OK',
    })
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.calls.getOpenByCase(booking.caseId)).not.toBeNull()
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[0].apiMessage)).toContain(
      'payment-file-1',
    )
  })

  it('does not block a booking when the Calendar interval overlaps', () => {
    const ports = createTestPorts({ calendarConflicts: true })
    const booking = submitBookingIntake(validBookingIntake(), ports)

    expect(booking).toMatchObject({
      status: 'BOOKING_CONFIRMED',
      calendarState: 'OK',
      lineState: 'OK',
    })
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.adminMessages()[0].eventType).toBe('BOOKING_CONFIRMED')
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.calls.getOpenByCase(booking.caseId)).not.toBeNull()
    expect(ports.retries.listPending()).toEqual([])
  })

  it('deduplicates Admin when doctor delivery fails after Admin succeeds', () => {
    const ports = createTestPorts({ lineFailsAtPush: 2 })
    const booking = submitBookingIntake(validBookingIntake(), ports)

    expect(booking.lineState).toBe('RETRY')
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(0)

    runEligibleRetries(ports)

    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.retries.listPending()).toHaveLength(0)
  })

  it('sends summaries and retries only Admin evidence after one signer failure', () => {
    const ports = createTestPorts({ mediaSigningFailsOnce: true })
    const booking = submitBookingIntake(validBookingIntake(), ports)

    expect(booking.lineState).toBe('RETRY')
    expect(ports.line.adminMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[0].apiMessage)).toContain(
      'รูปหลักฐานยังไม่พร้อมแสดง',
    )
    expect(ports.retries.listPending()).toHaveLength(1)
    expect(ports.retries.listPending()[0]).toMatchObject({ operation: 'ADMIN_EVIDENCE_LINE' })

    runEligibleRetries(ports)

    expect(ports.line.adminMessages()).toHaveLength(2)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(JSON.stringify(ports.line.adminMessages()[1].apiMessage)).toContain('payment-file-1')
    expect(ports.retries.listPending()).toHaveLength(0)
  })

  it('fails setup with missing property names and never prints values', () => {
    expect(() => validateRuntimeProperties({ PMC_SPREADSHEET_ID: 'secret-sheet-value' })).toThrow(
      'Missing Script Properties: PMC_BOOKING_FORM_ID',
    )
    try {
      validateRuntimeProperties({ PMC_SPREADSHEET_ID: 'secret-sheet-value' })
    } catch (error) {
      expect(String(error)).not.toContain('secret-sheet-value')
    }
  })

  it('does not activate Forms or triggers until all three configuration lists are populated', () => {
    expect(isConfigurationReady({ staff: 1, aes: 1, doctors: 0, services: 1 })).toBe(false)
    expect(isConfigurationReady({ staff: 1, aes: 1, doctors: 1, services: 1 })).toBe(true)
  })
})
