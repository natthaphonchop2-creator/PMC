import type { OAuth2Client } from 'google-auth-library'
import { describe, expect, it, vi } from 'vitest'
import {
  createWorkerIdentityVerifier,
  extractWorkerBearerToken,
} from '../../server/pmc-mini-app/workerAuth'

const audience = 'https://pmc-mini-app.example'
const allowedEmail = 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com'

describe('PMC async worker identity', () => {
  it.each([
    undefined,
    [],
    ['Bearer token'],
    'Basic token',
    'Bearer',
    'Bearer ',
    'Bearer token with-space',
    `Bearer ${'x'.repeat(8_193)}`,
  ])('rejects a missing or malformed bearer credential without returning its value', (authorization) => {
    expect(extractWorkerBearerToken(authorization)).toBeNull()
  })

  it('accepts a verified Google identity only for the exact configured audience and email', async () => {
    const verifyIdToken = vi.fn(async (input: { idToken: string; audience: string }) => {
      if (input.audience !== audience) throw new Error('audience detail must stay private')
      return ticket({
        sub: 'google-subject-1',
        email: allowedEmail,
        email_verified: true,
      })
    })
    const verifier = createWorkerIdentityVerifier({
      audience,
      allowedEmail,
      client: { verifyIdToken } as unknown as OAuth2Client,
    })

    await expect(verifier.verify('signed-google-id-token')).resolves.toEqual({
      email: allowedEmail,
      subject: 'google-subject-1',
    })
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',
      audience,
    })
  })

  it.each([
    ['wrong audience', 'https://wrong.example', { sub: 'google-subject-1', email: allowedEmail, email_verified: true }],
    ['unverified email', audience, { sub: 'google-subject-1', email: allowedEmail, email_verified: false }],
    ['wrong email', audience, { sub: 'google-subject-1', email: 'other@example.iam.gserviceaccount.com', email_verified: true }],
    ['missing subject', audience, { email: allowedEmail, email_verified: true }],
  ] as const)('replaces %s details with one safe authorization error', async (_label, configuredAudience, payload) => {
    const client = {
      async verifyIdToken(input: { idToken: string; audience: string }) {
        if (input.audience !== audience) throw new Error(`provider rejected ${input.audience} for ${input.idToken}`)
        return ticket(payload)
      },
    } as unknown as OAuth2Client
    const verifier = createWorkerIdentityVerifier({ audience: configuredAudience, allowedEmail, client })

    const error = await verifier.verify('private-token').catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'WorkerIdentityError',
      message: 'ASYNC_WORKER_UNAUTHORIZED',
      code: 'ASYNC_WORKER_UNAUTHORIZED',
    })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain('private-token')
    expect(JSON.stringify(error)).not.toContain('wrong.example')
  })
})

function ticket(payload: Record<string, unknown>) {
  return { getPayload: () => payload }
}
