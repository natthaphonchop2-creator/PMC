// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig, StockProductProjection } from '../../src/apps/pmc-mini-app/contracts'
import {
  StockIssueFlow,
  type StockIssueFlowAdapter,
} from '../../src/apps/pmc-mini-app/stock/StockIssueFlow'
import {
  createIssueCommand,
  issueLines,
  type StockIssueState,
} from '../../src/apps/pmc-mini-app/stock/stockModel'
import type { StockCommandResult } from '../../shared/pmcStock'

afterEach(cleanup)

describe('PMC Stock issue model', () => {
  it('creates one ordered ISSUE command with positive milli-quantities', () => {
    const state: StockIssueState = {
      requestId: 'issue-request-1',
      products: [product('A', 5_000), product('B', 3_000)],
      lines: [
        { lineId: 'line-1', productId: 'A', quantity: '2' },
        { lineId: 'line-2', productId: 'B', quantity: '1.5' },
      ],
    }

    expect(issueLines(state)).toEqual([
      { productId: 'A', quantityMilli: 2_000 },
      { productId: 'B', quantityMilli: 1_500 },
    ])
    expect(createIssueCommand(state)).toEqual({
      requestId: 'issue-request-1',
      commandType: 'ISSUE',
      payload: { lines: [
        { productId: 'A', quantityMilli: 2_000 },
        { productId: 'B', quantityMilli: 1_500 },
      ] },
    })
  })

  it('rejects duplicate products before a command can be created', () => {
    const state: StockIssueState = {
      requestId: 'issue-request-1',
      products: [product('A', 5_000)],
      lines: [
        { lineId: 'line-1', productId: 'A', quantity: '1' },
        { lineId: 'line-2', productId: 'A', quantity: '1' },
      ],
    }

    expect(() => createIssueCommand(state)).toThrow('STOCK_DUPLICATE_LINE')
  })
})

