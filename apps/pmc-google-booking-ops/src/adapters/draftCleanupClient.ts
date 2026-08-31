import {
  canonicalMiniAppDraftCleanup,
  type MiniAppDraftCleanupEnvelope,
  type MiniAppDraftCleanupPayload,
  type UnsignedMiniAppDraftCleanupEnvelope,
} from '../../../../shared/pmcMiniAppDraftCleanup'
import type { Clock, CryptoPort, DraftCleanupPort } from '../ports'

interface CleanupHttpResponse { getResponseCode(): number; getContentText(): string }

export function createAppsScriptDraftCleanupPort(input: {
  url: string
  secret: string
  crypto: CryptoPort
  clock: Clock
  nonce?: () => string
  fetch?: (url: string, options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions) => CleanupHttpResponse
}): DraftCleanupPort {
  const url = exactHttps(input.url)
  if (!url || !input.secret) throw new Error('DRAFT_CLEANUP_NOT_CONFIGURED')
  const fetcher = input.fetch ?? ((target, options) => UrlFetchApp.fetch(target, options))
  const nonce = input.nonce ?? (() => Utilities.getUuid())
  return {
    clean(payload) {
      const timestamp = Math.floor(Date.parse(input.clock.nowIso()) / 1_000)
      const unsigned: UnsignedMiniAppDraftCleanupEnvelope = {
        kind: 'MINI_APP_DRAFT_CLEANUP', version: 1, timestamp, nonce: nonce(),
        payload: JSON.parse(JSON.stringify(payload)) as MiniAppDraftCleanupPayload,
      }
      const signature = input.crypto.hmacSha256Hex(canonicalMiniAppDraftCleanup(unsigned), input.secret)
      const envelope: MiniAppDraftCleanupEnvelope = { ...unsigned, signature }
      const response = fetcher(url, {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(envelope),
        followRedirects: false, muteHttpExceptions: true,
      })
      if (response.getResponseCode() !== 200) throw new Error('DRAFT_CLEANUP_FAILED')
      let body: unknown
      try { body = JSON.parse(response.getContentText()) } catch { throw new Error('DRAFT_CLEANUP_FAILED') }
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !('cleanedCount' in body)
        || !Number.isSafeInteger(body.cleanedCount) || Number(body.cleanedCount) !== payload.resources.length) {
        throw new Error('DRAFT_CLEANUP_FAILED')
      }
      return { cleanedCount: Number(body.cleanedCount) }
    },
  }
}

function exactHttps(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      && url.pathname === '/internal/mini-app/draft-evidence-cleanup'
      && !url.search && !url.hash
      ? url.toString()
      : null
  } catch { return null }
}
