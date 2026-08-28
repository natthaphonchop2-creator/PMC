// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig, StockProductProjection } from '../../src/apps/pmc-mini-app/contracts'
import { StockIssueFlow } from '../../src/apps/pmc-mini-app/stock/StockIssueFlow'
import {
  StockManager,
  type StockManagerAdapter,
  type StockManagerMode,
} from '../../src/apps/pmc-mini-app/stock/StockManager'
import { canEditProductUnit, createAdjustmentCommand } from '../../src/apps/pmc-mini-app/stock/stockModel'
import type { StockClientCommand, StockCommandResult } from '../../shared/pmcStock'

afterEach(cleanup)

describe('PMC Stock manager models', () => {
  it('builds an ADJUST command from a nonnegative physical count and trimmed reason', () => {
    expect(createAdjustmentCommand({
      requestId: 'adjust-request-1',
      product: product('A', 5_000),
      countedQuantity: '0',
      reason: '  ตรวจนับประจำเดือน  ',
    })).toEqual({
      requestId: 'adjust-request-1',
      commandType: 'ADJUST',
      payload: { productId: 'A', countedQuantityMilli: 0, reason: 'ตรวจนับประจำเดือน' },
    })
  })

  it('rejects an empty or overlong adjustment reason', () => {
    const base = { requestId: 'adjust-request-1', product: product('A', 5_000), countedQuantity: '3' }
    expect(() => createAdjustmentCommand({ ...base, reason: '   ' })).toThrow('STOCK_ADJUST_REASON_REQUIRED')
    expect(() => createAdjustmentCommand({ ...base, reason: 'ก'.repeat(301) })).toThrow('STOCK_ADJUST_REASON_REQUIRED')
  })

  it('locks a product unit only after ledger activity exists', () => {
    expect(canEditProductUnit(product('A', 5_000, { hasLedgerActivity: false }))).toBe(true)
    expect(canEditProductUnit(product('A', 5_000, { hasLedgerActivity: true }))).toBe(false)
  })
})

