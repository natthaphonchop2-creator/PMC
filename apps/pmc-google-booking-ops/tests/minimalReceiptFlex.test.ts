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
  payments: [{ previewUrl: 'https://media/pay-preview', fullUrl: 'https://media/pay-full' }],
  chats: [
    { previewUrl: 'https://media/chat-preview', fullUrl: 'https://media/chat-full' },
  ],
  totalPaymentCount: 1,
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

  it('uses short team labels and locks avatar/name columns across both rows', () => {
    const booking = bookingFixture({ adminName: 'มัส', aeName: 'แวว' })
    const profiles = {
      closer: 'https://media.example/assets/staff-profiles/mus.jpg',
      ae: 'https://media.example/assets/staff-profiles/waew.jpg',
    }
    for (const message of [
      buildAdminMinimalReceipt(booking, evidence, logoUrl, profiles),
      buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logoUrl, profiles),
    ]) {
      const rows: Array<Record<string, unknown>> = []
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit)
        if (!value || typeof value !== 'object') return
        const component = value as Record<string, unknown>
        const contents = component.contents as Array<Record<string, unknown>> | undefined
        const firstText = contents?.[0]?.text
        if (
          component.type === 'box' &&
          component.layout === 'horizontal' &&
          ['Admin', 'AE', 'ปิดการจอง', 'AE เปิดแชท'].includes(String(firstText))
        ) rows.push(component)
        Object.values(component).forEach(visit)
      }
      visit(message)

      expect(rows.map((row) => (row.contents as Array<Record<string, unknown>>)[0].text))
        .toEqual(['Admin', 'AE'])
      for (const row of rows) {
        const valueBox = (row.contents as Array<Record<string, unknown>>)[1]
        expect(valueBox).toMatchObject({
          type: 'box',
          layout: 'horizontal',
          flex: 7,
          justifyContent: 'flex-start',
        })
        const [avatar, name] = valueBox.contents as Array<Record<string, unknown>>
        expect(avatar).toMatchObject({ width: '32px', height: '32px', flex: 0 })
        expect(name).toMatchObject({ flex: 1, align: 'start' })
      }
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
        const image = (avatar.contents as Array<Record<string, unknown>>)[0]
        expect(image.type).toBe('image')
        expect(image).not.toHaveProperty('cornerRadius')
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

  it('shows evidence counts without duplicating partial thumbnails', () => {
    const json = JSON.stringify(buildAdminMinimalReceipt(bookingFixture(), evidence, logoUrl))
    expect(json).toContain('สลิป')
    expect(json).toContain('1 รูป')
    expect(json).toContain('แชท')
    expect(json).toContain('5 รูป')
    expect(json).toContain('รูปทั้งหมดแสดงในข้อความถัดไป')
    expect(json).not.toContain('https://media/pay-preview')
    expect(json).not.toContain('https://media/chat-preview')
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
