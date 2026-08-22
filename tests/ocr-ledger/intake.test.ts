import { createHmac } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { OcrLedgerConfig } from '../../server/ocr-ledger/config'
import type { OcrLedgerStore } from '../../server/ocr-ledger/googleStore'
import type { OcrLinePort } from '../../server/ocr-ledger/lineClient'
import { signReviewToken } from '../../server/ocr-ledger/security'
import { createOcrLedgerMiddleware } from '../../server/ocr-ledger/middleware'

const NOW = new Date('2026-08-22T03:00:00.000Z')

describe('createOcrLedgerMiddleware', () => {
  it('rejects an invalid signature before any Sheet or LINE operation', async () => {
    const { store, line } = dependencies()
    const response = await request({ store, line, signature: 'invalid', body: webhook([imageEvent()]) })

    expect(response.statusCode).toBe(401)
    expect(store.appendJob).not.toHaveBeenCalled()
    expect(line.reply).not.toHaveBeenCalled()
    expect(line.downloadImage).not.toHaveBeenCalled()
  })

  it('ignores events outside the configured group with a successful response and no job', async () => {
    const { store, line } = dependencies()
    const body = webhook([imageEvent({ groupId: 'Cother' })])
    const response = await request({ store, line, body })

    expect(response.statusCode).toBe(200)
    expect(store.appendJob).not.toHaveBeenCalled()
    expect(line.reply).not.toHaveBeenCalled()
  })

  it('durably appends image intake before acknowledging and never downloads or extracts in the webhook', async () => {
    const order: string[] = []
    const { store, line } = dependencies(order)
    const response = await request({ store, line, body: webhook([imageEvent()]), order })

    expect(response.statusCode).toBe(200)
    expect(order).toEqual(['append-job', 'reply-ack', 'respond-200'])
    expect(store.appendJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'INTAKE', idempotencyKey: 'line:image:m-image-1', state: 'QUEUED', attempts: 0,
    }))
    expect(line.downloadImage).not.toHaveBeenCalled()
  })

  it('uses stable event/message idempotency keys so duplicate deliveries append only once', async () => {
    const { store, line } = dependencies()
    const seen = new Set<string>()
    store.appendJob.mockImplementation(async (job) => {
      if (!seen.has(job.idempotencyKey)) seen.add(job.idempotencyKey)
      return job
    })
    const body = webhook([imageEvent(), imageEvent({ eventId: 'evt-duplicate' })])

    await request({ store, line, body })

    expect(seen).toEqual(new Set(['line:image:m-image-1']))
  })

  it('verifies the signed postback action and binds it to the configured group before enqueueing', async () => {
    const { store, line } = dependencies()
    const token = signReviewToken({
      v: 1, documentId: 'OCR-20260822-abc123', groupId: 'Cgroup1', draftVersion: 2,
      action: 'CONFIRM', exp: Math.floor(NOW.getTime() / 1000) + 3600,
    }, CONFIG.reviewSigningSecret)
    const body = webhook([postbackEvent(token)])

    await request({ store, line, body })

    expect(store.appendJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'CONFIRM', documentId: 'OCR-20260822-abc123',
      idempotencyKey: 'line:postback:evt-postback',
    }))
    const payload = JSON.parse(store.appendJob.mock.calls[0][0].payloadJson)
    expect(payload).toEqual(expect.objectContaining({ expectedVersion: 2, actorLineUserId: 'Ustaff1', groupId: 'Cgroup1' }))
  })

  it('rejects a forged postback without enqueueing it', async () => {
    const { store, line } = dependencies()
    const response = await request({ store, line, body: webhook([postbackEvent('forged')]) })

    expect(response.statusCode).toBe(200)
    expect(store.appendJob).not.toHaveBeenCalled()
  })

  it('enqueues only the supported report command from signed LINE text', async () => {
    const { store, line } = dependencies()
    const event = {
      type: 'message', webhookEventId: 'evt-report', replyToken: 'reply-report',
      source: { type: 'group', groupId: 'Cgroup1', userId: 'Ustaff1' },
      message: { id: 'm-report', type: 'text', text: 'สรุปวันนี้' },
    }

    await request({ store, line, body: webhook([event]) })

    expect(store.appendJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'REPORT_COMMAND', idempotencyKey: 'line:report:evt-report', payloadJson: expect.stringContaining('TODAY'),
    }))
  })

  it('authenticates a LIFF review save and appends EDIT without mutating the draft directly', async () => {
    const { store, line } = dependencies()
    line.verifyLiffIdToken.mockResolvedValue({ userId: 'Ueditor', displayName: 'Editor' })
    const token = signReviewToken({
      v: 1, documentId: 'OCR-20260822-abc123', groupId: 'Cgroup1', draftVersion: 2,
      action: 'REVIEW', exp: Math.floor(NOW.getTime() / 1000) + 3600,
    }, CONFIG.reviewSigningSecret)

    const response = await request({
      store, line, url: '/api/ocr-ledger/review', headers: { authorization: 'Bearer verified-id-token' },
      body: JSON.stringify({ token, patch: validEditPatch({ note: 'edited' }) }),
    })

    expect(response.statusCode).toBe(202)
    expect(line.verifyLiffIdToken).toHaveBeenCalledWith('verified-id-token')
    expect(store.appendJob).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'EDIT', documentId: 'OCR-20260822-abc123' }))
  })

  it.each([
    ['missing required direction', validEditPatch({ direction: undefined })],
    ['numeric string', validEditPatch({ grandTotal: '120.00' })],
    ['unknown document type', validEditPatch({ documentType: 'INVOICE' })],
    ['non-sequential line items', validEditPatch({ lineItems: [lineItem(2)] })],
  ])('rejects invalid LIFF edit payload: %s', async (_name, patch) => {
    const { store, line } = dependencies()
    line.verifyLiffIdToken.mockResolvedValue({ userId: 'Ueditor', displayName: 'Editor' })
    const token = reviewToken()

    const response = await request({
      store, line, url: '/api/ocr-ledger/review', headers: { authorization: 'Bearer verified-id-token' },
      body: JSON.stringify({ token, patch }),
    })

    expect(response.statusCode).toBe(400)
    expect(store.appendJob).not.toHaveBeenCalled()
  })

  it('returns the persisted idempotent job id rather than a discarded generated id', async () => {
    const { store, line } = dependencies()
    line.verifyLiffIdToken.mockResolvedValue({ userId: 'Ueditor', displayName: 'Editor' })
    store.appendJob.mockImplementation(async (queued) => ({ ...queued, jobId: 'job-existing' }))

    const response = await request({
      store, line, url: '/api/ocr-ledger/review', headers: { authorization: 'Bearer verified-id-token' },
      body: JSON.stringify({ token: reviewToken(), patch: validEditPatch() }),
    })

    expect(response.statusCode).toBe(202)
    expect(response.body).toEqual({ accepted: true, jobId: 'job-existing' })
  })

  it('returns retryable 503 when authenticated LIFF enqueue storage fails', async () => {
    const { store, line } = dependencies()
    line.verifyLiffIdToken.mockResolvedValue({ userId: 'Ueditor', displayName: 'Editor' })
    store.appendJob.mockRejectedValue(new Error('sheet unavailable'))

    const response = await request({
      store, line, url: '/api/ocr-ledger/review', headers: { authorization: 'Bearer verified-id-token' },
      body: JSON.stringify({ token: reviewToken(), patch: validEditPatch() }),
    })

    expect(response.statusCode).toBe(503)
  })

  it('rejects request bodies above one megabyte before enqueueing', async () => {
    const { store, line } = dependencies()
    const body = 'x'.repeat(1024 * 1024 + 1)
    const response = await request({ store, line, body })

    expect(response.statusCode).toBe(413)
    expect(store.appendJob).not.toHaveBeenCalled()
  })
})

