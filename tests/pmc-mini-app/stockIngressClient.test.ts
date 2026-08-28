import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { MiniAppStockCommand, StockCommandResult } from '../../shared/pmcStock'
import {
  canonicalMiniAppStockIngress,
  type UnsignedMiniAppStockIngressEnvelope,
} from '../../shared/pmcMiniAppStockIngress'
import {
  buildMiniAppStockIngress,
  createStockIngressClient,
} from '../../server/pmc-mini-app/stock/ingressClient'

describe('PMC Mini App signed Stock ingress client', () => {
  it('signs one fixed canonical command envelope without exposing the secret', () => {
    const built = buildMiniAppStockIngress(commandFixture(), {
      timestamp: 1_800_000_000,
      nonce: 'nonce-stock-123',
    }, 'stock-ingress-secret')
    const { signature, ...unsigned } = built.body
    const canonical = '{"kind":"MINI_APP_STOCK","version":1,"timestamp":1800000000,"nonce":"nonce-stock-123","command":{"requestId":"issue-stock-1","staffId":"ADMIN_01","commandType":"ISSUE","payload":{"lines":[{"productId":"STK-000001","quantityMilli":1250},{"productId":"STK-000002","quantityMilli":2000}]}}}'

    expect(built.body.kind).toBe('MINI_APP_STOCK')
    expect(built.headers).toEqual({ 'content-type': 'application/json' })
    expect(canonicalMiniAppStockIngress(unsigned)).toBe(canonical)
    expect(signature).toBe(
      createHmac('sha256', 'stock-ingress-secret').update(canonical).digest('hex'),
    )
    expect(JSON.stringify(built.body)).not.toContain('stock-ingress-secret')
  })

  it('posts the server-injected staff command and accepts an exact result', async () => {
    const result = resultFixture()
    const request = vi.fn(async () => response(200, result))
    const client = createStockIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'stock-ingress-secret',
      now: () => 1_800_000_000,
      nonce: () => 'nonce-stock-123',
      fetch: request,
    })

    await expect(client.send(commandFixture())).resolves.toEqual(result)
    const sent = JSON.parse(String(request.mock.calls[0]?.[1].body)) as {
      command: MiniAppStockCommand
    }
    expect(sent.command.staffId).toBe('ADMIN_01')
    expect(request).toHaveBeenCalledWith(
      'https://script.google.com/macros/s/deployment/exec',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it.each([
    ['provider failure', async () => response(500, { detail: 'private-provider-detail' })],
    ['malformed result', async () => response(200, { ...resultFixture(), extra: true })],
    ['mismatched request result', async () => response(200, {
      ...resultFixture(), requestId: 'different-request',
    })],
    ['transport failure', async () => { throw new Error('private-transport-detail') }],
  ])('returns a bounded safe error for %s', async (_name, fetchImplementation) => {
    const client = createStockIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'stock-ingress-secret',
      now: () => 1_800_000_000,
      nonce: () => 'nonce-stock-123',
      fetch: vi.fn(fetchImplementation),
    })

    await expect(client.send(commandFixture())).rejects.toMatchObject({
      code: expect.stringMatching(/^STOCK_INGRESS_/),
      message: expect.not.stringMatching(/private-provider-detail|private-transport-detail/),
    })
  })

  it('rejects unknown command keys before canonicalization', () => {
    const unsigned: UnsignedMiniAppStockIngressEnvelope = {
      kind: 'MINI_APP_STOCK',
      version: 1,
      timestamp: 1_800_000_000,
      nonce: 'nonce-stock-123',
      command: { ...commandFixture(), debug: true } as MiniAppStockCommand,
    }

    expect(() => canonicalMiniAppStockIngress(unsigned)).toThrow('invalid mini app stock command')
  })
})

function commandFixture(): MiniAppStockCommand {
  return {
    requestId: 'issue-stock-1',
    staffId: 'ADMIN_01',
    commandType: 'ISSUE',
    payload: {
      lines: [
        { productId: 'STK-000001', quantityMilli: 1_250 },
        { productId: 'STK-000002', quantityMilli: 2_000 },
      ],
    },
  }
}

function resultFixture(): StockCommandResult {
  return {
    requestId: 'issue-stock-1',
    documentId: 'ISS-000001',
    commandType: 'ISSUE',
    createdAt: '2027-01-15T08:00:00.000Z',
    lines: [
      { productId: 'STK-000001', quantityDeltaMilli: -1_250, balanceAfterMilli: 8_750 },
      { productId: 'STK-000002', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ],
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
