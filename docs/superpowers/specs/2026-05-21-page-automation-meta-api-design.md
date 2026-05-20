# Page Automation Meta API Design

Date: 2026-05-21
Status: awaiting user review
Owner: Codex

## Goal

Build a new standalone Page Automation program for Ads Auto Post, page analysis, unified messages, and analytics dashboard. The program must not be mixed into the PMC Ads Agent navigation or data model, but it must reuse the Ads AI analysis already produced by the PMC Ads Agent through a read-only bridge.

The new program must be backed by real Meta API data. It is not a mock-only dashboard.

## Product Boundary

PMC Ads Agent remains responsible for ads workspace analysis: campaigns, ad sets, ads, optimization, AI Brain, guarded ads recommendations, outcomes, and Meta ads write controls.

Page Automation owns page-level work: connected pages, post drafting, scheduling, publishing, page health analysis, cross-page messages, comments, inbox triage, page analytics, and dashboard insights.

The apps can share generic helpers, but Page Automation must not reuse `WorkspaceData` as its primary model. It gets its own models such as `PageAutomationWorkspace`, `ManagedPage`, `PostDraft`, `PageMessage`, `PageAnalytics`, and `SharedAdsInsightForPage`.

## Routes And App Structure

Keep PMC Ads Agent at `/`.

Add Page Automation as a sibling app:

```txt
/page-automation
/page-automation/auto-post
/page-automation/pages
/page-automation/messages
/page-automation/analytics
```

Recommended frontend structure:

```txt
src/
  App.tsx
  shared/
    api/http.ts
    formatters.ts
    ui/
  apps/
    pmc-ads-agent/
    page-automation/
      PageAutomationApp.tsx
      types.ts
      api.ts
      styles.css
      routes/
        AutoPost.tsx
        PageAnalysis.tsx
        Messages.tsx
        AnalyticsDashboard.tsx
```

`src/App.tsx` should become a small top-level route switch rather than the home for both large apps.

Route mapping:

| Route | Component | Purpose |
| --- | --- | --- |
| `/page-automation` | `AnalyticsDashboard.tsx` | Default command dashboard for Auto state, Page, Inbox, and Ads-linked insight. |
| `/page-automation/auto-post` | `AutoPost.tsx` | Content pipeline, calendar, draft composer, guardrails, and publish monitor. |
| `/page-automation/pages` | `PageAnalysis.tsx` | Cross-page analysis, page health, content performance, and Ads AI context. |
| `/page-automation/messages` | `Messages.tsx` | Unified inbox for page messages, comments, mentions, reviews, and SLA triage. |
| `/page-automation/analytics` | `AnalyticsDashboard.tsx` | Full analytics view. Same component as default route, with analytics tab selected. |

## Visual Direction

Use the approved visual reference generated at:

```txt
/Users/natthaphon/.codex/generated_images/019e473c-4edf-72f2-b19d-d3ad37116407/ig_05c0f289c81203fa016a0e252c59d88191aebcdfe171485f27.png
```

The Page Automation UI should feel like a social publishing and operations control center, not a clone of the PMC Ads Agent cockpit. Use top navigation plus compact icon dock, a central content pipeline, a unified inbox panel, and embedded analytics. Avoid the old violet/blue-first accent system, large PMC sidebar, first-row KPI cockpit, and clinic funnel hero.

## Meta API Requirement

Page Automation must call server-owned `/api/page-automation/*` endpoints. The browser must not call Meta directly and must not store Meta tokens.

Required backend namespace:

```txt
/api/page-automation/status
/api/page-automation/pages
/api/page-automation/pages/:pageId/insights
/api/page-automation/posts
/api/page-automation/post-drafts
/api/page-automation/schedules
/api/page-automation/messages
/api/page-automation/comments
/api/page-automation/analytics
/api/page-automation/ads-insights
/api/page-automation/ai/page-analysis
```

The server module should sit beside the existing Meta and OpenAI plugins, for example `server/pageAutomationPlugin.ts`, and should be wired into Vite dev middleware and production server.

Meta permissions are feature gates, not one global pass/fail. The backend must report granted/missing permissions per connected page and platform so the frontend can degrade individual features. See "Appendix A: Meta Permissions Matrix" for the v1 permission contract.

## Ads AI Insight Bridge

Page Automation should use the Ads analysis that already exists, but only through a normalized read-only contract. Sources include:

- `GET /api/meta/workspace?datePreset=...`
- `POST /api/ai/brain`
- `POST /api/ai/optimizer`
- `POST /api/ai/outcomes`
- server-side runtime knowledge under `knowledge-base/runtime`

