import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  canonicalMiniAppEvidenceIngress,
  type MiniAppEvidenceIngressEnvelope,
  type MiniAppEvidenceIngressKind,
  type MiniAppEvidenceIngressMime,
  type UnsignedMiniAppEvidenceIngressEnvelope,
} from '../../shared/pmcMiniAppEvidence.js'

const MAX_EVIDENCE_BYTES = 10_000_000

export interface EvidenceIngressUploadInput {
  draftId: string
  requestId: string
  kind: MiniAppEvidenceIngressKind
  mimeType: MiniAppEvidenceIngressMime
  bytes: Buffer
}

interface IngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type IngressFetch = (
  url: string,
  init: { method: 'POST'; headers: { 'content-type': string }; body: string; signal: AbortSignal },
) => Promise<IngressResponse>

export interface EvidenceIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export class EvidenceIngressClientError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'EvidenceIngressClientError'
    this.code = code
  }
}

export function buildMiniAppEvidenceIngress(
  input: EvidenceIngressUploadInput,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppEvidenceIngressEnvelope; headers: { 'content-type': 'application/json' } } {
  if (!safeId(input.draftId) || !safeId(input.requestId) || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new EvidenceIngressClientError('EVIDENCE_INGRESS_INVALID_INPUT')
  }
  if (input.bytes.length > MAX_EVIDENCE_BYTES) throw new EvidenceIngressClientError('EVIDENCE_TOO_LARGE')
  if (!Number.isSafeInteger(context.timestamp) || context.timestamp <= 0 || !safeNonce(context.nonce) || !secret) {
    throw new EvidenceIngressClientError('EVIDENCE_INGRESS_INVALID_INPUT')
  }
  const bytesBase64 = input.bytes.toString('base64')
  const contentSha256 = createHash('sha256').update(bytesBase64, 'utf8').digest('hex')
  const uploadId = createHash('sha256')
    .update(`${input.draftId}\0${input.kind}\0${contentSha256}`, 'utf8')
    .digest('hex')
  const extension = input.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const fileName = `${input.kind.toLowerCase()}-${uploadId}.${extension}`
  const unsigned: UnsignedMiniAppEvidenceIngressEnvelope = {
    kind: 'MINI_APP_EVIDENCE',
    version: 1,
    timestamp: context.timestamp,
    nonce: context.nonce,
    payload: {
      draftId: input.draftId,
      requestId: input.requestId,
      evidenceKind: input.kind,
      uploadId,
      fileName,
      mimeType: input.mimeType,
      bytesBase64,
      contentSha256,
    },
  }
  const signature = createHmac('sha256', secret)
    .update(canonicalMiniAppEvidenceIngress(unsigned), 'utf8')
    .digest('hex')
  return { body: { ...unsigned, signature }, headers: { 'content-type': 'application/json' } }
}

export function createEvidenceIngressClient(options: EvidenceIngressClientOptions): {
  upload(input: EvidenceIngressUploadInput): Promise<string>
} {
  const url = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (!url || !secret || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || !request) {
    throw new Error('Invalid evidence ingress client configuration')
  }

  return {
    async upload(input) {
      const built = buildMiniAppEvidenceIngress(input, { timestamp: now(), nonce: nonce() }, secret)
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const response = await request(url, {
          method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: controller.signal,
        })
        if (!response.ok) throw new EvidenceIngressClientError('EVIDENCE_INGRESS_FAILED')
        let body: unknown
        try { body = await response.json() } catch { throw new EvidenceIngressClientError('EVIDENCE_INGRESS_INVALID_RESPONSE') }
        if (!isIngressResult(body)) throw new EvidenceIngressClientError('EVIDENCE_INGRESS_INVALID_RESPONSE')
        return body.fileId
      } catch (error) {
        if (timedOut) throw new EvidenceIngressClientError('EVIDENCE_INGRESS_TIMEOUT')
        if (error instanceof EvidenceIngressClientError) throw error
        throw new EvidenceIngressClientError('EVIDENCE_INGRESS_FAILED')
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function isIngressResult(value: unknown): value is { fileId: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'fileId' in value && typeof value.fileId === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(value.fileId)
}

function safeId(value: string): boolean { return /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function safeNonce(value: string): boolean { return /^[A-Za-z0-9_-]{8,128}$/.test(value) }

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}
