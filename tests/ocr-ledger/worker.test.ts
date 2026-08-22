import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { OcrDraft, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts'
import type { OcrLedgerConfig } from '../../server/ocr-ledger/config'
import type { OcrDrivePort } from '../../server/ocr-ledger/googleClient'
import type { OcrLedgerStore } from '../../server/ocr-ledger/googleStore'
import type { OcrLinePort } from '../../server/ocr-ledger/lineClient'
import type { OcrExtractorPort } from '../../server/ocr-ledger/openAiExtractor'
import { createOcrLedgerWorker } from '../../server/ocr-ledger/worker'

const START = new Date('2026-08-22T03:00:00.000Z')
const PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#1188cc' } }).png().toBuffer()
const PNG_HASH = createHash('sha256').update(PNG).digest('hex')

describe('createOcrLedgerWorker', () => {
  it('processes intake serially from LINE download through Drive, OCR, draft save, and Flex delivery', async () => {
    const order: string[] = []
    const store = new FakeStore([job('INTAKE', intakePayload())], order)
    const { worker, line, drive, extractor } = harness(store, order)

    const result = await worker.runOnce()

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, reportSent: false })
    expect(order).toEqual(['lease', 'line-download', 'drive-upload', 'duplicate-check', 'extract', 'save-draft', 'line-push', 'update-job'])
    expect(store.drafts).toHaveLength(1)
    expect(store.drafts[0]).toEqual(expect.objectContaining({ state: 'PENDING_REVIEW', draftVersion: 1, sourceImageFileId: 'drive-file-1' }))
    expect(line.push).toHaveBeenCalledWith('Cgroup1', [expect.objectContaining({ type: 'flex' })])
    expect(drive.uploadImage).toHaveBeenCalledTimes(1)
    expect(extractor.extract).toHaveBeenCalledTimes(1)
  })

  it('shows the existing status for an exact-image duplicate without creating a second draft', async () => {
    const existing = draft({ sourceImageSha256: PNG_HASH })
    const store = new FakeStore([job('INTAKE', intakePayload())])
    store.drafts.push(existing)
    const { worker, extractor, line } = harness(store)

    await worker.runOnce()

    expect(extractor.extract).not.toHaveBeenCalled()
    expect(store.drafts).toEqual([existing])
    expect(line.push).toHaveBeenCalledWith('Cgroup1', [expect.objectContaining({ type: 'flex' })])
  })

  it('reschedules provider failures after 1, 5, and 15 minutes, then records a terminal sanitized error', async () => {
    let current = START
    const store = new FakeStore([job('INTAKE', intakePayload())])
    const { worker, extractor, line } = harness(store, [], () => current)
    extractor.extract.mockRejectedValue(Object.assign(new Error('provider body must not persist'), { code: 'OCR_RATE_LIMIT' }))

    for (const expectedMinutes of [1, 5, 15]) {
      await worker.runOnce()
      expect(store.jobs[0]).toEqual(expect.objectContaining({ state: 'QUEUED', lastErrorCode: 'OCR_RATE_LIMIT' }))
      expect(store.jobs[0].availableAt).toBe(new Date(current.getTime() + expectedMinutes * 60_000).toISOString())
      expect(store.jobs[0].payloadJson).not.toContain('provider body')
      current = new Date(store.jobs[0].availableAt)
    }
    const result = await worker.runOnce()

    expect(result.failed).toBe(1)
    expect(store.jobs[0]).toEqual(expect.objectContaining({ state: 'FAILED', attempts: 4, lastErrorCode: 'OCR_RATE_LIMIT' }))
    expect(store.errors).toEqual([{ jobId: 'job-1', documentId: store.jobs[0].documentId, code: 'OCR_RATE_LIMIT', createdAt: current.toISOString() }])
    expect(JSON.stringify(line.push.mock.calls.at(-1))).not.toContain('provider body')
    expect(extractor.extract).toHaveBeenCalledTimes(4)
  })

  it('reuses a saved draft for a LINE-send retry without calling OpenAI again', async () => {
    let current = START
    const store = new FakeStore([job('INTAKE', intakePayload())])
    const { worker, extractor, line } = harness(store, [], () => current)
    line.push.mockRejectedValueOnce(new Error('LINE unavailable')).mockResolvedValueOnce(undefined)

    await worker.runOnce()
    current = new Date(store.jobs[0].availableAt)
    await worker.runOnce()

    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(store.drafts).toHaveLength(1)
    expect(line.push).toHaveBeenCalledTimes(2)
    expect(store.jobs[0].state).toBe('DONE')
  })

  it('requires the expected version for edits, audits the change, and sends a revised Flex', async () => {
    const existing = draft()
    const store = new FakeStore([job('EDIT', {
      expectedVersion: 1, actorLineUserId: 'Ueditor', actorDisplayName: 'Editor', groupId: 'Cgroup1',
      patch: { note: 'edited', grandTotal: 120 },
    }, existing.documentId)])
    store.drafts.push(existing)
    const { worker, line } = harness(store)

    await worker.runOnce()

    expect(store.drafts[0]).toEqual(expect.objectContaining({ draftVersion: 2, note: 'edited', grandTotal: 120 }))
    expect(store.audits).toEqual([expect.objectContaining({ documentId: existing.documentId, action: 'EDIT', actorLineUserId: 'Ueditor' })])
    expect(line.push).toHaveBeenCalledWith('Cgroup1', [expect.objectContaining({ type: 'flex' })])
  })

  it('lets the first terminal action win, confirms to the monthly ledger, and makes later actions no-ops', async () => {
    const existing = draft()
    const confirm = job('CONFIRM', actionPayload(), existing.documentId)
    const cancel = job('CANCEL', actionPayload(), existing.documentId, 'job-2')
    const edit = job('EDIT', { ...actionPayload(), patch: { note: 'must-not-change' } }, existing.documentId, 'job-3')
    const retry = job('RETRY', actionPayload(), existing.documentId, 'job-4')
    const store = new FakeStore([confirm, cancel, edit, retry])
    store.drafts.push(existing)
    const { worker } = harness(store)

    await worker.runOnce()

    expect(store.finalized).toHaveLength(1)
    expect(store.finalized[0].draft).toEqual(expect.objectContaining({ state: 'CONFIRMED', verificationStatus: 'STAFF_CONFIRMED', confirmedBy: 'Staff' }))
    expect(store.drafts[0].state).toBe('CONFIRMED')
    expect(store.audits.map((entry) => entry.action)).toEqual(['CONFIRM'])
    expect(store.drafts[0].note).toBeNull()
    expect(store.jobs.every((entry) => entry.state === 'DONE')).toBe(true)
  })

  it('cancels without writing the ledger while retaining the source image and audit', async () => {
    const existing = draft({ sourceImageFileId: 'drive-original' })
    const store = new FakeStore([job('CANCEL', actionPayload(), existing.documentId)])
    store.drafts.push(existing)
    const { worker } = harness(store)

    await worker.runOnce()

    expect(store.finalized).toEqual([])
    expect(store.drafts[0]).toEqual(expect.objectContaining({ state: 'CANCELLED', sourceImageFileId: 'drive-original' }))
    expect(store.audits).toEqual([expect.objectContaining({ action: 'CANCEL' })])
  })

  it('leases expired abandoned work in queue order and processes no more than the configured batch size', async () => {
    const expired = job('REPORT_COMMAND', { command: 'TODAY', groupId: 'Cgroup1' })
    expired.state = 'LEASED'
    expired.leaseUntil = '2026-08-22T02:59:59.000Z'
    const store = new FakeStore([
      expired,
      job('REPORT_COMMAND', { command: 'PENDING', groupId: 'Cgroup1' }, null, 'job-2'),
      job('REPORT_COMMAND', { command: 'ERRORS', groupId: 'Cgroup1' }, null, 'job-3'),
    ])
    const { worker } = harness(store, [], () => START, { workerBatchSize: 2 })

    const result = await worker.runOnce()

    expect(result.processed).toBe(2)
    expect(store.jobs.map((entry) => entry.state)).toEqual(['DONE', 'DONE', 'QUEUED'])
  })
})

