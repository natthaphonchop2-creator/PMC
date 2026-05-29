# PMC Ads Agent Project Updates

This is the canonical update log for PMC Ads Agent development.

## Standing Rule

Every development change must update this file before staging or committing. This includes UI work, API changes, tests, assets, documentation, release preparation, and bug fixes.

Release-specific documents, previews, PDFs, screenshots, and visual QA assets must be grouped under `docs/releases/<date>-v<version>/` with a short README index.

## Current Version

- Version: `0.1.0`
- Date: 2026-05-29
- Branch: `codex/PMC`
- Release folder: `docs/releases/2026-05-29-v0.1.0/`

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
