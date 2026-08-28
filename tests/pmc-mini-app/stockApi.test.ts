import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { PmcMiniAppServerConfig } from '../../server/pmc-mini-app/config'
import type {
  LineIdentityPort,
  StockProductProjection,
  StockServerDependencies,
} from '../../server/pmc-mini-app/contracts'
import { createPmcMiniAppMiddleware } from '../../server/pmc-mini-app/middleware'
import { StockIngressClientError } from '../../server/pmc-mini-app/stock/ingressClient'
import { StockReadStoreError } from '../../server/pmc-mini-app/stock/readStore'
import type { MiniAppStore } from '../../server/pmc-mini-app/store'
import type { MiniAppStockCommand, StockCommandResult, StockDocumentSummary } from '../../shared/pmcStock'

describe('PMC Mini App Stock API', () => {
  it('lets verified active staff read products, history, and document details', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const products = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'staff-token')
    const history = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/history?cursor=opaque-cursor', null, 'staff-token')
    const document = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/documents/ISS-000001', null, 'staff-token')

    expect(products).toEqual({ status: 200, body: { products: [productProjection()] } })
    expect(history).toEqual({ status: 200, body: historyPage() })
    expect(document).toEqual({ status: 200, body: documentSummary() })
    expect(deps.stock.readStore.listHistory).toHaveBeenCalledWith('opaque-cursor', 25)
    const serialized = JSON.stringify({ products, history, document })
    expect(serialized).not.toContain('sheet-1')
    expect(serialized).not.toContain('STOCK_PRODUCTS')
    expect(serialized).not.toContain('Ustaff-private')
  })

  it('keeps inactive products out of staff reads while managers can manage them', async () => {
    const deps = dependencies()
    vi.mocked(deps.stock.readStore.listProducts).mockResolvedValueOnce([
      productProjection(),
      { ...productProjection(), productId: 'STK-000002', name: 'สินค้าเลิกใช้', active: false },
    ]).mockResolvedValueOnce([
      productProjection(),
      { ...productProjection(), productId: 'STK-000002', name: 'สินค้าเลิกใช้', active: false },
    ])
    const middleware = createPmcMiniAppMiddleware(deps)

    const staff = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'staff-token')
    const manager = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'manager-token')

    expect(staff.body).toEqual({ products: [productProjection()] })
    expect(manager.body).toEqual({ products: [
      productProjection(),
      { ...productProjection(), productId: 'STK-000002', name: 'สินค้าเลิกใช้', active: false },
    ] })
  })

  it('shows adjustment reasons only to Stock managers', async () => {
    const deps = dependencies()
    const adjusted = { ...documentSummary(), transactionType: 'ADJUST' as const, reason: 'ผลนับจริงต่างจากระบบ' }
    vi.mocked(deps.stock.readStore.listHistory).mockResolvedValue({ documents: [adjusted], nextCursor: null })
    vi.mocked(deps.stock.readStore.getDocument).mockResolvedValue(adjusted)
    const middleware = createPmcMiniAppMiddleware(deps)

    const staffHistory = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/history', null, 'staff-token')
    const staffDocument = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/documents/ISS-000001', null, 'staff-token')
    const managerHistory = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/history', null, 'manager-token')

    expect(staffHistory.body).toEqual({ documents: [{ ...adjusted, reason: '' }], nextCursor: null })
    expect(staffDocument.body).toEqual({ ...adjusted, reason: '' })
    expect(managerHistory.body).toEqual({ documents: [adjusted], nextCursor: null })
  })

  it('lets active staff issue and injects the verified staff ID into the signed command', async () => {
    const deps = dependencies()
    const response = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-1', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')

    expect(response).toEqual({ status: 200, body: commandResult('issue-1', 'ISSUE') })
    expect(deps.stock.ingress.send).toHaveBeenCalledWith({
      requestId: 'issue-1', staffId: 'STAFF_01', commandType: 'ISSUE',
      payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    })
  })

  it('rejects browser-supplied identity and duplicate lines before ingress', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const spoofed = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-1', staffId: 'ADMIN_03',
      lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')
    const duplicated = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-2', lines: [
        { productId: 'STK-000001', quantityMilli: 1_000 },
        { productId: 'STK-000001', quantityMilli: 2_000 },
      ],
    }, 'staff-token')
    const nestedSpoof = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-3', lines: [{ productId: 'STK-000001', quantityMilli: 1_000, staffId: 'ADMIN_03' }],
    }, 'staff-token')

    expect(spoofed).toEqual({ status: 400, body: { error: 'STOCK_UNKNOWN_FIELD' } })
    expect(duplicated).toEqual({ status: 400, body: { error: 'STOCK_DUPLICATE_LINE' } })
    expect(nestedSpoof).toEqual({ status: 400, body: { error: 'STOCK_UNKNOWN_FIELD' } })
    expect(deps.stock.ingress.send).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', '/api/mini-app/stock/receipts', { requestId: 'receive-1', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] }],
    ['POST', '/api/mini-app/stock/products', { requestId: 'create-1', name: 'เข็ม', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', openingQuantityMilli: 0, minimumQuantityMilli: 1_000 }],
    ['POST', '/api/mini-app/stock/adjustments', { requestId: 'adjust-1', productId: 'STK-000001', countedQuantityMilli: 2_000, reason: 'ตรวจนับ' }],
    ['PATCH', '/api/mini-app/stock/products/STK-000001', { requestId: 'update-1', action: 'UPDATE', expectedVersion: 1, name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง', minimumQuantityMilli: 1_000 }],
  ])('returns manager-required before parsing a staff %s %s command', async (method, path, body) => {
    const deps = dependencies()

    await expect(jsonRequest(createPmcMiniAppMiddleware(deps), method, path, body, 'staff-token')).resolves.toEqual({
      status: 403, body: { error: 'STOCK_MANAGER_REQUIRED' },
    })
    expect(deps.stock.ingress.send).not.toHaveBeenCalled()
  })

  it('forwards every manager command with server-injected path and staff identity', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)
    const requests: Array<[string, string, Record<string, unknown>]> = [
      ['POST', '/api/mini-app/stock/products', {
        requestId: 'create-1', name: 'เข็ม', category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
        openingQuantityMilli: 0, minimumQuantityMilli: 1_000,
      }],
      ['POST', '/api/mini-app/stock/receipts', {
        requestId: 'receive-1', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
      }],
      ['POST', '/api/mini-app/stock/adjustments', {
        requestId: 'adjust-1', productId: 'STK-000001', countedQuantityMilli: 2_000, reason: 'ตรวจนับสิ้นวัน',
      }],
      ['PATCH', '/api/mini-app/stock/products/STK-000001', {
        requestId: 'update-1', action: 'UPDATE', expectedVersion: 1, name: 'ถุงมือใหม่',
        category: 'RETAIL_PRODUCT', unit: 'กล่อง', minimumQuantityMilli: 2_000,
      }],
      ['PATCH', '/api/mini-app/stock/products/STK-000001', {
        requestId: 'deactivate-1', action: 'DEACTIVATE', expectedVersion: 2,
      }],
      ['PATCH', '/api/mini-app/stock/products/STK-000001', {
        requestId: 'reactivate-1', action: 'REACTIVATE', expectedVersion: 3,
      }],
    ]

    for (const [method, path, body] of requests) {
      expect((await jsonRequest(middleware, method, path, body, 'manager-token')).status).toBe(200)
    }

    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(1, {
      requestId: 'create-1', staffId: 'ADMIN_07', commandType: 'CREATE_PRODUCT', payload: {
        name: 'เข็ม', category: 'CLINIC_SUPPLY', unit: 'ชิ้น', openingQuantityMilli: 0, minimumQuantityMilli: 1_000,
      },
    })
    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(2, {
      requestId: 'receive-1', staffId: 'ADMIN_07', commandType: 'RECEIVE',
      payload: { lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }] },
    })
    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(3, {
      requestId: 'adjust-1', staffId: 'ADMIN_07', commandType: 'ADJUST',
      payload: { productId: 'STK-000001', countedQuantityMilli: 2_000, reason: 'ตรวจนับสิ้นวัน' },
    })
    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(4, {
      requestId: 'update-1', staffId: 'ADMIN_07', commandType: 'UPDATE_PRODUCT', payload: {
        productId: 'STK-000001', expectedVersion: 1, name: 'ถุงมือใหม่', category: 'RETAIL_PRODUCT',
        unit: 'กล่อง', minimumQuantityMilli: 2_000,
      },
    })
    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(5, {
      requestId: 'deactivate-1', staffId: 'ADMIN_07', commandType: 'DEACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 2 },
    })
    expect(deps.stock.ingress.send).toHaveBeenNthCalledWith(6, {
      requestId: 'reactivate-1', staffId: 'ADMIN_07', commandType: 'REACTIVATE_PRODUCT',
      payload: { productId: 'STK-000001', expectedVersion: 3 },
    })
  })

  it.each([
    { requestId: 'update-1', action: 'UPDATE', productId: 'STK-spoof', expectedVersion: 1, name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง', minimumQuantityMilli: 1_000 },
    { requestId: 'deactivate-1', action: 'DEACTIVATE', staffId: 'ADMIN_03', expectedVersion: 1 },
    { requestId: 'deactivate-1', action: 'DEACTIVATE', expectedVersion: 1, name: 'mixed-shape' },
    { requestId: 'update-1', action: 'UPDATE', expectedVersion: 1, name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง' },
  ])('rejects spoofed, mixed, and incomplete PATCH shapes', async (body) => {
    const deps = dependencies()
    await expect(jsonRequest(createPmcMiniAppMiddleware(deps), 'PATCH', '/api/mini-app/stock/products/STK-000001', body, 'manager-token'))
      .resolves.toEqual({ status: 400, body: { error: 'STOCK_UNKNOWN_FIELD' } })
    expect(deps.stock.ingress.send).not.toHaveBeenCalled()
  })

  it('hides disabled routes and reports disabled Stock configuration without losing the staff role', async () => {
    const deps = dependencies({ enabled: false })
    const middleware = createPmcMiniAppMiddleware(deps)

    const route = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'manager-token')
    const config = await jsonRequest(middleware, 'GET', '/api/mini-app/config', null, 'manager-token')

    expect(route).toEqual({ status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' } })
    expect(config).toEqual(expect.objectContaining({
      status: 200,
      body: expect.objectContaining({ stockEnabled: false, canManageStock: true }),
    }))
    expect(deps.stock.readStore.listProducts).not.toHaveBeenCalled()
  })

  it('hides a manager pilot from staff while retaining manager routes', async () => {
    const deps = dependencies({ managerPilotOnly: true })
    const middleware = createPmcMiniAppMiddleware(deps)

    const staffConfig = await jsonRequest(middleware, 'GET', '/api/mini-app/config', null, 'staff-token')
    const staffRoute = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'staff-token')
    const managerConfig = await jsonRequest(middleware, 'GET', '/api/mini-app/config', null, 'manager-token')
    const managerRoute = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'manager-token')

    expect(staffConfig.body).toEqual(expect.objectContaining({ stockEnabled: false, canManageStock: false }))
    expect(staffRoute).toEqual({ status: 404, body: { error: 'MINI_APP_ROUTE_NOT_FOUND' } })
    expect(managerConfig.body).toEqual(expect.objectContaining({ stockEnabled: true, canManageStock: true }))
    expect(managerRoute.status).toBe(200)
  })

  it('bounds Stock JSON bodies at 64 KB', async () => {
    const deps = dependencies()
    const response = await jsonRequest(createPmcMiniAppMiddleware(deps), 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-large', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
      padding: 'x'.repeat(64 * 1024),
    }, 'staff-token')

    expect(response).toEqual({ status: 413, body: { error: 'STOCK_PAYLOAD_TOO_LARGE' } })
    expect(deps.stock.ingress.send).not.toHaveBeenCalled()
  })

  it('returns field-specific safe codes for invalid IDs, quantities, and adjustment reasons', async () => {
    const deps = dependencies()
    const middleware = createPmcMiniAppMiddleware(deps)

    const invalidId = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
      requestId: 'unsafe/request', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')
    const invalidQuantity = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-zero', lines: [{ productId: 'STK-000001', quantityMilli: 0 }],
    }, 'staff-token')
    const missingReason = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/adjustments', {
      requestId: 'adjust-reason', productId: 'STK-000001', countedQuantityMilli: 2_000, reason: '   ',
    }, 'manager-token')

    expect(invalidId).toEqual({ status: 400, body: { error: 'STOCK_INVALID_ID' } })
    expect(invalidQuantity).toEqual({ status: 400, body: { error: 'STOCK_INVALID_QUANTITY' } })
    expect(missingReason).toEqual({ status: 400, body: { error: 'STOCK_ADJUST_REASON_REQUIRED' } })
    expect(deps.stock.ingress.send).not.toHaveBeenCalled()
  })

  it('maps read integrity, command conflicts, and private failures to safe Stock codes', async () => {
    const integrity = dependencies()
    vi.mocked(integrity.stock.readStore.listProducts).mockRejectedValueOnce(
      new StockReadStoreError('STOCK_DATA_INTEGRITY_ERROR'),
    )
    expect(await jsonRequest(createPmcMiniAppMiddleware(integrity), 'GET', '/api/mini-app/stock/products', null, 'staff-token'))
      .toEqual({ status: 500, body: { error: 'STOCK_DATA_INTEGRITY_ERROR' } })

    const conflict = dependencies()
    vi.mocked(conflict.stock.ingress.send).mockRejectedValueOnce(new StockIngressClientError('STOCK_INSUFFICIENT_BALANCE'))
    expect(await jsonRequest(createPmcMiniAppMiddleware(conflict), 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-conflict', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')).toEqual({ status: 409, body: { error: 'STOCK_INSUFFICIENT_BALANCE' } })

    const spoofedCode = dependencies()
    vi.mocked(spoofedCode.stock.ingress.send).mockRejectedValueOnce({
      code: 'STOCK_INSUFFICIENT_BALANCE', private: 'sheet-1',
    })
    expect(await jsonRequest(createPmcMiniAppMiddleware(spoofedCode), 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-spoofed-code', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')).toEqual({ status: 503, body: { error: 'STOCK_STORAGE_UNAVAILABLE' } })

    const privateFailure = dependencies()
    vi.mocked(privateFailure.stock.ingress.send).mockRejectedValueOnce(new Error('private range STOCK_LEDGER!A:N'))
    expect(await jsonRequest(createPmcMiniAppMiddleware(privateFailure), 'POST', '/api/mini-app/stock/issues', {
      requestId: 'issue-failed', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
    }, 'staff-token')).toEqual({ status: 503, body: { error: 'STOCK_STORAGE_UNAVAILABLE' } })
  })
})

