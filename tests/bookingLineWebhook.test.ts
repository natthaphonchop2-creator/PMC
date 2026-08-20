import { describe, expect, it, vi } from 'vitest'
import { createBookingLineWebhookHandler, signLineBody } from '../server/bookingLineWebhook'

describe('booking LINE webhook bridge', () => {
  it('rejects an invalid x-line-signature and never forwards', async () => {
    const forward = vi.fn()
    const handler = createBookingLineWebhookHandler({
      lineChannelSecret: 'line-secret',
      ingressSecret: 'ingress-secret',
      forward,
    })
    const response = await handler({ rawBody: '{"events":[]}', signature: 'invalid' })
    expect(response.status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
  })

  it('forwards source IDs only after LINE signature verification', async () => {
    const rawBody = JSON.stringify({
      events: [
        {
          type: 'message',
          source: { type: 'group', groupId: 'doctor-group-1', userId: 'admin-user-1' },
          message: { type: 'text', text: 'must not forward' },
        },
      ],
    })
    const forward = vi.fn().mockResolvedValue(undefined)
    const handler = createBookingLineWebhookHandler({
      lineChannelSecret: 'line-secret',
      ingressSecret: 'ingress-secret',
      forward,
      now: () => 1_787_191_200,
      nonce: () => 'nonce-1',
    })
    const response = await handler({ rawBody, signature: signLineBody(rawBody, 'line-secret') })
    expect(response.status).toBe(200)
    expect(JSON.stringify(forward.mock.calls)).not.toContain('must not forward')
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'group', sourceId: 'doctor-group-1' }),
    )
  })
})
