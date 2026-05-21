# PMC Home Command Center Design

## Status

Approved direction: simplified **Home** command center, based on the latest easy-read visual reference.

Reference image family:

- `/Users/natthaphon/.codex/generated_images/019e473c-4edf-72f2-b19d-d3ad37116407/ig_005668e951e5127f016a0e83cf0e8c8191a42fd8f73c3d30db.png`
- The reference is a direction guide, not a strict pixel-perfect final. Preserve the simple hierarchy, calm spacing, and three-section structure.

## Product Boundary

`/` becomes the main **Home** surface for PMC. It is not the Ads Agent itself.

Routes:

- `/` -> Home
- `/ads-agent` -> existing PMC Ads Agent application
- `/page-automation` -> existing Page Automation application
- Future routes may include `/reports`, `/knowledge`, `/erp`, `/crm`, and `/website-insight`, but Home v1 may show those as connected, coming soon, or unavailable depending on current implementation.

## Design Goal

Home is an organization entry point that answers three questions quickly:

1. What should I look at now?
2. Which tool should I open?
3. Are the core systems connected?

The screen must feel like internal enterprise software: clear, quiet, useful, and AI-assisted. It must not become a dense analytics dashboard or marketing landing page.

## Primary Layout

Use a simple app shell:

- Left sidebar with PMC mark, `Home` selected, and low-noise navigation for Tools, Reports, Knowledge, Settings, Alerts, Tasks, Approvals, and Audit Log.
- Main header with title `Home` and one short Thai subtitle.
- Header status chips: `Meta API`, `AI API`, and `Knowledge`.
- Main content split into three major sections only:
  - `AI Priorities`
  - `Tools`
  - `System Status`

Optional `Recent` activity is allowed only as a small secondary block. It must not compete with the three main sections.

## Section Details

### AI Priorities

This is the primary first-viewport panel.

Rules:

- Show exactly three priority rows in v1.
- Each row includes:
  - sequence number
  - source icon/system name
  - short action title
  - short source label, such as `แหล่งข้อมูล: Ads Agent`
  - risk label
  - confidence
  - one human action button, such as `Review` or `Open`
- AI suggests. Humans approve risky actions. Do not use copy that implies unsafe automatic execution from Home.
- If no real priorities exist, show an empty state with a clear action to open the relevant tool.

Priority sources in v1:

- Ads Agent recommendations from existing workspace data/actions
- Page Automation status such as unread messages or ready drafts
- CRM/ERP/Website/RAG setup-state priorities only when the system has real status; otherwise show unavailable or setup-needed state rather than invented counts

### Tools

The Tools panel is a launcher, not a dashboard.

Primary visible tool tiles:

- Ads Agent
- Page Automation
- ERP
- CRM
- Website Insight
- Knowledge

Each tile includes:

- icon
- title
- one-line status
- arrow/open affordance

Secondary destinations may remain in sidebar or future "All tools" view:

- Reports
- Settings / Connectors
- Audit Log
- Approvals

### System Status

Keep this slim and readable.

Visible statuses:

- Meta API
- AI API
- RAG / Knowledge
- Website
- ERP
- CRM

Status values:

- `เชื่อมต่อ`
- `พร้อมใช้งาน`
- `รอตั้งค่า`
- `ไม่พร้อมใช้งาน`
- `กำลังโหลด`

Home must never invent a connected state. If an endpoint is missing or fails, show setup/unavailable.

## Data Sources

Use existing APIs where available:

- Meta API status: `GET /api/meta/status`
- Meta workspace summary: `GET /api/meta/workspace?datePreset=...`
- AI API status: `GET /api/ai/status`
- Page Automation status: `GET /api/page-automation/status`
- Page Automation messages: `GET /api/page-automation/messages`
- Page Automation drafts: `GET /api/page-automation/post-drafts`

RAG / Knowledge:

- Home v1 shows readiness/status only.
- Detailed RAG search, retrieval, memory writing, and knowledge workflows are out of scope for this spec and will get a separate design.

ERP, CRM, Website Insight:

- Home v1 supports them as first-class modules in the interface.
- If no data connector/API exists yet, render a setup-needed state.
- Do not fake operational metrics.

## Interaction Rules

- Clicking `Ads Agent` opens `/ads-agent`.
- Clicking `Page Automation` opens `/page-automation`.
- Clicking future modules may open disabled/setup states until their routes exist.
- Clicking a priority opens the owning tool or a review route when available.
- Home must not send Meta write actions directly.
- High-risk actions stay review-only and must route to the owning tool's approval flow.

## Visual System

Preserve the approved simplified direction:

- White and pale cool-gray surfaces
- Graphite text
- Teal/green primary accent
- Amber/red only for status and risk
- Mostly 8px radius or less
- Subtle borders, low shadows
- Generous whitespace
- Large readable Thai labels
- No decorative blobs, no mascot, no 3D hero art, no purple-dominant palette, no beige/cream theme

The interface should look like a professional enterprise app, not a promotional page.

## Implementation Notes

Avoid growing `src/App.tsx` further if practical. Prefer extracting Home into focused files such as:

- `src/apps/home/HomeApp.tsx`
- `src/apps/home/api.ts`
- `src/apps/home/types.ts`
- `src/apps/home/styles.css`

Routing changes should preserve the existing Page Automation route and move the existing PMC Ads Agent app behind `/ads-agent`.

## Testing

Add tests for:

- `/` renders `Home`, not the Ads Agent shell.
- `/ads-agent` renders the existing PMC Ads Agent app.
- `/page-automation` still renders Page Automation.
- Home tool tiles include Ads Agent, Page Automation, ERP, CRM, Website Insight, and Knowledge.
- Home status rendering does not invent connected API states when API calls fail.

Manual/browser QA:

- Desktop viewport first.
- Current in-app browser viewport.
- One mobile-width viewport.
- Verify no text overlap, no dense dashboard feel, and buttons route to the right tools.

## Open Questions Deferred

- Detailed RAG / Knowledge workflow.
- ERP and CRM connector schema.
- Website Insight data source and tracking model.
- Reports route implementation.

These are intentionally deferred so Home can ship as a clean, stable platform hub first.

## Self-Review

- No incomplete markers remain.
- Routing boundary is explicit.
- RAG, ERP, CRM, and Website Insight are represented without fake data.
- Home v1 is scoped to navigation, priorities, and status, not full subsystem implementation.
