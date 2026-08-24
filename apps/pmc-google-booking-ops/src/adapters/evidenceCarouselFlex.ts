import type {
  BookingEvidenceImages,
  EvidenceImageRef,
} from '../ports'

export interface LabeledEvidenceImage extends EvidenceImageRef {
  label: string
}

export function labeledEvidence(
  evidence: BookingEvidenceImages,
): LabeledEvidenceImage[] {
  return [
    ...evidence.payments.map((image, index) => ({
      ...image,
      label: `สลิป ${index + 1}`,
    })),
    ...evidence.chats.map((image, index) => ({
      ...image,
      label: `แชท ${index + 1}`,
    })),
  ]
}

function evidenceBubble(image: LabeledEvidenceImage): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'image',
          url: image.previewUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          backgroundColor: '#F6F5F3',
          action: {
            type: 'uri',
            label: 'เปิดรูปขนาดเต็ม',
            uri: image.fullUrl,
          },
        },
        {
          type: 'text',
          text: image.label,
          size: 'xs',
          color: '#77716D',
          align: 'center',
          margin: 'sm',
        },
      ],
    },
  }
}

export function buildEvidenceFlexMessages(
  evidence: BookingEvidenceImages,
): Record<string, unknown>[] {
  const images = labeledEvidence(evidence)
  const chunks = Array.from(
    { length: Math.ceil(images.length / 10) },
    (_, index) => images.slice(index * 10, index * 10 + 10),
  )
  return chunks.map((chunk, index) => ({
    type: 'flex',
    altText: `หลักฐานการจอง ชุด ${index + 1}/${chunks.length}`,
    contents: {
      type: 'carousel',
      contents: chunk.map(evidenceBubble),
    },
  }))
}
