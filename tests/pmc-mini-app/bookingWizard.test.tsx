// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingWizard, type BookingWizardAdapter } from '../../src/apps/pmc-mini-app/BookingWizard'
import type { BookingDraftProjection, MiniAppConfig, MiniAppSession } from '../../src/apps/pmc-mini-app/contracts'

afterEach(cleanup)

describe('PMC Mini App mobile booking wizard', () => {
  it('shows locked Admin, editable AE, and no final confirmation on the first step', () => {
    renderWizard()

    expect(screen.getByLabelText('Admin')).toHaveValue('มัส')
    expect(screen.getByLabelText('Admin')).toBeDisabled()
    expect(screen.getByLabelText('AE')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'ยืนยันบันทึก' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ข้อมูลลูกค้า' })).toBeVisible()
  })

  it('shows date and time for a normal queue and removes them for an automatic queue', async () => {
    const user = userEvent.setup()
    renderWizard({ initialStep: 2 })

    expect(screen.getByLabelText('วันที่นัด')).toBeVisible()
    expect(screen.getByLabelText('เวลานัด')).toBeVisible()
    await user.click(screen.getByLabelText('คิวอัตโนมัติ'))
    expect(screen.queryByLabelText('วันที่นัด')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('เวลานัด')).not.toBeInTheDocument()
  })

  it('renders small removable thumbnails for multiple files and reports their counts', async () => {
    const user = userEvent.setup()
    renderWizard({ initialStep: 3 })
    const files = [
      new File([pngBytes()], 'chat-1.png', { type: 'image/png' }),
      new File([pngBytes()], 'chat-2.png', { type: 'image/png' }),
    ]

    await user.upload(screen.getByLabelText('หลักฐานแชท'), files)

    expect(screen.getByText('แชท 2/10 รูป')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /ลบ chat-/ })).toHaveLength(2)
  })

  it('requires a deliberate tap on the preview screen before calling confirm', async () => {
    const user = userEvent.setup()
    const app = adapter()
    renderWizard({ initialStep: 4, adapter: app })

    expect(app.confirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
    expect(app.confirm).toHaveBeenCalledOnce()
    expect(await screen.findByText('PMC-202608-0001')).toBeVisible()
  })
})

function renderWizard(options: { initialStep?: number; adapter?: BookingWizardAdapter } = {}) {
  return render(<BookingWizard
    session={session}
    config={config}
    draft={draft}
    adapter={options.adapter ?? adapter()}
    initialStep={options.initialStep}
  />)
}

const session: MiniAppSession = { staffId: 'staff-1', displayName: 'มัส', active: true }
const config: MiniAppConfig = {
  miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-1', name: 'มัส' }],
}
const draft: BookingDraftProjection = {
  draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
  paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
}

function adapter(): BookingWizardAdapter {
  return {
    upload: vi.fn(async () => draft),
    save: vi.fn(async () => ({ ...draft, state: 'READY_TO_CONFIRM', version: 2 })),
    confirm: vi.fn(async () => ({ caseId: 'PMC-202608-0001', status: 'CONFIRMED' })),
  }
}

function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}
