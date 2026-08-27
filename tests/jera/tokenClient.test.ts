import { describe, expect, it, vi } from 'vitest'
import { readJeraConfig } from '../../server/jera/config'
import { createJeraTokenClient } from '../../server/jera/tokenClient'

describe('JERA Production token lifecycle', () => {
  it('caches one token before its safety-margin expiry', async () => {
    const fetch = vi.fn(async () => response(200, { access_token: 'token-1', expires_in: 36_000, token_type: 'Bearer', scope: 'read write' }))
    const client = createJeraTokenClient(config(), { fetch, now: () => 1_000 })

    expect(await client.getAccessToken()).toBe('token-1')
    expect(await client.getAccessToken()).toBe('token-1')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('shares one token request across concurrent callers', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetch = vi.fn(async () => pending.promise)
    const client = createJeraTokenClient(config(), { fetch, now: () => 1_000 })

    const first = client.getAccessToken()
    const second = client.getAccessToken()
    pending.resolve(response(200, { access_token: 'token-concurrent', expires_in: 36_000, token_type: 'Bearer' }))

    await expect(Promise.all([first, second])).resolves.toEqual(['token-concurrent', 'token-concurrent'])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses Basic Auth and URL-encoded client credentials grant without exposing secrets in the body', async () => {
    const fetch = vi.fn(async () => response(200, { access_token: 'token-basic', expires_in: 36_000, token_type: 'Bearer' }))
    const client = createJeraTokenClient(config(), { fetch })
    await client.getAccessToken()

    expect(fetch).toHaveBeenCalledWith('https://jera.example/openapi/v1/token/', expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from('production-user-synthetic:production-password-synthetic').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }))
  })

  it.each([
    ['missing access token', { expires_in: 36_000, token_type: 'Bearer' }],
    ['short access token', { access_token: 'x', expires_in: 36_000, token_type: 'Bearer' }],
    ['non-positive expiry', { access_token: 'token-invalid', expires_in: 0, token_type: 'Bearer' }],
    ['non-numeric expiry', { access_token: 'token-invalid', expires_in: 'soon', token_type: 'Bearer' }],
  ])('rejects %s', async (_name, body) => {
    const client = createJeraTokenClient(config(), { fetch: vi.fn(async () => response(200, body)) })
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: 'JERA_TOKEN_RESPONSE_INVALID' })
  })

  it('redacts provider and credential details from authentication failures', async () => {
    const client = createJeraTokenClient(config(), {
      fetch: vi.fn(async () => response(401, { detail: 'provider-secret-body' })),
    })
    await expect(client.getAccessToken()).rejects.toMatchObject({
      code: 'JERA_AUTH_FAILED',
      message: expect.not.stringMatching(/provider-secret-body|production-user-synthetic|production-password-synthetic/),
    })
  })

  it('aborts a provider request that exceeds the timeout', async () => {
    const client = createJeraTokenClient(config(), {
      timeoutMs: 5,
      fetch: vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('private timeout detail')))
      })),
    })
    await expect(client.getAccessToken()).rejects.toMatchObject({ code: 'JERA_TOKEN_TIMEOUT' })
  })

  it('drops the cache after invalidate', async () => {
    let calls = 0
    const client = createJeraTokenClient(config(), {
      fetch: vi.fn(async () => response(200, { access_token: `token-${++calls}`, expires_in: 36_000, token_type: 'Bearer' })),
    })
    expect(await client.getAccessToken()).toBe('token-1')
    client.invalidate()
    expect(await client.getAccessToken()).toBe('token-2')
  })
})

function config() {
  return readJeraConfig({
    JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example',
    JERA_DEFAULT_BRANCH_UUID: '11111111-2222-4333-8444-555555555555', JERA_SYNC_INTERVAL_MINUTES: '15',
    JERA_API_USERNAME: 'production-user-synthetic', JERA_API_PASSWORD: 'production-password-synthetic',
  })!
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}
