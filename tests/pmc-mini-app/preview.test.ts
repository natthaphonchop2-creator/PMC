import { describe, expect, it } from 'vitest'
import { createPreviewMiniAppApi, createPreviewMiniAppConfig } from '../../src/apps/pmc-mini-app/preview'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

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

  it('keeps reporting disabled by default and enables it only for an explicit preview option', () => {
    expect(createPreviewMiniAppConfig().reportingEnabled).toBe(false)
    expect(createPreviewMiniAppConfig({ reportingEnabled: true }).reportingEnabled).toBe(true)
  })

  it('keeps future finance permissions fail-closed in preview mode', () => {
    expect(createPreviewMiniAppConfig()).toMatchObject({
      canSubmitExpense: false,
      canViewFinance: false,
      canManageExpense: false,
    })
  })

  it('keeps finance reports disabled in preview configuration while satisfying the typed client contract', async () => {
    const api = createPreviewMiniAppApi()

    await expect(api.loadDailyIncome('preview-token', {
      preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29',
    })).resolves.toMatchObject({ startDate: '2026-08-29', endDate: '2026-08-29' })
    await expect(api.loadMonthlyIncome('preview-token', { year: 2026, month: 8 })).resolves.toMatchObject({ monthKey: '2026-08' })
    await expect(api.refreshDailyIncome('preview-token', '2026-08-29')).resolves.toEqual({
      accepted: true, allocationQueued: false, retryAfterSeconds: 0,
    })
    expect(createPreviewMiniAppConfig()).toMatchObject({ financeReportsEnabled: false })
  })

  it('advances the safe preview report timestamp after a refresh', async () => {
    const api = createPreviewMiniAppApi({ reportingEnabled: true })
    const filters = defaultReportFilters('2026-08-27')

    const before = await api.loadReport('preview-token', 'PAYMENT', filters)
    await api.refreshReport('preview-token', 'PAYMENT', filters)
    const after = await api.loadReport('preview-token', 'PAYMENT', filters)

    expect(before.lastSuccessAt).toBe('2026-08-27T13:55:00.000Z')
    expect(after.lastSuccessAt).toBe('2026-08-27T13:56:00.000Z')
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
