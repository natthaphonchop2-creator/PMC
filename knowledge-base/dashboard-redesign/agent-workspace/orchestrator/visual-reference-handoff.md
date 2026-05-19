---
owner_agent: orchestrator
status: ready_for_review
intended_readers:
  - figma-mockup
  - design-review
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/product-context-handoff.md
handoff_to:
  - figma-mockup
  - design-review
updated_at: 2026-05-18T00:00:00+07:00
summary: Visual reference direction and image prompt captured from Visual Reference Agent.
---

# Visual Reference Handoff

## Direction

Use a dense, calm AI media-buying cockpit direction: closer to a clinic operations command center than a SaaS landing page.

Key layout requirements:

- Left navigation grouped by work mode: Ads Manager, Analytics, AI Marketer, Optimization, Creative, Audience, Reports, Settings.
- Top command bar with clinic/account selector, date range, Meta sync state, data freshness, and automation mode.
- First viewport shows business and ads performance together: Spend, Revenue, ROAS, CPA/Booking, Leads, Bookings, Show-up Rate, Close Rate.
- Center area prioritizes clinic funnel and campaign performance table.
- Right rail shows AI recommendations with confidence, risk, guardrail, approval state, and Meta write-action controls.
- Visual tone: light operational UI, white surfaces, cool gray background, restrained violet/blue accent, status colors only for meaning.
- Component style: 8px radius, thin borders, subtle shadows, dense tables, clear badges, no decorative hero treatment.

## Image Prompt

```text
Create a high-fidelity desktop dashboard reference image for “PMC Ads Agent”, an internal clinic advertising command cockpit. Light theme, modern enterprise operations UI, dense but clean layout, 1440x1000.

Scene: AI media-buying cockpit for Thai clinic Meta ads. Left sidebar navigation with modules: Analytics, Ads Manager, AI Marketer, Optimization, Creative Studio, Audience Insights, Reports, Settings. Top bar with clinic selector, Meta account sync status, date range, automation mode set to “Suggest only”, and data freshness timestamp.

Main dashboard: KPI row showing Ad Spend, Revenue, ROAS, CPA/Booking, Leads, Bookings, Show-up Rate, Close Rate. Use Thai baht values and compact Thai/English labels. Middle section has a funnel visualization from Impressions -> Clicks -> Leads -> Bookings -> Show-ups -> Paid Treatments, plus a line/area performance chart. Below, a campaign/ad set table with status, budget, spend, CPA, ROAS, frequency, AI status, and risk badges.

Right rail: “AI Marketer” recommendation queue with cards showing recommendation, evidence, confidence percentage, risk level, guardrail, before/after impact, rollback note, and approve/reject buttons. Include one guarded Meta write action such as pause ad or reduce budget, clearly marked as pending approval.

Visual style: pragmatic clinic operations dashboard, light gray page background, white panels, 8px radius, thin #E1E7F0 borders, crisp dark text, muted secondary text, restrained violet/blue accent, green for healthy, amber for watch, red for critical. No marketing hero, no decorative gradients, no oversized illustrations, no glassmorphism, no dark cyberpunk style. Make it feel trustworthy, auditable, and implementation-ready.
```

## Pass Criteria

- Ads platform metrics and clinic funnel outcomes appear in the first viewport.
- AI recommendations are auditable: evidence, confidence, risk, guardrail, approval state, and rollback are visible.
- Suggested, approved, executing, executed, failed, and rejected actions are distinct.
- Meta sync/account/data freshness state is visible.
- The layout is dense but readable, with stable navigation and scan-friendly tables.
- Thai/English labels fit without overflow or awkward truncation.

## Fail Criteria

- Looks like a generic analytics template with no clinic funnel context.
- Looks like a marketing website instead of a daily operations tool.
- Treats AI recommendations as summaries without approval controls.
- Obscures risk, confidence, or write-action consequences.
- Invents product capabilities not verified by the brief or app structure.
