# Insights Decision River Visualization Design

Date: 2026-05-30

## Goal

Design the approved advanced visualization for the `/ads-agent` `Insights` workspace. The visualization should help the clinic ads team understand why CPA or ROAS changed by showing how driver metrics flow into outcome metrics, then tie the explanation to evidence and approval-gated next actions.

This spec covers the visual and interaction contract for the `Decision River` concept only. It does not authorize implementation yet.

## Approved Concept

- Approved concept asset: `docs/superpowers/specs/assets/2026-05-30-insights-decision-river-concept.png`
- Original generated preview: `/Users/natthaphon/.codex/generated_images/019e7614-d34c-7f51-838a-9ad12e9e2e51/ig_0850ba4111068384016a1a2367778c8191a9640259eec77910.png`
- Concept scope: existing-page integration inside the current Ads Agent `Insights` workspace.
- Target surface: `/ads-agent`, active toolbar item `Insights`.
- Target large-screen viewport: desktop and wide tablet inside the existing Ads Agent shell.
- Target mobile portrait viewport: 360-430 px wide phone view.
- Mobile landscape: not required for phase 1 because the mobile design is a vertical stepper, not a wide map or pan/zoom substrate.
- User approval status: approved in chat on 2026-05-30 with response `approve`.
- Approval scope: visual direction, layout hierarchy, desktop/mobile reading path, and interaction model.

## Evidence Lock

The visualization must preserve this claim:

> The AI brief explains what changed first, and the Decision River shows the chain from Spend, CPM, CTR, CVR, and Frequency/Fatigue drivers into CPA and ROAS outcomes, with evidence and confidence visible before any recommendation.

Datasets and existing source contracts:

- `WorkspaceData` from the Meta-backed ads workspace.
- Derived metrics from `deriveInsightsMetrics`.
- AI analysis payload from `buildInsightsAnalysisPayload`.
- Cached or refreshed AI brief from `InsightsCachedInsight`.
- Evidence cards from `InsightsEvidenceCard`.
- Approval eligibility from `canOpenInsightsApprovalCommand`.

Visible fields and derived layers:

- Date window and comparison period.
- Last analyzed or stale/cached state.
- AI confidence score and confidence reasons.
- Driver lanes: Spend, CPM, CTR, CVR, Frequency/Fatigue.
- Outcome lanes: CPA/CPL and ROAS.
- Driver status: increased pressure, decreased pressure, neutral, selected.
- Evidence counts by Campaign, Ad Set, Ad, Creative, and Audience where available.
- Recommendation row with approval requirement and risk note.
- Source/caveat note for attribution, delayed conversions, stale data, or missing denominator.

Truth invariants:

- Chart values and scoreboard values must come from the same computed metric source.
- AI explanations cannot override deterministic metric formulas.
- Confidence, caveats, and stale state must remain visible before recommendations.
- No Meta write is sent from this visualization without explicit approval.
- Placeholder values from the concept image must not be copied as real app data.

## Artifact Family

Primary artifact: interactive decision-flow diagnostic, rendered as a data-bound SVG/HTML visualization.

Fallback artifact: stacked metric cards and evidence list when the river cannot render because data is missing, the viewport is too narrow, or reduced browser capability is detected.

Renderer fit:

- Use SVG or HTML/CSS for phase 1 because labels, direct annotations, accessibility, and responsive layout matter more than dense mark count.
- Do not introduce WebGL, 3D, particles, decorative motion, or image-backed chart labels.
- Reuse existing React, TypeScript, and local component patterns in `src/App.tsx` unless implementation planning splits Insights into a smaller module.

## Layout Contract

### Large Screen

Reading order:

1. Existing Ads Agent shell and navigation remain intact.
2. Top band is the AI brief: summary, confidence, primary driver, key opportunity, date window, and stale/live state.
3. Central region is the Decision River.
4. Right rail shows confidence/risk, evidence snapshot, and source/caveats.
5. Bottom strip shows recommended next action only after evidence and caveats.

Decision River structure:

- Left side lists driver lanes: Spend, CPM, CTR, CVR, Frequency/Fatigue.
- Middle shows each lane's sparkline or compact trend, change badge, and pressure state.
- Flow lines connect drivers to CPA and ROAS outcomes.
- Selected lane is outlined and echoed in the evidence rail.
- Outcomes sit to the right with CPA/CPL and ROAS cards.
- Legend/key stays embedded near the river, not detached far from the marks.

Right rail:

- Confidence ring or compact score.
- Count of supporting, neutral, and contradicting signals.
- Evidence snapshot grouped by object type.
- Source/caveat box with attribution and data freshness notes.

### Mobile Portrait

Mobile is a sibling state, not a squeezed desktop river.

First-load order:

1. Compact AI brief with confidence and stale/live state.
2. Decision River driver stepper appears immediately below the brief.
3. Drivers are vertical cards connected by a slim timeline rail.
4. Outcome cards follow the driver stack.
5. A sticky segmented control switches between `Drivers`, `Outcomes`, and `Evidence`.

Interaction model:

- Tap a driver card to select it.
- Selected driver expands enough to show sparkline, change badge, and a short explanation.
- Evidence opens as a bottom sheet preview.
- The bottom sheet must be closable and return focus to the selected driver.
- No essential value depends on hover.

Main visualization visibility rule:

- The compact brief and at least the first two driver cards must be visible on a 390 px portrait first load.
- Filters, date controls, and details must not push the main visualization below an initial settings stack.