Page Automation consumes a normalized object:

```ts
type SharedAdsInsightForPage = {
  source: {
    workspaceId?: string
    datePreset: string
    checkedAt: string
    taskId?: string
  }
  scope: {
    pageId?: string
    pageName?: string
    campaignIds: string[]
    adSetIds: string[]
    adIds: string[]
  }
  metrics: {
    spend: number
    revenue: number
    roas: number
    cpa: number
    ctr: number
    leads?: number
    bookings?: number
  }
  findings: Array<{
    title: string
    summary: string
    evidence: string[]
    risk: 'Low' | 'Medium' | 'High'
    confidence: number
  }>
  recommendations: Array<{
    id: string
    action: string
    expectedImpact: string
    guardrail: string
    requiresApproval: true
    risk: 'Low' | 'Medium' | 'High'
    confidence: number
  }>
  creativeSignals: Array<{
    adId: string
    campaignId: string
    creative: string
    score: number
    ctr: number
    roas: number
    bookings: number
  }>
  outcomeSignals: {
    alerts: unknown[]
    learnings: unknown[]
    nextActions: string[]
  }
  policy: {
    readOnly: true
    noMetaWrites: true
    noInventedMetrics: true
    approvalRequired: true
  }
}
```

The bridge resolves page-to-ads scope through explicit config first. Campaign/ad naming can be a fallback only when clearly marked as inferred.

Ads AI staleness policy:

- Ads AI insights older than 6 hours are stale for Auto decisions.
- Ads AI insights older than 24 hours are stale for dashboard claims.
- `Auto ON` must not schedule or publish from stale Ads AI insight.
- If only page data is fresh but Ads AI is stale, the UI can still show Page Analysis in read-only mode and can create drafts marked `Needs Review`.

## Auto Policy

Use one global Auto toggle in the Page Automation top bar.

`Auto OFF` means suggest-only:

- Ads AI can recommend posts, replies, schedules, content angles, and page analysis.
- Every action requires a human click.
- No automatic schedule, publish, reply, or write operation is allowed.

`Auto ON` means controlled automation:

- Low-risk items can be scheduled or posted automatically when they pass all guardrails.
- Risky items always move to `Needs Approval`.
- Missing permissions, stale data, failed Ads AI, high-risk language, PII, or unclear page mapping automatically downgrades the item to suggest-only.
- All automatic actions need audit log entries, source insight, rule reason, guardrail result, actor as `system`, and cancel/rollback state where Meta supports it.

Auto must never send customer replies directly without human approval in the first implementation. Reply suggestions are draft-only.

Low-risk eligibility matrix for `Auto ON`:

| Dimension | Low-risk, auto-eligible | Needs approval | Blocked until edited |
| --- | --- | --- | --- |
| Ads AI confidence | `>= 0.85` | `0.70` to `0.84` | `< 0.70` |
| Guardrail score | `>= 90` | `75` to `89` | `< 75` |
| Page mapping | Explicit configured page-to-campaign/ad scope | Inferred from naming | Missing or conflicting |
| Data freshness | Ads AI `<= 6h`, page sync `<= 1h`, permissions sync `<= 15m` | Any freshness warning | Stale required source |
| Content type | Educational, FAQ, service reminder, brand awareness, neutral engagement prompt | Soft promotion, reused winning ad angle, price mention | Medical/beauty outcome claim, guarantee, aggressive urgency, sensitive before/after claim |
| Customer data | No PII or customer-specific health detail | Redacted excerpt used for draft context | Unredacted PII or sensitive health detail |
| Asset state | Approved asset, correct aspect ratio, page-safe caption | Missing optional asset metadata | Missing required asset or rejected asset |

Only low-risk rows across every dimension are auto-eligible. Any `Needs approval` dimension moves the item to `Needs Approval`. Any `Blocked` dimension prevents scheduling/publishing until fixed.

## Core Screens

### Auto Post

Purpose: plan posts or ads by page, draft captions and creative briefs with AI, schedule/publish eligible items, and track failures.

Expected components:

- Page selector and saved page groups
- Content calendar with day/week/month views
- Content Pipeline with Draft, Ready, Scheduled, Posted, Needs Review, Failed
- AI draft composer for objective, audience, offer, tone, caption, hashtags, creative brief, CTA, and destination
- Creative preview for feed/story/reels/ad variants
- Guardrail panel for prohibited wording, offer validation, page-specific rules, and Ads AI risk
- Publish monitor with retry/cancel states

Ads AI should influence content angles, winning creative references, fatigued ad warnings, recommended posting windows, and compliance risk.

Platform publishing matrix for v1:

