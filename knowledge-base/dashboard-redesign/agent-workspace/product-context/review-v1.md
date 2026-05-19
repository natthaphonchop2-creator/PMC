---
owner_agent: product-context
status: complete
decision: Needs Revision
review_cycle: v1
intended_readers:
  - orchestrator
  - figma-mockup
  - design-review
source_files:
  - knowledge-base/dashboard-redesign/dashboard-brief.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/product-context-handoff.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/visual-reference-handoff.md
  - knowledge-base/dashboard-redesign/figma-mockup-v1-spec.md
handoff_to:
  - orchestrator
updated_at: 2026-05-18T16:10:00+07:00
summary: Product context review for Figma mockup v1 against clinic ads dashboard scope, required metrics, AI risk states, and unverified claims.
---

# Product Context Review v1

## Decision

Needs Revision.

The v1 mockup spec is directionally aligned with the PMC Ads Agent dashboard brief: it presents a clinic ads operations cockpit, keeps ads performance and clinic funnel outcomes visible, and treats Meta write actions as approval-gated AI recommendations. However, it misses several required metrics and states from the product context handoff, and one recommendation introduces an unverified workflow claim.

## Scope Accuracy

Pass:

- The mockup stays focused on an internal clinic ads command dashboard rather than a generic analytics product or marketing page.
- It includes the expected work areas: Analytics, Ads Manager, AI Marketer, Optimization, Creative Studio, Audience Insights, Ad Library, Reports, Settings, and Help Center.
- It keeps the first viewport centered on ads spend, revenue, ROAS, CPA/Booking, leads, bookings, show-up rate, and close rate.
- It reflects Meta account sync, date range, data freshness, and automation mode.

Needs revision:

- The mockup should make clear that values are sample/mock dashboard values unless tied to verified product data. The source files verify product concepts and metric requirements, not the specific values shown.

## Required Metrics

Pass:

- Present: spend, revenue, ROAS, CPA/booking, leads, bookings, show-up rate, close rate, frequency, lead quality by implication, and drop-off note.
- Present in structure: campaign/ad set table, funnel, and trend chart.

Needs revision:

- Missing required ad metrics from the handoff: CTR, CPC, CPM, and CPL.
- Missing required clinic/business metrics from the handoff: CAC, AOV, sales velocity, and conversion value.
- Lead quality is not explicit enough. If it remains a required metric, it should appear as a named field, table column, score, badge, or filter.
- Auto actions and alerts are only partially represented through AI status and the right-rail queue. Add a clearer alerts/action history surface or make the existing state legend trace to specific visible rows/cards.

## Clinic Ads Context

Pass:

- The funnel stages are appropriate for clinic ads: impressions, clicks, leads, bookings, show-ups, and paid treatments.
- The mockup connects ad platform performance to clinic outcomes rather than stopping at traffic metrics.
- Thai baht values and BKK freshness are consistent with the visual reference handoff.

Needs revision:

- The product brief says roles and clinic workflow assumptions are inferred and should be validated. Avoid over-specific operational claims unless represented as mock examples.

## Meta Write and AI Risk States

Pass:

- The primary recommendation is a guarded Meta write action, clearly pending approval.
- The recommendation card includes evidence, confidence, risk, guardrail, before/after estimate, rollback note, and approve/reject controls.
- Automation mode is set to Suggest only, which avoids implying silent execution.

Needs revision:

- Required states are incomplete. The handoff requires setup required, no data, synced/live data, pending approval, executing, failed, and audited action history. The spec lists suggested, approved, executing, failed, and audited, but does not visibly cover setup required or no data.
- Include rejected as a visible state if it remains part of the visual reference pass criteria.
- Audited action history should be more than a legend item. It needs a visible audit trail row/card or a clear link target.

## Unverified Product Claims

Needs revision:

- `Review LINE response SLA` appears to imply LINE messaging, response-time tracking, or CRM/service workflow integration. These capabilities are not verified in the reviewed product brief or handoffs. Replace it with a verified ads/clinic-funnel recommendation, or label it clearly as an assumption needing stakeholder validation.
- `Export report` may be plausible because Reports exists, but export behavior is not verified in the reviewed files. Safer wording would be `Reports` or `Prepare report` unless export is confirmed elsewhere.

No issue:

- Meta read sync is verified by the dashboard brief.
- Approval-gated Meta write actions are required by the handoff and visual reference direction.
- AI recommendations, confidence, guardrails, and rollback context are required and appropriate.

## Required Updates Before OK

1. Add or visibly account for CTR, CPC, CPM, CPL, CAC, AOV, sales velocity, conversion value, and explicit lead quality.
2. Add setup required and no-data states, and make audited action history visible as an actual UI element.
3. Replace or qualify the unverified `Review LINE response SLA` recommendation.
4. Qualify specific KPI values as mock/sample values unless they are verified product data.
5. Confirm whether `Export report` is a verified capability or revise the control label.
