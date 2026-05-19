---
title: Figma Mockup v2 Spec
description: Revised design handoff that closes Cycle 1 review blockers for the PMC Ads Agent dashboard redesign.
status: ready_for_recheck
owner: Main Codex Agent
last_updated: 2026-05-18
figma_file: https://www.figma.com/design/e51pdNi0vcWlvyOalOrt0O
supersedes: knowledge-base/dashboard-redesign/figma-mockup-v1-spec.md
root_frame_id: "2:2"
notes_frame_id: "2:290"
revision_id: R3
---

# Figma Mockup v2 Spec

Figma file: https://www.figma.com/design/e51pdNi0vcWlvyOalOrt0O

This v2 spec supersedes `figma-mockup-v1-spec.md` for review and implementation handoff. The Figma v1 canvas was created successfully, but direct screenshot verification and further canvas edits are temporarily blocked by the Figma Starter plan MCP tool-call limit. Reviewers should treat this v2 document as the canonical patch list and only block if the unresolved canvas update is unacceptable for their review area.

## Revision Summary

Cycle 1 reviewers requested these fixes:

- Add missing required metrics.
- Add setup, no-data, loading, error, disconnected, executed, rejected, and visible audit-history states.
- Remove or qualify unverified workflow claims.
- Define reusable component boundaries and variants.
- Define Thai/English text-fit rules.
- Strengthen destructive Meta write-action confirmation.
- Define status taxonomy, responsive behavior, accessibility targets, and engineering mapping.
- Synchronize review evidence and approval trail.

## Data Disclosure

All numeric values in the mockup are sample values for layout validation unless the implementation connects them to live workspace data. The UI should label the page as one of these states:

- `Sample data`: values are illustrative.
- `Live synced`: values came from the connected workspace.
- `Stale sync`: last sync is outside the accepted freshness window.
- `No data`: connected, but no usable records for the selected date range.

## Required Metric Coverage

### First-Viewport KPI Cards

Keep the eight first-viewport KPI cards:

- Ad Spend
- Revenue
- ROAS
- CPA / Booking
- Leads
- Bookings
- Show-up Rate
- Close Rate

### Secondary Metric Strip

Add a compact `Component / Secondary Metric Strip` below the KPI cards or above the campaign table with these fields:

- CTR
- CPC
- CPM
- CPL
- CAC
- AOV
- Sales Velocity
- Conversion Value
- Lead Quality Score
- Auto Actions
- Alerts

Recommended layout:

- Two rows of six compact cells on desktop.
- Collapse into horizontally scrollable chips below 1024px.
- Each cell includes label, value, trend, and source hint.

### Table Additions

Campaign/ad set table should expose or make filterable:

- CTR
- CPC
- CPM
- CPL
- Lead Quality
- Alerts

If there is not enough width, use column priority:

1. Campaign / Ad Set
2. Status
3. Spend
4. CPA
5. ROAS
6. AI Risk
7. CTR
8. Frequency
9. CPC / CPM / CPL in expanded row

## Required State Coverage

### Dashboard Data States

Add companion states, either as small frames beside the desktop mockup or as named component variants:

| State | Visible Message | Primary User Action | AI Recommendation Behavior |
| --- | --- | --- | --- |
| `State / Setup Required` | Connect Meta account and configure workspace before syncing ads data. | Open Settings | Disabled except setup guidance |
| `State / Disconnected` | Meta connection is not available. Last successful sync is shown if present. | Reconnect / Check API | Disabled or marked stale |
| `State / Loading` | Syncing workspace data. | Wait / Cancel if supported | Shows previous recommendations as stale |
| `State / No Data` | No campaigns or clinic funnel records for this date range. | Change date range / Check account | Disabled for performance actions |
| `State / Sync Error` | Sync failed with reason and retry timestamp. | Retry sync / Open Settings | Disabled for write actions |
| `State / Stale Sync` | Data is older than the freshness threshold. | Sync now | Recommendations require recheck |
| `State / Live Synced` | Synced successfully with timestamp and account. | Continue | Enabled under current automation mode |

### AI Action States

Add named variants for `Component / AI Recommendation Card`:

- `Action State / Suggested`
- `Action State / Pending Approval`
- `Action State / Approved`
- `Action State / Confirming`
- `Action State / Executing`
- `Action State / Executed`
- `Action State / Failed`
- `Action State / Rejected`
- `Action State / Audited History`

