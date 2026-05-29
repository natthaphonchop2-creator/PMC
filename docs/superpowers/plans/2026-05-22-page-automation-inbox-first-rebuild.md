# Page Automation Inbox First Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PMC Page Automation into the approved Option B inbox-first workspace using live Meta page/message data and user-facing Thai copy.

**Architecture:** Keep `PageAutomationApp` as the route/data owner and introduce focused inbox model helpers plus an `InboxWorkspace` route component. `/page-automation` and `/page-automation/messages` will share the inbox-first surface; `/page-automation/auto-post` keeps its existing backend behavior but receives the same visual language and user-facing copy cleanup.

**Tech Stack:** React, TypeScript, Vite, lucide-react, existing Page Automation API helpers, Vitest with server-side React rendering, CSS in `src/apps/page-automation/styles.css`.

---

## File Structure

- Modify `src/apps/page-automation/constants.ts`
  - Change visible route labels to Thai user-facing names.
- Create `src/apps/page-automation/inboxModel.ts`
  - Pure helpers for sorting messages, selecting the active message, counting inbox state, resolving page names, and building safe draft guidance.
- Create `src/apps/page-automation/routes/InboxWorkspace.tsx`
  - Implements approved Option B: left message queue, center conversation workspace, right status rail.
- Modify `src/apps/page-automation/PageAutomationApp.tsx`
  - Replace current internal sidebar/dashboard shell with a web-app topbar and route body.
  - Render `InboxWorkspace` for both `dashboard` and `messages`.
  - Keep API loading and Auto ON/OFF updates in this file.
- Modify `src/apps/page-automation/routes/AutoPost.tsx`
  - Keep existing behavior, but update visible copy to the same user-facing language as Option B.
- Modify `src/apps/page-automation/styles.css`
  - Replace the current dashboard-heavy visual system with the approved Option B responsive workspace styles.
- Modify `tests/page-automation/autoPostRoute.test.tsx`
  - Update existing route copy assertions and add inbox workspace render tests.
- Create `tests/page-automation/inboxModel.test.ts`
  - Test pure inbox sorting/counting/guidance helpers.
- Modify `tests/homeApp.test.tsx`
  - Update Page Automation shell copy/logo expectations.

## Task 1: Add Inbox Model Helpers

**Files:**
- Create: `src/apps/page-automation/inboxModel.ts`
- Test: `tests/page-automation/inboxModel.test.ts`

- [ ] **Step 1: Write failing tests for inbox ordering and counts**

Create `tests/page-automation/inboxModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildAiDraftGuidance,
  inboxSummary,
  pageNameForMessage,
  selectInboxMessage,
  sortInboxMessages,
} from '../../src/apps/page-automation/inboxModel'
import type { ManagedPage, PageMessage } from '../../src/apps/page-automation/types'

describe('inboxModel', () => {
  it('sorts unread high-priority messages before other inbox items', () => {
    const lowUnread = message({ messageId: 'low-unread', priority: 'low', unread: true, receivedAt: '2026-05-22T10:00:00.000Z' })
    const highRead = message({ messageId: 'high-read', priority: 'high', unread: false, receivedAt: '2026-05-22T11:00:00.000Z' })
    const highUnreadOld = message({ messageId: 'high-unread-old', priority: 'high', unread: true, receivedAt: '2026-05-22T09:00:00.000Z' })
    const highUnreadNew = message({ messageId: 'high-unread-new', priority: 'high', unread: true, receivedAt: '2026-05-22T12:00:00.000Z' })

    expect(sortInboxMessages([lowUnread, highRead, highUnreadOld, highUnreadNew]).map((item) => item.messageId)).toEqual([
      'high-unread-new',
      'high-unread-old',
      'low-unread',
      'high-read',
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
    expect(pageNameForMessage(message({ pageId: 'page-1' }), [page({ id: 'page-1', name: 'Promed Clinic' })])).toBe('Promed Clinic')
    expect(pageNameForMessage(message({ pageId: 'page-2' }), [])).toBe('เพจที่เชื่อมต่อ')
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
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
npm run test -- tests/page-automation/inboxModel.test.ts
```

Expected: fail because `src/apps/page-automation/inboxModel.ts` does not exist.

- [ ] **Step 3: Implement the model helper module**

Create `src/apps/page-automation/inboxModel.ts`:

