import { describe, expect, it } from 'vitest'
import { createPreviewMiniAppApi } from '../../src/apps/pmc-mini-app/preview'

describe('PMC Mini App local visual preview adapter', () => {
  it('creates a deterministic draft and confirmation without network access', async () => {
    const api = createPreviewMiniAppApi()
    const draft = await api.createDraft('preview-token')
    const saved = await api.save('preview-token', draft.draftId, draft.version, {
      requestId: draft.requestId, aeName: 'ไม่ระบุ', customerName: 'ลูกค้าตัวอย่าง', facebookName: 'Facebook Example',
      phone: '0812345678', doctorId: 'doctor-benz', serviceId: 'fat-transfer', queueType: 'NORMAL',
      appointmentDate: '2026-09-01', appointmentTime: '13:00', depositAmount: 900, channelId: 'page-tab',
    })

    expect(saved.state).toBe('READY_TO_CONFIRM')
    await expect(api.confirm('preview-token', saved.draftId, saved.version)).resolves.toEqual({ caseId: 'PMC-PREVIEW-0001', status: 'CONFIRMED' })
  })

  it('rejects an invalid multi-line ISSUE without mutating an earlier valid product', async () => {
    const api = createPreviewMiniAppApi({ stockEnabled: true })
    const before = await api.loadStockProducts('preview-token')

    await expect(api.submitStockCommand('preview-token', {
      requestId: 'preview-atomic-issue', commandType: 'ISSUE', payload: {
        lines: [
          { productId: 'STK-000001', quantityMilli: 1_000 },
          { productId: 'STK-000002', quantityMilli: 99_000 },
        ],
      },
    })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT_BALANCE' })

    await expect(api.loadStockProducts('preview-token')).resolves.toEqual(before)
  })

  it('mirrors manager authorization for every manager-only preview command', async () => {
    const api = createPreviewMiniAppApi({ stockEnabled: true, canManageStock: false })

    await expect(api.submitStockCommand('preview-token', {
      requestId: 'preview-manager-denied', commandType: 'RECEIVE', payload: {
        lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
      },
    })).rejects.toMatchObject({ code: 'STOCK_MANAGER_REQUIRED' })
  })
})