`Audited History` is a record state, not a substitute for `Executed` or `Rejected`.

### Visible Audit Trail

Add a visible `Panel / Recent Audit Trail` near the right rail footer or Reports preview with rows:

- `Approved pause` by user, timestamp, linked recommendation.
- `Execution succeeded` or `Execution failed`, Meta object scope, result.
- `Rejected recommendation`, reason optional.
- `Rollback available` or `Rollback completed`.

## AI / Meta Write Safety

High-risk actions such as pausing an ad set or reducing budget must use a two-step flow:

1. `Approve intent`: user accepts the recommendation for review.
2. `Confirm Meta write`: modal or drawer shows exact scope before execution.

Confirmation details:

- Campaign/ad set/ad name and Meta object type.
- Object ID when available.
- Current budget/delivery state.
- Proposed change.
- Expected impact.
- Guardrail.
- Rollback path.
- Approver and timestamp.
- Execution result after the API call.

Button labels:

- Primary intent button: `Review pause`
- Confirmation button: `Confirm pause in Meta`
- Secondary buttons: `Reject`, `Cancel`, `Rollback`

Do not use a single-click `Approve pause` for destructive/write actions in implementation.

## Claim Cleanup

Replace unverified copy:

- Replace `Review LINE response SLA` with `Review booking quality bottleneck`.
- Evidence should reference verified dashboard concepts: lead-to-booking, show-up rate, close rate, paid treatments, campaign/ad set source.
- Replace topbar `Export report` with `Reports` or `Prepare report` unless export behavior is confirmed in implementation.

Allowed copy:

- `Meta synced`
- `Suggest only`
- `Pending approval`
- `Rollback available`
- `Sample values`

Avoid copy:

- `Autopilot`
- `Guaranteed uplift`
- `Full CRM sync`
- `LINE SLA` unless later verified.

## Component Inventory

Use these implementation-friendly boundaries:

| Component | Variants / States | Notes |
| --- | --- | --- |
| `Component / Sidebar Nav Item` | default, active, disabled | Supports grouped work modes. |
| `Component / Command Bar Control` | clinic selector, date range, sync state, automation mode, report action | Text must truncate safely. |
| `Component / Data Freshness Badge` | live, stale, disconnected, sample | Use near topbar and data-heavy panels. |
| `Component / KPI Card` | healthy, watch, critical, neutral, sample | Label max 2 lines; value max 1 line. |
| `Component / Secondary Metric Cell` | neutral, positive, watch, critical | For CTR/CPC/CPM/CPL/CAC/AOV/etc. |
| `Component / Funnel Stage` | normal, drop-off, selected | Includes count, rate, and source hint. |
| `Component / Campaign Table Row` | healthy, watch, critical, selected, expanded | Expanded row exposes lower-priority metrics. |
| `Component / Status Badge` | healthy, watch, critical, info, pending, executed, failed, rejected | Color plus text, never color alone. |
| `Component / AI Recommendation Card` | suggested, pending approval, approved, confirming, executing, executed, failed, rejected, audited | Includes evidence, confidence, risk, guardrail, rollback. |
| `Component / Approval Action Buttons` | review, confirm, cancel, reject, rollback, disabled | Destructive confirmation must be explicit. |
| `Component / Empty State Panel` | setup required, no data, disconnected, sync error | Includes next action. |
| `Component / Mascot Accent` | default, setup, no data, ai queue footer, help | Decorative only; never substitutes for state text or approval controls. |
| `Panel / Recent Audit Trail` | success, failed, rejected, rollback | Links actions to recommendation and Meta object. |

## Mascot Accent

Use `public/pmc-ai-mascot.png` as a small dashboard accent, not as a hero graphic.

Use `public/promedclinicpmc-logo.png` as the product/clinic brand mark in the sidebar/header and asset reference section.

Placement:

- Setup required and no-data companion states.
- AI queue footer as a subtle assistant presence.
- Help Center or onboarding note where users need next-step guidance.

Constraints:

- Render at 48-96px in dense panels and up to 140px in setup/no-data states.
- Keep away from KPI cards, campaign rows, charts, and destructive Meta write confirmation controls.
- Never use the mascot to imply autonomous execution. State copy and badges must still show `Suggest only`, `Pending approval`, `Setup required`, or the relevant action state.
- Treat as decorative for accessibility unless the surrounding copy explicitly references it.

