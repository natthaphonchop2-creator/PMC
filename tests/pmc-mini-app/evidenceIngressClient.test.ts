import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildMiniAppEvidenceIngress,
  createEvidenceIngressClient,
} from '../../server/pmc-mini-app/evidenceIngressClient'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe('Mini App owner evidence ingress client', () => {
  it('signs the file hash and sends the image to the existing Apps Script web app', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ fileId: 'owner-drive-file-1' }),
    }))
    const client = createEvidenceIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'ingress-secret',
      now: () => 1_787_882_400,
      nonce: () => 'nonce-evidence-1',
      fetch: request,
    })

    await expect(client.upload({
      draftId: 'draft-1', requestId: 'request-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg,
    })).resolves.toBe('owner-drive-file-1')

    const sent = JSON.parse(String(request.mock.calls[0]?.[1].body)) as Record<string, unknown>
    const payload = sent.payload as Record<string, unknown>
    expect(payload).toEqual({
      draftId: 'draft-1',
      requestId: 'request-1',
      evidenceKind: 'PAYMENT',
      uploadId: 'd62ba4cf4b87b96c47c8e7a8e5c31765a7346df9b88e5d3a86096e62f303c211',
      fileName: 'payment-d62ba4cf4b87b96c47c8e7a8e5c31765a7346df9b88e5d3a86096e62f303c211.jpg',
      mimeType: 'image/jpeg',
      bytesBase64: '/9j/4AAQ',
      contentSha256: '6e7eb94d97c303b438c9c78f339ba53ab979dcbc288e2b1d4068e871588c5f40',
    })
    const canonical = JSON.stringify({
      kind: 'MINI_APP_EVIDENCE', version: 1, timestamp: 1_787_882_400, nonce: 'nonce-evidence-1',
      payload: {
        draftId: 'draft-1', requestId: 'request-1', evidenceKind: 'PAYMENT',
        uploadId: payload.uploadId, fileName: payload.fileName, mimeType: 'image/jpeg',
        contentSha256: payload.contentSha256,
      },
    })
    expect(sent.signature).toBe(createHmac('sha256', 'ingress-secret').update(canonical).digest('hex'))
  })

  it('derives the same upload ID for a retry of the same file', () => {
    const first = buildMiniAppEvidenceIngress({
      draftId: 'draft-1', requestId: 'request-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg,
    }, { timestamp: 1_787_882_400, nonce: 'nonce-evidence-1' }, 'ingress-secret')
    const retry = buildMiniAppEvidenceIngress({
      draftId: 'draft-1', requestId: 'request-1', kind: 'PAYMENT', mimeType: 'image/jpeg', bytes: jpeg,
    }, { timestamp: 1_787_882_401, nonce: 'nonce-evidence-2' }, 'ingress-secret')

    expect(retry.body.payload.uploadId).toBe(first.body.payload.uploadId)
    expect(retry.body.payload.fileName).toBe(first.body.payload.fileName)
  })

  it('binds protocol-2 Drive identity to the evidence ordinal while exact slot retries stay stable', () => {
    const slot = {
      draftId: 'draft-1', requestId: 'request-1', kind: 'PAYMENT' as const,
      mimeType: 'image/jpeg' as const, bytes: jpeg,
    }
    const first = buildMiniAppEvidenceIngress({ ...slot, ordinal: 0 } as never,
      { timestamp: 1_787_882_400, nonce: 'nonce-evidence-1' }, 'ingress-secret')
    const retry = buildMiniAppEvidenceIngress({ ...slot, ordinal: 0 } as never,
      { timestamp: 1_787_882_401, nonce: 'nonce-evidence-2' }, 'ingress-secret')
    const second = buildMiniAppEvidenceIngress({ ...slot, ordinal: 1 } as never,
      { timestamp: 1_787_882_402, nonce: 'nonce-evidence-3' }, 'ingress-secret')

    expect(first.body.version).toBe(2)
    expect(first.body.payload).toMatchObject({
      requestId: 'request-1', draftId: 'draft-1', evidenceKind: 'PAYMENT', ordinal: 0,
      mimeType: 'image/jpeg',
      contentSha256: 'fc16d7dcee9cae83ef3923222a81ccd8fe96c9d25fdb7f504d66f1011e0cd870',
    })
    expect(retry.body.payload.uploadId).toBe(first.body.payload.uploadId)
    expect(retry.body.payload.fileName).toBe(first.body.payload.fileName)
    expect(second.body.payload.uploadId).not.toBe(first.body.payload.uploadId)
    expect(second.body.payload.fileName).not.toBe(first.body.payload.fileName)
    expect(first.body.payload.fileName).toMatch(/^payment-00-[a-f0-9]{64}\.jpg$/)
    expect(second.body.payload.fileName).toMatch(/^payment-01-[a-f0-9]{64}\.jpg$/)
    const canonical = JSON.stringify({
      kind: 'MINI_APP_EVIDENCE', version: 2, timestamp: 1_787_882_400, nonce: 'nonce-evidence-1',
      payload: {
        requestId: 'request-1', draftId: 'draft-1', evidenceKind: 'PAYMENT', ordinal: 0,
        mimeType: 'image/jpeg', contentSha256: first.body.payload.contentSha256,
        uploadId: first.body.payload.uploadId, fileName: first.body.payload.fileName,
      },
    })
    expect(first.body.signature).toBe(createHmac('sha256', 'ingress-secret').update(canonical).digest('hex'))
  })

  it('rejects a file above the existing 10 MB evidence limit before making a request', async () => {
    const request = vi.fn()
    const client = createEvidenceIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec', secret: 'ingress-secret', fetch: request,
    })

    await expect(client.upload({
      draftId: 'draft-1', requestId: 'request-1', kind: 'CHAT', mimeType: 'image/png',
      bytes: Buffer.alloc(10_000_001),
    })).rejects.toThrow('EVIDENCE_TOO_LARGE')
    expect(request).not.toHaveBeenCalled()
  })
})
