import { createHash } from 'node:crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { ExpenseReceipt } from '../../shared/pmcExpense'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type { FinanceServerDependencies, LineIdentityPort } from '../../server/pmc-mini-app/contracts'
import { ExpenseSubmissionError } from '../../server/pmc-mini-app/finance/submissionService'
import { ExpenseIngressClientError } from '../../server/pmc-mini-app/finance/ingressClient'
import type { ExpenseStagingReceipt, ExpenseSubmissionLease } from '../../server/pmc-mini-app/finance/stagingStore'
import type { ExpenseAsyncJob, ExpenseAsyncJobInput } from '../../server/pmc-mini-app/finance/asyncJobStore'
import { signExpenseStagingReceipt } from '../../server/pmc-mini-app/finance/stagingToken'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppStaffRecord, MiniAppStore } from '../../server/pmc-mini-app/store'

const SECRET = 'finance-browser-signing-secret-32-bytes-minimum'
const NOW = Date.parse('2026-08-30T03:00:00.000Z')
const MONTH_KEY = '2026-08'
const EXPENSE_ID = 'EXP-202608-CURRENT'

describe('expense capture API', () => {
  it('stages the raw multipart stream and returns only staff/root-bound browser tokens', async () => {
    const deps = dependencies()
    const form = new FormData()
    form.append('file1', new Blob([await image()], { type: 'image/jpeg' }), 'receipt.jpg')

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses/staging/root-request-1', form, 'submit-token',
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ stagingTokens: [expect.any(String)] })
    expect(deps.finance.capture?.staging.put).toHaveBeenCalledWith(expect.objectContaining({
      rootRequestId: 'root-request-1', ordinal: 1, originalFileName: 'receipt.jpg', mimeType: 'image/jpeg',
      bytes: expect.any(Buffer),
    }))
    const serialized = JSON.stringify(response.body)
    expect(serialized).not.toContain('expenses/root-request-1')
    expect(serialized).not.toContain('privateFileId')
    expect(serialized).not.toContain('bucket')
  })

  it('submits exact browser input with authenticated staff and returns exactly ExpenseReceipt', async () => {
    const deps = dependencies()
    const receipt = stagedReceipt('root-request-2')
    vi.mocked(deps.finance.capture!.staging.get).mockResolvedValue({ ...receipt, bytes: Buffer.from('private-image') })
    const token = signExpenseStagingReceipt({
      receipt, staffId: 'SUBMIT_01', rootRequestId: 'root-request-2', secret: SECRET, now: () => NOW,
    })

    const response = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', {
      rootRequestId: 'root-request-2', expenseDate: '2026-08-29', category: 'BILL_DOCUMENT',
      amountSatang: 12_000, counterpartyName: 'ร้านทดสอบ', description: 'ค่าวัสดุ',
      paymentMethod: 'TRANSFER', expectedRevision: 0, stagingTokens: [token],
    }, 'submit-token')

    expect(response).toMatchObject({ status: 200, body: committedReceipt() })
    expect(deps.finance.capture?.submission.submit).toHaveBeenCalledWith({
      rootRequestId: 'root-request-2', staffId: 'SUBMIT_01', expenseDate: '2026-08-29',
      category: 'BILL_DOCUMENT', amountSatang: 12_000, counterpartyName: 'ร้านทดสอบ',
      description: 'ค่าวัสดุ', paymentMethod: 'TRANSFER', expectedRevision: 0,
      stagingReceipts: [receipt],
    })
    expect(Object.keys(response.body as object).sort()).toEqual([
      'amountSatang', 'category', 'committedAt', 'expenseDate', 'expenseId', 'monthKey',
      'receiptNumber', 'recordState', 'revision', 'scope', 'unreviewed',
    ])
  })

  it('accepts a pilot expense as a durable async job and never submits inline', async () => {
    const deps = dependencies()
    const async = enableExpenseAsync(deps.finance, ['SUBMIT_01'])
    const body = validSubmitBody('async-root-1')
    primeToken(deps, body, 'SUBMIT_01')

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', body, 'submit-token',
    )

    expect(response).toEqual(expect.objectContaining({
      status: 202,
      body: {
        rootRequestId: 'async-root-1',
        status: 'PENDING',
        acceptedAt: '2026-08-30T03:00:00.000Z',
      },
    }))
    expect(async.jobs.createOrRead).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'CREATE', replacementOfExpenseId: null, expectedVersion: null,
      acceptedAt: '2026-08-30T03:00:00.000Z',
      submission: expect.objectContaining({
        rootRequestId: 'async-root-1', staffId: 'SUBMIT_01', category: 'BILL_DOCUMENT',
      }),
    }))
    expect(async.queue.enqueue).toHaveBeenCalledWith({
      rootRequestId: 'async-root-1',
      fingerprint: 'a'.repeat(64),
      scheduleAt: new Date(NOW + 2_000),
    })
    expect(async.jobs.markQueued).toHaveBeenCalledOnce()
    expect(deps.finance.capture?.submission.submit).not.toHaveBeenCalled()
  })

  it('keeps non-pilot submitters on the synchronous rollback path while async is enabled', async () => {
    const deps = dependencies()
    const async = enableExpenseAsync(deps.finance, ['FINANCE_01'])
    const body = validSubmitBody('sync-rollback-root')
    primeToken(deps, body, 'SUBMIT_01')

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', body, 'submit-token',
    )

    expect(response).toMatchObject({ status: 200, body: committedReceipt() })
    expect(deps.finance.capture?.submission.submit).toHaveBeenCalledOnce()
    expect(async.jobs.createOrRead).not.toHaveBeenCalled()
    expect(async.queue.enqueue).not.toHaveBeenCalled()
  })

  it('leaves a QUEUING job retryable when enqueue is uncertain and replays the deterministic task', async () => {
    const deps = dependencies()
    const async = enableExpenseAsync(deps.finance, ['SUBMIT_01'])
    vi.mocked(async.queue.enqueue)
      .mockRejectedValueOnce(new Error('provider metadata must not escape'))
      .mockResolvedValueOnce({ taskName: taskName('async-retry-root'), alreadyExists: true })
    const body = validSubmitBody('async-retry-root')
    primeToken(deps, body, 'SUBMIT_01')
    const middleware = createPmcMiniAppMiddleware(deps)

    const first = await request(middleware, 'POST', '/api/mini-app/expenses', body, 'submit-token')
    const retry = await request(middleware, 'POST', '/api/mini-app/expenses', body, 'submit-token')

    expect(first).toMatchObject({
      status: 503, body: { error: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true },
    })
    expect(JSON.stringify(first.body)).not.toContain('provider metadata')
    expect(retry).toMatchObject({
      status: 202,
      body: { rootRequestId: 'async-retry-root', status: 'PENDING' },
    })
    expect(async.jobs.createOrRead).toHaveBeenCalledTimes(2)
    expect(async.queue.enqueue).toHaveBeenCalledTimes(2)
    expect(async.jobs.markQueued).toHaveBeenCalledOnce()
    expect(deps.finance.capture?.submission.submit).not.toHaveBeenCalled()
  })

  it('rejects unknown/repeated/query fields, spoofed identity, wrong-root tokens, and oversized JSON before submit', async () => {
    const deps = dependencies()
    const receipt = stagedReceipt('root-request-3')
    vi.mocked(deps.finance.capture!.staging.get).mockResolvedValue({ ...receipt, bytes: Buffer.from('private-image') })
    const token = signExpenseStagingReceipt({
      receipt, staffId: 'SUBMIT_01', rootRequestId: 'root-request-3', secret: SECRET, now: () => NOW,
    })
    const valid = {
      rootRequestId: 'root-request-3', expenseDate: '2026-08-29', category: 'BILL_DOCUMENT',
      amountSatang: 12_000, counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'CASH',
      expectedRevision: 0, stagingTokens: [token],
    }

    const extra = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', {
      ...valid, staffId: 'FINANCE_01',
    }, 'submit-token')
    const query = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses?month=2026-08', valid, 'submit-token')
    const wrongRoot = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', {
      ...valid, rootRequestId: 'different-root',
    }, 'submit-token')
    const repeated = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', {
      ...valid, stagingTokens: [token, token],
    }, 'submit-token')
    const oversized = await request(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses', {
      ...valid, description: 'x'.repeat(65 * 1024),
    }, 'submit-token')

    expect(extra).toMatchObject({ status: 400, body: { error: 'EXPENSE_UNKNOWN_FIELD', retryable: false } })
    expect(query).toMatchObject({ status: 400, body: { error: 'EXPENSE_UNKNOWN_FIELD', retryable: false } })
    expect(wrongRoot.status).toBe(400)
    expect(repeated.status).toBe(400)
    expect(oversized).toMatchObject({ status: 413, body: { error: 'EXPENSE_PAYLOAD_TOO_LARGE', retryable: false } })
    expect(deps.finance.capture?.submission.submit).not.toHaveBeenCalled()
  })

  it('maps only allowlisted safe errors and retryability without returning raw causes', async () => {
    const storage = dependencies()
    const conflict = dependencies()
    const raw = dependencies()
    const body = validSubmitBody('error-root')
    primeToken(storage, body, 'SUBMIT_01')
    primeToken(conflict, body, 'SUBMIT_01')
    primeToken(raw, body, 'SUBMIT_01')
    vi.mocked(storage.finance.capture!.submission.submit).mockRejectedValueOnce(
      new ExpenseSubmissionError('EXPENSE_STORAGE_UNAVAILABLE'),
    )
    vi.mocked(conflict.finance.capture!.submission.submit).mockRejectedValueOnce(
      new ExpenseSubmissionError('EXPENSE_REVISION_CONFLICT'),
    )
    vi.mocked(raw.finance.capture!.submission.submit).mockRejectedValueOnce(
      new Error('private workbook finance-master'),
    )

    const storageResponse = await request(createPmcMiniAppMiddleware(storage), 'POST', '/api/mini-app/expenses', body, 'submit-token')
    const conflictResponse = await request(createPmcMiniAppMiddleware(conflict), 'POST', '/api/mini-app/expenses', body, 'submit-token')
    const rawResponse = await request(createPmcMiniAppMiddleware(raw), 'POST', '/api/mini-app/expenses', body, 'submit-token')
    expect(storageResponse).toMatchObject({
      status: 503, body: { error: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true },
    })
    expect(conflictResponse).toMatchObject({
      status: 409, body: { error: 'EXPENSE_REVISION_CONFLICT', retryable: false },
    })
    expect(rawResponse).toMatchObject({
      status: 503, body: { error: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true },
    })
    expect(JSON.stringify([storageResponse.body, conflictResponse.body, rawResponse.body])).not.toContain('finance-master')
  })

  it('resumes one root for its authenticated submitter without capture or history access', async () => {
    const resume = vi.fn(async () => ({ status: 'COMMITTED' as const, receipt: committedReceipt() }))
    const finance: FinanceServerDependencies = {
      signingSecret: SECRET,
      resume: { ingress: { resume } as never, staging: { readSubmissionLease: vi.fn() } as never },
    }
    const deps = dependencies({ finance })

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses/resume/root-request-2', null, 'submit-token',
    )

    expect(response).toMatchObject({
      status: 200, body: { status: 'COMMITTED', receipt: committedReceipt() },
    })
    expect(resume).toHaveBeenCalledWith({ rootRequestId: 'root-request-2', staffId: 'SUBMIT_01' })
    expect(finance.reads).toBeUndefined()
    expect(finance.capture).toBeUndefined()
  })

  it.each([
    ['missing lease', null, 'PREPARED'],
    ['active fresh lease', submissionLease({ expiresAt: new Date(NOW + 1).toISOString() }), 'PENDING'],
    ['active expired lease', submissionLease({ expiresAt: new Date(NOW - 1).toISOString() }), 'PREPARED'],
    ['active lease at the expiry boundary', submissionLease({ expiresAt: new Date(NOW).toISOString() }), 'PREPARED'],
    ['committed lease', submissionLease({ state: 'COMMITTED', expiresAt: new Date(NOW - 1).toISOString() }), 'PENDING'],
  ] as const)('projects internal PREPARED through a %s without exposing expense identity', async (
    _case,
    lease,
    expectedStatus,
  ) => {
    const resume = vi.fn(async () => ({ status: 'PREPARED' as const, expenseId: EXPENSE_ID }))
    const readSubmissionLease = vi.fn(async () => lease)
    const finance: FinanceServerDependencies = {
      signingSecret: SECRET,
      now: () => NOW,
      resume: {
        ingress: { resume } as never,
        staging: { readSubmissionLease } as never,
      },
    }

    const response = await request(
      createPmcMiniAppMiddleware(dependencies({ finance })),
      'POST',
      '/api/mini-app/expenses/resume/root-request-2',
      null,
      'submit-token',
    )

    expect(response).toMatchObject({ status: 200, body: { status: expectedStatus } })
    expect(Object.keys(response.body as object)).toEqual(['status'])
    expect(readSubmissionLease).toHaveBeenCalledWith(EXPENSE_ID)
    expect(JSON.stringify(response.body)).not.toContain(EXPENSE_ID)
  })

  it('denies another submitter and never serializes root history', async () => {
    const resume = vi.fn(async () => {
      throw new ExpenseIngressClientError('EXPENSE_RESUME_FORBIDDEN')
    })
    const deps = dependencies({ finance: {
      signingSecret: SECRET,
      resume: { ingress: { resume } as never, staging: { readSubmissionLease: vi.fn() } as never },
    } })

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/expenses/resume/root-request-2', null, 'finance-token',
    )

    expect(response).toMatchObject({
      status: 403, body: { error: 'EXPENSE_RESUME_FORBIDDEN', retryable: false },
    })
    expect(JSON.stringify(response.body)).not.toContain('expenses')
    expect(JSON.stringify(response.body)).not.toContain('attachment')
  })

  it('projects storage-unavailable resume uncertainty as retryable 503 instead of terminal FAILED', async () => {
    const resume = vi.fn(async () => ({
      status: 'FAILED' as const, error: 'EXPENSE_STORAGE_UNAVAILABLE' as const,
    }))
    const finance: FinanceServerDependencies = {
      signingSecret: SECRET,
      resume: { ingress: { resume } as never, staging: { readSubmissionLease: vi.fn() } as never },
    }

    const response = await request(
      createPmcMiniAppMiddleware(dependencies({ finance })),
      'POST', '/api/mini-app/expenses/resume/root-request-2', null, 'submit-token',
    )

    expect(response).toMatchObject({
      status: 503,
      body: { error: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true },
    })
    expect(Object.keys(response.body as object).sort()).toEqual(['error', 'retryable'])
  })

  it.each([
    ['QUEUING', { status: 'PENDING' }],
    ['QUEUED', { status: 'PENDING' }],
    ['PROCESSING', { status: 'PENDING' }],
    ['RETRYING', { status: 'PENDING' }],
    ['COMMITTED', { status: 'COMMITTED', receipt: committedReceipt() }],
    ['FAILED', { status: 'FAILED', error: 'EXPENSE_REVISION_CONFLICT' }],
    ['NEEDS_REVIEW', { status: 'FAILED', error: 'EXPENSE_NEEDS_REVIEW' }],
  ] as const)('projects async %s before consulting the legacy ingress', async (state, expected) => {
    const legacyResume = vi.fn(async () => ({ status: 'SAFE_TO_RETRY' as const }))
    const finance: FinanceServerDependencies = {
      signingSecret: SECRET,
      resume: { ingress: { resume: legacyResume } as never, staging: { readSubmissionLease: vi.fn() } as never },
    }
    const async = enableExpenseAsync(finance, ['SUBMIT_01'])
    vi.mocked(async.jobs.read).mockResolvedValueOnce(asyncJob({
      state,
      receipt: state === 'COMMITTED' ? committedReceipt() : null,
      safeErrorCode: state === 'FAILED' ? 'EXPENSE_REVISION_CONFLICT'
        : state === 'NEEDS_REVIEW' ? 'EXPENSE_NEEDS_REVIEW' : null,
    }))

    const response = await request(
      createPmcMiniAppMiddleware(dependencies({ finance })), 'POST',
      '/api/mini-app/expenses/resume/async-resume-root', null, 'submit-token',
    )

    expect(response).toMatchObject({ status: 200, body: expected })
    expect(legacyResume).not.toHaveBeenCalled()
  })

  it('falls back to the legacy resume journal when the async job does not exist', async () => {
    const legacyResume = vi.fn(async () => ({ status: 'SAFE_TO_RETRY' as const }))
    const finance: FinanceServerDependencies = {
      signingSecret: SECRET,
      resume: { ingress: { resume: legacyResume } as never, staging: { readSubmissionLease: vi.fn() } as never },
    }
    const async = enableExpenseAsync(finance, ['SUBMIT_01'])
    vi.mocked(async.jobs.read).mockResolvedValueOnce(null)

    const response = await request(
      createPmcMiniAppMiddleware(dependencies({ finance })), 'POST',
      '/api/mini-app/expenses/resume/legacy-root', null, 'submit-token',
    )

    expect(response).toMatchObject({ status: 200, body: { status: 'SAFE_TO_RETRY' } })
    expect(legacyResume).toHaveBeenCalledOnce()
  })
})

