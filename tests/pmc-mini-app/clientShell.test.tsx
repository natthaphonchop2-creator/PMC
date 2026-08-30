// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MiniAppApiError,
  PMC_BOOKING_TIMING_EVENT,
  type BrowserBookingTiming,
  type MiniAppApiFactory,
} from '../../src/apps/pmc-mini-app/api'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig } from '../../src/apps/pmc-mini-app/contracts'

afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear(); localStorage.clear() })

describe('PMC LINE Mini App shell', () => {
  it('stores finance filter preferences in sessionStorage only at the shell boundary', async () => {
    localStorage.setItem('pmc-finance-report-filters-v1', 'local-sentinel')

    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, financeReportsEnabled: true }}
      api={miniAppApi()}
    />)

    await waitFor(() => expect(sessionStorage.getItem('pmc-finance-report-filters-v1')).not.toBeNull())
    expect(localStorage.getItem('pmc-finance-report-filters-v1')).toBe('local-sentinel')
  })

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

  it('replaces the primary report catalog only when the finance flag is enabled', async () => {
    const user = userEvent.setup()
    render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, financeReportsEnabled: true, canViewFinance: false }}
      api={miniAppApi()}
    />)

    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))

    expect(screen.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByRole('button', { name: /รายรับรายวัน/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /รายงานรายเดือน/ })).toHaveAttribute('aria-disabled', 'true')
    for (const legacyLabel of ['สรุปวันนี้', 'มัดจำ', 'นัดหมาย', 'รายงานเพิ่มเติม']) {
      expect(screen.queryByText(legacyLabel)).not.toBeInTheDocument()
    }
  })

  it('keeps the legacy ReportCenter as the exact rollback path when the finance flag is off', async () => {
    const user = userEvent.setup()
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, reportingEnabled: true, financeReportsEnabled: false }}
      api={miniAppApi()}
    />)

    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))

    expect(screen.getByText('สรุปวันนี้')).toBeVisible()
    expect(screen.getByText('มัดจำ')).toBeVisible()
    expect(screen.getByText('นัดหมาย')).toBeVisible()
    expect(screen.getByText('รายงานเพิ่มเติม')).toBeVisible()
    expect(screen.queryByRole('button', { name: /รายรับรายวัน/ })).not.toBeInTheDocument()
  })

  it('opens daily income for every staff member and monthly income only for finance staff', async () => {
    const user = userEvent.setup()
    const ordinaryApi = miniAppApi()
    const ordinary = render(<PmcMiniApp
      initialSession={{ staffId: 'STAFF_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, financeReportsEnabled: true, canViewFinance: false }}
      api={ordinaryApi}
    />)
    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))
    await user.click(screen.getByRole('button', { name: /รายรับรายวัน/ }))
    expect(await screen.findByRole('heading', { name: 'รายรับรายวัน' })).toBeVisible()
    expect(ordinaryApi.loadDailyIncome).toHaveBeenCalledOnce()
    ordinary.unmount()

    const financeApi = miniAppApi()
    render(<PmcMiniApp
      initialSession={{ staffId: 'FINANCE_01', displayName: 'อาย', active: true }}
      initialConfig={{ ...config, financeReportsEnabled: true, canViewFinance: true }}
      api={financeApi}
    />)
    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))
    await user.click(screen.getByRole('button', { name: /รายงานรายเดือน/ }))
    expect(await screen.findByRole('heading', { name: 'รายงานรายเดือน' })).toBeVisible()
    expect(financeApi.loadMonthlyIncome).toHaveBeenCalledOnce()
  })

  it('drills from a monthly trend into the selected daily range', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    render(<PmcMiniApp
      initialSession={{ staffId: 'FINANCE_01', displayName: 'อาย', active: true }}
      initialConfig={{ ...config, financeReportsEnabled: true, canViewFinance: true }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'รายงานคลินิก' }))
    await user.click(screen.getByRole('button', { name: /รายงานรายเดือน/ }))
    await user.click(await screen.findByRole('button', { name: 'ดูรายรับวันที่ 2026-08-29' }))

    expect(await screen.findByRole('heading', { name: 'รายรับรายวัน' })).toBeVisible()
    expect(api.loadDailyIncome).toHaveBeenCalledWith('preview-token', {
      preset: 'CUSTOM', startDate: '2026-08-29', endDate: '2026-08-29',
    })
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

  it('shows one persistent close-and-reopen instruction for a cached booking client', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    vi.mocked(api.createDraft).mockRejectedValueOnce(new MiniAppApiError('CLIENT_UPGRADE_REQUIRED', 409))
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={{ ...config, bookingProtocol: undefined }}
      api={api}
    />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))

    const instruction = await screen.findByRole('alert')
    expect(instruction).toHaveTextContent('กรุณาปิดหน้าต่างนี้ แล้วเปิด Mini App จาก LINE ใหม่อีกครั้ง')
    expect(screen.queryByRole('heading', { name: 'สวัสดี, มัส' })).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.createDraft).toHaveBeenCalledOnce()
    expect(api.createDraft).toHaveBeenCalledWith('preview-token', 1)
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
      requestId: 'request-ready', adminId: 'staff-admin', aeId: null, customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
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
      attribution: savedAttribution(),
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

  it('reopens a synchronous prepared READY draft for review and confirmation without creating another draft', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const preparedConfig = { ...config, bookingProtocol: { supported: 2 as const, minimumMutation: 2 as const, prepare: true } }
    const input = {
      requestId: 'request-sync-ready', adminId: 'staff-admin', aeId: null, customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    }
    vi.mocked(api.loadLatestActiveDraft).mockResolvedValueOnce({
      draftId: 'draft-sync-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM', retentionState: '', version: 3,
      input: null, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1,
      confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    })
    vi.mocked(api.loadDraft).mockResolvedValueOnce({
      draftId: 'draft-sync-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM', retentionState: '', version: 3,
      input, attribution: savedAttribution(), paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 1,
      confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    })
    vi.mocked(api.confirm).mockResolvedValueOnce({ caseId: 'PMC-202608-0099', status: 'CONFIRMED' })
    render(<PmcMiniApp initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }} initialConfig={preparedConfig} api={api} />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
    expect(await screen.findByRole('heading', { name: 'ตรวจสอบก่อนยืนยัน' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(api.loadLatestActiveDraft).toHaveBeenCalledOnce()
    expect(api.loadDraft).toHaveBeenCalledWith('preview-token', 'draft-sync-ready')
    expect(api.confirm).toHaveBeenCalledWith('preview-token', 'draft-sync-ready', 3, 2)
    expect(api.createDraft).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
  })

  it('surfaces a synchronous reserved partial draft for cancel and restart instead of creating another draft', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const preparedConfig = { ...config, bookingProtocol: { supported: 2 as const, minimumMutation: 2 as const, prepare: true } }
    const partial = {
      draftId: 'draft-sync-partial', requestId: 'request-sync-partial', state: 'DRAFT' as const,
      retentionState: 'PENDING_APPROVAL' as const, version: 3, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 1, chatEvidenceCount: 0,
      confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
    }
    vi.mocked(api.loadLatestActiveDraft).mockResolvedValueOnce(partial)
    vi.mocked(api.loadDraft).mockResolvedValueOnce(partial)
    vi.mocked(api.cancel).mockResolvedValueOnce({ ...partial, state: 'CANCELLED', version: 4 })
    render(<PmcMiniApp initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }} initialConfig={preparedConfig} api={api} />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
    expect(await screen.findByRole('heading', { name: 'ข้อมูลลูกค้า' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(api.cancel).toHaveBeenCalledWith('preview-token', 'draft-sync-partial', 3, 2)
    expect(api.createDraft).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
  })

  it('returns home immediately after async queue acknowledgement', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const input = {
      requestId: 'request-ready', adminId: 'staff-admin', aeId: null, customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
      phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    }
    const ready = {
      draftId: 'draft-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM' as const, retentionState: '' as const,
      version: 3, input, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 2, chatEvidenceCount: 1,
      attribution: savedAttribution(),
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

  it('wires one default privacy-safe timing sink through the API factory and Wizard, then emits Home after commit', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const ready = readyDraft()
    api.createDraft = vi.fn(async () => ready)
    api.confirm = vi.fn(async () => ({
      requestId: ready.requestId,
      status: 'QUEUED' as const,
      projection: { ...ready, state: 'QUEUED' as const, version: 4, input: null, queuedAt: '2026-08-29T10:00:00.000Z' },
    }))
    const createApi = vi.fn<MiniAppApiFactory>(() => api)
    const events: unknown[] = []
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail)
      if ((event as CustomEvent).detail?.event === 'navigation_to_home') {
        expect(screen.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
      }
    }
    window.addEventListener(PMC_BOOKING_TIMING_EVENT, listener)

    try {
      render(<PmcMiniApp
        initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
        initialConfig={config}
        createApi={createApi}
      />)
      expect(createApi).toHaveBeenCalledOnce()
      const sink = createApi.mock.calls[0]![0].bookingTiming
      expect(typeof sink).toBe('function')

      await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
      await user.click(await screen.findByRole('button', { name: 'ยืนยันบันทึก' }))

      await waitFor(() => expect(events).toContainEqual({
        event: 'navigation_to_home', action: 'home', status: 202, elapsedMs: expect.any(Number),
      }))
      expect(events.find((value) => (value as { event?: string }).event === 'navigation_to_home'))
        .not.toHaveProperty('requestId')
      expect(events.filter((value) => (value as { event?: string }).event === 'navigation_to_home')).toHaveLength(1)
    } finally {
      window.removeEventListener(PMC_BOOKING_TIMING_EVENT, listener)
    }
  })

  it('keeps request results and Home navigation intact when the composed timing sink throws', async () => {
    const user = userEvent.setup()
    const api = miniAppApi()
    const ready = readyDraft()
    api.createDraft = vi.fn(async () => ready)
    api.confirm = vi.fn(async () => ({ caseId: 'PMC-202608-0001', status: 'CONFIRMED' as const }))
    const throwingTiming = vi.fn<BrowserBookingTiming>(() => { throw new Error('private telemetry failure') })
    render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={api}
      bookingTiming={throwingTiming}
    />)

    await user.click(screen.getByRole('button', { name: 'เริ่มลงนัด' }))
    await user.click(await screen.findByRole('button', { name: 'ยืนยันบันทึก' }))

    expect(await screen.findByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(api.confirm).toHaveBeenCalledOnce()
    expect(throwingTiming).toHaveBeenCalledWith('navigation_to_home', expect.objectContaining({ action: 'home', status: 200 }))
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
  financeReportsEnabled: false, stockEnabled: false, canManageStock: false,
  canSubmitExpense: false, canViewFinance: false, canManageExpense: false,
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }],
  bookingProtocol: { supported: 2, minimumMutation: 2, prepare: false },
  admins: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
  aes: [{ id: 'staff-admin', name: 'แวว' }, { id: 'staff-ae', name: 'หมวย' }],
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
    upload: vi.fn(), prepare: vi.fn(), save: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    loadReport: vi.fn(), refreshReport: vi.fn(),
    loadDailyIncome: vi.fn(async (_token, filter) => dailyIncomeProjection(filter.startDate, filter.endDate)),
    refreshDailyIncome: vi.fn(async () => ({ accepted: true as const, allocationQueued: true, retryAfterSeconds: 60 })),
    loadMonthlyIncome: vi.fn(async () => monthlyIncomeProjection()),
    loadStockProducts: vi.fn(async () => ({ products: [{
      productId: 'STK-000001', name: 'ถุงมือ', category: 'CLINIC_SUPPLY', unit: 'กล่อง',
      minimumQuantityMilli: 5_000, onHandMilli: 4_000, lowStock: true, active: true,
      hasLedgerActivity: true, version: 2,
    }] })),
    loadStockHistory: vi.fn(), submitStockCommand: vi.fn(),
  }
}