```ts
import type { ManagedPage, PageMessage, PageMessageIntent, PageMessagePriority } from './types'

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

export function sortInboxMessages(messages: PageMessage[]) {
  return [...messages].sort((left, right) => {
    const leftUnreadWeight = left.unread ? 0 : 1
    const rightUnreadWeight = right.unread ? 0 : 1
    if (leftUnreadWeight !== rightUnreadWeight) return leftUnreadWeight - rightUnreadWeight

    const leftPriorityWeight = priorityWeight[left.priority]
    const rightPriorityWeight = priorityWeight[right.priority]
    if (leftPriorityWeight !== rightPriorityWeight) return leftPriorityWeight - rightPriorityWeight

    return Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
  })
}

export function inboxSummary(messages: PageMessage[]): InboxSummary {
  return {
    highPriorityUnread: messages.filter((message) => message.unread && message.priority === 'high').length,
    total: messages.length,
    unread: messages.filter((message) => message.unread).length,
  }
}

export function selectInboxMessage(messages: PageMessage[], selectedMessageId = '') {
  if (!messages.length) return null
  const sorted = sortInboxMessages(messages)
  return sorted.find((message) => message.messageId === selectedMessageId) ?? sorted[0] ?? null
}

export function pageNameForMessage(message: PageMessage, pages: ManagedPage[]) {
  return pages.find((page) => page.id === message.pageId)?.name ?? 'เพจที่เชื่อมต่อ'
}

export function buildAiDraftGuidance(message: PageMessage | null): AiDraftGuidance {
  if (!message) {
    return {
      title: 'AI ร่างคำตอบให้ทีมตรวจ',
      detail: 'เลือกข้อความทางซ้ายเพื่อดูสรุปและร่างคำตอบ',
      draft: 'เลือกข้อความก่อน ระบบจะแสดงร่างคำตอบให้ทีมตรวจในช่องนี้',
    }
  }

  const privacyCopy = message.privacyFlags.length ? ' และมีข้อมูลส่วนตัว' : ''
  const complaintCopy = message.intent === 'complaint' || message.sentiment === 'negative' ? ' ควรให้ทีมตรวจอย่างละเอียดก่อนตอบ' : ''

  return {
    title: 'AI ร่างคำตอบให้ทีมตรวจ',
    detail: `ข้อความนี้เป็นกลุ่ม${intentCopy[message.intent]}${privacyCopy}${complaintCopy}`,
    draft: `ขอบคุณที่ทักมาค่ะ ทีมได้รับข้อความแล้วและจะช่วยดูรายละเอียดให้ ทีมควรตรวจรายละเอียดก่อนส่ง โดยเฉพาะข้อมูลราคา การนัดหมาย และข้อมูลส่วนตัวของลูกค้า`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- tests/page-automation/inboxModel.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit model helper work**

```bash
git add src/apps/page-automation/inboxModel.ts tests/page-automation/inboxModel.test.ts
git commit -m "feat: add page automation inbox model"
```

## Task 2: Build The Inbox First Workspace Component

**Files:**
- Create: `src/apps/page-automation/routes/InboxWorkspace.tsx`
- Modify: `tests/page-automation/autoPostRoute.test.tsx`

- [ ] **Step 1: Add failing render tests for the approved Option B surface**

Append to `tests/page-automation/autoPostRoute.test.tsx` imports:

```ts
import { InboxWorkspace } from '../../src/apps/page-automation/routes/InboxWorkspace'
import type { PageMessage } from '../../src/apps/page-automation/types'
```

Add these tests inside `describe('Page Automation route guardrails', () => { ... })`:

```tsx
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
    expect(html).not.toContain('ส่งอัตโนมัติ')
    expect(html).not.toContain('Auto send')
  })
```

Add this helper near the existing `makePage` helper:

```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/page-automation/autoPostRoute.test.tsx
```

Expected: fail because `InboxWorkspace` does not exist.

- [ ] **Step 3: Implement `InboxWorkspace`**

Create `src/apps/page-automation/routes/InboxWorkspace.tsx`:

```tsx
import { Copy, MessageSquareText, PencilLine, ShieldCheck } from 'lucide-react'
import { buildAiDraftGuidance, inboxSummary, pageNameForMessage, selectInboxMessage, sortInboxMessages } from '../inboxModel'
import type { AutoMode, ManagedPage, PageMessage, SharedAdsInsightForPage } from '../types'

type Summary = {
  avgHealth: number
  followers: number
  pages: number
  unread: number
}

type InboxWorkspaceProps = {
  adsInsight: SharedAdsInsightForPage | null
  autoMode: AutoMode
  messages: PageMessage[]
  pages: ManagedPage[]
  selectedMessageId?: string
  summary: Summary
}

