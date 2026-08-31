import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalMiniAppDraftCleanup } from '../../../shared/pmcMiniAppDraftCleanup'
import { createAppsScriptDraftCleanupPort } from '../src/adapters/draftCleanupClient'
import { createTestPorts } from './helpers/fakes'

describe('Apps Script draft cleanup client', () => {
  it('posts one exact signed envelope and returns only the safe count', () => {
    const ports = createTestPorts()
    const fetch = vi.fn((_url: string, options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions) => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ cleanedCount: 1 }),
      options,
    }))
    const client = createAppsScriptDraftCleanupPort({
      url: 'https://cleanup.example/internal/mini-app/draft-evidence-cleanup',
      secret: 'secret',
      crypto: ports.crypto,
      clock: ports.clock,
      nonce: () => 'cleanup-nonce-1',
      fetch,
    })
    const payload = {
      cleanupClaimId: 'a'.repeat(64),
      manifestDigest: 'b'.repeat(64),
      resources: [{
        storage: 'STAGED_OBJECT' as const,
        kind: 'PAYMENT' as const,
        ordinal: 0,
        uploadId: 'c'.repeat(64),
        contentSha256: 'd'.repeat(64),
        mimeType: 'image/jpeg' as const,
        objectKey: `drafts/v2/request-1/draft-1/PAYMENT/0/${'c'.repeat(64)}/${'d'.repeat(64)}.jpg`,
      }],
    }

    expect(client.clean(payload)).toEqual({ cleanedCount: 1 })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe('https://cleanup.example/internal/mini-app/draft-evidence-cleanup')
    expect(request).toMatchObject({ method: 'post', contentType: 'application/json', muteHttpExceptions: true })
    const envelope = JSON.parse(String(request.payload))
    expect(envelope.signature).toBe(createHmac('sha256', 'secret')
      .update(canonicalMiniAppDraftCleanup({
        kind: envelope.kind,
        version: envelope.version,
        timestamp: envelope.timestamp,
        nonce: envelope.nonce,
        payload: envelope.payload,
      }))
      .digest('hex'))
  })

  it('fails closed on an invalid URL, HTTP response, or response shape', () => {
    const ports = createTestPorts()
    expect(() => createAppsScriptDraftCleanupPort({
      url: 'http://cleanup.example/path',
      secret: 'secret',
      crypto: ports.crypto,
      clock: ports.clock,
    })).toThrow('DRAFT_CLEANUP_NOT_CONFIGURED')

    const payload = {
      cleanupClaimId: 'a'.repeat(64), manifestDigest: 'b'.repeat(64), resources: [],
    }
    const client = createAppsScriptDraftCleanupPort({
      url: 'https://cleanup.example/path',
      secret: 'secret',
      crypto: ports.crypto,
      clock: ports.clock,
      nonce: () => 'cleanup-nonce-1',
      fetch: () => ({ getResponseCode: () => 503, getContentText: () => '{"error":"private"}' }),
    })
    expect(() => client.clean(payload)).toThrow('DRAFT_CLEANUP_FAILED')
  })
})
