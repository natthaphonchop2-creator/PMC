import type { BookingIntake, CallResult } from '../domain/types'
import { BOOKING_FORM_LABELS } from '../config'

export interface BookingFormEventInput {
  responseKey: string
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

export interface CallResultFormEventInput {
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

function requiredValue(namedValues: Record<string, string[]>, label: string): string {
  const value = namedValues[label]?.[0]?.trim()
  if (!value) throw new Error(`missing Form field: ${label}`)
  return value
}

function driveFileIds(value: string): string[] {
  return [...new Set(value.match(/[\w-]{20,}/g) ?? [])]
}

export function parseBookingFormEvent(event: BookingFormEventInput): BookingIntake {
  return {
    formResponseId: event.responseKey,
    submittedAt: event.submittedAt,
    submitterEmail: event.submitterEmail.trim().toLowerCase(),
    adminName: requiredValue(event.namedValues, BOOKING_FORM_LABELS.adminName),
    customerName: requiredValue(event.namedValues, BOOKING_FORM_LABELS.customerName),
    phone: requiredValue(event.namedValues, BOOKING_FORM_LABELS.phone),
    doctorId: requiredValue(event.namedValues, BOOKING_FORM_LABELS.doctorId),
    serviceId: requiredValue(event.namedValues, BOOKING_FORM_LABELS.serviceId),
    appointmentDate: requiredValue(event.namedValues, BOOKING_FORM_LABELS.appointmentDate),
    appointmentTime: requiredValue(event.namedValues, BOOKING_FORM_LABELS.appointmentTime),
    depositAmount: Number(requiredValue(event.namedValues, BOOKING_FORM_LABELS.depositAmount).replace(/,/g, '')),
    paymentEvidenceFileIds: driveFileIds(requiredValue(event.namedValues, BOOKING_FORM_LABELS.paymentEvidence)),
    chatEvidenceFileIds: driveFileIds(requiredValue(event.namedValues, BOOKING_FORM_LABELS.chatEvidence)),
  }
}

const CALL_RESULTS = new Set<CallResult>([
  'REBOOKED',
  'NO_ANSWER',
  'CALL_BACK_REQUESTED',
  'NOT_READY',
  'DECLINED',
  'WRONG_NUMBER',
])

export function parseCallResultFormEvent(event: CallResultFormEventInput): {
  caseId: string
  result: CallResult
  nextCallAt: string | null
  note: string
  actor: string
} {
  const result = requiredValue(event.namedValues, 'ผลการโทร') as CallResult
  if (!CALL_RESULTS.has(result)) throw new Error('unsupported call result')
  const nextDate = event.namedValues['วันโทรครั้งถัดไป']?.[0]?.trim() ?? ''
  return {
    caseId: requiredValue(event.namedValues, 'Case ID'),
    result,
    nextCallAt: nextDate ? `${nextDate}T09:00:00+07:00` : null,
    note: event.namedValues['หมายเหตุ']?.[0]?.trim() ?? '',
    actor: event.submitterEmail.trim().toLowerCase(),
  }
}
