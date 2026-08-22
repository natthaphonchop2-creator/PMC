import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { OcrDraft, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts'
import type { OcrLedgerConfig } from '../../server/ocr-ledger/config'
import type { OcrDrivePort } from '../../server/ocr-ledger/googleClient'
import type { OcrLedgerStore } from '../../server/ocr-ledger/googleStore'
import type { OcrLinePort } from '../../server/ocr-ledger/lineClient'
import type { OcrExtractorPort } from '../../server/ocr-ledger/openAiExtractor'
import { verifyReviewToken } from '../../server/ocr-ledger/security'
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
    expect(order).toEqual([
      'lease', 'line-download', 'drive-upload', 'duplicate-check', 'extract',
      'find-folder:drive-root:2026', 'create-folder:drive-root:2026',
      'find-folder:folder-2026:08', 'create-folder:folder-2026:08',
      'find-folder:folder-08:RECEIPT', 'create-folder:folder-08:RECEIPT',
      'move-file:drive-file-1:folder-RECEIPT', 'save-draft', 'line-push', 'update-job',
    ])
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
      patch: validEditPatch({ note: 'edited', grandTotal: 120 }),
    }, existing.documentId)])
    store.drafts.push(existing)
    const { worker, line } = harness(store)

    await worker.runOnce()

    expect(store.drafts[0]).toEqual(expect.objectContaining({ draftVersion: 2, note: 'edited', grandTotal: 120 }))
    expect(store.audits).toEqual([expect.objectContaining({ documentId: existing.documentId, action: 'EDIT', actorLineUserId: 'Ueditor' })])
    expect(line.push).toHaveBeenCalledWith('Cgroup1', [expect.objectContaining({ type: 'flex' })])
  })

  it('rejects malformed edit types and line numbering before audit or draft mutation', async () => {
    const existing = draft()
    const store = new FakeStore([job('EDIT', {
      expectedVersion: 1, actorLineUserId: 'Ueditor', actorDisplayName: 'Editor', groupId: 'Cgroup1',
      patch: validEditPatch({ grandTotal: '120', lineItems: [lineItem(2)] }),
    }, existing.documentId)])
    store.drafts.push(existing)
    const { worker } = harness(store)

    await worker.runOnce()

    expect(store.drafts).toEqual([existing])
    expect(store.audits).toEqual([])
    expect(store.jobs[0]).toMatchObject({ state: 'QUEUED', lastErrorCode: 'OCR_INVALID_OUTPUT' })
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

  it('persists CONFIRM as the decision before mutations so a competing CANCEL cannot win during repair', async () => {
    let current = START
    const existing = draft()
    const store = new FakeStore([
      job('CONFIRM', actionPayload(), existing.documentId),
      job('CANCEL', actionPayload(), existing.documentId, 'job-2'),
      job('EDIT', { ...actionPayload(), patch: validEditPatch({ note: 'must-not-apply' }) }, existing.documentId, 'job-3'),
      job('RETRY', actionPayload(), existing.documentId, 'job-4'),
    ])
    store.drafts.push(existing)
    store.saveFailures = 1
    const { worker } = harness(store, [], () => current)

    await worker.runOnce()

    expect(store.terminalDecisions.get(existing.documentId)).toBe('CONFIRM')
    expect(store.finalized).toHaveLength(1)
    expect(store.drafts[0].state).toBe('PENDING_REVIEW')
    expect(store.drafts[0].note).toBeNull()
    expect(store.drafts[0].draftVersion).toBe(1)
    expect(store.jobs.find((entry) => entry.jobId === 'job-2')?.state).toBe('DONE')

    current = new Date(store.jobs[0].availableAt)
    await worker.runOnce()

    expect(store.finalized).toHaveLength(2)
    expect(store.drafts[0]).toMatchObject({ state: 'CONFIRMED', verificationStatus: 'STAFF_CONFIRMED' })
    expect(store.audits.filter((entry) => entry.action === 'CONFIRM')).toHaveLength(1)
    expect(store.audits.some((entry) => entry.action === 'CANCEL')).toBe(false)
  })

  it('replays the original failed intake when RETRY has no saved draft or file', async () => {
    const original = job('INTAKE', intakePayload(), 'OCR-20260822-abc123', 'job-intake')
    original.state = 'FAILED'
    original.attempts = 4
    const retry = job('RETRY', actionPayload(), original.documentId, 'job-retry')
    const store = new FakeStore([original, retry])
    const { worker, line, extractor } = harness(store)

    await worker.runOnce()

    expect(line.downloadImage).toHaveBeenCalledWith('m-image-1')
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(store.drafts).toEqual([expect.objectContaining({ documentId: original.documentId, state: 'PENDING_REVIEW' })])
    expect(retry.state).toBe('DONE')
  })

  it('signs terminal RETRY with the current saved draft version', async () => {
    const existing = draft({ state: 'FAILED', draftVersion: 3 })
    const retry = job('RETRY', { ...actionPayload(), expectedVersion: 3 }, existing.documentId)
    retry.attempts = 3
    const store = new FakeStore([retry])
    store.drafts.push(existing)
    const { worker, extractor, line } = harness(store)
    extractor.extract.mockRejectedValue(Object.assign(new Error('rate limited'), { code: 'OCR_RATE_LIMIT' }))

    await worker.runOnce()

    const data = findPostbackData(line.push.mock.calls.at(-1)?.[1])
    expect(verifyReviewToken(data, CONFIG.reviewSigningSecret, Math.floor(START.getTime() / 1000))).toMatchObject({
      documentId: existing.documentId, draftVersion: 3, action: 'RETRY',
    })
  })

  it('skips terminal retry delivery when the versioned draft read fails instead of signing version 1', async () => {
    const existing = draft({ state: 'FAILED', draftVersion: 3 })
    const retry = job('RETRY', { ...actionPayload(), expectedVersion: 3 }, existing.documentId)
    retry.attempts = 3
    const store = new FakeStore([retry])
    store.drafts.push(existing)
    store.failGetDraftOnCall = 2
    const { worker, extractor, line } = harness(store)
    extractor.extract.mockRejectedValue(Object.assign(new Error('rate limited'), { code: 'OCR_RATE_LIMIT' }))

    await worker.runOnce()

    expect(store.jobs[0]).toMatchObject({ state: 'FAILED', lastErrorCode: 'OCR_RATE_LIMIT' })
    expect(line.push).not.toHaveBeenCalled()
  })

  it('uses initial version 1 only after a successful draft lookup confirms no draft exists', async () => {
    const intake = job('INTAKE', intakePayload())
    intake.attempts = 3
    const store = new FakeStore([intake])
    const { worker, line } = harness(store)
    line.downloadImage.mockRejectedValue(new Error('LINE unavailable'))

    await worker.runOnce()

    const data = findPostbackData(line.push.mock.calls.at(-1)?.[1])
    expect(verifyReviewToken(data, CONFIG.reviewSigningSecret, Math.floor(START.getTime() / 1000))).toMatchObject({
      documentId: store.jobs[0].documentId, draftVersion: 1, action: 'RETRY',
    })
  })

  it('organizes a saved-draft RETRY source by the original intake Bangkok time', async () => {
    const existing = draft({ state: 'FAILED', sourceImageFileId: 'root-staged-file' })
    const original = job('INTAKE', intakePayload(), existing.documentId, 'job-intake')
    original.state = 'FAILED'
    original.createdAt = '2025-12-31T18:30:00.000Z'
    const retry = job('RETRY', actionPayload(), existing.documentId, 'job-retry')
    const store = new FakeStore([original, retry])
    store.drafts.push(existing)
    const { worker, drive } = harness(store)

    await worker.runOnce()

    expect(drive.findFolder.mock.calls).toEqual([
      ['2026', 'drive-root'], ['01', 'folder-2026'], ['RECEIPT', 'folder-01'],
    ])
    expect(drive.moveFile).toHaveBeenCalledWith('root-staged-file', 'folder-RECEIPT')
    expect(store.drafts[0]).toMatchObject({ state: 'PENDING_REVIEW', draftVersion: 2 })
  })

  it('uses received-at Bangkok month folders even when OCR returns an invalid document date', async () => {
    const store = new FakeStore([job('INTAKE', intakePayload())])
    const { worker, extractor, drive } = harness(store)
    extractor.extract.mockResolvedValueOnce({
      documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: 'not-a-date', documentTime: null,
      counterpartyName: 'Merchant', currency: 'THB', subtotal: 100, discountAmount: 0, taxAmount: 0,
      serviceCharge: 0, grandTotal: 100, referenceNumber: null, categoryId: 'office', note: null,
      sourceImageSha256: PNG_HASH, confidenceByField: {}, lineItems: [], warnings: [],
    })

    await worker.runOnce()

    expect(drive.findFolder.mock.calls).toEqual([
      ['2026', 'drive-root'], ['08', 'folder-2026'], ['RECEIPT', 'folder-08'],
    ])
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

  it('delivers a confirmed-only TODAY command report through the single writer', async () => {
    const store = new FakeStore([job('REPORT_COMMAND', { command: 'TODAY', groupId: 'Cgroup1' })])
    store.confirmedDocuments.set('monthly-2026-08', [
      draft({ state: 'CONFIRMED', direction: 'INCOME', grandTotal: 1000, taxAmount: 70, categoryId: 'sales' }),
      draft({ documentId: 'OCR-20260822-def456', state: 'CONFIRMED', direction: 'EXPENSE', grandTotal: 300, taxAmount: 21, categoryId: 'office' }),
      draft({ documentId: 'OCR-20260822-ghi789', state: 'PENDING_REVIEW', direction: 'EXPENSE', grandTotal: 9999 }),
    ])
    const { worker, line, extractor } = harness(store)

    const result = await worker.runOnce()

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0, reportSent: true })
    expect(extractor.extract).not.toHaveBeenCalled()
    expect(line.push).toHaveBeenCalledWith('Cgroup1', [expect.objectContaining({ type: 'flex' })])
    expect(JSON.stringify(line.push.mock.calls[0][1])).toContain('1,000')
    expect(JSON.stringify(line.push.mock.calls[0][1])).toContain('300')
    expect(JSON.stringify(line.push.mock.calls[0][1])).not.toContain('9,999')
  })

  it('catches up the 20:00 Bangkok report and records its idempotency row only after the LINE push', async () => {
    const current = new Date('2026-08-22T13:00:00.000Z')
    const store = new FakeStore([])
    const { worker, line } = harness(store, [], () => current, { dailyReportEnabled: true })

    const result = await worker.runOnce()

    expect(result).toMatchObject({ processed: 0, reportSent: true })
    expect(line.push).toHaveBeenCalledTimes(1)
    expect(store.jobs).toEqual([expect.objectContaining({
      jobType: 'REPORT_COMMAND', state: 'DONE', idempotencyKey: 'report:Cgroup1:2026-08-22:daily',
    })])
  })

  it('lists the ten oldest pending drafts and refreshes each REVIEW token for 24 hours', async () => {
    const oldest = draft({ documentId: 'OCR-20260822-oldest1', draftVersion: 3, state: 'PENDING_REVIEW' })
    const newest = draft({ documentId: 'OCR-20260822-newest1', draftVersion: 2, state: 'PENDING_REVIEW' })
    const store = new FakeStore([
      job('INTAKE', intakePayload(), newest.documentId, 'newest'),
      job('INTAKE', intakePayload(), oldest.documentId, 'oldest'),
      job('REPORT_COMMAND', { command: 'PENDING', groupId: 'Cgroup1' }, null, 'report'),
    ])
    store.jobs[0].createdAt = '2026-08-22T03:10:00.000Z'
    store.jobs[1].createdAt = '2026-08-22T03:00:00.000Z'
    store.jobs[0].state = 'DONE'
    store.jobs[1].state = 'DONE'
    store.drafts.push(oldest, newest)
    const { worker, line } = harness(store)

    await worker.runOnce()

    const uris = findUriActions(line.push.mock.calls[0][1])
    expect(uris).toHaveLength(2)
    expect(uris.map((uri) => JSON.parse(Buffer.from(new URL(uri).searchParams.get('token')!.split('.')[0], 'base64url').toString('utf8')).documentId)).toEqual([oldest.documentId, newest.documentId])
    expect(verifyReviewToken(new URL(uris[0]).searchParams.get('token')!, CONFIG.reviewSigningSecret, Math.floor(START.getTime() / 1000))).toMatchObject({
      action: 'REVIEW', draftVersion: 3, exp: Math.floor(START.getTime() / 1000) + 24 * 60 * 60,
    })
  })

  it('does not record the daily idempotency key when LINE rejects the scheduled report', async () => {
    const current = new Date('2026-08-22T16:00:00.000Z')
    const store = new FakeStore([])
    const { worker, line } = harness(store, [], () => current, { dailyReportEnabled: true })
    line.push.mockRejectedValueOnce(new Error('LINE unavailable'))

    const result = await worker.runOnce()

    expect(result.reportSent).toBe(false)
    expect(store.jobs).toEqual([])
  })
})

