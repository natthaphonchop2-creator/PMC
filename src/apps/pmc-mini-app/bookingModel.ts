import type { BookingProtocolVersion } from '../../../shared/pmcBookingProtocol'
import {
  bookingProtocolVersion,
  type BookingDraftInput,
  type BookingDraftInputV1,
  type BookingDraftInputV2,
  type BookingQueueType,
  type MiniAppConfig,
} from './contracts'

export interface BookingEvidenceItem {
  id: string
  name: string
  size: number
  type: string
  previewUrl: string
  file?: File
}

export interface BookingValues {
  requestId: string
  adminId: string
  aeId: string
  aeName: string
  customerName: string
  facebookName: string
  phone: string
  doctorId: string
  serviceId: string
  queueType: BookingQueueType
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: string
  channelId: string
}

export interface BookingWizardState {
  step: number
  values: BookingValues
  evidence: { PAYMENT: BookingEvidenceItem[]; CHAT: BookingEvidenceItem[] }
}

export type BookingWizardAction =
  | { type: 'SET_VALUE'; field: keyof BookingValues; value: string }
  | { type: 'SET_QUEUE_TYPE'; value: BookingQueueType }
  | { type: 'ADD_EVIDENCE'; kind: 'PAYMENT' | 'CHAT'; items: BookingEvidenceItem[] }
  | { type: 'REPLACE_EVIDENCE'; kind: 'PAYMENT' | 'CHAT'; items: BookingEvidenceItem[] }
  | { type: 'REMOVE_EVIDENCE'; kind: 'PAYMENT' | 'CHAT'; id: string }
  | { type: 'GO_TO_STEP'; step: number }
  | { type: 'GO_BACK' }

export function initialBooking(requestId = ''): BookingWizardState {
  return {
    step: 0,
    values: {
      requestId,
      adminId: '',
      aeId: '',
      aeName: 'ไม่ระบุ',
      customerName: '',
      facebookName: '',
      phone: '',
      doctorId: '',
      serviceId: '',
      queueType: 'NORMAL',
      appointmentDate: null,
      appointmentTime: null,
      depositAmount: '',
      channelId: '',
    },
    evidence: { PAYMENT: [], CHAT: [] },
  }
}

export function reduceBooking(state: BookingWizardState, action: BookingWizardAction): BookingWizardState {
  if (action.type === 'SET_VALUE') {
    return { ...state, values: { ...state.values, [action.field]: action.value } }
  }
  if (action.type === 'SET_QUEUE_TYPE') {
    return {
      ...state,
      values: {
        ...state.values,
        queueType: action.value,
        ...(action.value === 'AUTO' ? { appointmentDate: null, appointmentTime: null } : {}),
      },
    }
  }
  if (action.type === 'ADD_EVIDENCE') {
    const current = state.evidence[action.kind]
    if (current.length + action.items.length > 10) return state
    const existing = new Set(current.map(({ id }) => id))
    const unique = action.items.filter(({ id }) => !existing.has(id))
    if (current.length + unique.length > 10) return state
    return { ...state, evidence: { ...state.evidence, [action.kind]: [...current, ...unique] } }
  }
  if (action.type === 'REPLACE_EVIDENCE') {
    return { ...state, evidence: { ...state.evidence, [action.kind]: action.items } }
  }
  if (action.type === 'REMOVE_EVIDENCE') {
    return {
      ...state,
      evidence: { ...state.evidence, [action.kind]: state.evidence[action.kind].filter(({ id }) => id !== action.id) },
    }
  }
  if (action.type === 'GO_TO_STEP') return { ...state, step: Math.max(0, Math.min(5, action.step)) }
  return { ...state, step: Math.max(0, state.step - 1) }
}