function dependencies(flags: { enabled?: boolean; managerPilotOnly?: boolean } = {}): {
  config: PmcMiniAppServerConfig
  identity: LineIdentityPort
  store: MiniAppStore
  stock: StockServerDependencies
} {
  const products = [productProjection()]
  const document = documentSummary()
  const readStore = {
    listProducts: vi.fn(async () => products),
    listHistory: vi.fn(async () => historyPage()),
    getDocument: vi.fn(async (documentId: string) => documentId === document.documentId ? document : null),
  }
  const ingress = {
    send: vi.fn(async (command: MiniAppStockCommand) => commandResult(command.requestId, command.commandType)),
  }
  return {
    config: {
      enabled: true,
      miniAppId: '2001234567-mini-app',
      lineChannelId: '2001234567',
      spreadsheetId: 'sheet-1',
      intakeFolderId: 'folder-1',
      bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
      fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
      bookingIngressSecret: 'private-ingress-secret',
      signingSecret: 'private-signing-secret',
      enrollmentPin: null,
      maxImageBytes: 10_000_000,
      maxFilesPerKind: 10,
      asyncBooking: null,
      stockEnabled: flags.enabled ?? true,
      stockManagerPilotOnly: flags.managerPilotOnly ?? false,
    },
    identity: {
      async verify(idToken) {
        if (idToken === 'staff-token') return { lineUserId: 'Ustaff-private' }
        if (idToken === 'manager-token') return { lineUserId: 'Umanager-private' }
        throw new Error('invalid')
      },
    },
    store: {
      getActiveStaffByLineUserId: vi.fn(async (lineUserId: string) => {
        if (lineUserId === 'Ustaff-private') return staffRecord('STAFF_01', 'มัส', lineUserId, false)
        if (lineUserId === 'Umanager-private') return staffRecord('ADMIN_07', 'อาย', lineUserId, true)
        return null
      }),
      getActiveBookingConfig: vi.fn(async () => ({ doctors: [], services: [], channels: [], aes: [] })),
    } as unknown as MiniAppStore,
    stock: {
      enabled: flags.enabled ?? true,
      managerPilotOnly: flags.managerPilotOnly ?? false,
      readStore,
      ingress,
    },
  }
}

