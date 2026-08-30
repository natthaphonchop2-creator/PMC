import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { MiniAppBookingIngressPayload } from '../../shared/pmcMiniAppBooking'
import { bookingPayloadHash, parseBookingDraft } from '../../server/pmc-mini-app/bookingDraft'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppBookingConfigProjection, MiniAppDraftPatch, MiniAppRequestRecord, MiniAppStore } from '../../server/pmc-mini-app/store'
import type { JeraAllocationCoverage, JeraAllocationStore, JeraCachedPaymentDetail } from '../../server/jera/allocationStore'
import type { JeraAllocationTaskQueuePort } from '../../server/jera/allocationTaskQueue'
import type { JeraCacheEnvelope, JeraNormalizedRow, JeraSourceReportType } from '../../server/jera/contracts'
import { createJeraFinanceService } from '../../server/jera/financeService'
import { createJeraMiniAppApi } from '../../server/jera/middleware'
import type { JeraReportStore } from '../../server/jera/store'
import type { JeraSyncCoordinator, JeraSyncQuery } from '../../server/jera/syncCoordinator'
import { jeraCacheKey } from '../../server/jera/cacheKey'
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

describe('PMC finance report server end-to-end flow', () => {
  it('serves active-staff daily and finance-only monthly reads from 31 cache days without provider or task writes', async () => {
    const gateOff = financeServerSystem(false)
    const dailyOff = await gateOff.request('staff-token', '/api/mini-app/finance/daily?startDate=2026-08-31&endDate=2026-08-31')
    const monthlyDenied = await gateOff.request('staff-token', '/api/mini-app/finance/monthly?year=2026&month=8')
    const monthlyOff = await gateOff.request('finance-token', '/api/mini-app/finance/monthly?year=2026&month=8')

    expect(dailyOff.status).toBe(200)
    expect(await dailyOff.json()).toMatchObject({
      receivedSatang: 10_001,
      refundSatang: 1_001,
      netReceivedSatang: 9_000,
      categories: { state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null },
    })
    expect({ status: monthlyDenied.status, body: await monthlyDenied.json() }).toEqual({
      status: 403,
      body: { error: 'FINANCE_FORBIDDEN' },
    })
    expect(monthlyOff.status).toBe(200)
    expect(await monthlyOff.json()).toMatchObject({
      monthKey: '2026-08',
      receivedSatang: 310_031,
      categories: { state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null },
    })
    expect(gateOff.coordinator.manualRefresh).not.toHaveBeenCalled()
    expect(gateOff.queue.enqueue).not.toHaveBeenCalled()
    expect(gateOff.allocationStore.saveCoverage).not.toHaveBeenCalled()

    const gateOn = financeServerSystem(true)
    const range = await gateOn.request('staff-token', '/api/mini-app/finance/daily?startDate=2026-08-01&endDate=2026-08-31')
    const body = await range.json() as {
      receivedSatang: number
      categories: { state: string; serviceSatang: number; productSatang: number; unclassifiedSatang: number }
      payments: Array<{ eventDate: string }>
    }

    expect(range.status).toBe(200)
    expect(body.receivedSatang).toBe(310_031)
    expect(body.categories).toEqual({
      state: 'READY', serviceSatang: 206_677, productSatang: 103_354, unclassifiedSatang: 0, incompleteDates: [],
    })
    expect(body.payments).toHaveLength(31)
    expect(body.payments[0]?.eventDate).toBe('2026-08-31')
    expect(body.payments.at(-1)?.eventDate).toBe('2026-08-01')
    expect(gateOn.coordinator.manualRefresh).not.toHaveBeenCalled()
    expect(gateOn.queue.enqueue).not.toHaveBeenCalled()
    expect(gateOn.allocationStore.saveCoverage).not.toHaveBeenCalled()
  })

  it('refreshes PAYMENT, REFUND, and PRODUCT_SALES sequentially and writes one allocation task', async () => {
    const system = financeServerSystem(true)
    const response = await system.request(
      'finance-token',
      '/api/mini-app/finance/daily/refresh?date=2026-08-31',
      { method: 'POST' },
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true, allocationQueued: true, retryAfterSeconds: 300 })
    expect(system.providerOrder).toEqual(['PAYMENT', 'REFUND', 'PRODUCT_SALES'])
    expect(system.maxActiveProviderCalls()).toBe(1)
    expect(system.queue.enqueue).toHaveBeenCalledOnce()
    expect(system.allocationStore.saveCoverage).toHaveBeenCalledOnce()
  })
})

