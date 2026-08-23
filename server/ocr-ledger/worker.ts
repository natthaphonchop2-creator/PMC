import { createHash, randomUUID } from 'node:crypto'
import type { OcrDocument, OcrDraft, OcrExtraction, OcrQueueJob, OcrTerminalDecisionRecord } from '../../src/apps/ocr-ledger/contracts.js'
import type { OcrLedgerConfig } from './config.js'
import { assertConfirmableDraft, bangkokMonthKey } from './domain.js'
import { parseOcrEditablePatch } from './editValidation.js'
import { buildDraftFlex, buildFinalFlex, buildPendingReportMessage, buildReportMessage } from './flexMessages.js'
import type { OcrDrivePort } from './googleClient.js'
import type { OcrLedgerStore } from './googleStore.js'
import { prepareOcrImage } from './imageProcessing.js'
import type { OcrLinePort } from './lineClient.js'
import { OcrExtractorError, type OcrExtractorPort } from './openAiExtractor.js'
import { aggregateOcrReport, dailyReportIdempotencyKey, documentIsInWindow, logicalLineRetryKey, operationalEvidenceIsInWindow, reportWindow, shouldSendDailyReport, type OcrReportCommand } from './reports.js'
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
          const reportSent = await processJob(job, deps)
          result.reportSent ||= reportSent
          await updateJob(deps.store, { ...job, state: 'DONE', leaseUntil: null, lastErrorCode: null, updatedAt: deps.now().toISOString() })
          result.succeeded += 1
        } catch (error) {
          result.failed += 1
          await handleFailure(job, classifyError(error), deps)
        }
      }
      try { await deps.store.refreshDerivedSurfaces(deps.now().toISOString()) } catch { /* derived views retry on the next run */ }
      const dailyReportSent = await sendScheduledDailyReport(deps)
      result.reportSent ||= dailyReportSent
      return result
    },
  }
}

