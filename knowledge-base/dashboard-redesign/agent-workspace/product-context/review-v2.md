---
owner_agent: product-context
status: complete
decision: OK
review_cycle: v2
intended_readers:
  - orchestrator
  - figma-mockup
  - design-review
source_files:
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
  - knowledge-base/dashboard-redesign/agent-workspace/product-context/review-v1.md
handoff_to:
  - orchestrator
updated_at: 2026-05-18T16:25:00+07:00
summary: Cycle 2 product-context recheck of v1 blockers against the v2 Figma mockup spec and documented Figma MCP plan-limit constraint.
---

# Product Context Review v2

## Decision

OK.

This approval applies to `figma-mockup-v2-spec.md` as the canonical Cycle 2 design handoff. The Figma canvas is still blocked from direct v2 updates by the documented Figma Starter plan MCP tool-call limit, but that constraint is recorded in both the v2 spec and orchestrator review status. For product-context scope, the remaining canvas update is not blocking as long as implementation and future canvas edits follow the v2 spec.

## V1 Blocker Recheck

### 1. Missing Required Metrics

Closed.

The v2 spec adds a `Secondary Metric Strip` covering CTR, CPC, CPM, CPL, CAC, AOV, Sales Velocity, Conversion Value, Lead Quality Score, Auto Actions, and Alerts. It also requires campaign/ad set table exposure or filtering for CTR, CPC, CPM, CPL, Lead Quality, and Alerts.

### 2. Missing Setup / No-Data / Audit States

Closed.

The v2 spec adds dashboard data states for setup required, disconnected, loading, no data, sync error, stale sync, and live synced. It also adds AI action variants for suggested, pending approval, approved, confirming, executing, executed, failed, rejected, and audited history.

The prior audit-history blocker is closed by the required `Panel / Recent Audit Trail` with approved, execution success/failure, rejected, and rollback rows.

### 3. Unverified `Review LINE response SLA` Claim

Closed.

The v2 spec explicitly replaces `Review LINE response SLA` with `Review booking quality bottleneck` and constrains evidence to verified dashboard concepts such as lead-to-booking, show-up rate, close rate, paid treatments, and campaign/ad set source.

### 4. Sample KPI Value Disclosure

Closed.

The v2 spec adds data disclosure states for `Sample data`, `Live synced`, `Stale sync`, and `No data`, and states that numeric values are sample values for layout validation unless connected to live workspace data.

### 5. Unverified `Export report` Capability

Closed.

The v2 spec replaces topbar `Export report` with `Reports` or `Prepare report` unless export behavior is confirmed in implementation.

## Constraint Handling

The Figma MCP plan-limit constraint remains real, but it is documented as a canvas update blocker, not a product-context blocker. The v2 spec includes the necessary product corrections and states that the canvas should be updated when MCP access is available again.

## Product Context Approval Conditions

- Use `figma-mockup-v2-spec.md` rather than the v1 canvas as the source of truth for implementation.
- Do not reintroduce unverified LINE, CRM, full automation, guaranteed uplift, or export behavior claims without stakeholder or source verification.
- When canvas access returns, update the Figma file to match the v2 metric, state, audit trail, and claim-cleanup requirements.
