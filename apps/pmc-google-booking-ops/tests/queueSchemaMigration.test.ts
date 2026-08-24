import { describe, expect, it } from 'vitest'
import { bookingAppointmentMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS } from '../src/sheetSchema'

describe('booking appointment schema migration', () => {
  it('adds queue and appointment columns without shifting existing fields', () => {
    const previous = BOOKING_MASTER_COLUMNS.filter((column) => ![
      'queueType',
      'appointmentStatus',
      'appointmentProposedAt',
      'appointmentConfirmedAt',
      'appointmentConfirmedBy',
    ].includes(column))

    expect(bookingAppointmentMigrationPlan([...previous])).toEqual({
      kind: 'INSERT_APPOINTMENT_COLUMNS',
      afterColumn: 10,
      headers: [
        'queueType',
        'appointmentStatus',
        'appointmentProposedAt',
        'appointmentConfirmedAt',
        'appointmentConfirmedBy',
      ],
    })
  })
})