function savedAttribution() {
  return {
    protocolVersion: 2 as const,
    recorder: { id: 'ADMIN_01', name: 'มัส' },
    admin: { id: 'staff-admin', name: 'แวว' },
    ae: null,
  }
}

function readyDraft() {
  const input = {
    requestId: 'request-ready', adminId: 'staff-admin', aeId: null, customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
  }
  return {
    draftId: 'draft-ready', requestId: input.requestId, state: 'READY_TO_CONFIRM' as const, retentionState: '' as const,
    version: 3, input, paymentEvidenceIds: [], chatEvidenceIds: [], paymentEvidenceCount: 2, chatEvidenceCount: 1,
    attribution: savedAttribution(),
    confirmationStatus: null, caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
  }
}

function dailyIncomeProjection(startDate = '2026-08-29', endDate = '2026-08-29') {
  return {
    startDate, endDate, receivedSatang: 100_000, refundSatang: 10_000, netReceivedSatang: 90_000,
    channels: { transferSatang: 60_000, cashSatang: 20_000, creditSatang: 10_000, otherSatang: 10_000, differenceSatang: 0 },
    categories: { state: 'READY' as const, serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000, incompleteDates: [] },
    payments: [],
    freshness: {
      payment: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      refund: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
      allocation: { lastSuccessAt: '2026-08-29T10:00:00.000Z', stale: false, warningCode: null },
    },
    warnings: [],
  }
}

function monthlyIncomeProjection() {
  return {
    ...dailyIncomeProjection('2026-08-01', '2026-08-31'),
    monthKey: '2026-08',
    dailyTrend: [{ date: '2026-08-29', receivedSatang: 100_000, refundSatang: 10_000, netReceivedSatang: 90_000 }],
    expense: { state: 'NOT_IMPLEMENTED' as const, clinicExpenseSatang: null, estimatedBalanceSatang: null },
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
