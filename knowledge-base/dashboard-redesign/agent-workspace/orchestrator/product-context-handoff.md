---
owner_agent: orchestrator
status: ready_for_review
intended_readers:
  - visual-reference
  - figma-mockup
  - design-review
  - knowledge-curator
source_files:
  - src/App.tsx
  - src/types.ts
  - src/App.css
handoff_to:
  - visual-reference
  - figma-mockup
  - design-review
updated_at: 2026-05-18T00:00:00+07:00
summary: Product context acceptance criteria captured from Product Context Agent for downstream dashboard redesign work.
---

# Product Context Handoff

The dashboard redesign must stay grounded in the current PMC Ads Agent product: a clinic ads command dashboard for Meta ads, clinic funnel performance, AI recommendations, approval guardrails, creative/audience/compliance context, reports, and settings.

## Required Validation

- Visual Reference Agent validates whether the visual direction fits a clinic/media-buying cockpit and avoids generic SaaS dashboard styling.
- Figma Mockup Agent validates that the IA, modules, metrics, and risk states are represented in the mockup structure.
- Design Review Agent validates usability, hierarchy, responsive behavior, and safety around AI/automation actions.

## Required Metrics

- Spend, revenue, ROAS, CPA, bookings.
- CTR, CPC, CPM, CPL.
- Lead-to-booking, show-up rate, close rate.
- CAC, AOV, sales velocity.
- Frequency, lead quality, conversion value, drop-off.
- Auto actions and alerts.

## Required States

- Setup required.
- No data.
- Synced or live data.
- Pending approval.
- Executing.
- Failed.
- Audited action history.

## Blocking Risks

- The design reads as a generic analytics dashboard rather than a clinic ads cockpit.
- Clinic funnel/business metrics are missing.
- Meta write actions or automation risks are unclear.
- AI recommendations omit evidence, confidence, risk, before/after, guardrails, approval, or rollback context.
- Navigation/module structure is guessed without support from current app concepts.