function dependencies(order: string[] = []) {
  const store = {
    appendJob: vi.fn(async (job) => { order.push('append-job'); return job }),
  } as unknown as OcrLedgerStore & { appendJob: ReturnType<typeof vi.fn> }
  const line = {
    downloadImage: vi.fn(async () => { throw new Error('must not download in webhook') }),
    reply: vi.fn(async () => { order.push('reply-ack') }),
    push: vi.fn(), verifyLiffIdToken: vi.fn(), assertGroupMember: vi.fn(), validatePush: vi.fn(),
  } satisfies OcrLinePort
  return { store, line }
}

async function request(input: {
  store: OcrLedgerStore
  line: OcrLinePort
  body: string
  signature?: string
  order?: string[]
  url?: string
  headers?: Record<string, string>
}) {
  const req = new PassThrough() as PassThrough & IncomingMessage
  req.method = 'POST'
  req.url = input.url ?? '/api/ocr-ledger/webhook'
  req.headers = {
    'x-line-signature': input.signature ?? createHmac('sha256', CONFIG.lineChannelSecret).update(input.body).digest('base64'),
    ...input.headers,
  }
  req.end(input.body)
  const headers: Record<string, string> = {}
  let responseBody = ''
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(body?: string) { responseBody = body ?? ''; input.order?.push('respond-200') },
  } as unknown as ServerResponse
  await createOcrLedgerMiddleware({ config: CONFIG, store: input.store, line: input.line, now: () => NOW })(req, response)
  return { statusCode: response.statusCode, headers, body: responseBody ? JSON.parse(responseBody) : null }
}

