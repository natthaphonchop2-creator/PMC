import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMiniAppIngress,
  createBookingIngressClient,
} from '../../server/pmc-mini-app/bookingIngressClient'
import type { MiniAppRequestRecord } from '../../server/pmc-mini-app/store'
import { canonicalMiniAppBookingIngress } from '../../shared/pmcMiniAppBooking'

describe('PMC Mini App signed booking ingress client', () => {
  it('signs the exact canonical payload and sends no secret field', () => {
    const request = buildMiniAppIngress(confirmedDraft(), {
      timestamp: 1_800_000_000,
      nonce: 'nonce-123456',
    }, 'server-secret')

    expect(request.body.kind).toBe('MINI_APP_BOOKING')
    expect(request.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.stringify(request.body)).not.toContain('server-secret')
    const { signature, ...unsigned } = request.body
    expect(signature).toBe(createHmac('sha256', 'server-secret').update(canonicalMiniAppBookingIngress(unsigned)).digest('hex'))
    expect(request.body.version).toBe(1)
    expect(Object.keys(request.body.payload).sort()).toEqual([
      'aeName', 'appointmentDate', 'appointmentTime', 'channelId', 'chatEvidenceFileIds', 'customerName',
      'depositAmount', 'doctorId', 'facebookName', 'payloadHash', 'paymentEvidenceFileIds', 'phoneNormalized',
      'queueType', 'requestId', 'serviceId', 'staffId',
    ].sort())
  })

  it('signs the exact protocol-2 selected Admin, recorder, and selected AE envelope', () => {
    const request = buildMiniAppIngress(protocol2ConfirmedDraft(), {
      timestamp: 1_800_000_000,
      nonce: 'nonce-v2-123456',
    }, 'server-secret')

    expect(request.body.version).toBe(2)
    if (request.body.version !== 2) throw new Error('expected protocol 2')
    expect(request.body.payload).toMatchObject({
      protocolVersion: 2,
      staffId: 'recorder-1',
      recorderName: 'มัส',
      adminId: 'admin-2',
      adminName: 'แวว',
      aeId: 'ae-1',
      aeName: 'หมวย',
    })
    expect(Object.keys(request.body.payload).sort()).toEqual([
      'protocolVersion', 'requestId', 'payloadHash', 'staffId', 'recorderName', 'adminId', 'adminName',
      'aeId', 'aeName', 'customerName', 'facebookName', 'phoneNormalized', 'doctorId', 'serviceId',
      'queueType', 'appointmentDate', 'appointmentTime', 'depositAmount', 'channelId',
      'paymentEvidenceFileIds', 'chatEvidenceFileIds',
    ].sort())
    const { signature, ...unsigned } = request.body
    expect(signature).toBe(createHmac('sha256', 'server-secret')
      .update(canonicalMiniAppBookingIngress(unsigned)).digest('hex'))
  })

  it('converts the stored protocol-2 null-AE sentinel to exact ingress nulls', () => {
    const request = buildMiniAppIngress(protocol2ConfirmedDraft({ aeId: null, aeName: 'ไม่ระบุ' }), {
      timestamp: 1_800_000_000,
      nonce: 'nonce-v2-123456',
    }, 'server-secret')

    expect(request.body.version).toBe(2)
    if (request.body.version !== 2) throw new Error('expected protocol 2')
    expect(request.body.payload.aeId).toBeNull()
    expect(request.body.payload.aeName).toBeNull()
  })

  it.each([
    ['blank recorder snapshot', { recorderName: '' }],
    ['blank Admin ID', { adminId: '' }],
    ['blank Admin snapshot', { adminName: '' }],
    ['unsafe Admin ID', { adminId: 'admin/2' }],
    ['null AE with a selected snapshot', { aeId: null, aeName: 'หมวย' }],
    ['selected AE with the null sentinel', { aeId: 'ae-1', aeName: 'ไม่ระบุ' }],
    ['unsafe AE ID', { aeId: 'ae/1', aeName: 'หมวย' }],
  ])('rejects an impossible protocol-2 %s before fetch', async (_label, patch) => {
    const fetch = vi.fn(async () => response(200, {
      caseId: 'PMC-202608-0001', status: 'CONFIRMED',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK',
    }))
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-v2-123456', fetch,
    })

    await expect(client.send(protocol2ConfirmedDraft(patch))).rejects.toMatchObject({
      code: 'BOOKING_INGRESS_FAILED',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts the production protocol-2 envelope rather than a compatibility downgrade', async () => {
    const fetch = vi.fn(async () => response(200, {
      caseId: 'PMC-202608-0001', status: 'CONFIRMED',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK',
    }))
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-v2-123456', fetch,
    })

    await client.send(protocol2ConfirmedDraft())

    const sent = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as Record<string, unknown>
    expect(sent).toMatchObject({
      version: 2,
      payload: {
        protocolVersion: 2,
        staffId: 'recorder-1',
        recorderName: 'มัส',
        adminId: 'admin-2',
        adminName: 'แวว',
        aeId: 'ae-1',
        aeName: 'หมวย',
      },
    })
  })

  it('posts a signed envelope and accepts only the exact safe result projection', async () => {
    const fetch = vi.fn(async () => response(200, {
      caseId: 'PMC-202608-0001', status: 'CONFIRMED',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK',
    }))
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-123456', fetch,
    })

    await expect(client.send(confirmedDraft())).resolves.toEqual({
      caseId: 'PMC-202608-0001', status: 'CONFIRMED',
      driveState: 'OK', calendarState: 'OK', lineState: 'OK',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://script.google.com/macros/s/deployment/exec',
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' } }),
    )
  })

  it.each([
    ['missing projection field', { caseId: 'PMC-202608-0001', status: 'CONFIRMED', driveState: 'OK', calendarState: 'OK' }],
    ['unknown result field', { caseId: 'PMC-202608-0001', status: 'CONFIRMED', driveState: 'OK', calendarState: 'OK', lineState: 'OK', providerDetail: 'private' }],
    ['unknown Drive state', { caseId: 'PMC-202608-0001', status: 'CONFIRMED', driveState: 'PENDING', calendarState: 'OK', lineState: 'OK' }],
    ['unknown Calendar state', { caseId: 'PMC-202608-0001', status: 'CONFIRMED', driveState: 'OK', calendarState: 'FAILED', lineState: 'OK' }],
    ['unknown LINE state', { caseId: 'PMC-202608-0001', status: 'CONFIRMED', driveState: 'OK', calendarState: 'OK', lineState: 'CONFLICT' }],
  ])('rejects a %s result projection', async (_name, body) => {
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-123456', fetch: vi.fn(async () => response(200, body)),
    })

    await expect(client.send(confirmedDraft())).rejects.toMatchObject({ code: 'BOOKING_INGRESS_INVALID_RESPONSE' })
  })

  it('accepts the persisted PROCESSING draft owned by the asynchronous worker', () => {
    const draft = { ...confirmedDraft(), state: 'PROCESSING' as const, attemptCount: 1 }

    const request = buildMiniAppIngress(draft, {
      timestamp: 1_800_000_000,
      nonce: 'nonce-123456',
    }, 'server-secret')

    expect(request.body.payload).toMatchObject({
      requestId: 'request-1', payloadHash: 'payload-hash-1',
      paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    })
  })

  it.each([
    ['provider non-2xx', async () => response(500, { message: 'provider-secret-body' })],
    ['invalid provider response', async () => response(200, { caseId: '../../bad', status: 'UNKNOWN' })],
    ['transport failure', async () => { throw new Error('transport-secret-body') }],
  ])('returns a safe error for %s', async (_name, fetchImplementation) => {
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-123456', fetch: vi.fn(fetchImplementation),
    })

    await expect(client.send(confirmedDraft())).rejects.toMatchObject({
      code: expect.stringMatching(/^BOOKING_INGRESS_/),
      message: expect.not.stringMatching(/provider-secret-body|transport-secret-body/),
    })
  })

  it('aborts a provider request that exceeds the configured timeout', async () => {
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret', timeoutMs: 5,
      now: () => 1_800_000_000, nonce: () => 'nonce-123456',
      fetch: vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted-provider-detail')))
      })),
    })

    await expect(client.send(confirmedDraft())).rejects.toMatchObject({ code: 'BOOKING_INGRESS_TIMEOUT' })
  })

  it('allows the default timeout to cover a 34-second Drive, Calendar, and LINE workflow', async () => {
    vi.useFakeTimers()
    try {
      const client = createBookingIngressClient({
        url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
        now: () => 1_800_000_000, nonce: () => 'nonce-123456',
        fetch: vi.fn(async (_url, init) => new Promise((resolve, reject) => {
          const completion = setTimeout(
            () => resolve(response(200, {
              caseId: 'PMC-202608-0001', status: 'CONFIRMED',
              driveState: 'OK', calendarState: 'OK', lineState: 'OK',
            })),
            34_000,
          )
          init.signal.addEventListener('abort', () => {
            clearTimeout(completion)
            reject(new Error('aborted-before-workflow-completed'))
          })
        })),
      })

      const pending = client.send(confirmedDraft())
      await vi.advanceTimersByTimeAsync(34_000)

      await expect(pending).resolves.toEqual({
        caseId: 'PMC-202608-0001', status: 'CONFIRMED',
        driveState: 'OK', calendarState: 'OK', lineState: 'OK',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

function confirmedDraft(): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 1,
    staffId: 'admin-1', recorderName: '', adminId: 'admin-1', adminName: '', lineUserIdHash: 'line-user-hash',
    state: 'CONFIRMING', retentionState: '', version: 2, payloadHash: 'payload-hash-1', aeId: null, aeName: 'เอม',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1',
    serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00',
    depositAmount: 900, channelId: 'เพจหลัก', paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    evidenceCount: 2, paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    processingOwnerToken: null, evidenceProjectionHash: null,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null,
    safeErrorCode: null, updatedAt: '2026-08-27T10:01:00.000Z',
  }
}

function protocol2ConfirmedDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    ...confirmedDraft(),
    protocolVersion: 2,
    staffId: 'recorder-1',
    recorderName: 'มัส',
    adminId: 'admin-2',
    adminName: 'แวว',
    aeId: 'ae-1',
    aeName: 'หมวย',
    ...patch,
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
