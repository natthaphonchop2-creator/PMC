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
    const request = vi.fn(async () => response(200, { ok: true, result }))
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
    ['RECEIVE', receiveCommand(), commandResult('receive-stock-1', 'RECEIVE', [
      { productId: 'STK-000001', quantityDeltaMilli: 1_250, balanceAfterMilli: 11_250 },
      { productId: 'STK-000002', quantityDeltaMilli: 2_000, balanceAfterMilli: 7_000 },
    ])],
    ['CREATE_PRODUCT with opening', createCommand(2_000), commandResult('create-stock-1', 'CREATE_PRODUCT', [
      { productId: 'STK-000003', quantityDeltaMilli: 2_000, balanceAfterMilli: 2_000 },
    ], 'STK-000003')],
    ['CREATE_PRODUCT without opening', createCommand(0), commandResult(
      'create-stock-1', 'CREATE_PRODUCT', [], 'STK-000004',
    )],
    ['ADJUST with ledger delta', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000001', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ], 'ADJ-000001')],
    ['ADJUST without ledger delta', adjustCommand(5_000), commandResult('adjust-stock-1', 'ADJUST', [], 'ADJ-000002')],
    ['UPDATE_PRODUCT', updateCommand(), commandResult('update-stock-1', 'UPDATE_PRODUCT', [], 'STK-000001')],
    ['DEACTIVATE_PRODUCT', lifecycleCommand('DEACTIVATE_PRODUCT'), commandResult(
      'lifecycle-stock-1', 'DEACTIVATE_PRODUCT', [], 'STK-000001',
    )],
    ['REACTIVATE_PRODUCT', lifecycleCommand('REACTIVATE_PRODUCT'), commandResult(
      'lifecycle-stock-1', 'REACTIVATE_PRODUCT', [], 'STK-000001',
    )],
  ])('accepts the exact %s result semantics', async (_name, command, result) => {
    await expect(clientWithResult(result).send(command)).resolves.toEqual(result)
  })

  it.each([
    ['ISSUE positive delta', commandFixture(), commandResult('issue-stock-1', 'ISSUE', [
      { productId: 'STK-000001', quantityDeltaMilli: 1_250, balanceAfterMilli: 8_750 },
      { productId: 'STK-000002', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ])],
    ['ISSUE negative balance', commandFixture(), commandResult('issue-stock-1', 'ISSUE', [
      { productId: 'STK-000001', quantityDeltaMilli: -1_250, balanceAfterMilli: -1 },
      { productId: 'STK-000002', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ])],
    ['ISSUE missing line', commandFixture(), commandResult('issue-stock-1', 'ISSUE', [
      { productId: 'STK-000001', quantityDeltaMilli: -1_250, balanceAfterMilli: 8_750 },
    ])],
    ['ISSUE wrong delta magnitude', commandFixture(), commandResult('issue-stock-1', 'ISSUE', [
      { productId: 'STK-000001', quantityDeltaMilli: -1_000, balanceAfterMilli: 9_000 },
      { productId: 'STK-000002', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ])],
    ['RECEIVE wrong product order', receiveCommand(), commandResult('receive-stock-1', 'RECEIVE', [
      { productId: 'STK-000002', quantityDeltaMilli: 2_000, balanceAfterMilli: 7_000 },
      { productId: 'STK-000001', quantityDeltaMilli: 1_250, balanceAfterMilli: 11_250 },
    ])],
    ['RECEIVE duplicate result product', receiveCommand(), commandResult('receive-stock-1', 'RECEIVE', [
      { productId: 'STK-000001', quantityDeltaMilli: 1_250, balanceAfterMilli: 11_250 },
      { productId: 'STK-000001', quantityDeltaMilli: 2_000, balanceAfterMilli: 13_250 },
    ])],
    ['RECEIVE wrong delta magnitude', receiveCommand(), commandResult('receive-stock-1', 'RECEIVE', [
      { productId: 'STK-000001', quantityDeltaMilli: 1_000, balanceAfterMilli: 11_000 },
      { productId: 'STK-000002', quantityDeltaMilli: 2_000, balanceAfterMilli: 7_000 },
    ])],
    ['CREATE_PRODUCT missing opening line', createCommand(2_000), commandResult('create-stock-1', 'CREATE_PRODUCT', [])],
    ['CREATE_PRODUCT unexpected zero-opening line', createCommand(0), commandResult('create-stock-1', 'CREATE_PRODUCT', [
      { productId: 'STK-000003', quantityDeltaMilli: 1, balanceAfterMilli: 1 },
    ])],
    ['CREATE_PRODUCT unsafe product ID', createCommand(2_000), commandResult('create-stock-1', 'CREATE_PRODUCT', [
      { productId: 'unsafe/product', quantityDeltaMilli: 2_000, balanceAfterMilli: 2_000 },
    ])],
    ['CREATE_PRODUCT line/document mismatch', createCommand(2_000), commandResult('create-stock-1', 'CREATE_PRODUCT', [
      { productId: 'STK-000003', quantityDeltaMilli: 2_000, balanceAfterMilli: 2_000 },
    ], 'STK-000004')],
    ['CREATE_PRODUCT zero-opening unsafe document ID', createCommand(0), commandResult(
      'create-stock-1', 'CREATE_PRODUCT', [], 'unsafe/product',
    )],
    ['ADJUST wrong product', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000002', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
    ])],
    ['ADJUST wrong counted balance', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000001', quantityDeltaMilli: -2_000, balanceAfterMilli: 4_000 },
    ])],
    ['ADJUST multiple lines', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000001', quantityDeltaMilli: -2_000, balanceAfterMilli: 3_000 },
      { productId: 'STK-000001', quantityDeltaMilli: 0, balanceAfterMilli: 3_000 },
    ])],
    ['ADJUST unsafe delta', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000001', quantityDeltaMilli: Number.MAX_SAFE_INTEGER + 1, balanceAfterMilli: 3_000 },
    ])],
    ['ADJUST zero delta ledger line', adjustCommand(3_000), commandResult('adjust-stock-1', 'ADJUST', [
      { productId: 'STK-000001', quantityDeltaMilli: 0, balanceAfterMilli: 3_000 },
    ], 'ADJ-000001')],
    ['UPDATE_PRODUCT ledger line', updateCommand(), commandResult('update-stock-1', 'UPDATE_PRODUCT', [
      { productId: 'STK-000001', quantityDeltaMilli: 0, balanceAfterMilli: 5_000 },
    ])],
    ['DEACTIVATE_PRODUCT ledger line', lifecycleCommand('DEACTIVATE_PRODUCT'), commandResult(
      'lifecycle-stock-1', 'DEACTIVATE_PRODUCT', [
        { productId: 'STK-000001', quantityDeltaMilli: 0, balanceAfterMilli: 5_000 },
      ],
    )],
    ['UPDATE_PRODUCT document mismatch', updateCommand(), commandResult(
      'update-stock-1', 'UPDATE_PRODUCT', [], 'STK-000002',
    )],
    ['DEACTIVATE_PRODUCT document mismatch', lifecycleCommand('DEACTIVATE_PRODUCT'), commandResult(
      'lifecycle-stock-1', 'DEACTIVATE_PRODUCT', [], 'STK-000002',
    )],
    ['REACTIVATE_PRODUCT document mismatch', lifecycleCommand('REACTIVATE_PRODUCT'), commandResult(
      'lifecycle-stock-1', 'REACTIVATE_PRODUCT', [], 'STK-000002',
    )],
  ])('rejects semantically malformed success: %s', async (_name, command, result) => {
    await expect(clientWithResult(result).send(command)).rejects.toMatchObject({
      code: 'STOCK_STORAGE_UNAVAILABLE',
    })
  })

  it.each([
    'STOCK_INSUFFICIENT_BALANCE',
    'STOCK_MANAGER_REQUIRED',
    'STOCK_STALE_PRODUCT',
    'STOCK_RECOVERY_REQUIRED',
    'STOCK_IDEMPOTENCY_CONFLICT',
  ])('propagates the exact allowlisted business error %s', async (error) => {
    const client = createStockIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'stock-ingress-secret',
      now: () => 1_800_000_000,
      nonce: () => 'nonce-stock-123',
      fetch: vi.fn(async () => response(200, { ok: false, error })),
    })

    await expect(client.send(commandFixture())).rejects.toMatchObject({
      code: error,
      message: `Stock ingress failed: ${error}`,
    })
  })

  it.each([
    ['provider failure', async () => response(500, { detail: 'private-provider-detail' })],
    ['malformed success envelope', async () => response(200, { ok: true, result: resultFixture(), extra: true })],
    ['mismatched request result', async () => response(200, { ok: true, result: {
      ...resultFixture(), requestId: 'different-request',
    } })],
    ['unknown error code', async () => response(200, { ok: false, error: 'STOCK_PRIVATE_INTERNAL' })],
    ['error envelope with private detail', async () => response(200, {
      ok: false, error: 'STOCK_INSUFFICIENT_BALANCE', detail: 'private-provider-detail',
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
      code: 'STOCK_STORAGE_UNAVAILABLE',
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

function receiveCommand(): MiniAppStockCommand {
  return {
    requestId: 'receive-stock-1', staffId: 'ADMIN_07', commandType: 'RECEIVE',
    payload: { lines: [
      { productId: 'STK-000001', quantityMilli: 1_250 },
      { productId: 'STK-000002', quantityMilli: 2_000 },
    ] },
  }
}

function createCommand(openingQuantityMilli: number): MiniAppStockCommand {
  return {
    requestId: 'create-stock-1', staffId: 'ADMIN_07', commandType: 'CREATE_PRODUCT',
    payload: {
      name: 'สินค้าใหม่', category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
      openingQuantityMilli, minimumQuantityMilli: 1_000,
    },
  }
}

function adjustCommand(countedQuantityMilli: number): MiniAppStockCommand {
  return {
    requestId: 'adjust-stock-1', staffId: 'ADMIN_07', commandType: 'ADJUST',
    payload: { productId: 'STK-000001', countedQuantityMilli, reason: 'ตรวจนับ' },
  }
}

function updateCommand(): MiniAppStockCommand {
  return {
    requestId: 'update-stock-1', staffId: 'ADMIN_07', commandType: 'UPDATE_PRODUCT',
    payload: {
      productId: 'STK-000001', expectedVersion: 1, name: 'ถุงมือ', category: 'CLINIC_SUPPLY',
      unit: 'กล่อง', minimumQuantityMilli: 1_000,
    },
  }
}

function lifecycleCommand(commandType: 'DEACTIVATE_PRODUCT' | 'REACTIVATE_PRODUCT'): MiniAppStockCommand {
  return {
    requestId: 'lifecycle-stock-1', staffId: 'ADMIN_07', commandType,
    payload: { productId: 'STK-000001', expectedVersion: 1 },
  }
}

function commandResult(
  requestId: string,
  commandType: MiniAppStockCommand['commandType'],
  lines: StockCommandResult['lines'],
  documentId = 'DOC-000001',
): StockCommandResult {
  return { requestId, documentId, commandType, createdAt: '2027-01-15T08:00:00.000Z', lines }
}

function clientWithResult(result: StockCommandResult) {
  return createStockIngressClient({
    url: 'https://script.google.com/macros/s/deployment/exec',
    secret: 'stock-ingress-secret',
    now: () => 1_800_000_000,
    nonce: () => 'nonce-stock-123',
    fetch: vi.fn(async () => response(200, { ok: true, result })),
  })
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