function webhook(events: unknown[]): string {
  return JSON.stringify({ events })
}

function imageEvent(input: { eventId?: string; groupId?: string } = {}) {
  return {
    type: 'message', webhookEventId: input.eventId ?? 'evt-image', replyToken: 'reply-token',
    source: { type: 'group', groupId: input.groupId ?? 'Cgroup1', userId: 'Ustaff1' },
    message: { id: 'm-image-1', type: 'image' },
  }
}

function postbackEvent(data: string) {
  return {
    type: 'postback', webhookEventId: 'evt-postback', replyToken: 'reply-token',
    source: { type: 'group', groupId: 'Cgroup1', userId: 'Ustaff1' }, postback: { data },
  }
}

function reviewToken(): string {
  return signReviewToken({
    v: 1, documentId: 'OCR-20260822-abc123', groupId: 'Cgroup1', draftVersion: 2,
    action: 'REVIEW', exp: Math.floor(NOW.getTime() / 1000) + 3600,
  }, CONFIG.reviewSigningSecret)
}

function validEditPatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22', documentTime: null,
    counterpartyName: 'Merchant', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
    serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: null,
    lineItems: [lineItem(1)], ...overrides,
  }
}

function lineItem(lineNumber: number): Record<string, unknown> {
  return {
    lineNumber, description: 'Paper', quantity: 1, unit: 'pack', unitPrice: 100,
    discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: 'office', confidence: 0.99,
  }
}

const CONFIG: OcrLedgerConfig = {
  lineChannelSecret: 'line-secret', lineChannelAccessToken: 'line-token', allowedGroupId: 'Cgroup1',
  masterSpreadsheetId: 'master', driveRootId: 'drive-root', liffId: 'liff-id', liffChannelId: 'liff-channel',
  reviewSigningSecret: 'review-secret', openAiApiKey: 'openai-key', openAiOcrModel: 'gpt-5-mini',
  googleClientId: 'google-client', googleClientSecret: 'google-secret', googleRefreshToken: 'google-refresh',
  dailyReportEnabled: false, dailyReportTime: '20:00', timezone: 'Asia/Bangkok', workerBatchSize: 10,
  maxImageBytes: 2_000_000, openAiMaxOutputTokens: 2000,
}