describe('finance read and correction APIs', () => {
  it('reads one requested month and fixed-page history only for finance viewers', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const monthly = await request(middleware, 'GET', '/api/mini-app/finance/months/2026-08/expenses', null, 'finance-token')
    const history = await request(middleware, 'GET', '/api/mini-app/finance/expenses?month=2026-08&cursor=cursor-1', null, 'finance-token')

    expect(monthly.body).toEqual(monthlyProjection())
    expect(history.body).toEqual({ expenses: [], nextCursor: null })
    expect(deps.finance.reads?.readStore.loadMonthlyExpenses).toHaveBeenCalledWith('2026-08')
    expect(deps.finance.reads?.readStore.listExpenseHistory).toHaveBeenCalledWith('2026-08', 'cursor-1', 25)

    const repeatedMonth = await request(middleware, 'GET', '/api/mini-app/finance/expenses?month=2026-08&month=2026-09', null, 'finance-token')
    const extra = await request(middleware, 'GET', '/api/mini-app/finance/months/2026-08/expenses?all=true', null, 'finance-token')
    expect(repeatedMonth.status).toBe(400)
    expect(extra.status).toBe(400)
  })

  it('rejects fixed and slow chunked GET bodies before finance capability or store access', async () => {
    const paths = [
      '/api/mini-app/finance/months/2026-08/expenses',
      '/api/mini-app/finance/expenses?month=2026-08',
      '/api/mini-app/finance/evidence?token=framed-body-token',
    ]

    const missingCapabilities = dependencies({ finance: undefined })
    for (const path of paths) {
      await expect(framedGet(
        createPmcMiniAppMiddleware(missingCapabilities),
        path,
        'content-length',
      )).resolves.toMatchObject({
        status: 400,
        body: { error: 'EXPENSE_INVALID_REQUEST', retryable: false },
      })
    }

    const configured = dependencies()
    for (const path of paths) {
      await expect(framedGet(
        createPmcMiniAppMiddleware(configured),
        path,
        'slow-chunked',
      )).resolves.toMatchObject({
        status: 400,
        body: { error: 'EXPENSE_INVALID_REQUEST', retryable: false },
      })
    }
    expect(configured.finance.reads?.readStore.loadMonthlyExpenses).not.toHaveBeenCalled()
    expect(configured.finance.reads?.readStore.listExpenseHistory).not.toHaveBeenCalled()
    expect(configured.finance.reads?.readStore.getEvidence).not.toHaveBeenCalled()
  })

  it('replaces only the current book revision without allowing date/category/scope boundary changes', async () => {
    const deps = dependencies()
    const receipt = stagedReceipt('replace-root')
    vi.mocked(deps.finance.capture!.staging.get).mockResolvedValue({ ...receipt, bytes: Buffer.from('private-image') })
    const token = signExpenseStagingReceipt({
      receipt, staffId: 'FINANCE_01', rootRequestId: 'replace-root', secret: SECRET, now: () => NOW,
    })
    const input = {
      rootRequestId: 'replace-root', expenseDate: '2026-08-29', category: 'BOOK_CLINIC',
      amountSatang: 22_000, counterpartyName: null, description: 'แก้ยอดรวม', paymentMethod: null,
      stagingTokens: [token],
    }
    const middleware = createPmcMiniAppMiddleware(deps)
    const replaced = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/replace`, {
      expectedVersion: 2, expectedRevision: 1, input,
    }, 'finance-token')
    expect(replaced).toMatchObject({ status: 200, body: committedReceipt({ category: 'BOOK_CLINIC', revision: 2 }) })
    expect(deps.finance.capture?.submission.submit).toHaveBeenCalledWith(expect.objectContaining({
      rootRequestId: 'replace-root', staffId: 'FINANCE_01', expenseDate: '2026-08-29',
      category: 'BOOK_CLINIC', expectedRevision: 1,
    }))

    vi.mocked(deps.finance.capture!.submission.submit).mockClear()
    const crossDate = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/replace`, {
      expectedVersion: 2, expectedRevision: 1, input: { ...input, expenseDate: '2026-08-30' },
    }, 'finance-token')
    const crossCategory = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/replace`, {
      expectedVersion: 2, expectedRevision: 1, input: { ...input, category: 'BOOK_DOCTOR_PERSONAL' },
    }, 'finance-token')
    expect(crossDate).toMatchObject({ status: 409, body: { error: 'EXPENSE_IMMUTABLE_FIELD', retryable: false } })
    expect(crossCategory.status).toBe(409)
    expect(deps.finance.capture?.submission.submit).not.toHaveBeenCalled()
  })

  it('accepts an allowlisted replacement asynchronously after validating the current revision', async () => {
    const deps = dependencies()
    const async = enableExpenseAsync(deps.finance, ['FINANCE_01'])
    const receipt = stagedReceipt('replace-async-root')
    vi.mocked(deps.finance.capture!.staging.get).mockResolvedValue({ ...receipt, bytes: Buffer.from('private-image') })
    const token = signExpenseStagingReceipt({
      receipt, staffId: 'FINANCE_01', rootRequestId: 'replace-async-root', secret: SECRET, now: () => NOW,
    })

    const response = await request(
      createPmcMiniAppMiddleware(deps), 'POST',
      `/api/mini-app/finance/expenses/${EXPENSE_ID}/replace`, {
        expectedVersion: 2,
        expectedRevision: 1,
        input: {
          rootRequestId: 'replace-async-root', expenseDate: '2026-08-29', category: 'BOOK_CLINIC',
          amountSatang: 22_000, counterpartyName: null, description: 'แก้ยอดรวม', paymentMethod: null,
          stagingTokens: [token],
        },
      }, 'finance-token',
    )

    expect(response).toMatchObject({
      status: 202,
      body: { rootRequestId: 'replace-async-root', status: 'PENDING', acceptedAt: '2026-08-30T03:00:00.000Z' },
    })
    expect(async.jobs.createOrRead).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'REPLACE', replacementOfExpenseId: EXPENSE_ID, expectedVersion: 2,
      submission: expect.objectContaining({ expectedRevision: 1, staffId: 'FINANCE_01' }),
    }))
    expect(deps.finance.capture?.submission.submit).not.toHaveBeenCalled()
  })

  it('voids through the capture ingress with exact version/reason and no approval semantics', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const response = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/void`, {
      rootRequestId: 'void-root', expectedVersion: 2, expectedRevision: 1, reason: 'ยอดรวมบันทึกผิด',
    }, 'finance-token')

    expect(response).toMatchObject({
      status: 200,
      body: { expenseId: EXPENSE_ID, recordState: 'VOID', version: 3, updatedAt: '2026-08-30T03:00:00.000Z' },
    })
    expect(deps.finance.capture?.ingress.void).toHaveBeenCalledWith({
      rootRequestId: 'void-root', commandIdempotencyKey: 'void-root:void', staffId: 'FINANCE_01',
      commandType: 'VOID_EXPENSE', payload: {
        expenseId: EXPENSE_ID, expectedVersion: 2, expectedRevision: 1, reason: 'ยอดรวมบันทึกผิด',
      },
    })

    const approvalField = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/void`, {
      rootRequestId: 'void-root-2', expectedVersion: 2, expectedRevision: 1, reason: 'ยอดรวมบันทึกผิด', approved: true,
    }, 'finance-token')
    expect(approvalField).toMatchObject({ status: 400, body: { error: 'EXPENSE_UNKNOWN_FIELD', retryable: false } })
  })

  it('rejects a stale VOID expectedRevision before calling the capture ingress', async () => {
    const deps = dependencies()
    const response = await request(
      createPmcMiniAppMiddleware(deps),
      'POST',
      `/api/mini-app/finance/expenses/${EXPENSE_ID}/void`,
      {
        rootRequestId: 'void-stale-revision',
        expectedVersion: 2,
        expectedRevision: 2,
        reason: 'ยอดรวมจาก revision เก่า',
      },
      'finance-token',
    )

    expect(response).toMatchObject({
      status: 409,
      body: { error: 'EXPENSE_REVISION_CONFLICT', retryable: false },
    })
    expect(deps.finance.capture?.ingress.void).not.toHaveBeenCalled()
  })

  it.each([
    [2, 400],
    [3, 200],
    [300, 200],
    [301, 400],
  ])('enforces VOID reason length %i at the 3..300 server boundary', async (length, expectedStatus) => {
    const deps = dependencies()
    const response = await request(
      createPmcMiniAppMiddleware(deps),
      'POST',
      `/api/mini-app/finance/expenses/${EXPENSE_ID}/void`,
      {
        rootRequestId: `void-reason-${length}`,
        expectedVersion: 2,
        expectedRevision: 1,
        reason: 'ก'.repeat(length),
      },
      'finance-token',
    )
    expect(response.status).toBe(expectedStatus)
  })

  it('checks manager permission before correction body parsing or capability access', async () => {
    const deps = dependencies({ finance: undefined })
    const middleware = createPmcMiniAppMiddleware(deps)
    const replace = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/replace`, {}, 'submit-token')
    const voided = await request(middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/void`, {}, 'submit-token')
    expect(replace).toMatchObject({ status: 403, body: { error: 'EXPENSE_MANAGE_PERMISSION_REQUIRED' } })
    expect(voided).toMatchObject({ status: 403, body: { error: 'EXPENSE_MANAGE_PERMISSION_REQUIRED' } })
  })
})

function dependencies(options: { finance?: FinanceServerDependencies } = {}): {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
  finance: FinanceServerDependencies
} {
  const staged = new Map<string, ExpenseStagingReceipt & { bytes: Buffer }>()
  const finance = Object.prototype.hasOwnProperty.call(options, 'finance')
    ? options.finance
    : financeDependencies(staged)
  const staffByLine = new Map<string, MiniAppStaffRecord>([
    ['Usubmit-private', staff('SUBMIT_01', { canSubmitExpense: true })],
    ['Ufinance-private', staff('FINANCE_01', { canSubmitExpense: true, canViewFinance: true, canManageExpense: true })],
  ])
  return {
    config: config(),
    identity: {
      async verify(idToken) {
        const lineUserId = idToken === 'submit-token' ? 'Usubmit-private'
          : idToken === 'finance-token' ? 'Ufinance-private' : null
        if (!lineUserId) throw new Error('invalid')
        return { lineUserId }
      },
    },
    store: {
      getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => staffByLine.get(lineUserId) ?? null),
      getActiveBookingConfig: vi.fn(async () => ({ doctors: [], services: [], channels: [], aes: [] })),
    } as unknown as MiniAppStore,
    finance: finance!,
  }
}

function financeDependencies(staged = new Map<string, ExpenseStagingReceipt & { bytes: Buffer }>()): FinanceServerDependencies {
  const staging = {
    put: vi.fn(async (input: {
      rootRequestId: string; ordinal: number; originalFileName: string; mimeType: 'image/jpeg' | 'image/png'; bytes: Buffer
    }) => {
      const sha256 = createHash('sha256').update(input.bytes).digest('hex')
      const receipt: ExpenseStagingReceipt = {
        objectKey: `expenses/${input.rootRequestId}/${input.ordinal}-${sha256}.${input.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
        sizeBytes: input.bytes.length, mimeType: input.mimeType, sha256, ordinal: input.ordinal,
        originalFileName: input.originalFileName, createdAt: '2026-08-30T03:00:00.000Z',
      }
      staged.set(receipt.objectKey, { ...receipt, bytes: input.bytes })
      return receipt
    }),
    get: vi.fn(async (objectKey: string) => {
      const result = staged.get(objectKey)
      if (!result) throw new Error('missing')
      return result
    }),
    deleteVerified: vi.fn(), claimDriveSlot: vi.fn(), readSubmissionLease: vi.fn(),
    acquireSubmissionLease: vi.fn(), renewSubmissionLease: vi.fn(),
    assertSubmissionLease: vi.fn(), commitSubmissionLease: vi.fn(),
  }
  return {
    signingSecret: SECRET, now: () => NOW,
    reads: {
      readStore: {
        loadMonthlyExpenses: vi.fn(async () => monthlyProjection()),
        listExpenseHistory: vi.fn(async () => ({ expenses: [], nextCursor: null })),
        getEvidence: vi.fn(async () => ({ bytes: Buffer.from('private-image'), mimeType: 'image/jpeg' as const })),
        getExpenseMutationContext: vi.fn(async () => ({
          expenseId: EXPENSE_ID, expenseDate: '2026-08-29', monthKey: MONTH_KEY,
          category: 'BOOK_CLINIC' as const, scope: 'CLINIC' as const, bookDailyKey: 'CLINIC:2026-08-29',
          recordState: 'COMMITTED' as const, revision: 1, version: 2,
        })),
      },
    },
    capture: {
      staging,
      submission: { submit: vi.fn(async (input: { category: string; expectedRevision: number }) => committedReceipt({
        category: input.category === 'BOOK_CLINIC' ? 'BOOK_CLINIC' : 'BILL_DOCUMENT',
        revision: input.expectedRevision + 1,
      })) },
      ingress: {
        prepare: vi.fn(), commit: vi.fn(),
        void: vi.fn(async () => ({
          expenseId: EXPENSE_ID, recordState: 'VOID' as const, version: 3,
          updatedAt: '2026-08-30T03:00:00.000Z',
        })),
      },
    },
  }
}