function financeServerSystem(categoryMoneyEnabled: boolean) {
  const fixture = financeCacheFixture()
  const providerOrder: string[] = []
  let activeProviderCalls = 0
  let maxActiveProviderCalls = 0
  const coordinator = {
    readCachedBatch: vi.fn(async (queries: JeraSyncQuery[]) => queries.map((query) => fixture.envelope(query))),
    manualRefresh: vi.fn(async (query: JeraSyncQuery) => {
      activeProviderCalls += 1
      maxActiveProviderCalls = Math.max(maxActiveProviderCalls, activeProviderCalls)
      providerOrder.push(query.reportType)
      await new Promise<void>((resolve) => setImmediate(resolve))
      activeProviderCalls -= 1
      return { accepted: true, retryAfterSeconds: 300 }
    }),
  } as unknown as JeraSyncCoordinator & {
    readCachedBatch: ReturnType<typeof vi.fn>
    manualRefresh: ReturnType<typeof vi.fn>
  }
  const allocationStore = {
    readDays: vi.fn(async (inputs: Array<{
      branchUuid: string
      eventDate: string
      paymentSetHash: string
      metadataSnapshotHash: string
    }>) => inputs.map((input) => fixture.allocationDay(input))),
    getCoverage: vi.fn(async () => null),
    saveCoverage: vi.fn(async () => undefined),
  } as unknown as JeraAllocationStore & {
    readDays: ReturnType<typeof vi.fn>
    getCoverage: ReturnType<typeof vi.fn>
    saveCoverage: ReturnType<typeof vi.fn>
  }
  const queue = {
    enqueue: vi.fn(async () => ({ taskName: 'finance-task-1', alreadyExists: false, live: true })),
  } satisfies JeraAllocationTaskQueuePort
  const lease = {
    claim: vi.fn(async (input: { dayKey: string; owner: string; now: string; ttlMs: number }) => ({
      dayKey: input.dayKey, owner: input.owner, fencingToken: '77',
      expiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString(),
    })),
    renew: vi.fn(), assertCurrent: vi.fn(async () => true), release: vi.fn(async () => undefined),
  }
  const service = createJeraFinanceService({
    coordinator,
    allocationStore,
    allocationQueue: queue,
    lease,
    categoryMoneyEnabled,
    now: () => new Date('2026-08-31T12:00:00.000Z'),
  })
  const jera = createJeraMiniAppApi({
    coordinator,
    store: { listSyncStates: vi.fn(async () => []) } as unknown as JeraReportStore,
    defaultBranchUuid: FINANCE_BRANCH,
    finance: { service },
  })
  const identity: LineIdentityPort = {
    async verify(idToken) {
      if (idToken === 'staff-token') return { lineUserId: 'Ustaff' }
      if (idToken === 'finance-token') return { lineUserId: 'Ufinance' }
      throw new Error('invalid token')
    },
  }
  const store = {
    getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => ({
      id: lineUserId === 'Ufinance' ? 'finance-1' : 'staff-1',
      name: lineUserId === 'Ufinance' ? 'ฝ่ายการเงิน' : 'พนักงาน',
      email: null,
      lineUserId,
      canCloseBooking: false,
      canBeAe: false,
      canViewFinance: lineUserId === 'Ufinance',
      active: true as const,
      profileImageUrl: null,
    })),
  } as unknown as MiniAppStore
  const middleware = createPmcMiniAppMiddleware({ config: financeServerConfig(), identity, store, jera })
  return {
    coordinator,
    allocationStore,
    queue,
    providerOrder,
    maxActiveProviderCalls: () => maxActiveProviderCalls,
    request: (token: string, path: string, init: RequestInit = {}) => invokeFinanceMiddleware(middleware, path, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${token}` },
    }),
  }
}

function financeCacheFixture() {
  const envelopes = new Map<string, JeraCacheEnvelope<JeraNormalizedRow[]>>()
  const payments = new Map<string, JeraNormalizedRow>()
  for (let day = 1; day <= 31; day += 1) {
    const eventDate = `2026-08-${String(day).padStart(2, '0')}`
    const payment = financeRow('PAYMENT', eventDate, day, {
      sourceUuid: financeUuid(1, day),
      patientName: 'ลูกค้าทดสอบ',
      paymentCode: `PAY-${eventDate.replaceAll('-', '')}`,
      type: 'NORMAL',
      totalSatang: 10_001,
      paidAmountSatang: 10_001,
      transferSatang: 10_001,
    })
    payments.set(eventDate, payment)
    envelopes.set(financeEnvelopeKey('PAYMENT', eventDate), financeEnvelope([payment]))
    envelopes.set(financeEnvelopeKey('REFUND', eventDate), financeEnvelope([
      financeRow('REFUND', eventDate, day, {
        sourceUuid: financeUuid(2, day),
        totalSatang: 1_001,
        refundAmountSatang: 1_001,
      }),
    ]))
    envelopes.set(financeEnvelopeKey('PRODUCT_SALES', eventDate), financeEnvelope([
      financeRow('PRODUCT_SALES', eventDate, day, {
        sourceUuid: financeUuid(3, day), itemCode: 'SVC-1', type: 'service',
      }),
      financeRow('PRODUCT_SALES', eventDate, day, {
        sourceUuid: financeUuid(4, day), itemCode: 'PRD-1', type: 'medicine',
      }),
    ]))
  }
  return {
    envelope(query: JeraSyncQuery) {
      return structuredClone(envelopes.get(financeEnvelopeKey(query.reportType, query.filters.startDate))!)
    },
    allocationDay(input: { branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string }) {
      const payment = payments.get(input.eventDate)!
      return {
        coverage: financeCoverage(input),
        details: [financeDetail(input.eventDate, payment)],
      }
    },
  }
}

function financeEnvelopeKey(reportType: string, eventDate: string): string {
  return `${reportType}:${eventDate}`
}

function financeEnvelope(data: JeraNormalizedRow[]): JeraCacheEnvelope<JeraNormalizedRow[]> {
  return {
    data,
    source: 'CACHE',
    fetchedAt: FINANCE_LAST_SUCCESS,
    lastSuccessAt: FINANCE_LAST_SUCCESS,
    refreshing: false,
    stale: false,
    warningCode: null,
  }
}

function financeRow(
  reportType: JeraSourceReportType,
  eventDate: string,
  day: number,
  patch: Partial<JeraNormalizedRow>,
): JeraNormalizedRow {
  return {
    cacheKey: `${reportType}:${eventDate}`,
    reportType,
    sourceUuid: financeUuid(8, day),
    branchUuid: FINANCE_BRANCH,
    branchName: 'Synthetic Branch',
    eventDate,
    patientUuid: null,
    patientCode: null,
    patientName: null,
    paymentCode: null,
    status: 'PAID',
    type: null,
    totalSatang: null,
    paidAmountSatang: null,
    refundAmountSatang: null,
    cashSatang: 0,
    transferSatang: 0,
    creditCardSatang: 0,
    eWalletSatang: 0,
    paymentLinkSatang: 0,
    otherPaymentSatang: 0,
    itemCode: null,
    itemName: null,
    quantity: null,
    remainingQuantity: null,
    remainingValueSatang: null,
    doctorName: null,
    salespersonName: null,
    sourceCreatedAt: `${eventDate}T10:00:00.000Z`,
    sourceUpdatedAt: null,
    fetchedAt: FINANCE_LAST_SUCCESS,
    sourceHash: createHash('sha256').update(`${reportType}:${eventDate}:${JSON.stringify(patch)}`).digest('hex'),
    ...patch,
  }
}

function financeCoverage(input: {
  branchUuid: string
  eventDate: string
  paymentSetHash: string
  metadataSnapshotHash: string
}): JeraAllocationCoverage {
  return {
    dayKey: createHash('sha256').update(`${input.branchUuid}:${input.eventDate}`).digest('hex'),
    branchUuid: input.branchUuid,
    eventDate: input.eventDate,
    paymentCacheKey: jeraCacheKey('PAYMENT', { branchUuid: input.branchUuid, startDate: input.eventDate, endDate: input.eventDate }),
    productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', { branchUuid: input.branchUuid, startDate: input.eventDate, endDate: input.eventDate }),
    paymentSetHash: input.paymentSetHash,
    paymentRowCount: 1,
    productSalesRowCount: 2,
    successfulDetailCount: 1,
    metadataSnapshotHash: input.metadataSnapshotHash,
    paymentLastSuccessAt: FINANCE_LAST_SUCCESS,
    productSalesLastSuccessAt: FINANCE_LAST_SUCCESS,
    cursor: 1,
    status: 'COMPLETE',
    lastAttemptAt: FINANCE_LAST_SUCCESS,
    lastSuccessAt: FINANCE_LAST_SUCCESS,
    safeErrorCode: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseFencingToken: null,
    taskAttempt: 0,
  }
}

function financeDetail(eventDate: string, payment: JeraNormalizedRow): JeraCachedPaymentDetail {
  return {
    detailKey: createHash('sha256').update(`detail:${eventDate}`).digest('hex'),
    branchUuid: FINANCE_BRANCH,
    eventDate,
    paymentUuid: payment.sourceUuid,
    paymentSourceHash: payment.sourceHash,
    detailSourceHash: createHash('sha256').update(`detail-source:${eventDate}`).digest('hex'),
    detailFetchedAt: FINANCE_LAST_SUCCESS,
    lineCount: 2,
    truncated: false,
    lines: [
      { lineOrdinal: 0, lineKind: 'OPD', itemCode: 'SVC-1', netLineSatang: 2 },
      { lineOrdinal: 1, lineKind: 'OPD', itemCode: 'PRD-1', netLineSatang: 1 },
    ],
  }
}

function financeUuid(prefix: number, day: number): string {
  return `${prefix}0000000-0000-4000-8000-${String(day).padStart(12, '0')}`
}

function financeServerConfig(): PmcMiniAppServerConfig {
  return {
    enabled: true,
    miniAppId: '2001234567-mini-app',
    lineChannelId: '2001234567',
    spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1',
    bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    bookingIngressSecret: 'production-secret',
    signingSecret: 'signing-secret',
    enrollmentPin: null,
    maxImageBytes: 10_000_000,
    maxFilesPerKind: 10,
    asyncBooking: null,
    financeReportsEnabled: true,
    financeUiPreviewEnabled: false,
    stockEnabled: false,
    stockManagerPilotOnly: false,
  }
}

async function invokeFinanceMiddleware(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init)
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, headers: response.headers })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

const FINANCE_BRANCH = '11111111-2222-4333-8444-555555555555'
const FINANCE_LAST_SUCCESS = '2026-08-31T10:00:00.000Z'

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
