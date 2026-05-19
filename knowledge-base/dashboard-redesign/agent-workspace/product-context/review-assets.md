---
owner_agent: product-context
status: complete
decision: OK
review_cycle: asset_replacement
intended_readers:
  - orchestrator
  - figma-mockup
  - design-review
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
  - src/App.tsx
reviewed_asset_paths:
  - public/pmc-ai-mascot.png
  - public/promedclinicpmc-logo.png
handoff_to:
  - orchestrator
updated_at: 2026-05-18T00:00:00+07:00
summary: Targeted product-context review of switching from exploratory/generated mascot handling to user-provided public mascot and logo assets.
---

# Public Asset Replacement Review

## Decision

OK.

Switching to the user-provided public mascot and logo assets does not introduce unverified product claims, does not weaken the clinic ads cockpit positioning, and does not imply uncontrolled AI automation.

## Scope Reviewed

- `knowledge-base/dashboard-redesign/mascot.md`
- `knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md`
- `knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md`
- `src/App.tsx` references to `/pmc-ai-mascot.png` and `/promedclinicpmc-logo.png`

## Findings

### Product Claims

No blocker found.

The public mascot and logo assets are visual-only PNGs. They do not contain embedded text, slogans, certification marks, performance promises, or medical outcome claims. The docs continue to position the mascot as a decorative/help accent and the logo as a brand mark. The switch from generated exploratory mascot files to `public/pmc-ai-mascot.png` and `public/promedclinicpmc-logo.png` therefore does not add claims such as guaranteed uplift, full CRM sync, LINE SLA, autonomous optimization, or verified export/report behavior.

### Clinic Ads Cockpit Positioning

No blocker found.

The docs preserve the clinic ads cockpit framing by constraining the mascot to setup, no-data, AI queue/footer, Help Center, and onboarding-style support surfaces. Logo use is limited to identity surfaces. In `src/App.tsx`, the logo appears in the sidebar brand and organization badge, while the mascot appears in secondary support/status areas and one platform home visual. These placements do not replace campaign tables, KPI interpretation, charts, Meta workspace status, or approval controls as the primary interface.

### AI Automation Guardrails

No blocker found.

The asset replacement does not change automation authority. `mascot.md` and the v2 spec explicitly state that the mascot must not imply active automation or autonomous execution and must be paired with visible state language such as `Suggest only`, `Setup required`, `Pending approval`, or the relevant action state. In `src/App.tsx`, the mascot references reviewed here are decorative or status-adjacent and do not create a write action, approve Meta changes, or bypass the existing approval/confirmation flow.

## Notes

- The `PlatformHome` mascot visual is larger and more promotional than the other references, but the reviewed asset switch itself does not add a new product claim or uncontrolled automation implication. Keep future iterations aligned with the documented rule that the mascot is an accent, not the main proof of product value.
- The sidebar copy `PMC AI Buddy` / `Meta ads helper` remains acceptable because it describes assistance, not autonomous execution or guaranteed outcomes.
- Continue to keep these assets away from destructive Meta write confirmation controls, KPI cards, dense campaign rows, and performance charts.