class FakeStore implements OcrLedgerStore {
  drafts: OcrDraft[] = []
  errors: Array<{ jobId: string; documentId: string | null; code: string; createdAt: string }> = []
  audits: Array<Record<string, unknown>> = []
  finalized: Array<{ draft: OcrDraft; ledger: { month: string; monthlySpreadsheetId: string } }> = []

  constructor(public jobs: OcrQueueJob[], private readonly order: string[] = []) {}

  async appendJob(next: OcrQueueJob) { const found = this.jobs.find((entry) => entry.idempotencyKey === next.idempotencyKey); if (!found) this.jobs.push(next); return found ?? next }
  async listJobs() { return this.jobs.map((entry) => structuredClone(entry)) }
  async leaseJobs({ now, leaseSeconds, limit }: { now: string; leaseSeconds: number; limit: number }) {
    this.order.push('lease')
    const leased = this.jobs.filter((entry) => entry.availableAt <= now && (entry.state === 'QUEUED' || entry.state === 'LEASED') && (!entry.leaseUntil || entry.leaseUntil <= now)).slice(0, limit)
    for (const entry of leased) {
      entry.state = 'LEASED'; entry.attempts += 1; entry.leaseUntil = new Date(new Date(now).getTime() + leaseSeconds * 1000).toISOString(); entry.updatedAt = now
    }
    return leased.map((entry) => structuredClone(entry))
  }
  async updateJob(next: OcrQueueJob) { this.order.push('update-job'); Object.assign(this.jobs.find((entry) => entry.jobId === next.jobId)!, structuredClone(next)) }
  async saveDraft(next: OcrDraft) { this.order.push('save-draft'); const index = this.drafts.findIndex((entry) => entry.documentId === next.documentId); if (index < 0) this.drafts.push(structuredClone(next)); else this.drafts[index] = structuredClone(next) }
  async getDraft(documentId: string) { return structuredClone(this.drafts.find((entry) => entry.documentId === documentId) ?? null) }
  async findDraftByImageSha256(hash: string) { this.order.push('duplicate-check'); return structuredClone(this.drafts.find((entry) => entry.sourceImageSha256 === hash) ?? null) }
  async appendError(error: { jobId: string; documentId: string | null; code: string; createdAt: string }) { this.errors.push(error) }
  async appendAudit(action: Record<string, unknown>) { this.audits.push(structuredClone(action)) }
  async ensureMonthlyLedger(month: string) { return { month, monthlySpreadsheetId: `monthly-${month}` } }
  async finalizeDocument(next: OcrDraft, ledger: { month: string; monthlySpreadsheetId: string }) { this.finalized.push({ draft: structuredClone(next), ledger }) }
  async listConfirmedDocuments() { return [] }
}

