import { describe, expect, it } from 'vitest'
import { parseJeraTransactions } from '../src/domain/jera'
import { importJeraFile } from '../src/workflows/jeraImport'
import { createTestPorts, jeraReportFixture } from './helpers/fakes'

describe('JERA import', () => {
  it('finds the header after metadata and ignores detail and summary rows', () => {
    const rows = parseJeraTransactions(jeraReportFixture())
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.status)).toEqual(['ชำระแล้ว', 'คืนมัดจำ'])
  })

  it('rejects a transaction time that cannot form an auditable close timestamp', () => {
    expect(() => parseJeraTransactions(jeraReportFixture().replace('10:00:00', 'not-a-time'))).toThrow(
      'invalid JERA transaction time',
    )
  })

  it('closes only a unique phone plus name match with ชำระแล้ว', () => {
    const ports = createTestPorts()
    ports.bookings.insert(
      ports.bookingFixture({
        customerName: 'สมหญิง ใจดี',
        customerNameNormalized: 'สมหญิงใจดี',
        phoneNormalized: '0812345678',
        status: 'BOOKING_CONFIRMED',
      }),
    )
    importJeraFile('jera-file-1', ports)
    const booking = ports.bookings.getByCaseId('PMC-202608-0001')
    expect(booking?.status).toBe('CLOSED_JERA')
    expect(booking?.jeraClosedAt).toBe('2026-08-19T10:00:00+07:00')
    expect(booking?.commissionEligibility).toBe('PENDING_RULE')
    expect(booking?.commissionAmount).toBeNull()
    expect(ports.files.importedFileIds()).toEqual(['jera-file-1'])
  })

  it('sends a missing-phone match to reconciliation instead of closing', () => {
    const ports = createTestPorts({ jeraPhone: '' })
    ports.bookings.insert(
      ports.bookingFixture({ customerNameNormalized: 'สมหญิงใจดี', phoneNormalized: '0812345678' }),
    )
    importJeraFile('jera-file-1', ports)
    expect(ports.reconciliation.listOpen()).toHaveLength(1)
    expect(ports.bookings.list().filter((booking) => booking.status === 'CLOSED_JERA')).toHaveLength(0)
  })

  it('does not import the same content hash twice', () => {
    const ports = createTestPorts()
    importJeraFile('jera-file-1', ports)
    importJeraFile('jera-file-1-copy', ports)
    expect(ports.imports.completed()).toHaveLength(1)
  })
})
