import { createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type {
  FinanceServerDependencies,
  LineIdentityPort,
} from '../../server/pmc-mini-app/contracts'
import {
  FinanceEvidenceTokenError,
  signFinanceEvidenceToken,
  verifyFinanceEvidenceToken,
} from '../../server/pmc-mini-app/finance/evidenceToken'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { FinanceReadStoreError } from '../../server/pmc-mini-app/finance/readStore'
import {
  createGoogleMiniAppStore,
  type MiniAppStaffRecord,
  type MiniAppStore,
} from '../../server/pmc-mini-app/store'

const SECRET = 'finance-browser-signing-secret-32-bytes-minimum'
const NOW = Date.parse('2026-08-30T03:00:00.000Z')
const MONTH_KEY = '2026-08'
const EXPENSE_ID = 'EXP-202608-PRIVATE'
const ATTACHMENT_ID = 'ATT-PRIVATE'

describe('finance evidence token security', () => {
  it('signs an exact five-minute canonical token bound to staff, month, expense, and attachment', () => {
    const token = signFinanceEvidenceToken({
      staffId: 'FINANCE_01', monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, secret: SECRET, now: () => NOW,
    })

    expect(verifyFinanceEvidenceToken(token, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW + 299_999,
    })).toEqual({
      version: 1, staffId: 'FINANCE_01', monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, issuedAt: NOW, expiresAt: NOW + 300_000,
    })
    expect(() => verifyFinanceEvidenceToken(token, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW + 300_000,
    })).toThrow(FinanceEvidenceTokenError)
    expect(() => verifyFinanceEvidenceToken(token, {
      staffId: 'FINANCE_02', secret: SECRET, now: () => NOW + 1,
    })).toThrow(FinanceEvidenceTokenError)
  })

  it('rejects tampered, noncanonical, extra-key, oversized, and future-issued tokens', () => {
    const valid = signFinanceEvidenceToken({
      staffId: 'FINANCE_01', monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, secret: SECRET, now: () => NOW,
    })
    const [payload, signature] = valid.split('.')
    expect(() => verifyFinanceEvidenceToken(`${payload}.${signature}x`, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW,
    })).toThrow(FinanceEvidenceTokenError)

    const noncanonicalJson = JSON.stringify({
      staffId: 'FINANCE_01', version: 1, monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, issuedAt: NOW, expiresAt: NOW + 300_000,
    })
    const noncanonicalPayload = Buffer.from(noncanonicalJson).toString('base64url')
    const noncanonicalSignature = createHmac('sha256', SECRET).update(noncanonicalPayload).digest('base64url')
    expect(() => verifyFinanceEvidenceToken(`${noncanonicalPayload}.${noncanonicalSignature}`, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW,
    })).toThrow(FinanceEvidenceTokenError)

    const extraJson = JSON.stringify({
      version: 1, staffId: 'FINANCE_01', monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, issuedAt: NOW, expiresAt: NOW + 300_000, privateFileId: 'leak',
    })
    const extraPayload = Buffer.from(extraJson).toString('base64url')
    const extraSignature = createHmac('sha256', SECRET).update(extraPayload).digest('base64url')
    expect(() => verifyFinanceEvidenceToken(`${extraPayload}.${extraSignature}`, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW,
    })).toThrow(FinanceEvidenceTokenError)
    expect(() => verifyFinanceEvidenceToken('a'.repeat(2_049), {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW,
    })).toThrow(FinanceEvidenceTokenError)

    const future = signFinanceEvidenceToken({
      staffId: 'FINANCE_01', monthKey: MONTH_KEY, expenseId: EXPENSE_ID,
      attachmentId: ATTACHMENT_ID, secret: SECRET, now: () => NOW + 1,
    })
    expect(() => verifyFinanceEvidenceToken(future, {
      staffId: 'FINANCE_01', secret: SECRET, now: () => NOW,
    })).toThrow(FinanceEvidenceTokenError)
  })
})

