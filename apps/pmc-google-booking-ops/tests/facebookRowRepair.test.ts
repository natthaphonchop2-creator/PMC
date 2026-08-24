import { describe, expect, it } from 'vitest'
import { repairShiftedFacebookBookingRow } from '../src/domain/facebookRowRepair'
import { BOOKING_MASTER_COLUMNS } from '../src/sheetSchema'

function correctRow(): Array<string | number | boolean> {
  const values: Record<string, string | number | boolean> = {
    caseId: 'PMC-202608-0007',
    version: 2,
    status: 'FORM_SUBMITTED',
    formResponseId: 'response-7',
    customerName: 'พิมพ์ชนก ท่าน้ำเที่ยง',
    facebookName: 'Mew Tanjung',
    customerNameNormalized: 'พิมพ์ชนกท่าน้ำเที่ยง',
    phoneNormalized: '0616107862',
    phoneMasked: '061-xxx-7862',
    doctorId: 'หมอ Benz',
    serviceId: 'เติมไขมัน',
    channelId: 'เพจTAB',
    appointmentStart: '2026-08-23T14:00:00+07:00',
    appointmentEnd: '2026-08-23T15:00:00+07:00',
    calendarId: 'promedcalender@gmail.com',
    doctorLineGroupId: 'C-notice-group',
    calendarState: 'PENDING',
    lineState: 'PENDING',
  }
  return BOOKING_MASTER_COLUMNS.map((column) => values[column] ?? '')
}

describe('shifted Facebook booking row repair', () => {
  it('restores every field after customerName without losing the final value', () => {
    const expected = correctRow()
    const facebookIndex = BOOKING_MASTER_COLUMNS.indexOf('facebookName')
    const shifted = [
      ...expected.slice(0, facebookIndex),
      ...expected.slice(facebookIndex + 1),
      '',
    ]

    expect(repairShiftedFacebookBookingRow(
      [...BOOKING_MASTER_COLUMNS],
      shifted,
      'Mew Tanjung',
    )).toEqual(expected)
  })

  it('refuses to shift a row that is already aligned', () => {
    expect(() => repairShiftedFacebookBookingRow(
      [...BOOKING_MASTER_COLUMNS],
      correctRow(),
      'Mew Tanjung',
    )).toThrow('booking row is not Facebook-shifted')
  })

  it('overrides fields that were remapped again by a later Sheet update', () => {
    const expected = correctRow()
    const facebookIndex = BOOKING_MASTER_COLUMNS.indexOf('facebookName')
    const calendarEventIndex = BOOKING_MASTER_COLUMNS.indexOf('calendarEventId')
    const compounded = [
      ...expected.slice(0, facebookIndex),
      ...expected.slice(facebookIndex + 1),
      '',
    ]
    compounded[calendarEventIndex - 1] = 'C-notice-group'

    expect(repairShiftedFacebookBookingRow(
      [...BOOKING_MASTER_COLUMNS],
      compounded,
      'Mew Tanjung',
      Object.fromEntries(BOOKING_MASTER_COLUMNS.map((column, index) => [column, expected[index]])),
    )).toEqual(expected)
  })
})
