import { describe, expect, it, vi } from 'vitest'
import { createLineIdentityClient, MiniAppIdentityError } from '../../server/pmc-mini-app/lineIdentity'

describe('PMC Mini App LINE identity', () => {
  it('accepts only a valid LINE subject and configured audience', async () => {
    const fetch = vi.fn(async () => response(200, { sub: 'Ustaff', aud: '2001234567', exp: 1_800_000_100 }))
    const identity = createLineIdentityClient({
      channelId: '2001234567',
      now: () => 1_800_000_000,
      fetch,
    })

    await expect(identity.verify('raw-token')).resolves.toEqual({ lineUserId: 'Ustaff' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.line.me/oauth2/v2.1/verify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'id_token=raw-token&client_id=2001234567',
      },
    )
  })

  it.each([
    ['wrong audience', { sub: 'Ustaff', aud: 'other', exp: 1_800_000_100 }, 'MINI_APP_UNAUTHORIZED'],
    ['expired token', { sub: 'Ustaff', aud: '2001234567', exp: 1_799_999_999 }, 'MINI_APP_ID_TOKEN_EXPIRED'],
    ['missing subject', { aud: '2001234567', exp: 1_800_000_100 }, 'MINI_APP_UNAUTHORIZED'],
  ])('rejects a %s', async (_name, body, code) => {
    const identity = createLineIdentityClient({
      channelId: '2001234567',
      now: () => 1_800_000_000,
      fetch: vi.fn(async () => response(200, body)),
    })

    await expect(identity.verify('raw-token')).rejects.toMatchObject({ code })
  })

  it('redacts provider bodies and transport failures from errors', async () => {
    const bodyFailure = createLineIdentityClient({
      channelId: '2001234567',
      fetch: vi.fn(async () => response(500, { message: 'provider-secret-body' })),
    })
    const transportFailure = createLineIdentityClient({
      channelId: '2001234567',
      fetch: vi.fn(async () => { throw new Error('transport-secret-body') }),
    })

    await expect(bodyFailure.verify('raw-token')).rejects.toBeInstanceOf(MiniAppIdentityError)
    await expect(bodyFailure.verify('raw-token')).rejects.toMatchObject({
      code: 'MINI_APP_UNAUTHORIZED',
      message: expect.not.stringContaining('provider-secret-body'),
    })
    await expect(transportFailure.verify('raw-token')).rejects.toMatchObject({
      code: 'MINI_APP_UNAUTHORIZED',
      message: expect.not.stringContaining('transport-secret-body'),
    })
  })
})

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}
