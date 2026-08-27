// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig } from '../../src/apps/pmc-mini-app/contracts'

afterEach(cleanup)

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
    expect(screen.queryByRole('button', { name: 'รายงาน JERA' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'รายงาน JERA' })).toBeVisible()
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
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }],
}

function miniAppApi(): PmcMiniAppApi {
  return {
    initialize: vi.fn(async () => 'token'),
    loadSession: vi.fn(), loadEnrollmentOptions: vi.fn(), enroll: vi.fn(), loadConfig: vi.fn(),
    createDraft: vi.fn(async () => ({
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
    })),
    upload: vi.fn(), save: vi.fn(), confirm: vi.fn(),
    loadReport: vi.fn(), refreshReport: vi.fn(),
  }
}
