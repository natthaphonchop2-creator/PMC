import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OcrDraft, OcrQueueJob } from '../../src/apps/ocr-ledger/contracts.js'
import type { OcrLedgerConfig } from './config.js'
import { maskAccountIdentifier } from './domain.js'
import { parseOcrEditablePatch } from './editValidation.js'
import type { OcrDrivePort } from './googleClient.js'
import type { OcrLedgerStore } from './googleStore.js'
import type { OcrLinePort } from './lineClient.js'
import { parseOcrLineEvents, type OcrLineEvent } from './lineEvents.js'
import { verifyLineSignature, verifyReviewToken } from './security.js'

const MAX_BODY_BYTES = 1024 * 1024

export function createOcrLedgerMiddleware(deps: {
  config: OcrLedgerConfig
  store: OcrLedgerStore
  line: OcrLinePort
  drive: OcrDrivePort
  now: () => Date
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const rawBody = await readRawBody(req, MAX_BODY_BYTES)
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/api/ocr-ledger/client-config') {
        handleClientConfig(req, res, deps.config)
        return
      }
      if (url.pathname === '/api/ocr-ledger/review') {
        await handleReview(req, res, url, rawBody, deps)
        return
      }
      if (url.pathname === '/api/ocr-ledger/image') {
        await handleImage(req, res, url, deps)
        return
      }

      const signature = header(req, 'x-line-signature')
      if (!verifyLineSignature(rawBody, signature, deps.config.lineChannelSecret)) {
        respond(res, 401, { error: 'unauthorized' })
        return
      }

      const events = parseOcrLineEvents(rawBody, deps.config.allowedGroupId)
      const accepted = new Set<string>()
      for (const event of events) {
        const queued = queueJobFromLineEvent(event, deps.config, deps.now())
        if (!queued || accepted.has(queued.idempotencyKey)) continue
        accepted.add(queued.idempotencyKey)
        try { await deps.store.appendJob(queued) } catch {
          respond(res, 503, { error: 'storage_unavailable' })
          return
        }
        try {
          await deps.line.reply(event.replyToken, [{ type: 'text', text: acknowledgement(event) }])
        } catch {
          // The durable queue row is authoritative; LINE redelivery must not create pressure after it exists.
        }
      }
      respond(res, 200, { accepted: true })
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        respond(res, 413, { error: 'payload_too_large' })
        return
      }
      respond(res, 400, { error: 'invalid_request' })
    }
  }
}

function queueJobFromLineEvent(event: OcrLineEvent, config: OcrLedgerConfig, now: Date): OcrQueueJob | null {
  if (event.type === 'IMAGE') {
    return queueJob('INTAKE', `line:image:${event.messageId}`, createDocumentId(now), {
      messageId: event.messageId, groupId: event.groupId, userId: event.userId, receivedAt: now.toISOString(),
    }, now)
  }
  if (event.type === 'REPORT_COMMAND') {
    return queueJob('REPORT_COMMAND', `line:report:${event.eventId}`, null, {
      command: event.command, groupId: event.groupId, actorLineUserId: event.userId,
    }, now)
  }
  try {
    const token = verifyReviewToken(event.data, config.reviewSigningSecret, Math.floor(now.getTime() / 1000))
    if (token.groupId !== event.groupId || token.action === 'REVIEW') return null
    return queueJob(token.action, `line:postback:${event.eventId}`, token.documentId, {
      expectedVersion: token.draftVersion, actorLineUserId: event.userId, actorDisplayName: null, groupId: event.groupId,
    }, now)
  } catch {
    return null
  }
}