export function InboxWorkspace({ adsInsight, autoMode, messages, pages, selectedMessageId, summary }: InboxWorkspaceProps) {
  const sortedMessages = sortInboxMessages(messages)
  const selectedMessage = selectInboxMessage(messages, selectedMessageId)
  const selectedPageName = selectedMessage ? pageNameForMessage(selectedMessage, pages) : ''
  const guidance = buildAiDraftGuidance(selectedMessage)
  const inbox = inboxSummary(messages)
  const selectedPage = selectedMessage ? pages.find((page) => page.id === selectedMessage.pageId) : pages[0]

  return (
    <section className="pa-inbox-workspace" aria-label="Page Automation inbox workspace">
      <aside className="pa-inbox-queue" aria-label="ข้อความที่ควรดู">
        <div className="pa-workspace-panel-head">
          <div>
            <h2>ข้อความที่ควรดู</h2>
            <p>{inbox.total ? `${inbox.unread} รายการยังไม่ได้อ่าน จาก ${inbox.total} ข้อความ` : 'ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้'}</p>
          </div>
          <span className="pa-soft-count">{inbox.highPriorityUnread}</span>
        </div>

        <div className="pa-inbox-list">
          {sortedMessages.length ? (
            sortedMessages.map((message) => (
              <MessageQueueItem
                active={message.messageId === selectedMessage?.messageId}
                key={message.messageId}
                message={message}
                pageName={pageNameForMessage(message, pages)}
              />
            ))
          ) : (
            <div className="pa-inbox-empty">
              <MessageSquareText size={20} />
              <strong>ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้</strong>
              <p>เมื่อมีข้อความใหม่ ระบบจะแสดงรายการที่ควรตอบก่อนตรงนี้</p>
            </div>
          )}
        </div>
      </aside>

      <section className="pa-conversation-workspace" aria-label="รายละเอียดข้อความ">
        {selectedMessage ? (
          <>
            <div className="pa-conversation-head">
              <div>
                <span className="pa-kicker">{selectedPageName}</span>
                <h2>{selectedMessage.customerDisplayName}</h2>
                <p>{selectedMessage.unread ? 'ยังไม่ได้อ่าน' : 'เปิดดูแล้ว'} · {priorityLabel(selectedMessage.priority)} · {formatDateTime(selectedMessage.receivedAt)}</p>
              </div>
              <span className={`pa-priority-pill ${selectedMessage.priority}`}>{priorityLabel(selectedMessage.priority)}</span>
            </div>

            <div className="pa-chat-card customer">
              <span>ข้อความลูกค้า</span>
              <p>{selectedMessage.textExcerpt}</p>
            </div>

            <div className="pa-ai-draft-card">
              <div className="pa-ai-draft-head">
                <span className="pa-ai-icon"><ShieldCheck size={17} /></span>
                <div>
                  <strong>{guidance.title}</strong>
                  <p>{guidance.detail}</p>
                </div>
              </div>
              <textarea readOnly rows={5} value={guidance.draft} />
              <div className="pa-inbox-actions">
                <button className="pa-button primary" type="button"><PencilLine size={15} />แก้ก่อนส่ง</button>
                <button className="pa-button" type="button"><Copy size={15} />คัดลอกคำตอบ</button>
                <button className="pa-button" type="button">ทำเครื่องหมายว่าตรวจแล้ว</button>
              </div>
              <p className="pa-human-note">AI ช่วยร่างเท่านั้น ข้อความนี้ต้องให้ทีมกดส่งเอง</p>
            </div>
          </>
        ) : (
          <div className="pa-conversation-empty">
            <MessageSquareText size={22} />
            <strong>เลือกข้อความทางซ้ายเพื่อดูรายละเอียดและร่างคำตอบ</strong>
            <p>ระบบจะแสดงบริบทเพจ สรุปจาก AI และคำตอบฉบับร่างให้ตรวจ</p>
          </div>
        )}
      </section>

      <aside className="pa-status-rail" aria-label="สถานะวันนี้">
        <StatusCard label="ข้อความจาก Meta" value={formatNumber(inbox.total)} detail={`${formatNumber(inbox.unread)} รายการยังไม่ได้อ่าน`} />
        <StatusCard label="ควรตอบก่อน" value={formatNumber(inbox.highPriorityUnread)} detail="รายการสำคัญในคิวข้อความ" tone={inbox.highPriorityUnread > 0 ? 'watch' : 'good'} />
        <StatusCard label="เพจที่เชื่อมต่อ" value={formatNumber(summary.pages)} detail={`${formatNumber(summary.followers)} ผู้ติดตามรวม`} />
        <StatusCard label="Auto" value={autoMode === 'on' ? 'เปิด' : 'ปิด'} detail={autoMode === 'on' ? 'ใช้เฉพาะงานความเสี่ยงต่ำ ไม่ส่งแชทแทนทีม' : 'แนะนำเท่านั้นและรอทีมกด'} tone={autoMode === 'on' ? 'watch' : 'neutral'} />
        <StatusCard label="เพจที่เลือก" value={selectedPage ? `${Math.round(selectedPage.healthScore)}%` : '-'} detail={selectedPage ? `${formatNumber(selectedPage.followers)} ผู้ติดตาม` : 'ยังไม่ได้เลือกข้อความ'} />
        <StatusCard label="บริบท Ads" value={adsInsight ? `${adsInsight.metrics.roas.toFixed(2)}x` : '-'} detail={adsInsight ? 'ใช้ประกอบคำแนะนำเท่านั้น' : 'ยังไม่มีบริบท Ads สำหรับข้อความนี้'} />
      </aside>
    </section>
  )
}

