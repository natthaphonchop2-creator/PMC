import type { BookingEvidenceImages } from '../ports'
import { buildEvidencePreviewComponents } from './minimalReceiptFlex'

export function buildEvidenceFlexMessages(
  evidence: BookingEvidenceImages,
  driveFolderUrl: string | null = null,
): Record<string, unknown>[] {
  if (!evidence.payments.length && !evidence.chats.length) return []
  return [{
    type: 'flex',
    altText: 'หลักฐานการจอง',
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'หลักฐาน', size: 'md', weight: 'bold', color: '#282624' },
          ...buildEvidencePreviewComponents(driveFolderUrl, evidence),
        ],
      },
    },
  }]
}