async function processJob(
  job: OcrQueueJob,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<boolean> {
  const payload = parsePayload(job.payloadJson)
  const delivery = parseDeliveryCheckpoint(payload.delivery, deps.config.allowedGroupId)
  if (delivery) {
    await pushLineDelivery(deps.line, delivery)
    return delivery.report
  }
  if (typeof payload.deliveryDocumentId === 'string' && typeof payload.groupId === 'string') {
    const saved = await getDraft(deps.store, payload.deliveryDocumentId)
    if (!saved) throw workerError('SHEET_WRITE_FAILED')
    await pushDraft(job, payload, payload.groupId, saved, deps)
    return false
  }
  if (job.jobType === 'INTAKE') { await processIntake(job, payload, deps); return false }
  if (job.jobType === 'EDIT') { await processEdit(job, payload, deps); return false }
  if (job.jobType === 'CONFIRM' || job.jobType === 'CANCEL') { await processTerminalAction(job, payload, deps); return false }
  if (job.jobType === 'RETRY') { await processRetry(job, payload, deps); return false }
  if (job.jobType === 'REPORT_COMMAND') {
    await sendReport(job, payload, requiredReportCommand(payload.command), requiredString(payload.groupId, 'LINE_SEND_FAILED'), deps)
    return true
  }
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
  const documentId = requiredString(job.documentId, 'SHEET_WRITE_FAILED')

  let source: { bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }
  if (typeof payload.sourceImageFileId === 'string') {
    try { source = await deps.drive.downloadImage(payload.sourceImageFileId) } catch { throw workerError('DRIVE_UPLOAD_FAILED') }
  } else {
    let staged: Awaited<ReturnType<OcrDrivePort['findImageByDocumentId']>>
    try { staged = await deps.drive.findImageByDocumentId(documentId, deps.config.driveRootId) } catch { throw workerError('DRIVE_UPLOAD_FAILED') }
    if (staged) {
      payload.sourceImageFileId = staged.fileId
      payload.sourceImageName = staged.name
      payload.sourceImageMimeType = staged.mimeType
      try { source = await deps.drive.downloadImage(staged.fileId) } catch { throw workerError('DRIVE_UPLOAD_FAILED') }
      if (source.mimeType !== staged.mimeType) throw workerError('DRIVE_UPLOAD_FAILED')
    } else {
      try { source = await deps.line.downloadImage(messageId) } catch { throw workerError('LINE_DOWNLOAD_FAILED') }
      const sourceImageName = `${documentId}.${source.mimeType === 'image/png' ? 'png' : 'jpg'}`
      try {
        payload.sourceImageFileId = await deps.drive.uploadImage({
          documentId, name: sourceImageName, parentId: deps.config.driveRootId, mimeType: source.mimeType, bytes: source.bytes,
        })
        payload.sourceImageName = sourceImageName
        payload.sourceImageMimeType = source.mimeType
      } catch {
        throw workerError('DRIVE_UPLOAD_FAILED')
      }
    }
  }

  const sourceImageSha256 = createHash('sha256').update(source.bytes).digest('hex')
  if (typeof payload.sourceImageSha256 === 'string' && payload.sourceImageSha256 !== sourceImageSha256) throw workerError('SHEET_WRITE_FAILED')
  payload.sourceImageSha256 = sourceImageSha256
  payload.sourceImageName ??= `${documentId}.${source.mimeType === 'image/png' ? 'png' : 'jpg'}`
  payload.sourceImageMimeType = source.mimeType
  await checkpointJob(deps.store, job, payload)

  let prepared
  try { prepared = await prepareOcrImage(source.bytes, deps.config.maxImageBytes) } catch { throw workerError('UNSUPPORTED_IMAGE') }
  if (prepared.originalSha256 !== sourceImageSha256) throw workerError('SHEET_WRITE_FAILED')
  payload.sourceImageSha256 = prepared.originalSha256
  job.payloadJson = JSON.stringify(payload)
  const duplicate = await findDuplicate(deps.store, prepared.originalSha256)
  if (duplicate) {
    await organizeSourceImage(deps.drive, deps.config.driveRootId, String(payload.sourceImageFileId), receivedAt(job, payload), duplicate.documentType)
    payload.duplicateOfDocumentId = duplicate.documentId
    payload.deliveryDocumentId = duplicate.documentId
    job.payloadJson = JSON.stringify(payload)
    await checkpointJob(deps.store, job, payload)
    await pushDraft(job, payload, groupId, duplicate, deps)
    return
  }

  const extraction = await deps.extractor.extract(prepared)
  if (payload.sourceOrganized !== true) {
    await organizeSourceImage(deps.drive, deps.config.driveRootId, String(payload.sourceImageFileId), receivedAt(job, payload), extraction.documentType)
    payload.sourceOrganized = true
    job.payloadJson = JSON.stringify(payload)
  }
  const saved = draftFromExtraction(documentId, extraction, {
    sourceImageFileId: String(payload.sourceImageFileId), sourceImageSha256: prepared.originalSha256,
    sourceLineMessageId: messageId, sourceLineUserId: userId,
  })
  await saveDraft(deps.store, saved)
  payload.deliveryDocumentId = saved.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(job, payload, groupId, saved, deps)
}

async function processEdit(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  const current = await requiredPendingDraft(job, payload, deps.store)
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') {
    await pushDraft(job, payload, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps)
    return
  }
  if (await getTerminalDecision(deps.store, current.documentId)) {
    await pushDraft(job, payload, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps)
    return
  }
  const patch = parseOcrEditablePatch(payload.patch)
  if (!patch) throw workerError('OCR_INVALID_OUTPUT')
  const revised: OcrDraft = { ...current, ...patch, draftVersion: current.draftVersion + 1 }
  await appendAudit(deps.store, job, payload, 'EDIT', revised.draftVersion, deps.now())
  await saveDraft(deps.store, revised)
  payload.deliveryDocumentId = revised.documentId
  job.payloadJson = JSON.stringify(payload)
  await pushDraft(job, payload, requiredString(payload.groupId, 'LINE_SEND_FAILED'), revised, deps)
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
    await pushDraft(job, payload, groupId, current, deps)
    return
  }
  const actor = requiredString(payload.actorLineUserId, 'VERSION_CONFLICT')
  const requestedDecision = job.jobType === 'CONFIRM' ? 'CONFIRM' : 'CANCEL'
  const existingDecision = await getTerminalDecision(deps.store, documentId)
  if (existingDecision && existingDecision.decision !== requestedDecision) {
    await pushDraft(job, payload, groupId, current, deps)
    return
  }
  let record = existingDecision
  if (!record) {
    assertExpectedVersion(current, payload.expectedVersion)
    if (requestedDecision === 'CONFIRM') {
      try {
        assertConfirmableDraft(current)
      } catch {
        await pushReviewRequired(job, payload, groupId, deps)
        return
      }
    }
    let displayName: string
    try {
      displayName = (await deps.line.assertGroupMember(groupId, actor)).displayName
    } catch {
      throw workerError('LINE_SEND_FAILED')
    }
    const requestedRecord: OcrTerminalDecisionRecord = {
      documentId,
      decision: requestedDecision,
      actorLineUserId: actor,
      actorDisplayName: displayName,
      decidedAt: deps.now().toISOString(),
      sourceJobId: job.jobId,
      expectedVersion: current.draftVersion,
    }
    try {
      record = (await deps.store.claimTerminalDecision(requestedRecord)).record
    } catch {
      throw workerError('SHEET_WRITE_FAILED')
    }
  }
  if (record.decision !== requestedDecision) {
    await pushDraft(job, payload, groupId, current, deps)
    return
  }
  await repairTerminalDecision(job, payload, record, current, groupId, deps)
}

