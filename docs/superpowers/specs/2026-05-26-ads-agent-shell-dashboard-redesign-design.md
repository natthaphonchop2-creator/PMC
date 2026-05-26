# Ads Agent Shell And Dashboard Redesign Design

Date: 2026-05-26

## Goal

Redesign the first slice of `/ads-agent` so it feels like the approved PMC clinic workspace direction rather than a dense internal dashboard. This phase covers the Ads Agent shell and the first Ads Dashboard view only. It must preserve the existing Meta API data contracts, approval behavior, and non-dashboard pages.

The approved visual direction is based on the user's reference image at `/Users/natthaphon/Downloads/5d239cb9-d23a-4645-83f2-47a838f089c5.png`.

## Approved Direction

Use the `Clinic Workspace Shell` direction:

- Soft premium clinic palette with warm ivory, bronze, white panels, and restrained accent colors.
- A left outer toolbar that sits outside the main content panel.
- A large rounded white main panel on the right.
- Dashboard cards with clean spacing, soft borders, and practical scan hierarchy.
- Visible copy should be user-facing Thai or clear product labels, not internal architecture wording.

The first implementation scope is approach B: `Shell + Dashboard First`.

## Scope

### In Scope

- Replace the `/ads-agent` shell from the current dark/sidebar cockpit into an outer toolbar plus rounded main panel.
- Build the first Ads Dashboard view in the new style.
- Keep the existing app route `/ads-agent`.
- Keep existing backend APIs and state flow.
- Reuse existing data already passed through `summary`, `campaigns`, `trendData`, `recommendations`, `metaInfo`, `dataState`, and `syncState`.
- Preserve approval/execution flows; money-affecting actions must still require the existing confirmation path.
- Add responsive behavior for desktop, tablet, and mobile.

### Out Of Scope

- Rebuilding every Ads Agent subpage in this phase.
- Changing Meta API endpoints or server behavior.
- Changing Page Automation or Home behavior.
- Reworking the AI architecture.
- Adding real new campaign creation behavior beyond the existing safe UI affordance. If a button cannot perform a real action yet, it must not pretend to write to Meta.

## Navigation

The outer toolbar uses the reference menu set:

1. Ads Dashboard
2. Campaigns
3. Ad Groups
4. Creatives
5. Audience
6. Reports
7. Insights
8. Settings

Map these to existing app areas for phase 1:

- `Ads Dashboard` -> `analytics`
- `Campaigns` -> `ads`
- `Ad Groups` -> `ads`, using the existing Ads Manager page in phase 1
- `Creatives` -> `creative`
- `Audience` -> `audience`
- `Reports` -> `reports`
- `Insights` -> `marketer`
- `Settings` -> `settings`

The toolbar must be treated as an outer application rail, not a card inside the dashboard. It has three zones:

- Top brand: PMC logo/wordmark and clinic label.
- Middle navigation: active menu as a large white pill with a bronze square icon; inactive items as icon chips plus label.
- Bottom user card: user/avatar, role, and dropdown affordance.

## Shell Layout

Desktop and wide tablet:

- `.app-shell` becomes a two-column workspace: fixed-width outer toolbar and flexible main panel.
- Outer toolbar uses a warm clinic background and remains visually outside the white content panel.
- Main panel has large radius, white/ivory surface, soft border, and enough padding for dashboard cards.
- The existing `DataSourceBar` stays inside the main panel so API/setup/error state belongs to content, not the toolbar.

Mobile:

- The outer toolbar collapses into a compact top area with brand and a menu trigger.
- Navigation opens as a drawer or expanded panel.
- Main content stays single-column with no horizontal overflow.
- The dashboard cards stack or become two-column only where the viewport supports it.

## Ads Dashboard View

The first view keeps the role of `AnalyticsPage`, but visually becomes `Ads Dashboard`.

Top area:

- Page title: `Ads Dashboard`
- Date range control using the existing date preset behavior where possible.
- Secondary action: `Customize Dashboard`
- Primary action: `New Campaign`

The `New Campaign` action must be safe:

- In phase 1 it routes to the existing Campaigns area and does not write to Meta.
- It must not silently create or mutate Meta data.

Primary KPI cards:

- Impressions
- Clicks
- Conversions
- Cost

Secondary dashboard areas:

