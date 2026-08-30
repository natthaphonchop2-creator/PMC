import type { StockCategory } from '../../../shared/pmcStock'

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
  aes: Array<{ id: string; name: string }>
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

export interface BookingDraftInput {
  requestId: string
  aeName: string
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
