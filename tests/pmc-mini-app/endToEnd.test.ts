import { describe, expect, it } from 'vitest'
import type { MiniAppBookingIngressPayload } from '../../shared/pmcMiniAppBooking'
import { bookingPayloadHash, parseBookingDraft } from '../../server/pmc-mini-app/bookingDraft'
import type { MiniAppBookingConfigProjection, MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'
import type { BookingDraftInput } from '../../src/apps/pmc-mini-app/contracts'
import { submitMiniAppBooking } from '../../apps/pmc-google-booking-ops/src/workflows/miniAppSubmit'
import { createTestPorts } from '../../apps/pmc-google-booking-ops/tests/helpers/fakes'

describe('PMC Mini App deterministic end-to-end booking flow', () => {
  it('submits one normal and one automatic booking without duplicate Case IDs', async () => {
    const system = miniAppTestSystem()
    const normal = await system.submit(normalBooking({ requestId: 'normal-1' }))
    const automatic = await system.submit(autoBooking({ requestId: 'auto-1' }))
    const duplicate = await system.submit(normalBooking({ requestId: 'normal-1' }))

    expect(normal.status).toBe('CONFIRMED')
    expect(automatic.status).toMatch(/TENTATIVE|AWAITING_ADMIN_SLOT/)
    expect(duplicate.caseId).toBe(normal.caseId)
    expect(system.bookingCount()).toBe(2)
  })

  it('preserves every ordered evidence ID through the existing booking workflow', async () => {
    const system = miniAppTestSystem()
    const result = await system.submit(normalBooking({ requestId: 'normal-1' }), {
      payments: ['payment-normal-1', 'payment-normal-2'],
      chats: ['chat-normal-1', 'chat-normal-2'],
    })

    expect(result.booking).toMatchObject({ paymentEvidenceCount: 2, chatEvidenceCount: 2, driveState: 'OK' })
  })
})

function miniAppTestSystem() {
  const store = new MemoryMiniAppStore()
  const ports = createTestPorts({
    extraDriveFileIds: [
      'payment-normal-1', 'payment-normal-2', 'chat-normal-1', 'chat-normal-2',
      'payment-auto-1', 'chat-auto-1',
    ],
  })
  const originalFindChannel = ports.config.findChannel
  ports.config.findChannel = (id) => id === 'channel-1'
    ? { id: 'channel-1', name: 'เพจหลัก', active: true }
    : originalFindChannel(id)

  return {
    async submit(input: BookingDraftInput, evidence = evidenceFor(input.requestId)) {
      const parsed = parseBookingDraft(input, {
        draftId: `draft-${input.requestId}`, staffId: 'admin-1', lineUserIdHash: 'line-user-hash',
        doctorIds: ['doctor-1'], serviceIds: ['service-1'], channelIds: ['channel-1'], eligibleAeNames: ['ไม่ระบุ', 'Admin A'],
        paymentEvidenceFileIds: evidence.payments, chatEvidenceFileIds: evidence.chats,
        now: '2026-08-20T09:00:00+07:00',
      })
      const existing = await store.getDraft(parsed.draftId)
      if (!existing) await store.createDraft(parsed)
      const current = existing ?? parsed
      const claim = await store.claimConfirmation(current.requestId, bookingPayloadHash(parsed))
      if (!claim.claimed) {
        const booking = ports.bookings.getByCaseId(claim.caseId!)!
        return { caseId: booking.caseId, status: claim.status!, booking }
      }
      const booking = submitMiniAppBooking(ingressPayload(claim.draft), ports)
      await store.completeConfirmation(input.requestId, booking.caseId, ports.clock.nowIso(), booking.appointmentStatus)
      return { caseId: booking.caseId, status: booking.appointmentStatus, booking }
    },
    bookingCount: () => ports.bookings.list().length,
  }
}

function ingressPayload(draft: MiniAppRequestRecord): MiniAppBookingIngressPayload {
  return {
    requestId: draft.requestId, payloadHash: draft.payloadHash!, staffId: draft.staffId, aeName: draft.aeName,
    customerName: draft.customerName, facebookName: draft.facebookName, phoneNormalized: draft.phoneNormalized,
    doctorId: draft.doctorId, serviceId: draft.serviceId, queueType: draft.queueType,
    appointmentDate: draft.appointmentDate, appointmentTime: draft.appointmentTime, depositAmount: draft.depositAmount,
    channelId: draft.channelId, paymentEvidenceFileIds: draft.paymentEvidenceFileIds, chatEvidenceFileIds: draft.chatEvidenceFileIds,
  }
}

function normalBooking(patch: Partial<BookingDraftInput> = {}): BookingDraftInput {
  return {
    requestId: 'normal-1', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL',
    appointmentDate: '2026-08-20', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', ...patch,
  }
}

function autoBooking(patch: Partial<BookingDraftInput> = {}): BookingDraftInput {
  return { ...normalBooking(), requestId: 'auto-1', queueType: 'AUTO', appointmentDate: null, appointmentTime: null, ...patch }
}

function evidenceFor(requestId: string) {
  return { payments: [`payment-${requestId}`], chats: [`chat-${requestId}`] }
}

class MemoryMiniAppStore implements MiniAppStore {
  private readonly drafts = new Map<string, MiniAppRequestRecord>()
  async getActiveStaffByLineUserId() { return null }
  async getActiveBookingConfig(): Promise<MiniAppBookingConfigProjection> { return { doctors: [], services: [], channels: [], aes: [] } }
  async createDraft(draft: MiniAppRequestRecord) { this.drafts.set(draft.draftId, structuredClone(draft)); return structuredClone(draft) }
  async getDraft(draftId: string) { return structuredClone(this.drafts.get(draftId) ?? null) }
  async updateDraft(draftId: string, expectedVersion: number, patch: MiniAppDraftPatch) {
    const draft = this.drafts.get(draftId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.version !== expectedVersion) throw new Error('STALE_DRAFT_VERSION')
    const next = { ...draft, ...structuredClone(patch), version: draft.version + 1 }
    this.drafts.set(draftId, next)
    return structuredClone(next)
  }
  async markRetentionPending(draftId: string, version: number, updatedAt: string) {
    return this.updateDraft(draftId, version, { retentionState: 'PENDING_APPROVAL', updatedAt })
  }
  async claimConfirmation(requestId: string, payloadHash: string) {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)
    if (!draft) throw new Error('DRAFT_NOT_FOUND')
    if (draft.state === 'CONFIRMED') return { claimed: false as const, caseId: draft.caseId, status: draft.confirmationStatus }
    if (draft.payloadHash && draft.payloadHash !== payloadHash) throw new Error('PAYLOAD_HASH_CONFLICT')
    const next = { ...draft, state: 'CONFIRMING' as const, payloadHash, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return { claimed: true as const, draft: structuredClone(next) }
  }
  async completeConfirmation(requestId: string, caseId: string, confirmedAt: string, status: NonNullable<MiniAppRequestRecord['confirmationStatus']>) {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'CONFIRMED' as const, caseId, confirmedAt, confirmationStatus: status, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
  async failConfirmation(requestId: string, safeErrorCode: string, updatedAt: string) {
    const draft = [...this.drafts.values()].find((candidate) => candidate.requestId === requestId)!
    const next = { ...draft, state: 'FAILED_RETRYABLE' as const, safeErrorCode, updatedAt, version: draft.version + 1 }
    this.drafts.set(next.draftId, next)
    return structuredClone(next)
  }
}