| Surface | v1 support | Auto ON support | Required permissions | Notes |
| --- | --- | --- | --- | --- |
| Facebook Page feed text/link/image post | Create draft, schedule, publish, monitor | Yes, low-risk only | `pages_read_engagement`, `pages_manage_posts` | Primary v1 publishing path. |
| Facebook Page video post | Create draft, publish after asset validation | Needs approval | `pages_read_engagement`, `pages_manage_posts` | Video upload failures must retry safely. |
| Facebook Page reels/stories | Draft and preview only | No | Not supported for v1 publishing | Not auto-published in v1. |
| Instagram feed image/carousel | Draft and schedule proposal | No by default | `instagram_basic`, `instagram_content_publish`, linked Page permissions | Publishing can be enabled later behind explicit feature flag after permissions pass. |
| Instagram reels | Draft and schedule proposal | No by default | `instagram_basic`, `instagram_content_publish`, linked Page permissions | Reels requirements vary by media type; v1 keeps this approval-only. |
| Instagram stories | Draft and preview only | No | Not supported for v1 publishing | Not auto-published in v1. |
| Ads creative/ad launch | Draft insight only | No | Ads writes stay in PMC Ads Agent | Page Automation must not create or mutate ads. |

### Page Analysis

Purpose: analyze all connected pages using Meta page insights plus Ads AI context.

Expected components:

- Page health matrix
- Cross-page KPI strip
- Engagement and reach trends
- Content performance leaderboard
- Best posting windows
- Ads-linked page insight cards
- Competitor-style benchmark area if data exists

Metrics must distinguish live, stale, sample, unavailable, and partial-permission data.

### Messages

Purpose: view and triage messages, comments, ad comments, mentions, and reviews from every connected page where Meta permissions allow.

Expected components:

- Channel/page filters
- Unified inbox queue
- Conversation detail drawer
- Sentiment, intent, priority, owner, SLA, and status controls
- AI summary and suggested reply panel
- Privacy flags and audit history

Ads AI should help prioritize messages tied to high-spend campaigns, weak response rates, high-risk offers, negative sentiment spikes, or strong lead intent.

Messages sync strategy for v1:

- Use polling, not webhooks, as the v1 decision.
- Active inbox view polls every 30 seconds.
- Background page message summary polls every 2 minutes.
- Page analytics and content performance refresh every 15 minutes.
- The UI must show last sync time and mark inbox data stale if no successful message poll has completed within 2 minutes while the Messages screen is open.
- Webhook endpoints may be scaffolded later, but they are not required for v1 behavior. If webhook ingestion is later added, it must verify Meta signatures before accepting events.

### Analytics Dashboard

Purpose: show joint Ads + Page + Inbox performance.

Expected components:

- Auto mode state and sync status
- Ads-linked page performance
- Post readiness and publishing success rate
- Inbox backlog and response time
- Page health and content trend
- Outcome alerts and next actions from Ads AI

Dashboard claims must be traceable to Meta data, Ads AI output, or page automation records.

## Persistent Storage

V1 uses a server-side persistent file store because the current repo has no database dependency. Store Page Automation state under:

```txt
knowledge-base/runtime/page-automation/
  pages.json
  post-drafts.jsonl
  schedules.jsonl
  publish-events.jsonl
  message-cache.jsonl
  audit-log.jsonl
  page-ads-mapping.json
```

Storage rules:

- Use append-only JSONL for audit, schedule, publish, and message events.
- Use atomic write for snapshot files such as `pages.json` and `page-ads-mapping.json`.
- Keep audit logs indefinitely unless the user adds a retention setting later.
- Retain message excerpts for 90 days by default.
- Retain published post and schedule records for 18 months.
- Never store Meta access tokens in this folder.
- If the file store is unavailable, Auto must turn OFF and the UI must show `Sync error` or `Storage unavailable`.

Production can later migrate this storage to Postgres or another database without changing the frontend contract.

## Data And State Rules

Every data-heavy panel needs a visible state:

- Setup required
- Connected and synced
- Loading
- No pages
- No data
- Partial permissions
- Stale data
- API rate limited
- Sync error
- AI unavailable
- Auto disabled
- Auto enabled
- Needs approval

No panel may silently replace missing Meta data with invented values. Sample data is allowed only when explicitly labeled as sample.

Freshness thresholds:

| Data source | Fresh for read-only UI | Fresh for Auto ON |
| --- | --- | --- |
| Meta page/profile and permissions | 24 hours | 15 minutes |
| Meta page insights | 24 hours | 1 hour |
| Messages/comments | 2 minutes in active Messages view, 15 minutes elsewhere | 2 minutes for inbox-driven prioritization |
| Ads AI bridge insight | 24 hours | 6 hours |
| Page-to-ads mapping | 30 days if explicit | 15 minutes if inferred, and inferred mapping is not auto-eligible |

