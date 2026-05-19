---
owner_agent: figma-mockup
status: complete
decision: OK
intended_readers:
  - orchestrator
  - design-review
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
handoff_to:
  - orchestrator
  - design-review
  - knowledge-curator
updated_at: 2026-05-18T00:00:00+07:00
summary: Targeted mascot recheck for placement, component naming, implementation feasibility, and deferred Figma canvas sync documentation.
---

# Mascot Review

## Decision

OK.

The mascot addition is ready as a documented implementation handoff. The Figma canvas is not yet synchronized because of the Figma Starter plan MCP tool-call limit, but that deferral is documented clearly enough in `mascot.md`, `figma-mockup-v2-spec.md`, and `orchestrator/review-status.md`.

## Scope Recheck

1. Mascot placement: OK.

`mascot.md` and the v2 spec constrain the mascot to secondary/help surfaces: setup required, no-data, AI queue footer, help center, and onboarding-style guidance. They also explicitly prohibit placement in KPI cards, campaign/ad set rows, charts, and destructive Meta write confirmation controls. This prevents the mascot from weakening data density, audit clarity, or high-risk approval flows.

2. Component naming: OK.

The v2 spec adds `Component / Mascot Accent` with variants for `default`, `setup`, `no data`, `ai queue footer`, and `help`. The naming matches the existing component inventory pattern and is implementation-friendly for a reusable decorative asset.

3. Implementation feasibility: OK.

The asset path is specified as `knowledge-base/dashboard-redesign/assets/pmc-mascot.png`, with recommended rendered sizes of 48-96px in dense panels and up to 140px in setup/no-data states. The accessibility rule is also feasible: treat the mascot as decorative unless surrounding copy explicitly references it, and never rely on it as the only indicator of AI activity, state, risk, or approval.

4. Deferred Figma canvas sync: OK.

The MCP limitation is documented as a deferred canvas sync in all reviewed files:

- `mascot.md` records the failed attempt to add `V2 Companion / Mascot Accent Rules`.
- `figma-mockup-v2-spec.md` already establishes the v2 document as canonical while canvas updates are blocked.
- `orchestrator/review-status.md` records R8 for the mascot canvas sync attempt and the Starter plan tool-call limit.

## Follow-Up

When Figma MCP quota or access is available, add the mascot rules and placements to the Figma canvas using the existing `Component / Mascot Accent` naming and the placement constraints above. This is a deferred canvas synchronization task, not a blocker for the mascot handoff.
