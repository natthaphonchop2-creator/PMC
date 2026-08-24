import { describe, expect, it } from 'vitest'
import { parseBookingFormEvent } from '../src/adapters/googleForms'
import { bookingMasterMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS } from '../src/sheetSchema'

describe('Facebook booking schema regression', () => {
  it('keeps Facebook name between customer name and normalized customer data', () => {
    expect(BOOKING_MASTER_COLUMNS.slice(10, 13)).toEqual([
      'customerName',
      'facebookName',
      'customerNameNormalized',
    ])
  })

  it('parses the required Facebook name from the booking Form', () => {
    const intake = parseBookingFormEvent({
      responseKey: 'response-facebook',
      submittedAt: '2026-08-23T13:58:57+07:00',
      submitterEmail: 'admin@example.com',
      namedValues: {
        Admin: ['มัส'],
        AE: ['หมวย'],
        ชื่อลูกค้า: ['พิมพ์ชนก ท่าน้ำเที่ยง'],
        'ชื่อ Facebook': ['Mew Tanjung'],
        เบอร์มือถือ: ['0616107862'],
        หมอ: ['หมอ Benz'],
        'บริการ/โปรแกรม': ['เติมไขมัน'],
        วันที่นัด: ['2026-08-23'],
        เวลานัด: ['14:00'],
        จำนวนเงินจอง: ['900'],
        'เพจคลินิก/ช่องทาง': ['เพจTAB'],
        สลิปเงินจอง: ['payment-file-id-123456789012345'],
        หลักฐานแชท: ['chat-file-id-123456789012345'],
      },
    })

    expect(intake).toMatchObject({ facebookName: 'Mew Tanjung' })
  })

  it('plans a single Facebook column insertion for the former schema', () => {
    const preFacebook = BOOKING_MASTER_COLUMNS.filter((column) => column !== 'facebookName')
    expect(bookingMasterMigrationPlan([...preFacebook])).toEqual({
      kind: 'INSERT_FACEBOOK_NAME_COLUMN',
      afterColumn: 11,
      headers: ['facebookName'],
    })
  })
})