Logo constraints:

- Keep logo usage limited to brand identity surfaces.
- Do not use the logo as a repeated panel decoration or watermark.
- Do not let logo or mascot compete with KPI cards, campaign tables, charts, or approval controls.

## Status Taxonomy

Use one performance/risk taxonomy:

- `Healthy`: performance is within acceptable zone.
- `Watch`: needs monitoring or investigation.
- `Critical`: requires action or approval review.

Use diagnostic tags separately:

- `Winner`
- `Fatigue`
- `Pause candidate`
- `Budget protection`
- `Creative refresh`

Do not rely on color alone. Every status must include visible text and, where implemented, an icon or shape.

## Thai / English Text-Fit Rules

Use IBM Plex Sans Thai or another Thai-compatible sans stack.

Rules:

- KPI label: max 2 lines, 11-12px, no negative letter spacing.
- KPI value: max 1 line; abbreviate with `k`, `M`, `%`, `x`, or Thai baht shorthand.
- Clinic/account selector: max 1 line, middle truncate after 22-28 characters, full value in tooltip.
- Campaign/ad set names: max 1 line in compact rows, 2 lines in expanded row, full name in tooltip.
- AI recommendation title: max 2 lines.
- Evidence/guardrail/rollback text: max 3 lines per block; use disclosure if longer.
- Buttons: use short command labels; destructive final button may wrap to 2 lines only in confirmation modal.
- Thai/English mixed labels should avoid fixed English-only widths. Controls need min-width and max-width rules.

## Responsive Behavior

Desktop `>= 1280px`:

- Fixed sidebar.
- Top command bar.
- KPI grid 4 columns x 2 rows.
- Main column plus right AI rail.

Tablet `768-1279px`:

- Sidebar collapses to icon rail or drawer.
- KPI grid becomes 2 columns.
- Right AI rail becomes a tab or drawer named `AI Queue`.
- Campaign table keeps priority columns and moves secondary metrics into expanded rows.

Mobile `< 768px`:

- Use single-column read/review mode.
- KPI cards stack in 2-column compact grid where possible, otherwise one column.
- Table becomes grouped campaign cards.
- Destructive Meta write confirmation remains modal/drawer and cannot be hidden below scroll.

## Accessibility Targets

- Body text contrast: at least 4.5:1.
- Small badge/control text: at least 4.5:1, or increase font/weight.
- Large numbers/headings: at least 3:1 minimum, target 4.5:1.
- Focus states: visible 3px outline or equivalent for date, report, sync, approve, reject, confirm, rollback controls.
- Status colors must not carry meaning without text.
- Disabled AI/write actions must explain why they are disabled.
- `#E1E7F0` is border only, not primary semantic signal.

## Engineering Mapping

Implement with existing patterns before adding new abstractions:

- Sidebar -> current `app-shell`, `sidebar`, grouped `toolSections`.
- Top command bar -> current `topbar`, date/sync/settings controls.
- KPI cards -> current `metric-card` and metric help pattern.
- Funnel -> current clinic funnel/funnel stage patterns.
- Trend chart -> existing Recharts usage.
- Campaign table -> current campaign/ad set/ad list and detail panels.
- AI queue -> current recommendation/action queue, approval request, and mutation modal flow.
- Audit trail -> current Reports/audit trail model.
- Data states -> current settings/meta connection, empty workspace, sync error, and loading states.

## Review Constraints

The Figma canvas should be updated to match this v2 spec when MCP access is available again. Until then, Cycle 2 review can approve the design handoff if:

- The v2 spec closes the blockers.
- Remaining canvas work is recorded as a deferred implementation task.
- No reviewer requires visual screenshot verification before approval.

## Canvas Update Attempt

After writing this v2 spec, the main Codex agent attempted to add a Figma companion frame named `V2 Companion / Required Metrics States Safety` containing the missing metrics, states, component/action coverage, and safety notes. The Figma MCP call was rejected by the Starter plan tool-call limit, so the Figma canvas remains at v1 until quota/access is available again.

The user later provided production mascot and logo assets in `public/`. Future Figma canvas sync should use those public assets, not the exploratory generated mascot.