async function repairTerminalDecision(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  record: OcrTerminalDecisionRecord,
  current: OcrDraft,
  groupId: string,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  if (current.draftVersion !== record.expectedVersion) throw workerError('SHEET_WRITE_FAILED')
  const next: OcrDraft = record.decision === 'CONFIRM'
    ? { ...current, state: 'CONFIRMED', confirmedBy: record.actorDisplayName, confirmedAt: record.decidedAt, verificationStatus: 'STAFF_CONFIRMED' }
    : { ...current, state: 'CANCELLED' }
  if (record.decision === 'CONFIRM') {
    const month = bangkokMonthKey(next.documentDate ?? record.decidedAt)
    let ledger
    try { ledger = await deps.store.ensureMonthlyLedger(month) } catch { throw workerError('SHEET_WRITE_FAILED') }
    try { await deps.store.finalizeDocument(next, ledger) } catch { throw workerError('SHEET_WRITE_FAILED') }
  }
  await saveDraft(deps.store, next)
  await pushDraft(job, payload, groupId, next, deps)
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
    if (!original) throw workerError('SHEET_WRITE_FAILED')
    const originalPayload = parsePayload(original.payloadJson)
    originalPayload.receivedAt = original.createdAt
    await processIntake(job, originalPayload, deps)
    return
  }
  if (current.state === 'CONFIRMED' || current.state === 'CANCELLED') {
    await pushDraft(job, payload, requiredString(payload.groupId, 'LINE_SEND_FAILED'), current, deps)
    return
  }
  const terminalDecision = await getTerminalDecision(deps.store, current.documentId)
  if (terminalDecision) {
    await repairTerminalDecision(job, payload, terminalDecision, current, requiredString(payload.groupId, 'LINE_SEND_FAILED'), deps)
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
  await pushDraft(job, payload, requiredString(payload.groupId, 'LINE_SEND_FAILED'), revised, deps)
}

