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

  it('creates distinct protocol-2 Drive files for identical bytes in different ordinals and reuses only an exact slot marker', () => {
    const ports = createTestPorts()
    const evidenceDrive = ports.drive as TestPorts['drive'] & {
      createdEvidenceFileIds(): string[]
      createdEvidenceFiles(): Array<{ id: string; folderId: string; name: string; mimeType: string; marker: string | null }>
    }

    const first = processBookingDoPost(event(v2Envelope(0, 'nonce-v2-evidence-1')), ports)
    const second = processBookingDoPost(event(v2Envelope(1, 'nonce-v2-evidence-2')), ports)
    const retry = processBookingDoPost(event(v2Envelope(0, 'nonce-v2-evidence-3')), ports)

    expect(first).toEqual({ fileId: 'uploaded-evidence-1' })
    expect(second).toEqual({ fileId: 'uploaded-evidence-2' })
    expect(retry).toEqual(first)
    expect(evidenceDrive.createdEvidenceFileIds()).toEqual(['uploaded-evidence-1', 'uploaded-evidence-2'])
    expect(evidenceDrive.createdEvidenceFiles()).toEqual([
      expect.objectContaining({
        id: 'uploaded-evidence-1', mimeType: 'image/jpeg',
        name: 'payment-00-f4bf529f149dc52159d2d35048c43d4053a27334256196774b9d61e6088b03a2.jpg',
        marker: expect.stringContaining('"ordinal":0'),
      }),
      expect.objectContaining({
        id: 'uploaded-evidence-2', mimeType: 'image/jpeg',
        name: 'payment-01-b68d788849f8ed216591c30cc8db028d5b38158d4f3e3e477a06795e4e153c9d.jpg',
        marker: expect.stringContaining('"ordinal":1'),
      }),
    ])
  })

  it('does not reuse a same-name Drive file unless parent, marker, and MIME match the protocol-2 slot', () => {
    const ports = createTestPorts()
    const drive = ports.drive as TestPorts['drive'] & {
      seedEvidenceFile(input: { id: string; folderId: string; name: string; mimeType: string; marker: string | null }): void
      createdEvidenceFileIds(): string[]
    }
    const intake = drive.ensureChildFolder(drive.rootFolderId(), '_MINI_APP_INTAKE', 'mini-app-intake:v1')
    const payload = v2Envelope(0, 'nonce-v2-marker-1').payload
    drive.seedEvidenceFile({
      id: 'wrong-marker-file', folderId: intake.id, name: payload.fileName,
      mimeType: payload.mimeType, marker: 'wrong-marker',
    })
    drive.seedEvidenceFile({
      id: 'wrong-parent-file', folderId: 'another-folder', name: payload.fileName,
      mimeType: payload.mimeType, marker: v2Marker(payload),
    })

    const first = processBookingDoPost(event(v2Envelope(0, 'nonce-v2-marker-1')), ports)
    const retry = processBookingDoPost(event(v2Envelope(0, 'nonce-v2-marker-2')), ports)

    expect(first).toEqual({ fileId: 'uploaded-evidence-1' })
    expect(retry).toEqual(first)
    expect(drive.createdEvidenceFileIds()).toEqual(['uploaded-evidence-1'])
  })

  it('fails closed when two Drive files exactly match one protocol-2 slot', () => {
    const ports = createTestPorts()
    const drive = ports.drive as TestPorts['drive'] & {
      seedEvidenceFile(input: { id: string; folderId: string; name: string; mimeType: string; marker: string | null }): void
      createdEvidenceFileIds(): string[]
    }
    const intake = drive.ensureChildFolder(drive.rootFolderId(), '_MINI_APP_INTAKE', 'mini-app-intake:v1')
    const envelope = v2Envelope(0, 'nonce-v2-duplicate-1')
    for (const id of ['duplicate-exact-1', 'duplicate-exact-2']) {
      drive.seedEvidenceFile({
        id, folderId: intake.id, name: envelope.payload.fileName,
        mimeType: envelope.payload.mimeType, marker: v2Marker(envelope.payload),
      })
    }

    expect(() => processBookingDoPost(event(envelope), ports)).toThrow(/duplicate exact/i)
    expect(drive.createdEvidenceFileIds()).toEqual([])
  })

  it('rejects image bytes that no longer match the signed content hash', () => {
    const signed = envelope()
    const tampered = { ...signed, payload: { ...signed.payload, bytesBase64: 'R0lGODlh' } }

    expect(() => processBookingDoPost(event(tampered), createTestPorts())).toThrow(/content hash/i)
  })

  it('rejects protocol-2 bytes whose raw SHA-256 no longer matches the ordinal slot', () => {
    const signed = v2Envelope(0, 'nonce-v2-tamper-1')
    const tampered = {
      ...signed,
      payload: { ...signed.payload, bytesBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11]).toString('base64') },
    }

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

function v2Envelope(ordinal: 0 | 1, nonce: string) {
  const contentSha256 = 'fc16d7dcee9cae83ef3923222a81ccd8fe96c9d25fdb7f504d66f1011e0cd870'
  const uploadId = ordinal === 0
    ? 'f4bf529f149dc52159d2d35048c43d4053a27334256196774b9d61e6088b03a2'
    : 'b68d788849f8ed216591c30cc8db028d5b38158d4f3e3e477a06795e4e153c9d'
  const unsigned = {
    kind: 'MINI_APP_EVIDENCE' as const,
    version: 2 as const,
    timestamp: Math.floor(Date.parse('2026-08-20T09:00:00+07:00') / 1_000),
    nonce,
    payload: {
      requestId: 'request-1', draftId: 'draft-1', evidenceKind: 'PAYMENT' as const, ordinal,
      mimeType: 'image/jpeg' as const, contentSha256, uploadId,
      fileName: `payment-0${ordinal}-${uploadId}.jpg`, bytesBase64: '/9j/4AAQ',
    },
  }
  const canonical = JSON.stringify({
    kind: unsigned.kind, version: unsigned.version, timestamp: unsigned.timestamp, nonce: unsigned.nonce,
    payload: {
      requestId: unsigned.payload.requestId, draftId: unsigned.payload.draftId,
      evidenceKind: unsigned.payload.evidenceKind, ordinal: unsigned.payload.ordinal,
      mimeType: unsigned.payload.mimeType, contentSha256: unsigned.payload.contentSha256,
      uploadId: unsigned.payload.uploadId, fileName: unsigned.payload.fileName,
    },
  })
  return { ...unsigned, signature: createHmac('sha256', 'ingress-secret').update(canonical).digest('hex') }
}

function v2Marker(payload: ReturnType<typeof v2Envelope>['payload']): string {
  return JSON.stringify({
    kind: 'MINI_APP_EVIDENCE_FILE', version: 2, requestId: payload.requestId, draftId: payload.draftId,
    evidenceKind: payload.evidenceKind, ordinal: payload.ordinal, mimeType: payload.mimeType,
    contentSha256: payload.contentSha256, uploadId: payload.uploadId,
  })
}

function event(payload: unknown) {
  const contents = JSON.stringify(payload)
  return { postData: { contents, length: contents.length, name: 'postData', type: 'application/json' } }
}