- `Performance Overview`: line chart or existing chart component using current trend/campaign data.
- `Top Campaigns`: ranked campaign list using existing campaign metrics.
- `คำแนะนำที่รออนุมัติ`: approval summary from existing recommendations.
- Lower cards include cost per result, CTR, ROAS, and a short insight panel when those values can be derived from existing data. If a value cannot be derived, that card shows an honest unavailable state.

If a metric is unavailable, show an honest empty/setup state rather than fake values.

## Components

The implementation should introduce or refactor toward these boundaries:

- `AdsShell`: owns the outer toolbar and main panel layout.
- `AdsOuterToolbar`: renders brand, menu items, active state, user card, and mobile trigger.
- `AdsDashboardPage`: renders the first dashboard view using existing data.
- `DashboardMetricCard`: reusable card for KPI metrics.
- `DashboardPanel`: shared panel container for chart/list/insight sections.
- `ApprovalInsightCard`: summarizes recommendations waiting for approval.

Existing pages can remain in `src/App.tsx` for phase 1 if extraction would slow the first slice too much. However, new shell/dashboard components should make future extraction easier and should not require unrelated pages to understand their internals.

## Data And Behavior

No backend contract changes are required.

Use existing values:

- `summary` for total spend/revenue/conversions/ROAS-like values where available.
- `displayCampaigns` or filtered campaigns for campaign ranking and campaign counts.
- `trendData` for performance charts.
- `activeRecommendations` and `recommendationStates` for approval summaries.
- `metaInfo`, `dataState`, `syncState`, and `apiMessage` for connection/error/setup states.

State handling:

- Live data: show dashboard metrics and updated copy.
- Loading: use the existing skeleton/loading state but restyle it to fit the new shell.
- Setup required: show a clear panel message and route the user to Settings.
- Error: show retry guidance inside the main content panel.

## Copy Guidelines

Visible copy should speak to end users.

Use:

- `Ads Dashboard`
- `Campaigns`
- `Ad Groups`
- `Creatives`
- `Audience`
- `Reports`
- `Insights`
- `Settings`
- `คำแนะนำที่รออนุมัติ`
- `เชื่อมต่อ Meta`
- `ซิงก์ข้อมูลล่าสุด`

Avoid visible internal wording:

- `AI Brain`
- `PMC Master Agent`
- `source`
- `execution payload`
- `backend contract`

## Accessibility

- Toolbar navigation must use semantic buttons or links with clear accessible names.
- Active menu item must expose selected/current state.
- Mobile menu trigger must use `aria-expanded` and `aria-controls`.
- User card must not be an unlabeled interactive element.
- Charts must have text labels or summaries so dashboard content is not chart-only.
- Disabled or unavailable actions must clearly expose why they cannot run yet.

## Testing

Add or update tests for:

- `/ads-agent` renders the new outer toolbar.
- Toolbar includes exactly the approved primary menu labels.
- Menu labels map to the expected existing tabs.
- The Ads Dashboard view includes the approved primary sections.
- Setup/error states still render without pretending live data exists.
- Home and Page Automation do not inherit Ads Agent shell styles.

Manual browser QA:

- Desktop viewport: toolbar is outside the main panel and the dashboard has no overlap.
- Tablet viewport: panel and toolbar remain readable.
- Mobile viewport: toolbar collapses, menu opens/closes, and no horizontal overflow appears.
- Verify `/`, `/ads-agent`, and `/page-automation` route separation still holds.

## Risks

- `src/App.tsx` is already large. The implementation should keep the first slice focused and avoid broad unrelated refactors.
- The ref image is visually polished; phase 1 should match the structure and hierarchy without pretending every chart/map/detail is already fully rebuilt.
- The new `Ad Groups` and `Insights` toolbar labels may initially route to existing sections. That is acceptable if the mapping is explicit and the UI does not imply unavailable functionality is complete.

## Acceptance Criteria

- `/ads-agent` opens to the new clinic workspace shell.
- The left toolbar matches the reference structure: brand top, approved 8 menu items, active pill styling, user card bottom.
- The main panel renders an Ads Dashboard first view in the approved visual direction.
- Existing Ads Agent data loading, setup, sync, and approval flows still work.
- No Home or Page Automation visual regressions.
- Desktop and mobile browser QA show no horizontal overflow or incoherent text overlap.
