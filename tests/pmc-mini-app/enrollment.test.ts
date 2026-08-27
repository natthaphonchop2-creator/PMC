import { describe, expect, it } from 'vitest'
import {
  createEnrollmentService,
  EnrollmentError,
  type EnrollmentStore,
} from '../../server/pmc-mini-app/enrollment'

describe('PMC Mini App first-time LINE account linking', () => {
  it('lists only store-approved choices and links a valid PIN once', async () => {
    const store = new MemoryEnrollmentStore()
    const service = createEnrollmentService({
      pin: '482731', signingSecret: 'signing-secret', store, now: () => new Date('2026-08-28T01:00:00.000Z'),
    })

    await expect(service.listOptions()).resolves.toEqual([{ id: 'staff-1', name: 'มัส' }])
    await expect(service.enroll({ staffId: 'staff-1', pin: '482731', lineUserId: 'Uline-user-1' })).resolves.toEqual({
      staffId: 'staff-1', displayName: 'มัส', active: true,
    })
    expect(store.linkedLineUserId).toBe('Uline-user-1')
    expect(store.lastAttemptAccepted).toBe(true)
  })

  it('returns a generic denial for a wrong PIN and a bounded retry for lockout', async () => {
    const store = new MemoryEnrollmentStore()
    const service = createEnrollmentService({
      pin: '482731', signingSecret: 'signing-secret', store, now: () => new Date('2026-08-28T01:00:00.000Z'),
    })

    await expect(service.enroll({ staffId: 'staff-1', pin: '000000', lineUserId: 'Uline-user-1' })).rejects.toMatchObject({
      code: 'ENROLLMENT_DENIED', retryAfterSeconds: 0,
    })
    store.retryAfterSeconds = 600
    await expect(service.enroll({ staffId: 'staff-1', pin: '482731', lineUserId: 'Uline-user-1' })).rejects.toMatchObject({
      code: 'ENROLLMENT_RATE_LIMITED', retryAfterSeconds: 600,
    })
    expect(store.linkedLineUserId).toBeNull()
  })

  it('maps occupied staff and duplicate LINE identities to one safe error', async () => {
    const store = new MemoryEnrollmentStore()
    store.linkError = new Error('STAFF_ALREADY_LINKED')
    const service = createEnrollmentService({
      pin: '482731', signingSecret: 'signing-secret', store, now: () => new Date('2026-08-28T01:00:00.000Z'),
    })

    await expect(service.enroll({ staffId: 'staff-1', pin: '482731', lineUserId: 'Uline-user-1' })).rejects.toEqual(
      new EnrollmentError('ENROLLMENT_STAFF_UNAVAILABLE'),
    )
  })
})

class MemoryEnrollmentStore implements EnrollmentStore {
  retryAfterSeconds = 0
  linkedLineUserId: string | null = null
  lastAttemptAccepted: boolean | null = null
  linkError: Error | null = null

  async listUnlinkedBookingStaff() { return [{ id: 'staff-1', name: 'มัส' }] }

  async consumeEnrollmentAttempt(_lineUserIdHash: string, pinAccepted: boolean) {
    this.lastAttemptAccepted = pinAccepted
    return { allowed: pinAccepted && this.retryAfterSeconds === 0, retryAfterSeconds: this.retryAfterSeconds }
  }

  async linkLineUserToStaff(staffId: string, lineUserId: string) {
    if (this.linkError) throw this.linkError
    this.linkedLineUserId = lineUserId
    return {
      id: staffId, name: 'มัส', email: '', lineUserId, canCloseBooking: true, canBeAe: true,
      active: true as const, profileImageUrl: null,
    }
  }
}
