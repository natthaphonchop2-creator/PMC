---
title: Mascot And Brand Assets
description: User-provided mascot and logo assets for the PMC Ads Agent dashboard redesign.
status: ready_for_recheck
owner: Main Codex Agent
last_updated: 2026-05-18
asset_path: public/pmc-ai-mascot.png
logo_asset_path: public/promedclinicpmc-logo.png
superseded_generated_asset_path: knowledge-base/dashboard-redesign/assets/pmc-mascot.png
superseded_generated_source_asset_path: knowledge-base/dashboard-redesign/assets/pmc-mascot-chroma-source.png
---

# Mascot And Brand Assets

Production mascot PNG:

- `public/pmc-ai-mascot.png`

Production logo PNG:

- `public/promedclinicpmc-logo.png`

Superseded exploratory generated files:

- `knowledge-base/dashboard-redesign/assets/pmc-mascot.png`
- `knowledge-base/dashboard-redesign/assets/pmc-mascot-chroma-source.png`

The production app already references the provided public assets in `src/App.tsx`, so these public paths are the source of truth for future Figma sync and implementation work.

## Purpose

The mascot is a small AI assistant accent for help, setup, and empty states. It should support trust and friendliness without turning the dashboard into a marketing page.

## Usage Rules

- Use as a small decorative/help element, not a hero image.
- Recommended rendered size: 48-96px in dense dashboard panels, up to 140px in setup or no-data states.
- Place near secondary surfaces: setup guidance, empty state panels, AI queue footer, help center prompts, or onboarding notes.
- Keep away from KPI cards, campaign table cells, destructive-action confirmation controls, and primary data charts.
- Do not use it to imply automation is active. Pair it with `Suggest only`, `Setup required`, or clearly labeled AI recommendation states.
- Do not place it behind text or controls.

## Figma Placement Targets

When Figma MCP access is available again, add the mascot to:

- `State / Setup Required`
- `State / No Data`
- `Right Rail / AI Marketer Queue` footer as a small assistant accent
- `Help Center` or onboarding-style panel

Do not add it to:

- KPI row
- Campaign/ad set table rows
- High-risk Meta write confirmation modal
- Performance charts

Add the logo to:

- Brand mark in the sidebar/header.
- Figma file cover or asset reference section.
- App identity notes for implementation handoff.

Do not use the logo as:

- A watermark behind data.
- A repeated decoration in dense dashboard panels.
- A replacement for page title, clinic selector, or account identity.

## Canvas Sync Status

Figma sync is deferred. The main Codex agent attempted to add a `V2 Companion / Mascot Accent Rules` frame to the Figma file, but the call was blocked by the Figma Starter plan MCP tool-call limit.

After the user provided production assets, the Figma sync target changed from the generated exploratory mascot to:

- `public/pmc-ai-mascot.png`
- `public/promedclinicpmc-logo.png`

## Accessibility Notes

- Treat the mascot as decorative if it does not add meaning.
- If used in an empty state, the written state message must carry the full meaning without relying on the image.
- Do not use the mascot as the only indicator of AI activity, risk, or approval status.