function enableExpenseAsync(finance: FinanceServerDependencies, pilotStaffIds: string[]) {
  const jobs = {
    createOrRead: vi.fn(async (input: ExpenseAsyncJobInput) => ({ job: asyncJob({
      rootRequestId: input.submission.rootRequestId,
      staffId: input.submission.staffId,
      kind: input.kind,
      replacementOfExpenseId: input.replacementOfExpenseId,
      expectedVersion: input.expectedVersion,
      submission: input.submission,
      acceptedAt: input.acceptedAt,
    }), created: true })),
    markQueued: vi.fn(async (job: ExpenseAsyncJob, name: string) => ({ ...job, state: 'QUEUED' as const, taskName: name })),
    read: vi.fn(async () => null),
    claim: vi.fn(), renew: vi.fn(), markRetrying: vi.fn(), commit: vi.fn(), fail: vi.fn(), needsReview: vi.fn(),
  }
  const queue = {
    enqueue: vi.fn(async (input: { rootRequestId: string }) => ({
      taskName: taskName(input.rootRequestId), alreadyExists: false,
    })),
  }
  const value = {
    config: {
      enabled: true as const,
      projectId: 'project-2099d92f-51c8-4d2b-a8c',
      location: 'asia-southeast1' as const,
      jobBucketName: 'pmc-expense-async-jobs',
      queueName: 'pmc-expense-finalize',
      workerUrl: 'https://pmc.example/internal/mini-app/finalize-expense',
      workerAudience: 'https://pmc.example',
      taskInvokerEmail: 'task-invoker@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com',
      pilotStaffIds: new Set(pilotStaffIds),
    },
    jobs,
    queue,
    worker: { finalize: vi.fn() },
    identity: { verify: vi.fn() },
  }
  Object.assign(finance, { async: value })
  return value
}