describe('PMC Stock manager flows', () => {
  it('creates a product with exactly the five product fields, preserves the draft on failure, and refreshes after retry success', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(safeError('STOCK_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(commandResult('CREATE_PRODUCT', 'STK-000003'))
    const { adapter, user } = renderManager({ mode: 'MANAGE', submit })

    await user.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }))
    await user.type(screen.getByRole('textbox', { name: 'ชื่อสินค้า' }), ' เข็มฉีดยา ')
    await user.selectOptions(screen.getByRole('combobox', { name: 'หมวดหมู่' }), 'CLINIC_SUPPLY')
    await user.type(screen.getByRole('textbox', { name: 'หน่วย' }), ' กล่อง ')
    await user.type(screen.getByRole('textbox', { name: 'จำนวนเริ่มต้น' }), '2.5')
    await user.type(screen.getByRole('textbox', { name: 'จำนวนขั้นต่ำ' }), '1')
    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลที่กรอกยังอยู่ครบ')
    expect(screen.getByRole('textbox', { name: 'ชื่อสินค้า' })).toHaveValue(' เข็มฉีดยา ')
    expect(screen.getByRole('textbox', { name: 'จำนวนเริ่มต้น' })).toHaveValue('2.5')

    await user.click(screen.getByRole('button', { name: 'บันทึกสินค้า' }))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenNthCalledWith(1, {
      requestId: 'manager-request-1',
      commandType: 'CREATE_PRODUCT',
      payload: {
        name: 'เข็มฉีดยา', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
        openingQuantityMilli: 2_500, minimumQuantityMilli: 1_000,
      },
    })
    expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0])
    expect(await screen.findByRole('heading', { name: 'เพิ่มสินค้าสำเร็จ' })).toBeVisible()
    expect(screen.getByText('STK-000003')).toBeVisible()
    expect(adapter.loadProducts).toHaveBeenCalledOnce()
  })

  it('reuses the line editor for one positive multi-product RECEIVE command with receive-specific copy', async () => {
    const { adapter, user } = renderManager({
      mode: 'RECEIVE',
      initialProducts: [product('A', 5_000), product('B', 3_000)],
    })
    expect(screen.getByText('เลือกสินค้ารับเข้าได้หลายรายการ โดยไม่เลือกซ้ำ')).toBeVisible()
    expect(screen.queryByText(/รายการเบิก/)).not.toBeInTheDocument()

    await addReceiveLine(user, 1, 'A', '2')
    await user.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }))
    await addReceiveLine(user, 2, 'B', '1.25')

    expect(screen.getAllByText('หลังรับเข้า')[0]!.parentElement).toHaveTextContent('7 กล่อง')
    expect(screen.queryByText(/ติดลบ|ไม่เพียงพอ/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ยืนยันรับเข้า' }))

    expect(adapter.submit).toHaveBeenCalledOnce()
    expect(adapter.submit).toHaveBeenCalledWith({
      requestId: 'manager-request-1',
      commandType: 'RECEIVE',
      payload: { lines: [
        { productId: 'A', quantityMilli: 2_000 },
        { productId: 'B', quantityMilli: 1_250 },
      ] },
    })
    expect(await screen.findByRole('heading', { name: 'รับเข้าสำเร็จ' })).toBeVisible()
  })

  it('guards a RECEIVE from repeated submit while one complete document is pending', async () => {
    const pending = deferred<StockCommandResult>()
    const { adapter, user } = renderManager({ mode: 'RECEIVE', submit: vi.fn(() => pending.promise) })
    await addReceiveLine(user, 1, 'A', '2')
    const confirm = screen.getByRole('button', { name: 'ยืนยันรับเข้า' })

    await user.click(confirm)
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(adapter.submit).toHaveBeenCalledOnce()

    await act(async () => pending.resolve(commandResult('RECEIVE', 'REC-000001')))
    expect(await screen.findByRole('heading', { name: 'รับเข้าสำเร็จ' })).toBeVisible()
  })

  it('preserves the RECEIVE cart and stable request ID across a storage retry', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(safeError('STOCK_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(commandResult('RECEIVE', 'REC-000001'))
    const { adapter, user } = renderManager({ mode: 'RECEIVE', submit })
    await addReceiveLine(user, 1, 'A', '2')
    await user.click(screen.getByRole('button', { name: 'ยืนยันรับเข้า' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('รายการรับเข้ายังอยู่ครบ')
    expect(screen.getByRole('combobox', { name: 'สินค้า 1' })).toHaveValue('A')
    expect(screen.getByRole('textbox', { name: 'จำนวนรับเข้า 1' })).toHaveValue('2')

    await user.click(screen.getByRole('button', { name: 'ยืนยันรับเข้า' }))
    expect(adapter.submit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(adapter.submit).mock.calls[1]![0]).toEqual(vi.mocked(adapter.submit).mock.calls[0]![0])
  })

  it('requires an adjustment reason, previews the signed delta, and accepts an exact zero count', async () => {
    const { adapter, user } = renderManager({ mode: 'MANAGE' })
    await user.click(screen.getByRole('button', { name: 'ปรับยอด A' }))
    const counted = screen.getByRole('textbox', { name: 'จำนวนที่นับจริง' })
    await user.type(counted, '5')
    expect(screen.getByText('ยอดตรงกัน 0 กล่อง')).toBeVisible()
    await user.clear(counted)
    await user.type(counted, '3')
    expect(screen.getByText('ปรับลด 2 กล่อง')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันปรับยอด' }))

    expect(screen.getByRole('alert')).toHaveTextContent('กรุณาระบุเหตุผล')
    expect(adapter.submit).not.toHaveBeenCalled()

    await user.clear(counted)
    await user.type(counted, '0')
    await user.type(screen.getByRole('textbox', { name: 'เหตุผล' }), '  ตรวจนับจริง  ')
    expect(screen.getByText('ปรับลด 5 กล่อง')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันปรับยอด' }))

    expect(adapter.submit).toHaveBeenCalledWith({
      requestId: 'manager-request-1',
      commandType: 'ADJUST',
      payload: { productId: 'A', countedQuantityMilli: 0, reason: 'ตรวจนับจริง' },
    })
  })

  it('uses the latest product version, locks an active ledger unit, and preserves review fields after a stale refresh', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(safeError('STOCK_STALE_PRODUCT'))
      .mockResolvedValueOnce(commandResult('UPDATE_PRODUCT', 'A'))
    const latest = product('A', 5_000, { version: 3, minimumQuantityMilli: 2_000 })
    const { adapter, user } = renderManager({ mode: 'MANAGE', submit, refreshedProducts: [latest, products[1]!] })
    await user.click(screen.getByRole('button', { name: 'แก้ไข A' }))

    const unit = screen.getByRole('textbox', { name: 'หน่วย' })
    expect(unit).toBeDisabled()
    expect(screen.getByText('หน่วยเปลี่ยนไม่ได้เพราะมีประวัติ Stock แล้ว')).toBeVisible()
    const name = screen.getByRole('textbox', { name: 'ชื่อสินค้า' })
    await user.clear(name)
    await user.type(name, 'A รุ่นใหม่')
    const minimum = screen.getByRole('textbox', { name: 'จำนวนขั้นต่ำ' })
    await user.clear(minimum)
    await user.type(minimum, '2')
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบอีกครั้ง')
    expect(adapter.loadProducts).toHaveBeenCalledOnce()
    expect(name).toHaveValue('A รุ่นใหม่')
    expect(minimum).toHaveValue('2')

    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[0]![0]).toMatchObject({
      requestId: 'manager-request-1', commandType: 'UPDATE_PRODUCT',
      payload: { productId: 'A', expectedVersion: 1, unit: 'กล่อง' },
    })
    expect(submit.mock.calls[1]![0]).toEqual({
      requestId: 'manager-request-1',
      commandType: 'UPDATE_PRODUCT',
      payload: {
        productId: 'A', expectedVersion: 3, name: 'A รุ่นใหม่', category: 'CLINIC_SUPPLY',
        unit: 'กล่อง', minimumQuantityMilli: 2_000,
      },
    })
  })

  it('allows a unit update before ledger activity and uses the exact PATCH command payload', async () => {
    const editable = product('C', 0, { hasLedgerActivity: false, unit: 'ชิ้น', minimumQuantityMilli: 0 })
    const { adapter, user } = renderManager({ mode: 'MANAGE', initialProducts: [editable] })
    await user.click(screen.getByRole('button', { name: 'แก้ไข C' }))
    const unit = screen.getByRole('textbox', { name: 'หน่วย' })
    expect(unit).toBeEnabled()
    await user.clear(unit)
    await user.type(unit, 'แพ็ก')
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }))

    expect(adapter.submit).toHaveBeenCalledWith({
      requestId: 'manager-request-1',
      commandType: 'UPDATE_PRODUCT',
      payload: {
        productId: 'C', expectedVersion: 1, name: 'C', category: 'CLINIC_SUPPLY',
        unit: 'แพ็ก', minimumQuantityMilli: 0,
      },
    })
  })

  it('confirms deactivate and reactivate without offering delete or history editing', async () => {
    const { adapter, user } = renderManager({ mode: 'MANAGE' })
    expect(screen.queryByRole('button', { name: /ลบสินค้า|แก้ไขประวัติ/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ปิดใช้งาน A' }))
    const deactivateDialog = screen.getByRole('dialog', { name: 'ยืนยันปิดใช้งานสินค้า' })
    await user.click(within(deactivateDialog).getByRole('button', { name: 'ยืนยันปิดใช้งาน' }))
    expect(adapter.submit).toHaveBeenLastCalledWith({
      requestId: 'manager-request-1', commandType: 'DEACTIVATE_PRODUCT',
      payload: { productId: 'A', expectedVersion: 1 },
    })

    await user.click(await screen.findByRole('button', { name: 'กลับหน้า Stock' }))
    expect(adapter.loadProducts).toHaveBeenCalled()

    cleanup()
    const reactivation = renderManager({ mode: 'MANAGE' })
    await reactivation.user.click(screen.getByRole('button', { name: 'เปิดใช้งาน B' }))
    const reactivateDialog = screen.getByRole('dialog', { name: 'ยืนยันเปิดใช้งานสินค้า' })
    await reactivation.user.click(within(reactivateDialog).getByRole('button', { name: 'ยืนยันเปิดใช้งาน' }))
    expect(reactivation.adapter.submit).toHaveBeenLastCalledWith({
      requestId: 'manager-request-1', commandType: 'REACTIVATE_PRODUCT',
      payload: { productId: 'B', expectedVersion: 4 },
    })
  })

  it('renders receive-specific empty copy while preserving the ISSUE empty and quantity copy', async () => {
    const user = userEvent.setup()
    render(<StockIssueFlow
      initialProducts={[product('A', 5_000)]}
      adapter={{ issue: vi.fn(), loadProducts: vi.fn() }}
      onCancel={vi.fn()}
      onReturnToStock={vi.fn()}
      requestIdFactory={() => 'issue-request-1'}
    />)
    expect(screen.getByRole('textbox', { name: 'จำนวน 1' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ลบสินค้า 1' }))
    expect(screen.getByText('ยังไม่มีสินค้าในรายการเบิก')).toBeVisible()
    expect(screen.queryByText(/รายการรับเข้า/)).not.toBeInTheDocument()
  })
})

describe('PMC Stock manager authorization shell', () => {
  it('hides every manager route from non-managers', async () => {
    const user = userEvent.setup()
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, canManageStock: false }}
      api={miniAppApi()}
    />)
    await user.click(screen.getByRole('button', { name: 'Stock' }))

    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'รับเข้า' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'จัดการสินค้า' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'เพิ่มสินค้าใหม่' })).not.toBeInTheDocument()
  })

  it('wires both manager entries only for managers and returns to refreshed Stock Home', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_07', displayName: 'อาย', active: true }}
      initialConfig={{ ...config, canManageStock: true }}
      api={api}
    />)
    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(await screen.findByRole('button', { name: 'รับเข้า' }))
    expect(screen.getByRole('heading', { name: 'รับเข้าสินค้า' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยกเลิกการรับเข้าสินค้า' }))

    await user.click(screen.getByRole('button', { name: 'จัดการสินค้า' }))
    expect(screen.getByRole('heading', { name: 'จัดการสินค้า' })).toBeVisible()
    expect(screen.queryByText(/Sheet|JERA|ลูกค้า|Case/i)).not.toBeInTheDocument()
  })
})

