import { describe, expect, it, vi } from 'vitest'
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

  it('enables finance report previews explicitly without granting finance access by default', () => {
    expect(createPreviewMiniAppConfig({ financeReportsEnabled: true })).toMatchObject({
      reportingEnabled: false,
      financeReportsEnabled: true,
      canViewFinance: false,
    })
    expect(createPreviewMiniAppConfig({ financeReportsEnabled: true, canViewFinance: true })).toMatchObject({
      financeReportsEnabled: true,
      canViewFinance: true,
    })
  })

  it('provides deterministic finance rows for one-day, 31-day, and monthly browser acceptance', async () => {
    const api = createPreviewMiniAppApi({ financeReportsEnabled: true, canViewFinance: true })
    const yesterday = await api.loadDailyIncome('preview-token', {
      preset: 'YESTERDAY', startDate: '2026-08-29', endDate: '2026-08-29',
    })
    const month = await api.loadDailyIncome('preview-token', {
      preset: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-08-31',
    })
    const monthly = await api.loadMonthlyIncome('preview-token', { year: 2026, month: 8 })

    expect(yesterday.payments).toEqual([
      expect.objectContaining({ eventDate: '2026-08-29', paymentCode: 'PAY-20260829', paidAmountSatang: 100_001 }),
    ])
    expect(yesterday.categories).toMatchObject({ state: 'READY', serviceSatang: 66_667, productSatang: 33_334 })
    expect(month.payments).toHaveLength(31)
    expect(month.payments[0]?.eventDate).toBe('2026-08-31')
    expect(month.payments.at(-1)?.eventDate).toBe('2026-08-01')
    expect(monthly.dailyTrend).toHaveLength(31)
    expect(monthly.dailyTrend.at(-1)?.date).toBe('2026-08-31')
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

  it('keeps every expense preview method local across lost retry, history, evidence, replacement, and void', async () => {
    const originalFetch = globalThis.fetch
    const fetch = vi.fn(() => { throw new Error('preview attempted outbound network access') })
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      const api = createPreviewMiniAppApi({
        expenseCaptureEnabled: true,
        financeReadsEnabled: true,
        canSubmitExpense: true,
        canViewFinance: true,
        canManageExpense: true,
        expenseScenario: 'lost-first-submit',
      })
      const billFiles = [previewFile('bill-a.png'), previewFile('bill-b.png')]
      const staged = await api.stageExpense('preview-token', 'preview-local-bill', billFiles)
      const billInput = {
        rootRequestId: 'preview-local-bill', category: 'BILL_DOCUMENT' as const,
        expenseDate: '2026-08-30', amountSatang: 12_550,
        counterpartyName: 'ร้านทดสอบ', description: '', paymentMethod: 'CASH' as const,
        expectedRevision: 0, stagingTokens: staged.stagingTokens,
      }

      await expect(api.submitExpense('preview-token', billInput)).rejects.toMatchObject({
        code: 'EXPENSE_STORAGE_UNAVAILABLE',
      })
      const retryReceipt = await api.submitExpense('preview-token', billInput)
      expect(retryReceipt.expenseId).toBe('EXP-202608-PREVIEW')

      const historyAfterRetry = await api.loadExpenseHistory('preview-token', '2026-08')
      expect(historyAfterRetry.expenses.filter(({ expenseId }) => expenseId === retryReceipt.expenseId)).toHaveLength(1)
      await expect(api.loadMonthlyExpenses('preview-token', '2026-08')).resolves.toMatchObject({
        clinicCommittedSatang: 110_550,
      })

      const evidenceToken = await api.issueExpenseEvidenceToken('preview-token', 'EXP-202608-BOOK-01', 'ATT-1')
      await expect(api.downloadExpenseEvidence('preview-token', evidenceToken)).resolves.toMatchObject({ type: 'image/png' })

      const replacementStage = await api.stageExpense('preview-token', 'preview-local-replacement', [previewFile('replacement.png')])
      const replacement = await api.replaceExpense('preview-token', 'EXP-202608-BOOK-01', {
        rootRequestId: 'preview-local-replacement', category: 'BOOK_CLINIC', expenseDate: '2026-08-29',
        amountSatang: 120_000, counterpartyName: null, description: '', paymentMethod: null,
        expectedRevision: 1, stagingTokens: replacementStage.stagingTokens,
      })
      expect(replacement).toMatchObject({ expenseId: 'EXP-202608-PREVIEW-REPLACEMENT', revision: 2 })
      await expect(api.voidExpense('preview-token', replacement.expenseId, {
        rootRequestId: 'preview-local-void', expectedRevision: 2, reason: 'local preview test',
      })).resolves.toBeUndefined()

      expect(fetch).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

function previewFile(name: string): File {
  return new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], name, { type: 'image/png' })
}