function asyncJob(patch: Partial<ExpenseAsyncJob> = {}): ExpenseAsyncJob {
  const rootRequestId = patch.rootRequestId ?? 'async-resume-root'
  const acceptedAt = patch.acceptedAt ?? '2026-08-30T03:00:00.000Z'
  return {
    version: 1,
    objectKey: `expense-async-jobs/v1/${rootRequestId}.json`,
    generation: '1',
    fingerprint: 'a'.repeat(64),
    rootRequestId,
    staffId: 'SUBMIT_01',
    state: 'QUEUING',
    taskName: null,
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
    attemptCount: 0,
    leaseOwnerToken: null,
    leaseExpiresAt: null,
    receipt: null,
    safeErrorCode: null,
    kind: 'CREATE',
    replacementOfExpenseId: null,
    expectedVersion: null,
    acceptedAt,
    submission: {
      rootRequestId,
      staffId: 'SUBMIT_01',
      expenseDate: '2026-08-29',
      category: 'BILL_DOCUMENT',
      amountSatang: 12_000,
      counterpartyName: 'ร้านทดสอบ',
      description: '',
      paymentMethod: 'CASH',
      expectedRevision: 0,
      stagingReceipts: [stagedReceipt(rootRequestId)],
    },
    ...patch,
  }
}