function staffRecord(id: string, name: string, lineUserId: string, canManageStock: boolean) {
  return {
    id, name, email: 'private@example.com', lineUserId, canCloseBooking: true, canBeAe: true,
    canManageStock, active: true as const, profileImageUrl: null,
  }
}

function productProjection(): StockProductProjection {
  return {
    productId: 'STK-000001', name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
    minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
    hasLedgerActivity: true, version: 1,
  }
}

function documentSummary(): StockDocumentSummary {
  return {
    documentId: 'ISS-000001', requestId: 'issue-1', transactionType: 'ISSUE', actorStaffId: 'STAFF_01',
    actorDisplayName: 'มัส', createdAt: '2026-08-28T10:00:00.000Z', reason: '', lineCount: 1,
    lines: [{
      productId: 'STK-000001', productName: 'ถุงมือ', unit: 'กล่อง', quantityDeltaMilli: -1_000,
      balanceBeforeMilli: 5_000, balanceAfterMilli: 4_000,
    }],
  }
}

function historyPage() {
  return { documents: [documentSummary()], nextCursor: null }
}

function commandResult(requestId: string, commandType: MiniAppStockCommand['commandType']): StockCommandResult {
  return {
    requestId, documentId: `${commandType}-000001`, commandType, createdAt: '2026-08-28T10:00:00.000Z', lines: [],
  }
}

async function jsonRequest(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  idToken: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = createServer(middleware)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
