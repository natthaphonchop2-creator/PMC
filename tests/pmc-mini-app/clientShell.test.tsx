// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig } from '../../src/apps/pmc-mini-app/contracts'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('PMC LINE Mini App shell', () => {
  it('hides JERA navigation while reporting is paused', () => {
    const view = render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={miniAppApi()}
    />)

    expect(screen.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(screen.getByText('จัดการงานจองของคลินิก')).toBeVisible()
    expect(screen.getByRole('button', { name: 'เริ่มลงนัด' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'รายงานคลินิก' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'รายงาน' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Google Form สำรอง' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stock' })).toBeDisabled()
    expect(screen.getByText('ยังไม่เปิดใช้งาน')).toBeVisible()
    expect(screen.getByRole('button', { name: 'บัญชีผู้ใช้' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Promed Clinic' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })).toHaveStyle({
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    })
    expect(screen.queryByText('LINE Assistant')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'ระบบงานคลินิก' })).not.toBeInTheDocument()
    expect(view.container.querySelectorAll('.pmc-home-primary-card')).toHaveLength(1)
    expect(view.container.querySelectorAll('.pmc-home-quick-card')).toHaveLength(1)
  })

  it('shows JERA navigation when reporting is enabled later', () => {
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, reportingEnabled: true }}
      api={miniAppApi()}
    />)

    expect(screen.getByText('จัดการงานจองและรายงานของคลินิก')).toBeVisible()
    expect(screen.getByRole('button', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'รายงาน' })).toBeVisible()
  })

  it('opens a server-created booking draft from the home action', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))

    expect(api.createDraft).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'ข้อมูลลูกค้า' })).toBeVisible()
  })

  it('starts on Home and opens the latest active request only after a booking action', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    api.initialize = vi.fn(async () => 'raw-id-token')
    api.loadSession = vi.fn(async () => ({ staffId: 'ADMIN_01', displayName: 'มัส', active: true }))
    api.loadConfig = vi.fn(async () => config)
    api.loadLatestActiveDraft = vi.fn(async () => ({
      draftId: 'draft-queued', requestId: 'request-queued', state: 'QUEUED', retentionState: '', version: 5, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: '2026-08-28T10:00:00.000Z', lastProgressAt: null,
    }))
    render(<PmcMiniApp api={api} />)

    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(api.loadLatestActiveDraft).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))

    expect(await screen.findByText('รับรายการแล้ว')).toBeVisible()
    expect(api.loadLatestActiveDraft).toHaveBeenCalledOnce()
    expect(api.createDraft).not.toHaveBeenCalled()
  })

  it('resumes a saved staged draft on preview without asking for evidence again', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const input = {
      requestId: 'request-ready', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    }
    api.initialize = vi.fn(async () => 'raw-id-token')
    api.loadSession = vi.fn(async () => ({ staffId: 'ADMIN_01', displayName: 'มัส', active: true }))
    api.loadConfig = vi.fn(async () => config)
    api.loadLatestActiveDraft = vi.fn(async () => ({
      draftId: 'draft-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM', retentionState: '', version: 3, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 3, chatEvidenceCount: 1, confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    api.loadDraft = vi.fn(async () => ({
      draftId: 'draft-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM', retentionState: '', version: 3, input,
      paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 3, chatEvidenceCount: 1, confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))

    render(<PmcMiniApp api={api} />)

    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(api.loadLatestActiveDraft).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))

    expect(await screen.findByRole('heading', { name: 'ตรวจสอบก่อนยืนยัน' })).toBeVisible()
    expect(screen.getByText('สลิป 3 รูป')).toBeVisible()
    expect(screen.getByText('แชท 1 รูป')).toBeVisible()
    expect(api.createDraft).not.toHaveBeenCalled()
  })

  it('returns home immediately after async queue acknowledgement', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const input = {
      requestId: 'request-ready', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    }
    const ready = {
      draftId: 'draft-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM' as const, retentionState: '' as const,
      version: 3, input, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 2, chatEvidenceCount: 1,
      confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }
    api.createDraft = vi.fn(async () => ready)
    api.confirm = vi.fn(async () => ({
      requestId: input.requestId,
      status: 'QUEUED' as const,
      projection: { ...ready, state: 'QUEUED' as const, version: 4, input: null, queuedAt: '2026-08-29T10:00:00.000Z' },
    }))
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
    expect(await screen.findByRole('heading', { name: 'ตรวจสอบก่อนยืนยัน' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('ทำรายการเรียบร้อย ระบบจะบันทึกภายใน 5 นาที')
    expect(toast).toHaveClass('success')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 3_500 })
  })

  it('single-flights deferred home and bottom booking taps before creating a draft', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    let resolveActive!: (draft: null) => void
    const activeDraft = new Promise<null>((resolve) => { resolveActive = resolve })
    api.loadLatestActiveDraft = vi.fn(async () => activeDraft)
    api.createDraft = vi.fn(async () => ({
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }))
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
    await user.click(screen.getByRole('button', { name: 'ลงนัด' }))

    expect(api.loadLatestActiveDraft).toHaveBeenCalledOnce()
    expect(api.createDraft).not.toHaveBeenCalled()

    resolveActive(null)
    expect(await screen.findByRole('heading', { name: 'ข้อมูลลูกค้า' })).toBeVisible()
    expect(api.createDraft).toHaveBeenCalledOnce()
  })

  it('opens Stock only when role-filtered Stock configuration enables it', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true, canManageStock: false }}
      api={api}
    />)

    expect(screen.getByRole('button', { name: 'Stock' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'สต็อก' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Stock' }))

    expect(api.loadStockProducts).toHaveBeenCalledWith('preview-token')
    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.getByText('4 กล่อง')).toBeVisible()
  })

  it('does not let a stale Stock success pull the user back from Account', async () => {
    const user = userEvent.setup()
    const pending = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockProducts']>>>()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn(() => pending.promise)
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(screen.getByRole('button', { name: 'บัญชี' }))
    expect(screen.getByRole('heading', { name: 'บัญชี' })).toBeVisible()

    await act(async () => pending.resolve({ products: [stockProduct('ถุงมือจากคำขอเก่า', 'STK-OLD')] }))

    expect(screen.getByRole('heading', { name: 'บัญชี' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Stock' })).not.toBeInTheDocument()
    expect(screen.queryByText('ถุงมือจากคำขอเก่า')).not.toBeInTheDocument()
  })

  it('does not show an error from a rejected Stock request after navigation away', async () => {
    const user = userEvent.setup()
    const pending = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockProducts']>>>()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn(() => pending.promise)
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(screen.getByRole('button', { name: 'บัญชี' }))
    await act(async () => pending.reject(new Error('stale Stock failure')))

    expect(screen.getByRole('heading', { name: 'บัญชี' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the second Stock open result when the first request settles later', async () => {
    const user = userEvent.setup()
    const first = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockProducts']>>>()
    const second = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockProducts']>>>()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await user.click(screen.getByRole('button', { name: 'สต็อก' }))
    await act(async () => second.resolve({ products: [stockProduct('ผลล่าสุด', 'STK-NEW')] }))
    expect(screen.getByText('ผลล่าสุด')).toBeVisible()

    await act(async () => first.resolve({ products: [stockProduct('ผลเก่า', 'STK-OLD')] }))

    expect(screen.getByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.getByText('ผลล่าสุด')).toBeVisible()
    expect(screen.queryByText('ผลเก่า')).not.toBeInTheDocument()
    expect(screen.queryByText('กำลังเตรียมรายการ')).not.toBeInTheDocument()
  })

  it('shows one current Stock failure and remains on the page that initiated it', async () => {
    const user = userEvent.setup()
    const pending = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockProducts']>>>()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn(() => pending.promise)
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    await act(async () => pending.reject(new Error('current Stock failure')))

    expect(screen.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดรายการสต็อกไม่สำเร็จ กรุณาลองอีกครั้ง')
  })

  it('clears completed Stock errors through Home cards and bottom navigation', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    api.loadStockProducts = vi.fn()
      .mockRejectedValueOnce(new Error('current Stock failure'))
      .mockResolvedValue({ products: [stockProduct('ถุงมือ', 'STK-1')] })
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true, reportingEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))
    expect(screen.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps Stock navigation active while the initial history page is loading', async () => {
    const user = userEvent.setup()
    const pendingHistory = deferred<Awaited<ReturnType<PmcMiniAppApi['loadStockHistory']>>>()
    const api = miniAppApi()
    api.loadStockHistory = vi.fn(() => pendingHistory.promise)
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, stockEnabled: true, reportingEnabled: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'Stock' }))
    expect(await screen.findByRole('heading', { name: 'Stock' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ประวัติ' }))
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeVisible()
    expect(screen.getByText('กำลังเตรียมรายการ')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'บัญชี' }))
    expect(screen.getByRole('heading', { name: 'บัญชี' })).toBeVisible()

    await act(async () => pendingHistory.resolve({ documents: [], nextCursor: null }))
    expect(screen.getByRole('heading', { name: 'บัญชี' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'ประวัติ Stock' })).not.toBeInTheDocument()
  })

  it('links an unknown LINE account with one short mobile PIN form', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    api.initialize = vi.fn(async () => 'raw-id-token')
    api.loadSession = vi.fn(async () => { throw Object.assign(new Error('not mapped'), { code: 'STAFF_NOT_ALLOWED' }) })
    api.loadEnrollmentOptions = vi.fn(async () => ({ staff: [{ id: 'staff-open', name: 'หมวย' }] }))
    api.enroll = vi.fn(async () => ({ staffId: 'staff-open', displayName: 'หมวย', active: true }))
    api.loadConfig = vi.fn(async () => config)
    render(<PmcMiniApp api={api} />)

    expect(await screen.findByRole('heading', { name: 'ผูกบัญชีครั้งแรก' })).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: 'ชื่อพนักงาน' }), 'staff-open')
    const pin = screen.getByLabelText(/PIN บริษัท/)
    expect(pin).toHaveAttribute('type', 'password')
    expect(pin).toHaveAttribute('inputmode', 'numeric')
    expect(pin).toHaveAttribute('autocomplete', 'one-time-code')
    await user.type(pin, '482731')
    await user.click(screen.getByRole('button', { name: 'ผูกบัญชี' }))

    expect(await screen.findByRole('heading', { name: 'สวัสดี, หมวย' })).toBeVisible()
    expect(api.enroll).toHaveBeenCalledWith('raw-id-token', 'staff-open', '482731')
  })
})

const config: MiniAppConfig = {
  miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', reportingEnabled: false,
  stockEnabled: false, canManageStock: false,
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }],
}

function miniAppApi(): PmcMiniAppApi {
  return {
    initialize: vi.fn(async () => 'token'),
    loadSession: vi.fn(), loadEnrollmentOptions: vi.fn(), enroll: vi.fn(), loadConfig: vi.fn(),
    loadLatestActiveDraft: vi.fn(async () => null),
    createDraft: vi.fn(async () => ({
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    })),
    loadDraft: vi.fn(),
    upload: vi.fn(), save: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    loadReport: vi.fn(), refreshReport: vi.fn(),
    loadStockProducts: vi.fn(async () => ({ products: [{
      productId: 'STK-000001', name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
      minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
      hasLedgerActivity: true, version: 2,
    }] })),
    loadStockHistory: vi.fn(), submitStockCommand: vi.fn(),
  }
}

function stockProduct(name: string, productId: string) {
  return {
    productId, name, category: 'CLINIC_SUPPLY' as const, unit: 'กล่อง',
    minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
    hasLedgerActivity: true, version: 2,
  }
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
