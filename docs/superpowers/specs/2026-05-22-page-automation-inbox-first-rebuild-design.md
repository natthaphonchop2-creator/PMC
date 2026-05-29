# Page Automation Inbox First Rebuild Design

Date: 2026-05-22
Status: Draft for user review
Selected reference: `docs/releases/2026-05-29-v0.1.0/page-automation-design-options.html` option B, "Inbox First Workspace"

## Goal

Rebuild PMC Page Automation around the work users need to do first: read and triage messages from every connected page, see AI-assisted draft guidance, and move into post automation or page analysis only when needed.

The current Page Automation screens behave like an internal dashboard. The rebuild should feel like a focused business tool for page operators. It should show real Meta data when available, clearly explain unavailable data, and avoid internal system terms in visible copy.

## Product Shape

The primary `/page-automation` experience becomes an inbox-first workspace.

- Left rail: message queue from connected pages, prioritized by unread, high priority, and recent activity.
- Center: selected conversation preview with customer message, AI summary, and draft reply controls.
- Right rail: today's operational status, including connected pages, unread count, high-priority count, Meta connection, and Auto mode.
- Top navigation: simple page-level navigation for messages, auto post, page analysis, reports, and settings.

The selected Option B layout is also the direction for `/page-automation/messages`. The route can share the same component family so users get one consistent workspace.

## Visible Copy Rules

Visible copy must speak to end users, not developers.

Use:
- "ข้อความที่ควรดู"
- "AI ร่างคำตอบให้ทีมตรวจ"
- "ยังไม่ได้อ่าน"
- "ควรตอบก่อน"
- "ต้องให้ทีมกดส่งเอง"
- "เชื่อมต่อ Meta แล้ว"

Avoid:
- "Meta API operations"
- "bridge"
- "guardrails"
- "operator"
- "polling"
- "workspace" unless it means a user-facing workspace name
- "read-only Ads AI bridge"
- "source"

## Data Rules

Use live API data from the existing Page Automation endpoints:

- `/api/page-automation/status`
- `/api/page-automation/pages`
- `/api/page-automation/messages`
- `/api/page-automation/post-drafts`
- `/api/page-automation/ads-insights`

Known current live state from local verification:

- Pages loaded from Meta: 16
- Followers total: about 102,025
- Messages loaded from Meta: 353
- Unread messages: 160
- High priority unread messages: 6

Do not hardcode those numbers in production UI. They may appear only in the HTML reference. React implementation must derive them from endpoint responses.

## Safety Model

The inbox-first screen can show AI suggestions, but it must not send replies automatically.

Required behavior:

- AI reply text is draft-only.
- User must click to copy, edit, or send through the approved backend flow.
- Any message containing private information, medical context, complaints, or unclear intent must stay human-approved.
- Auto mode may be shown globally, but it must be clear that inbox replies are not auto-sent.

## Layout Details

### Header

Header should be compact and web-app-like.

Required elements:

- PMC Page Auto brand and logo.
- Navigation: `ข้อความ`, `โพสต์`, `วิเคราะห์เพจ`, `รายงาน`.
- Meta connection status.
- Back to Home control.
- Auto ON/OFF status as a visible but secondary control.

### Left Message Queue

The queue shows compact rows.

Each row should include:

- Customer display name or fallback label.
- Page name or channel label.
- Short message excerpt.
- Received time.
- Priority status.
- Unread state.

Default sort:

1. Unread high priority
2. Other unread
3. Recently received open messages
4. Low priority or already reviewed

### Center Conversation Area

The center area is the main work surface.

It should show:

- Selected customer/page context.
- Latest message excerpt.
- Privacy flags when present.
- AI summary in plain Thai.
- Draft reply area.
- Actions: `แก้ก่อนส่ง`, `คัดลอกคำตอบ`, `ทำเครื่องหมายว่าตรวจแล้ว`.

Do not show a fake send action unless a real backend path exists for the approved send flow.

### Right Insight Rail

The right rail gives operational context, not a dense dashboard.

Cards:

- Inbox status: total messages, unread messages, high priority count.
- Meta status: connected, partial permissions, or unavailable.
- Auto status: ON/OFF with a short explanation.
- Page context: selected page followers, health score, and last synced time.
- AI guidance: short summary of why the selected message needs human review.

## Auto Post Route Relationship

`/page-automation/auto-post` should remain focused on post pipeline, but use the same visual system as Option B.

For this rebuild phase:

- Do not redesign Auto Post into a separate heavy dashboard.
- Keep post actions approval-gated.
- Use the same header, surface styling, buttons, badges, and copy rules.
- If no drafts exist, show an empty state that helps the user create a draft from inbox/page insights.

## Component Plan

Create or refactor toward focused components:

- `PageAutomationShell`
- `PageAutomationTopbar`
- `MessageQueue`
- `MessageQueueItem`
- `ConversationWorkspace`
- `AiReplyDraftPanel`
- `PageAutomationStatusRail`
- `PageAutomationStatCard`
- `PageAutomationEmptyState`

Keep data loading in `PageAutomationApp` or a small route-level hook. Components should receive typed data and avoid fetching independently unless a route needs polling.

## Responsive Behavior

Desktop:

- Three-column layout: message queue, conversation, insight rail.

Tablet:

- Two-column layout: message queue and conversation first, insight rail below or collapsible.

Mobile:

- Single-column layout.
- Queue appears first.
- Selecting a message opens the conversation block below it.
- Right rail status collapses into compact cards below the main actions.
- No horizontal overflow.

## Error And Empty States

Use explicit user-facing states:

- Meta connected, no messages: "ยังไม่มีข้อความใหม่จาก Meta ในช่วงนี้"
- Missing messaging permission: "ยังอ่านกล่องข้อความไม่ได้ เพราะสิทธิ์ข้อความของเพจยังไม่ครบ"
- Meta unavailable: "เชื่อมต่อ Meta ไม่สำเร็จ ลองตรวจ API Key หรือเชื่อมต่อใหม่"
- No selected message: "เลือกข้อความทางซ้ายเพื่อดูรายละเอียดและร่างคำตอบ"

Never show "No data", "Unavailable", or raw API/internal labels as primary user copy.

## Testing

Add focused coverage for:

- Page Automation shell renders selected Option B copy.
- Message queue shows live message count and unread count from props.
- Missing permission state does not pretend data is ready.
- AI draft panel does not include automatic send copy.
- Mobile-friendly layout classes/rendering are present.

Run:

- `npm run test -- tests/homeApp.test.tsx tests/page-automation/autoPostRoute.test.tsx`
- `npm run test -- tests/page-automation/pageAutomationMetaApi.test.ts`
- `npm run lint`
- `npm run build`

Browser verification:

- Open `/page-automation`.
- Open `/page-automation/messages`.
- Open `/page-automation/auto-post`.
- Confirm no console errors.
- Confirm live Meta messages are visible when endpoint returns messages.
- Confirm copy uses user-facing language.

## Scope Limits

This rebuild does not add real Meta reply sending.

This rebuild does not implement webhook support.

This rebuild does not change token storage or Meta API credentials.

This rebuild does not deploy automatically until the user approves implementation and verification passes.