function taskName(rootRequestId: string): string {
  return `projects/project-2099d92f-51c8-4d2b-a8c/locations/asia-southeast1/queues/pmc-expense-finalize/tasks/expense-${rootRequestId}`
}

function primeToken(
  deps: ReturnType<typeof dependencies>,
  body: ReturnType<typeof validSubmitBody>,
  staffId: string,
): void {
  const receipt = stagedReceipt(String(body.rootRequestId))
  vi.mocked(deps.finance.capture!.staging.get).mockResolvedValue({ ...receipt, bytes: Buffer.from('private-image') })
  body.stagingTokens = [signExpenseStagingReceipt({
    receipt, staffId, rootRequestId: String(body.rootRequestId), secret: SECRET, now: () => NOW,
  })]
}

function validSubmitBody(rootRequestId: string) {
  return {
    rootRequestId, expenseDate: '2026-08-29', category: 'BILL_DOCUMENT', amountSatang: 12_000,
    counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'CASH', expectedRevision: 0,
    stagingTokens: [] as string[],
  }
}

function stagedReceipt(rootRequestId: string): ExpenseStagingReceipt {
  return {
    objectKey: `expenses/${rootRequestId}/1-${'a'.repeat(64)}.jpg`, sizeBytes: 13,
    mimeType: 'image/jpeg', sha256: 'a'.repeat(64), ordinal: 1, originalFileName: 'receipt.jpg',
    createdAt: '2026-08-30T03:00:00.000Z',
  }
}