function harness(store: FakeStore, order: string[] = [], now: () => Date = () => START, config: Partial<OcrLedgerConfig> = {}) {
  const line = {
    downloadImage: vi.fn(async () => { order.push('line-download'); return { bytes: PNG, mimeType: 'image/png' as const } }),
    reply: vi.fn(), push: vi.fn(async () => { order.push('line-push') }), verifyLiffIdToken: vi.fn(), assertGroupMember: vi.fn(), validatePush: vi.fn(),
  } satisfies OcrLinePort
  const drive = {
    createFolder: vi.fn(),
    uploadImage: vi.fn(async () => { order.push('drive-upload'); return 'drive-file-1' }),
    downloadImage: vi.fn(async () => ({ bytes: PNG, mimeType: 'image/png' as const })),
  } satisfies OcrDrivePort
  const extractor = {
    extract: vi.fn(async () => {
      order.push('extract')
      return {
        documentType: 'RECEIPT' as const, direction: 'EXPENSE' as const, documentDate: '2026-08-22', documentTime: null,
        counterpartyName: 'Merchant', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
        serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: null,
        sourceImageSha256: 'ignored-by-worker', confidenceByField: {}, lineItems: [], warnings: [],
      }
    }),
  } satisfies OcrExtractorPort
  return {
    worker: createOcrLedgerWorker({ config: { ...CONFIG, ...config }, store, line, drive, extractor, now }),
    line, drive, extractor,
  }
}

function job(jobType: OcrQueueJob['jobType'], payload: unknown, documentId: string | null = null, jobId = 'job-1'): OcrQueueJob {
  return {
    jobId, jobType, documentId, idempotencyKey: `${jobType}:${jobId}`, payloadJson: JSON.stringify(payload), state: 'QUEUED', attempts: 0,
    availableAt: START.toISOString(), leaseUntil: null, lastErrorCode: null, createdAt: START.toISOString(), updatedAt: START.toISOString(),
  }
}

function intakePayload() { return { messageId: 'm-image-1', groupId: 'Cgroup1', userId: 'Ustaff1' } }
function actionPayload() { return { expectedVersion: 1, actorLineUserId: 'Ustaff1', actorDisplayName: 'Staff', groupId: 'Cgroup1' } }

function draft(patch: Partial<OcrDraft> = {}): OcrDraft {
  return {
    documentId: 'OCR-20260822-abc123', documentType: 'RECEIPT', direction: 'EXPENSE', state: 'PENDING_REVIEW',
    documentDate: '2026-08-22', documentTime: null, counterpartyName: 'Merchant', currency: 'THB', subtotal: 100,
    discountAmount: 0, taxAmount: 0, serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: null,
    sourceImageFileId: 'drive-file-1', sourceImageSha256: 'hash-1', sourceLineMessageId: 'm-image-1', sourceLineUserId: 'Ustaff1',
    confidenceByField: {}, senderName: null, senderBank: null, senderAccountMasked: null, receiverName: null, receiverBank: null,
    receiverAccountMasked: null, transferDate: null, transferTime: null, amount: null, merchantName: null, merchantTaxId: null,
    branch: null, receiptNumber: null, receiptDate: null, paymentMethod: null, draftVersion: 1, confirmedBy: null, confirmedAt: null,
    verificationStatus: null, warnings: [], lineItems: [], ...patch,
  }
}

const CONFIG: OcrLedgerConfig = {
  lineChannelSecret: 'line-secret', lineChannelAccessToken: 'line-token', allowedGroupId: 'Cgroup1', masterSpreadsheetId: 'master',
  driveRootId: 'drive-root', liffId: 'liff-id', liffChannelId: 'liff-channel', reviewSigningSecret: 'review-secret', openAiApiKey: 'openai-key',
  openAiOcrModel: 'gpt-5-mini', googleClientId: 'google-client', googleClientSecret: 'google-secret', googleRefreshToken: 'google-refresh',
  dailyReportEnabled: false, dailyReportTime: '20:00', timezone: 'Asia/Bangkok', workerBatchSize: 10, maxImageBytes: 2_000_000,
  openAiMaxOutputTokens: 2000,
}
