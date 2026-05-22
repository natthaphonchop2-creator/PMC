import type { ManagedPage, PageMessage, PageMessageHistoryItem, PageMessageIntent, PageMessagePriority } from './types'

export type InboxSummary = {
  highPriorityUnread: number
  total: number
  unread: number
}

export type AiDraftGuidance = {
  detail: string
  draft: string
  title: string
}

const priorityWeight: Record<PageMessagePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const intentCopy: Record<PageMessageIntent, string> = {
  booking: 'ต้องการนัดหมาย',
  complaint: 'มีเรื่องร้องเรียน',
  general: 'สอบถามทั่วไป',
  price: 'ถามราคา',
  review_request: 'ขอดูรีวิว',
}

export function sortInboxMessages(messages: PageMessage[]): PageMessage[] {
  return [...messages].sort((left, right) => {
    const unreadOrder = Number(right.unread) - Number(left.unread)
    if (unreadOrder !== 0) return unreadOrder

    const priorityOrder = priorityWeight[left.priority] - priorityWeight[right.priority]
    if (priorityOrder !== 0) return priorityOrder

    return timestampForSort(right.receivedAt) - timestampForSort(left.receivedAt)
  })
}

function timestampForSort(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

export function inboxSummary(messages: PageMessage[]): InboxSummary {
  return {
    highPriorityUnread: messages.filter((message) => message.unread && message.priority === 'high').length,
    total: messages.length,
    unread: messages.filter((message) => message.unread).length,
  }
}

export function selectInboxMessage(messages: PageMessage[], selectedMessageId?: string): PageMessage | null {
  const explicitMessage = selectedMessageId ? messages.find((message) => message.messageId === selectedMessageId) : undefined
  if (explicitMessage) return explicitMessage

  return sortInboxMessages(messages)[0] ?? null
}

export function pageNameForMessage(message: PageMessage, pages: ManagedPage[]): string {
  return pages.find((page) => page.id === message.pageId)?.name ?? 'เพจที่เชื่อมต่อ'
}

export function conversationHistoryForMessage(message: PageMessage | null): PageMessageHistoryItem[] {
  if (!message) return []

  const history =
    message.history && message.history.length > 0
      ? message.history
      : [
          {
            messageId: message.messageId,
            senderName: message.customerDisplayName,
            senderRole: 'customer' as const,
            text: message.textExcerpt,
            createdAt: message.receivedAt,
          },
        ]

  return [...history].sort((left, right) => timestampForHistory(left.createdAt) - timestampForHistory(right.createdAt))
}

function timestampForHistory(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

export function buildAiDraftGuidance(message: PageMessage | null): AiDraftGuidance {
  if (!message) {
    return {
      title: 'AI ร่างคำตอบให้ทีมตรวจ',
      detail: 'เลือกข้อความทางซ้ายเพื่อดูสรุปและร่างคำตอบ',
      draft: 'เลือกข้อความก่อน ระบบจะแสดงร่างคำตอบให้ทีมตรวจในช่องนี้',
    }
  }

  const privacyCopy = message.privacyFlags.length > 0 ? ' และมีข้อมูลส่วนตัว' : ''
  const reviewCopy = message.intent === 'complaint' || message.sentiment === 'negative' ? ' ควรให้ทีมตรวจอย่างละเอียดก่อนตอบ' : ''

  return {
    title: 'AI ร่างคำตอบให้ทีมตรวจ',
    detail: `ข้อความนี้เป็นกลุ่ม${intentCopy[message.intent]}${privacyCopy}${reviewCopy}`,
    draft:
      'ขอบคุณที่ทักมาค่ะ ทีมได้รับข้อความแล้วและจะช่วยดูรายละเอียดให้ ทีมควรตรวจรายละเอียดก่อนส่ง โดยเฉพาะข้อมูลราคา การนัดหมาย และข้อมูลส่วนตัวของลูกค้า',
  }
}
