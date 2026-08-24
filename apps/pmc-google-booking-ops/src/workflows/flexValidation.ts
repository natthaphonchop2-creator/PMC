import { buildAdminMinimalReceipt, buildDoctorMinimalReceipt } from '../adapters/minimalReceiptFlex'
import { buildCallReminderFlex, callReminderTiming } from '../adapters/callReminderFlex'
import { staffProfileUrlPlan } from '../domain/staffProfileConfig'
import type { BookingCase, CallTask } from '../domain/types'

export function lineValidationPropertyPaths(responseBody: string): string[] {
  try {
    const parsed = JSON.parse(responseBody) as { details?: Array<{ property?: unknown }> }
    const paths = (parsed.details ?? [])
      .map((detail) => detail.property)
      .filter((property): property is string =>
        typeof property === 'string' && /^(?:[A-Za-z0-9_./-]|\[|\]){1,240}$/.test(property),
      )
    return [...new Set(paths)].slice(0, 10)
  } catch {
    return []
  }
}

export function buildProductionFlexValidationMessages(
  brandLogoUrl: string,
  baseUrl: string,
): Record<string, unknown>[] {
  const profiles = staffProfileUrlPlan(
    ['แคท', 'มัส', 'มิ้น', 'แวว', 'หมวย', 'อาย', 'ฝ้าย', 'Admin'],
    baseUrl,
  )
  const profileUrl = (name: string) =>
    profiles.find((profile) => profile.name === name)?.profileImageUrl ?? null
  const booking = {
    caseId: 'PMC-VALIDATION',
    version: 1,
    status: 'BOOKING_CONFIRMED',
    formResponseId: 'synthetic-flex-validation',
    adminId: 'validation-closer',
    adminName: 'มัส',
    submitterEmail: 'synthetic@example.invalid',
    adminIdentityStatus: 'SHARED_ACCOUNT',
    aeId: 'validation-ae',
    aeName: 'แวว',
    queueType: 'NORMAL',
    appointmentStatus: 'CONFIRMED',
    appointmentProposedAt: null,
    appointmentConfirmedAt: null,
    appointmentConfirmedBy: null,
    customerName: 'PMC Validation',
    customerNameNormalized: 'pmc validation',
    facebookName: 'PMC Validation',
    phoneNormalized: '0800000000',
    phoneMasked: '080-XXX-XXXX',
    doctorId: 'แพทย์ทดสอบระบบ',
    serviceId: 'โปรแกรมทดสอบระบบ',
    channelId: 'ระบบทดสอบ',
    appointmentStart: '2026-08-21T10:30:00+07:00',
    appointmentEnd: '2026-08-21T11:30:00+07:00',
    depositAmount: 900,
    depositReceivedAt: '2026-08-21T09:00:00+07:00',
    depositExpiresAt: '2027-02-21T09:00:00+07:00',
    depositStatus: 'VALID',
    driveFolderId: null,
    driveFolderUrl: null,
    paymentEvidenceCount: 1,
    chatEvidenceCount: 1,
    calendarId: null,
    calendarEventId: null,
    doctorLineGroupId: null,
    doctorLineNotifiedAt: null,
    callStatus: 'PENDING',
    firstCallWindowStart: '2026-08-21T00:00:00+07:00',
    firstCallWindowEnd: '2026-08-27T23:59:59+07:00',
    nextCallAt: '2026-08-21T09:00:00+07:00',
    lastCallAt: null,
    callOwnerAdminId: 'validation-closer',
    jeraPaymentId: null,
    jeraStatus: null,
    jeraClosedAt: null,
    jeraActualRevenue: null,
    jeraImportFileId: null,
    reconciliationStatus: 'NONE',
    commissionEligibility: 'NOT_ELIGIBLE',
    commissionAmount: null,
    driveState: 'OK',
    calendarState: 'OK',
    lineState: 'PENDING',
    jeraImportState: 'NOT_IMPORTED',
    createdAt: '2026-08-21T09:00:00+07:00',
    createdBy: 'system-validation',
    updatedAt: '2026-08-21T09:00:00+07:00',
    updatedBy: 'system-validation',
  } satisfies BookingCase
  const teamProfiles = { closer: profileUrl('มัส'), ae: profileUrl('แวว') }
  const callTiming = callReminderTiming('2026-08-21T09:00:00+07:00', '2026-08-21T09:00:00+07:00')
  const callCards = Array.from({ length: 10 }, (_, index) => {
    const caseId = `PMC-VALIDATION-${String(index + 1).padStart(2, '0')}`
    return {
      booking: {
        ...booking,
        caseId,
        customerName: `PMC Validation ${index + 1}`,
      } satisfies BookingCase,
      task: {
        taskId: `CALL-${caseId}-1`,
        caseId,
        ownerAdminId: 'validation-closer',
        status: 'PENDING',
        windowStart: '2026-08-21T00:00:00+07:00',
        windowEnd: '2026-08-27T23:59:59+07:00',
        nextCallAt: '2026-08-21T09:00:00+07:00',
        lastReminderDate: null,
        result: null,
        note: '',
        version: 1,
      } satisfies CallTask,
      timing: callTiming,
      callResultUrl: `https://docs.google.com/forms/d/e/validation/viewform?case=${caseId}`,
    }
  })
  return [
    buildAdminMinimalReceipt(
      booking,
      {
        payment: {
          previewUrl: `${baseUrl}/assets/pmc-flex-logo-v1.png`,
          fullUrl: `${baseUrl}/assets/pmc-flex-logo-v1.png`,
        },
        chats: [
          {
            previewUrl: `${baseUrl}/assets/staff-profiles/cat.jpg`,
            fullUrl: `${baseUrl}/assets/staff-profiles/cat.jpg`,
          },
        ],
        totalChatCount: 1,
      },
      brandLogoUrl,
      teamProfiles,
    ),
    buildDoctorMinimalReceipt(
      booking,
      'BOOKING_CONFIRMED',
      brandLogoUrl,
      teamProfiles,
    ),
    buildCallReminderFlex(
      callCards,
      2,
      'https://docs.google.com/spreadsheets/d/validation/edit#gid=1',
    ),
  ]
}
