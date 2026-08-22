import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { OcrDraft } from '../../src/apps/ocr-ledger/contracts'
import type { OcrLedgerConfig } from '../../server/ocr-ledger/config'
import type { OcrDrivePort } from '../../server/ocr-ledger/googleClient'
import type { OcrLedgerStore } from '../../server/ocr-ledger/googleStore'
import type { OcrLinePort } from '../../server/ocr-ledger/lineClient'
import { createOcrLedgerMiddleware } from '../../server/ocr-ledger/middleware'
import { signReviewToken } from '../../server/ocr-ledger/security'

const NOW = new Date('2026-08-22T03:00:00.000Z')

describe('OCR ledger LIFF review API', () => {
  it('returns only the public LIFF client configuration', async () => {
    const deps = dependencies()
    const response = await request(deps, { method: 'GET', url: '/api/ocr-ledger/client-config' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ liffId: 'liff-id' })
    expect(deps.store.getDraft).not.toHaveBeenCalled()
    expect(deps.line.verifyLiffIdToken).not.toHaveBeenCalled()
  })

  it.each([
    ['missing review token', '/api/ocr-ledger/review', undefined],
    ['altered review token', `/api/ocr-ledger/review?t=${encodeURIComponent(`${reviewToken()}x`)}`, 'Bearer raw-line-id-token'],
    ['expired review token', `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken({ exp: Math.floor(NOW.getTime() / 1000) - 1 }))}`, 'Bearer raw-line-id-token'],
    ['missing bearer ID token', `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}`, undefined],
  ])('rejects %s before reading draft data', async (_name, url, authorization) => {
    const deps = dependencies()
    const response = await request(deps, { method: 'GET', url, headers: authorization ? { authorization } : {} })

    expect(response.statusCode).toBe(401)
    expect(deps.line.verifyLiffIdToken).not.toHaveBeenCalled()
    expect(deps.store.getDraft).not.toHaveBeenCalled()
    expect(deps.drive.downloadImage).not.toHaveBeenCalled()
  })

  it.each([
    ['no query token', '/api/ocr-ledger/review', JSON.stringify({ patch: editablePatch() })],
    ['body token', '/api/ocr-ledger/review', JSON.stringify({ token: reviewToken(), patch: editablePatch() })],
    ['query and body token', `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}`, JSON.stringify({ token: reviewToken(), patch: editablePatch() })],
    ['empty query token', '/api/ocr-ledger/review?t=', JSON.stringify({ patch: editablePatch() })],
    ['repeated query token', `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}&t=${encodeURIComponent(reviewToken())}`, JSON.stringify({ patch: editablePatch() })],
  ])('requires exactly one non-empty query token and a patch-only POST body: %s', async (_name, url, body) => {
    const deps = dependencies()
    const response = await request(deps, {
      method: 'POST', url, headers: { authorization: 'Bearer raw-line-id-token' }, body,
    })

    expect(response.statusCode).toBe(400)
    expect(deps.line.verifyLiffIdToken).not.toHaveBeenCalled()
    expect(deps.store.getDraft).not.toHaveBeenCalled()
    expect(deps.store.appendJob).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong LIFF audience or expired ID token', new Error('LINE_LIFF_ID_TOKEN_INVALID')],
    ['user no longer belongs to token group', undefined],
  ])('rejects %s before reading financial data', async (_name, verify) => {
    const deps = dependencies()
    if (verify) deps.line.verifyLiffIdToken.mockRejectedValue(verify)
    else deps.line.assertGroupMember.mockRejectedValue(new Error('LINE_GROUP_MEMBERSHIP_REQUIRED'))

    const response = await request(deps, {
      method: 'GET', url: `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}`,
      headers: { authorization: 'Bearer raw-line-id-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(deps.store.getDraft).not.toHaveBeenCalled()
  })

  it('rejects a token whose group is not the configured allowed group before reading the draft', async () => {
    const deps = dependencies()
    const response = await request(deps, {
      method: 'GET', url: `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken({ groupId: 'Cother' }))}`,
      headers: { authorization: 'Bearer raw-line-id-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(deps.store.getDraft).not.toHaveBeenCalled()
    expect(deps.line.verifyLiffIdToken).not.toHaveBeenCalled()
  })

  it('rejects a stale review token version without enqueueing an edit', async () => {
    const deps = dependencies({ draft: draft({ draftVersion: 3 }) })
    const response = await request(deps, {
      method: 'POST', url: `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken({ draftVersion: 2 }))}`,
      headers: { authorization: 'Bearer raw-line-id-token' }, body: JSON.stringify({ patch: editablePatch() }),
    })

    expect(response.statusCode).toBe(409)
    expect(deps.store.appendJob).not.toHaveBeenCalled()
  })

  it('returns the authenticated review projection without source, audit, or Drive metadata', async () => {
    const deps = dependencies()
    const token = reviewToken()
    const response = await request(deps, {
      method: 'GET', url: `/api/ocr-ledger/review?t=${encodeURIComponent(token)}`,
      headers: { authorization: 'Bearer raw-line-id-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      documentId: 'OCR-20260822-abc123', state: 'PENDING_REVIEW', draftVersion: 2,
      imageUrl: `/api/ocr-ledger/image?t=${encodeURIComponent(token)}`,
      documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22', documentTime: null,
      counterpartyName: 'Merchant', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
      serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: 'office supplies',
      senderName: 'Sender', senderBank: 'Bank', senderAccountMasked: '123-****-**0',
      receiverName: 'Receiver', receiverBank: 'Bank', receiverAccountMasked: '987-****-**0',
      transferDate: null, transferTime: null, amount: null, merchantName: 'Merchant', merchantTaxId: '0105555000001',
      branch: 'สำนักงานใหญ่', receiptNumber: 'RCPT-1', receiptDate: '2026-08-22', paymentMethod: 'CASH',
      lineItems: [{ lineNumber: 1, description: 'Paper', quantity: 1, unit: 'pack', unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: 'office' }],
      warnings: [{ code: 'LOW_CONFIDENCE_REQUIRED_FIELD', field: 'grandTotal', message: 'verify total' }],
    })
    expect(JSON.stringify(response.body)).not.toContain('drive-file-private')
    expect(JSON.stringify(response.body)).not.toContain('sourceLineMessageId')
    expect(JSON.stringify(response.body)).not.toContain('confidenceByField')
    expect(JSON.stringify(response.body)).not.toContain('confirmedBy')
    expect(deps.line.verifyLiffIdToken).toHaveBeenCalledOnce()
    expect(deps.line.assertGroupMember).toHaveBeenCalledOnce()
    expect(deps.line.assertGroupMember).toHaveBeenCalledWith('Cgroup1', 'Ueditor')
  })

  it('downloads authenticated image bytes from the server-side draft without Drive identifiers in the URL', async () => {
    const deps = dependencies()
    const token = reviewToken()
    const response = await request(deps, {
      method: 'GET', url: `/api/ocr-ledger/image?t=${encodeURIComponent(token)}`,
      headers: { authorization: 'Bearer raw-line-id-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers).toMatchObject({
      'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    })
    expect(response.rawBody).toEqual(Buffer.from('private-png'))
    expect(deps.drive.downloadImage).toHaveBeenCalledWith('drive-file-private')
    expect(response.url).not.toContain('drive-file-private')
  })

  it('appends exactly one idempotent EDIT job and returns its persisted ID', async () => {
    const deps = dependencies({ persistedJobId: 'job-existing' })
    const token = reviewToken()
    const response = await request(deps, {
      method: 'POST', url: `/api/ocr-ledger/review?t=${encodeURIComponent(token)}`,
      headers: { authorization: 'Bearer raw-line-id-token' }, body: JSON.stringify({ patch: editablePatch({ note: 'changed' }) }),
    })

    expect(response.statusCode).toBe(202)
    expect(response.body).toEqual({ accepted: true, jobId: 'job-existing' })
    expect(deps.store.appendJob).toHaveBeenCalledTimes(1)
    expect(deps.store.appendJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'EDIT', documentId: 'OCR-20260822-abc123', state: 'QUEUED',
    }))
    expect(deps.store.saveDraft).not.toHaveBeenCalled()
    const payload = JSON.parse(deps.store.appendJob.mock.calls[0]?.[0].payloadJson ?? '{}')
    expect(payload).toEqual(expect.objectContaining({ expectedVersion: 2, actorLineUserId: 'Ueditor', groupId: 'Cgroup1' }))
    expect(payload.patch.lineItems[0].confidence).toBe(0.82)
    expect(payload.patch).toMatchObject({ merchantName: 'Merchant', merchantTaxId: '0105555000001', paymentMethod: 'CASH' })
  })

  it('accepts transfer-specific edits while masking an entered full account number server-side', async () => {
    const deps = dependencies()
    const response = await request(deps, {
      method: 'POST', url: `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}`,
      headers: { authorization: 'Bearer raw-line-id-token' }, body: JSON.stringify({ patch: editablePatch({
        documentType: 'TRANSFER_SLIP', senderName: 'ผู้โอน', senderBank: 'BANK A', senderAccountMasked: '1234567890',
        receiverName: 'ผู้รับ', receiverBank: 'BANK B', receiverAccountMasked: '987-*-***0',
        transferDate: '2026-08-22', transferTime: '10:15', amount: 100, lineItems: [],
      }) }),
    })

    expect(response.statusCode).toBe(202)
    const payload = JSON.parse(deps.store.appendJob.mock.calls[0]?.[0].payloadJson ?? '{}')
    expect(payload.patch.senderAccountMasked).toContain('****')
    expect(payload.patch.senderAccountMasked).not.toContain('1234567890')
    expect(payload.patch.receiverAccountMasked).toBe('987-*-***0')
  })

  it.each([
    ['confirmedBy', { confirmedBy: 'forged' }],
    ['state', { state: 'CONFIRMED' }],
    ['Drive ID', { sourceImageFileId: 'attacker-drive-file' }],
    ['source hash', { sourceImageSha256: 'forged-hash' }],
    ['source LINE IDs', { sourceLineMessageId: 'message', sourceLineUserId: 'Uattacker' }],
    ['confidence', { lineItems: [{ ...editableLine(), confidence: 1 }] }],
    ['warnings', { warnings: [] }],
    ['audit fields', { confirmedAt: '2026-08-22T00:00:00.000Z', verificationStatus: 'STAFF_CONFIRMED' }],
  ])('does not let the client submit %s', async (_name, controlledFields) => {
    const deps = dependencies()
    const response = await request(deps, {
      method: 'POST', url: `/api/ocr-ledger/review?t=${encodeURIComponent(reviewToken())}`,
      headers: { authorization: 'Bearer raw-line-id-token' }, body: JSON.stringify({ patch: editablePatch(controlledFields) }),
    })

    expect(response.statusCode).toBe(400)
    expect(deps.store.appendJob).not.toHaveBeenCalled()
  })
})

function dependencies(input: { draft?: OcrDraft; persistedJobId?: string } = {}) {
  const store = {
    appendJob: vi.fn(async (job) => input.persistedJobId ? { ...job, jobId: input.persistedJobId } : job),
    getDraft: vi.fn(async () => input.draft ?? draft()),
    saveDraft: vi.fn(),
  } as unknown as OcrLedgerStore & { appendJob: ReturnType<typeof vi.fn>; getDraft: ReturnType<typeof vi.fn>; saveDraft: ReturnType<typeof vi.fn> }
  const line = {
    downloadImage: vi.fn(), reply: vi.fn(), push: vi.fn(),
    verifyLiffIdToken: vi.fn(async () => ({ userId: 'Ueditor' })),
    assertGroupMember: vi.fn(async () => ({ displayName: 'Editor' })), validatePush: vi.fn(),
  } as OcrLinePort & { verifyLiffIdToken: ReturnType<typeof vi.fn>; assertGroupMember: ReturnType<typeof vi.fn> }
  const drive = {
    createFolder: vi.fn(), findFolder: vi.fn(), moveFile: vi.fn(), moveSpreadsheet: vi.fn(),
    findImageByDocumentId: vi.fn(), uploadImage: vi.fn(),
    downloadImage: vi.fn(async () => ({ bytes: Buffer.from('private-png'), mimeType: 'image/png' as const })),
  } as OcrDrivePort & { downloadImage: ReturnType<typeof vi.fn> }
  return { store, line, drive }
}

async function request(
  deps: ReturnType<typeof dependencies>,
  input: { method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string },
) {
  const req = new PassThrough() as PassThrough & IncomingMessage
  req.method = input.method
  req.url = input.url
  req.headers = input.headers ?? {}
  req.end(input.body ?? '')
  const headers: Record<string, string> = {}
  let responseBody: string | Buffer = ''
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(body?: string | Buffer) { responseBody = body ?? '' },
  } as unknown as ServerResponse
  await createOcrLedgerMiddleware({ config: CONFIG, store: deps.store, line: deps.line, drive: deps.drive, now: () => NOW })(req, response)
  const rawBody = Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody)
  return {
    statusCode: response.statusCode, headers, rawBody,
    body: rawBody.byteLength > 0 && headers['content-type']?.includes('application/json') ? JSON.parse(rawBody.toString('utf8')) : null,
    url: input.url,
  }
}

function reviewToken(overrides: Partial<{ groupId: string; draftVersion: number; exp: number }> = {}): string {
  return signReviewToken({
    v: 1, documentId: 'OCR-20260822-abc123', groupId: 'Cgroup1', draftVersion: 2,
    action: 'REVIEW', exp: Math.floor(NOW.getTime() / 1000) + 3600, ...overrides,
  }, CONFIG.reviewSigningSecret)
}

function editablePatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22', documentTime: null,
    counterpartyName: 'Merchant', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
    serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: 'office supplies',
    senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
    receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null,
    merchantName: 'Merchant', merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่', receiptNumber: 'RCPT-1',
    receiptDate: '2026-08-22', paymentMethod: 'CASH',
    lineItems: [editableLine()], ...overrides,
  }
}

function editableLine(): Record<string, unknown> {
  return {
    lineNumber: 1, description: 'Paper', quantity: 1, unit: 'pack', unitPrice: 100,
    discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: 'office',
  }
}

function draft(overrides: Partial<OcrDraft> = {}): OcrDraft {
  return {
    documentId: 'OCR-20260822-abc123', documentType: 'RECEIPT', direction: 'EXPENSE', state: 'PENDING_REVIEW',
    documentDate: '2026-08-22', documentTime: null, counterpartyName: 'Merchant', currency: 'THB', subtotal: 100,
    discountAmount: 0, taxAmount: 0, serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: 'office supplies',
    sourceImageFileId: 'drive-file-private', sourceImageSha256: 'source-sha', sourceLineMessageId: 'line-message', sourceLineUserId: 'Usource',
    confidenceByField: { grandTotal: 0.82 }, senderName: 'Sender', senderBank: 'Bank', senderAccountMasked: '123-4-56789-0',
    receiverName: 'Receiver', receiverBank: 'Bank', receiverAccountMasked: '987-6-54321-0', transferDate: null, transferTime: null,
    amount: null, merchantName: 'Merchant', merchantTaxId: '0105555000001', branch: 'สำนักงานใหญ่', receiptNumber: 'RCPT-1', receiptDate: '2026-08-22', paymentMethod: 'CASH',
    draftVersion: 2, confirmedBy: null, confirmedAt: null, verificationStatus: null,
    warnings: [{ code: 'LOW_CONFIDENCE_REQUIRED_FIELD', field: 'grandTotal', message: 'verify total' }],
    lineItems: [{ ...editableLine(), documentId: 'OCR-20260822-abc123', confidence: 0.82 } as OcrDraft['lineItems'][number]],
    ...overrides,
  }
}

const CONFIG: OcrLedgerConfig = {
  lineChannelSecret: 'line-secret', lineChannelAccessToken: 'line-token', allowedGroupId: 'Cgroup1',
  masterSpreadsheetId: 'master', driveRootId: 'drive-root', monthlyLedgersFolderId: 'monthly-folder', liffId: 'liff-id', liffChannelId: 'liff-channel',
  reviewSigningSecret: 'review-secret', openAiApiKey: 'openai-key', openAiOcrModel: 'gpt-5-mini',
  googleClientId: 'google-client', googleClientSecret: 'google-secret', googleRefreshToken: 'google-refresh',
  dailyReportEnabled: false, dailyReportTime: '20:00', timezone: 'Asia/Bangkok', workerBatchSize: 10,
  maxImageBytes: 2_000_000, openAiMaxOutputTokens: 2000,
}
