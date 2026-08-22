export type OcrLineEvent =
  | { type: 'IMAGE'; eventId: string; messageId: string; groupId: string; userId: string; replyToken: string }
  | { type: 'POSTBACK'; eventId: string; groupId: string; userId: string; replyToken: string; data: string }
  | { type: 'REPORT_COMMAND'; eventId: string; groupId: string; userId: string; replyToken: string; command: 'TODAY' | 'YESTERDAY' | 'MONTH' | 'PENDING' | 'ERRORS' }

const REPORT_COMMANDS = {
  'สรุปวันนี้': 'TODAY',
  'สรุปเมื่อวาน': 'YESTERDAY',
  'สรุปเดือนนี้': 'MONTH',
  'รายการรอยืนยัน': 'PENDING',
  'รายการผิดพลาด': 'ERRORS',
} as const

type ReportCommand = OcrLineEvent & { type: 'REPORT_COMMAND' }

export function parseOcrLineEvents(rawBody: string, allowedGroupId: string): OcrLineEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { events?: unknown }).events)) return []

  return (parsed as { events: unknown[] }).events.flatMap((event) => parseEvent(event, allowedGroupId))
}

function parseEvent(value: unknown, allowedGroupId: string): OcrLineEvent[] {
  if (!value || typeof value !== 'object') return []
  const event = value as Record<string, unknown>
  const common = parseCommonFields(event, allowedGroupId)
  if (!common) return []

  if (event.type === 'postback') {
    const data = asRecord(event.postback)?.data
    return typeof data === 'string' && data.length > 0 ? [{ type: 'POSTBACK', ...common, data }] : []
  }
  if (event.type !== 'message') return []

  const message = asRecord(event.message)
  if (!message || message.isEdited === true) return []
  if (message.type === 'image' && typeof message.id === 'string' && message.id.length > 0) {
    return [{ type: 'IMAGE', ...common, messageId: message.id }]
  }
  if (message.type !== 'text' || typeof message.id !== 'string' || message.id.length === 0 || typeof message.text !== 'string') return []

  const command = REPORT_COMMANDS[message.text as keyof typeof REPORT_COMMANDS]
  return command ? [{ type: 'REPORT_COMMAND', ...common, command } satisfies ReportCommand] : []
}

function parseCommonFields(event: Record<string, unknown>, allowedGroupId: string): Omit<Extract<OcrLineEvent, { type: 'POSTBACK' }>, 'type' | 'data'> | null {
  const source = asRecord(event.source)
  if (
    !source ||
    source.type !== 'group' ||
    source.groupId !== allowedGroupId ||
    typeof source.userId !== 'string' || source.userId.length === 0 ||
    typeof event.webhookEventId !== 'string' || event.webhookEventId.length === 0 ||
    typeof event.replyToken !== 'string' || event.replyToken.length === 0
  ) return null

  return { eventId: event.webhookEventId, groupId: source.groupId, userId: source.userId, replyToken: event.replyToken }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