describe('PMC Stock multi-product issue flow', () => {
  it('blocks the complete document when one projected balance is negative', async () => {
    const { adapter, user } = renderIssueFlow({ products: [product('A', 5_000), product('B', 1_000)] })
    await addLine(user, 1, 'A', '2')
    await addLine(user, 2, 'B', '2')

    const projectedBalances = screen.getAllByText('หลังเบิก').map((label) => label.parentElement)
    expect(projectedBalances[0]).toHaveTextContent('3 ชิ้น')
    expect(projectedBalances[1]).toHaveTextContent('-1 ชิ้น')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(screen.getByRole('alert')).toHaveTextContent('สินค้า B คงเหลือ 1 ชิ้น')
    expect(adapter.issue).not.toHaveBeenCalled()
  })

  it('submits multiple products once with one stable request ID', async () => {
    const { adapter, user } = renderIssueFlow({ products: [product('A', 5_000), product('B', 3_000)] })
    await addLine(user, 1, 'A', '2')
    await addLine(user, 2, 'B', '1.5')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(adapter.issue).toHaveBeenCalledOnce()
    expect(adapter.issue).toHaveBeenCalledWith({
      requestId: 'issue-request-1',
      commandType: 'ISSUE',
      payload: { lines: [
        { productId: 'A', quantityMilli: 2_000 },
        { productId: 'B', quantityMilli: 1_500 },
      ] },
    })
    expect(await screen.findByRole('heading', { name: 'เบิกสินค้าสำเร็จ' })).toBeVisible()
    expect(screen.getByText('ISS-000001')).toBeVisible()
  })

  it('prevents duplicate selections and rejects zero or more than three decimals', async () => {
    const { adapter, user } = renderIssueFlow({ products: [product('A', 5_000), product('B', 3_000)] })
    await user.selectOptions(screen.getByRole('combobox', { name: 'สินค้า 1' }), 'A')
    await user.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }))

    const secondProduct = screen.getByRole('combobox', { name: 'สินค้า 2' })
    expect(within(secondProduct).queryByRole('option', { name: 'A' })).not.toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'จำนวน 1' }))
    await user.type(screen.getByRole('textbox', { name: 'จำนวน 1' }), '1.2345')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(screen.getByRole('alert')).toHaveTextContent('จำนวนต้องมากกว่า 0 และไม่เกิน 3 ตำแหน่งทศนิยม')
    expect(adapter.issue).not.toHaveBeenCalled()
  })

  it('disables repeated submit while the document request is pending', async () => {
    const pending = deferred<StockCommandResult>()
    const { adapter, user } = renderIssueFlow({
      products: [product('A', 5_000)],
      issue: vi.fn(() => pending.promise),
    })
    await addLine(user, 1, 'A', '1')
    const submit = screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' })

    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(adapter.issue).toHaveBeenCalledOnce()

    await act(async () => pending.resolve(issueResult()))
    expect(await screen.findByRole('heading', { name: 'เบิกสินค้าสำเร็จ' })).toBeVisible()
  })

  it('reloads balances after a safe insufficient error, preserves the cart, and rotates the request ID when quantity changes', async () => {
    const issue = vi.fn()
      .mockRejectedValueOnce(safeError('STOCK_INSUFFICIENT_BALANCE'))
      .mockResolvedValueOnce(issueResult())
    const { adapter, user } = renderIssueFlow({
      products: [product('A', 5_000)],
      refreshedProducts: [product('A', 1_000)],
      issue,
      requestIds: ['issue-request-1', 'issue-request-2'],
    })
    await addLine(user, 1, 'A', '2')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(adapter.loadProducts).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent('อัปเดตยอดคงเหลือล่าสุดแล้ว')
    expect(screen.getByRole('combobox', { name: 'สินค้า 1' })).toHaveValue('A')
    expect(screen.getByRole('textbox', { name: 'จำนวน 1' })).toHaveValue('2')
    expect(screen.getByText('คงเหลือปัจจุบัน').parentElement).toHaveTextContent('1 ชิ้น')

    await user.clear(screen.getByRole('textbox', { name: 'จำนวน 1' }))
    await user.type(screen.getByRole('textbox', { name: 'จำนวน 1' }), '1')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(issue).toHaveBeenCalledTimes(2)
    expect(issue.mock.calls[0]![0].requestId).toBe('issue-request-1')
    expect(issue.mock.calls[1]![0].requestId).toBe('issue-request-2')
  })

  it('removes products missing after an inactive reload with explicit feedback and rotates the changed cart intent', async () => {
    const issue = vi.fn()
      .mockRejectedValueOnce(safeError('STOCK_PRODUCT_INACTIVE'))
      .mockResolvedValueOnce(issueResult())
    const { user } = renderIssueFlow({
      products: [product('A', 5_000), product('B', 3_000)],
      refreshedProducts: [product('A', 4_000)],
      issue,
      requestIds: ['issue-request-1', 'issue-request-2'],
    })
    await addLine(user, 1, 'A', '1')
    await addLine(user, 2, 'B', '1')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('นำสินค้า B ออกจากรายการเบิก')
    expect(screen.getAllByRole('combobox', { name: /สินค้า/ })).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'สินค้า 1' })).toHaveValue('A')
    expect(screen.getByRole('textbox', { name: 'จำนวน 1' })).toHaveValue('1')

    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
    expect(issue.mock.calls[0]![0].requestId).toBe('issue-request-1')
    expect(issue.mock.calls[1]![0].requestId).toBe('issue-request-2')
  })

  it('keeps the entire draft after a network or storage failure and uses the same request ID on retry', async () => {
    const issue = vi.fn()
      .mockRejectedValueOnce(safeError('MINI_APP_NETWORK_FAILED'))
      .mockResolvedValueOnce(issueResult())
    const { user } = renderIssueFlow({ products: [product('A', 5_000)], issue })
    await addLine(user, 1, 'A', '1.25')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ร่างรายการยังอยู่ครบ')
    expect(screen.getByRole('combobox', { name: 'สินค้า 1' })).toHaveValue('A')
    expect(screen.getByRole('textbox', { name: 'จำนวน 1' })).toHaveValue('1.25')

    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
    expect(issue.mock.calls[0]![0].requestId).toBe('issue-request-1')
    expect(issue.mock.calls[1]![0].requestId).toBe('issue-request-1')
  })

  it('mints a new ISSUE request ID when an uncertain retry changes the cart intent', async () => {
    const issue = vi.fn()
      .mockRejectedValueOnce(safeError('MINI_APP_NETWORK_FAILED'))
      .mockResolvedValueOnce(issueResult())
    const { user } = renderIssueFlow({
      products: [product('A', 5_000)],
      issue,
      requestIds: ['issue-request-1', 'issue-request-2'],
    })
    await addLine(user, 1, 'A', '1')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
    await user.clear(screen.getByRole('textbox', { name: 'จำนวน 1' }))
    await user.type(screen.getByRole('textbox', { name: 'จำนวน 1' }), '2')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))

    expect(issue.mock.calls[0]![0].requestId).toBe('issue-request-1')
    expect(issue.mock.calls[1]![0].requestId).toBe('issue-request-2')
  })

  it('refreshes products before returning from the success document to Stock Home', async () => {
    const refreshed = [product('A', 4_000)]
    const onReturnToStock = vi.fn()
    const { adapter, user } = renderIssueFlow({
      products: [product('A', 5_000)],
      refreshedProducts: refreshed,
      onReturnToStock,
    })
    await addLine(user, 1, 'A', '1')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
    await user.click(await screen.findByRole('button', { name: 'กลับหน้า Stock' }))

    expect(adapter.loadProducts).toHaveBeenCalledOnce()
    expect(onReturnToStock).toHaveBeenCalledWith(refreshed)
  })

  it('wires Stock Home into the issue flow and returns with a freshly loaded balance', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn()
      .mockResolvedValueOnce({ products: [product('A', 5_000)] })
      .mockResolvedValueOnce({ products: [product('A', 4_000)] })
    api.submitStockCommand = vi.fn(async () => issueResult())
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(await screen.findByRole('button', { name: 'เบิกสินค้า' }))
    expect(screen.getByRole('heading', { name: 'เบิกสินค้า' })).toBeVisible()
    await addLine(user, 1, 'A', '1')
    await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
    await user.click(await screen.findByRole('button', { name: 'กลับหน้า Stock' }))

    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.getByText('4 ชิ้น')).toBeVisible()
    expect(api.submitStockCommand).toHaveBeenCalledWith('preview-token', expect.objectContaining({ commandType: 'ISSUE' }))
  })
})

