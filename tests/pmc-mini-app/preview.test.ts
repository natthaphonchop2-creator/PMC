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
})
