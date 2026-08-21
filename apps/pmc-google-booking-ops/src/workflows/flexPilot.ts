import type { ConfigPort, LineMessage, LinePort } from '../ports'
import { buildProductionFlexValidationMessages } from './flexValidation'

const PILOT_CASE_ID = 'PMC-FLEX-PILOT-V1'

export function sendProductionFlexPilot(
  config: ConfigPort,
  line: LinePort,
): {
  sentMessages: 2
  adminSent: true
  doctorSent: true
  doctorName: string
} {
  const doctor = config
    .listDoctors()
    .find((item) => item.active && item.name.trim().toLowerCase() === 'หมอ benz')
  if (!doctor?.lineGroupId) throw new Error('Benz doctor LINE group is not configured')

  const logoSuffix = '/assets/pmc-flex-logo-v1.png'
  const logoUrl = config.brandLogoUrl().trim()
  if (!logoUrl.endsWith(logoSuffix)) throw new Error('brand logo URL has an unexpected path')
  const messages = buildProductionFlexValidationMessages(
    logoUrl,
    logoUrl.slice(0, -logoSuffix.length),
  )
  const adminMessage: LineMessage = {
    to: config.adminLineGroupId(),
    audience: 'admin',
    eventType: 'BOOKING_CONFIRMED',
    caseIds: [PILOT_CASE_ID],
    text: String(messages[0].altText),
    apiMessage: messages[0],
    retryKey: `${PILOT_CASE_ID}:ADMIN`,
  }
  const doctorMessage: LineMessage = {
    to: doctor.lineGroupId,
    audience: 'doctor',
    eventType: 'BOOKING_CONFIRMED',
    caseIds: [PILOT_CASE_ID],
    text: String(messages[1].altText),
    apiMessage: messages[1],
    retryKey: `${PILOT_CASE_ID}:DOCTOR-BENZ`,
  }
  line.push(adminMessage)
  line.push(doctorMessage)
  return {
    sentMessages: 2,
    adminSent: true,
    doctorSent: true,
    doctorName: doctor.name,
  }
}
