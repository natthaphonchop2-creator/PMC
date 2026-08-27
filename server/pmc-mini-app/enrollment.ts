import { createHmac, timingSafeEqual } from 'node:crypto'

export interface EnrollmentStore {
  listUnlinkedBookingStaff(): Promise<Array<{ id: string; name: string }>>
  linkLineUserToStaff(staffId: string, lineUserId: string): Promise<{
    id: string
    name: string
    active: true
  }>
  consumeEnrollmentAttempt(
    lineUserIdHash: string,
    pinAccepted: boolean,
    nowIso: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
}

export class EnrollmentError extends Error {
  readonly code: 'ENROLLMENT_DENIED' | 'ENROLLMENT_RATE_LIMITED' | 'ENROLLMENT_STAFF_UNAVAILABLE'
  readonly retryAfterSeconds: number

  constructor(code: EnrollmentError['code'], retryAfterSeconds = 0) {
    super(`Mini App enrollment failed: ${code}`)
    this.name = 'EnrollmentError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface EnrollmentService {
  listOptions(): Promise<Array<{ id: string; name: string }>>
  enroll(input: { staffId: string; pin: string; lineUserId: string }): Promise<{ staffId: string; displayName: string; active: true }>
}

export function createEnrollmentService(input: {
  pin: string
  signingSecret: string
  store: EnrollmentStore
  now?: () => Date
}): EnrollmentService {
  if (!/^\d{6}$/.test(input.pin) || !input.signingSecret) throw new Error('Invalid enrollment configuration')
  const now = input.now ?? (() => new Date())

  return {
    listOptions: () => input.store.listUnlinkedBookingStaff(),
    async enroll(request) {
      if (!/^[A-Za-z0-9._:-]{1,124}$/.test(request.staffId) || !/^[A-Za-z0-9_-]{2,128}$/.test(request.lineUserId)) {
        throw new EnrollmentError('ENROLLMENT_DENIED')
      }
      const pinAccepted = /^\d{6}$/.test(request.pin) && constantTimePinEqual(request.pin, input.pin, input.signingSecret)
      const lineUserIdHash = createHmac('sha256', input.signingSecret).update(request.lineUserId, 'utf8').digest('base64url')
      const decision = await input.store.consumeEnrollmentAttempt(lineUserIdHash, pinAccepted, now().toISOString())
      if (!decision.allowed) {
        if (decision.retryAfterSeconds > 0) throw new EnrollmentError('ENROLLMENT_RATE_LIMITED', decision.retryAfterSeconds)
        throw new EnrollmentError('ENROLLMENT_DENIED')
      }
      try {
        const staff = await input.store.linkLineUserToStaff(request.staffId, request.lineUserId)
        return { staffId: staff.id, displayName: staff.name, active: true }
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        if (['STAFF_ALREADY_LINKED', 'LINE_USER_ALREADY_LINKED', 'ENROLLMENT_STAFF_NOT_AVAILABLE'].includes(code)) {
          throw new EnrollmentError('ENROLLMENT_STAFF_UNAVAILABLE')
        }
        throw error
      }
    },
  }
}

function constantTimePinEqual(candidate: string, expected: string, secret: string): boolean {
  const left = createHmac('sha256', secret).update(candidate, 'utf8').digest()
  const right = createHmac('sha256', secret).update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}
