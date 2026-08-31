import { describe, expect, it } from 'vitest'
import {
  bookingInput,
  initialBooking,
  normalizeThaiPhoneInput,
  previewBooking,
  reduceBooking,
  validateBookingStep,
} from '../../src/apps/pmc-mini-app/bookingModel'
import type { MiniAppConfig } from '../../src/apps/pmc-mini-app/contracts'

describe('PMC Mini App booking wizard model', () => {
  it('clears date and time when automatic queue is selected', () => {
    const initial = { ...initialBooking('request-1'), values: { ...initialBooking('request-1').values, appointmentDate: '2026-09-01', appointmentTime: '13:00' } }
    const state = reduceBooking(initial, { type: 'SET_QUEUE_TYPE', value: 'AUTO' })
    expect(state.values).toMatchObject({ queueType: 'AUTO', appointmentDate: null, appointmentTime: null })
  })

  it('preserves evidence order and refuses an eleventh image', () => {
    let state = initialBooking('request-1')
    state = reduceBooking(state, { type: 'ADD_EVIDENCE', kind: 'CHAT', items: [evidence('chat-1'), evidence('chat-2')] })
    state = reduceBooking(state, {
      type: 'ADD_EVIDENCE', kind: 'CHAT',
      items: Array.from({ length: 8 }, (_, index) => evidence(`chat-${index + 3}`)),
    })
    const unchanged = reduceBooking(state, { type: 'ADD_EVIDENCE', kind: 'CHAT', items: [evidence('chat-11')] })

    expect(state.evidence.CHAT.map(({ id }) => id)).toEqual(Array.from({ length: 10 }, (_, index) => `chat-${index + 1}`))
    expect(unchanged).toEqual(state)
  })

  it('replaces local evidence with the server projection after a successful upload', () => {
    let state = initialBooking('request-1')
    state = reduceBooking(state, {
      type: 'ADD_EVIDENCE', kind: 'PAYMENT', items: [evidence('local-payment')],
    })

    state = reduceBooking(state, {
      type: 'REPLACE_EVIDENCE', kind: 'PAYMENT', items: [evidence('drive-payment')],
    })

    expect(state.evidence.PAYMENT.map(({ id }) => id)).toEqual(['drive-payment'])
  })

  it('normalizes Thai mobile input without dropping a leading zero', () => {
    expect(normalizeThaiPhoneInput('+66 81-234-5678')).toBe('0812345678')
    expect(() => normalizeThaiPhoneInput('123')).toThrow('INVALID_THAI_PHONE')
  })

  it('supports backward navigation without clearing entered values', () => {
    let state = reduceBooking(initialBooking('request-1'), { type: 'SET_VALUE', field: 'customerName', value: 'ลูกค้าทดสอบ' })
    state = reduceBooking(state, { type: 'GO_TO_STEP', step: 1 })
    state = reduceBooking(state, { type: 'GO_BACK' })
    expect(state.step).toBe(0)
    expect(state.values.customerName).toBe('ลูกค้าทดสอบ')
  })

  it('validates each step and projects the exact server input and preview labels', () => {
    const state = completeState()
    expect(validateBookingStep(state, 0, config())).toEqual({})
    expect(bookingInput(state, 2)).toEqual({
      requestId: 'request-1', adminId: 'staff-admin', aeId: null,
      customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phone: '0812345678', doctorId: 'doctor-1',
      serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00',
      depositAmount: 900, channelId: 'channel-1',
    })
    expect(previewBooking(state, config(), 2)).toMatchObject({
      admin: 'แวว', ae: 'ไม่ระบุ', doctor: 'หมอ Benz', service: 'เติมไขมัน', channel: 'เพจTAB',
    })
  })

  it('requires a canonical Admin ID while keeping AE optional', () => {
    const state = completeState()
    state.values.adminId = ''

    expect(validateBookingStep(state, 0, config())).toMatchObject({ adminId: 'กรุณาเลือก Admin' })

    state.values.adminId = 'staff-admin'
    state.values.aeId = 'staff-ae'
    expect(validateBookingStep(state, 0, config())).toEqual({})
    expect(bookingInput(state, 2)).toMatchObject({ adminId: 'staff-admin', aeId: 'staff-ae' })
  })

  it('emits the exact protocol-1 attribution input in bridge mode', () => {
    const state = completeState()
    state.values.aeName = 'หมวย'

    expect(bookingInput(state, 1)).toEqual({
      requestId: 'request-1', aeName: 'หมวย', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    })
  })
})

function completeState() {
  let state = initialBooking('request-1')
  const values = {
    adminId: 'staff-admin', aeId: '', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phone: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', channelId: 'channel-1', queueType: 'NORMAL' as const,
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: '900',
  }
  for (const [field, value] of Object.entries(values)) state = reduceBooking(state, { type: 'SET_VALUE', field: field as keyof typeof state.values, value })
  state = reduceBooking(state, { type: 'ADD_EVIDENCE', kind: 'PAYMENT', items: [evidence('payment-1')] })
  return reduceBooking(state, { type: 'ADD_EVIDENCE', kind: 'CHAT', items: [evidence('chat-1')] })
}

function evidence(id: string) {
  return { id, name: `${id}.png`, size: 100, type: 'image/png', previewUrl: `blob:${id}` }
}

function config(): MiniAppConfig {
  return {
    miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', reportingEnabled: false,
    doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
    channels: [{ id: 'channel-1', name: 'เพจTAB' }],
    bookingProtocol: { supported: 2, minimumMutation: 2, prepare: false },
    admins: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
    aes: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
  }
}