async function sendScheduledDailyReport(
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<boolean> {
  const now = deps.now()
  const settings = await readReportSettings(deps.store, deps.config)
  let jobs: OcrQueueJob[]
  try { jobs = await deps.store.listJobs() } catch { throw workerError('SHEET_WRITE_FAILED') }
  const sentKeys = new Set(jobs.filter((job) => job.state === 'DONE').map((job) => job.idempotencyKey))
  const [hour, minute] = settings.dailyReportTime.split(':').map(Number)
  if (!shouldSendDailyReport({ enabled: settings.dailyReportEnabled, groupId: deps.config.allowedGroupId, now, sentKeys, hour, minute })) return false
  const date = reportWindow('TODAY', now).start!
  const idempotencyKey = dailyReportIdempotencyKey(deps.config.allowedGroupId, date)

  const pendingMarker: OcrQueueJob = {
    jobId: `report-${randomUUID()}`, jobType: 'REPORT_COMMAND', documentId: null,
    idempotencyKey,
    payloadJson: JSON.stringify({ command: 'TODAY', groupId: deps.config.allowedGroupId, scheduled: true }),
    state: 'QUEUED', attempts: 0, availableAt: now.toISOString(), leaseUntil: null, lastErrorCode: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }
  let marker: OcrQueueJob
  try { marker = await deps.store.appendJob(pendingMarker) } catch { throw workerError('SHEET_WRITE_FAILED') }
  const payload = parsePayload(marker.payloadJson)
  const persistedDelivery = parseDeliveryCheckpoint(payload.delivery, deps.config.allowedGroupId)
  if (persistedDelivery) {
    try { await pushLineDelivery(deps.line, persistedDelivery) } catch (error) {
      if (isWorkerError(error)) return false
      throw error
    }
    await updateJob(deps.store, {
      ...marker, state: 'DONE', leaseUntil: null, lastErrorCode: null, updatedAt: deps.now().toISOString(),
    })
    return persistedDelivery.report
  }
  try {
    await sendReport(marker, payload, 'TODAY', deps.config.allowedGroupId, deps)
  } catch (error) {
    if (isWorkerError(error)) return false
    throw error
  }
  await updateJob(deps.store, {
    ...marker, payloadJson: JSON.stringify(payload), state: 'DONE', leaseUntil: null, lastErrorCode: null, updatedAt: deps.now().toISOString(),
  })
  return true
}

async function sendReport(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  command: OcrReportCommand,
  groupId: string,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; extractor: OcrExtractorPort; now: () => Date },
): Promise<void> {
  const now = new Date(job.createdAt)
  const settings = await readReportSettings(deps.store, deps.config)
  let message: ReturnType<typeof buildReportMessage> | ReturnType<typeof buildPendingReportMessage> | { type: 'text'; text: string }
  if (command === 'PENDING') {
    const pending = await pendingDrafts(deps.store)
    message = buildPendingReportMessage({
      title: 'รายการรอตรวจสอบ', totalPending: pending.length,
      entries: pending.slice(0, 10).map(({ draft }) => ({
        label: draft.documentId,
        value: pendingDescription(draft),
        reviewUri: reviewUrl(draft, groupId, deps.config, now),
      })), dashboardUrl: settings.dashboardUrl,
    })
  } else if (command === 'ERRORS') {
    const errors = await failedJobs(deps.store)
    message = buildReportMessage({
      title: 'รายการที่ต้องตรวจสอบข้อผิดพลาด',
      entries: errors.length === 0
        ? [{ label: 'ไม่พบรายการผิดพลาด' }]
        : errors.slice(0, 10).map((job) => ({ label: job.documentId ?? job.jobId, value: job.lastErrorCode ?? 'UNKNOWN' })),
      dashboardUrl: settings.dashboardUrl,
    })
  } else {
    const window = reportWindow(command, now)
    const confirmed = await confirmedDocumentsForWindow(deps.store, window)
    const operational = await operationalEvidence(deps.store)
    const report = aggregateOcrReport(confirmed, operational.filter((evidence) => operationalEvidenceIsInWindow(evidence, window)))
    message = report.operational.confirmed === 0
      ? { type: 'text', text: noActivityText(report, settings.dashboardUrl) }
      : buildReportMessage({ title: reportTitle(command), entries: reportEntries(report), dashboardUrl: settings.dashboardUrl })
  }
  await deliverMessages(job, payload, groupId, [message], `report:${job.idempotencyKey}:${command}`, true, deps.store, deps.line)
}

