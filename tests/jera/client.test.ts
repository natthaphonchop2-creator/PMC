import { describe, expect, it, vi } from 'vitest'
import { createJeraReadClient } from '../../server/jera/client'
import { readJeraConfig } from '../../server/jera/config'
import type { JeraTokenPort } from '../../server/jera/tokenClient'

describe('bounded JERA read client', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('rejects %s before fetch', async (method) => {
    const fetch = vi.fn()
    const client = createJeraReadClient(config(), tokenPort(), { fetch })
    await expect(client.rawRequest({ method, path: '/openapi/v1/appointment/' })).rejects.toThrow('JERA_READ_ONLY_VIOLATION')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['absolute URL', 'https://evil.example/openapi/v1/appointment/'],
    ['path traversal', '/openapi/v1/appointment/../patient/'],
    ['unregistered path', '/openapi/v1/patient/'],
  ])('rejects %s before fetch', async (_name, path) => {
    const fetch = vi.fn()
    const client = createJeraReadClient(config(), tokenPort(), { fetch })
    await expect(client.rawRequest({ method: 'GET', path })).rejects.toThrow('JERA_READ_ONLY_VIOLATION')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects duplicate scalar query filters before fetch', async () => {
    const fetch = vi.fn()
    const client = createJeraReadClient(config(), tokenPort(), { fetch })
    await expect(client.rawRequest({
      method: 'GET', path: '/openapi/v1/report/payment-list/',
      query: [['status', 'paid'], ['status', 'unpaid']],
    })).rejects.toThrow('JERA_FILTER_INVALID')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported filter', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-02', status: 'paid' }],
    ['unsafe UUID', { branchUuid: '../../branch', startDate: '2026-01-01', endDate: '2026-01-02' }],
    ['date reversal', { branchUuid: uuid(), startDate: '2026-01-03', endDate: '2026-01-02' }],
    ['more than 366 days', { branchUuid: uuid(), startDate: '2025-01-01', endDate: '2026-01-02' }],
  ])('rejects %s', async (_name, filters) => {
    const fetch = vi.fn()
    const client = createJeraReadClient(config(), tokenPort(), { fetch })
    await expect(client.request('PAYMENT', filters)).rejects.toMatchObject({ code: expect.stringMatching(/^JERA_/) })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('chunks upstream date windows to at most 31 days', async () => {
    const fetch = vi.fn(async () => response(200, []))
    const client = createJeraReadClient(config(), tokenPort(), { fetch })

    await client.request('PAYMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-02-09' })

    expect(fetch).toHaveBeenCalledTimes(2)
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)))
    expect(urls.map((url) => [url.searchParams.get('start_date'), url.searchParams.get('end_date')])).toEqual([
      ['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-09'],
    ])
    expect(urls.every((url) => url.origin === 'https://jera.example')).toBe(true)
  })

  it('paginates with bounded page sizes and deduplicates stable provider identities', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ uuid: `appointment-${index}`, value: index }))
    const fetch = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get('page')
      return page === '1'
        ? response(200, { count: 101, next: 'provider-next-url-is-ignored', results: firstPage })
        : response(200, { count: 101, next: null, results: [{ uuid: 'appointment-99', value: 99 }, { uuid: 'appointment-100', value: 100 }] })
    })
    const client = createJeraReadClient(config(), tokenPort(), { fetch })

    const result = await client.request('APPOINTMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-01' })

    expect(result).toHaveLength(101)
    expect(fetch).toHaveBeenCalledTimes(2)
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)))
    expect(urls.map((url) => [url.searchParams.get('page'), url.searchParams.get('row_per_page')])).toEqual([['1', '100'], ['2', '100']])
  })

  it('refreshes the token once after 401 and replays the GET once', async () => {
    const tokens = tokenPort(['token-1', 'token-2'])
    const fetch = vi.fn(async (_url: string, init: { headers: { authorization: string } }) =>
      init.headers.authorization === 'Bearer token-1' ? response(401, {}) : response(200, [{ uuid: 'payment-1' }]))
    const client = createJeraReadClient(config(), tokens, { fetch })

    await expect(client.request('PAYMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-01' }))
      .resolves.toEqual([{ uuid: 'payment-1' }])
    expect(tokens.invalidate).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['rate limit', response(429, { detail: 'provider-private' }), 'JERA_RATE_LIMITED'],
    ['provider failure', response(500, { detail: 'provider-private' }), 'JERA_PROVIDER_FAILED'],
    ['malformed schema', response(200, { unexpected: true }), 'JERA_SCHEMA_INVALID'],
  ])('maps %s to a safe error', async (_name, providerResponse, code) => {
    const client = createJeraReadClient(config(), tokenPort(), { fetch: vi.fn(async () => providerResponse) })
    await expect(client.request('PAYMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-01' }))
      .rejects.toMatchObject({ code, message: expect.not.stringContaining('provider-private') })
  })

  it('aborts an interactive GET that exceeds its latency budget', async () => {
    const client = createJeraReadClient({ ...config(), interactiveTimeoutMs: 5 }, tokenPort(), {
      fetch: vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('private timeout detail')))
      })),
    })
    await expect(client.request('PAYMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-01' }))
      .rejects.toMatchObject({ code: 'JERA_TIMEOUT' })
  })

  it('retries a scheduled rate limit with a bounded delay', async () => {
    const sleep = vi.fn(async () => undefined)
    let attempts = 0
    const client = createJeraReadClient(config(), tokenPort(), {
      mode: 'SCHEDULED', sleep,
      fetch: vi.fn(async () => ++attempts === 1 ? response(429, {}) : response(200, [{ uuid: 'payment-1' }])),
    })
    await expect(client.request('PAYMENT', { branchUuid: uuid(), startDate: '2026-01-01', endDate: '2026-01-01' }))
      .resolves.toEqual([{ uuid: 'payment-1' }])
    expect(attempts).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})

function config() {
  return readJeraConfig({
    JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example',
    JERA_DEFAULT_BRANCH_UUID: uuid(), JERA_SYNC_INTERVAL_MINUTES: '15',
    JERA_API_USERNAME: 'synthetic-user', JERA_API_PASSWORD: 'synthetic-password',
  })!
}

function tokenPort(tokens = ['token-readonly']): JeraTokenPort & { invalidate: ReturnType<typeof vi.fn> } {
  let index = 0
  return {
    getAccessToken: vi.fn(async () => tokens[Math.min(index++, tokens.length - 1)]!),
    invalidate: vi.fn(),
  }
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const bytes = Buffer.from(JSON.stringify(body))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'content-length' ? String(bytes.length) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

function uuid() { return '11111111-2222-4333-8444-555555555555' }
