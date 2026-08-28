import { describe, expect, it, vi } from 'vitest'
import { createMiniAppApi } from '../../src/apps/pmc-mini-app/api'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

describe('PMC Mini App browser API', () => {
  it('initializes LIFF from public config and keeps the raw ID token in authorization headers only', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/client-config')) return jsonResponse(200, { miniAppId: 'mini-id' })
      if (url.endsWith('/session')) return jsonResponse(200, { staffId: 'staff-1', displayName: 'มัส', active: true })
      return jsonResponse(404, {})
    })
    const liff = {
      init: vi.fn(async () => undefined), isLoggedIn: vi.fn(() => true), login: vi.fn(), getIDToken: vi.fn(() => 'raw-id-token'),
    }
    const api = createMiniAppApi({ fetch, liff })

    const token = await api.initialize()
    await api.loadSession(token)

    expect(token).toBe('raw-id-token')
    expect(liff.init).toHaveBeenCalledWith({ liffId: 'mini-id' })
    expect(fetch).toHaveBeenLastCalledWith('/api/mini-app/session', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
    expect(fetch.mock.calls.map(([url]) => String(url)).join(' ')).not.toContain('raw-id-token')
  })

  it('uploads payment and chat evidence together through one async batch request', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 2,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: ['chat-1', 'chat-2'], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const payment = [new File(['one'], 'payment.png', { type: 'image/png' })]
    const chat = [new File(['two'], 'chat.png', { type: 'image/png' })]

    await api.uploadEvidenceBatch('raw-id-token', 'draft-1', { paymentFiles: payment, chatFiles: chat })

    const [, init] = fetch.mock.calls[0]!
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer raw-id-token' } })
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).getAll('paymentFiles')).toEqual(payment)
    expect((init?.body as FormData).getAll('chatFiles')).toEqual(chat)
    expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/draft-1/evidence-batch', expect.anything())
  })

  it('parses a 202 confirmation acknowledgement without treating it as a completed booking', async () => {
    const projection = queuedProjection()
    const fetch = vi.fn(async () => jsonResponse(202, { requestId: 'request-1', status: 'QUEUED', projection }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.confirm('raw-id-token', 'draft-1', 4)).resolves.toEqual({ requestId: 'request-1', status: 'QUEUED', projection })
    expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/draft-1/confirm', expect.objectContaining({
      method: 'POST', headers: { authorization: 'Bearer raw-id-token', 'content-type': 'application/json' }, body: JSON.stringify({ version: 4 }),
    }))
  })

  it('rejects a queued acknowledgement without the exact persisted safe projection', async () => {
    const fetch = vi.fn(async () => jsonResponse(202, { requestId: 'request-1', status: 'QUEUED' }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.confirm('raw-id-token', 'draft-1', 4)).rejects.toMatchObject({
      code: 'MINI_APP_INVALID_RESPONSE', status: 202,
    })
  })

  it('rejects a queued acknowledgement that leaks input or evidence identifiers', async () => {
    const projection = { ...queuedProjection(), input: { customerName: 'ลูกค้าทดสอบ' }, paymentEvidenceIds: ['drive-file-1'] }
    const fetch = vi.fn(async () => jsonResponse(202, { requestId: 'request-1', status: 'QUEUED', projection }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.confirm('raw-id-token', 'draft-1', 4)).rejects.toMatchObject({
      code: 'MINI_APP_INVALID_RESPONSE', status: 202,
    })
  })

  it('loads only the current staff active draft with bearer authentication', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', retentionState: '', version: 5,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: null,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.loadLatestActiveDraft('raw-id-token')).resolves.toMatchObject({ draftId: 'draft-1', state: 'QUEUED' })
    expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/active', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
  })

  it('cancels a draft with its current version and bearer auth', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: 2,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.cancel('raw-id-token', 'draft-1', 1)

    expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/draft-1/cancel', expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer raw-id-token', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    }))
  })

  it('loads the current server draft with bearer auth for stale-version recovery', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'READY_TO_CONFIRM', retentionState: '', version: 10,
      input: null, paymentEvidenceIds: ['payment-1'], chatEvidenceIds: ['chat-1'], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.loadDraft('raw-id-token', 'draft-1')

    expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/draft-1', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
  })

  it('keeps the terminal retry marker and Case ID from the persisted server projection', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      draftId: 'draft-1', requestId: 'request-1', state: 'CONFIRMED_WITH_RETRY', retentionState: '', version: 12,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: 'CONFIRMED',
      caseId: 'PMC-260828-0001', safeErrorCode: 'DOWNSTREAM_RETRY', queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: '2026-08-28T10:01:00.000Z',
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.loadDraft('raw-id-token', 'draft-1')).resolves.toMatchObject({
      state: 'CONFIRMED_WITH_RETRY', caseId: 'PMC-260828-0001', safeErrorCode: 'DOWNSTREAM_RETRY',
    })
  })

  it('keeps first-time linking PIN in the authenticated POST body only', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/enrollment-options')
      ? jsonResponse(200, { staff: [{ id: 'staff-1', name: 'มัส' }] })
      : jsonResponse(200, { staffId: 'staff-1', displayName: 'มัส', active: true }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.loadEnrollmentOptions('raw-id-token')).resolves.toEqual({ staff: [{ id: 'staff-1', name: 'มัส' }] })
    await expect(api.enroll('raw-id-token', 'staff-1', '482731')).resolves.toEqual({
      staffId: 'staff-1', displayName: 'มัส', active: true,
    })

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/mini-app/enrollment-options', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/mini-app/enroll', expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer raw-id-token', 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: 'staff-1', pin: '482731' }),
    }))
    expect(fetch.mock.calls.map(([url]) => String(url)).join(' ')).not.toContain('482731')
  })

  it('loads reports with one encoded value per supported filter and bearer auth', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      data: { totals: { appointmentCount: 0 }, rows: [] }, source: 'CACHE', fetchedAt: null,
      lastSuccessAt: null, refreshing: true, stale: true, warningCode: 'JERA_CACHE_EMPTY',
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.loadReport('raw-id-token', 'APPOINTMENT', {
      ...defaultReportFilters('2026-08-27'), status: 'Confirmed', doctorUuid: 'ignored-doctor',
    })

    const [url, init] = fetch.mock.calls[0]!
    const parsed = new URL(String(url), 'https://mini-app.example')
    expect(parsed.pathname).toBe('/api/mini-app/reports/APPOINTMENT')
    expect(parsed.searchParams.getAll('startDate')).toEqual(['2026-08-27'])
    expect(parsed.searchParams.getAll('endDate')).toEqual(['2026-08-27'])
    expect(parsed.searchParams.getAll('status')).toEqual(['Confirmed'])
    expect(parsed.searchParams.has('doctorUuid')).toBe(false)
    expect(init).toMatchObject({ headers: { authorization: 'Bearer raw-id-token' } })
  })
})

function inertLiff() {
  return { init: vi.fn(async () => undefined), isLoggedIn: () => true, login: vi.fn(), getIDToken: () => 'token' }
}

function queuedProjection() {
  return {
    draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', retentionState: '', version: 5,
    input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
    caseId: null, safeErrorCode: null, queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: null,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