async function confirmedDocumentsForWindow(store: OcrLedgerStore, window: ReturnType<typeof reportWindow>): Promise<OcrDocument[]> {
  if (!window.start || !window.endExclusive) return []
  const months = calendarMonths(window.start, window.endExclusive)
  const documents: OcrDocument[] = []
  try {
    for (const month of months) {
      const ledger = await store.ensureMonthlyLedger(month)
      documents.push(...await store.listConfirmedDocuments(ledger.monthlySpreadsheetId))
    }
  } catch { throw workerError('SHEET_WRITE_FAILED') }
  return documents.filter((document) => documentIsInWindow(document, window))
}

async function operationalEvidence(store: OcrLedgerStore) {
  try { return await store.listOperationalEvidence() } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function readReportSettings(store: OcrLedgerStore, config: OcrLedgerConfig) {
  try {
    return await store.readReportSettings({
      dailyReportEnabled: config.dailyReportEnabled,
      dailyReportTime: config.dailyReportTime,
      dashboardUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.masterSpreadsheetId)}/edit#gid=0`,
    })
  } catch {
    throw workerError('SHEET_WRITE_FAILED')
  }
}

async function pendingDrafts(store: OcrLedgerStore): Promise<Array<{ draft: OcrDraft; createdAt: string }>> {
  let jobs: OcrQueueJob[]
  try { jobs = await store.listJobs() } catch { throw workerError('SHEET_WRITE_FAILED') }
  const intakeCreatedAt = new Map<string, string>()
  for (const job of jobs) if (job.documentId && !intakeCreatedAt.has(job.documentId)) intakeCreatedAt.set(job.documentId, job.createdAt)
  const drafts = await Promise.all([...intakeCreatedAt.keys()].map(async (documentId) => ({ draft: await getDraft(store, documentId), createdAt: intakeCreatedAt.get(documentId)! })))
  return drafts
    .filter((entry): entry is { draft: OcrDraft; createdAt: string } => entry.draft !== null && (entry.draft.state === 'PENDING_REVIEW' || entry.draft.state === 'RETRY_PENDING'))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.draft.documentId.localeCompare(right.draft.documentId))
}

async function failedJobs(store: OcrLedgerStore): Promise<OcrQueueJob[]> {
  try {
    return (await store.listJobs())
      .filter((job) => job.state === 'FAILED')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.jobId.localeCompare(right.jobId))
  } catch { throw workerError('SHEET_WRITE_FAILED') }
}

function requiredReportCommand(value: unknown): OcrReportCommand {
  if (value === 'TODAY' || value === 'YESTERDAY' || value === 'MONTH' || value === 'PENDING' || value === 'ERRORS') return value
  throw workerError('OCR_INVALID_OUTPUT')
}

function calendarMonths(start: string, endExclusive: string): string[] {
  const months: string[] = []
  let cursor = `${start.slice(0, 7)}-01`
  while (cursor < endExclusive) {
    months.push(cursor.slice(0, 7))
    const [year, month] = cursor.slice(0, 7).split('-').map(Number)
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  }
  return months
}

function reportTitle(command: Extract<OcrReportCommand, 'TODAY' | 'YESTERDAY' | 'MONTH'>): string {
  if (command === 'TODAY') return 'สรุปวันนี้'
  if (command === 'YESTERDAY') return 'สรุปเมื่อวาน'
  return 'สรุปเดือนนี้'
}

