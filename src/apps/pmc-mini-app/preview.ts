import type { MiniAppBrowserApi } from './api'
import type { BookingDraftInput, BookingDraftProjection, MiniAppConfig, MiniAppSession } from './contracts'
import type { JeraClientEnvelope, JeraReportType } from './reports'

export const PREVIEW_SESSION: MiniAppSession = { staffId: 'staff-preview', displayName: 'มัส', active: true }

export const PREVIEW_CONFIG: MiniAppConfig = {
  miniAppId: 'preview-mini-app',
  fallbackFormUrl: 'https://docs.google.com/forms/',
  reportingEnabled: false,
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
  let staffAllowed = options.staffAllowed !== false
  return {
    async initialize() { return 'preview-token' },
    async loadSession() {
      if (!staffAllowed) throw Object.assign(new Error('Staff is not allowed'), { code: 'STAFF_NOT_ALLOWED' })
      return PREVIEW_SESSION
    },
    async loadEnrollmentOptions() { return { staff: [{ id: PREVIEW_SESSION.staffId, name: PREVIEW_SESSION.displayName }] } },
    async enroll(_token, staffId, pin) {
      if (staffId !== PREVIEW_SESSION.staffId || pin !== '123456') {
        throw Object.assign(new Error('Enrollment denied'), { code: 'ENROLLMENT_DENIED', retryAfterSeconds: 0 })
      }
      staffAllowed = true
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
    async cancel(_token, draftId, version) {
      requireDraft(current, draftId, version)
      current = { ...current!, state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', version: current!.version + 1 }
      return structuredClone(current)
    },
    async loadReport<T>(_token: string, reportType: JeraReportType): Promise<JeraClientEnvelope<T>> { return previewReport<T>(reportType) },
    async refreshReport() { return { accepted: true, correlationId: 'preview-refresh-1' } },
  }
}

function previewReport<T>(reportType: JeraReportType): JeraClientEnvelope<T> {
  const rows = [{
    sourceUuid: 'preview-row-1', eventDate: '2026-08-27', patientName: 'ลูกค้าทดสอบ',
    paymentCode: 'PAY-PREVIEW-001', itemName: 'เติมไขมัน', itemCode: 'SERVICE-01',
    status: 'PAID', paidAmountSatang: 90_000, refundAmountSatang: 0, remainingValueSatang: 0,
  }]
  const data = reportType === 'TODAY_SUMMARY'
    ? { totals: { receivedSatang: 90_000, depositSatang: 90_000, refundSatang: 0, netCashFlowSatang: 180_000, appointmentCount: 2 } }
    : reportType === 'APPOINTMENT'
      ? { totals: { appointmentCount: 2 }, rows: rows.map((row) => ({ ...row, paidAmountSatang: null, status: 'Confirmed' })) }
      : reportType === 'REFUND'
        ? { totals: { rowCount: 1, refundAmountSatang: 90_000 }, rows: rows.map((row) => ({ ...row, paidAmountSatang: null, refundAmountSatang: 90_000 })) }
        : {
          totals: {
            rowCount: 1, totalSatang: 90_000, paidAmountSatang: 90_000, refundAmountSatang: 0,
            normalPaidSatang: 90_000, depositPaidSatang: 0, cashSatang: 0, transferSatang: 90_000,
            creditCardSatang: 0, eWalletSatang: 0, paymentLinkSatang: 0, otherPaymentSatang: 0,
            netSatang: 90_000, quantity: 1, remainingQuantity: 1, remainingValueSatang: 90_000,
          },
          rows,
        }
  return {
    data: data as unknown as T,
    source: 'CACHE', fetchedAt: '2026-08-27T13:55:00.000Z', lastSuccessAt: '2026-08-27T13:55:00.000Z',
    refreshing: false, stale: false, warningCode: null,
  }
}

function requireDraft(draft: BookingDraftProjection | null, draftId: string, version?: number): void {
  if (!draft || draft.draftId !== draftId) throw new Error('preview draft missing')
  if (version !== undefined && draft.version !== version) throw new Error('preview draft version conflict')
}
