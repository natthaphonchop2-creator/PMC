export type MiniAppIngressQueueType = 'NORMAL' | 'AUTO'
export type MiniAppIngressStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'

export interface MiniAppBookingIngressPayload {
  requestId: string
  payloadHash: string
  staffId: string
  aeName: string
  customerName: string
  facebookName: string
  phoneNormalized: string
  doctorId: string
  serviceId: string
  queueType: MiniAppIngressQueueType
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
}

export interface UnsignedMiniAppBookingIngressEnvelope {
  kind: 'MINI_APP_BOOKING'
  version: 1
  timestamp: number
  nonce: string
  payload: MiniAppBookingIngressPayload
}

export interface MiniAppBookingIngressEnvelope extends UnsignedMiniAppBookingIngressEnvelope {
  signature: string
}

export interface MiniAppBookingIngressResult {
  caseId: string
  status: MiniAppIngressStatus
  driveState: 'OK' | 'RETRY'
  calendarState: 'PENDING' | 'OK' | 'RETRY' | 'CONFLICT'
  lineState: 'PENDING' | 'OK' | 'RETRY'
}

export function canonicalMiniAppBookingIngress(envelope: UnsignedMiniAppBookingIngressEnvelope): string {
  return JSON.stringify({
    kind: envelope.kind,
    version: envelope.version,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: {
      requestId: envelope.payload.requestId,
      payloadHash: envelope.payload.payloadHash,
      staffId: envelope.payload.staffId,
      aeName: envelope.payload.aeName,
      customerName: envelope.payload.customerName,
      facebookName: envelope.payload.facebookName,
      phoneNormalized: envelope.payload.phoneNormalized,
      doctorId: envelope.payload.doctorId,
      serviceId: envelope.payload.serviceId,
      queueType: envelope.payload.queueType,
      appointmentDate: envelope.payload.appointmentDate,
      appointmentTime: envelope.payload.appointmentTime,
      depositAmount: envelope.payload.depositAmount,
      channelId: envelope.payload.channelId,
      paymentEvidenceFileIds: envelope.payload.paymentEvidenceFileIds,
      chatEvidenceFileIds: envelope.payload.chatEvidenceFileIds,
    },
  })
}