function reportEntries(report: ReturnType<typeof aggregateOcrReport>): Array<{ label: string; value?: string }> {
  const financial = report.operational.confirmed === 0
    ? [{ label: 'ยังไม่มีรายการยืนยันในช่วงนี้' }]
    : [
      { label: 'รายรับ', value: money(report.income) }, { label: 'รายจ่าย', value: money(report.expense) },
      { label: 'คงเหลือสุทธิ', value: money(report.net) }, { label: 'ภาษี', value: money(report.tax) },
      ...report.categories.slice(0, 5).map((category) => ({ label: `หมวด ${category.categoryId}`, value: money(category.amount) })),
    ]
  return [
    ...financial,
    { label: 'รอตรวจสอบ', value: String(report.operational.pending) },
    { label: 'ผิดพลาด', value: String(report.operational.failed) },
    { label: 'รายการซ้ำ', value: String(report.operational.duplicateWarnings) },
    { label: 'ยกเลิก', value: String(report.operational.cancelled) },
  ]
}

function noActivityText(report: ReturnType<typeof aggregateOcrReport>, dashboardUrl: string): string {
  const operational = [
    report.operational.pending > 0 ? `รอตรวจสอบ ${report.operational.pending}` : null,
    report.operational.failed > 0 ? `ผิดพลาด ${report.operational.failed}` : null,
    report.operational.duplicateWarnings > 0 ? `รายการซ้ำ ${report.operational.duplicateWarnings}` : null,
  ].filter((value): value is string => value !== null)
  const suffix = operational.length > 0 ? ` · ${operational.join(' · ')}` : ''
  return `ยังไม่มีรายการยืนยันในช่วงนี้${suffix}\nเปิด Dashboard: ${dashboardUrl}`
}

function pendingDescription(draft: OcrDraft): string {
  const date = draft.documentDate ?? draft.transferDate ?? draft.receiptDate ?? 'ไม่ระบุวันที่'
  const amount = draft.grandTotal ?? draft.amount
  return amount === null ? date : `${date} · ${money(amount)}`
}

function reviewUrl(draft: OcrDraft, groupId: string, config: OcrLedgerConfig, now: Date): string {
  const token = signReviewToken({
    v: 1, documentId: draft.documentId, groupId, draftVersion: draft.draftVersion,
    action: 'REVIEW', exp: Math.floor(now.getTime() / 1000) + 24 * 60 * 60,
  }, config.reviewSigningSecret)
  const url = new URL(`https://liff.line.me/${config.liffId}`)
  url.searchParams.set('token', token)
  return url.toString()
}

function money(value: number): string {
  return `฿${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
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
    exp: Math.floor(new Date(job.createdAt).getTime() / 1000) + 24 * 60 * 60,
  }, deps.config.reviewSigningSecret)
  await deliverMessages(job, payload, payload.groupId, [{
    type: 'flex', altText: 'อ่านเอกสารไม่สำเร็จ', contents: {
      type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'อ่านเอกสารไม่สำเร็จ กรุณาลองใหม่', wrap: true }] },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'postback', label: 'ลองอ่านใหม่', data } }] },
    },
  }], `${job.documentId}:error:${job.jobId}:${job.lastErrorCode ?? 'UNKNOWN'}`, false, deps.store, deps.line)
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
    senderName: extraction.senderName, senderBank: extraction.senderBank, senderAccountMasked: extraction.senderAccountMasked,
    receiverName: extraction.receiverName, receiverBank: extraction.receiverBank, receiverAccountMasked: extraction.receiverAccountMasked,
    transferDate: extraction.transferDate, transferTime: extraction.transferTime, amount: extraction.amount,
    merchantName: extraction.merchantName, merchantTaxId: extraction.merchantTaxId, branch: extraction.branch,
    receiptNumber: extraction.receiptNumber, receiptDate: extraction.receiptDate, paymentMethod: extraction.paymentMethod,
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

async function pushDraft(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  groupId: string,
  draft: OcrDraft,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort },
): Promise<void> {
  const message = draft.state === 'CONFIRMED' || draft.state === 'CANCELLED'
    ? buildFinalFlex(draft)
    : buildDraftFlex(draft, {
      groupId, reviewSigningSecret: deps.config.reviewSigningSecret, liffUrl: `https://liff.line.me/${deps.config.liffId}`,
      now: Math.floor(new Date(job.createdAt).getTime() / 1000),
    })
  const logicalKey = draft.state === 'CONFIRMED' || draft.state === 'CANCELLED'
    ? `${draft.documentId}:final:${draft.state}`
    : `${draft.documentId}:flex:${draft.draftVersion}`
  await deliverMessages(job, payload, groupId, [message], logicalKey, false, deps.store, deps.line)
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

