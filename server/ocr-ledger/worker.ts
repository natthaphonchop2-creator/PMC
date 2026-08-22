import { randomUUID } from 'node:crypto'
import type { OcrDraft, OcrExtraction, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts.js'
import type { OcrLedgerConfig } from './config.js'
import { bangkokMonthKey } from './domain.js'
import { parseOcrEditablePatch } from './editValidation.js'
import { buildDraftFlex, buildFinalFlex } from './flexMessages.js'
import type { OcrDrivePort } from './googleClient.js'
import type { OcrLedgerStore } from './googleStore.js'
import { prepareOcrImage } from './imageProcessing.js'
import type { OcrLinePort } from './lineClient.js'
import { OcrExtractorError, type OcrExtractorPort } from './openAiExtractor.js'
import { signReviewToken } from './security.js'

type WorkerErrorCode =
  | 'LINE_DOWNLOAD_FAILED' | 'DRIVE_UPLOAD_FAILED' | 'OCR_RATE_LIMIT' | 'OCR_INVALID_OUTPUT'
  | 'SHEET_WRITE_FAILED' | 'LINE_SEND_FAILED' | 'VERSION_CONFLICT' | 'UNSUPPORTED_IMAGE'

export interface OcrLedgerWorkerResult {
  processed: number
  succeeded: number
  failed: number
  reportSent: boolean
}

export function createOcrLedgerWorker(deps: {
  config: OcrLedgerConfig
  store: OcrLedgerStore
  line: OcrLinePort
  drive: OcrDrivePort
  extractor: OcrExtractorPort
  now: () => Date
}): { runOnce(): Promise<OcrLedgerWorkerResult> } {
  return {
    async runOnce() {
      const leased = await deps.store.leaseJobs({
        now: deps.now().toISOString(), leaseSeconds: 5 * 60, limit: deps.config.workerBatchSize,
      })
      const result: OcrLedgerWorkerResult = { processed: 0, succeeded: 0, failed: 0, reportSent: false }
      for (const job of leased) {
        result.processed += 1
        try {
          await processJob(job, deps)
          await updateJob(deps.store, { ...job, state: 'DONE', leaseUntil: null, lastErrorCode: null, updatedAt: deps.now().toISOString() })
          result.succeeded += 1
        } catch (error) {
          result.failed += 1
          await handleFailure(job, classifyError(error), deps)
        }
      }
      return result
    },
  }
}

async function processJob(
  job: OcrQueueJob,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<void> {
  const payload = parsePayload(job.payloadJson)
  if (typeof payload.deliveryDocumentId === 'string' && typeof payload.groupId === 'string') {
    const saved = await getDraft(deps.store, payload.deliveryDocumentId)
    if (!saved) throw workerError('SHEET_WRITE_FAILED')
    await pushDraft(deps.line, payload.groupId, saved, deps.config, deps.now())
    return
  }
  if (job.jobType === 'INTAKE') return processIntake(job, payload, deps)
  if (job.jobType === 'EDIT') return processEdit(job, payload, deps)
  if (job.jobType === 'CONFIRM' || job.jobType === 'CANCEL') return processTerminalAction(job, payload, deps)
  if (job.jobType === 'RETRY') return processRetry(job, payload, deps)
  if (job.jobType === 'REPORT_COMMAND') return
  throw workerError('OCR_INVALID_OUTPUT')
}

async function processIntake(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<void> {
  const messageId = requiredString(payload.messageId, 'LINE_DOWNLOAD_FAILED')
  const groupId = requiredString(payload.groupId, 'LINE_DOWNLOAD_FAILED')
  const userId = requiredString(payload.userId, 'LINE_DOWNLOAD_FAILED')
  job.documentId ??= createDocumentId(deps.now())

  let source: { bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }
  if (typeof payload.sourceImageFileId === 'string') {
    try { source = await deps.drive.downloadImage(payload.sourceImageFileId) } catch { throw workerError('DRIVE_UPLOAD_FAILED') }
  } else {
    try { source = await deps.line.downloadImage(messageId) } catch { throw workerError('LINE_DOWNLOAD_FAILED') }
    try {
      payload.sourceImageFileId = await deps.drive.uploadImage({
        name: `${job.documentId}.${source.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        parentId: deps.config.driveRootId, mimeType: source.mimeType, bytes: source.bytes,
      })
      job.payloadJson = JSON.stringify(payload)
    } catch {
      throw workerError('DRIVE_UPLOAD_FAILED')
    }
  }

  let prepared
  try { prepared = await prepareOcrImage(source.bytes, deps.config.maxImageBytes) } catch { throw workerError('UNSUPPORTED_IMAGE') }
  payload.sourceImageSha256 = prepared.originalSha256
  job.payloadJson = JSON.stringify(payload)
  const duplicate = await findDuplicate(deps.store, prepared.originalSha256)
  if (duplicate) {
    await organizeSourceImage(deps.drive, deps.config.driveRootId, String(payload.sourceImageFileId), receivedAt(job, payload), duplicate.documentType)
    job.documentId = duplicate.documentId
    payload.deliveryDocumentId = duplicate.documentId
    job.payloadJson = JSON.stringify(payload)
    await pushDraft(deps.line, groupId, duplicate, deps.config, deps.now())
    return
  }

  const extraction = await deps.extractor.extract(prepared)
  if (payload.sourceOrganized !== true) {
    await organizeSourceImage(deps.drive, deps.config.driveRootId, String(payload.sourceImageFileId), receivedAt(job, payload), extraction.documentType)
    payload.sourceOrganized = true
    job.payloadJson = JSON.stringify(payload)
  }
  const saved = draftFromExtraction(job.documentId, extraction, {
    sourceImageFileId: String(payload.sourceImageFileId), sourceImageSha256: prepared.originalSha256,
    sourceLineMessageId: messageId, sourceLineUserId: userId,
  })
  await saveDraft(deps.store, saved)
  payload.deliveryDocumentId = saved.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(deps.line, groupId, saved, deps.config, deps.now())
}

async function processEdit(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  const current = await requiredPendingDraft(job, payload, deps.store)
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') {
    await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps.config, deps.now())
    return
  }
  if (await getTerminalDecision(deps.store, current.documentId)) {
    await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps.config, deps.now())
    return
  }
  const patch = parseOcrEditablePatch(payload.patch)
  if (!patch) throw workerError('OCR_INVALID_OUTPUT')
  const revised: OcrDraft = { ...current, ...patch, draftVersion: current.draftVersion + 1 }
  await appendAudit(deps.store, job, payload, 'EDIT', revised.draftVersion, deps.now())
  await saveDraft(deps.store, revised)
  payload.deliveryDocumentId = revised.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), revised, deps.config, deps.now())
}

async function processTerminalAction(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  const documentId = requiredString(job.documentId, 'SHEET_WRITE_FAILED')
  const current = await getDraft(deps.store, documentId)
  if (!current) throw workerError('SHEET_WRITE_FAILED')
  const groupId = requiredString(payload.groupId, 'LINE_SEND_FAILED')
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') {
    await pushDraft(deps.line, groupId, current, deps.config, deps.now())
    return
  }
  const actor = requiredString(payload.actorLineUserId, 'VERSION_CONFLICT')
  const displayName = typeof payload.actorDisplayName === 'string' && payload.actorDisplayName ? payload.actorDisplayName : actor
  const timestamp = deps.now().toISOString()
  const requestedDecision = job.jobType === 'CONFIRM' ? 'CONFIRM' : 'CANCEL'
  const existingDecision = await getTerminalDecision(deps.store, documentId)
  if (existingDecision && existingDecision !== requestedDecision) {
    await pushDraft(deps.line, groupId, current, deps.config, deps.now())
    return
  }
  if (!existingDecision) assertExpectedVersion(current, payload.expectedVersion)
  let marker
  try {
    marker = await deps.store.claimTerminalDecision({
      documentId, action: requestedDecision, actorLineUserId: actor,
      actorDisplayName: typeof payload.actorDisplayName === 'string' ? payload.actorDisplayName : null,
      createdAt: timestamp, payloadJson: JSON.stringify({ jobId: job.jobId, draftVersion: current.draftVersion, terminalDecision: true }),
    })
  } catch {
    throw workerError('SHEET_WRITE_FAILED')
  }
  if (marker.decision !== requestedDecision) {
    await pushDraft(deps.line, groupId, current, deps.config, deps.now())
    return
  }
  const next: OcrDraft = marker.decision === 'CONFIRM'
    ? { ...current, state: 'CONFIRMED', confirmedBy: displayName, confirmedAt: timestamp, verificationStatus: 'STAFF_CONFIRMED' }
    : { ...current, state: 'CANCELLED' }
  if (marker.decision === 'CONFIRM') {
    const month = bangkokMonthKey(next.documentDate ?? timestamp)
    let ledger
    try { ledger = await deps.store.ensureMonthlyLedger(month) } catch { throw workerError('SHEET_WRITE_FAILED') }
    try { await deps.store.finalizeDocument(next, ledger) } catch { throw workerError('SHEET_WRITE_FAILED') }
  }
  await saveDraft(deps.store, next)
  payload.deliveryDocumentId = next.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(deps.line, groupId, next, deps.config, deps.now())
}

async function processRetry(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<void> {
  const documentId = requiredString(job.documentId, 'SHEET_WRITE_FAILED')
  const current = await getDraft(deps.store, documentId)
  if (!current) {
    const original = await findOriginalIntake(deps.store, documentId)
    if (!original) throw workerError('DRIVE_UPLOAD_FAILED')
    const originalPayload = parsePayload(original.payloadJson)
    originalPayload.receivedAt = original.createdAt
    await processIntake(job, originalPayload, deps)
    return
  }
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') {
    await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps.config, deps.now())
    return
  }
  if (await getTerminalDecision(deps.store, current.documentId)) {
    await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps.config, deps.now())
    return
  }
  if (current.state !== 'FAILED' && current.state !== 'PENDING_REVIEW' && current.state !== 'RETRY_PENDING') throw workerError('VERSION_CONFLICT')
  assertExpectedVersion(current, payload.expectedVersion)
  if (!current.sourceImageFileId) throw workerError('DRIVE_UPLOAD_FAILED')
  let source
  try { source = await deps.drive.downloadImage(current.sourceImageFileId) } catch { throw workerError('DRIVE_UPLOAD_FAILED') }
  let prepared
  try { prepared = await prepareOcrImage(source.bytes, deps.config.maxImageBytes) } catch { throw workerError('UNSUPPORTED_IMAGE') }
  const extraction = await deps.extractor.extract(prepared)
  const original = await findOriginalIntake(deps.store, current.documentId)
  if (!original) throw workerError('SHEET_WRITE_FAILED')
  await organizeSourceImage(
    deps.drive, deps.config.driveRootId, current.sourceImageFileId, original.createdAt, extraction.documentType,
  )
  const revised = {
    ...draftFromExtraction(current.documentId, extraction, {
      sourceImageFileId: current.sourceImageFileId, sourceImageSha256: prepared.originalSha256,
      sourceLineMessageId: current.sourceLineMessageId, sourceLineUserId: current.sourceLineUserId,
    }),
    draftVersion: current.draftVersion + 1,
  }
  await appendAudit(deps.store, job, payload, 'RETRY', revised.draftVersion, deps.now())
  await saveDraft(deps.store, revised)
  payload.deliveryDocumentId = revised.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(deps.line, requiredString(payload.groupId, 'LINE_SEND_FAILED'), revised, deps.config, deps.now())
}

async function handleFailure(
  job: OcrQueueJob,
  code: WorkerErrorCode,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  const now = deps.now()
  const delayMinutes = [1, 5, 15][job.attempts - 1]
  if (delayMinutes !== undefined) {
    await updateJob(deps.store, {
      ...job, state: 'QUEUED', availableAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(), leaseUntil: null,
      lastErrorCode: code, updatedAt: now.toISOString(),
    })
    return
  }

  if (job.jobType === 'INTAKE') await persistFailedIntakeDraft(job, deps.store)
  const failed = { ...job, state: 'FAILED' as const, leaseUntil: null, lastErrorCode: code, updatedAt: now.toISOString() }
  await deps.store.appendError({ jobId: job.jobId, documentId: job.documentId, code, createdAt: now.toISOString() })
  await updateJob(deps.store, failed)
  await pushTerminalRetry(failed, deps).catch(() => undefined)
}

async function persistFailedIntakeDraft(job: OcrQueueJob, store: OcrLedgerStore): Promise<void> {
  if (!job.documentId || await getDraft(store, job.documentId)) return
  const payload = parsePayload(job.payloadJson)
  if (typeof payload.sourceImageFileId !== 'string') return
  const failed = emptyDraft(job.documentId, 'FAILED')
  failed.sourceImageFileId = payload.sourceImageFileId
  failed.sourceImageSha256 = typeof payload.sourceImageSha256 === 'string' ? payload.sourceImageSha256 : null
  failed.sourceLineMessageId = typeof payload.messageId === 'string' ? payload.messageId : null
  failed.sourceLineUserId = typeof payload.userId === 'string' ? payload.userId : null
  await saveDraft(store, failed)
}

async function pushTerminalRetry(
  job: OcrQueueJob,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  const payload = parsePayload(job.payloadJson)
  if (!job.documentId || typeof payload.groupId !== 'string') return
  const current = await deps.store.getDraft(job.documentId)
  const data = signReviewToken({
    v: 1, documentId: job.documentId, groupId: payload.groupId, draftVersion: current?.draftVersion ?? 1, action: 'RETRY',
    exp: Math.floor(deps.now().getTime() / 1000) + 24 * 60 * 60,
  }, deps.config.reviewSigningSecret)
  await deps.line.push(payload.groupId, [{
    type: 'flex', altText: 'อ่านเอกสารไม่สำเร็จ', contents: {
      type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'อ่านเอกสารไม่สำเร็จ กรุณาลองใหม่', wrap: true }] },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'postback', label: 'ลองอ่านใหม่', data } }] },
    },
  }])
}

function draftFromExtraction(
  documentId: string,
  extraction: OcrExtraction & { warnings: OcrDraft['warnings'] },
  source: Pick<OcrDraft, 'sourceImageFileId' | 'sourceImageSha256' | 'sourceLineMessageId' | 'sourceLineUserId'>,
): OcrDraft {
  return {
    ...emptyDraft(documentId, 'PENDING_REVIEW'),
    documentType: extraction.documentType, direction: extraction.direction, documentDate: extraction.documentDate,
    documentTime: extraction.documentTime ?? null, counterpartyName: extraction.counterpartyName ?? null, currency: extraction.currency,
    subtotal: extraction.subtotal, discountAmount: extraction.discountAmount, taxAmount: extraction.taxAmount,
    serviceCharge: extraction.serviceCharge, grandTotal: extraction.grandTotal, referenceNumber: extraction.referenceNumber ?? null,
    categoryId: extraction.categoryId ?? null, note: extraction.note ?? null, confidenceByField: extraction.confidenceByField ?? {},
    warnings: extraction.warnings, lineItems: extraction.lineItems.map((line) => ({ ...line, documentId })), ...source,
  }
}

function emptyDraft(documentId: string, state: OcrDraft['state']): OcrDraft {
  return {
    documentId, documentType: null, direction: null, state, documentDate: null, documentTime: null, counterpartyName: null,
    currency: null, subtotal: null, discountAmount: null, taxAmount: null, serviceCharge: null, grandTotal: null,
    referenceNumber: null, categoryId: null, note: null, sourceImageFileId: null, sourceImageSha256: null,
    sourceLineMessageId: null, sourceLineUserId: null, confidenceByField: {}, senderName: null, senderBank: null,
    senderAccountMasked: null, receiverName: null, receiverBank: null, receiverAccountMasked: null, transferDate: null,
    transferTime: null, amount: null, merchantName: null, merchantTaxId: null, branch: null, receiptNumber: null,
    receiptDate: null, paymentMethod: null, draftVersion: 1, confirmedBy: null, confirmedAt: null,
    verificationStatus: null, warnings: [], lineItems: [],
  }
}

async function requiredPendingDraft(job: OcrQueueJob, payload: Record<string, unknown>, store: OcrLedgerStore, allowFailed = false): Promise<OcrDraft> {
  const documentId = requiredString(job.documentId, 'SHEET_WRITE_FAILED')
  const current = await getDraft(store, documentId)
  if (!current) throw workerError('SHEET_WRITE_FAILED')
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') return current
  if (!allowFailed && current.state !== 'PENDING_REVIEW') throw workerError('VERSION_CONFLICT')
  assertExpectedVersion(current, payload.expectedVersion)
  return current
}

function assertExpectedVersion(draft: OcrDraft, expected: unknown): void {
  if (!Number.isSafeInteger(expected) || expected !== draft.draftVersion) throw workerError('VERSION_CONFLICT')
}

async function pushDraft(line: OcrLinePort, groupId: string, draft: OcrDraft, config: OcrLedgerConfig, now: Date): Promise<void> {
  const message = draft.state === 'CONFIRMED' || draft.state === 'CANCELLED'
    ? buildFinalFlex(draft)
    : buildDraftFlex(draft, {
      groupId, reviewSigningSecret: config.reviewSigningSecret, liffUrl: `https://liff.line.me/${config.liffId}`,
      now: Math.floor(now.getTime() / 1000),
    })
  try { await line.push(groupId, [message]) } catch { throw workerError('LINE_SEND_FAILED') }
}

async function appendAudit(
  store: OcrLedgerStore,
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  action: 'EDIT' | 'CONFIRM' | 'CANCEL' | 'RETRY',
  draftVersion: number,
  now: Date,
): Promise<void> {
  try {
    await store.appendAudit({
      documentId: requiredString(job.documentId, 'SHEET_WRITE_FAILED'), action,
      actorLineUserId: requiredString(payload.actorLineUserId, 'VERSION_CONFLICT'),
      actorDisplayName: typeof payload.actorDisplayName === 'string' ? payload.actorDisplayName : null,
      createdAt: now.toISOString(), payloadJson: JSON.stringify({ jobId: job.jobId, draftVersion }),
    })
  } catch (error) {
    if (isWorkerError(error)) throw error
    throw workerError('SHEET_WRITE_FAILED')
  }
}

async function saveDraft(store: OcrLedgerStore, draft: OcrDraft): Promise<void> {
  try { await store.saveDraft(draft) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function getDraft(store: OcrLedgerStore, documentId: string): Promise<OcrDraft | null> {
  try { return await store.getDraft(documentId) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function findDuplicate(store: OcrLedgerStore, hash: string): Promise<OcrDraft | null> {
  try { return await store.findDraftByImageSha256(hash) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function getTerminalDecision(store: OcrLedgerStore, documentId: string): Promise<'CONFIRM' | 'CANCEL' | null> {
  try { return await store.getTerminalDecision(documentId) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function findOriginalIntake(store: OcrLedgerStore, documentId: string): Promise<OcrQueueJob | null> {
  try {
    return (await store.listJobs()).find((candidate) => candidate.jobType === 'INTAKE' && candidate.documentId === documentId) ?? null
  } catch {
    throw workerError('SHEET_WRITE_FAILED')
  }
}

async function updateJob(store: OcrLedgerStore, job: OcrQueueJob): Promise<void> {
  try { await store.updateJob(job) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function organizeSourceImage(
  drive: OcrDrivePort,
  rootId: string,
  fileId: string,
  receivedAtIso: string,
  documentType: OcrDraft['documentType'],
): Promise<void> {
  const receivedAt = new Date(receivedAtIso)
  if (Number.isNaN(receivedAt.getTime())) throw workerError('DRIVE_UPLOAD_FAILED')
  const [year, month] = bangkokDate(receivedAt).split('-')
  try {
    const yearFolder = await resolveDriveFolder(drive, year, rootId)
    const monthFolder = await resolveDriveFolder(drive, month, yearFolder)
    const typeFolder = await resolveDriveFolder(drive, documentType ?? 'UNCLASSIFIED', monthFolder)
    await drive.moveFile(fileId, typeFolder)
  } catch (error) {
    if (isWorkerError(error)) throw error
    throw workerError('DRIVE_UPLOAD_FAILED')
  }
}

async function resolveDriveFolder(drive: OcrDrivePort, name: string, parentId: string): Promise<string> {
  return await drive.findFolder(name, parentId) ?? await drive.createFolder(name, parentId)
}

function receivedAt(job: OcrQueueJob, payload: Record<string, unknown>): string {
  return typeof payload.receivedAt === 'string' ? payload.receivedAt : job.createdAt
}

function createDocumentId(now: Date): string {
  const date = bangkokDate(now).replaceAll('-', '')
  return `OCR-${date}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((result, part) => (part.type === 'year' || part.type === 'month' || part.type === 'day' ? { ...result, [part.type]: part.value } : result), {} as Record<string, string>)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch { /* sanitized below */ }
  throw workerError('OCR_INVALID_OUTPUT')
}

function requiredString(value: unknown, code: WorkerErrorCode): string {
  if (typeof value !== 'string' || value.length === 0) throw workerError(code)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function classifyError(error: unknown): WorkerErrorCode {
  if (isWorkerError(error)) return error.code
  if (error instanceof OcrExtractorError) return error.code === 'OCR_RATE_LIMIT' ? 'OCR_RATE_LIMIT' : 'OCR_INVALID_OUTPUT'
  if (isRecord(error) && error.code === 'OCR_RATE_LIMIT') return 'OCR_RATE_LIMIT'
  if (isRecord(error) && error.code === 'OCR_INVALID_OUTPUT') return 'OCR_INVALID_OUTPUT'
  return 'OCR_INVALID_OUTPUT'
}

function workerError(code: WorkerErrorCode): Error & { code: WorkerErrorCode } {
  return Object.assign(new Error(code), { code })
}

function isWorkerError(error: unknown): error is Error & { code: WorkerErrorCode } {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
}