function submissionLease(patch: Partial<ExpenseSubmissionLease> = {}): ExpenseSubmissionLease {
  return {
    objectKey: `expense-submission-leases/${EXPENSE_ID}.json`,
    leaseId: `LEASE-${'a'.repeat(64)}`,
    ownerId: 'lease-owner-process-a',
    state: 'ACTIVE',
    generation: '4',
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 30_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    rootRequestId: 'root-request-2',
    expenseId: EXPENSE_ID,
    expectedManifestHash: 'a'.repeat(64),
    staffId: 'SUBMIT_01',
    slots: [{
      ordinal: 1,
      sha256: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      deterministicName: `001-${'a'.repeat(64)}.jpg`,
    }],
    ...patch,
  }
}

function committedReceipt(patch: Partial<ExpenseReceipt> = {}): ExpenseReceipt {
  const category = patch.category ?? 'BILL_DOCUMENT'
  return {
    expenseId: 'EXP-202608-RESULT', receiptNumber: 'EXP-202608-RESULT', expenseDate: '2026-08-29',
    monthKey: MONTH_KEY, category, scope: category === 'BOOK_DOCTOR_PERSONAL' ? 'DOCTOR_PERSONAL' : 'CLINIC',
    amountSatang: 12_000, recordState: 'COMMITTED', revision: 1,
    committedAt: '2026-08-30T03:00:00.000Z', unreviewed: true, ...patch,
  }
}

