import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AutoPost } from '../../src/apps/page-automation/routes/AutoPost'
import { InboxWorkspace } from '../../src/apps/page-automation/routes/InboxWorkspace'
import { Messages } from '../../src/apps/page-automation/routes/Messages'
import { PageAnalysis } from '../../src/apps/page-automation/routes/PageAnalysis'
import type {
  ManagedPage,
  PageMessage,
  PageAutomationPermission,
  PageAutomationPermissionReport,
  PostDraft,
  SharedAdsInsightForPage,
} from '../../src/apps/page-automation/types'

const fullFacebookPermissions: PageAutomationPermission[] = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_manage_engagement',
  'pages_messaging',
  'ads_read',
]

describe('Page Automation route guardrails', () => {
  it('keeps approval-required Ads recommendations out of Mark eligible', () => {
    const page = makePage({ healthScore: 96, permissions: [makePermissionReport()] })
    const adsInsight = makeAdsInsight({
      recommendations: [
        {
          id: 'rec-1',
          action: 'Scale the winning offer angle from the high ROAS ad.',
          expectedImpact: 'More consultation requests',
          guardrail: 'Approval required before page publishing',
          requiresApproval: true,
          risk: 'Medium',
          confidence: 0.92,
        },
      ],
    })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={adsInsight}
        autoMode="on"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[page]}
        summary={{ avgHealth: 96, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('ต้องให้ทีมอนุมัติก่อน')
    expect(html).not.toContain('พร้อมสำหรับ Auto ความเสี่ยงต่ำ')
    expect(html).toMatch(/<button(?=[^>]*disabled)[^>]*>\s*ทำเครื่องหมายว่าพร้อมตั้งเวลา\s*<\/button>/)
  })

  it('uses an unknown Ads confidence state for creative signals without finding confidence', () => {
    const page = makePage({ healthScore: 96, permissions: [makePermissionReport()] })
    const adsInsight = makeAdsInsight({
      creativeSignals: [
        {
          adId: 'ad-1',
          campaignId: 'cmp-1',
          creative: 'Winning consultation angle from the top ad.',
          score: 94,
          ctr: 2.1,
          roas: 4.8,
          bookings: 12,
        },
      ],
    })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={adsInsight}
        autoMode="on"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[page]}
        summary={{ avgHealth: 96, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('ยังไม่พอสำหรับ Auto')
    expect(html).toContain('ต้องให้ทีมอนุมัติก่อน')
    expect(html).toMatch(/<button(?=[^>]*disabled)[^>]*>\s*ทำเครื่องหมายว่าพร้อมตั้งเวลา\s*<\/button>/)
  })

  it('shows unknown permission state in AutoPost instead of reporting all permissions granted', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="on"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('ยังตรวจสิทธิ์ของเพจไม่ได้')
    expect(html).not.toContain('สิทธิ์ที่จำเป็นพร้อมใช้งาน')
  })

  it('renders persisted draft pipeline records instead of only suggested cards', () => {
    const page = makePage()

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="off"
        drafts={[
          {
            id: 'draft-ready',
            pageId: 'page-1',
            pageName: 'Fifth Clinic',
            channel: 'facebook_feed',
            title: 'Persisted ready draft',
            objective: 'Education',
            captionTh: 'Caption',
            cta: 'Inbox',
            destination: '@fifthclinic',
            status: 'ready',
            autoEligible: true,
            guardrailScore: 91,
            aiConfidence: 0.9,
            createdAt: recentIso(3),
            updatedAt: recentIso(2),
          },
          {
            id: 'draft-scheduled',
            pageId: 'page-1',
            pageName: 'Fifth Clinic',
            channel: 'facebook_feed',
            title: 'Persisted scheduled draft',
            objective: 'Education',
            captionTh: 'Caption',
            cta: 'Inbox',
            destination: '@fifthclinic',
            scheduledAt: recentIso(-60),
            status: 'scheduled',
            autoEligible: true,
            guardrailScore: 91,
            aiConfidence: 0.9,
            createdAt: recentIso(3),
            updatedAt: recentIso(2),
          },
        ]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('Persisted ready draft')
    expect(html).toContain('Persisted scheduled draft')
    expect(html).toContain('ตั้งเวลาโพสต์ที่พร้อมแล้ว')
  })

  it('shows the cancel schedule action only as usable when a scheduled draft exists', () => {
    const scheduledDraft = makePostDraft({ id: 'scheduled-draft', status: 'scheduled', scheduledAt: recentIso(-45) })

    const withScheduledDraft = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="off"
        drafts={[scheduledDraft]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[makePage()]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )
    const withoutScheduledDraft = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="off"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[makePage()]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(withScheduledDraft).toMatch(/<button(?![^>]*disabled)[^>]*>\s*ยกเลิกเวลาที่ตั้งไว้\s*<\/button>/)
    expect(withoutScheduledDraft).toMatch(/<button(?=[^>]*disabled)[^>]*>\s*ยกเลิกเวลาที่ตั้งไว้\s*<\/button>/)
  })

  it('cancels the first scheduled draft and refreshes the draft queue', async () => {
    const cancelScheduledPostDraft = vi.fn(async () => ({ ok: true, draft: makePostDraft({ status: 'ready', scheduledAt: undefined }) }))
    const schedulePostDraft = vi.fn()
    const createPostDraft = vi.fn()
    const stateUpdates: unknown[] = []

    vi.resetModules()
    vi.doMock('react', async (importOriginal) => {
      const actual = await importOriginal<typeof import('react')>()
      return {
        ...actual,
        useState: <T,>(initialValue: T) => [initialValue, (nextValue: T) => stateUpdates.push(nextValue)] as const,
      }
    })
    vi.doMock('../../src/apps/page-automation/api', () => ({
      cancelScheduledPostDraft,
      createPostDraft,
      schedulePostDraft,
    }))

    try {
      const { AutoPost: MockedAutoPost } = await import('../../src/apps/page-automation/routes/AutoPost')
      const onDraftsChanged = vi.fn()
      const scheduledDraft = makePostDraft({ id: 'scheduled-first', status: 'scheduled', scheduledAt: recentIso(-30) })
      const readyDraft = makePostDraft({ id: 'ready-draft', status: 'ready' })
      const tree = MockedAutoPost({
        adsInsight: null,
        autoMode: 'off',
        drafts: [scheduledDraft, readyDraft],
        messages: [],
        onDraftsChanged,
        pages: [makePage()],
        summary: { avgHealth: 92, followers: 1200, pages: 1, unread: 0 },
      })
      const button = findButtonByText(tree, 'ยกเลิกเวลาที่ตั้งไว้')

      await button.props.onClick()
      await Promise.resolve()
      await Promise.resolve()

      expect(cancelScheduledPostDraft).toHaveBeenCalledWith('scheduled-first')
      expect(onDraftsChanged).toHaveBeenCalledTimes(1)
      expect(stateUpdates).toContain('saving')
      expect(stateUpdates).toContain('saved')
      expect(stateUpdates).toContain('ยกเลิกเวลาที่ตั้งไว้แล้ว รายการกลับไปรอพร้อมตั้งเวลา')
    } finally {
      vi.doUnmock('react')
      vi.doUnmock('../../src/apps/page-automation/api')
      vi.resetModules()
    }
  })

  it('shows Thai unknown permission state in PageAnalysis permission hints', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <PageAnalysis
        adsInsight={null}
        autoMode="off"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('ยังไม่มีรายงานสิทธิ์ของเพจนี้')
    expect(html).not.toContain('No missing permissions in current page reports.')
  })

  it('uses user-facing wording for page data freshness in AutoPost', () => {
    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="off"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[makePage()]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('อัปเดตล่าสุด')
    expect(html).not.toMatch(/ซิงค์|ซิงก์|ที่ซิง/)
  })

  it('shows Thai unknown permission state in Messages before treating an empty inbox as message data', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <Messages
        adsInsight={null}
        autoMode="off"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('ยังตรวจสิทธิ์ข้อความไม่ได้')
    expect(html).not.toContain('The polling endpoint returned no messages for connected pages.')
  })

  it('renders the inbox-first workspace with user-facing Thai copy', () => {
    const page = makePage({ name: 'Promed Clinic' })
    const messages = [
      makeMessage({
        customerDisplayName: 'Yossaya Komonrat',
        messageId: 'message-1',
        pageId: page.id,
        priority: 'high',
        textExcerpt: 'สนใจเติมไขมันหน้า อยากทราบราคา',
        unread: true,
        history: [
          {
            messageId: 'history-1',
            senderName: 'Yossaya Komonrat',
            senderRole: 'customer',
            text: 'สนใจเติมไขมันหน้า อยากทราบราคา',
            createdAt: recentIso(12),
          },
          {
            messageId: 'history-2',
            senderName: 'Promed Clinic',
            senderRole: 'page',
            text: 'ทีมรับเรื่องแล้วค่ะ',
            createdAt: recentIso(9),
          },
        ],
      }),
    ]

    const html = renderToStaticMarkup(
      <InboxWorkspace
        adsInsight={null}
        autoMode="on"
        messages={messages}
        pages={[page]}
        summary={{ avgHealth: 54, followers: 102025, pages: 16, unread: 160 }}
      />,
    )

    expect(html).toContain('ข้อความที่ควรดู')
    expect(html).toContain('AI ร่างคำตอบให้ทีมตรวจ')
    expect(html).toContain('Yossaya Komonrat')
    expect(html).toContain('Promed Clinic')
    expect(html).toContain('ประวัติแชท')
    expect(html).toContain('ทีมรับเรื่องแล้วค่ะ')
    expect(html).toContain('ยังไม่ได้อ่าน')
    expect(html).toContain('ต้องให้ทีมกดส่งเอง')
    expect(html).not.toContain('Unified inbox')
    expect(html).not.toContain('operator-controlled')
    expect(html).not.toContain('No data')
  })

  it('does not expose a fake automatic send action in the inbox workspace', () => {
    const html = renderToStaticMarkup(
      <InboxWorkspace
        adsInsight={null}
        autoMode="on"
        messages={[makeMessage()]}
        pages={[makePage()]}
        summary={{ avgHealth: 54, followers: 102025, pages: 16, unread: 1 }}
      />,
    )

    expect(html).toContain('คัดลอกคำตอบ')
    expect(html).toContain('แก้ก่อนส่ง')
    expect(html).toContain('ทำเครื่องหมายว่าตรวจแล้ว')
    expect(html).not.toContain('ส่งอัตโนมัติ')
    expect(html).not.toContain('Auto send')
  })

  it('uses a latest-message fallback when older chat history is not loaded yet', () => {
    const html = renderToStaticMarkup(
      <InboxWorkspace
        adsInsight={null}
        autoMode="off"
        messages={[makeMessage({ history: undefined, textExcerpt: 'ข้อความล่าสุดจาก Meta' })]}
        pages={[makePage()]}
        summary={{ avgHealth: 54, followers: 102025, pages: 16, unread: 1 }}
      />,
    )

    expect(html).toContain('ประวัติแชท')
    expect(html).toContain('ข้อความล่าสุดจาก Meta')
    expect(html).toContain('มีเฉพาะข้อความล่าสุดจากข้อมูลที่โหลดมา')
  })

  it('marks the selected inbox row with an accessible current indicator', () => {
    const html = renderToStaticMarkup(
      <InboxWorkspace
        adsInsight={null}
        autoMode="off"
        messages={[
          makeMessage({ customerDisplayName: 'Customer First', messageId: 'message-1', receivedAt: recentIso(5) }),
          makeMessage({ customerDisplayName: 'Customer Selected', messageId: 'message-2', receivedAt: recentIso(2) }),
        ]}
        pages={[makePage()]}
        selectedMessageId="message-2"
        summary={{ avgHealth: 54, followers: 102025, pages: 16, unread: 2 }}
      />,
    )

    expect(html).toMatch(/<button[^>]+aria-current="true"[^>]*>[\s\S]*Customer Selected[\s\S]*<\/button>/)
  })

  it('uses the rendered inbox unread count in the message status detail', () => {
    const html = renderToStaticMarkup(
      <InboxWorkspace
        adsInsight={null}
        autoMode="off"
        messages={[makeMessage()]}
        pages={[makePage()]}
        summary={{ avgHealth: 54, followers: 102025, pages: 16, unread: 160 }}
      />,
    )

    expect(html).toContain('1 รายการยังไม่ได้อ่าน')
    expect(html).not.toContain('160 รายการยังไม่ได้อ่าน')
  })

  it('uses user-facing Thai copy on Auto Post and keeps approval gating clear', () => {
    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="on"
        drafts={[]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[makePage()]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('โพสต์ที่กำลังเตรียม')
    expect(html).toContain('กติกาก่อนโพสต์')
    expect(html).toContain('บันทึกแบบร่าง')
    expect(html).toContain('ส่งให้ทีมอนุมัติ')
    expect(html).not.toContain('Content pipeline')
    expect(html).not.toContain('Policy guardrail')
    expect(html).not.toContain('Operator-edited')
    expect(html).not.toContain('Decision context')
  })

  it('renders persisted drafts with Thai text instead of stored English creation labels', () => {
    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="off"
        drafts={[
          {
            id: 'draft-created-by-auto-post',
            pageId: 'page-1',
            pageName: 'Fifth Clinic',
            channel: 'facebook_feed',
            title: 'Educational post from current Ads + Page signal',
            objective: 'Ads-informed page education',
            captionTh: '',
            cta: 'Inbox for consultation',
            destination: '@fifthclinic',
            status: 'draft',
            autoEligible: false,
            guardrailScore: 91,
            aiConfidence: 0.7,
            createdAt: recentIso(3),
            updatedAt: recentIso(2),
          },
        ]}
        messages={[]}
        onDraftsChanged={() => undefined}
        pages={[makePage()]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('โพสต์ให้ความรู้จากข้อมูล Ads และเพจ')
    expect(html).toContain('ให้ความรู้จากข้อมูล Ads และเพจ')
    expect(html).not.toContain('Educational post from current Ads + Page signal')
    expect(html).not.toContain('Ads-informed page education')
    expect(html).not.toContain('Inbox for consultation')
  })
})

function makePage(overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id: 'page-1',
    name: 'Fifth Clinic',
    handle: '@fifthclinic',
    platform: 'facebook',
    followers: 1200,
    followerDelta: 15,
    reach: 5400,
    engagementRate: 3.4,
    unreadCount: 0,
    responseRate: 96,
    avgFirstResponseMins: 12,
    healthScore: 92,
    permissions: [makePermissionReport()],
    lastSyncedAt: recentIso(2),
    ...overrides,
  }
}

function makePermissionReport(overrides: Partial<PageAutomationPermissionReport> = {}): PageAutomationPermissionReport {
  return {
    pageId: 'page-1',
    platform: 'facebook',
    granted: fullFacebookPermissions,
    missing: [],
    checkedAt: recentIso(1),
    ...overrides,
  }
}

function makeMessage(overrides: Partial<PageMessage> = {}): PageMessage {
  return {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    pageId: 'page-1',
    channel: 'facebook_message',
    customerDisplayName: 'Customer A',
    textExcerpt: 'สนใจค่ะ อยากทราบราคา',
    receivedAt: recentIso(3),
    unread: true,
    priority: 'medium',
    status: 'new',
    sentiment: 'neutral',
    intent: 'price',
    slaDueAt: recentIso(-27),
    privacyFlags: [],
    ...overrides,
  }
}

function makePostDraft(overrides: Partial<PostDraft> = {}): PostDraft {
  return {
    id: 'draft-1',
    pageId: 'page-1',
    pageName: 'Fifth Clinic',
    channel: 'facebook_feed',
    title: 'Persisted draft',
    objective: 'Education',
    captionTh: 'Caption',
    cta: 'Inbox',
    destination: '@fifthclinic',
    status: 'ready',
    autoEligible: true,
    guardrailScore: 91,
    aiConfidence: 0.9,
    createdAt: recentIso(3),
    updatedAt: recentIso(2),
    ...overrides,
  }
}

function findButtonByText(element: unknown, text: string): { props: { onClick: () => Promise<void> | void } } {
  if (!isElementLike(element)) {
    throw new Error(`Button "${text}" not found`)
  }

  if (element.type === 'button' && childrenText(element.props.children).trim() === text) {
    return element as { props: { onClick: () => Promise<void> | void } }
  }

  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children]
  for (const child of children) {
    if (isElementLike(child)) {
      try {
        return findButtonByText(child, text)
      } catch {
        // Keep walking siblings until the target button is found.
      }
    }
  }

  throw new Error(`Button "${text}" not found`)
}

function isElementLike(value: unknown): value is { props: { children?: unknown }; type: unknown } {
  return Boolean(value && typeof value === 'object' && 'props' in value && 'type' in value)
}

function childrenText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(childrenText).join('')
  if (isElementLike(value)) return childrenText(value.props.children)
  return ''
}

function makeAdsInsight(overrides: Partial<SharedAdsInsightForPage> = {}): SharedAdsInsightForPage {
  return {
    source: { datePreset: 'last_7d', checkedAt: recentIso(1), taskId: 'brain-1' },
    scope: { pageId: 'page-1', pageName: 'Fifth Clinic', campaignIds: ['cmp-1'], adSetIds: ['set-1'], adIds: ['ad-1'] },
    metrics: { spend: 12000, revenue: 54000, roas: 4.5, cpa: 320, ctr: 1.8, leads: 42, bookings: 11 },
    findings: [],
    recommendations: [],
    creativeSignals: [],
    outcomeSignals: { alerts: [], learnings: [], nextActions: [] },
    policy: { readOnly: true, noMetaWrites: true, noInventedMetrics: true, approvalRequired: true },
    ...overrides,
  }
}

function recentIso(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
}