## Color And Visual Encoding

Color roles:

- Neutral context: light surface, gray grid, muted labels.
- Primary focal accent: teal for selected or improving/opportunity states.
- Comparison accent: blue for comparison period or non-alert secondary emphasis.
- Warning accent: amber for moderate pressure.
- Critical accent: red for higher pressure or risk.
- Disabled/stale: gray with explicit text label.

Encoding rules:

- Color must always be paired with text or icon state, such as `Pressure`, `Relief`, `Neutral`, `Selected`, `Higher`, or `Lower`.
- Use direct labels and badges instead of legend-only decoding.
- Avoid decorative gradients, glow fields, or background imagery that does not encode evidence.
- Keep cards and controls restrained; use 8 px or smaller radius where practical.

## Data-Bound Mapping

| Concept element | Data/source layer | Editable/data-bound | Visual role | Constraint |
| --- | --- | --- | --- | --- |
| AI brief | `InsightsCachedInsight.brief` | yes | first explanation | must show stale/data warning first when present |
| Confidence score | `InsightsConfidence` | yes | trust signal | show reasons or support count |
| Spend lane | `InsightsTrendPoint.spend` and scoreboard spend | yes | budget pressure driver | show denominator caveat if comparison missing |
| CPM lane | derived CPM metric | yes | auction cost pressure | do not imply causality beyond diagnostic wording |
| CTR lane | derived CTR metric | yes | creative/offer response signal | pair color with label |
| CVR lane | derived conversion rate | yes | conversion efficiency signal | unavailable state if clicks/conversions missing |
| Frequency/Fatigue lane | frequency plus fatigue diagnostic | yes | fatigue risk | distinguish estimated fatigue from measured frequency |
| CPA/CPL outcome | derived CPA/CPL metric | yes | cost efficiency outcome | unavailable state for zero conversions |
| ROAS outcome | derived ROAS metric | yes | value efficiency outcome | unavailable state when conversion value is missing |
| Evidence rail/sheet | `InsightsEvidenceCard[]` | yes | source support | link selected driver to evidence ids where possible |
| Recommendation strip | `InsightsRecommendation[]` | yes | next action | approval gate must be explicit |
| Source/caveat note | warnings, attribution, freshness | yes | data quality guardrail | visible without hover |

## Interaction State

Default state:

- AI brief is expanded.
- Most important driver is selected based on AI summary or strongest diagnostic severity.
- Evidence rail shows support for the selected driver.

Hover and pointer state:

- Desktop hover may preview a lane but must not be required.
- Click commits selection.
- Escape or clicking empty visualization area clears preview and keeps the committed selection.

Mobile state:

- Tap commits selection.
- Evidence bottom sheet opens from a selected driver or evidence tab.
- Bottom sheet has Close and View details actions.
- Sticky segment keeps active area visible.

Refresh and stale data:

- If AI analysis is cached, show cached timestamp and allow `วิเคราะห์ใหม่ด้วย AI`.
- If Meta data is stale, keep last known visualization visible with stale state.
- If data is missing, show fallback cards and explain the next sync action.

URL and persistence:

- Phase 1 should support local component state for selected driver.
- Implementation plan may add URL state for selected driver and date window if it fits the existing Ads Agent route behavior.
- Cached AI insight continues to use the existing cache contract.

## Accessibility

- Essential values must be visible without hover.
- Lane cards need accessible names that include metric, direction, and status.
- Keyboard users can move through driver lanes and outcome cards.
- Focus state must be visible.
- Mobile touch targets should be at least 44 px where practical.
- Color contrast must pass for text, badges, and selected state outlines.
- Reduced motion should disable animated flow drawing and keep the static river readable.
- Screen reader fallback should expose the ordered driver-to-outcome explanation as a list.

## Out Of Scope

- New Meta API contracts.
- True MMM, lift study, or incrementality modeling beyond existing future-ready caveats.
- Auto-applying Meta changes.
- Rebuilding Automation Ads, Ad Groups, or Page Automation.
- Decorative 3D, WebGL, particles, parallax, or generated image substrates.
- Replacing the whole Ads Agent shell.

## Implementation Notes For Later Planning

The implementation plan should decide whether to keep this inside `src/App.tsx` temporarily or extract new focused components such as:

- `InsightsDecisionRiver`
- `InsightsDriverLane`
- `InsightsOutcomeCard`
- `InsightsEvidencePanel`
- `InsightsMobileStepper`

The component should consume existing `InsightsMetrics`, `InsightsCachedInsight`, and `InsightsRecommendation` outputs rather than creating a separate calculation path.

Testing should cover:

- deterministic driver status classification
- unavailable denominator states
- selected driver evidence mapping
- desktop render with brief, river, evidence rail, and recommendation strip
- mobile render with stepper and bottom sheet
- stale, cached, missing, and AI error states

## QA Contract

Before implementation can be called complete, verify:

- `npm run test -- tests/insightsWorkspace.test.ts`
- `npm run lint`
- `npm run build`
- Browser QA on `/ads-agent` with `Insights` selected.
- Desktop screenshot preserves approved reading path.
- Mobile portrait screenshot at 390 px preserves the compact brief, driver stepper, outcome cards, and bottom sheet behavior.
- No horizontal overflow on mobile.
- Source/caveat and stale state visible without hover.
- Approval-gated recommendation cannot be mistaken for an automatic Meta write.
- Concept fidelity review against `docs/superpowers/specs/assets/2026-05-30-insights-decision-river-concept.png`.
