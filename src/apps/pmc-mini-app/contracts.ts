export interface MiniAppSession {
  staffId: string
  displayName: string
  active: true
}

export interface MiniAppConfig {
  miniAppId: string
  fallbackFormUrl: string
  doctors: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string; durationMinutes: number }>
  channels: Array<{ id: string; name: string }>
  aes: Array<{ id: string; name: string }>
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
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'FAILED_RETRYABLE'
  | 'CANCELLED'
  | 'EXPIRED'

export interface BookingDraftProjection {
  draftId: string
  requestId: string
  state: BookingDraftState
  version: number
  input: BookingDraftInput | null
  paymentEvidenceIds: string[]
  chatEvidenceIds: string[]
}

export interface BookingConfirmationResult {
  caseId: string
  status: 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'
}