describe('finance API permission and evidence boundary', () => {
  it('consumes the canonical 12-column staff parser and keeps non-boolean finance grants fail-closed', async () => {
    const batchGet = vi.fn(async (_spreadsheetId: string, ranges: string[]) => ({
      [ranges[0]!]: [
        ['staff-true', 'True', '', 'Utrue', false, false, true, '', false, true, true, true],
        ['staff-text', 'Text', '', 'Utext', false, false, true, '', false, 'true', 'true', 'true'],
        ['staff-one', 'One', '', 'Uone', false, false, true, '', false, 1, 1, 1],
        ['staff-missing', 'Missing', '', 'Umissing', false, false, true, '', false],
      ],
    }))
    const sheets = {
      batchGet, append: vi.fn(), update: vi.fn(), batchUpdate: vi.fn(),
      getWorkbook: vi.fn(), applyWorkbookRequests: vi.fn(),
    } as unknown as MiniAppSheetsPort
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveStaffByLineUserId('Utrue')).resolves.toMatchObject({
      canSubmitExpense: true, canViewFinance: true, canManageExpense: true,
    })
    for (const lineUserId of ['Utext', 'Uone', 'Umissing']) {
      await expect(store.getActiveStaffByLineUserId(lineUserId)).resolves.toMatchObject({
        canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
      })
    }
    expect(batchGet.mock.calls.every(([, ranges]) => ranges[0] === "'CONFIG_STAFF'!A2:L")).toBe(true)
  })

  it('authenticates LINE first and checks route permission before missing capabilities', async () => {
    const deps = dependencies({ finance: undefined })
    const middleware = createPmcMiniAppMiddleware(deps)

    const invalid = await request(middleware, 'POST', '/api/mini-app/expenses', {}, 'invalid-token')
    const unknown = await request(middleware, 'POST', '/api/mini-app/expenses', {}, 'unknown-token')
    const noSubmit = await request(middleware, 'POST', '/api/mini-app/expenses', {}, 'active-token')
    const submitNoCapture = await request(middleware, 'POST', '/api/mini-app/expenses', {}, 'submit-token')
    const submitHistory = await request(middleware, 'GET', `/api/mini-app/finance/expenses?month=${MONTH_KEY}`, null, 'submit-token')
    const viewerNoReads = await request(middleware, 'GET', `/api/mini-app/finance/expenses?month=${MONTH_KEY}`, null, 'finance-token')

    expect(invalid).toMatchObject({ status: 401, body: { error: 'MINI_APP_UNAUTHORIZED' } })
    expect(unknown).toMatchObject({ status: 403, body: { error: 'STAFF_NOT_ALLOWED' } })
    expect(noSubmit).toMatchObject({ status: 403, body: { error: 'EXPENSE_SUBMIT_PERMISSION_REQUIRED' } })
    expect(submitNoCapture).toMatchObject({ status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' } })
    expect(submitHistory).toMatchObject({ status: 403, body: { error: 'EXPENSE_FINANCE_PERMISSION_REQUIRED' } })
    expect(viewerNoReads).toMatchObject({ status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' } })
  })

  it('never mounts submitter history, detail, or search routes', async () => {
    const middleware = createPmcMiniAppMiddleware(dependencies())
    for (const path of [
      '/api/mini-app/expenses/history',
      `/api/mini-app/expenses/${EXPENSE_ID}`,
      '/api/mini-app/expenses/search?q=private',
    ]) {
      expect(await request(middleware, 'GET', path, null, 'submit-token')).toMatchObject({
        status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' },
      })
    }
  })

  it('requires bearer finance permission plus a matching staff token and re-proves membership for download', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const issued = await request(
      middleware, 'POST', `/api/mini-app/finance/expenses/${EXPENSE_ID}/evidence/${ATTACHMENT_ID}/token`,
      null, 'finance-token',
    )
    expect(issued.status).toBe(200)
    expect(issued.body).toEqual({ token: expect.any(String) })
    expect(deps.finance?.reads?.readStore.getEvidence).toHaveBeenCalledOnce()
    const token = String((issued.body as Record<string, unknown>).token)

    const noBearer = await request(middleware, 'GET', `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`)
    const submitOnly = await request(middleware, 'GET', `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`, null, 'submit-token')
    const otherFinance = await request(middleware, 'GET', `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`, null, 'other-finance-token')
    const downloaded = await request(middleware, 'GET', `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`, null, 'finance-token')

    expect(noBearer.status).toBe(401)
    expect(submitOnly).toMatchObject({ status: 403, body: { error: 'EXPENSE_FINANCE_PERMISSION_REQUIRED' } })
    expect(otherFinance.status).toBe(403)
    expect(downloaded.status).toBe(200)
    expect(downloaded.bytes).toEqual(Buffer.from('private-image'))
    expect(downloaded.headers.get('cache-control')).toBe('private, no-store')
    expect(downloaded.headers.get('content-type')).toBe('image/jpeg')
    expect(deps.finance?.reads?.readStore.getEvidence).toHaveBeenCalledTimes(2)

    vi.mocked(deps.finance!.reads!.readStore.getEvidence).mockResolvedValueOnce(null)
    const disappeared = await request(middleware, 'GET', `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`, null, 'finance-token')
    expect(disappeared).toMatchObject({ status: 404, body: { error: 'EXPENSE_EVIDENCE_NOT_FOUND' } })
  })

  it('fails token issue and download safely when the committed evidence descriptor no longer matches Drive', async () => {
    const issueFailure = dependencies()
    vi.mocked(issueFailure.finance!.reads!.readStore.getEvidence).mockRejectedValueOnce(
      new FinanceReadStoreError('EXPENSE_PRIVATE_FILE_INVALID'),
    )
    const failedIssue = await request(
      createPmcMiniAppMiddleware(issueFailure),
      'POST',
      `/api/mini-app/finance/expenses/${EXPENSE_ID}/evidence/${ATTACHMENT_ID}/token`,
      null,
      'finance-token',
    )
    expect(failedIssue).toMatchObject({
      status: 503,
      body: { error: 'EXPENSE_PRIVATE_FILE_INVALID' },
    })

    const downloadFailure = dependencies()
    const middleware = createPmcMiniAppMiddleware(downloadFailure)
    const issued = await request(
      middleware,
      'POST',
      `/api/mini-app/finance/expenses/${EXPENSE_ID}/evidence/${ATTACHMENT_ID}/token`,
      null,
      'finance-token',
    )
    vi.mocked(downloadFailure.finance!.reads!.readStore.getEvidence).mockRejectedValueOnce(
      new FinanceReadStoreError('EXPENSE_PRIVATE_FILE_INVALID'),
    )
    const token = String((issued.body as Record<string, unknown>).token)
    const failedDownload = await request(
      middleware,
      'GET',
      `/api/mini-app/finance/evidence?token=${encodeURIComponent(token)}`,
      null,
      'finance-token',
    )
    expect(failedDownload).toMatchObject({
      status: 503,
      body: { error: 'EXPENSE_PRIVATE_FILE_INVALID' },
    })
    expect(JSON.stringify([failedIssue.body, failedDownload.body])).not.toContain('private-file')
  })

  it('returns safe capability and permission booleans without finance identity or resource values', async () => {
    const captureOnly = dependencies({
      finance: { ...financeDependencies(), reads: undefined },
    })
    const readsOnly = dependencies({
      finance: { ...financeDependencies(), capture: undefined },
    })

    const captureConfig = await request(createPmcMiniAppMiddleware(captureOnly), 'GET', '/api/mini-app/config', null, 'finance-token')
    const readsConfig = await request(createPmcMiniAppMiddleware(readsOnly), 'GET', '/api/mini-app/config', null, 'finance-token')
    expect(captureConfig.body).toEqual(expect.objectContaining({
      expenseCaptureEnabled: true, financeReadsEnabled: false,
      canSubmitExpense: true, canViewFinance: true, canManageExpense: true,
    }))
    expect(readsConfig.body).toEqual(expect.objectContaining({
      expenseCaptureEnabled: false, financeReadsEnabled: true,
    }))
    const serialized = JSON.stringify([captureConfig.body, readsConfig.body])
    for (const privateValue of [SECRET, 'Ufinance-private', 'finance-master', 'finance-root', 'private-file']) {
      expect(serialized).not.toContain(privateValue)
    }
  })
})

function dependencies(options: { finance?: FinanceServerDependencies } = {}): {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
  finance?: FinanceServerDependencies
} {
  const staffByLine = new Map<string, MiniAppStaffRecord>([
    ['Uactive-private', staff('ACTIVE_01')],
    ['Usubmit-private', staff('SUBMIT_01', { canSubmitExpense: true })],
    ['Ufinance-private', staff('FINANCE_01', { canSubmitExpense: true, canViewFinance: true, canManageExpense: true })],
    ['Uother-finance-private', staff('FINANCE_02', { canSubmitExpense: true, canViewFinance: true, canManageExpense: true })],
  ])
  const result = {
    config: config(),
    identity: {
      async verify(idToken: string) {
        const lineUserId = new Map([
          ['active-token', 'Uactive-private'], ['submit-token', 'Usubmit-private'],
          ['finance-token', 'Ufinance-private'], ['other-finance-token', 'Uother-finance-private'],
          ['unknown-token', 'Uunknown-private'],
        ]).get(idToken)
        if (!lineUserId) throw new Error('invalid')
        return { lineUserId }
      },
    },
    store: {
      getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => staffByLine.get(lineUserId) ?? null),
      getActiveBookingConfig: vi.fn(async () => ({ doctors: [], services: [], channels: [], aes: [] })),
    } as unknown as MiniAppStore,
    finance: Object.prototype.hasOwnProperty.call(options, 'finance') ? options.finance : financeDependencies(),
  }
  return result
}

function financeDependencies(): FinanceServerDependencies {
  return {
    signingSecret: SECRET,
    now: () => NOW,
    reads: {
      readStore: {
        loadMonthlyExpenses: vi.fn(async () => ({
          monthKey: MONTH_KEY, clinicCommittedSatang: 0, doctorPersonalCommittedSatang: 0,
          clinicByCategorySatang: { BILL_DOCUMENT: 0, BOOK_CLINIC: 0 }, effectiveExpenseCount: 0, unreviewed: true,
        })),
        listExpenseHistory: vi.fn(async () => ({ expenses: [], nextCursor: null })),
        getEvidence: vi.fn(async () => ({ bytes: Buffer.from('private-image'), mimeType: 'image/jpeg' as const })),
        getExpenseMutationContext: vi.fn(async () => null),
      },
    },
    capture: {
      staging: {
        put: vi.fn(), get: vi.fn(), deleteVerified: vi.fn(), claimDriveSlot: vi.fn(),
        acquireSubmissionLease: vi.fn(), renewSubmissionLease: vi.fn(), assertSubmissionLease: vi.fn(),
        commitSubmissionLease: vi.fn(),
      },
      submission: { submit: vi.fn() },
      ingress: { prepare: vi.fn(), commit: vi.fn(), void: vi.fn() },
    },
  }
}

function staff(id: string, permissions: Partial<Pick<MiniAppStaffRecord,
  'canSubmitExpense' | 'canViewFinance' | 'canManageExpense'>> = {}): MiniAppStaffRecord {
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
    asyncBooking: null, financeReportsEnabled: false, stockEnabled: false, stockManagerPilotOnly: false,
    finance: null,
  }
}

async function request(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body: Record<string, unknown> | null = null,
  bearer?: string,
): Promise<{ status: number; body: unknown; bytes: Buffer; headers: Headers }> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    let parsed: unknown = null
    if (response.headers.get('content-type')?.startsWith('application/json')) parsed = JSON.parse(bytes.toString('utf8'))
    return { status: response.status, body: parsed, bytes, headers: response.headers }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
