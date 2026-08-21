import { buildAdminMinimalReceipt, buildDoctorMinimalReceipt } from '../adapters/minimalReceiptFlex'
import { staffProfileUrlPlan } from '../domain/staffProfileConfig'
import type { BookingCase } from '../domain/types'

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
    customerName: 'PMC Validation',
    customerNameNormalized: 'pmc validation',
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
  ]
}
