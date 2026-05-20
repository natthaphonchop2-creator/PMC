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

Exact Meta permissions must be verified during implementation. Expected permission areas include page list/profile, page insights, publishing/scheduling, comments, messages, Instagram messaging, and ads insights. If a permission is missing, the UI must show a partial-permissions state rather than inventing data.

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

## Open Implementation Checks

- Verify exact Meta Graph API and Marketing API permissions for page publishing, scheduled posts, comments, messaging, Instagram messaging, and page insights.
- Confirm how page IDs map to campaigns/ad sets/ads in the current Meta workspace.
- Decide where persistent Page Automation state lives beyond local mock data.
- Define webhook strategy for messages/comments if real-time inbox is required.
- Confirm whether first implementation can perform Meta publish writes or should start with read + scheduled draft simulation until permissions are verified.

## Approval Gate

Implementation should not begin until this design is reviewed and approved. After approval, create a separate implementation plan and then dispatch agents by workstream.
