export type BookingStatus =
  | 'FORM_SUBMITTED'
  | 'VALIDATION_ERROR'
  | 'TIME_CONFLICT'
  | 'BOOKING_CONFIRMED'
  | 'CALL_ACTIVE'
  | 'CALL_OVERDUE'
  | 'REBOOKED'
  | 'CLOSED_JERA'
  | 'REFUNDED'
  | 'EXPIRED_6M'
  | 'RECONCILIATION'

export type CallStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'OVERDUE' | 'CANCELLED'
export type CommissionEligibility = 'NOT_ELIGIBLE' | 'PENDING_RULE' | 'ELIGIBLE'
export type StepState = 'PENDING' | 'OK' | 'RETRY' | 'FAILED'
export type CallResult = 'REBOOKED' | 'NO_ANSWER' | 'CALL_BACK_REQUESTED' | 'NOT_READY' | 'DECLINED' | 'WRONG_NUMBER'
export type AdminIdentityStatus = 'SHARED_ACCOUNT' | 'VERIFIED_EMAIL'

export interface CallTask {
  taskId: string
  caseId: string
  ownerAdminId: string
  status: 'PENDING' | 'ACTIVE' | 'DONE' | 'OVERDUE' | 'CANCELLED'
  windowStart: string
  windowEnd: string
  nextCallAt: string
  lastReminderDate: string | null
  result: CallResult | null
  note: string
  version: number
}

export interface BookingIntake {
  formResponseId: string
  submittedAt: string
  submitterEmail: string
  aeName: string
  customerName: string
  phone: string
  doctorId: string
  serviceId: string
  appointmentDate: string
  appointmentTime: string
  depositAmount: number
  channelId: string | null
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
}

export interface BookingCase {
  caseId: string
  version: number
  status: BookingStatus
  formResponseId: string
  adminId: string | null
  adminName: string
  submitterEmail: string
  adminIdentityStatus: AdminIdentityStatus
  aeId: string | null
  aeName: string | null
  customerName: string
  customerNameNormalized: string
  phoneNormalized: string
  phoneMasked: string
  doctorId: string
  serviceId: string
  channelId: string | null
  appointmentStart: string
  appointmentEnd: string
  depositAmount: number
  depositReceivedAt: string
  depositExpiresAt: string
  depositStatus: 'VALID' | 'REFUNDED' | 'EXPIRED'
  driveFolderId: string | null
  driveFolderUrl: string | null
  paymentEvidenceCount: number
  chatEvidenceCount: number
  calendarId: string | null
  calendarEventId: string | null
  doctorLineGroupId: string | null
  doctorLineNotifiedAt: string | null
  callStatus: CallStatus
  firstCallWindowStart: string
  firstCallWindowEnd: string
  nextCallAt: string | null
  lastCallAt: string | null
  callOwnerAdminId: string | null
  jeraPaymentId: string | null
  jeraStatus: string | null
  jeraClosedAt: string | null
  jeraActualRevenue: number | null
  jeraImportFileId: string | null
  reconciliationStatus: 'NONE' | 'OPEN' | 'RESOLVED'
  commissionEligibility: CommissionEligibility
  commissionAmount: number | null
  driveState: StepState
  calendarState: StepState | 'CONFLICT'
  lineState: StepState
  jeraImportState: 'NOT_IMPORTED' | 'MATCHED' | 'RECONCILIATION'
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface AuditEvent {
  eventId: string
  caseId: string
  actor: string
  action: string
  target: string
  before: unknown
  after: unknown
  reason: string
  timestamp: string
  correlationId: string
}