function monthlyProjection() {
  return {
    monthKey: MONTH_KEY, clinicCommittedSatang: 12_000, doctorPersonalCommittedSatang: 5_000,
    clinicByCategorySatang: { BILL_DOCUMENT: 12_000, BOOK_CLINIC: 0 }, effectiveExpenseCount: 2, unreviewed: true as const,
  }
}

function staff(id: string, permissions: Partial<Pick<MiniAppStaffRecord,
  'canSubmitExpense' | 'canViewFinance' | 'canManageExpense'>>): MiniAppStaffRecord {
  return {
    id, name: id, email: `${id}@example.test`, lineUserId: `U${id}`,
    canCloseBooking: false, canBeAe: false, canManageStock: false,
    canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
    active: true, profileImageUrl: null, ...permissions,
  }
}

function config(): PmcMiniAppServerConfig {
  return {
    enabled: true, miniAppId: 'mini-app-id', lineChannelId: '2001234567', spreadsheetId: 'sheet-1',
    intakeFolderId: 'folder-1', bookingIngressUrl: 'https://example.test/booking',
    fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', bookingIngressSecret: 'booking-secret',
    signingSecret: SECRET, enrollmentPin: null, maxImageBytes: 10_000_000, maxFilesPerKind: 10,
    bookingProtocol: { supported: 2, minimumMutation: 1, prepare: false },
    bookingMutationsPaused: false,
    asyncBooking: null,
    financeReportsEnabled: false, financeUiPreviewEnabled: false, financeReportsPilotOnly: false,
    financePilotDefaultDate: null, financeMonthlyIncomeEnabled: false,
    stockEnabled: false, stockManagerPilotOnly: false,
    finance: null,
  }
}

