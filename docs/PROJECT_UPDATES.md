# PMC Ads Agent Project Updates

This is the canonical update log for PMC Ads Agent development.

## Standing Rule

Every development change must update this file before staging or committing. This includes UI work, API changes, tests, assets, documentation, release preparation, and bug fixes.

Release-specific documents, previews, PDFs, screenshots, and visual QA assets must be grouped under `docs/releases/<date>-v<version>/` with a short README index.

## Current Version

- Version: `0.1.0`
- Date: 2026-05-30
- Branch: `main`
- Release folder: `docs/releases/2026-05-29-v0.1.0/`

## 2026-08-20 - Google Booking Operations implementation

- Added a separate TypeScript Google Apps Script package under `apps/pmc-google-booking-ops/`.
- Implemented Quick Form validation, Admin/email matching, canonical Sheet repositories, audit/version control, private Drive evidence, doctor Calendar conflicts, and doctor-specific LINE routing.
- Added the PMC Web raw-body LINE webhook bridge so LINE signatures are verified before sanitized source IDs reach Apps Script through an internal HMAC.
- Implemented appointment-day call reminders, Admin group/direct routing, Day-7 overdue handling, six-calendar-month expiry, JERA CP874 import/reconciliation, dashboard metrics, integrity checks, backup deduplication, and approval-gated evidence retention.
- Added synthetic end-to-end tests, setup instructions, and a production pilot runbook. Real Google/LINE assets and real customer use remain setup-gated until the pilot receives manager sign-off.
- Reconciled the new Form with the current Microsoft Form: added an optional page/channel Dropdown, seeded seven Admin names plus existing service/channel choices, and changed attribution to the selected Admin because all staff share one Google account.
- Provisioned the company Google Sheet, Forms, private Drive folders, doctor Calendars, Apps Script triggers, Render-to-Apps-Script HMAC ingress, and three LINE group mappings for the synthetic pilot. The pilot uses Admin-group-only reminders until individual Admin LINE IDs are intentionally mapped.
- Fixed the first live synthetic Form execution by removing the unsupported `structuredClone` dependency from the Apps Script bundle; the stalled synthetic row was audit-recorded and removed before any Drive, Calendar, LINE, or call-task side effect occurred.

## 2026-05-30 - Ads Dashboard and Insights polish deploy

- Updated Ads Dashboard copy to user-facing Thai labels and section names.
- Added Ads Dashboard data status strip for selected date window, daily data count, and campaign ranking scope.
- Added dedicated Ads Dashboard skeleton loading layout for KPI cards, daily trend chart, campaign ranking, and lower metric cards.
- Refined Insights copy away from internal agent labels toward decision-support language.
- Fixed Decision River evidence summaries so the selected driver controls the visible values.
- Added campaign evidence metrics from ad activity: Spend, Results, Clicks, Impressions, CTR, CVR, CPM, Frequency, ROAS, and CPA.
- Updated cached AI evidence handling so older cached cards can receive freshly derived metric values.
- Updated Decision River scoring so CVR, CPM, and Frequency select evidence cards that contain matching driver metrics.
- Added compact evidence metric grid styles for desktop and mobile.
- Verified CVR evidence sheet in headless Chrome: CVR evidence showed CVR, Results, and Clicks, did not show generic ROAS/CPA as the main summary, and had no horizontal overflow.
- Updated regression tests for Ads Dashboard skeleton loading, user-facing copy, Decision River evidence rendering, and derived campaign evidence values.
- Added daily Obsidian project update notes under `Projects/PMC Ads Agent/PROJECT_UPDATES/`.

## 2026-05-29 - v0.1.0

- Added a Page Automation cancel-schedule API flow that records an operator audit intent and appends a cancelled schedule record.
- Added the Auto Post cancel-schedule button and UI feedback for scheduled drafts.
- Refined Home launcher and Page Automation visuals around the softer PMC palette, removed product-logo dependency from the launcher/header, and added the Page Automation background asset.
- Updated regression tests for Home visual rules, Page Automation cancel-schedule UI behavior, and backend cancel-schedule handling.
- Organized user manuals, visual previews, PDFs, and QA screenshots into `docs/releases/2026-05-29-v0.1.0/`.
- Added this project update log and made update-log maintenance a mandatory development rule in `Agent.md`.
- Added the Ad Groups workspace design spec with the approved Split Inspector layout, approval-gated Meta write flow, and phase-1 testing scope.
- Added the Insights AI Analysis workspace design spec with the approved AI Brief First layout, researched measurement formulas, confidence scoring, cached AI refresh flow, and approval-gated recommendation rules.
- Clarified the Insights design scope: the implementation must rebuild and replace the old Insights page rather than patching or preserving the previous UI as a parallel mode.
- Added the Automation Ads workspace design spec with the approved Run Monitor + Tabs layout, configurable safe rule builder, scheduled approval queue, hybrid rule/AI decision engine, and approval-gated Meta writes.
- Added the Ad Groups workspace implementation plan with TDD tasks for routing, data helpers, Split Inspector UI, approval-gated actions, and local QA.
- Implemented the Ad Groups workspace as a dedicated Split Inspector page with Ad Set filters, read-only Ads details, and approval-gated Meta actions.
- Added the Insights AI Analysis workspace implementation plan for replacing the old Insights page with an AI Brief First workspace, structured AI refresh payloads, formula-backed metrics, charts, evidence, confidence, and approval-gated recommendations.
- Implemented the rebuilt Insights AI Analysis workspace with cached AI brief, structured AI refresh payloads, formula metrics, charts, evidence, confidence, and approval-gated recommendations.
- Added the Automation Ads workspace implementation plan for replacing the paused placeholder with a Run Monitor, scheduled approval queue, configurable safe rules, conflict handling, and run history.
- Implemented the Automation Ads workspace with a deterministic rule engine, manual run monitor, approval queue, configurable rule builder, run history, conflict/duplicate guards, and responsive browser QA.