function MessageQueueItem({ active, message, pageName }: { active: boolean; message: PageMessage; pageName: string }) {
  return (
    <article className={`pa-inbox-item ${active ? 'active' : ''} ${message.unread ? 'unread' : ''}`}>
      <span className="pa-avatar">{initials(message.customerDisplayName)}</span>
      <div className="pa-inbox-item-copy">
        <div>
          <strong>{message.customerDisplayName}</strong>
          <span>{formatDateTime(message.receivedAt)}</span>
        </div>
        <p>{message.textExcerpt}</p>
        <footer>
          <span>{pageName}</span>
          <span>{message.unread ? 'ยังไม่ได้อ่าน' : 'เปิดดูแล้ว'}</span>
        </footer>
      </div>
    </article>
  )
}

function StatusCard({ detail, label, tone = 'neutral', value }: { detail: string; label: string; tone?: 'good' | 'watch' | 'neutral'; value: string }) {
  return (
    <article className={`pa-status-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'C'
}

function priorityLabel(priority: PageMessage['priority']) {
  if (priority === 'high') return 'ควรตอบก่อน'
  if (priority === 'medium') return 'ติดตาม'
  return 'ปกติ'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}

function formatDateTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'ไม่ทราบเวลา'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(time))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test -- tests/page-automation/autoPostRoute.test.tsx tests/page-automation/inboxModel.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit inbox workspace component**

```bash
git add src/apps/page-automation/routes/InboxWorkspace.tsx tests/page-automation/autoPostRoute.test.tsx
git commit -m "feat: add inbox first page automation workspace"
```

## Task 3: Wire The Approved Shell And Routes

**Files:**
- Modify: `src/apps/page-automation/constants.ts`
- Modify: `src/apps/page-automation/PageAutomationApp.tsx`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Update failing shell tests**

Modify the Page Automation logo test in `tests/homeApp.test.tsx`:

```tsx
  it('uses the approved inbox-first Page Automation shell copy', () => {
    withPathname('/page-automation/messages', () => {
      const html = renderToStaticMarkup(<PageAutomationApp />)

      expect(countOccurrences(html, 'src="/pmc-page-auto-logo.png?v=transparent"')).toBe(1)
      expect(html).toContain('PMC Page Auto')
      expect(html).toContain('ศูนย์จัดการเพจและข้อความ')
      expect(html).toContain('ข้อความ')
      expect(html).toContain('โพสต์')
      expect(html).toContain('วิเคราะห์เพจ')
      expect(html).toContain('รายงาน')
      expect(html).toContain('href="/"')
      expect(html).toContain('กลับ Home')
      expect(html).not.toContain('Meta API operations')
      expect(html).not.toContain('Unified inbox')
      expect(html).not.toContain('Dashboard')
    })
  })
```

- [ ] **Step 2: Run the shell test to verify failure**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: fail because current shell still contains old copy and route labels.

- [ ] **Step 3: Update route labels**

Modify `src/apps/page-automation/constants.ts`:

```ts
export const PAGE_AUTOMATION_ROUTES: Array<{ id: PageAutomationRouteId; href: string; label: string }> = [
  { id: 'dashboard', href: '/page-automation', label: 'ข้อความ' },
  { id: 'auto-post', href: '/page-automation/auto-post', label: 'โพสต์' },
  { id: 'pages', href: '/page-automation/pages', label: 'วิเคราะห์เพจ' },
  { id: 'messages', href: '/page-automation/messages', label: 'ข้อความ' },
  { id: 'analytics', href: '/page-automation/analytics', label: 'รายงาน' },
]
```

- [ ] **Step 4: Wire `PageAutomationApp` to the new shell and inbox route**

Modify imports in `src/apps/page-automation/PageAutomationApp.tsx`:

```ts
import {
  BarChart3,
  CalendarClock,
  ChartNoAxesCombined,
  Home,
  Inbox,
  Power,
  Search,
} from 'lucide-react'
```

Replace `Messages` import with:

```ts
import { InboxWorkspace } from './routes/InboxWorkspace'
```

Use this icon map:

```ts
const routeIcons: Record<PageAutomationRouteId, typeof BarChart3> = {
  dashboard: Inbox,
  'auto-post': CalendarClock,
  pages: Search,
  messages: Inbox,
  analytics: ChartNoAxesCombined,
}
```

Replace the current returned shell markup with:

```tsx
  return (
    <main className="pa-shell">
      <section className="pa-main">
        <header className="pa-app-topbar">
          <a className="pa-brand-link" href="/page-automation" title="หน้าแรก Page Automation">
            <span className="pa-brand-logo-wrap">
              <img src="/pmc-page-auto-logo.png?v=transparent" alt="PMC Page Auto" />
            </span>
            <span>
              <strong>PMC Page Auto</strong>
              <small>ศูนย์จัดการเพจและข้อความ</small>
            </span>
          </a>

          <nav className="pa-app-nav" aria-label="Page Automation navigation">
            {PAGE_AUTOMATION_ROUTES.filter((item, index, routes) => routes.findIndex((routeItem) => routeItem.href === item.href) === index).map((item) => {
              const Icon = routeIcons[item.id]
              return (
                <a
                  aria-current={route === item.id ? 'page' : undefined}
                  className={route === item.id ? 'active' : ''}
                  href={item.href}
                  key={item.href}
                  onClick={(event) => {
                    event.preventDefault()
                    window.history.pushState(null, '', item.href)
                    setRoute(item.id)
                  }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </a>
              )
            })}
          </nav>

          <div className="pa-topbar-actions">
            <span className={`pa-source-pill ${dataSource}`} title={statusCheckedAt ? `ตรวจล่าสุด ${statusCheckedAt}` : sourceLabel(dataSource)}>
              {sourceLabel(dataSource)}
            </span>
            <button
              aria-pressed={autoMode === 'on'}
              className={`pa-auto-toggle ${autoMode}`}
              disabled={autoModeSaving}
              onClick={() => void handleAutoToggle()}
              type="button"
            >
              <Power size={16} />
              <span>{autoMode === 'on' ? 'Auto เปิด' : 'Auto ปิด'}</span>
            </button>
            <a className="pa-home-link" href="/" aria-label="กลับหน้า Home">
              <Home size={15} />
              <span>กลับ Home</span>
            </a>
          </div>
        </header>

        {error ? <div className="pa-error" role="alert">{error}</div> : null}

        {loadState === 'loading' ? (
          <PageAutomationState detail="กำลังโหลดข้อมูลเพจและข้อความจาก Meta" title="กำลังโหลด Page Auto" />
        ) : null}

        {route === 'auto-post' ? <AutoPost {...sharedRouteProps} drafts={drafts} onDraftsChanged={refreshDrafts} /> : null}
        {route === 'pages' ? <PageAnalysis {...sharedRouteProps} /> : null}
        {route === 'messages' ? <InboxWorkspace {...sharedRouteProps} /> : null}
        {route === 'analytics' ? <AnalyticsDashboard {...sharedRouteProps} view="analytics" /> : null}
        {route === 'dashboard' ? <InboxWorkspace {...sharedRouteProps} /> : null}
      </section>
    </main>
  )
```

Update `sourceLabel`:

```ts
function sourceLabel(source: DataSource) {
  if (source === 'meta') return 'เชื่อมต่อ Meta แล้ว'
  if (source === 'cache') return 'ใช้ข้อมูลล่าสุดที่บันทึกไว้'
  if (source === 'unavailable') return 'เชื่อมต่อ Meta ไม่สำเร็จ'
  return 'กำลังโหลด'
}
```

- [ ] **Step 5: Run shell tests**

Run:

```bash
npm run test -- tests/homeApp.test.tsx tests/page-automation/autoPostRoute.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit route shell wiring**

```bash
git add src/apps/page-automation/constants.ts src/apps/page-automation/PageAutomationApp.tsx tests/homeApp.test.tsx
git commit -m "feat: wire page automation inbox first shell"
```

## Task 4: Restyle Page Automation To Match Option B

**Files:**
- Modify: `src/apps/page-automation/styles.css`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Add CSS guard assertions**

Add to the existing palette test in `tests/homeApp.test.tsx`:

```ts
    expect(pageCss).toContain('.pa-inbox-workspace')
    expect(pageCss).toContain('grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.42fr) minmax(250px, 0.8fr)')
    expect(pageCss).toContain('@media (max-width: 760px)')
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: fail because the new CSS classes are not present.

- [ ] **Step 3: Replace shell/sidebar-heavy CSS with Option B styles**

In `src/apps/page-automation/styles.css`, keep the root color tokens and add these sections near the top of the file. Remove or override old `.pa-dock`, `.pa-metric-grid`, and old sidebar layout rules so they do not affect the new shell.

```css
.pa-shell {
  --pa-bg: #f6f9ff;
  --pa-surface: #ffffff;
  --pa-surface-2: #f8fbff;
  --pa-ink: #101828;
  --pa-muted: #667085;
  --pa-border: #dfe7f2;
  --pa-border-strong: #c9d6e5;
  --pa-violet: #7567d8;
  --pa-blue: #2f86eb;
  --pa-mint: #30d5a8;
  --pa-green: #18b99a;
  --pa-amber: #f59e0b;
  --pa-red: #e5484d;
  --pa-shadow: 0 18px 50px rgba(23, 35, 54, 0.1);
  min-height: 100vh;
  min-height: 100dvh;
  background:
    radial-gradient(circle at 16% 0%, rgba(117, 103, 216, 0.11), transparent 30%),
    radial-gradient(circle at 86% 2%, rgba(24, 185, 154, 0.13), transparent 28%),
    linear-gradient(180deg, #fbfdff 0%, var(--pa-bg) 44%, #eef8f4 100%);
  color: var(--pa-ink);
}

.pa-main {
  width: min(100%, 1220px);
  margin: 0 auto;
  padding: 18px;
}

.pa-app-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: 70px;
  display: grid;
  grid-template-columns: minmax(220px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  border: 1px solid rgba(201, 214, 229, 0.86);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--pa-shadow);
  backdrop-filter: blur(18px);
  padding: 10px 12px;
}

.pa-app-nav {
  min-width: 0;
  display: flex;
  justify-content: center;
  gap: 4px;
}

.pa-app-nav a {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 10px;
  padding: 0 12px;
  color: #40516b;
  font-size: 13px;
  font-weight: 850;
  text-decoration: none;
}

.pa-app-nav a.active {
  background: #ece8ff;
  color: #5c4bc6;
}

.pa-inbox-workspace {
  margin-top: 18px;
  display: grid;
  grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.42fr) minmax(250px, 0.8fr);
  gap: 14px;
  align-items: start;
}

.pa-inbox-queue,
.pa-conversation-workspace,
.pa-status-rail {
  min-width: 0;
  border: 1px solid var(--pa-border);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 28px rgba(23, 35, 54, 0.08);
}

.pa-inbox-queue,
.pa-conversation-workspace {
  padding: 16px;
}

.pa-status-rail {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.pa-workspace-panel-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--pa-border);
}

.pa-workspace-panel-head h2,
.pa-conversation-head h2 {
  margin: 0;
  color: var(--pa-ink);
  font-size: 20px;
  line-height: 1.15;
  font-weight: 930;
  letter-spacing: 0;
}

.pa-workspace-panel-head p,
.pa-conversation-head p,
.pa-status-card p,
.pa-inbox-item p,
.pa-inbox-item footer,
.pa-ai-draft-card p,
.pa-human-note {
  margin: 0;
  color: var(--pa-muted);
  line-height: 1.5;
}

.pa-soft-count {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fff3d7;
  color: #9a5f00;
  font-size: 13px;
  font-weight: 950;
}

.pa-inbox-list {
  margin-top: 13px;
  display: grid;
  gap: 10px;
  max-height: 680px;
  overflow: auto;
}

.pa-inbox-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  border: 1px solid var(--pa-border);
  border-radius: 16px;
  background: #fbfdff;
  padding: 12px;
}

.pa-inbox-item.active {
  border-color: rgba(47, 134, 235, 0.45);
  background: #eef6ff;
}

.pa-avatar {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--pa-violet), var(--pa-blue));
  color: #fff;
  font-size: 13px;
  font-weight: 930;
}

