---
owner_agent: design-review-asset-replacement
status: complete
intended_readers:
  - orchestrator
  - figma-mockup
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/design-review-checklist.md
source_assets:
  - public/pmc-ai-mascot.png
  - public/promedclinicpmc-logo.png
review_focus:
  - visual hierarchy
  - accessibility
  - density
  - logo and mascot decorative misuse
updated_at: 2026-05-18T00:00:00+07:00
decision: OK
---

# Asset Replacement Design Review

## Decision

OK.

The replacement asset guidance is acceptable for the dashboard redesign. The documented rules keep the mascot and logo secondary to operational content, preserve dashboard density, and avoid using either asset as a status, automation, or approval signal.

## Reviewed Assets

- `public/pmc-ai-mascot.png`: 760 x 760 PNG with transparent alpha. The asset is expressive and visually prominent, so the documented 48-96px dense-panel size and 140px setup/no-data limit are important.
- `public/promedclinicpmc-logo.png`: 512 x 512 square logo PNG. The mark is suitable for brand identity surfaces, but should remain limited to the sidebar/header and asset reference areas because its app-icon shape and saturated gradient would compete with dense dashboard content if repeated.

## Review Notes

### Visual Hierarchy

- The v2 spec correctly keeps primary hierarchy on KPI cards, campaign comparison, charts, AI approval controls, and audit history.
- Mascot placement is limited to secondary contexts: setup required, no data, AI queue footer, help, and onboarding notes.
- Logo placement is limited to brand identity surfaces. This avoids turning the logo into a watermark or decorative panel motif.

### Accessibility

- The mascot is correctly treated as decorative unless surrounding copy explicitly gives it meaning.
- State meaning remains in written messages and badges such as `Suggest only`, `Pending approval`, `Setup required`, and explicit action states.
- The logo and mascot are not allowed to replace page title, clinic/account identity, state labels, risk labels, or approval controls.

### Density

- The asset size limits are appropriate for the dense cockpit direction in the v2 spec.
- Keeping assets out of KPI cards, campaign rows, charts, and destructive confirmation controls protects scan speed and prevents right-rail crowding.
- The AI queue footer usage is acceptable only if it remains a small accent and does not create another persistent visual block.

### Decorative Misuse

- The documented rules avoid the main misuse cases: mascot as hero art, mascot behind text, mascot as automation indicator, mascot inside destructive confirmation, logo as watermark, and logo as repeated decoration.
- The `Component / Mascot Accent` boundary should remain enforced during implementation and future Figma sync so the asset cannot be placed arbitrarily in data-dense or safety-critical areas.

## Non-Blocking Follow-Up

When Figma canvas sync is available, use the public assets only in the documented target surfaces. If the canvas places either asset in primary data surfaces, table rows, charts, or Meta write confirmations, treat that as a revision request.