## Safety And Privacy

- Store Meta tokens and OpenAI keys server-side only.
- Do not expose raw runtime JSONL or customer PII to the browser.
- Redact phone numbers, health details, and sensitive customer information before AI processing where possible.
- Webhook ingestion must verify signatures.
- Writes to Meta must go through backend guardrails and audit logging.
- Auto write actions must be disabled when sync state is stale, permissions are partial, or page mapping is inferred.
- AI replies remain draft-only until explicitly changed in a later approved design.

## Implementation Decomposition

Use separate agents/workstreams during implementation:

- App boundary and routing agent
- Meta API backend agent
- Ads AI Insight Bridge agent
- Auto Post UI and policy agent
- Page Analysis and Dashboard agent
- Unified Inbox agent
- QA and safety review agent

Each workstream should have an isolated file ownership boundary to avoid merging Page Automation back into the PMC Ads Agent code path.

## Implementation Validation Checks

- Confirm how page IDs map to campaigns/ad sets/ads in the current Meta workspace.
- Before enabling live Meta publish writes, run a backend permission check against the connected token and page. If the check fails, keep Auto Post in draft/schedule-simulation mode for that surface.

## Appendix A: Meta Permissions Matrix

Permission names are based on Meta's current permissions and product documentation as checked on 2026-05-21. Implementation must verify the current App Review surface again before requesting production access.

| Permission | Required for | Required or optional | Graceful degradation if missing |
| --- | --- | --- | --- |
| `pages_show_list` | List managed Pages and choose which Pages Page Automation can connect. | Required | Setup stops at `Partial permissions`; no page selection. |
| `pages_read_engagement` | Read Page profile, engagement, and support Page posting prerequisites. | Required | Page profile and Page insights panels disabled. |
| `pages_read_user_content` | Read Page posts and user-generated content for content performance analysis. | Required for content leaderboard | Hide content leaderboard; keep page profile if available. |
| `pages_manage_posts` | Create, schedule, publish, and manage Facebook Page posts. | Required for Facebook publishing | Auto Post becomes draft-only for Facebook. |
| `pages_manage_metadata` | Manage Page metadata, support Page messaging setup, and subscribe apps to Page events when webhook support is added. | Required for Page messaging installs; optional for publishing-only installs | Messenger/Webhook setup disabled; publishing-only surfaces can continue if their permissions pass. |
| `pages_manage_engagement` | Moderate or reply to comments as the Page where supported. | Optional for v1 | Comments become read-only; reply/moderation controls hidden. |
| `pages_messaging` | Facebook Page Messenger inbox access and reply capability. | Required for Facebook message inbox | Facebook messages hidden; show missing permission state. |
| `instagram_basic` | Identify linked Instagram professional accounts and read basic profile/media context. | Required for Instagram features | Instagram pages and media hidden. |
| `instagram_manage_insights` | Read Instagram account and media insights. | Required for Instagram analytics | Instagram analytics disabled; Facebook analytics remains. |
| `instagram_content_publish` | Publish Instagram media where API supports it. | Optional in v1 | Instagram remains draft/schedule-proposal only. |
| `instagram_manage_comments` | Read/manage Instagram comments. | Optional in v1 | Instagram comments hidden or read-only depending on granted access. |
| `instagram_manage_messages` | Read and manage Instagram DMs. | Required for Instagram DM inbox | Instagram DMs hidden; Facebook inbox can remain. |
| `ads_read` | Read ads account, campaigns, ad sets, ads, and insights for Ads AI bridge. | Required for Ads-linked insight | Page Automation works without Ads context; Ads AI bridge panels show unavailable. |
| `business_management` | Manage or read Business assets where Business Manager access is needed. | Optional unless required by the connected Business setup | Business-scoped asset mapping disabled; direct Page access can still work if available. |
| `leads_retrieval` | Read lead forms if later added. | Out of v1 scope | Lead-form widgets hidden. |

## Appendix B: Meta Documentation References

- Meta Permissions Reference: https://developers.facebook.com/docs/permissions/
- Facebook Pages API posts: https://developers.facebook.com/docs/pages-api/posts/
- Messenger webhook message events: https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages/
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Meta Marketing API access and ads insights references: https://developers.facebook.com/docs/marketing-api/

## Approval Gate

Implementation should not begin until this design is reviewed and approved. After approval, create a separate implementation plan and then dispatch agents by workstream.