function renderManager({
  mode,
  initialProducts = products,
  refreshedProducts = initialProducts,
  submit = vi.fn(async (command: StockClientCommand) => commandResult(command.commandType, resultId(command))),
}: {
  mode: StockManagerMode
  initialProducts?: StockProductProjection[]
  refreshedProducts?: StockProductProjection[]
  submit?: StockManagerAdapter['submit']
}) {
  const user = userEvent.setup()
  const adapter: StockManagerAdapter = {
    submit: vi.fn(submit),
    loadProducts: vi.fn(async () => ({ products: refreshedProducts })),
  }
  render(<StockManager
    initialProducts={initialProducts}
    initialMode={mode}
    adapter={adapter}
    onCancel={vi.fn()}
    onReturnToStock={vi.fn()}
    requestIdFactory={() => 'manager-request-1'}
  />)
  return { adapter, user }
}

async function addReceiveLine(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  productId: string,
  quantity: string,
) {
  await user.selectOptions(screen.getByRole('combobox', { name: `สินค้า ${index}` }), productId)
  const input = screen.getByRole('textbox', { name: `จำนวนรับเข้า ${index}` })
  await user.clear(input)
  await user.type(input, quantity)
}

const products: StockProductProjection[] = [
  product('A', 5_000),
  product('B', 3_000, { active: false, version: 4 }),
]

