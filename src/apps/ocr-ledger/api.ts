import liff from '@line/liff'
import type { OcrEditablePatch, OcrReviewDraft } from './OcrReviewApp'

export class OcrReviewApiError extends Error {
  readonly code: 'EXPIRED' | 'UNAUTHORIZED' | 'FAILED'

  constructor(code: 'EXPIRED' | 'UNAUTHORIZED' | 'FAILED', message = 'OCR review request failed') {
    super(message)
    this.code = code
  }
}

export async function initializeOcrLiff(): Promise<string> {
  const config = await fetchPublicJson<{ liffId: string }>('/api/ocr-ledger/client-config')
  await liff.init({ liffId: config.liffId })

  if (!liff.isInClient() && !liff.isLoggedIn()) {
    liff.login()
    return new Promise(() => undefined)
  }

  const idToken = liff.getIDToken()
  if (!idToken) throw new OcrReviewApiError('UNAUTHORIZED')
  return idToken
}

export async function loadOcrDraft(rawIdToken: string): Promise<OcrReviewDraft> {
  return fetchJson<OcrReviewDraft>('/api/ocr-ledger/review', rawIdToken)
}

export async function loadOcrImage(rawIdToken: string): Promise<string> {
  const response = await request('/api/ocr-ledger/image', rawIdToken)
  const image = await response.blob()
  return URL.createObjectURL(image)
}

export async function submitOcrEdit(rawIdToken: string, patch: OcrEditablePatch) {
  const response = await request('/api/ocr-ledger/review', rawIdToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch }),
  })
  return response.json() as Promise<{ accepted: true; jobId: string }>
}

export function revokeOcrImage(url: string): void {
  URL.revokeObjectURL(url)
}

async function fetchJson<T>(path: string, rawIdToken?: string): Promise<T> {
  const response = await request(path, rawIdToken)
  return response.json() as Promise<T>
}

async function fetchPublicJson<T>(path: string): Promise<T> {
  try {
    const response = await fetch(path)
    if (!response.ok) throw new OcrReviewApiError('FAILED')
    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof OcrReviewApiError) throw error
    throw new OcrReviewApiError('FAILED')
  }
}

async function request(path: string, rawIdToken?: string, init: RequestInit = {}): Promise<Response> {
  const token = reviewToken()
  const headers = new Headers(init.headers)
  if (rawIdToken) headers.set('authorization', `Bearer ${rawIdToken}`)
  let response: Response
  try {
    response = await fetch(`${path}?t=${encodeURIComponent(token)}`, { ...init, headers })
  } catch {
    throw new OcrReviewApiError('FAILED')
  }
  if (response.ok) return response
  if (response.status === 401) throw new OcrReviewApiError('UNAUTHORIZED')
  if (response.status === 409) throw new OcrReviewApiError('EXPIRED')
  throw new OcrReviewApiError('FAILED')
}

function reviewToken(): string {
  const params = new URLSearchParams(window.location.search)
  const tokens = params.getAll('t').filter((token) => token.trim().length > 0)
  if (tokens.length !== 1) throw new OcrReviewApiError('UNAUTHORIZED')
  return tokens[0]!
}
