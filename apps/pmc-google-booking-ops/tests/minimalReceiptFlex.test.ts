import { describe, expect, it } from 'vitest'
import {
  buildAdminMinimalReceipt,
  buildDoctorMinimalReceipt,
  formatThaiAppointment,
} from '../src/adapters/minimalReceiptFlex'
import { bookingFixture } from './helpers/fakes'

const logoUrl = 'https://evidence.example/assets/pmc-flex-logo-v1.png'
const evidence = {
  payment: { previewUrl: 'https://media/pay-preview', fullUrl: 'https://media/pay-full' },
  chats: [
    { previewUrl: 'https://media/chat-preview', fullUrl: 'https://media/chat-full' },
  ],
  totalChatCount: 5,
}

describe('Minimal Receipt Flex', () => {
  it('formats Bangkok appointment text with Thai month and Buddhist Era year', () => {
    expect(formatThaiAppointment('2026-08-21T05:00:00+07:00')).toEqual({
      date: '21 สิงหาคม 2569',
      time: 'เวลา 05:00 น.',
    })
  })

  it('uses real header/body blocks and omits rejected decorations', () => {
    const payload = buildAdminMinimalReceipt(
      bookingFixture({ appointmentStart: '2026-08-21T05:00:00+07:00' }),
      evidence,
      logoUrl,
    )
    const json = JSON.stringify(payload)
    expect(payload.contents).toMatchObject({
      type: 'bubble',
      header: { type: 'box' },
      body: { type: 'box' },
    })
    expect(json).toContain('PROMED CLINIC')
    expect(json).toContain('21 สิงหาคม 2569')
    expect(json).not.toContain('PMC-202608-0001')
    expect(json).not.toContain('ยืนยันแล้ว')
    expect(json).not.toContain('สลิป 1')
    expect(json).not.toContain('รูปเพิ่มเติม')
    expect(json).not.toContain('"hero"')
    expect(json).not.toContain('"footer"')
  })

  it('shows closer and AE names in both audiences without email', () => {
    const booking = bookingFixture({
      adminName: 'มัส',
      aeName: 'เอม',
      submitterEmail: 'mus@example.com',
    })
    for (const message of [
      buildAdminMinimalReceipt(booking, evidence, logoUrl),
      buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logoUrl),
    ]) {
      const json = JSON.stringify(message)
      expect(json).toContain('มัส')
      expect(json).toContain('เอม')
      expect(json).not.toContain('mus@example.com')
    }
  })

  it('uses fixed square evidence slots with payment fit and chat cover', () => {
    const json = JSON.stringify(
      buildAdminMinimalReceipt(bookingFixture(), evidence, logoUrl),
    )
    expect(json).toContain('"aspectRatio":"1:1"')
    expect(json).toContain('"aspectMode":"fit"')
    expect(json).toContain('"aspectMode":"cover"')
    expect((json.match(/"type":"filler"/g) ?? [])).toHaveLength(2)
  })

  it('keeps doctor payload evidence, deposit, and channel free', () => {
    const json = JSON.stringify(
      buildDoctorMinimalReceipt(bookingFixture(), 'BOOKING_CONFIRMED', logoUrl),
    )
    expect(json).not.toContain('media/')
    expect(json).not.toContain('ยอดจอง')
    expect(json).not.toContain('ช่องทาง')
    expect(json).not.toContain('หลักฐาน')
  })

  it('labels missing historical AE attribution without guessing', () => {
    const json = JSON.stringify(
      buildDoctorMinimalReceipt(
        bookingFixture({ aeId: null, aeName: null, adminIdentityStatus: 'SHARED_ACCOUNT' }),
        'RESCHEDULED',
        logoUrl,
      ),
    )
    expect(json).toContain('ไม่ระบุ (เคสเดิม)')
  })
})
