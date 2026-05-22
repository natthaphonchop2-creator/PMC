import { describe, expect, it } from 'vitest'
import {
  buildAiDraftGuidance,
  conversationHistoryForMessage,
  inboxSummary,
  pageNameForMessage,
  selectInboxMessage,
  sortInboxMessages,
} from '../../src/apps/page-automation/inboxModel'
import type { ManagedPage, PageMessage } from '../../src/apps/page-automation/types'

describe('inboxModel', () => {
  it('sorts unread high-priority messages before other inbox items', () => {
    const lowUnread = message({
      messageId: 'low-unread',
      priority: 'low',
      unread: true,
      receivedAt: '2026-05-22T10:00:00.000Z',
    })
    const highRead = message({
      messageId: 'high-read',
      priority: 'high',
      unread: false,
      receivedAt: '2026-05-22T11:00:00.000Z',
    })
    const highUnreadOld = message({
      messageId: 'high-unread-old',
      priority: 'high',
      unread: true,
      receivedAt: '2026-05-22T09:00:00.000Z',
    })
    const highUnreadNew = message({
      messageId: 'high-unread-new',
      priority: 'high',
      unread: true,
      receivedAt: '2026-05-22T12:00:00.000Z',
    })

    const messages = [lowUnread, highRead, highUnreadOld, highUnreadNew]
    const sorted = sortInboxMessages(messages)

    expect(sorted).not.toBe(messages)
    expect(sorted.map((item) => item.messageId)).toEqual([
      'high-unread-new',
      'high-unread-old',
      'low-unread',
      'high-read',
    ])
  })

  it('sorts valid received timestamps before invalid timestamps in the same inbox group', () => {
    const invalidTimestamp = message({
      messageId: 'invalid-timestamp',
      priority: 'high',
      unread: true,
      receivedAt: 'not-a-date',
    })
    const validTimestamp = message({
      messageId: 'valid-timestamp',
      priority: 'high',
      unread: true,
      receivedAt: '2026-05-22T12:00:00.000Z',
    })

    expect(sortInboxMessages([invalidTimestamp, validTimestamp]).map((item) => item.messageId)).toEqual([
      'valid-timestamp',
      'invalid-timestamp',
    ])
  })

  it('summarizes total, unread, and high priority unread messages', () => {
    expect(
      inboxSummary([
        message({ messageId: 'a', priority: 'high', unread: true }),
        message({ messageId: 'b', priority: 'medium', unread: true }),
        message({ messageId: 'c', priority: 'high', unread: false }),
      ]),
    ).toEqual({ total: 3, unread: 2, highPriorityUnread: 1 })
  })

  it('selects an explicit message when present and otherwise the first sorted message', () => {
    const first = message({ messageId: 'first', priority: 'high', unread: true })
    const second = message({ messageId: 'second', priority: 'medium', unread: true })

    expect(selectInboxMessage([first, second], 'second')?.messageId).toBe('second')
    expect(selectInboxMessage([second, first])?.messageId).toBe('first')
    expect(selectInboxMessage([], 'missing')).toBeNull()
  })

  it('resolves page names without exposing unknown internal labels', () => {
    expect(pageNameForMessage(message({ pageId: 'page-1' }), [page({ id: 'page-1', name: 'Promed Clinic' })])).toBe(
      'Promed Clinic',
    )
    expect(pageNameForMessage(message({ pageId: 'page-2' }), [])).toBe('เพจที่เชื่อมต่อ')
  })

  it('builds conversation history from Meta history and falls back to the latest message only', () => {
    const current = message({
      history: [
        {
          messageId: 'history-new',
          senderName: 'ทีมเพจ',
          senderRole: 'page',
          text: 'ทีมติดต่อกลับแล้วค่ะ',
          createdAt: '2026-05-22T10:05:00.000Z',
        },
        {
          messageId: 'history-old',
          senderName: 'Customer A',
          senderRole: 'customer',
          text: 'อยากทราบราคา',
          createdAt: '2026-05-22T10:00:00.000Z',
        },
      ],
    })

    expect(conversationHistoryForMessage(current).map((item) => item.messageId)).toEqual(['history-old', 'history-new'])
    expect(conversationHistoryForMessage(message({ history: [] }))).toEqual([
      expect.objectContaining({
        messageId: 'message-1',
        senderName: 'Customer A',
        senderRole: 'customer',
        text: 'สนใจค่ะ อยากทราบราคา',
      }),
    ])
    expect(conversationHistoryForMessage(null)).toEqual([])
  })

  it('builds human-approved AI draft guidance without automatic send copy', () => {
    const guidance = buildAiDraftGuidance(message({ intent: 'price', privacyFlags: ['phone'] }))

    expect(guidance.title).toBe('AI ร่างคำตอบให้ทีมตรวจ')
    expect(guidance.detail).toContain('ถามราคา')
    expect(guidance.detail).toContain('มีข้อมูลส่วนตัว')
    expect(guidance.draft).toContain('ทีมควรตรวจรายละเอียดก่อนส่ง')
    expect(guidance.draft).not.toContain('ส่งอัตโนมัติ')
  })
})

function message(overrides: Partial<PageMessage> = {}): PageMessage {
  return {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    pageId: 'page-1',
    channel: 'facebook_message',
    customerDisplayName: 'Customer A',
    textExcerpt: 'สนใจค่ะ อยากทราบราคา',
    receivedAt: '2026-05-22T10:00:00.000Z',
    unread: true,
    priority: 'medium',
    status: 'new',
    sentiment: 'neutral',
    intent: 'general',
    slaDueAt: '2026-05-22T10:30:00.000Z',
    privacyFlags: [],
    ...overrides,
  }
}

function page(overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id: 'page-1',
    name: 'Fifth Clinic',
    handle: '@fifthclinic',
    platform: 'facebook',
    followers: 1200,
    followerDelta: 0,
    reach: 0,
    engagementRate: 0,
    unreadCount: 0,
    responseRate: 0,
    avgFirstResponseMins: 0,
    healthScore: 90,
    permissions: [],
    lastSyncedAt: '2026-05-22T10:00:00.000Z',
    ...overrides,
  }
}
