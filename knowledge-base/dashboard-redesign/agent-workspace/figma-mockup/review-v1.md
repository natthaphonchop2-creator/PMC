---
owner_agent: figma-mockup
status: complete
decision: Needs Revision
intended_readers:
  - orchestrator
  - design-review
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/figma-mockup-v1-spec.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/product-context-handoff.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/visual-reference-handoff.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
  - knowledge-base/dashboard-redesign/agent-workspace/figma-mockup/shared-inbox.md
  - src/App.tsx
  - src/types.ts
  - src/App.css
handoff_to:
  - orchestrator
  - design-review
  - knowledge-curator
updated_at: 2026-05-18T00:00:00+07:00
summary: Cycle 1 Figma mockup feasibility review covering layer structure, dashboard states, Thai/English fit, reuse, and React/CSS implementation fit.
---

# Figma Mockup Review v1

## Decision

Needs Revision.

The v1 mockup direction is aligned with the clinic ads cockpit brief and appears implementable with the existing React/CSS architecture. However, it is not yet complete enough for engineering handoff because required dashboard states and reusable component/variant structure are under-specified.

## What Passes

- The primary desktop IA matches the orchestrator and visual-reference handoffs: left work-mode navigation, top command bar, KPI row, clinic funnel, campaign/ad set table, and right AI Marketer rail.
- The first viewport includes the required core business and ads metrics: spend, revenue, ROAS, CPA/booking, leads, bookings, show-up rate, and close rate.
- The AI recommendation card includes the important safety information: evidence, confidence, risk, guardrail, approval controls, before/after estimate, and rollback note.
- The design is feasible in the current codebase. Existing patterns already include a fixed sidebar grid shell, topbar actions, panels, metric cards, status badges, Recharts charts, campaign tables, approval modal flows, audit data, and action statuses.
- The visual rules are compatible with the current CSS direction: light operational UI, thin borders, 8px-ish panel radius, compact tables, restrained violet/blue accents, and semantic status colors.

## Revision Blockers

1. Required state coverage is incomplete.

The product handoff requires setup required, no data, synced/live data, pending approval, executing, failed, and audited action history. The visual handoff also asks for suggested, approved, executing, executed, failed, and rejected actions to be distinct. The v1 spec only lists suggested, approved, executing, failed, and audited. It does not explicitly define setup required, no data, executed, or rejected states.

Required revision: add state frames or clearly named component variants for:

- `State / Setup Required`
- `State / No Data`
- `State / Live Synced`
- `Action State / Suggested`
- `Action State / Pending Approval`
- `Action State / Approved`
- `Action State / Executing`
- `Action State / Executed`
- `Action State / Failed`
- `Action State / Rejected`
- `Action State / Audited History`

2. Component structure is not specific enough for implementation handoff.

The spec names major frames, but not reusable component boundaries or variants. Engineering needs to know whether KPI cards, status badges, table rows, funnel stages, command controls, and AI recommendation cards are repeated components or one-off layers.

Required revision: add a concise component inventory with names such as:

- `Component / KPI Card`
- `Component / Status Badge`
- `Component / Command Bar Control`
- `Component / Funnel Stage`
- `Component / Campaign Table Row`
- `Component / AI Recommendation Card`
- `Component / Approval Action Buttons`
- `Component / Empty State Panel`
- `Component / Data Freshness Badge`

3. Thai/English text fit rules are implied but not proven.

Using IBM Plex Sans Thai helps, but the spec should define text behavior for mixed Thai/English labels and long campaign/ad set names. Risk areas include the 8-card KPI row, `CPA / Booking`, `Show-up Rate`, `Close Rate`, clinic selector text, table campaign names, and right-rail evidence/guardrail copy. The current app contains long Thai helper copy and campaign strings, so truncation and wrapping behavior must be explicit.

Required revision: document max lines, truncation, tooltip behavior, and responsive wrapping for:

- KPI labels and values.
- Clinic selector and account name.
- Campaign/ad set names in the table.
- AI recommendation title, evidence, guardrail, rollback note, and button labels.
- Thai equivalents or mixed-language final copy where the UI is expected to localize.

4. Existing React/CSS mapping should be documented.

The design can be implemented with the current app patterns, but the handoff should say so explicitly. Existing code already has `app-shell`, `sidebar`, `topbar`, `panel`, `metric-card`, badges, action labels, modal approval flows, and Recharts. Without a mapping, implementation may recreate redundant structures instead of adapting existing components.

Required revision: add an engineering mapping note from Figma modules to current implementation surfaces:

- Sidebar -> existing sidebar/tool navigation.
- Top command bar -> existing topbar and date/sync controls.
- KPI cards -> existing metric card/mini metric patterns.
- Trend chart -> existing Recharts chart usage.
- Campaign table -> existing campaign/ad set table patterns.
- AI Marketer queue -> existing recommendation/action queue and approval modal patterns.
- Audit/history -> existing reports/audit trail model.

## Non-Blocking Notes

- The right rail recommendation content is strong and fits the guardrail-first product requirement.
- `Action state legend` should avoid substituting `Audited` for an execution state. Audited history is a record state, while executed/rejected/failed are action outcome states.
- If Figma MCP access is still blocked, the revision can be recorded as a spec update plus component/state checklist first, then applied to the canvas when tool access returns.

## Recheck Criteria

This review can move to OK after the v1 spec or Figma file includes:

- Complete dashboard and action state coverage.
- A reusable component inventory with variants.
- Explicit Thai/English fit rules for dense cards, table rows, controls, and right-rail copy.
- A short implementation mapping to existing React/CSS patterns.
