import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OcrQueueJob } from '../../src/apps/ocr-ledger/contracts.js'
import type { OcrLedgerConfig } from './config.js'
import type { OcrLedgerStore } from './googleStore.js'
import type { OcrLinePort } from './lineClient.js'
import { parseOcrLineEvents, type OcrLineEvent } from './lineEvents.js'
import { verifyLineSignature, verifyReviewToken } from './security.js'

const MAX_BODY_BYTES = 1024 * 1024

export function createOcrLedgerMiddleware(deps: {
  config: OcrLedgerConfig
  store: OcrLedgerStore
  line: OcrLinePort
  now: () => Date
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const rawBody = await readRawBody(req, MAX_BODY_BYTES)
      if (req.url?.split('?', 1)[0] === '/api/ocr-ledger/review') {
        await handleReviewPost(req, res, rawBody, deps)
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
        await deps.store.appendJob(queued)
        await deps.line.reply(event.replyToken, [{ type: 'text', text: acknowledgement(event) }])
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
    return queueJob('INTAKE', `line:image:${event.messageId}`, null, {
      messageId: event.messageId, groupId: event.groupId, userId: event.userId,
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

async function handleReviewPost(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string,
  deps: { config: OcrLedgerConfig; store: OcrLedgerStore; line: OcrLinePort; now: () => Date },
): Promise<void> {
  if (req.method !== 'POST') {
    respond(res, 405, { error: 'method_not_allowed' })
    return
  }
  const idToken = bearerToken(header(req, 'authorization'))
  const body = parseRecord(rawBody)
  if (!idToken || !body || typeof body.token !== 'string' || !isRecord(body.patch)) {
    respond(res, 401, { error: 'unauthorized' })
    return
  }
  try {
    const review = verifyReviewToken(body.token, deps.config.reviewSigningSecret, Math.floor(deps.now().getTime() / 1000))
    const actor = await deps.line.verifyLiffIdToken(idToken)
    if (review.action !== 'REVIEW' || review.groupId !== deps.config.allowedGroupId) throw new Error('Invalid review request')
    const editDigest = createHash('sha256')
      .update(JSON.stringify({ documentId: review.documentId, draftVersion: review.draftVersion, userId: actor.userId, patch: body.patch }))
      .digest('hex')
    const job = queueJob('EDIT', `liff:edit:${editDigest}`, review.documentId, {
      expectedVersion: review.draftVersion, actorLineUserId: actor.userId, actorDisplayName: actor.displayName,
      groupId: review.groupId, patch: body.patch,
    }, deps.now())
    await deps.store.appendJob(job)
    respond(res, 202, { accepted: true, jobId: job.jobId })
  } catch {
    respond(res, 401, { error: 'unauthorized' })
  }
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
