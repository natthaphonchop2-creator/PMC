import type { BookingIntake } from '../domain/types'
import { BOOKING_FORM_LABELS } from '../config'

export interface BookingFormEventInput {
  responseKey: string
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