function product(
  name: string,
  onHandMilli: number,
  patch: Partial<StockProductProjection> = {},
): StockProductProjection {
  return {
    productId: name,
    name,
    category: 'CLINIC_SUPPLY',
    unit: 'กล่อง',
    minimumQuantityMilli: 1_000,
    onHandMilli,
    lowStock: onHandMilli <= 1_000,
    active: true,
    hasLedgerActivity: true,
    version: 1,
    ...patch,
  }
}

function commandResult(commandType: StockCommandResult['commandType'], documentId: string): StockCommandResult {
  return {
    requestId: 'manager-request-1', documentId, commandType,
    createdAt: '2026-08-28T10:00:00.000Z', lines: [],
  }
}

function resultId(command: StockClientCommand): string {
  return 'productId' in command.payload ? command.payload.productId : `${command.commandType}-000001`
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
  miniAppId: 'mini-id', fallbackFormUrl: '', reportingEnabled: false,
  stockEnabled: true, canManageStock: true,
  doctors: [], services: [], channels: [], aes: [],
}

function miniAppApi(): PmcMiniAppApi {
  return {
    initialize: vi.fn(async () => 'token'),
    loadSession: vi.fn(), loadEnrollmentOptions: vi.fn(), enroll: vi.fn(), loadConfig: vi.fn(),
    createDraft: vi.fn(), loadDraft: vi.fn(), upload: vi.fn(), save: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    loadReport: vi.fn(), refreshReport: vi.fn(),
    loadStockProducts: vi.fn(async () => ({ products })),
    loadStockHistory: vi.fn(),
    submitStockCommand: vi.fn(async (command) => commandResult(command.commandType, resultId(command))),
  }
}
