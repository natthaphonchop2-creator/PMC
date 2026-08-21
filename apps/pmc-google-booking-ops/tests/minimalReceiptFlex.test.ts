import { describe, expect, it } from 'vitest'
import {
  buildAdminTimeConflictReceipt,
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

  it('shows circular profile images before closer and AE names in both audiences', () => {
    const booking = bookingFixture({ adminName: 'มัส', aeName: 'แวว' })
    const profiles = {
      closer: 'https://media.example/assets/staff-profiles/mus.jpg',
      ae: 'https://media.example/assets/staff-profiles/waew.jpg',
    }
    for (const message of [
      buildAdminMinimalReceipt(booking, evidence, logoUrl, profiles),
      buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logoUrl, profiles),
    ]) {
      const json = JSON.stringify(message)
      expect(json).toContain(profiles.closer)
      expect(json).toContain(profiles.ae)

      const avatars: Array<Record<string, unknown>> = []
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit)
        if (!value || typeof value !== 'object') return
        const component = value as Record<string, unknown>
        if (
          component.type === 'box' &&
          component.width === '32px' &&
          component.height === '32px' &&
          component.cornerRadius === '16px'
        ) avatars.push(component)
        Object.values(component).forEach(visit)
      }
      visit(message)
      expect(avatars).toHaveLength(2)
      for (const avatar of avatars) {
        expect(JSON.stringify(avatar)).toContain('"aspectRatio":"1:1"')
        expect(JSON.stringify(avatar)).toContain('"aspectMode":"cover"')
      }
    }
  })

  it('keeps an empty circular avatar when a staff profile is missing', () => {
    const json = JSON.stringify(
      buildDoctorMinimalReceipt(
        bookingFixture({ adminName: 'ฝ้าย', aeName: 'ฝ้าย' }),
        'BOOKING_CONFIRMED',
        logoUrl,
        { closer: null, ae: null },
      ),
    )
    expect((json.match(/"width":"32px"/g) ?? [])).toHaveLength(2)
    expect(json).toContain('"backgroundColor":"#F4F1EC"')
    expect(json).not.toContain('staff-profiles')
  })

  it('uses fixed square evidence slots with payment fit and chat cover', () => {
    const payload = buildAdminMinimalReceipt(bookingFixture(), evidence, logoUrl)
    const json = JSON.stringify(payload)
    expect(json).toContain('"aspectRatio":"1:1"')
    expect(json).toContain('"aspectMode":"fit"')
    expect(json).toContain('"aspectMode":"cover"')
    expect((json.match(/"type":"filler"/g) ?? [])).toHaveLength(2)

    const roundedFrames: Array<Record<string, unknown>> = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!value || typeof value !== 'object') return
      const component = value as Record<string, unknown>
      if (component.type === 'box' && component.cornerRadius === 'md') roundedFrames.push(component)
      Object.values(component).forEach(visit)
    }
    visit(payload)

    expect(roundedFrames).toHaveLength(2)
    for (const frame of roundedFrames) {
      expect(frame).toMatchObject({
        type: 'box',
        layout: 'vertical',
        cornerRadius: 'md',
        backgroundColor: '#F6F5F3',
      })
      expect(JSON.stringify(frame)).toContain('"type":"image"')
      expect(JSON.stringify(frame)).toContain('"label":"เปิดรูปขนาดเต็ม"')
    }
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

  it('builds an Admin-only warning receipt for an unconfirmed time conflict', () => {
    const json = JSON.stringify(
      buildAdminTimeConflictReceipt(
        bookingFixture({
          status: 'TIME_CONFLICT',
          calendarState: 'CONFLICT',
          adminName: 'ทดสอบ',
          aeName: 'มัส',
        }),
        logoUrl,
      ),
    )

    expect(json).toContain('นัดซ้อน — ยังไม่ยืนยัน')
    expect(json).toContain('ยังไม่สร้าง Calendar')
    expect(json).toContain('ยังไม่แจ้งกลุ่มหมอ')
    expect(json).toContain('ลูกค้าทดสอบ')
    expect(json).toContain('0812345678')
    expect(json).toContain('ทดสอบ')
    expect(json).toContain('มัส')
    expect(json).not.toContain('หลักฐาน')
  })
})