export function validateBookingStep(
  state: BookingWizardState,
  step: number,
  config: MiniAppConfig,
  protocolVersion: BookingProtocolVersion = bookingProtocolVersion(config),
): Record<string, string> {
  const errors: Record<string, string> = {}
  const values = state.values
  if (step === 0 || step === 4) {
    if (protocolVersion === 2) {
      if (!config.admins.some(({ id }) => id === values.adminId)) errors.adminId = 'กรุณาเลือก Admin'
      if (values.aeId && !config.aes.some(({ id }) => id === values.aeId)) errors.aeId = 'กรุณาเลือก AE'
    } else if (values.aeName !== 'ไม่ระบุ' && !config.aes.some(({ name }) => name === values.aeName)) {
      errors.aeName = 'กรุณาเลือก AE'
    }
    if (!values.customerName.trim()) errors.customerName = 'กรุณากรอกชื่อลูกค้า'
    if (!values.facebookName.trim()) errors.facebookName = 'กรุณากรอกชื่อ Facebook หรือคำว่า ไม่มี'
    try { normalizeThaiPhoneInput(values.phone) } catch { errors.phone = 'กรุณากรอกเบอร์มือถือให้ถูกต้อง' }
  }
  if (step === 1 || step === 4) {
    if (!config.doctors.some(({ id }) => id === values.doctorId)) errors.doctorId = 'กรุณาเลือกแพทย์'
    if (!config.services.some(({ id }) => id === values.serviceId)) errors.serviceId = 'กรุณาเลือกโปรแกรม'
    if (!config.channels.some(({ id }) => id === values.channelId)) errors.channelId = 'กรุณาเลือกช่องทาง'
  }
  if (step === 2 || step === 4) {
    if (values.queueType === 'NORMAL') {
      if (!values.appointmentDate) errors.appointmentDate = 'กรุณาเลือกวันที่นัด'
      if (!values.appointmentTime) errors.appointmentTime = 'กรุณาเลือกเวลานัด'
    }
  }
  if (step === 3 || step === 4) {
    const deposit = Number(values.depositAmount)
    if (!Number.isFinite(deposit) || deposit <= 0) errors.depositAmount = 'กรุณากรอกยอดจอง'
    if (state.evidence.PAYMENT.length === 0) errors.paymentEvidence = 'กรุณาแนบสลิปอย่างน้อย 1 รูป'
    if (state.evidence.CHAT.length === 0) errors.chatEvidence = 'กรุณาแนบแชทอย่างน้อย 1 รูป'
  }
  return errors
}

export function normalizeThaiPhoneInput(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('66') && digits.length >= 11) digits = `0${digits.slice(2)}`
  if (!/^0\d{8,9}$/.test(digits)) throw new Error('INVALID_THAI_PHONE')
  return digits
}

export function bookingInput(
  state: BookingWizardState,
  protocolVersion: BookingProtocolVersion = 2,
): BookingDraftInput {
  const common = {
    requestId: state.values.requestId,
    customerName: state.values.customerName.trim(),
    facebookName: state.values.facebookName.trim(),
    phone: normalizeThaiPhoneInput(state.values.phone),
    doctorId: state.values.doctorId,
    serviceId: state.values.serviceId,
    queueType: state.values.queueType,
    appointmentDate: state.values.queueType === 'AUTO' ? null : state.values.appointmentDate,
    appointmentTime: state.values.queueType === 'AUTO' ? null : state.values.appointmentTime,
    depositAmount: Number(state.values.depositAmount),
    channelId: state.values.channelId,
  }
  if (protocolVersion === 1) return { ...common, aeName: state.values.aeName } satisfies BookingDraftInputV1
  return {
    ...common,
    adminId: state.values.adminId,
    aeId: state.values.aeId || null,
  } satisfies BookingDraftInputV2
}

export function previewBooking(
  state: BookingWizardState,
  config: MiniAppConfig,
  protocolVersion: BookingProtocolVersion = bookingProtocolVersion(config),
) {
  const common = {
    customerName: state.values.customerName.trim(),
    facebookName: state.values.facebookName.trim(),
    phone: normalizeThaiPhoneInput(state.values.phone),
    doctor: config.doctors.find(({ id }) => id === state.values.doctorId)?.name ?? '',
    service: config.services.find(({ id }) => id === state.values.serviceId)?.name ?? '',
    channel: config.channels.find(({ id }) => id === state.values.channelId)?.name ?? '',
    queueType: state.values.queueType,
    appointmentDate: state.values.appointmentDate,
    appointmentTime: state.values.appointmentTime,
    depositAmount: Number(state.values.depositAmount),
    paymentCount: state.evidence.PAYMENT.length,
    chatCount: state.evidence.CHAT.length,
  }
  if (protocolVersion === 1) return { ...common, admin: '', ae: state.values.aeName }
  return {
    ...common,
    admin: config.admins.find(({ id }) => id === state.values.adminId)?.name ?? '',
    ae: state.values.aeId
      ? config.aes.find(({ id }) => id === state.values.aeId)?.name ?? ''
      : 'ไม่ระบุ',
  }
}
