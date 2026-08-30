import { describe, expect, it, vi } from 'vitest'
import { createMiniAppApi } from '../../src/apps/pmc-mini-app/api'
import { type FinanceDailyFilter, type FinanceMonthSelection } from '../../src/apps/pmc-mini-app/financeReports'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'
import type { ExpenseReceipt } from '../../shared/pmcExpense'

const EXPENSE_TOKEN_1 = `payload-1.${'a'.repeat(43)}`
const EXPENSE_TOKEN_2 = `payload-2.${'b'.repeat(43)}`

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

  it('loads daily income through the exact finance route with bearer-only authentication', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { startDate: '2026-08-29', endDate: '2026-08-29' }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const filter: FinanceDailyFilter = { preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29' }

    await api.loadDailyIncome('raw-id-token', filter)

    expect(fetch).toHaveBeenCalledWith('/api/mini-app/finance/daily?startDate=2026-08-29&endDate=2026-08-29', {
      headers: { authorization: 'Bearer raw-id-token' },
    })
  })

  it('refreshes one daily income date without a JSON body and preserves a finance 403', async () => {
    const fetch = vi.fn(async () => jsonResponse(202, { accepted: true, allocationQueued: true, retryAfterSeconds: 300 }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.refreshDailyIncome('raw-id-token', '2026-08-29')).resolves.toEqual({
      accepted: true, allocationQueued: true, retryAfterSeconds: 300,
    })
    expect(fetch).toHaveBeenCalledWith('/api/mini-app/finance/daily/refresh?date=2026-08-29', {
      method: 'POST', headers: { authorization: 'Bearer raw-id-token' },
    })

    fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'FINANCE_FORBIDDEN' }))
    await expect(api.refreshDailyIncome('raw-id-token', '2026-08-29')).rejects.toMatchObject({
      code: 'FINANCE_FORBIDDEN', status: 403, retryAfterSeconds: null,
    })
  })

  it('loads monthly income without sending a derived month key', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { monthKey: '2026-08' }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const selection: FinanceMonthSelection = { year: 2026, month: 8 }

    await api.loadMonthlyIncome('raw-id-token', selection)

    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('/api/mini-app/finance/monthly?year=2026&month=8')
    expect(init).toEqual({ headers: { authorization: 'Bearer raw-id-token' } })
    expect(String(url)).not.toContain('monthKey')
  })

  it('serializes the committed row lifecycle version internally while preserving the selected revision for a replacement', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, expenseReceipt({ category: 'BOOK_CLINIC', revision: 3 })))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const input = {
      rootRequestId: 'replace-request-1', category: 'BOOK_CLINIC' as const, expenseDate: '2026-08-30', amountSatang: 120_000,
      counterpartyName: null, description: 'แก้ยอดรวม', paymentMethod: null, expectedRevision: 2, stagingTokens: ['payload.signature'],
    }

    await api.replaceExpense('raw-id-token', 'EXP-202608-BOOK-01', input)

    expect(fetch).toHaveBeenCalledWith('/api/mini-app/finance/expenses/EXP-202608-BOOK-01/replace', expect.objectContaining({
      method: 'POST', body: JSON.stringify({
        expectedVersion: 2, expectedRevision: 2, input: {
          rootRequestId: input.rootRequestId, category: input.category, expenseDate: input.expenseDate, amountSatang: input.amountSatang,
          counterpartyName: null, description: input.description, paymentMethod: null, stagingTokens: input.stagingTokens,
        },
      }),
    }))
  })

  it('issues private evidence tokens with bearer authentication and an empty POST body', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { token: EXPENSE_TOKEN_1 }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.issueExpenseEvidenceToken('raw-id-token', 'EXP-202608-BOOK-01', 'ATT-01')

    expect(fetch).toHaveBeenCalledWith('/api/mini-app/finance/expenses/EXP-202608-BOOK-01/evidence/ATT-01/token', {
      method: 'POST', headers: { authorization: 'Bearer raw-id-token' },
    })
  })

  it('rejects a monthly expense projection returned for a different month', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, expenseProjection('2026-09')))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.loadMonthlyExpenses('raw-id-token', '2026-08')).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it('rejects expense history rows returned for a different requested month', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { expenses: [expenseHistoryRow('2026-09')], nextCursor: null }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.loadExpenseHistory('raw-id-token', '2026-08')).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it('downloads evidence blobs with the current bearer token and viewer token', async () => {
    const fetch = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' }), {
      status: 200, headers: { 'content-type': 'image/png' },
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.downloadExpenseEvidence('raw-id-token', 'payload.signature')).resolves.toMatchObject({ type: 'image/png', size: 5 })
    expect(fetch).toHaveBeenCalledWith('/api/mini-app/finance/evidence?token=payload.signature', {
      headers: { authorization: 'Bearer raw-id-token' },
    })
  })

  it('stages ordered expense files and submits the exact Task 7 browser payload with bearer auth', async () => {
    const committed = expenseReceipt()
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { stagingTokens: [EXPENSE_TOKEN_1, EXPENSE_TOKEN_2] }))
      .mockResolvedValueOnce(jsonResponse(200, committed))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const files = [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ]
    const input = {
      rootRequestId: 'root-request-1', category: 'BILL_DOCUMENT' as const, expenseDate: '2026-08-30',
      amountSatang: 120_000, counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'TRANSFER' as const,
      expectedRevision: 0, stagingTokens: [EXPENSE_TOKEN_1, EXPENSE_TOKEN_2],
    }

    await expect(api.stageExpense('raw-id-token', input.rootRequestId, files)).resolves.toEqual({
      stagingTokens: [EXPENSE_TOKEN_1, EXPENSE_TOKEN_2],
    })
    await expect(api.submitExpense('raw-id-token', input)).resolves.toEqual(committed)

    const [, stageInit] = fetch.mock.calls[0]!
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/mini-app/expenses/staging/root-request-1')
    expect(stageInit).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer raw-id-token' } })
    expect((stageInit.body as FormData).getAll('file1')).toEqual([files[0]])
    expect((stageInit.body as FormData).getAll('file2')).toEqual([files[1]])
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/mini-app/expenses', expect.objectContaining({
      method: 'POST', headers: { authorization: 'Bearer raw-id-token', 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }))
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('staffId')
  })

  it('resumes one expense root through an empty authenticated POST and rejects history-shaped payloads', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { status: 'PENDING' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'PENDING', expenses: [] }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.resumeExpense('raw-id-token', 'root-request-1')).resolves.toEqual({ status: 'PENDING' })
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/mini-app/expenses/resume/root-request-1', {
      method: 'POST', headers: { authorization: 'Bearer raw-id-token' },
    })
    await expect(api.resumeExpense('raw-id-token', 'root-request-1'))
      .rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it('rejects malformed staging and committed responses before the shell can show success', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { stagingTokens: ['duplicate.signature', 'duplicate.signature'] }))
      .mockResolvedValueOnce(jsonResponse(200, { ...expenseReceipt(), recordState: 'PREPARED' }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.stageExpense('raw-id-token', 'root-request-1', [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.jpg', { type: 'image/jpeg' }),
    ])).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
    await expect(api.submitExpense('raw-id-token', {
      rootRequestId: 'root-request-1', category: 'BILL_DOCUMENT', expenseDate: '2026-08-30', amountSatang: 120_000,
      counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'CASH', expectedRevision: 0, stagingTokens: [EXPENSE_TOKEN_1],
    })).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it.each([
    ['too short', 'a.'],
    ['missing signature separator', 'payload-only'],
    ['whitespace', 'payload.bad signature'],
    ['unsafe punctuation', 'payload.bad+signature'],
  ])('rejects a %s staging token response', async (_label, token) => {
    const fetch = vi.fn(async () => jsonResponse(200, { stagingTokens: [token] }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    await expect(api.stageExpense('raw-id-token', 'root-request-1', [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
    ])).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it('preserves the exact server retryable boolean on safe client errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true }))
      .mockResolvedValueOnce(jsonResponse(400, { error: 'EXPENSE_INVALID_ATTACHMENTS', retryable: false }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })
    const input = {
      rootRequestId: 'root-request-1', category: 'BILL_DOCUMENT' as const, expenseDate: '2026-08-30', amountSatang: 120_000,
      counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'CASH' as const, expectedRevision: 0,
      stagingTokens: ['payload.signature'],
    }

    await expect(api.submitExpense('raw-id-token', input)).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
    await expect(api.submitExpense('raw-id-token', input)).rejects.toMatchObject({
      code: 'EXPENSE_INVALID_ATTACHMENTS', retryable: false,
    })
  })

  it('rejects an internally valid receipt that does not match the submitted expense', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, expenseReceipt()))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.submitExpense('raw-id-token', {
      rootRequestId: 'root-request-book', category: 'BOOK_DOCTOR_PERSONAL', expenseDate: '2026-08-30', amountSatang: 500_000,
      counterpartyName: null, description: '', paymentMethod: null, expectedRevision: 0, stagingTokens: [EXPENSE_TOKEN_1],
    })).rejects.toMatchObject({ code: 'MINI_APP_INVALID_RESPONSE' })
  })

  it('keeps only a bounded numeric integer retry delay from a finance error response', async () => {
    const fetch = vi.fn(async () => jsonResponse(429, { error: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: 999_999 }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.refreshDailyIncome('raw-id-token', '2026-08-29')).rejects.toMatchObject({
      code: 'FINANCE_REFRESH_UNAVAILABLE', status: 429, retryAfterSeconds: null,
    })
    fetch.mockResolvedValueOnce(jsonResponse(429, { error: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: '300' }))
    await expect(api.refreshDailyIncome('raw-id-token', '2026-08-29')).rejects.toMatchObject({
      code: 'FINANCE_REFRESH_UNAVAILABLE', status: 429, retryAfterSeconds: null,
    })
  })

  it('preserves a valid bounded numeric retry delay on a 429 finance client error', async () => {
    const fetch = vi.fn(async () => jsonResponse(429, {
      error: 'FINANCE_REFRESH_UNAVAILABLE', retryAfterSeconds: 300,
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await expect(api.refreshDailyIncome('raw-id-token', '2026-08-29')).rejects.toMatchObject({
      code: 'FINANCE_REFRESH_UNAVAILABLE', status: 429, retryAfterSeconds: 300,
    })
  })

  it('loads Stock products and cursor history with bearer auth', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { products: [] }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.loadStockProducts('raw-id-token')
    await api.loadStockHistory('raw-id-token', 'opaque cursor')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/mini-app/stock/products', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/mini-app/stock/history?cursor=opaque%20cursor', expect.objectContaining({
      headers: { authorization: 'Bearer raw-id-token' },
    }))
  })

  it.each([
    ['ISSUE', { requestId: 'issue-1', commandType: 'ISSUE', payload: { lines: [{ productId: 'STK-1', quantityMilli: 1_000 }] } },
      '/api/mini-app/stock/issues', 'POST', { requestId: 'issue-1', lines: [{ productId: 'STK-1', quantityMilli: 1_000 }] }],
    ['RECEIVE', { requestId: 'receive-1', commandType: 'RECEIVE', payload: { lines: [{ productId: 'STK-1', quantityMilli: 2_000 }] } },
      '/api/mini-app/stock/receipts', 'POST', { requestId: 'receive-1', lines: [{ productId: 'STK-1', quantityMilli: 2_000 }] }],
    ['CREATE_PRODUCT', { requestId: 'create-1', commandType: 'CREATE_PRODUCT', payload: {
      name: 'เข็ม', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', openingQuantityMilli: 0, minimumQuantityMilli: 1_000,
    } }, '/api/mini-app/stock/products', 'POST', {
      requestId: 'create-1', name: 'เข็ม', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', openingQuantityMilli: 0, minimumQuantityMilli: 1_000,
    }],
    ['ADJUST', { requestId: 'adjust-1', commandType: 'ADJUST', payload: {
      productId: 'STK-1', countedQuantityMilli: 3_000, reason: 'ตรวจนับ',
    } }, '/api/mini-app/stock/adjustments', 'POST', {
      requestId: 'adjust-1', productId: 'STK-1', countedQuantityMilli: 3_000, reason: 'ตรวจนับ',
    }],
    ['UPDATE_PRODUCT', { requestId: 'update-1', commandType: 'UPDATE_PRODUCT', payload: {
      productId: 'STK-1', expectedVersion: 2, name: 'เข็มใหม่', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', minimumQuantityMilli: 2_000,
    } }, '/api/mini-app/stock/products/STK-1', 'PATCH', {
      requestId: 'update-1', action: 'UPDATE', expectedVersion: 2, name: 'เข็มใหม่', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', minimumQuantityMilli: 2_000,
    }],
    ['DEACTIVATE_PRODUCT', { requestId: 'off-1', commandType: 'DEACTIVATE_PRODUCT', payload: {
      productId: 'STK-1', expectedVersion: 3,
    } }, '/api/mini-app/stock/products/STK-1', 'PATCH', { requestId: 'off-1', action: 'DEACTIVATE', expectedVersion: 3 }],
    ['REACTIVATE_PRODUCT', { requestId: 'on-1', commandType: 'REACTIVATE_PRODUCT', payload: {
      productId: 'STK-1', expectedVersion: 4,
    } }, '/api/mini-app/stock/products/STK-1', 'PATCH', { requestId: 'on-1', action: 'REACTIVATE', expectedVersion: 4 }],
  ] as const)('maps %s browser commands to the strict Stock API shape without staff identity', async (_name, command, url, method, body) => {
    const fetch = vi.fn(async () => jsonResponse(200, {
      requestId: command.requestId, documentId: 'DOC-1', commandType: command.commandType, createdAt: '2026-08-28T00:00:00.000Z', lines: [],
    }))
    const api = createMiniAppApi({ fetch, liff: inertLiff() })

    await api.submitStockCommand('raw-id-token', command)

    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({
      method,
      headers: { authorization: 'Bearer raw-id-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('staffId')
  })
})

function inertLiff() {
  return { init: vi.fn(async () => undefined), isLoggedIn: () => true, login: vi.fn(), getIDToken: () => 'token' }
}

function queuedProjection() {
  return {
    draftId: 'draft-1', requestId: 'request-1', state: 'QUEUED', retentionState: '', version: 5,
    input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 3, chatEvidenceCount: 1, confirmationStatus: null,
    caseId: null, safeErrorCode: null, queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: null,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function expenseReceipt(overrides: Partial<ExpenseReceipt> = {}): ExpenseReceipt {
  return {
    expenseId: 'EXP-202608-RESULT', receiptNumber: 'EXP-202608-RESULT', expenseDate: '2026-08-30', monthKey: '2026-08',
    category: 'BILL_DOCUMENT', scope: 'CLINIC', amountSatang: 120_000, recordState: 'COMMITTED', revision: 1,
    committedAt: '2026-08-30T04:00:00.000Z', unreviewed: true, ...overrides,
  }
}

function expenseProjection(monthKey: string) {
  return {
    monthKey, clinicCommittedSatang: 120_000, doctorPersonalCommittedSatang: 50_000,
    clinicByCategorySatang: { BILL_DOCUMENT: 100_000, BOOK_CLINIC: 20_000 }, effectiveExpenseCount: 2, unreviewed: true,
  }
}

function expenseHistoryRow(monthKey: string) {
  return {
    expenseId: `EXP-${monthKey.replace('-', '')}-BOOK-01`, expenseDate: `${monthKey}-29`, category: 'BOOK_CLINIC', scope: 'CLINIC',
    amountSatang: 120_000, description: 'สมุดรายวัน', recordState: 'COMMITTED', revision: 2, submittedByName: 'มัส',
    submittedAt: '2026-08-29T02:00:00.000Z', committedAt: '2026-08-29T02:01:00.000Z', attachments: [],
  }
}
