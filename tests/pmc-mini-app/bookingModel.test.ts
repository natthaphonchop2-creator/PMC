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
    expect(bookingInput(state)).toMatchObject({
      requestId: 'request-1', customerName: 'ลูกค้าทดสอบ', phone: '0812345678', doctorId: 'doctor-1',
    })
    expect(previewBooking(state, config())).toMatchObject({ doctor: 'หมอ Benz', service: 'เติมไขมัน', channel: 'เพจTAB' })
  })
})

function completeState() {
  let state = initialBooking('request-1')
  const values = {
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phone: '0812345678', aeName: 'ไม่ระบุ',
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
    miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
    channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }],
  }
}