async function getTerminalDecision(store: OcrLedgerStore, documentId: string): Promise<OcrTerminalDecisionRecord | null> {
  try { return await store.getTerminalDecision(documentId) } catch { throw workerError('SHEET_WRITE_FAILED') }
}

async function pushReviewRequired(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  groupId: string,
  deps: { store: OcrLedgerStore; line: OcrLinePort },
): Promise<void> {
  await deliverMessages(
    job, payload, groupId,
    [{ type: 'text', text: 'ยังบันทึกไม่ได้ กรุณาตรวจสอบข้อมูลที่จำเป็นแล้วลองอีกครั้ง' }],
    `${job.documentId}:review-required:${payload.expectedVersion ?? 'unknown'}`, false, deps.store, deps.line,
  )
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

async function checkpointJob(store: OcrLedgerStore, job: OcrQueueJob, payload: Record<string, unknown>): Promise<void> {
  job.payloadJson = JSON.stringify(payload)
  await updateJob(store, job)
}

interface LineDeliveryCheckpoint {
  to: string
  messages: unknown[]
  retryKey: string
  report: boolean
}

async function deliverMessages(
  job: OcrQueueJob,
  payload: Record<string, unknown>,
  to: string,
  messages: unknown[],
  logicalKey: string,
  report: boolean,
  store: OcrLedgerStore,
  line: OcrLinePort,
): Promise<void> {
  await checkpointJob(store, job, payload)
  const requestedDelivery: LineDeliveryCheckpoint = {
    to,
    messages: structuredClone(messages),
    retryKey: logicalLineRetryKey(logicalKey),
    report,
  }
  const deliveryJob: OcrQueueJob = {
    jobId: `delivery-${randomUUID()}`,
    jobType: 'REPORT_COMMAND',
    documentId: job.documentId,
    idempotencyKey: `line-delivery:${logicalKey}`,
    payloadJson: JSON.stringify({ delivery: requestedDelivery }),
    state: 'QUEUED',
    attempts: 0,
    availableAt: job.updatedAt,
    leaseUntil: null,
    lastErrorCode: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
  let persistedJob: OcrQueueJob
  try { persistedJob = await store.appendJob(deliveryJob) } catch { throw workerError('SHEET_WRITE_FAILED') }
  const createdNewDelivery = persistedJob.jobId === deliveryJob.jobId
  const delivery = parseDeliveryCheckpoint(parsePayload(persistedJob.payloadJson).delivery, to)
  if (!delivery) throw workerError('SHEET_WRITE_FAILED')
  if (persistedJob.state === 'DONE' || !createdNewDelivery) return
  await pushLineDelivery(line, delivery)
  await updateJob(store, {
    ...persistedJob, state: 'DONE', leaseUntil: null, lastErrorCode: null, updatedAt: job.updatedAt,
  })
}

function parseDeliveryCheckpoint(value: unknown, allowedGroupId: string): LineDeliveryCheckpoint | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)
    || value.to !== allowedGroupId
    || !Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 5
    || typeof value.retryKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.retryKey)
    || typeof value.report !== 'boolean'
    || JSON.stringify(value.messages).length > 50_000) {
    throw workerError('OCR_INVALID_OUTPUT')
  }
  return { to: value.to, messages: structuredClone(value.messages), retryKey: value.retryKey, report: value.report }
}

async function pushLineDelivery(line: OcrLinePort, delivery: LineDeliveryCheckpoint): Promise<void> {
  try {
    await line.push(delivery.to, delivery.messages, delivery.retryKey)
  } catch {
    throw workerError('LINE_SEND_FAILED')
  }
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
