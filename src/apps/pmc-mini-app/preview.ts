import type { MiniAppBrowserApi } from './api'
import type { BookingDraftInput, BookingDraftProjection, MiniAppConfig, MiniAppSession } from './contracts'

export const PREVIEW_SESSION: MiniAppSession = { staffId: 'staff-preview', displayName: 'มัส', active: true }

export const PREVIEW_CONFIG: MiniAppConfig = {
  miniAppId: 'preview-mini-app',
  fallbackFormUrl: 'https://docs.google.com/forms/',
  doctors: [{ id: 'doctor-benz', name: 'หมอ Benz' }, { id: 'doctor-jam', name: 'หมอ Jam' }],
  services: [
    { id: 'fat-transfer', name: 'เติมไขมัน', durationMinutes: 60 },
    { id: 'rhinoplasty', name: 'เสริมจมูก', durationMinutes: 60 },
    { id: 'eyelid', name: 'ทำตาสองชั้น', durationMinutes: 60 },
  ],
  channels: [{ id: 'page-tab', name: 'เพจTAB' }, { id: 'page-main', name: 'เพจหลัก' }],
  aes: [{ id: 'NONE', name: 'ไม่ระบุ' }, { id: 'staff-mus', name: 'มัส' }, { id: 'staff-muay', name: 'หมวย' }],
}

export function createPreviewMiniAppApi(options: { staffAllowed?: boolean } = {}): MiniAppBrowserApi {
  let current: BookingDraftProjection | null = null
  return {
    async initialize() { return 'preview-token' },
    async loadSession() {
      if (options.staffAllowed === false) throw Object.assign(new Error('Staff is not allowed'), { code: 'STAFF_NOT_ALLOWED' })
      return PREVIEW_SESSION
    },
    async loadConfig() { return PREVIEW_CONFIG },
    async createDraft() {
      current = {
        draftId: 'draft-preview-1', requestId: 'request-preview-1', state: 'DRAFT', retentionState: '', version: 1,
        input: null, paymentEvidenceIds: [], chatEvidenceIds: [], confirmationStatus: null,
      }
      return structuredClone(current)
    },
    async upload(_token, draftId, kind, files) {
      requireDraft(current, draftId)
      const ids = files.map((file, index) => `preview-${kind.toLowerCase()}-${index + 1}-${file.name}`)
      current = {
        ...current!,
        version: current!.version + 1,
        paymentEvidenceIds: kind === 'PAYMENT' ? [...current!.paymentEvidenceIds, ...ids] : current!.paymentEvidenceIds,
        chatEvidenceIds: kind === 'CHAT' ? [...current!.chatEvidenceIds, ...ids] : current!.chatEvidenceIds,
      }
      return structuredClone(current)
    },
    async save(_token, draftId, version, input: BookingDraftInput) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'READY_TO_CONFIRM', version: current!.version + 1, input: structuredClone(input) }
      return structuredClone(current)
    },
    async confirm(_token, draftId, version) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'CONFIRMED', version: current!.version + 1, confirmationStatus: 'CONFIRMED' }
      return { caseId: 'PMC-PREVIEW-0001', status: 'CONFIRMED' }
    },
  }
}

function requireDraft(draft: BookingDraftProjection | null, draftId: string, version?: number): void {
  if (!draft || draft.draftId !== draftId) throw new Error('preview draft missing')
  if (version !== undefined && draft.version !== version) throw new Error('preview draft version conflict')
}
