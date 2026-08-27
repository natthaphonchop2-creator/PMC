// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PmcMiniApp, type PmcMiniAppApi } from '../../src/apps/pmc-mini-app/PmcMiniApp'
import type { MiniAppConfig } from '../../src/apps/pmc-mini-app/contracts'

afterEach(cleanup)

describe('PMC LINE Mini App shell', () => {
  it('shows only the two approved version-1 home actions', () => {
    const view = render(<PmcMiniApp
      initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      initialConfig={config}
      api={miniAppApi()}
    />)

    expect(screen.getByRole('heading', { name: 'สวัสดี, มัส' })).toBeVisible()
    expect(screen.getByText('จัดการงานจองและรายงานของคลินิก')).toBeVisible()
    expect(screen.getByRole('button', { name: 'เริ่มลงนัด' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'รายงาน JERA' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Google Form สำรอง' })).toHaveAttribute('href', config.fallbackFormUrl)
    expect(screen.getByRole('button', { name: 'บัญชีผู้ใช้' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Promed Clinic' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'เมนูด้านล่าง' })).toBeVisible()
    expect(screen.queryByText('LINE Assistant')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'ระบบงานคลินิก' })).not.toBeInTheDocument()
    expect(view.container.querySelectorAll('.pmc-home-primary-card')).toHaveLength(1)
    expect(view.container.querySelectorAll('.pmc-home-quick-card')).toHaveLength(2)
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
})

const config: MiniAppConfig = {
  miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }],
}

function miniAppApi(): PmcMiniAppApi {
  return {
    initialize: vi.fn(async () => 'token'),
    loadSession: vi.fn(), loadConfig: vi.fn(),
    createDraft: vi.fn(async () => ({
      draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
      paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
    })),
    upload: vi.fn(), save: vi.fn(), confirm: vi.fn(),
  }
}