class FakeStore implements OcrLedgerStore {
  drafts: OcrDraft[] = []
  errors: Array<{ jobId: string; documentId: string | null; code: string; createdAt: string }> = []
  audits: Array<Record<string, unknown>> = []
  finalized: Array<{ draft: OcrDraft; ledger: { month: string; monthlySpreadsheetId: string } }> = []
  confirmedDocuments = new Map<string, OcrDraft[]>()
  terminalDecisions = new Map<string, 'CONFIRM' | 'CANCEL'>()
  saveFailures = 0
  getDraftCalls = 0
  failGetDraftOnCall: number | null = null

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
  async saveDraft(next: OcrDraft) { this.order.push('save-draft'); if (this.saveFailures > 0) { this.saveFailures -= 1; throw new Error('sheet unavailable') }; const index = this.drafts.findIndex((entry) => entry.documentId === next.documentId); if (index < 0) this.drafts.push(structuredClone(next)); else this.drafts[index] = structuredClone(next) }
  async getDraft(documentId: string) { this.getDraftCalls += 1; if (this.failGetDraftOnCall === this.getDraftCalls) throw new Error('sheet unavailable'); return structuredClone(this.drafts.find((entry) => entry.documentId === documentId) ?? null) }
  async findDraftByImageSha256(hash: string) { this.order.push('duplicate-check'); return structuredClone(this.drafts.find((entry) => entry.sourceImageSha256 === hash) ?? null) }
  async appendError(error: { jobId: string; documentId: string | null; code: string; createdAt: string }) { this.errors.push(error) }
  async appendAudit(action: Record<string, unknown>) { this.audits.push(structuredClone(action)) }
  async getTerminalDecision(documentId: string) { return this.terminalDecisions.get(documentId) ?? null }
  async claimTerminalDecision(action: Record<string, unknown>) {
    const documentId = String(action.documentId)
    const requested = action.action as 'CONFIRM' | 'CANCEL'
    const existing = this.terminalDecisions.get(documentId)
    if (existing) return { decision: existing, claimed: false }
    this.terminalDecisions.set(documentId, requested)
    this.audits.push(structuredClone(action))
    return { decision: requested, claimed: true }
  }
  async ensureMonthlyLedger(month: string) { return { month, monthlySpreadsheetId: `monthly-${month}` } }
  async finalizeDocument(next: OcrDraft, ledger: { month: string; monthlySpreadsheetId: string }) { this.finalized.push({ draft: structuredClone(next), ledger }) }
  async listConfirmedDocuments(monthlySpreadsheetId: string) { return structuredClone(this.confirmedDocuments.get(monthlySpreadsheetId) ?? []) }
}