function createDocumentId(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((result, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') result[part.type] = part.value
    return result
  }, {} as Record<string, string>)
  return `OCR-${parts.year}${parts.month}${parts.day}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

async function handleReviewPost(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  rawBody: string,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; now: () => Date },
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405, { error: 'method_not_allowed' })
    return
  }
  const body = parseRecord(rawBody)
  const token = singleQueryToken(url)
  if (!body || !hasOnlyKeys(body, ['patch']) || !Object.hasOwn(body, 'patch') || !token) {
    respond(res, 400, { error: 'invalid_edit' })
    return
  }
  const authenticated = await authenticateReviewRequest(req, res, token, deps)
  if (!authenticated) {
    return
  }
  const current = await readAuthenticatedDraft(res, authenticated.review.documentId, authenticated.review.draftVersion, deps.store)
  if (!current) return
  const patch = parseClientEditPatch(body.patch, current)
  if (!patch) {
    respond(res, 400, { error: 'invalid_edit' })
    return
  }
  const editDigest = createHash('sha256')
    .update(JSON.stringify({ documentId: authenticated.review.documentId, draftVersion: authenticated.review.draftVersion, userId: authenticated.actor.userId, patch }))
    .digest('hex')
  const job = queueJob('EDIT', `liff:edit:${editDigest}`, authenticated.review.documentId, {
    expectedVersion: authenticated.review.draftVersion, actorLineUserId: authenticated.actor.userId, actorDisplayName: authenticated.actor.displayName,
    groupId: authenticated.review.groupId, patch,
  }, deps.now())
  try {
    const persisted = await deps.store.appendJob(job)
    respond(res, 202, { accepted: true, jobId: persisted.jobId })
  } catch {
    respond(res, 503, { error: 'storage_unavailable' })
  }
}

function handleClientConfig(req: IncomingMessage, res: ServerResponse, config: OcrLedgerConfig): void {
  if (req.method !== 'GET') {
    respond(res, 405, { error: 'method_not_allowed' })
    return
  }
  respond(res, 200, { liffId: config.liffId })
}

async function handleReview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  rawBody: string,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; now: () => Date },
): Promise<void> {
  if (req.method === 'POST') {
    await handleReviewPost(req, res, url, rawBody, deps)
    return
  }
  if (req.method !== 'GET') {
    respond(res, 405, { error: 'method_not_allowed' })
    return
  }
  const authenticated = await authenticateReviewRequest(req, res, singleQueryToken(url), deps)
  if (!authenticated) return
  const current = await readAuthenticatedDraft(res, authenticated.review.documentId, authenticated.review.draftVersion, deps.store)
  if (!current) return
  respond(res, 200, reviewProjection(current, url.searchParams.get('t')!))
}

async function handleImage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; drive: OcrDrivePort; now: () => Date },
): Promise<void> {
  if (req.method !== 'GET') {
    respond(res, 405, { error: 'method_not_allowed' })
    return
  }
  const authenticated = await authenticateReviewRequest(req, res, singleQueryToken(url), deps)
  if (!authenticated) return
  const current = await readAuthenticatedDraft(res, authenticated.review.documentId, authenticated.review.draftVersion, deps.store)
  if (!current) return
  if (!current.sourceImageFileId) {
    respond(res, 404, { error: 'image_not_found' })
    return
  }
  try {
    const image = await deps.drive.downloadImage(current.sourceImageFileId)
    res.statusCode = 200
    res.setHeader('content-type', image.mimeType)
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(image.bytes)
  } catch {
    respond(res, 503, { error: 'image_unavailable' })
  }
}

async function authenticateReviewRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | null,
  deps: { config: OcrLedgerConfig; line: OcrLinePort; now: () => Date },
): Promise<{ review: ReturnType<typeof verifyReviewToken>; actor: { userId: string; displayName: string } } | null> {
  const idToken = bearerToken(header(req, 'authorization'))
  if (!token || !idToken) {
    respond(res, 401, { error: 'unauthorized' })
    return null
  }
  try {
    const review = verifyReviewToken(token, deps.config.reviewSigningSecret, Math.floor(deps.now().getTime() / 1000))
    if (review.action !== 'REVIEW' || review.groupId !== deps.config.allowedGroupId) throw new Error('Invalid review request')
    const verified = await deps.line.verifyLiffIdToken(idToken)
    const member = await deps.line.assertGroupMember(review.groupId, verified.userId)
    return { review, actor: { userId: verified.userId, displayName: member.displayName } }
  } catch {
    respond(res, 401, { error: 'unauthorized' })
    return null
  }
}

function singleQueryToken(url: URL): string | null {
  const tokens = url.searchParams.getAll('t')
  return tokens.length === 1 && tokens[0]!.trim().length > 0 ? tokens[0]! : null
}

async function readAuthenticatedDraft(
  res: ServerResponse,
  documentId: string,
  expectedVersion: number,
  store: OcrLedgerStore,
) {
  try {
    const current = await store.getDraft(documentId)
    if (!current) {
      respond(res, 404, { error: 'draft_not_found' })
      return null
    }
    if (current.draftVersion !== expectedVersion) {
      respond(res, 409, { error: 'stale_draft' })
      return null
    }
    return current
  } catch {
    respond(res, 503, { error: 'storage_unavailable' })
    return null
  }
}

function reviewProjection(draft: OcrDraft, token: string) {
  return {
    documentId: draft.documentId, state: draft.state, draftVersion: draft.draftVersion,
    imageUrl: `/api/ocr-ledger/image?t=${encodeURIComponent(token)}`,
    documentType: draft.documentType, direction: draft.direction, documentDate: draft.documentDate, documentTime: draft.documentTime,
    counterpartyName: draft.counterpartyName, currency: draft.currency, subtotal: draft.subtotal, discountAmount: draft.discountAmount,
    taxAmount: draft.taxAmount, serviceCharge: draft.serviceCharge, grandTotal: draft.grandTotal, referenceNumber: draft.referenceNumber,
    categoryId: draft.categoryId, note: draft.note,
    senderName: draft.senderName, senderBank: draft.senderBank, senderAccountMasked: maskAccountIdentifier(draft.senderAccountMasked),
    receiverName: draft.receiverName, receiverBank: draft.receiverBank, receiverAccountMasked: maskAccountIdentifier(draft.receiverAccountMasked),
    transferDate: draft.transferDate, transferTime: draft.transferTime, amount: draft.amount,
    merchantName: draft.merchantName, merchantTaxId: draft.merchantTaxId, branch: draft.branch,
    receiptNumber: draft.receiptNumber, receiptDate: draft.receiptDate, paymentMethod: draft.paymentMethod,
    lineItems: draft.lineItems.map(({ lineNumber, description, quantity, unit, unitPrice, discountAmount, taxAmount, lineTotal, categoryId }) => ({
      lineNumber, description, quantity, unit, unitPrice, discountAmount, taxAmount, lineTotal, categoryId,
    })),
    warnings: draft.warnings,
  }
}

function parseClientEditPatch(value: unknown, current: OcrDraft) {
  if (!isRecord(value) || Object.hasOwn(value, 'confidence') || !Array.isArray(value.lineItems)
    || value.lineItems.some((line) => isRecord(line) && Object.hasOwn(line, 'confidence'))) return null
  const confidenceByLine = new Map(current.lineItems.map((line) => [line.lineNumber, line.confidence]))
  const hydrated = {
    ...value,
    lineItems: value.lineItems.map((line) => isRecord(line)
      ? { ...line, confidence: typeof line.lineNumber === 'number' ? confidenceByLine.get(line.lineNumber) ?? null : null }
      : line),
  }
  return parseOcrEditablePatch(hydrated)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function queueJob(jobType: OcrQueueJob['jobType'], idempotencyKey: string, documentId: string | null, payload: unknown, now: Date): OcrQueueJob {
  const timestamp = now.toISOString()
  return {
    jobId: `job-${randomUUID()}`, jobType, documentId, idempotencyKey, payloadJson: JSON.stringify(payload), state: 'QUEUED',
    attempts: 0, availableAt: timestamp, leaseUntil: null, lastErrorCode: null, createdAt: timestamp, updatedAt: timestamp,
  }
}

function acknowledgement(event: OcrLineEvent): string {
  if (event.type === 'IMAGE') return 'รับรูปแล้ว กำลังจัดคิวตรวจเอกสาร'
  if (event.type === 'REPORT_COMMAND') return 'รับคำสั่งรายงานแล้ว'
  return 'รับคำสั่งแล้ว'
}

async function readRawBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > limit) throw new BodyTooLargeError()
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function bearerToken(value: string): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(value)
  return match?.[1] ?? null
}

function parseRecord(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function respond(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

class BodyTooLargeError extends Error {}
