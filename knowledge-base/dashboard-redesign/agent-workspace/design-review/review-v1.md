---
owner_agent: design-review
status: ready_for_review
intended_readers:
  - orchestrator
  - figma-mockup
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/figma-mockup-v1-spec.md
  - knowledge-base/dashboard-redesign/design-review-checklist.md
  - knowledge-base/dashboard-redesign/dashboard-brief.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/visual-reference-handoff.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/product-context-handoff.md
handoff_to:
  - orchestrator
  - figma-mockup
updated_at: 2026-05-18T00:00:00+07:00
summary: Cycle 1 design review for PMC Ads Agent dashboard Figma mockup v1.
decision: Needs Revision
---

# Design Review v1

## Decision

Needs Revision.

The mockup direction is strong and mostly aligned with the clinic ads cockpit brief: the first viewport includes ad spend, revenue, ROAS, CPA, leads, bookings, show-up, close rate, clinic funnel, Meta freshness, and a guarded AI recommendation queue. However, the spec is not ready for implementation handoff because several required states and safety details are missing or ambiguous.

## Findings

### P1 - Required action states are incomplete

Source: `figma-mockup-v1-spec.md`, `visual-reference-handoff.md`, `product-context-handoff.md`

The mockup lists `Suggested`, `Approved`, `Executing`, `Failed`, and `Audited`, but the visual reference pass criteria require distinct `suggested`, `approved`, `executing`, `executed`, `failed`, and `rejected` actions. The product context also requires audited action history. Without `executed` and `rejected`, implementation cannot distinguish a completed Meta write action from an approved or audited action, and users may not know whether a recommendation was declined or already applied.

Required revision:
- Add explicit `Executed` and `Rejected` states to the action legend and relevant examples.
- Keep `Audited` as a history marker, not a replacement for completion state.
- Show how failed actions recover or retry.

### P1 - Destructive action safety needs a stronger confirmation pattern

Source: `figma-mockup-v1-spec.md`, `dashboard-brief.md`

The primary AI card includes `Approve pause` and `Reject`, with guardrail and rollback copy. That is directionally correct, but a pause action is a high-risk Meta write action. The current spec does not state whether `Approve pause` opens a confirmation step, shows the exact ad set ID/name, records who approved it, or previews the execution scope before the action starts.

Required revision:
- Make the high-risk approval flow visibly two-step: approve intent, then confirm exact write action.
- Include scope details: campaign/ad set name, affected budget/delivery, and expected rollback path.
- Add audit metadata: approver, timestamp, execution result, and linked recommendation.

### P2 - Status color semantics risk becoming overloaded

Source: `figma-mockup-v1-spec.md`, `visual-reference-handoff.md`

The local visual rules say status colors are only for healthy, watch, and critical. The table examples include active, watch, winner, fatigue, and pause risk. If `winner`, `active`, and `healthy` all use green or if `pause risk`, `fatigue`, and `critical` all use red without clear labels, operators may read campaign state, risk level, and AI action state as the same concept.

Required revision:
- Define one status taxonomy for performance/risk: healthy, watch, critical.
- Treat labels such as winner, fatigue, and pause risk as secondary diagnostic tags unless they map directly to that taxonomy.
- Do not use color alone; pair each status with text and/or icon.

### P2 - Empty, loading, error, disconnected, and setup states are missing

Source: `design-review-checklist.md`, `product-context-handoff.md`

The checklist requires empty, loading, error, and disconnected states that explain the next action. Product context also requires setup required and no data. The v1 spec describes only the populated happy path. This is an implementation risk because Meta sync, local settings, and clinic funnel data availability are central trust surfaces.

Required revision:
- Add a notes section or companion frame for setup required, disconnected Meta account, stale sync, no clinic funnel data, loading, and sync error.
- For each state, specify the visible user action and whether AI recommendations are disabled, degraded, or still allowed.

### P2 - Responsive behavior is not specified

Source: `design-review-checklist.md`, `visual-reference-handoff.md`

The root frame is 1440x1000 with a 248px sidebar and right rail. This is appropriate for desktop operations, but the checklist asks for text fit and non-overlap on desktop and mobile. The current spec does not define how the KPI row, right rail, table columns, and funnel behave below desktop widths.

Required revision:
- Define tablet and mobile behavior, even if mobile is read-only or unsupported.
- Specify whether the right rail collapses into a drawer, tab, or below-content queue.
- Specify table column priority, horizontal scroll, or compact row behavior.

### P3 - Accessibility and contrast need verification

Source: `figma-mockup-v1-spec.md`, `design-review-checklist.md`

The spec gives borders and accent colors but does not include text colors, badge colors, button states, or contrast checks. `#E1E7F0` is acceptable as a subtle border, but it should not carry important state meaning. The violet/blue accents may be fine, but the review cannot verify contrast from the textual spec alone.

Required revision:
- Add minimum contrast targets for text, badges, controls, and disabled states.
- Ensure watch/critical/healthy colors pass contrast when used in badges.
- Include focus states for keyboard navigation on controls, especially approve/reject/export/date range.

## What Works

- The information hierarchy matches the brief: account/date/sync/mode at the top, core ads and clinic outcome KPIs in the first viewport, funnel and campaign performance in the main column, and AI recommendations in the right rail.
- AI recommendation cards include evidence, confidence, risk, guardrail, before/after estimate, rollback note, and approval controls.
- The visual direction is appropriate for a daily clinic media-buying cockpit and avoids a marketing-page treatment.
- The spec avoids unverified full-automation or revenue-guarantee claims.

## Implementation Notes

- Keep `Suggest only` highly visible in both top bar and sidebar until a user changes automation mode.
- Keep Meta sync freshness near data-heavy panels, not only in global chrome, if stale data changes recommendation validity.
- Add source labels for clinic revenue/bookings/show-up/close-rate if those fields are not directly from Meta.

## Review Basis

This review is based on the written Figma mockup v1 spec and handoff documents. The Figma canvas itself was not reworked or screenshot-verified because the spec notes Figma MCP edits and screenshot capture are blocked by the Figma Starter plan tool-call limit.
