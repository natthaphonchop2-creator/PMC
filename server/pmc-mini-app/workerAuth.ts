import { OAuth2Client } from 'google-auth-library'

const WORKER_AUTH_ERROR = 'ASYNC_WORKER_UNAUTHORIZED' as const

export interface WorkerIdentityVerifier {
  verify(token: string): Promise<{ email: string; subject: string }>
}

export class WorkerIdentityError extends Error {
  readonly code = WORKER_AUTH_ERROR

  constructor() {
    super(WORKER_AUTH_ERROR)
    this.name = 'WorkerIdentityError'
  }
}

export function createWorkerIdentityVerifier(input: {
  audience: string
  allowedEmail: string
  client?: OAuth2Client
}): WorkerIdentityVerifier {
  const client = input.client ?? new OAuth2Client()
  const audience = input.audience
  const allowedEmail = input.allowedEmail

  return {
    async verify(token) {
      try {
        if (!safeToken(token)) throw new WorkerIdentityError()
        const ticket = await client.verifyIdToken({ idToken: token, audience })
        const payload = ticket.getPayload()
        if (!payload
          || payload.email_verified !== true
          || payload.email !== allowedEmail
          || typeof payload.sub !== 'string'
          || payload.sub.length === 0
          || payload.sub.length > 255) {
          throw new WorkerIdentityError()
        }
        return { email: payload.email, subject: payload.sub }
      } catch {
        throw new WorkerIdentityError()
      }
    },
  }
}

export function extractWorkerBearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length)
  return safeToken(token) ? token : null
}

function safeToken(token: string): boolean {
  return token.length > 0 && token.length <= 8_192 && /^[A-Za-z0-9._~-]+$/.test(token)
}
