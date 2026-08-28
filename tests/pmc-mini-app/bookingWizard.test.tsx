// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniAppApiError } from '../../src/apps/pmc-mini-app/api'
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

  it('cancels the server draft before leaving the first step', async () => {
    const user = userEvent.setup()
    const app = adapter()
    const onExit = vi.fn()
    renderWizard({ adapter: app, onExit })

    await user.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(app.cancel).toHaveBeenCalledWith('draft-1', 1)
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('keeps the wizard open when cancelling the server draft fails', async () => {
    const user = userEvent.setup()
    const app = adapter()
    const onExit = vi.fn()
    vi.mocked(app.cancel).mockRejectedValueOnce(new Error('network'))
    renderWizard({ adapter: app, onExit })

    await user.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ยกเลิกร่างไม่สำเร็จ')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('does not upload the same evidence again when saving fails after uploads succeeded', async () => {
    const user = userEvent.setup()
    const current = { ...draft, input: completeInput() }
    let version = current.version
    const app = adapter()
    vi.mocked(app.upload).mockImplementation(async (_draftId, kind) => {
      version += 1
      return {
        ...current,
        version,
        paymentEvidenceIds: kind === 'PAYMENT' ? ['payment-drive-1'] : ['payment-drive-1'],
        chatEvidenceIds: kind === 'CHAT' ? ['chat-drive-1'] : [],
      }
    })
    vi.mocked(app.save).mockRejectedValue(new Error('save failed'))
    renderWizard({ initialStep: 3, adapter: app, draft: current })
    await user.upload(screen.getByLabelText('สลิปเงินจอง'), new File([pngBytes()], 'slip.png', { type: 'image/png' }))
    await user.upload(screen.getByLabelText('หลักฐานแชท'), new File([pngBytes()], 'chat.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await screen.findByText('บันทึกร่างไม่สำเร็จ กรุณาลองอีกครั้ง')
    expect(app.upload).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
    await waitFor(() => expect(app.save).toHaveBeenCalledTimes(2))
    expect(app.upload).toHaveBeenCalledTimes(2)
  })

  it('explains how to replace an unsupported iPhone evidence image', async () => {
    const user = userEvent.setup()
    const current = { ...draft, input: completeInput() }
    const app = adapter()
    vi.mocked(app.upload).mockRejectedValueOnce(new MiniAppApiError('UNSUPPORTED_EVIDENCE', 415))
    renderWizard({ initialStep: 3, adapter: app, draft: current })
    await user.upload(screen.getByLabelText('สลิปเงินจอง'), new File([pngBytes()], 'slip.png', { type: 'image/png' }))
    await user.upload(screen.getByLabelText('หลักฐานแชท'), new File([pngBytes()], 'chat.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('รองรับเฉพาะรูป JPG หรือ PNG')
    expect(screen.getByRole('alert')).toHaveTextContent('จับภาพหน้าจอแล้วแนบใหม่')
  })

  it('loads the saved server draft after a stale retry instead of showing a false failure', async () => {
    const user = userEvent.setup()
    const current: BookingDraftProjection = {
      ...draft,
      version: 9,
      input: completeInput(),
      paymentEvidenceIds: ['payment-1', 'payment-2', 'payment-3'],
      chatEvidenceIds: ['chat-1'],
    }
    const latest: BookingDraftProjection = { ...current, state: 'READY_TO_CONFIRM', version: 10 }
    const app = {
      ...adapter(),
      load: vi.fn(async () => latest),
    } as BookingWizardAdapter & { load(draftId: string): Promise<BookingDraftProjection> }
    vi.mocked(app.save).mockRejectedValueOnce(new MiniAppApiError('STALE_DRAFT_VERSION', 409))
    renderWizard({ initialStep: 3, adapter: app, draft: current })

    await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))

    expect(await screen.findByRole('heading', { name: 'ตรวจสอบก่อนยืนยัน' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(app.load).toHaveBeenCalledWith('draft-1')
  })
})

function renderWizard(options: {
  initialStep?: number
  adapter?: BookingWizardAdapter
  draft?: BookingDraftProjection
  onExit?: () => void
} = {}) {
  return render(<BookingWizard
    session={session}
    config={config}
    draft={options.draft ?? draft}
    adapter={options.adapter ?? adapter()}
    initialStep={options.initialStep}
    onExit={options.onExit}
  />)
}

const session: MiniAppSession = { staffId: 'staff-1', displayName: 'มัส', active: true }
const config: MiniAppConfig = {
  miniAppId: 'mini-id', fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform', reportingEnabled: false,
  doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }], services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
  channels: [{ id: 'channel-1', name: 'เพจTAB' }], aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-1', name: 'มัส' }],
}
const draft: BookingDraftProjection = {
  draftId: 'draft-1', requestId: 'request-1', state: 'DRAFT', retentionState: '', version: 1, input: null,
  paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
  caseId: null, safeErrorCode: null, queuedAt: null, lastProgressAt: null,
}

function adapter(): BookingWizardAdapter {
  return {
    load: vi.fn(async () => draft),
    upload: vi.fn(async () => draft),
    save: vi.fn(async () => ({ ...draft, state: 'READY_TO_CONFIRM', version: 2 })),
    confirm: vi.fn(async () => ({ caseId: 'PMC-202608-0001', status: 'CONFIRMED' })),
    cancel: vi.fn(async () => ({ ...draft, state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: 2 })),
  }
}

function completeInput() {
  return {
    requestId: 'request-1', aeName: 'ไม่ระบุ', customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test',
    phone: '0812345678', doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL' as const,
    appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
  }
}

function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}
