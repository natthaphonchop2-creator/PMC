import { describe, expect, it } from 'vitest'
import { parseOcrLineEvents } from '../../server/ocr-ledger/lineEvents'

const groupSource = { type: 'group', groupId: 'Cgroup1', userId: 'Ustaff1' }

function event(overrides: Record<string, unknown> = {}) {
  return {
    webhookEventId: 'event-1',
    replyToken: 'reply-1',
    source: groupSource,
    ...overrides,
  }
}

describe('OCR LINE event parser', () => {
  it('returns only authorized image, postback, and five exact Thai report commands', () => {
    const result = parseOcrLineEvents(JSON.stringify({
      events: [
        event({ type: 'message', message: { type: 'image', id: 'message-image' } }),
        event({ webhookEventId: 'event-2', type: 'postback', postback: { data: 'review=token' } }),
        event({ webhookEventId: 'event-3', type: 'message', message: { type: 'text', id: 'message-today', text: 'สรุปวันนี้' } }),
        event({ webhookEventId: 'event-4', type: 'message', message: { type: 'text', id: 'message-yesterday', text: 'สรุปเมื่อวาน' } }),
        event({ webhookEventId: 'event-5', type: 'message', message: { type: 'text', id: 'message-month', text: 'สรุปเดือนนี้' } }),
        event({ webhookEventId: 'event-6', type: 'message', message: { type: 'text', id: 'message-pending', text: 'รายการรอยืนยัน' } }),
        event({ webhookEventId: 'event-7', type: 'message', message: { type: 'text', id: 'message-errors', text: 'รายการผิดพลาด' } }),
      ],
    }), 'Cgroup1')

    expect(result).toEqual([
      { type: 'IMAGE', eventId: 'event-1', messageId: 'message-image', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1' },
      { type: 'POSTBACK', eventId: 'event-2', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', data: 'review=token' },
      { type: 'REPORT_COMMAND', eventId: 'event-3', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', command: 'TODAY' },
      { type: 'REPORT_COMMAND', eventId: 'event-4', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', command: 'YESTERDAY' },
      { type: 'REPORT_COMMAND', eventId: 'event-5', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', command: 'MONTH' },
      { type: 'REPORT_COMMAND', eventId: 'event-6', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', command: 'PENDING' },
      { type: 'REPORT_COMMAND', eventId: 'event-7', groupId: 'Cgroup1', userId: 'Ustaff1', replyToken: 'reply-1', command: 'ERRORS' },
    ])
  })

  it('ignores other groups, direct chats, unsupported or edited media, ordinary text, and malformed events', () => {
    const result = parseOcrLineEvents(JSON.stringify({
      events: [
        event({ type: 'message', source: { ...groupSource, groupId: 'Cother' }, message: { type: 'image', id: 'other-group' } }),
        event({ type: 'message', source: { type: 'user', userId: 'Ustaff1' }, message: { type: 'image', id: 'direct-chat' } }),
        event({ type: 'message', message: { type: 'video', id: 'video-1' } }),
        event({ type: 'message', message: { type: 'image', id: 'edited-1', isEdited: true } }),
        event({ type: 'message', message: { type: 'text', id: 'ordinary', text: 'ช่วยสรุปวันนี้' } }),
        event({ type: 'message', message: { type: 'text', id: 'missing-event-id', text: 'สรุปวันนี้' }, webhookEventId: '' }),
        { type: 'postback' },
      ],
    }), 'Cgroup1')

    expect(result).toEqual([])
    expect(parseOcrLineEvents('{bad json', 'Cgroup1')).toEqual([])
  })
})
