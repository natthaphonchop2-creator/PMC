import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MiniAppEvidenceIngressEnvelope } from '../../../shared/pmcMiniAppEvidence'
import { processBookingDoPost } from '../src/entrypoints'
import { createTestPorts, type TestPorts } from './helpers/fakes'

describe('Apps Script Mini App evidence ingress', () => {
  it('creates one owner-owned Drive file and returns the same ID when the browser retries it', () => {
    const ports = createTestPorts()
    const evidenceDrive = ports.drive as TestPorts['drive'] & { createdEvidenceFileIds(): string[] }

    const first = processBookingDoPost(event(envelope()), ports)
    const retry = processBookingDoPost(event(envelope({ nonce: 'nonce-evidence-2' })), ports)

    expect(first).toEqual({ fileId: 'uploaded-evidence-1' })
    expect(retry).toEqual(first)
    expect(evidenceDrive.createdEvidenceFileIds()).toEqual(['uploaded-evidence-1'])
  })

  it('rejects image bytes that no longer match the signed content hash', () => {
    const signed = envelope()
    const tampered = { ...signed, payload: { ...signed.payload, bytesBase64: 'R0lGODlh' } }

    expect(() => processBookingDoPost(event(tampered), createTestPorts())).toThrow(/content hash/i)
  })

  it('rejects an invalid signature before hashing a potentially large image body', () => {
    const ports = createTestPorts()
    const sha256Hex = ports.crypto.sha256Hex
    let hashCalls = 0
    ports.crypto.sha256Hex = (value) => {
      hashCalls += 1
      return sha256Hex(value)
    }
    const invalid = { ...envelope(), signature: '0'.repeat(64) }

    expect(() => processBookingDoPost(event(invalid), ports)).toThrow(/signature/i)
    expect(hashCalls).toBe(0)
  })
})

function envelope(overrides: Partial<Omit<MiniAppEvidenceIngressEnvelope, 'signature'>> = {}): MiniAppEvidenceIngressEnvelope {
  const base: Omit<MiniAppEvidenceIngressEnvelope, 'signature'> = {
    kind: 'MINI_APP_EVIDENCE',
    version: 1,
    timestamp: Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1_000),
    nonce: 'nonce-evidence-1',
    payload: {
      draftId: 'draft-1',
      requestId: 'request-1',
      evidenceKind: 'PAYMENT',
      uploadId: 'd62ba4cf4b87b96c47c8e7a8e5c31765a7346df9b88e5d3a86096e62f303c211',
      fileName: 'payment-d62ba4cf4b87b96c47c8e7a8e5c31765a7346df9b88e5d3a86096e62f303c211.jpg',
      mimeType: 'image/jpeg',
      bytesBase64: '/9j/4AAQ',
      contentSha256: '6e7eb94d97c303b438c9c78f339ba53ab979dcbc288e2b1d4068e871588c5f40',
    },
    ...overrides,
  }
  const unsigned = { ...base, payload: { ...base.payload, ...(overrides.payload ?? {}) } }
  const canonical = JSON.stringify({
    kind: unsigned.kind,
    version: unsigned.version,
    timestamp: unsigned.timestamp,
    nonce: unsigned.nonce,
    payload: {
      draftId: unsigned.payload.draftId,
      requestId: unsigned.payload.requestId,
      evidenceKind: unsigned.payload.evidenceKind,
      uploadId: unsigned.payload.uploadId,
      fileName: unsigned.payload.fileName,
      mimeType: unsigned.payload.mimeType,
      contentSha256: unsigned.payload.contentSha256,
    },
  })
  return {
    ...unsigned,
    signature: createHmac('sha256', 'ingress-secret').update(canonical).digest('hex'),
  }
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