function renderIssueFlow({
  products,
  refreshedProducts = products,
  issue = vi.fn(async () => issueResult()),
  onReturnToStock = vi.fn(),
  requestIds = ['issue-request-1'],
}: {
  products: StockProductProjection[]
  refreshedProducts?: StockProductProjection[]
  issue?: StockIssueFlowAdapter['issue']
  onReturnToStock?: (products: StockProductProjection[]) => void
  requestIds?: string[]
}) {
  const user = userEvent.setup()
  const adapter: StockIssueFlowAdapter = {
    issue: vi.fn(issue),
    loadProducts: vi.fn(async () => ({ products: refreshedProducts })),
  }
  render(<StockIssueFlow
    initialProducts={products}
    adapter={adapter}
    requestIdFactory={() => requestIds.shift() ?? 'issue-request-exhausted'}
    onCancel={vi.fn()}
    onReturnToStock={onReturnToStock}
  />)
  return { adapter, user }
}

async function addLine(user: ReturnType<typeof userEvent.setup>, index: number, productId: string, quantity: string) {
  if (index > screen.getAllByRole('combobox', { name: /สินค้า/ }).length) {
    await user.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }))
  }
  await user.selectOptions(screen.getByRole('combobox', { name: `สินค้า ${index}` }), productId)
  const input = screen.getByRole('textbox', { name: `จำนวน ${index}` })
  await user.clear(input)
  await user.type(input, quantity)
}

function product(name: string, onHandMilli: number): StockProductProjection {
  return {
    productId: name,
    name,
    category: 'CLINIC_SUPPLY',
    unit: 'ชิ้น',
    minimumQuantityMilli: 1_000,
    onHandMilli,
    lowStock: onHandMilli <= 1_000,
    active: true,
    hasLedgerActivity: true,
    version: 1,
  }
}

function issueResult(): StockCommandResult {
  return {
    requestId: 'issue-request-1',
    documentId: 'ISS-000001',
    commandType: 'ISSUE',
    createdAt: '2026-08-28T10:00:00.000Z',
    lines: [{ productId: 'A', quantityDeltaMilli: -1_000, balanceAfterMilli: 4_000 }],
  }
}

function safeError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const config: MiniAppConfig = {
  miniAppId: 'mini-id', fallbackFormUrl: '', reportingEnabled: false, stockEnabled: true, canManageStock: false,
  doctors: [], services: [], channels: [], aes: [],
}

function miniAppApi(): PmcMiniAppApi {
  return {
    initialize: vi.fn(async () => 'token'),
    loadSession: vi.fn(), loadEnrollmentOptions: vi.fn(), enroll: vi.fn(), loadConfig: vi.fn(),
    createDraft: vi.fn(), loadDraft: vi.fn(), upload: vi.fn(), save: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    loadReport: vi.fn(), refreshReport: vi.fn(), loadStockProducts: vi.fn(), loadStockHistory: vi.fn(), submitStockCommand: vi.fn(),
  }
}
