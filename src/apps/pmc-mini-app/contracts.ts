import type { StockCategory } from '../../../shared/pmcStock'
import type { BookingProtocolVersion } from '../../../shared/pmcBookingProtocol'
import type { BookingPrepareCapability } from '../../../shared/pmcMiniAppBookingPrepare'

export interface MiniAppSession {
  staffId: string
  displayName: string
  active: true
}

export interface MiniAppConfig {
  miniAppId: string
  fallbackFormUrl: string
  reportingEnabled: boolean
  financeReportsEnabled: boolean
  stockEnabled: boolean
  expenseCaptureEnabled?: boolean
  financeReadsEnabled?: boolean
  canManageStock: boolean
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
  doctors: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string; durationMinutes: number }>
  channels: Array<{ id: string; name: string }>
  admins: Array<{ id: string; name: string }>
  aes: Array<{ id: string; name: string }>
  bookingProtocol?: BookingPrepareCapability
}

export interface StockProductProjection {
  productId: string
  name: string
  category: StockCategory
  unit: string
  minimumQuantityMilli: number
  onHandMilli: number
  lowStock: boolean
  active: boolean
  hasLedgerActivity: boolean
  version: number
}

export interface MiniAppEnrollmentOptions {
  staff: Array<{ id: string; name: string }>
}

export type BookingQueueType = 'NORMAL' | 'AUTO'

export interface BookingDraftInputBase {
  requestId: string
  customerName: string
  facebookName: string
  phone: string
  doctorId: string
  serviceId: string
  queueType: BookingQueueType
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
}

export interface BookingDraftInputV1 extends BookingDraftInputBase {
  aeName: string
}

export interface BookingDraftInputV2 extends BookingDraftInputBase {
  adminId: string
  aeId: string | null
}

export type BookingDraftInput = BookingDraftInputV1 | BookingDraftInputV2

export interface BookingDraftAttributionV2 {
  protocolVersion: 2
  recorder: { id: string; name: string }
  admin: { id: string; name: string }
  ae: { id: string; name: string } | null
}

export function bookingProtocolVersion(config: Pick<MiniAppConfig, 'bookingProtocol'>): BookingProtocolVersion {
  return config.bookingProtocol?.supported === 2 && config.bookingProtocol.minimumMutation === 2 ? 2 : 1
}

export type BookingDraftState =
  | 'DRAFT'
  | 'UPLOADING'
  | 'READY_TO_CONFIRM'
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'CONFIRMED_WITH_RETRY'
  | 'NEEDS_REVIEW'
  | 'FAILED_RETRYABLE'
  | 'CANCELLED'
  | 'EXPIRED'

export interface BookingDraftProjection {
  draftId: string
  requestId: string
  state: BookingDraftState
  retentionState: '' | 'PENDING_APPROVAL'
  version: number
  input: BookingDraftInput | null
  attribution?: BookingDraftAttributionV2
  paymentEvidenceIds: string[]
  chatEvidenceIds: string[]
  paymentEvidenceCount?: number
  chatEvidenceCount?: number
  confirmationStatus: BookingConfirmationResult['status'] | null
  caseId: string | null
  safeErrorCode: string | null
  queuedAt: string | null
  lastProgressAt: string | null
}

export interface BookingConfirmationResult {
  caseId: string
  status: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'
}

export interface BookingQueuedResult {
  requestId: string
  status: 'QUEUED'
  projection: BookingDraftProjection
}

export function isBookingTerminalState(state: BookingDraftState): boolean {
  return ['CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED'].includes(state)
}