async function image(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
}

async function request(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body: FormData | Record<string, unknown> | null,
  bearer?: string,
): Promise<{ status: number; body: unknown; bytes: Buffer; headers: Headers }> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const isForm = body instanceof FormData
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(!isForm && body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    const parsed = response.headers.get('content-type')?.startsWith('application/json')
      ? JSON.parse(bytes.toString('utf8')) as unknown : null
    return { status: response.status, body: parsed, bytes, headers: response.headers }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function framedGet(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  framing: 'content-length' | 'slow-chunked',
): Promise<{ status: number; body: unknown }> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  let client: ReturnType<typeof httpRequest> | undefined
  try {
    return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      let responseStarted = false
      const timeout = setTimeout(() => {
        client?.destroy()
        reject(new Error('framed GET test timed out'))
      }, 5_000)
      client = httpRequest({
        hostname: '127.0.0.1',
        port: address.port,
        method: 'GET',
        path,
        headers: {
          authorization: 'Bearer finance-token',
          connection: 'close',
          ...(framing === 'content-length'
            ? { 'content-length': '1' }
            : { 'transfer-encoding': 'chunked' }),
        },
      }, (response) => {
        responseStarted = true
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearTimeout(timeout)
          const bytes = Buffer.concat(chunks)
          const body = response.headers['content-type']?.startsWith('application/json')
            ? JSON.parse(bytes.toString('utf8')) as unknown
            : null
          resolve({ status: response.statusCode ?? 0, body })
        })
      })
      client.on('error', (error) => {
        if (!responseStarted) {
          clearTimeout(timeout)
          reject(error)
        }
      })
      client.write('x')
      if (framing === 'content-length') client.end()
    })
  } finally {
    client?.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
