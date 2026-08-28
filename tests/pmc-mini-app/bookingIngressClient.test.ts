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
  })

  it('posts a signed envelope and accepts only a bounded success response', async () => {
    const fetch = vi.fn(async () => response(200, { caseId: 'PMC-202608-0001', status: 'CONFIRMED' }))
    const client = createBookingIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'server-secret',
      now: () => 1_800_000_000, nonce: () => 'nonce-123456', fetch,
    })

    await expect(client.send(confirmedDraft())).resolves.toEqual({ caseId: 'PMC-202608-0001', status: 'CONFIRMED' })
    expect(fetch).toHaveBeenCalledWith(
      'https://script.google.com/macros/s/deployment/exec',
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' } }),
    )
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
            () => resolve(response(200, { caseId: 'PMC-202608-0001', status: 'CONFIRMED' })),
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

      await expect(pending).resolves.toEqual({ caseId: 'PMC-202608-0001', status: 'CONFIRMED' })
    } finally {
      vi.useRealTimers()
    }
  })
})

function confirmedDraft(): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'admin-1', lineUserIdHash: 'line-user-hash',
    state: 'CONFIRMING', retentionState: '', version: 2, payloadHash: 'payload-hash-1', aeName: 'เอม',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678', doctorId: 'doctor-1',
    serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01', appointmentTime: '13:00',
    depositAmount: 900, channelId: 'เพจหลัก', paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'],
    evidenceCount: 2, paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null,
    safeErrorCode: null, updatedAt: '2026-08-27T10:01:00.000Z',
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
