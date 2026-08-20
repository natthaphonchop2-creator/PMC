import type { BookingStatus } from './types'

export interface TransitionEvidence {
  jeraStatus: string | null
}

export function transitionBooking(
  _from: BookingStatus,
  to: BookingStatus,
  evidence: TransitionEvidence,
): BookingStatus {
  if (to === 'CLOSED_JERA' && evidence.jeraStatus !== 'ชำระแล้ว') {
    throw new Error('CLOSED_JERA requires JERA status ชำระแล้ว')
  }
  if (to === 'REFUNDED' && evidence.jeraStatus !== 'คืนมัดจำ') {
    throw new Error('REFUNDED requires JERA status คืนมัดจำ')
  }
  return to
}