.pa-inbox-item-copy {
  min-width: 0;
}

.pa-inbox-item-copy > div,
.pa-inbox-item footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pa-inbox-item strong {
  overflow: hidden;
  color: var(--pa-ink);
  font-size: 13px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pa-inbox-item p {
  margin-top: 5px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 680;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pa-inbox-item footer {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 760;
}

.pa-conversation-workspace {
  min-height: 560px;
}

.pa-conversation-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--pa-border);
}

.pa-kicker {
  color: var(--pa-blue);
  font-size: 12px;
  font-weight: 900;
}

.pa-priority-pill,
.pa-status-card.good,
.pa-status-card.watch,
.pa-status-card.neutral {
  border-radius: 999px;
}

.pa-priority-pill {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  background: #fff3d7;
  color: #9a5f00;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.pa-priority-pill.high {
  background: #ffecef;
  color: #c32935;
}

.pa-chat-card,
.pa-ai-draft-card,
.pa-conversation-empty,
.pa-inbox-empty {
  margin-top: 14px;
  border: 1px solid var(--pa-border);
  border-radius: 18px;
  background: linear-gradient(180deg, var(--pa-surface-2), #fff);
  padding: 16px;
}

.pa-chat-card span {
  color: var(--pa-muted);
  font-size: 12px;
  font-weight: 800;
}

.pa-chat-card p {
  margin: 8px 0 0;
  color: #24364c;
  font-size: 14px;
  line-height: 1.6;
  font-weight: 700;
}

.pa-ai-draft-card {
  background: #f6f4ff;
  border-color: rgba(117, 103, 216, 0.24);
}

.pa-ai-draft-head {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.pa-ai-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #ece8ff;
  color: var(--pa-violet);
}

.pa-ai-draft-card textarea {
  width: 100%;
  margin-top: 12px;
  border: 1px solid rgba(117, 103, 216, 0.24);
  border-radius: 14px;
  background: #fff;
  color: var(--pa-ink);
  resize: vertical;
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  font-weight: 650;
}

.pa-inbox-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pa-human-note {
  margin-top: 10px;
  font-size: 12px;
  font-weight: 760;
}

.pa-status-card {
  border: 1px solid var(--pa-border);
  border-radius: 16px;
  background: #fff;
  padding: 14px;
}

.pa-status-card span {
  color: var(--pa-muted);
  font-size: 12px;
  font-weight: 800;
}

.pa-status-card strong {
  display: block;
  margin-top: 8px;
  color: var(--pa-ink);
  font-size: 24px;
  line-height: 1;
  font-weight: 950;
}

.pa-status-card p {
  margin-top: 9px;
  font-size: 12px;
  font-weight: 680;
}

@media (max-width: 1080px) {
  .pa-app-topbar,
  .pa-inbox-workspace {
    grid-template-columns: 1fr;
  }

  .pa-app-nav {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .pa-status-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .pa-main {
    padding: 12px;
  }

  .pa-app-topbar {
    border-radius: 16px;
  }

  .pa-topbar-actions,
  .pa-inbox-actions,
  .pa-conversation-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .pa-status-rail {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run CSS guard tests**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit styling work**

```bash
git add src/apps/page-automation/styles.css tests/homeApp.test.tsx
git commit -m "style: restyle page automation inbox workspace"
```

## Task 5: Clean Auto Post Copy Without Changing Behavior

**Files:**
- Modify: `src/apps/page-automation/routes/AutoPost.tsx`
- Modify: `tests/page-automation/autoPostRoute.test.tsx`

- [ ] **Step 1: Add failing copy tests**

Append test:

```tsx
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/page-automation/autoPostRoute.test.tsx
```

Expected: fail because current Auto Post copy is internal English.

- [ ] **Step 3: Update visible copy in Auto Post**

Change panel titles/subtitles and button labels in `src/apps/page-automation/routes/AutoPost.tsx`:

```tsx
<PageAutomationPanel
  className="pa-span-8"
  subtitle="ติดตามแบบร่าง รายการรออนุมัติ รายการตั้งเวลา และผลลัพธ์หลังเผยแพร่"
  title="โพสต์ที่กำลังเตรียม"
>
```

```tsx
<PageAutomationPanel
  className="pa-span-4"
  subtitle="Auto เปิดได้เฉพาะโพสต์ความเสี่ยงต่ำ รายการไม่ชัดเจนต้องให้ทีมอนุมัติ"
  title="กติกาก่อนโพสต์"
>
```

```tsx
<PageAutomationState
  detail="ระบบช่วยเตรียมโพสต์ได้ แต่รายการที่มีความเสี่ยงหรือข้อมูลไม่ครบต้องให้ทีมตรวจ"
  tone="neutral"
  title="ไม่มีการเผยแพร่รายการเสี่ยงเอง"
/>
```

```tsx
<PageAutomationPanel className="pa-span-7" subtitle="ทีมตรวจและแก้ข้อความก่อนส่งเข้าคิวอนุมัติหรือตั้งเวลา" title="ร่างโพสต์">
```

```tsx
<button className="pa-button" ...>
  บันทึกแบบร่าง
</button>
<button className="pa-button primary" ...>
  ส่งให้ทีมอนุมัติ
</button>
<button className="pa-button" ...>
  ทำเครื่องหมายว่าพร้อมตั้งเวลา
</button>
<button className="pa-button" ...>
  ตั้งเวลาโพสต์ที่พร้อมแล้ว
</button>
```

```tsx
<PageAutomationPanel className="pa-span-5" subtitle="ตรวจความสดของข้อมูล สิทธิ์เพจ และบริบทจาก Ads ก่อนสร้างโพสต์" title="ข้อมูลประกอบการตัดสินใจ">
```

Keep function names, API calls, and eligibility logic unchanged.

- [ ] **Step 4: Run route tests**

Run:

```bash
npm run test -- tests/page-automation/autoPostRoute.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit Auto Post copy cleanup**

```bash
git add src/apps/page-automation/routes/AutoPost.tsx tests/page-automation/autoPostRoute.test.tsx
git commit -m "style: align auto post copy with page automation workspace"
```

## Task 6: Full Verification And Browser QA

**Files:**
- No planned source edits unless verification finds a scoped issue in files touched above.

- [ ] **Step 1: Run focused Page Automation tests**

Run:

```bash
npm run test -- tests/page-automation/inboxModel.test.ts tests/page-automation/autoPostRoute.test.tsx tests/page-automation/pageAutomationMetaApi.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run Home shell tests**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code 0.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: exit code 0. A Vite chunk-size warning is acceptable because the app already uses ECharts.

- [ ] **Step 5: Browser verify `/page-automation`**

Use the Browser plugin to open:

```text
http://127.0.0.1:56145/page-automation
```

Check:

- Header says `PMC Page Auto`.
- Navigation shows `ข้อความ`, `โพสต์`, `วิเคราะห์เพจ`, `รายงาน`.
- Left queue shows real messages when `/api/page-automation/messages` returns messages.
- Center panel shows selected conversation and AI draft guidance.
- Right rail shows message/page/Auto status from current props.
- No console errors or warnings.
- No visible `Meta API operations`, `bridge`, `guardrails`, `operator`, `source`, `No data`, or `Unavailable`.

- [ ] **Step 6: Browser verify `/page-automation/messages` and `/page-automation/auto-post`**

Use the Browser plugin to open:

```text
http://127.0.0.1:56145/page-automation/messages
http://127.0.0.1:56145/page-automation/auto-post
```

Check:

- `/messages` uses the same inbox-first surface.
- `/auto-post` uses the same topbar, surface language, buttons, and approval-gated copy.
- No console errors or warnings.

- [ ] **Step 7: Browser responsive checks**

Use Browser viewport checks or Playwright only if Browser viewport control is unavailable.

Check widths:

- 1280px desktop: three-column inbox layout.
- 900px tablet: columns collapse without horizontal overflow.
- 390px mobile: single-column layout, readable text, no clipped buttons.

- [ ] **Step 8: Commit verification fixes if needed**

If verification required scoped fixes:

```bash
git add src/apps/page-automation tests/page-automation tests/homeApp.test.tsx
git commit -m "fix: polish page automation inbox workspace"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

Spec coverage:

- Inbox-first product shape: Tasks 2, 3, and 4.
- User-facing copy rules: Tasks 2, 3, 5, and browser checks in Task 6.
- Live data rules: Task 2 receives existing live props; Task 3 keeps data loading in `PageAutomationApp`.
- Safety model: Task 2 tests no fake automatic send action; Task 5 keeps post actions approval-gated.
- Responsive behavior: Task 4 CSS and Task 6 viewport checks.
- Error and empty states: Task 2 empty state and Task 6 browser checks.
- Auto Post relationship: Task 5.

Placeholder scan:

- No incomplete marker tokens or vague implementation steps are present.
- Each implementation task includes concrete file paths, code snippets, commands, and expected outputs.

Type consistency:

- `InboxWorkspace` props use existing `AutoMode`, `ManagedPage`, `PageMessage`, and `SharedAdsInsightForPage` types.
- Model helpers use existing `PageMessage` and `ManagedPage` fields.
- Route ids stay within existing `PageAutomationRouteId`.
