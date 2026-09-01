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
    expect(json).toContain('สลิป')
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

  it('renders recorder as muted text-only while keeping Admin and AE avatars', () => {
    const profiles = {
      recorder: 'https://media.example/assets/staff-profiles/recorder.jpg',
      closer: 'https://media.example/assets/staff-profiles/mus.jpg',
      ae: 'https://media.example/assets/staff-profiles/waew.jpg',
    }
    for (const message of [
      buildAdminMinimalReceipt(bookingFixture({ recorderName: 'หมวย', adminName: 'มัส', aeName: 'แวว' }), evidence, logoUrl, profiles),
      buildDoctorMinimalReceipt(
        bookingFixture({ recorderName: 'หมวย', adminName: 'มัส', aeName: 'แวว' }),
        'BOOKING_CONFIRMED',
        logoUrl,
        profiles,
      ),
    ]) {
      const rows: Array<Record<string, unknown>> = []
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit)
        if (!value || typeof value !== 'object') return
        const component = value as Record<string, unknown>
        const contents = component.contents as Array<Record<string, unknown>> | undefined
        if (
          component.type === 'box' && component.layout === 'horizontal'
          && ['ผู้บันทึก', 'Admin', 'AE'].includes(String(contents?.[0]?.text))
        ) rows.push(component)
        Object.values(component).forEach(visit)
      }
      visit(message)

      const recorderContents = ((rows[0]!.contents as Array<Record<string, unknown>>)[1].contents) as Array<Record<string, unknown>>
      expect(recorderContents).toHaveLength(1)
      expect(recorderContents[0]).toMatchObject({ text: 'หมวย', color: '#77716D', size: 'sm' })
      expect(recorderContents[0]).not.toHaveProperty('weight')

      for (const row of rows.slice(1)) {
        const valueContents = ((row.contents as Array<Record<string, unknown>>)[1].contents) as Array<Record<string, unknown>>
        expect(valueContents).toHaveLength(2)
        expect(valueContents[0]).toMatchObject({ width: '32px', height: '32px', flex: 0 })
        expect(valueContents[1]).toMatchObject({ color: '#282624', weight: 'bold' })
      }
      const json = JSON.stringify(message)
      expect(json).not.toContain(profiles.recorder)
      expect(json).toContain(profiles.closer)
      expect(json).toContain(profiles.ae)
    }
  })

  it('uses short team labels and locks Admin and AE avatar/name columns', () => {
    const booking = bookingFixture({ adminName: 'มัส', aeName: 'แวว' })
    const profiles = {
      recorder: 'https://media.example/assets/staff-profiles/recorder.jpg',
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
          ['ผู้บันทึก', 'Admin', 'AE', 'ปิดการจอง', 'AE เปิดแชท'].includes(String(firstText))
        ) rows.push(component)
        Object.values(component).forEach(visit)
      }
      visit(message)

      expect(rows.map((row) => (row.contents as Array<Record<string, unknown>>)[0].text))
        .toEqual(['ผู้บันทึก', 'Admin', 'AE'])
      const recorderValueBox = (rows[0]!.contents as Array<Record<string, unknown>>)[1]
      expect(recorderValueBox.contents).toHaveLength(1)
      expect((recorderValueBox.contents as Array<Record<string, unknown>>)[0])
        .toMatchObject({ flex: 1, align: 'start', color: '#77716D' })

      for (const row of rows.slice(1)) {
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
      recorder: 'https://media.example/assets/staff-profiles/recorder.jpg',
      closer: 'https://media.example/assets/staff-profiles/mus.jpg',
      ae: 'https://media.example/assets/staff-profiles/waew.jpg',
    }
    for (const message of [
      buildAdminMinimalReceipt(booking, evidence, logoUrl, profiles),
      buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logoUrl, profiles),
    ]) {
      const json = JSON.stringify(message)
      expect(json).not.toContain(profiles.recorder)
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

  it('shows at most four small slip-first thumbnails that open the full images', () => {
    const thumbnailEvidence = {
      payments: [
        { previewUrl: 'https://media/pay-1-preview', fullUrl: 'https://media/pay-1-full' },
        { previewUrl: 'https://media/pay-2-preview', fullUrl: 'https://media/pay-2-full' },
      ],
      chats: [1, 2, 3, 4].map((index) => ({
        previewUrl: `https://media/chat-${index}-preview`,
        fullUrl: `https://media/chat-${index}-full`,
      })),
      totalPaymentCount: 2,
      totalChatCount: 4,
    }
    const json = JSON.stringify(buildAdminMinimalReceipt(
      bookingFixture({ driveFolderUrl: 'https://drive.google.com/drive/folders/case-1' }),
      thumbnailEvidence,
      logoUrl,
    ))

    expect(json).toContain('https://media/pay-1-preview')
    expect(json).toContain('https://media/pay-2-preview')
    expect(json).toContain('https://media/chat-1-preview')
    expect(json).toContain('https://media/chat-2-preview')
    expect(json).not.toContain('https://media/chat-3-preview')
    expect(json).not.toContain('https://media/chat-4-preview')
    expect(json).toContain('https://media/pay-1-full')
    expect(json).toContain('https://media/chat-2-full')
    expect(json).toContain('แสดง 4 จากทั้งหมด 6 รูป')
    expect(json).toContain('https://drive.google.com/drive/folders/case-1')
    expect((json.match(/"aspectRatio":"1:1"/g) ?? [])).toHaveLength(5)
    expect(json).not.toContain('รูปทั้งหมดแสดงในข้อความถัดไป')
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