function harness(store: FakeStore, order: string[] = [], now: () => Date = () => START, config: Partial<OcrLedgerConfig> = {}) {
  const line = {
    downloadImage: vi.fn(async () => { order.push('line-download'); return { bytes: PNG, mimeType: 'image/png' as const } }),
    reply: vi.fn(), push: vi.fn(async () => { order.push('line-push') }), verifyLiffIdToken: vi.fn(), assertGroupMember: vi.fn(), validatePush: vi.fn(),
  } satisfies OcrLinePort
  const drive = {
    createFolder: vi.fn(async (name: string, parentId?: string) => { order.push(`create-folder:${parentId}:${name}`); return `folder-${name}` }),
    findFolder: vi.fn(async (name: string, parentId: string) => { order.push(`find-folder:${parentId}:${name}`); return null }),
    moveFile: vi.fn(async (fileId: string, parentId: string) => { order.push(`move-file:${fileId}:${parentId}`) }),
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

function findPostbackData(messages: unknown): string {
  const serialized = JSON.stringify(messages)
  const match = /"data":"([^"]+)"/.exec(serialized)
  if (!match) throw new Error('postback data not found')
  return match[1]
}

function findUriActions(messages: unknown): string[] {
  const uris: string[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.type === 'uri' && typeof record.uri === 'string') uris.push(record.uri)
    Object.values(record).forEach(visit)
  }
  visit(messages)
  return uris
}

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
